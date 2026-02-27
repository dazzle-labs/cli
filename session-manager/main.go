package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
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

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type SessionStatus string

const (
	StatusStarting SessionStatus = "starting"
	StatusRunning  SessionStatus = "running"
	StatusStopping SessionStatus = "stopping"
)

type Session struct {
	ID           string        `json:"id"`
	PodName      string        `json:"podName"`
	PodIP        string        `json:"podIP,omitempty"`
	DirectPort   int32         `json:"directPort"`
	CreatedAt    time.Time     `json:"createdAt"`
	LastActivity time.Time     `json:"lastActivity"`
	Status       SessionStatus `json:"status"`
}

type Manager struct {
	mu             sync.RWMutex
	sessions       map[string]*Session
	usedPorts      map[int32]string // port -> sessionID
	clientset      *kubernetes.Clientset
	namespace      string
	streamerImage  string
	token          string
	maxSessions    int
	idleTimeout    time.Duration
	portRangeStart int32
	portRangeEnd   int32
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

	idleMin := envIntOrDefault("IDLE_TIMEOUT", 10)

	m := &Manager{
		sessions:       make(map[string]*Session),
		usedPorts:      make(map[int32]string),
		clientset:      clientset,
		namespace:      envOrDefault("NAMESPACE", "browser-streamer"),
		streamerImage:  envOrDefault("STREAMER_IMAGE", "browser-streamer:latest"),
		token:          os.Getenv("TOKEN"),
		maxSessions:    envIntOrDefault("MAX_SESSIONS", 3),
		idleTimeout:    time.Duration(idleMin) * time.Minute,
		portRangeStart: int32(envIntOrDefault("PORT_RANGE_START", 31000)),
		portRangeEnd:   int32(envIntOrDefault("PORT_RANGE_END", 31099)),
	}

	if err := m.recoverSessions(); err != nil {
		log.Printf("WARN: session recovery: %v", err)
	}

	return m, nil
}

// recoverSessions rebuilds state from existing pods on manager restart.
func (m *Manager) recoverSessions() error {
	pods, err := m.clientset.CoreV1().Pods(m.namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: "app=streamer-session",
	})
	if err != nil {
		return err
	}

	for i := range pods.Items {
		pod := &pods.Items[i]
		sessionID := pod.Labels["session-id"]
		if sessionID == "" {
			continue
		}

		var hostPort int32
		for _, c := range pod.Spec.Containers {
			for _, p := range c.Ports {
				if p.ContainerPort == 8080 && p.HostPort != 0 {
					hostPort = p.HostPort
				}
			}
		}
		if hostPort == 0 {
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

		sess := &Session{
			ID:           sessionID,
			PodName:      pod.Name,
			PodIP:        pod.Status.PodIP,
			DirectPort:   hostPort,
			CreatedAt:    pod.CreationTimestamp.Time,
			LastActivity: time.Now(),
			Status:       status,
		}
		m.sessions[sessionID] = sess
		m.usedPorts[hostPort] = sessionID
		log.Printf("Recovered session %s (pod=%s, port=%d, status=%s)", sessionID, pod.Name, hostPort, status)
	}

	log.Printf("Recovered %d sessions", len(m.sessions))
	return nil
}

func (m *Manager) nextFreePort() (int32, bool) {
	for p := m.portRangeStart; p <= m.portRangeEnd; p++ {
		if _, used := m.usedPorts[p]; !used {
			return p, true
		}
	}
	return 0, false
}

