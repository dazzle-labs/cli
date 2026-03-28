package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"connectrpc.com/connect"
	expirable "github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	apiv1connect "github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"

	apiv1internalconnect "github.com/browser-streamer/control-plane/internal/gen/api/v1/apiv1internalconnect"
	"github.com/browser-streamer/control-plane/internal/controller"
	"github.com/browser-streamer/control-plane/internal/runpod"
)

// Set via -ldflags at build time; falls back to "main".
var gitCommit = "main"

// Ensure compile-time interface satisfaction.
var (
	_ apiv1connect.StageServiceHandler           = (*stageServer)(nil)
	_ apiv1internalconnect.ApiKeyServiceHandler   = (*apiKeyServer)(nil)
	_ apiv1connect.RtmpDestinationServiceHandler  = (*rtmpDestinationServer)(nil)
	_ apiv1connect.UserServiceHandler             = (*userServer)(nil)
	_ apiv1connect.RuntimeServiceHandler          = (*runtimeServer)(nil)
	_ apiv1internalconnect.FeaturedServiceHandler  = (*featuredServer)(nil)
)

type StageStatus string

const (
	StatusInactive StageStatus = "inactive"
	StatusStarting StageStatus = "starting"
	StatusRunning  StageStatus = "running"
	StatusStopping StageStatus = "stopping"
)

type Stage struct {
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	PodName       string      `json:"podName"`
	PodIP         string      `json:"podIP,omitempty"`
	DirectPort    int32       `json:"directPort"`
	CreatedAt     time.Time   `json:"createdAt"`
	Status        StageStatus `json:"status"`
	OwnerUserID  string `json:"ownerUserId,omitempty"`
	PreviewToken string `json:"previewToken,omitempty"`
	Provider      string      `json:"provider,omitempty"`      // "kubernetes" (default) or "gpu"
	SidecarURL    string      `json:"sidecarUrl,omitempty"`    // fully-qualified sidecar base URL (GPU stages)
	Capabilities  []string    `json:"capabilities,omitempty"`  // e.g., ["gpu"]
	Slug          string      `json:"slug,omitempty"`          // short ID for public watch URLs
}

type Manager struct {
	mu            sync.RWMutex
	stages        map[string]*Stage
	previewTokenCache *expirable.LRU[string, string] // token -> stageID, lazily populated from DB
	ingestPodCache    *expirable.LRU[string, string] // stageID -> ingest pod IP, for HLS proxy routing
	slugCache         *expirable.LRU[string, string] // slug -> stageID
	activateMu    sync.Map // per-stage activation locks (stageID -> *sync.Mutex)
	activateCancel sync.Map // per-stage cancel funcs (stageID -> context.CancelFunc)
	clientset     *kubernetes.Clientset
	namespace     string
	streamerImage string
	sidecarImage  string
	r2Client      *R2Client
	r2Bucket      string
	maxStages        int
	imagePullSecrets []corev1.LocalObjectReference
	db            *sql.DB
	auth          *authenticator
	encryptionKey []byte
	pc            *podClient
	oauth              *oauthHandler
	cliSessions        *cliSessionManager
	cliSessionRL       *rateLimiter
	publicBaseURL      string

	// GPU provisioning (active when RUNPOD_API_KEY is set)
	dynamicClient      dynamic.Interface
	gpuController      *controller.GPUNodeController
	gpuStageController *controller.GPUStageController
	runpodClient       *runpod.Client
	agentHTTPClient    *http.Client // mTLS client for all sidecar/agent RPC

	// HTML template for index.html with OG meta tag injection
	indexTmpl        *template.Template
	defaultIndexHTML []byte // pre-rendered index.html with default meta
}


// validatePreviewToken checks the LRU cache first, then falls back to the DB.
// Returns the stage ID if the token is valid, or empty string if not.
func (m *Manager) validatePreviewToken(token string) string {
	if stageID, ok := m.previewTokenCache.Get(token); ok {
		return stageID
	}
	if m.db == nil {
		return ""
	}
	var stageID string
	err := m.db.QueryRow(`SELECT id FROM stages WHERE preview_token=$1`, token).Scan(&stageID)
	if err != nil {
		return ""
	}
	m.previewTokenCache.Add(token, stageID)
	return stageID
}

