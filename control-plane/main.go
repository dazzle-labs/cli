package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	apiv1connect "github.com/browser-streamer/control-plane/gen/api/v1/apiv1connect"
)

// Ensure compile-time interface satisfaction.
var (
	_ apiv1connect.StageServiceHandler  = (*stageServer)(nil)
	_ apiv1connect.ApiKeyServiceHandler = (*apiKeyServer)(nil)
	_ apiv1connect.RtmpDestinationServiceHandler = (*rtmpDestinationServer)(nil)
	_ apiv1connect.UserServiceHandler   = (*userServer)(nil)
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
	OwnerUserID   string      `json:"ownerUserId,omitempty"`
	DestinationID string      `json:"destinationId,omitempty"`
}

type Manager struct {
	mu            sync.RWMutex
	stages        map[string]*Stage
	clientset     *kubernetes.Clientset
	namespace     string
	streamerImage string
	podToken      string // internal token for streamer pod auth
	maxStages     int
	db            *sql.DB
	auth          *authenticator
	encryptionKey []byte
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

	m := &Manager{
		stages:        make(map[string]*Stage),
		clientset:     clientset,
		namespace:     envOrDefault("NAMESPACE", "browser-streamer"),
		streamerImage: envOrDefault("STREAMER_IMAGE", "browser-streamer:latest"),
		podToken:      os.Getenv("POD_TOKEN"),
		maxStages:     envIntOrDefault("MAX_STAGES", 3),
		db:            db,
		auth:          newAuthenticator(db, clerkSecretKey),
		encryptionKey: encKey,
	}

	if err := m.recoverStages(); err != nil {
		log.Printf("WARN: stage recovery: %v", err)
	}

	return m, nil
}

// recoverStages rebuilds in-memory state from actual k8s pods on restart.
// Any DB stage marked non-inactive that has no corresponding running pod is reset to inactive.
func (m *Manager) recoverStages() error {
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

		// Look up name and owner from DB
		if m.db != nil {
			if row, err := dbGetStage(m.db, stageID); err == nil && row != nil {
				stage.Name = row.Name
				stage.OwnerUserID = row.UserID
			}
		}

		m.stages[stageID] = stage
		log.Printf("Recovered stage %s (pod=%s, status=%s, owner=%s)", stageID, pod.Name, status, stage.OwnerUserID)
	}

	// Reset any DB stages that appear non-inactive but have no running pod
	if m.db != nil {
		rows, err := m.db.Query(`SELECT id FROM stages WHERE status != 'inactive'`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					if _, ok := m.stages[id]; !ok {
						dbUpdateStageStatus(m.db, id, "inactive", "", "")
						log.Printf("Reset stale stage %s to inactive (no pod found)", id)
					}
				}
			}
		}
	}

	log.Printf("Recovered %d active stages", len(m.stages))
	return nil
}

func (m *Manager) createStage(requestedID string) (*Stage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.stages) >= m.maxStages {
		return nil, fmt.Errorf("max stages (%d) reached", m.maxStages)
	}

	id := requestedID
	if id == "" {
		id = uuid.New().String()
	} else if _, exists := m.stages[id]; exists {
		return nil, fmt.Errorf("stage %s already exists", id)
	}
	podName := "streamer-" + id[:8]

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
			RestartPolicy: corev1.RestartPolicyNever,
			Containers: []corev1.Container{
				{
					Name:  "streamer",
					Image: m.streamerImage,
					Ports: []corev1.ContainerPort{
						{
							ContainerPort: 8080,
							Protocol:      corev1.ProtocolTCP,
						},
					},
					Env: []corev1.EnvVar{
						{
							Name: "TOKEN",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: "browserless-auth"},
									Key:                  "token",
								},
							},
						},
					},
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("2"),
							corev1.ResourceMemory: resource.MustParse("4Gi"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("4"),
							corev1.ResourceMemory: resource.MustParse("8Gi"),
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{Name: "dshm", MountPath: "/dev/shm"},
						{Name: "runtime-scripts", MountPath: "/app/runtime", ReadOnly: true},
					},
					ReadinessProbe: &corev1.Probe{
						ProbeHandler: corev1.ProbeHandler{
							HTTPGet: &corev1.HTTPGetAction{
								Path: "/health",
								Port: intstr.FromInt(8080),
							},
						},
						InitialDelaySeconds: 2,
						PeriodSeconds:       2,
						FailureThreshold:    30,
					},
					ImagePullPolicy: corev1.PullNever,
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
				runtimeScriptsVolume(),
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