func (m *Manager) createSession() (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.sessions) >= m.maxSessions {
		return nil, fmt.Errorf("max sessions (%d) reached", m.maxSessions)
	}

	port, ok := m.nextFreePort()
	if !ok {
		return nil, fmt.Errorf("no free ports in range %d-%d", m.portRangeStart, m.portRangeEnd)
	}

	id := uuid.New().String()
	podName := "streamer-" + id[:8]

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: m.namespace,
			Labels: map[string]string{
				"app":        "streamer-session",
				"session-id": id,
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
							HostPort:      port,
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
							corev1.ResourceCPU:    resource.MustParse("1"),
							corev1.ResourceMemory: resource.MustParse("2Gi"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("2"),
							corev1.ResourceMemory: resource.MustParse("6Gi"),
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{Name: "dshm", MountPath: "/dev/shm"},
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
			},
		},
	}

	_, err := m.clientset.CoreV1().Pods(m.namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("create pod: %w", err)
	}

	now := time.Now()
	sess := &Session{
		ID:           id,
		PodName:      podName,
		DirectPort:   port,
		CreatedAt:    now,
		LastActivity: now,
		Status:       StatusStarting,
	}
	m.sessions[id] = sess
	m.usedPorts[port] = id

	log.Printf("Created session %s (pod=%s, port=%d)", id, podName, port)
	return sess, nil
}

func resourcePtr(r resource.Quantity) *resource.Quantity {
	return &r
}

func (m *Manager) deleteSession(id string) error {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("session %s not found", id)
	}
	sess.Status = StatusStopping
	m.mu.Unlock()

	err := m.clientset.CoreV1().Pods(m.namespace).Delete(context.Background(), sess.PodName, metav1.DeleteOptions{})
	if err != nil {
		log.Printf("WARN: delete pod %s: %v", sess.PodName, err)
	}

	m.mu.Lock()
	delete(m.usedPorts, sess.DirectPort)
	delete(m.sessions, id)
	m.mu.Unlock()

	log.Printf("Deleted session %s (pod=%s, port=%d)", id, sess.PodName, sess.DirectPort)
	return nil
}

func (m *Manager) getSession(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

func (m *Manager) listSessions() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

func (m *Manager) touchSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[id]; ok {
		s.LastActivity = time.Now()
	}
}

// gc runs periodically to clean up idle and stuck sessions.
func (m *Manager) gc() {
	m.mu.Lock()
	var toDelete []string
	now := time.Now()
	for id, sess := range m.sessions {
		switch sess.Status {
		case StatusRunning:
			if now.Sub(sess.LastActivity) > m.idleTimeout {
				log.Printf("GC: session %s idle for %v, deleting", id, now.Sub(sess.LastActivity))
				toDelete = append(toDelete, id)
			}
		case StatusStarting:
			if now.Sub(sess.CreatedAt) > 3*time.Minute {
				log.Printf("GC: session %s stuck starting for %v, deleting", id, now.Sub(sess.CreatedAt))
				toDelete = append(toDelete, id)
			}
		}
	}
	m.mu.Unlock()

	for _, id := range toDelete {
		_ = m.deleteSession(id)
	}
}

// refreshPodStatuses updates pod IPs and statuses from k8s.
func (m *Manager) refreshPodStatuses() {
	pods, err := m.clientset.CoreV1().Pods(m.namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: "app=streamer-session",
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

	for _, sess := range m.sessions {
		pod, ok := podMap[sess.PodName]
		if !ok {
			continue
		}
		sess.PodIP = pod.Status.PodIP
		if pod.Status.Phase == corev1.PodRunning {
			for _, cond := range pod.Status.Conditions {
				if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
					sess.Status = StatusRunning
				}
			}
		}
		if pod.Status.Phase == corev1.PodFailed || pod.Status.Phase == corev1.PodSucceeded {
			sess.Status = StatusStopping
		}
	}
}

func (m *Manager) checkAuth(r *http.Request) bool {
	if m.token == "" {
		return true
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(m.token)) == 1
}

func (m *Manager) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !m.checkAuth(r) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		next(w, r)
	}
}

func (m *Manager) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Basic health for k8s probes (no auth needed)
	resp := map[string]any{"status": "ok"}
	// Authenticated callers get session details
	if m.checkAuth(r) {
		m.mu.RLock()
		resp["sessions"] = len(m.sessions)
		resp["maxSessions"] = m.maxSessions
		m.mu.RUnlock()
	}
	writeJSON(w, http.StatusOK, resp)
}