// invalidatePreviewToken removes a token from the cache (e.g. on regeneration).
func (m *Manager) invalidatePreviewToken(token string) {
	m.previewTokenCache.Remove(token)
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envIntOrDefault(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return def
}

func NewManager() (*Manager, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("k8s in-cluster config: %w", err)
	}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("k8s clientset: %w", err)
	}

	db, err := openDB()
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := runMigrations(db, "migrations"); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	clerkSecretKey := os.Getenv("CLERK_SECRET_KEY")
	if clerkSecretKey == "" {
		return nil, fmt.Errorf("CLERK_SECRET_KEY is required")
	}

	encKeyHex := os.Getenv("ENCRYPTION_KEY")
	if encKeyHex == "" {
		return nil, fmt.Errorf("ENCRYPTION_KEY is required")
	}
	encKey, err := hex.DecodeString(encKeyHex)
	if err != nil || len(encKey) != 32 {
		return nil, fmt.Errorf("ENCRYPTION_KEY must be 32 bytes hex-encoded")
	}

	publicBaseURL := os.Getenv("PUBLIC_BASE_URL")
	if publicBaseURL == "" {
		publicBaseURL = os.Getenv("OAUTH_REDIRECT_BASE_URL")
	}

	m := &Manager{
		stages:        make(map[string]*Stage),
		previewTokenCache: expirable.NewLRU[string, string](1000, nil, 5*time.Minute),
		ingestPodCache:    expirable.NewLRU[string, string](500, nil, 30*time.Second),
		slugCache:         expirable.NewLRU[string, string](1000, nil, 10*time.Minute),
		clientset:     clientset,
		namespace:     envOrDefault("NAMESPACE", "browser-streamer"),
		streamerImage: envOrDefault("STREAMER_IMAGE", "browser-streamer:latest"),
		sidecarImage:  envOrDefault("SIDECAR_IMAGE", "stage-sidecar:latest"),
		r2Bucket:      os.Getenv("R2_BUCKET"),
		maxStages:     envIntOrDefault("MAX_STAGES", 3),
		db:            db,
		auth:          newAuthenticator(db, clerkSecretKey),
		encryptionKey: encKey,
		publicBaseURL: publicBaseURL,
	}

	// Initialize R2 client for stage storage (optional — graceful degradation)
	if r2Endpoint := os.Getenv("R2_ENDPOINT"); r2Endpoint != "" {
		r2AccessKey := os.Getenv("R2_ACCESS_KEY_ID")
		r2SecretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
		if r2AccessKey != "" && r2SecretKey != "" {
			r2c, err := NewR2Client(r2Endpoint, r2AccessKey, r2SecretKey, m.r2Bucket)
			if err != nil {
				log.Printf("WARN: failed to create R2 client: %v (stage storage disabled)", err)
			} else {
				m.r2Client = r2c
				log.Printf("R2 stage storage enabled (bucket=%s)", m.r2Bucket)
			}
		}
	}

	m.pc = newPodClient()

	// Build mTLS client — used for all sidecar/agent communication
	agentTLSConfig, err := buildAgentTLSConfig()
	if err != nil {
		return nil, fmt.Errorf("mTLS config: %w", err)
	}
	if agentTLSConfig != nil {
		m.agentHTTPClient = &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{TLSClientConfig: agentTLSConfig},
		}
		m.pc.agentHTTPClient = m.agentHTTPClient
	}

	// GPU provisioning (optional — only active when RUNPOD_API_KEY is set)
	if runpodAPIKey := os.Getenv("RUNPOD_API_KEY"); runpodAPIKey != "" {
		m.runpodClient = runpod.NewClient(runpodAPIKey)

		dynClient, err := dynamic.NewForConfig(config)
		if err != nil {
			return nil, fmt.Errorf("k8s dynamic client: %w", err)
		}
		m.dynamicClient = dynClient

		m.gpuController = controller.NewGPUNodeController(dynClient, m.runpodClient, m.namespace, agentTLSConfig)
		m.gpuStageController = controller.NewGPUStageController(dynClient, db, m.namespace, m.agentHTTPClient)
		log.Printf("GPU provisioning enabled (RunPod)")
	}

	if secret := os.Getenv("IMAGE_PULL_SECRET"); secret != "" {
		m.imagePullSecrets = []corev1.LocalObjectReference{{Name: secret}}
	}

	m.cliSessions = newCliSessionManager()
	m.cliSessionRL = newRateLimiter()
	m.oauth = newOAuthHandler(m)
	if platforms := m.oauth.availablePlatforms(); len(platforms) > 0 {
		log.Printf("OAuth configured for: %v", platforms)
	}

	// Parse Vite-emitted index.html.tmpl (contains hashed asset tags + Go template placeholders)
	indexTmpl, defaultHTML, err := initIndexTemplate("web")
	if err != nil {
		log.Printf("WARN: index template init: %v (OG meta injection disabled)", err)
	} else {
		m.indexTmpl = indexTmpl
		m.defaultIndexHTML = defaultHTML
	}

	if err := m.recoverStages(); err != nil {
		log.Printf("WARN: stage recovery: %v", err)
	}

	return m, nil
}

// recoverStages rebuilds in-memory state from actual k8s pods and GPU stage
// records on restart. Any DB stage marked non-inactive that has no corresponding
// running pod or GPU stage is reset to inactive.
func (m *Manager) recoverStages() error {
	// 1. Recover CPU stages from k8s pods
	pods, err := m.clientset.CoreV1().Pods(m.namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: "app=streamer-stage",
	})
	if err != nil {
		return err
	}

	for i := range pods.Items {
		pod := &pods.Items[i]
		stageID := pod.Labels["stage-id"]
		if stageID == "" {
			continue
		}

		status := StatusStarting
		if pod.Status.Phase == corev1.PodRunning {
			for _, cond := range pod.Status.Conditions {
				if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
					status = StatusRunning
				}
			}
		}

		stage := &Stage{
			ID:        stageID,
			PodName:   pod.Name,
			PodIP:     pod.Status.PodIP,
			CreatedAt: pod.CreationTimestamp.Time,
			Status:    status,
		}

		// Look up name, owner, and preview token from DB
		if m.db != nil {
			if row, err := dbGetStage(m.db, stageID); err == nil && row != nil {
				stage.Name = row.Name
				stage.OwnerUserID = row.UserID
				if row.PreviewToken.Valid {
					stage.PreviewToken = row.PreviewToken.String
				}
				if row.Slug.Valid {
					stage.Slug = row.Slug.String
				}
			}
		}

		m.stages[stageID] = stage
		log.Printf("Recovered stage %s (pod=%s, status=%s, owner=%s)", stageID, pod.Name, status, stage.OwnerUserID)
	}

	// 2. Recover GPU stages from DB — these have no k8s pod but have a sidecar URL
	if m.db != nil {
		gpuRows, err := m.db.Query(`SELECT `+stageColumns+` FROM stages WHERE status != 'inactive' AND provider = 'gpu'`)
		if err == nil {
			for gpuRows.Next() {
				row, err := scanStage(gpuRows)
				if err != nil {
					continue
				}
				if _, ok := m.stages[row.ID]; ok {
					continue // already recovered
				}
				stage := &Stage{
					ID:           row.ID,
					Name:         row.Name,
					Status:       StageStatus(row.Status),
					OwnerUserID:  row.UserID,
					Provider:     "gpu",
					SidecarURL:   row.SidecarURL.String,
					Capabilities: row.Capabilities,
					CreatedAt:    row.CreatedAt,
				}
				if row.PreviewToken.Valid {
					stage.PreviewToken = row.PreviewToken.String
				}
				if row.Slug.Valid {
					stage.Slug = row.Slug.String
				}
				m.stages[row.ID] = stage
				log.Printf("Recovered GPU stage %s (status=%s, sidecar=%s, owner=%s)", row.ID, row.Status, row.SidecarURL.String, row.UserID)
			}
			gpuRows.Close()
		}
	}

	// 3. Reset any DB stages that appear non-inactive but have no corresponding
	// in-memory state (no pod and not a GPU stage we just recovered)
	if m.db != nil {
		rows, err := m.db.Query(`SELECT id FROM stages WHERE status != 'inactive'`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					if _, ok := m.stages[id]; !ok {
						dbUpdateStageStatus(m.db, id, "inactive", "", "")
						log.Printf("Reset stale stage %s to inactive (no pod or GPU stage found)", id)
					}
				}
			}
		}
	}

	log.Printf("Recovered %d active stages", len(m.stages))

	// Sync outputs for all recovered running stages so sidecars resume broadcasting
	for id, stage := range m.stages {
		if stage.Status == StatusRunning {
			m.syncStageOutputsIfRunning(id, stage.OwnerUserID)
		}
	}

	return nil
}