// runtimeScriptsVolume returns a hostPath volume when RUNTIME_HOSTPATH is set
// (for local Kind dev — reads files directly from the host), otherwise a ConfigMap volume.
func runtimeScriptsVolume() corev1.Volume {
	if hp := os.Getenv("RUNTIME_HOSTPATH"); hp != "" {
		hostPathDir := corev1.HostPathDirectory
		return corev1.Volume{
			Name: "runtime-scripts",
			VolumeSource: corev1.VolumeSource{
				HostPath: &corev1.HostPathVolumeSource{
					Path: hp,
					Type: &hostPathDir,
				},
			},
		}
	}
	return corev1.Volume{
		Name: "runtime-scripts",
		VolumeSource: corev1.VolumeSource{
			ConfigMap: &corev1.ConfigMapVolumeSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: "runtime-scripts"},
			},
		},
	}
}

// deleteStage removes the pod (if active) and the DB record.
func (m *Manager) deleteStage(id string) error {
	m.mu.Lock()
	stage, ok := m.stages[id]
	if ok {
		stage.Status = StatusStopping
	}
	m.mu.Unlock()

	if ok && stage.PodName != "" {
		err := m.clientset.CoreV1().Pods(m.namespace).Delete(context.Background(), stage.PodName, metav1.DeleteOptions{})
		if err != nil {
			log.Printf("WARN: delete pod %s: %v", stage.PodName, err)
		}
	}

	m.mu.Lock()
	delete(m.stages, id)
	m.mu.Unlock()

	log.Printf("Deleted stage %s", id)
	return nil
}

// deactivateStage tears down the pod but keeps the DB record as inactive.
func (m *Manager) deactivateStage(id string) error {
	m.mu.Lock()
	stage, ok := m.stages[id]
	if ok {
		stage.Status = StatusStopping
	}
	m.mu.Unlock()

	if ok && stage.PodName != "" {
		err := m.clientset.CoreV1().Pods(m.namespace).Delete(context.Background(), stage.PodName, metav1.DeleteOptions{})
		if err != nil {
			log.Printf("WARN: delete pod %s: %v", stage.PodName, err)
		}
	}

	m.mu.Lock()
	delete(m.stages, id)
	m.mu.Unlock()

	clearBootstrapped(id)

	if m.db != nil {
		dbUpdateStageStatus(m.db, id, "inactive", "", "")
	}
	log.Printf("Deactivated stage %s", id)
	return nil
}

// activateStage creates a pod for an existing inactive stage record.
func (m *Manager) activateStage(ctx context.Context, id, userID string) (*Stage, error) {
	// Check if already active
	if stage, ok := m.getStage(id); ok {
		if stage.Status == StatusRunning && stage.PodIP != "" {
			return stage, nil
		}
		if stage.Status == StatusStarting {
			return m.waitForStage(ctx, id)
		}
	}

	stage, err := m.createStage(id)
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			return m.waitForStage(ctx, id)
		}
		return nil, err
	}
	stage.OwnerUserID = userID
	return m.waitForStage(ctx, id)
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
		_ = m.deleteStage(id)
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
func (m *Manager) createStageRecord(userID, name string) (*Stage, error) {
	if m.db == nil {
		return nil, fmt.Errorf("database not available")
	}
	id, err := dbCreateStage(m.db, userID, name)
	if err != nil {
		return nil, err
	}
	return &Stage{
		ID:          id,
		Name:        name,
		Status:      StatusInactive,
		OwnerUserID: userID,
		CreatedAt:   time.Now(),
	}, nil
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

func (m *Manager) handleStageProxy(w http.ResponseWriter, r *http.Request) {
	// Parse: /stage/:id/api/* or /stage/:id/workspace/*
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/stage/"), "/", 2)
	if len(parts) < 2 {
		http.Error(w, "invalid stage path", http.StatusBadRequest)
		return
	}
	stageID := parts[0]
	remainder := "/" + parts[1]

	stage, ok := m.getStage(stageID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "stage not found"})
		return
	}
	if stage.PodIP == "" || stage.Status != StatusRunning {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "stage not ready", "status": string(stage.Status)})
		return
	}

	target, _ := url.Parse(fmt.Sprintf("http://%s:8080", stage.PodIP))
	proxy := httputil.NewSingleHostReverseProxy(target)
	r.URL.Path = remainder
	r.Host = target.Host

	// Strip client auth — the control plane already validated the user,
	// and the streamer pod doesn't understand Clerk JWTs.
	r.Header.Del("Authorization")

	proxy.ServeHTTP(w, r)
}