func (m *Manager) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess, err := m.createSession()
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, sess)
}

func (m *Manager) handleListSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, m.listSessions())
}

func (m *Manager) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/session/")
	if id == "" {
		http.Error(w, `{"error":"session id required"}`, http.StatusBadRequest)
		return
	}
	if err := m.deleteSession(id); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func (m *Manager) handleSessionProxy(w http.ResponseWriter, r *http.Request) {
	// Parse: /session/:id/hls/* or /session/:id/api/*
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/session/"), "/", 2)
	if len(parts) < 2 {
		http.Error(w, "invalid session path", http.StatusBadRequest)
		return
	}
	sessionID := parts[0]
	remainder := "/" + parts[1]

	sess, ok := m.getSession(sessionID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "session not found"})
		return
	}
	if sess.PodIP == "" || sess.Status != StatusRunning {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "session not ready", "status": string(sess.Status)})
		return
	}

	m.touchSession(sessionID)

	target, _ := url.Parse(fmt.Sprintf("http://%s:8080", sess.PodIP))
	proxy := httputil.NewSingleHostReverseProxy(target)
	r.URL.Path = remainder
	r.Host = target.Host

	// Pass token through to the streamer pod
	proxy.ServeHTTP(w, r)
}

func (m *Manager) handleWebSocketUpgrade(w http.ResponseWriter, r *http.Request) {
	// Parse session ID from /session/:id path
	path := strings.TrimPrefix(r.URL.Path, "/session/")
	sessionID := strings.SplitN(path, "/", 2)[0]
	if sessionID == "" {
		http.Error(w, "session id required", http.StatusBadRequest)
		return
	}

	// Auth check
	if !m.checkAuth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sess, ok := m.getSession(sessionID)
	if !ok {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if sess.PodIP == "" || sess.Status != StatusRunning {
		http.Error(w, "session not ready", http.StatusServiceUnavailable)
		return
	}

	m.touchSession(sessionID)

	// Proxy WebSocket to pod's CDP port
	target, _ := url.Parse(fmt.Sprintf("http://%s:8080", sess.PodIP))
	proxy := httputil.NewSingleHostReverseProxy(target)
	// Strip the /session/:id prefix, forward the rest (or just /)
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
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

	// CORS preflight
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Route API calls
		switch {
		case r.URL.Path == "/api/session" && r.Method == http.MethodPost:
			mgr.authMiddleware(mgr.handleCreateSession)(w, r)
		case r.URL.Path == "/api/sessions":
			mgr.authMiddleware(mgr.handleListSessions)(w, r)
		case strings.HasPrefix(r.URL.Path, "/api/session/") && r.Method == http.MethodDelete:
			mgr.authMiddleware(mgr.handleDeleteSession)(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	// Session proxy (HLS, API, WebSocket)
	mux.HandleFunc("/session/", func(w http.ResponseWriter, r *http.Request) {
		// CORS preflight
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// WebSocket upgrade
		if isWebSocketUpgrade(r) {
			mgr.handleWebSocketUpgrade(w, r)
			return
		}
		// Add CORS headers to all proxied responses
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		// Regular HTTP proxy
		mgr.authMiddleware(mgr.handleSessionProxy)(w, r)
	})

	// Viewer page
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		f, err := os.Open("viewer.html")
		if err != nil {
			http.Error(w, "viewer.html not found", http.StatusNotFound)
			return
		}
		defer f.Close()
		io.Copy(w, f)
	})

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
		server.Shutdown(context.Background())
	}()

	log.Printf("Session manager listening on :%s (max=%d, idle=%v, ports=%d-%d)",
		port, mgr.maxSessions, mgr.idleTimeout, mgr.portRangeStart, mgr.portRangeEnd)
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