func (m *Manager) createStage(requestedID, userID string) (*Stage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Per-user active CPU stage limit (only counts running/starting, not inactive)
	maxActiveCPU := m.maxStages
	if m.db != nil {
		var limit int
		if err := m.db.QueryRow("SELECT max_active_cpu_stages FROM users WHERE id=$1", userID).Scan(&limit); err == nil {
			maxActiveCPU = limit
		}
	}
	cpuCount := 0
	for _, s := range m.stages {
		if s.OwnerUserID == userID && s.Provider != "gpu" {
			cpuCount++
		}
	}
	if cpuCount >= maxActiveCPU {
		return nil, fmt.Errorf("max active CPU stages (%d) reached", maxActiveCPU)
	}

	id := requestedID
	if id == "" {
		id = uuid.Must(uuid.NewV7()).String()
	} else if _, exists := m.stages[id]; exists {
		return nil, fmt.Errorf("stage %s already exists", id)
	}
	podName := "streamer-" + id

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: m.namespace,
			Labels: map[string]string{
				"app":        "streamer-stage",
				"stage-id":   id,
				"managed-by": "control-plane",
			},
		},
		Spec: corev1.PodSpec{
			RestartPolicy:                 corev1.RestartPolicyNever,
			TerminationGracePeriodSeconds: int64Ptr(30),
			SchedulerName:                 os.Getenv("SCHEDULER_NAME"),
			PriorityClassName:             os.Getenv("PRIORITY_CLASS_NAME"),
			ImagePullSecrets:              m.imagePullSecrets,
			InitContainers: []corev1.Container{
				{
					Name:    "restore",
					Image:   m.sidecarImage,
					Command: []string{"/sidecar", "restore"},
					Env:     sidecarEnvVars(userID, id, m.r2Bucket),
					VolumeMounts: []corev1.VolumeMount{
						{Name: "stage-data", MountPath: "/data"},
					},
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("100m"),
							corev1.ResourceMemory: resource.MustParse("64Mi"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("256Mi"),
						},
					},
					ImagePullPolicy: corev1.PullIfNotPresent,
				},
			},
			Containers: []corev1.Container{
				{
					Name:  "streamer",
					Image: m.streamerImage,
					Env: streamerEnvVars(id, userID),
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("2Gi"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("3500m"),
							corev1.ResourceMemory: resource.MustParse("14Gi"),
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{Name: "dshm", MountPath: "/dev/shm"},
						{Name: "stage-data", MountPath: "/data"},
						{Name: "hls-data", MountPath: "/tmp/hls"},
						{Name: "x11-socket", MountPath: "/tmp/.X11-unix"},
						{Name: "pulse-socket", MountPath: "/tmp/pulse"},
						{Name: "swiftshader-ini", MountPath: "/data/chrome/SwiftShader.ini", SubPath: "SwiftShader.ini"},
					},
					Lifecycle: &corev1.Lifecycle{
						PreStop: &corev1.LifecycleHandler{
							Exec: &corev1.ExecAction{
								Command: []string{"/bin/sh", "/scripts/prestop.sh"},
							},
						},
					},
					ImagePullPolicy: corev1.PullIfNotPresent,
				},
				{
					Name:    "sidecar",
					Image:   m.sidecarImage,
					Command: []string{"/sidecar", "serve"},
					Ports: []corev1.ContainerPort{
						{
							ContainerPort: 8080,
							Protocol:      corev1.ProtocolTCP,
						},
					},
					Env: append(sidecarEnvVars(userID, id, m.r2Bucket),
						append(mtlsEnvVars(),
							corev1.EnvVar{Name: "DISPLAY", Value: ":99"},
							corev1.EnvVar{Name: "PULSE_SERVER", Value: "unix:/tmp/pulse/native"},
							corev1.EnvVar{Name: "LOCAL_HTTP_PORT", Value: "8081"},
						)...,
					),
					VolumeMounts: []corev1.VolumeMount{
						{Name: "stage-data", MountPath: "/data"},
						{Name: "hls-data", MountPath: "/tmp/hls"},
						{Name: "x11-socket", MountPath: "/tmp/.X11-unix"},
						{Name: "pulse-socket", MountPath: "/tmp/pulse"},
					},
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("100m"),
							corev1.ResourceMemory: resource.MustParse("128Mi"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("512Mi"),
						},
					},
					ReadinessProbe: &corev1.Probe{
						ProbeHandler: corev1.ProbeHandler{
							Exec: &corev1.ExecAction{
								Command: []string{"wget", "-q", "--spider", "http://127.0.0.1:8081/_dz_9f7a3b1c/health"},
							},
						},
						InitialDelaySeconds: 2,
						PeriodSeconds:       2,
						FailureThreshold:    30,
					},
					ImagePullPolicy: corev1.PullIfNotPresent,
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "dshm",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{
							Medium:    corev1.StorageMediumMemory,
							SizeLimit: resourcePtr(resource.MustParse("2Gi")),
						},
					},
				},
				{
					Name: "stage-data",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{
							SizeLimit: resourcePtr(resource.MustParse("2Gi")),
						},
					},
				},
				{
					Name: "hls-data",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{
							SizeLimit: resourcePtr(resource.MustParse("512Mi")),
						},
					},
				},
				{
					Name: "x11-socket",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{},
					},
				},
				{
					Name: "pulse-socket",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{},
					},
				},
				{
					Name: "swiftshader-ini",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: "swiftshader-ini"},
						},
					},
				},
			},
		},
	}

	_, err := m.clientset.CoreV1().Pods(m.namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("create pod: %w", err)
	}

	now := time.Now()
	stage := &Stage{
		ID:        id,
		PodName:   podName,
		CreatedAt: now,
		Status:    StatusStarting,
	}
	m.stages[id] = stage

	if m.db != nil {
		dbUpdateStageStatus(m.db, id, "starting", podName, "")
	}

	log.Printf("Created stage %s (pod=%s)", id, podName)
	return stage, nil
}