func (m *Manager) handleWebSocketUpgrade(w http.ResponseWriter, r *http.Request) {
	// Parse stage ID from /stage/:id path
	path := strings.TrimPrefix(r.URL.Path, "/stage/")
	stageID := strings.SplitN(path, "/", 2)[0]
	if stageID == "" {
		http.Error(w, "stage id required", http.StatusBadRequest)
		return
	}

	// Auth check
	token := extractBearerToken(r)
	info, err := m.auth.authenticate(r.Context(), token)
	if err != nil || info == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	stage, ok := m.getStage(stageID)
	if !ok {
		http.Error(w, "stage not found", http.StatusNotFound)
		return
	}
	if stage.PodIP == "" || stage.Status != StatusRunning {
		http.Error(w, "stage not ready", http.StatusServiceUnavailable)
		return
	}

	// Proxy WebSocket to pod's CDP port
	target, _ := url.Parse(fmt.Sprintf("http://%s:8080", stage.PodIP))
	proxy := httputil.NewSingleHostReverseProxy(target)
	// Strip the /stage/:id prefix, forward the rest (or just /)
	parts := strings.SplitN(path, "/", 2)
	if len(parts) > 1 {
		r.URL.Path = "/" + parts[1]
	} else {
		r.URL.Path = "/"
	}
	r.Host = target.Host

	// For WebSocket, we need a custom FlushInterval
	proxy.FlushInterval = -1
	proxy.ServeHTTP(w, r)
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

// resolveChromeWSURL fetches /json/version from the pod and returns Chrome's actual webSocketDebuggerUrl.
func (m *Manager) resolveChromeWSURL(stage *Stage) (string, error) {
	resp, err := http.Get(fmt.Sprintf("http://%s:8080/json/version?token=%s", stage.PodIP, url.QueryEscape(m.podToken)))
	if err != nil {
		return "", fmt.Errorf("fetch /json/version from pod: %w", err)
	}
	defer resp.Body.Close()
	var info map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", fmt.Errorf("decode /json/version: %w", err)
	}
	wsURL, ok := info["webSocketDebuggerUrl"].(string)
	if !ok || wsURL == "" {
		return "", fmt.Errorf("no webSocketDebuggerUrl in /json/version response")
	}
	return wsURL, nil
}