func resourcePtr(r resource.Quantity) *resource.Quantity {
	return &r
}

func int64Ptr(i int64) *int64 {
	return &i
}

func boolPtr(b bool) *bool {
	return &b
}

// sidecarEnvVars returns the env vars needed by the sidecar/init containers.
// streamerEnvVars returns env vars for the streamer container.
// All STREAMER_* env vars on the control-plane are passed through (with the
// prefix stripped) so the streamer image can be tuned without rebuilding.
// Key vars: CHROME_FLAGS (full Chrome arg string), SCREEN_WIDTH, SCREEN_HEIGHT,
// DISABLE_WEBGL.
func streamerEnvVars(stageID, userID string) []corev1.EnvVar {
	vars := []corev1.EnvVar{
		{Name: "STAGE_ID", Value: stageID},
		{Name: "USER_ID", Value: userID},
		{Name: "LOCAL_HTTP_PORT", Value: "8081"},
	}
	// Pass through all STREAMER_* env vars with prefix stripped
	for _, env := range os.Environ() {
		if !strings.HasPrefix(env, "STREAMER_") {
			continue
		}
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimPrefix(parts[0], "STREAMER_")
		vars = append(vars, corev1.EnvVar{Name: name, Value: parts[1]})
	}
	return vars
}

func sidecarEnvVars(userID, stageID, bucket string) []corev1.EnvVar {
	optional := boolPtr(true)
	return []corev1.EnvVar{
		{
			Name: "R2_ENDPOINT",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: "r2-credentials"},
					Key:                  "endpoint",
					Optional:             optional,
				},
			},
		},
		{
			Name: "R2_ACCESS_KEY_ID",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: "r2-credentials"},
					Key:                  "access_key_id",
					Optional:             optional,
				},
			},
		},
		{
			Name: "R2_SECRET_ACCESS_KEY",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: "r2-credentials"},
					Key:                  "secret_access_key",
					Optional:             optional,
				},
			},
		},
		{Name: "R2_BUCKET", Value: bucket},
		{Name: "USER_ID", Value: userID},
		{Name: "STAGE_ID", Value: stageID},
	}
}

// mtlsEnvVars injects the mTLS server cert/key/CA into the sidecar container
// from the dazzle-mtls secret. The sidecar uses these to serve mTLS on port 8080.
func mtlsEnvVars() []corev1.EnvVar {
	optional := boolPtr(true)
	mtls := corev1.LocalObjectReference{Name: "dazzle-mtls"}
	return []corev1.EnvVar{
		{
			Name: "TLS_SERVER_CERT",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: mtls, Key: "server.crt", Optional: optional,
				},
			},
		},
		{
			Name: "TLS_SERVER_KEY",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: mtls, Key: "server.key", Optional: optional,
				},
			},
		},
		{
			Name: "TLS_CA_CERT",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: mtls, Key: "ca.crt", Optional: optional,
				},
			},
		},
	}
}

// deleteStage removes the pod (if active) and the DB record.
func (m *Manager) deleteStage(id string) error {
	val, _ := m.activateMu.LoadOrStore(id, &sync.Mutex{})
	mu := val.(*sync.Mutex)
	mu.Lock()
	defer func() {
		mu.Unlock()
		m.activateMu.Delete(id)
	}()

	m.mu.Lock()
	stage, ok := m.stages[id]
	if ok {
		stage.Status = StatusStopping
	}
	m.mu.Unlock()

	// Determine if GPU stage: check in-memory first, fall back to DB capabilities
	isGPU := ok && stage.Provider == "gpu"
	if !isGPU && !ok {
		if row, err := dbGetStage(m.db, id); err == nil && row != nil {
			isGPU = hasCapability(row.Capabilities, "gpu")
		}
	}

	if isGPU {
		// GPU stage: call agent DestroyStage, don't delete local k8s pod
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := m.deactivateGPUStage(ctx, id); err != nil {
			log.Printf("WARN: GPU stage %s cleanup: %v", id, err)
		}
	} else if ok && stage.PodName != "" {
		err := m.clientset.CoreV1().Pods(m.namespace).Delete(context.Background(), stage.PodName, metav1.DeleteOptions{})
		if err != nil {
			log.Printf("WARN: delete pod %s: %v", stage.PodName, err)
		}
	}

	m.mu.Lock()
	if s, ok := m.stages[id]; ok && s.PreviewToken != "" {
		m.invalidatePreviewToken(s.PreviewToken)
	}
	delete(m.stages, id)
	m.mu.Unlock()

	log.Printf("Deleted stage %s", id)
	return nil
}

// deactivateStage tears down the pod but keeps the DB record as inactive.
// Acquires the per-stage activation lock to prevent racing with concurrent activations.
func (m *Manager) deactivateStage(id string) error {
	// Cancel any in-flight activation so it releases the per-stage lock promptly.
	if cancelVal, ok := m.activateCancel.Load(id); ok {
		cancelVal.(context.CancelFunc)()
	}
	val, _ := m.activateMu.LoadOrStore(id, &sync.Mutex{})
	mu := val.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	return m.doDeactivateStage(id)
}

// doDeactivateStage is the inner implementation. Caller must hold the per-stage lock.
func (m *Manager) doDeactivateStage(id string) error {
	m.mu.Lock()
	stage, ok := m.stages[id]
	if ok {
		stage.Status = StatusStopping
	}
	m.mu.Unlock()

	// Determine if GPU stage: check in-memory first, fall back to DB capabilities
	isGPU := ok && stage.Provider == "gpu"
	if !isGPU && !ok {
		if row, err := dbGetStage(m.db, id); err == nil && row != nil {
			isGPU = hasCapability(row.Capabilities, "gpu")
		}
	}

	if isGPU {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := m.deactivateGPUStage(ctx, id); err != nil {
			log.Printf("WARN: GPU stage %s deactivation: %v", id, err)
		}
	} else if ok && stage.PodName != "" {
		err := m.clientset.CoreV1().Pods(m.namespace).Delete(context.Background(), stage.PodName, metav1.DeleteOptions{})
		if err != nil {
			log.Printf("WARN: delete pod %s: %v", stage.PodName, err)
		}
	}

	m.mu.Lock()
	delete(m.stages, id)
	m.mu.Unlock()

	if m.db != nil {
		dbUpdateStageStatus(m.db, id, "inactive", "", "")
	}
	log.Printf("Deactivated stage %s", id)
	return nil
}

// activateStageAsync runs stage activation in a background goroutine.
// On failure it cleans up and resets the stage to inactive.
func (m *Manager) activateStageAsync(stageID, userID string, isGPU bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	m.activateCancel.Store(stageID, cancel)
	defer m.activateCancel.Delete(stageID)

	var err error
	if isGPU {
		_, err = m.activateGPUStage(ctx, stageID, userID)
	} else {
		_, err = m.activateStage(ctx, stageID, userID)
	}
	if err != nil {
		log.Printf("ERROR: async activation failed for stage %s: %v", stageID, err)
		if isGPU {
			m.deactivateStage(stageID)
		}
		// K8s path already calls doDeactivateStage on failure inside activateStage
	}
}

// activateStage creates a pod for an existing inactive stage record.
// On failure (timeout, pod crash, etc.), it cleans up and resets the stage to inactive.
func (m *Manager) activateStage(ctx context.Context, id, userID string) (*Stage, error) {
	// Per-stage lock prevents concurrent activations from racing
	val, _ := m.activateMu.LoadOrStore(id, &sync.Mutex{})
	mu := val.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	// Check if already active (under lock, so no race)
	if stage, ok := m.getStage(id); ok {
		if stage.Status == StatusRunning && stage.PodIP != "" {
			return stage, nil
		}
		if stage.Status == StatusStarting {
			s, err := m.waitForStage(ctx, id)
			if err != nil {
				m.doDeactivateStage(id)
				return nil, err
			}
			return s, nil
		}
	}

	stage, err := m.createStage(id, userID)
	if err != nil {
		return nil, err
	}
	stage.OwnerUserID = userID
	s, err := m.waitForStage(ctx, id)
	if err != nil {
		m.doDeactivateStage(id)
		return nil, err
	}
	// Sync outputs so sidecar starts broadcasting immediately
	m.syncStageOutputsIfRunning(id, userID)
	return s, nil
}

func (m *Manager) getStage(id string) (*Stage, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.stages[id]
	return s, ok
}

func (m *Manager) listStages() []*Stage {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Stage, 0, len(m.stages))
	for _, s := range m.stages {
		out = append(out, s)
	}
	return out
}

// gc cleans up stages stuck in starting state.
func (m *Manager) gc() {
	m.mu.Lock()
	var toDelete []string
	now := time.Now()
	for id, stage := range m.stages {
		if stage.Status == StatusStarting && now.Sub(stage.CreatedAt) > 3*time.Minute {
			log.Printf("GC: stage %s stuck starting for %v, deleting", id, now.Sub(stage.CreatedAt))
			toDelete = append(toDelete, id)
		}
	}
	m.mu.Unlock()

	for _, id := range toDelete {
		_ = m.deactivateStage(id)
	}
}

// refreshPodStatuses updates pod IPs and statuses from k8s.
func (m *Manager) refreshPodStatuses() {
	pods, err := m.clientset.CoreV1().Pods(m.namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: "app=streamer-stage",
	})
	if err != nil {
		log.Printf("WARN: refresh pods: %v", err)
		return
	}

	podMap := make(map[string]*corev1.Pod, len(pods.Items))
	for i := range pods.Items {
		podMap[pods.Items[i].Name] = &pods.Items[i]
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, stage := range m.stages {
		pod, ok := podMap[stage.PodName]
		if !ok {
			continue
		}
		prevStatus := stage.Status
		stage.PodIP = pod.Status.PodIP
		if pod.Status.Phase == corev1.PodRunning {
			for _, cond := range pod.Status.Conditions {
				if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
					stage.Status = StatusRunning
				}
			}
		}
		if pod.Status.Phase == corev1.PodFailed || pod.Status.Phase == corev1.PodSucceeded {
			stage.Status = StatusStopping
		}
		if m.db != nil && stage.Status != prevStatus && stage.Status == StatusRunning {
			dbUpdateStageStatus(m.db, stage.ID, "running", stage.PodName, stage.PodIP)
		}
	}
}