// proxyCDPDiscovery proxies /json/* requests to the pod, rewriting webSocketDebuggerUrl.
func (m *Manager) proxyCDPDiscovery(w http.ResponseWriter, r *http.Request, stage *Stage, subPath string) {
	podURL := fmt.Sprintf("http://%s:8080%s?token=%s", stage.PodIP, subPath, url.QueryEscape(m.podToken))
	resp, err := http.Get(podURL)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("pod request failed: %v", err)})
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "failed to read pod response"})
		return
	}

	// Rewrite webSocketDebuggerUrl to our deterministic URL
	extHost := r.Host
	wsScheme := "ws"
	if r.Header.Get("X-Forwarded-Proto") == "https" || r.TLS != nil {
		wsScheme = "wss"
	}
	deterministicWS := fmt.Sprintf("%s://%s/stage/%s/cdp", wsScheme, extHost, stage.ID)

	// Replace any webSocketDebuggerUrl value in the JSON
	bodyStr := string(body)
	// Handle both /json/version (object) and /json (array) responses
	// The URL pattern is ws://anything/devtools/browser/something or ws://anything/devtools/page/something
	rewritten := strings.NewReplacer().Replace(bodyStr) // identity
	// Simple approach: find and replace the ws:// URL in the JSON
	start := 0
	for {
		idx := strings.Index(rewritten[start:], `"webSocketDebuggerUrl"`)
		if idx == -1 {
			break
		}
		idx += start
		// Find the value after the key
		colonIdx := strings.Index(rewritten[idx:], ":")
		if colonIdx == -1 {
			break
		}
		colonIdx += idx
		// Find the opening quote of the value
		openQuote := strings.Index(rewritten[colonIdx:], `"`)
		if openQuote == -1 {
			break
		}
		openQuote += colonIdx
		// Find the closing quote
		closeQuote := strings.Index(rewritten[openQuote+1:], `"`)
		if closeQuote == -1 {
			break
		}
		closeQuote += openQuote + 1
		rewritten = rewritten[:openQuote+1] + deterministicWS + rewritten[closeQuote:]
		start = openQuote + 1 + len(deterministicWS) + 1
	}

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.WriteHeader(resp.StatusCode)
	w.Write([]byte(rewritten))
}

// handleCDP handles /stage/<uuid>/cdp and /stage/<uuid>/cdp/json/* requests.
func (m *Manager) handleCDP(w http.ResponseWriter, r *http.Request) {
	// Parse: /stage/<uuid>/cdp or /stage/<uuid>/cdp/json/...
	trimmed := strings.TrimPrefix(r.URL.Path, "/stage/")
	parts := strings.SplitN(trimmed, "/", 3) // ["<uuid>", "cdp", "json/..."]
	stageID := parts[0]
	if stageID == "" || len(parts) < 2 {
		http.Error(w, `{"error":"stage id required"}`, http.StatusBadRequest)
		return
	}

	subPath := ""
	if len(parts) > 2 {
		subPath = "/" + parts[2]
	}

	isWS := isWebSocketUpgrade(r)

	// Auth required for all requests
	token := extractBearerToken(r)
	authInfo, authErr := m.auth.authenticate(r.Context(), token)
	if authErr != nil || authInfo == nil {
		if isWS {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		} else {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized"}`))
		}
		return
	}

	stage, ok := m.getStage(stageID)
	if !ok || stage.PodIP == "" || stage.Status != StatusRunning {
		status := "inactive"
		if ok {
			status = string(stage.Status)
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "stage not active — call start first", "status": status})
		return
	}

	if isWS {
		// WebSocket: resolve Chrome's real WS URL and proxy to it
		chromeWSURL, err := m.resolveChromeWSURL(stage)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		m.proxyCDPWebSocket(w, r, chromeWSURL)
		return
	}

	// HTTP: proxy /json* discovery endpoints with URL rewriting
	if subPath == "" {
		subPath = "/json/version"
	}
	m.proxyCDPDiscovery(w, r, stage, subPath)
}