// createStageRecord creates a stage DB record (status=inactive) without provisioning a pod.
// Also creates and links a Dazzle destination for the stage (auto-streaming to Dazzle ingest).
func (m *Manager) createStageRecord(userID, name string, capabilities []string) (*Stage, error) {
	if m.db == nil {
		return nil, fmt.Errorf("database not available")
	}
	id, token, err := dbCreateStage(m.db, userID, name, capabilities)
	if err != nil {
		return nil, err
	}

	// Auto-create a Dazzle destination for this stage (hidden from UI, deleted with stage)
	if err := dbCreateDazzleDestinationForStage(m.db, id, userID); err != nil {
		log.Printf("WARN: failed to create Dazzle destination for stage %s: %v", id, err)
	}

	return &Stage{
		ID:           id,
		Name:         name,
		Status:       StatusInactive,
		OwnerUserID:  userID,
		PreviewToken: token,
		Capabilities: capabilities,
		CreatedAt:    time.Now(),
	}, nil
}

// activateGPUStage creates a GPUStage CR and waits for the controller to assign it to a node.
func (m *Manager) activateGPUStage(ctx context.Context, id, userID string) (*Stage, error) {
	// Per-stage lock prevents concurrent activations from racing
	val, _ := m.activateMu.LoadOrStore(id, &sync.Mutex{})
	mu := val.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	// Check if already active (under lock, so no race)
	if stage, ok := m.getStage(id); ok {
		if stage.Status == StatusRunning && stage.SidecarURL != "" {
			return stage, nil
		}
		if stage.Status == StatusStarting {
			// Already being activated by another goroutine — wait for it
			sidecarURL, err := m.gpuStageController.WaitForRunning(ctx, "stage-"+id)
			if err != nil {
				return nil, err
			}
			stage.Status = StatusRunning
			stage.SidecarURL = sidecarURL
			return stage, nil
		}
	}

	if m.gpuStageController == nil {
		return nil, fmt.Errorf("GPU provisioning not configured")
	}

	// Per-user active GPU stage limit (only counts running/starting, not inactive)
	maxActiveGPU := 1
	if m.db != nil {
		var limit int
		if err := m.db.QueryRow("SELECT max_active_gpu_stages FROM users WHERE id=$1", userID).Scan(&limit); err == nil {
			maxActiveGPU = limit
		}
	}
	m.mu.RLock()
	gpuCount := 0
	for _, s := range m.stages {
		if s.OwnerUserID == userID && s.Provider == "gpu" {
			gpuCount++
		}
	}
	m.mu.RUnlock()
	if gpuCount >= maxActiveGPU {
		return nil, fmt.Errorf("max active GPU stages (%d) reached", maxActiveGPU)
	}

	// Set in-memory stage to starting so GetStage reflects status immediately
	m.mu.Lock()
	m.stages[id] = &Stage{
		ID:          id,
		Status:      StatusStarting,
		OwnerUserID: userID,
		Provider:    "gpu",
		CreatedAt:   time.Now(),
	}
	m.mu.Unlock()

	stageCRName := "stage-" + id
	cr := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "dazzle.fm/v1",
			"kind":       "GPUStage",
			"metadata": map[string]interface{}{
				"name":      stageCRName,
				"namespace": m.namespace,
			},
			"spec": map[string]interface{}{
				"stageId": id,
				"userId":  userID,
			},
		},
	}

	gpuStageGVR := controller.GPUStageGVR()
	_, err := m.dynamicClient.Resource(gpuStageGVR).Namespace(m.namespace).Create(ctx, cr, metav1.CreateOptions{})
	if err != nil && !strings.Contains(err.Error(), "already exists") {
		return nil, fmt.Errorf("create GPUStage CR: %w", err)
	}

	sidecarURL, err := m.gpuStageController.WaitForRunning(ctx, stageCRName)
	if err != nil {
		return nil, err
	}

	stage := &Stage{
		ID:          id,
		Status:      StatusRunning,
		OwnerUserID: userID,
		Provider:    "gpu",
		SidecarURL:  sidecarURL,
		CreatedAt:   time.Now(),
	}

	m.mu.Lock()
	m.stages[id] = stage
	m.mu.Unlock()

	log.Printf("GPU stage %s activated (sidecarURL=%s)", id, sidecarURL)

	// Sync outputs so sidecar starts broadcasting immediately
	m.syncStageOutputsIfRunning(id, userID)

	return stage, nil
}

// deactivateGPUStage deletes the GPUStage CR; the stage controller handles cleanup via finalizer.
func (m *Manager) deactivateGPUStage(ctx context.Context, id string) error {
	if m.gpuStageController == nil {
		return nil
	}
	gpuStageGVR := controller.GPUStageGVR()
	stageCRName := "stage-" + id
	err := m.dynamicClient.Resource(gpuStageGVR).Namespace(m.namespace).Delete(ctx, stageCRName, metav1.DeleteOptions{})
	if err != nil && !strings.Contains(err.Error(), "not found") {
		return fmt.Errorf("delete GPUStage CR %s: %w", stageCRName, err)
	}
	return nil
}