// proxyCDPWebSocket proxies a WebSocket connection to Chrome's CDP endpoint.
func (m *Manager) proxyCDPWebSocket(w http.ResponseWriter, r *http.Request, chromeWSURL string) {
	// Parse the Chrome WS URL to get host and path
	parsed, err := url.Parse(chromeWSURL)
	if err != nil {
		http.Error(w, "invalid chrome ws url", http.StatusInternalServerError)
		return
	}

	// Connect to Chrome's CDP WebSocket
	targetAddr := parsed.Host
	if !strings.Contains(targetAddr, ":") {
		targetAddr += ":80"
	}
	targetConn, err := net.DialTimeout("tcp", targetAddr, 10*time.Second)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to connect to chrome: %v", err), http.StatusBadGateway)
		return
	}

	// Hijack the client connection
	hj, ok := w.(http.Hijacker)
	if !ok {
		targetConn.Close()
		http.Error(w, "websocket hijack not supported", http.StatusInternalServerError)
		return
	}
	clientConn, clientBuf, err := hj.Hijack()
	if err != nil {
		targetConn.Close()
		http.Error(w, fmt.Sprintf("hijack failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Send WebSocket upgrade request to Chrome (add token for pod auth)
	reqURI := parsed.RequestURI()
	if m.podToken != "" {
		if strings.Contains(reqURI, "?") {
			reqURI += "&token=" + url.QueryEscape(m.podToken)
		} else {
			reqURI += "?token=" + url.QueryEscape(m.podToken)
		}
	}
	upgradeReq := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n", reqURI, parsed.Host)
	for _, key := range []string{"Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol"} {
		if v := r.Header.Get(key); v != "" {
			upgradeReq += fmt.Sprintf("%s: %s\r\n", key, v)
		}
	}
	upgradeReq += "\r\n"
	targetConn.Write([]byte(upgradeReq))

	// Read Chrome's upgrade response and forward to client
	// Read until we get the \r\n\r\n end of headers
	targetBuf := make([]byte, 4096)
	n, err := targetConn.Read(targetBuf)
	if err != nil {
		clientConn.Close()
		targetConn.Close()
		return
	}
	clientConn.Write(targetBuf[:n])

	// Flush any buffered data from the client
	if clientBuf.Reader.Buffered() > 0 {
		buffered := make([]byte, clientBuf.Reader.Buffered())
		clientBuf.Read(buffered)
		targetConn.Write(buffered)
	}

	// Bidirectional copy
	done := make(chan struct{})
	go func() {
		io.Copy(targetConn, clientConn)
		targetConn.Close()
		close(done)
	}()
	io.Copy(clientConn, targetConn)
	clientConn.Close()
	<-done
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
func spaFileServer(dir string) http.Handler {
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

	// ApiKeyService — Clerk JWT only
	apiKeyPath, apiKeyHandler := apiv1connect.NewApiKeyServiceHandler(
		&apiKeyServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(apiKeyPath, corsMiddleware(apiKeyHandler))

	// RtmpDestinationService — Clerk JWT only
	streamPath, streamHandler := apiv1connect.NewRtmpDestinationServiceHandler(
		&rtmpDestinationServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(streamPath, corsMiddleware(streamHandler))

	// UserService — Clerk JWT only
	userPath, userHandler := apiv1connect.NewUserServiceHandler(
		&userServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(userPath, corsMiddleware(userHandler))

	// Stage handler: all stage-specific routes under /stage/<uuid>/
	//   /stage/<uuid>/cdp           — CDP WebSocket proxy and HTTP discovery
	//   /stage/<uuid>/cdp/json/*    — CDP discovery (URL-rewritten)
	//   /stage/<uuid>/mcp/*         — MCP server
	//   /stage/<uuid>/*             — reverse proxy to streamer pod
	mcpHandler := mgr.mcpMiddleware(mgr.setupMCP())
	mux.HandleFunc("/stage/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// Extract the third path segment: /stage/<uuid>/<segment>/...
		// parts[0]="", parts[1]="stage", parts[2]="<uuid>", parts[3]="<segment>", ...
		parts := strings.SplitN(r.URL.Path, "/", 5)
		var segment string
		if len(parts) >= 4 {
			segment = parts[3]
		}
		switch segment {
		case "cdp":
			corsMiddleware(http.HandlerFunc(mgr.handleCDP)).ServeHTTP(w, r)
		case "mcp":
			mcpHandler.ServeHTTP(w, r)
		default:
			if isWebSocketUpgrade(r) {
				mgr.handleWebSocketUpgrade(w, r)
				return
			}
			mgr.auth.authMiddlewareHTTP(http.HandlerFunc(mgr.handleStageProxy)).ServeHTTP(w, r)
		}
	})

	// Web SPA (fallback route)
	mux.Handle("/", spaFileServer("web"))

	port := envOrDefault("PORT", "8080")
	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	// GC + status refresh loop
	ctx, cancel := context.WithCancel(context.Background())
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

func isWebSocketUpgrade(r *http.Request) bool {
	for _, v := range r.Header["Connection"] {
		if strings.EqualFold(v, "upgrade") {
			return true
		}
	}
	return false
}