// buildAgentTLSConfig creates TLS config for mTLS agent communication.
func buildAgentTLSConfig() (*tls.Config, error) {
	certB64 := os.Getenv("MTLS_CLIENT_CERT")
	keyB64 := os.Getenv("MTLS_CLIENT_KEY")
	caB64 := os.Getenv("MTLS_CA_CERT")
	if certB64 == "" || keyB64 == "" || caB64 == "" {
		return nil, fmt.Errorf("MTLS_CLIENT_CERT, MTLS_CLIENT_KEY, and MTLS_CA_CERT are all required")
	}

	certPEM, err := decodePEM(certB64)
	if err != nil {
		return nil, fmt.Errorf("decode MTLS_CLIENT_CERT: %w", err)
	}
	keyPEM, err := decodePEM(keyB64)
	if err != nil {
		return nil, fmt.Errorf("decode MTLS_CLIENT_KEY: %w", err)
	}
	caPEM, err := decodePEM(caB64)
	if err != nil {
		return nil, fmt.Errorf("decode MTLS_CA_CERT: %w", err)
	}

	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("load client cert: %w", err)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("parse MTLS_CA_CERT PEM")
	}

	tlsConfig := &tls.Config{
		Certificates:       []tls.Certificate{cert},
		RootCAs:            caPool,
		InsecureSkipVerify: true, // RunPod IPs are dynamic — no matching SANs possible
	}
	// InsecureSkipVerify skips hostname/SAN validation (necessary for dynamic IPs)
	// but we still verify the server cert chain against our CA via VerifyPeerCertificate.
	tlsConfig.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return fmt.Errorf("server presented no certificates")
		}
		serverCert, err := x509.ParseCertificate(rawCerts[0])
		if err != nil {
			return fmt.Errorf("parse server cert: %w", err)
		}
		opts := x509.VerifyOptions{Roots: caPool}
		if _, err := serverCert.Verify(opts); err != nil {
			return fmt.Errorf("server cert not signed by our CA: %w", err)
		}
		return nil
	}

	return tlsConfig, nil
}

// decodePEM accepts either raw PEM or base64-encoded PEM and returns PEM bytes.
func decodePEM(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	// If it starts with "-----BEGIN", it's already raw PEM
	if strings.HasPrefix(s, "-----BEGIN") {
		return []byte(s), nil
	}
	// Otherwise treat as base64-encoded PEM (strip whitespace first)
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		b, err = base64.URLEncoding.DecodeString(s)
	}
	return b, err
}

// stageIsReady returns true if the stage is running and reachable.
func stageIsReady(stage *Stage) bool {
	return stage.Status == StatusRunning && (stage.PodIP != "" || stage.SidecarURL != "")
}

// stageProxyTarget returns the reverse proxy target URL for a stage.
// GPU stages use the SidecarURL (NodePort), local stages use PodIP.
func stageProxyTarget(stage *Stage) *url.URL {
	if stage.SidecarURL != "" {
		// SidecarURL is like http://IP:PORT/_dz_9f7a3b1c — we need the base http://IP:PORT
		base := strings.TrimSuffix(stage.SidecarURL, "/_dz_9f7a3b1c")
		u, _ := url.Parse(base)
		return u
	}
	u, _ := url.Parse(fmt.Sprintf("https://%s:8080", stage.PodIP))
	return u
}

func (m *Manager) handleHealth(w http.ResponseWriter, r *http.Request) {
	resp := map[string]any{"status": "ok"}
	// Authenticated callers get stage details
	token := extractBearerToken(r)
	if token != "" {
		if info, err := m.auth.authenticate(r.Context(), token); err == nil && info != nil {
			m.mu.RLock()
			resp["stages"] = len(m.stages)
			resp["maxStages"] = m.maxStages
			m.mu.RUnlock()
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// waitForStage polls until the stage is running with a PodIP, or context expires.
func (m *Manager) waitForStage(ctx context.Context, id string) (*Stage, error) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		m.refreshPodStatuses()
		stage, ok := m.getStage(id)
		if !ok {
			return nil, fmt.Errorf("stage %s disappeared", id)
		}
		if stage.Status == StatusStopping {
			return nil, fmt.Errorf("stage %s is stopping", id)
		}
		if stage.Status == StatusRunning && stage.PodIP != "" {
			return stage, nil
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timeout waiting for stage %s to become ready", id)
		case <-ticker.C:
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Connect-Protocol-Version")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// spaFileServer serves the web SPA, falling back to index.html for client-side routes.
// Hashed assets (under /assets/) get long-lived cache headers; index.html is never cached.
// If defaultHTML is non-nil, it is served instead of the static index.html (pre-rendered
// from the Go template with default OG meta tags).
func spaFileServer(dir string, defaultHTML []byte) http.Handler {
	fs := http.Dir(dir)
	fileServer := http.FileServer(fs)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		isIndex := path == "/" || path == "/index.html"

		if !isIndex {
			if f, err := fs.Open(path); err == nil {
				f.Close()
				// Hashed assets in /assets/ are immutable
				if len(path) > 8 && path[:8] == "/assets/" {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// Serve index.html (directly or as SPA fallback) — never cache
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		if defaultHTML != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(defaultHTML)
			return
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	mgr, err := NewManager()
	if err != nil {
		log.Fatalf("Failed to create manager: %v", err)
	}

	mux := http.NewServeMux()

	// Health (no auth)
	mux.HandleFunc("/health", mgr.handleHealth)

	// Connect RPC services
	authInterceptor := newAuthInterceptor(mgr.auth)
	clerkOnly := newClerkOnlyInterceptor()

	// StageService — Clerk JWT or API key
	stagePath, stageHandler := apiv1connect.NewStageServiceHandler(
		&stageServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(stagePath, corsMiddleware(stageHandler))

	// FeaturedService — public (no auth)
	featuredPath, featuredHandler := apiv1internalconnect.NewFeaturedServiceHandler(
		&featuredServer{mgr: mgr},
	)
	mux.Handle(featuredPath, corsMiddleware(featuredHandler))

	// ApiKeyService — Clerk JWT only
	apiKeyPath, apiKeyHandler := apiv1internalconnect.NewApiKeyServiceHandler(
		&apiKeyServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(apiKeyPath, corsMiddleware(apiKeyHandler))

	// RtmpDestinationService — Clerk JWT or API key
	streamPath, streamHandler := apiv1connect.NewRtmpDestinationServiceHandler(
		&rtmpDestinationServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(streamPath, corsMiddleware(streamHandler))

	// UserService — Clerk JWT or API key
	userPath, userHandler := apiv1connect.NewUserServiceHandler(
		&userServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(userPath, corsMiddleware(userHandler))

	// RuntimeService — Clerk JWT or API key
	runtimePath, runtimeHandler := apiv1connect.NewRuntimeServiceHandler(
		&runtimeServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(runtimePath, corsMiddleware(runtimeHandler))

	// BroadcastService — Clerk JWT or API key
	broadcastPath, broadcastHandler := apiv1connect.NewBroadcastServiceHandler(
		&broadcastServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(broadcastPath, corsMiddleware(broadcastHandler))

	// CLI session routes (Go 1.22+ pattern matching)
	cliSessionCORS := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next(w, r)
		}
	}
	mux.HandleFunc("POST /auth/cli/session", cliSessionCORS(mgr.handleCreateCliSession))
	mux.HandleFunc("GET /auth/cli/session/{id}/poll", cliSessionCORS(mgr.handlePollCliSession))
	mux.HandleFunc("POST /auth/cli/session/{id}/confirm", cliSessionCORS(mgr.handleConfirmCliSession))
	mux.HandleFunc("GET /auth/cli/session/{id}/info", cliSessionCORS(mgr.handleCliSessionInfo))
	// Handle OPTIONS preflight for all CLI session routes
	mux.HandleFunc("/auth/cli/session/", cliSessionCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodOptions {
			http.NotFound(w, r)
		}
	}))

	// OAuth routes (Go 1.22+ pattern matching)
	oauthCORS := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next(w, r)
		}
	}
	mux.HandleFunc("GET /oauth/{platform}/authorize", oauthCORS(mgr.oauth.handleAuthorize))
	mux.HandleFunc("GET /oauth/{platform}/callback", oauthCORS(mgr.oauth.handleCallback))
	mux.HandleFunc("GET /oauth/{platform}/check", oauthCORS(mgr.oauth.handleCheck))
	mux.HandleFunc("/oauth/", oauthCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodOptions {
			http.NotFound(w, r)
		}
	}))

	// Public watch page: /watch/{slug}/hls/{filename}
	// When a stage is broadcasting, its HLS is publicly viewable (no auth).
	mux.HandleFunc("/watch/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/watch/"), "/", 3)

		// Public thumbnail for OG images
		if len(parts) >= 2 && parts[1] == "thumbnail.png" {
			mgr.handleWatchThumbnail(w, r, parts[0])
			return
		}

		// HLS: /watch/<slug>/index.m3u8, /watch/<slug>/N.ts
		if slug, file, ok := parseWatchHLSPath(r.URL.Path); ok {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			mgr.handleWatchHLS(w, r, slug, file)
			return
		}
		// SPA route for /watch/{slug} — inject OG meta tags for crawlers
		slug := parts[0]
		mgr.serveWatchPage(w, r, slug)
	})

	// Stage handler: /stage/* routes are SPA-only (dashboard pages).
	// All data access goes through ConnectRPC; HLS and thumbnails are served via /watch/.
	spaHandler := spaFileServer("web", mgr.defaultIndexHTML)
	mux.HandleFunc("/stage/", func(w http.ResponseWriter, r *http.Request) {
		spaHandler.ServeHTTP(w, r)
	})

	// CLI installer endpoints.
	// Each detects if the caller meant the other platform and redirects transparently.
	// Uses the CLI submodule commit baked into this build for cache-busting.
	rawBase := "https://raw.githubusercontent.com/dazzle-labs/cli/" + gitCommit + "/"
	isWindows := func(r *http.Request) bool {
		ua := strings.ToLower(r.Header.Get("User-Agent"))
		return strings.Contains(ua, "powershell") || strings.Contains(ua, "windowspowershell")
	}
	mux.HandleFunc("/install.sh", func(w http.ResponseWriter, r *http.Request) {
		if isWindows(r) {
			http.Redirect(w, r, rawBase+"install.ps1", http.StatusMovedPermanently)
			return
		}
		http.Redirect(w, r, rawBase+"install.sh", http.StatusFound)
	})
	mux.HandleFunc("/install.ps1", func(w http.ResponseWriter, r *http.Request) {
		if !isWindows(r) {
			http.Redirect(w, r, rawBase+"install.sh", http.StatusMovedPermanently)
			return
		}
		http.Redirect(w, r, rawBase+"install.ps1", http.StatusFound)
	})

	// Web SPA (fallback route)
	mux.Handle("/", spaFileServer("web", mgr.defaultIndexHTML))

	// Internal server for cluster-only callbacks (not exposed via ingress).
	internalMux := http.NewServeMux()
	internalMux.HandleFunc("POST /rtmp/on_publish", mgr.handleOnPublish)
	internalMux.HandleFunc("POST /rtmp/on_publish_done", mgr.handleOnPublishDone)
	internalPort := envOrDefault("INTERNAL_PORT", "9090")
	go func() {
		internalServer := &http.Server{
			Addr:    ":" + internalPort,
			Handler: internalMux,
		}
		log.Printf("Internal server listening on :%s", internalPort)
		if err := internalServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Internal server error: %v", err)
		}
	}()

	port := envOrDefault("PORT", "8080")
	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	// Start GPU controllers if configured
	ctx, cancel := context.WithCancel(context.Background())
	if mgr.gpuController != nil {
		mgr.gpuController.RecoverNodes(ctx)
		go mgr.gpuController.Start(ctx)
	}
	if mgr.gpuStageController != nil {
		go mgr.gpuStageController.Run(ctx)
	}

	// GC + status refresh loop
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				mgr.refreshPodStatuses()
				mgr.gc()
			case <-ctx.Done():
				return
			}
		}
	}()

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		cancel()
		mgr.db.Close()
		server.Shutdown(context.Background())
	}()

	log.Printf("Control plane listening on :%s (max=%d)",
		port, mgr.maxStages)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}


