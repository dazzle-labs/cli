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

	apiv1connect "github.com/browser-streamer/session-manager/gen/api/v1/apiv1connect"
)

// Ensure compile-time interface satisfaction.
var (
	_ apiv1connect.SessionServiceHandler = (*sessionServer)(nil)
	_ apiv1connect.ApiKeyServiceHandler  = (*apiKeyServer)(nil)
	_ apiv1connect.StreamServiceHandler  = (*streamServer)(nil)
	_ apiv1connect.UserServiceHandler    = (*userServer)(nil)
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
	Status       SessionStatus `json:"status"`
	OwnerUserID  string        `json:"ownerUserId,omitempty"`
}

type Manager struct {
	mu             sync.RWMutex
	sessions       map[string]*Session
	clientset      *kubernetes.Clientset
	namespace      string
	streamerImage  string
	podToken       string // internal token for streamer pod auth
	maxSessions    int
	db             *sql.DB
	auth           *authenticator
	encryptionKey  []byte
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
		sessions:       make(map[string]*Session),
		clientset:      clientset,
		namespace:      envOrDefault("NAMESPACE", "browser-streamer"),
		streamerImage:  envOrDefault("STREAMER_IMAGE", "browser-streamer:latest"),
		podToken:       os.Getenv("POD_TOKEN"),
		maxSessions:    envIntOrDefault("MAX_SESSIONS", 3),
		db:             db,
		auth:           newAuthenticator(db, clerkSecretKey),
		encryptionKey: encKey,
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

		status := StatusStarting
		if pod.Status.Phase == corev1.PodRunning {
			for _, cond := range pod.Status.Conditions {
				if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
					status = StatusRunning
				}
			}
		}

		sess := &Session{
			ID:        sessionID,
			PodName:   pod.Name,
			PodIP:     pod.Status.PodIP,
			CreatedAt: pod.CreationTimestamp.Time,
			Status:    status,
		}

		// Recover owner from session_log in DB
		if m.db != nil {
			var userID string
			var directPort int32
			err := m.db.QueryRow(
				"SELECT user_id, direct_port FROM session_log WHERE id=$1 AND ended_at IS NULL",
				sessionID,
			).Scan(&userID, &directPort)
			if err == nil {
				sess.OwnerUserID = userID
				sess.DirectPort = directPort
			}
		}

		m.sessions[sessionID] = sess
		log.Printf("Recovered session %s (pod=%s, status=%s, owner=%s)", sessionID, pod.Name, status, sess.OwnerUserID)
	}

	log.Printf("Recovered %d sessions", len(m.sessions))
	return nil
}

func (m *Manager) createSession(requestedID string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.sessions) >= m.maxSessions {
		return nil, fmt.Errorf("max sessions (%d) reached", m.maxSessions)
	}

	id := requestedID
	if id == "" {
		id = uuid.New().String()
	} else if _, exists := m.sessions[id]; exists {
		return nil, fmt.Errorf("session %s already exists", id)
	}
	podName := "streamer-" + id[:8]

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: m.namespace,
			Labels: map[string]string{
				"app":          "streamer-session",
				"session-id":   id,
				"managed-by":   "session-manager",
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
		CreatedAt:    now,
		Status:       StatusStarting,
	}
	m.sessions[id] = sess

	log.Printf("Created session %s (pod=%s)", id, podName)
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
	delete(m.sessions, id)
	m.mu.Unlock()

	if m.db != nil {
		dbLogSessionEnd(m.db, id, "deleted")
	}
	log.Printf("Deleted session %s (pod=%s)", id, sess.PodName)
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

// gc cleans up sessions stuck in starting state.
func (m *Manager) gc() {
	m.mu.Lock()
	var toDelete []string
	now := time.Now()
	for id, sess := range m.sessions {
		if sess.Status == StatusStarting && now.Sub(sess.CreatedAt) > 3*time.Minute {
			log.Printf("GC: session %s stuck starting for %v, deleting", id, now.Sub(sess.CreatedAt))
			toDelete = append(toDelete, id)
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

// createSessionForUser creates a session owned by a user.
func (m *Manager) createSessionForUser(userID string) (*Session, error) {
	sess, err := m.createSession("")
	if err != nil {
		return nil, err
	}
	sess.OwnerUserID = userID
	if m.db != nil {
		dbLogSessionCreate(m.db, sess.ID, userID, sess.PodName)
	}
	return sess, nil
}

// listSessionsForUser returns sessions owned by a specific user.
func (m *Manager) listSessionsForUser(userID string) []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var out []*Session
	for _, s := range m.sessions {
		if s.OwnerUserID == userID {
			out = append(out, s)
		}
	}
	return out
}

func (m *Manager) handleHealth(w http.ResponseWriter, r *http.Request) {
	resp := map[string]any{"status": "ok"}
	// Authenticated callers get session details
	token := extractBearerToken(r)
	if token != "" {
		if info, err := m.auth.authenticate(r.Context(), token); err == nil && info != nil {
			m.mu.RLock()
			resp["sessions"] = len(m.sessions)
			resp["maxSessions"] = m.maxSessions
			m.mu.RUnlock()
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (m *Manager) handleSessionProxy(w http.ResponseWriter, r *http.Request) {
	// Parse: /session/:id/api/* or /session/:id/workspace/*
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
	token := extractBearerToken(r)
	info, err := m.auth.authenticate(r.Context(), token)
	if err != nil || info == nil {
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

// waitForSession polls until the session is running with a PodIP, or context expires.
func (m *Manager) waitForSession(ctx context.Context, id string) (*Session, error) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		m.refreshPodStatuses()
		sess, ok := m.getSession(id)
		if !ok {
			return nil, fmt.Errorf("session %s disappeared", id)
		}
		if sess.Status == StatusStopping {
			return nil, fmt.Errorf("session %s is stopping", id)
		}
		if sess.Status == StatusRunning && sess.PodIP != "" {
			return sess, nil
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timeout waiting for session %s to become ready", id)
		case <-ticker.C:
		}
	}
}

// ensureSession returns a running session for the given ID, creating it if necessary.
func (m *Manager) ensureSession(ctx context.Context, id string) (*Session, error) {
	sess, ok := m.getSession(id)
	if ok {
		if sess.Status == StatusRunning && sess.PodIP != "" {
			return sess, nil
		}
		if sess.Status == StatusStarting {
			return m.waitForSession(ctx, id)
		}
		return nil, fmt.Errorf("session %s in unexpected state: %s", id, sess.Status)
	}

	// Create new session with the requested ID
	_, err := m.createSession(id)
	if err != nil {
		// Race: another request already created it
		if strings.Contains(err.Error(), "already exists") {
			return m.waitForSession(ctx, id)
		}
		return nil, err
	}
	return m.waitForSession(ctx, id)
}

// resolveChromeWSURL fetches /json/version from the pod and returns Chrome's actual webSocketDebuggerUrl.
func (m *Manager) resolveChromeWSURL(sess *Session) (string, error) {
	resp, err := http.Get(fmt.Sprintf("http://%s:8080/json/version?token=%s", sess.PodIP, url.QueryEscape(m.podToken)))
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
func (m *Manager) proxyCDPDiscovery(w http.ResponseWriter, r *http.Request, sess *Session, subPath string) {
	podURL := fmt.Sprintf("http://%s:8080%s?token=%s", sess.PodIP, subPath, url.QueryEscape(m.podToken))
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
	deterministicWS := fmt.Sprintf("%s://%s/cdp/%s", wsScheme, extHost, sess.ID)

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

// handleCDP handles /cdp/<uuid> and /cdp/<uuid>/json/* requests.
func (m *Manager) handleCDP(w http.ResponseWriter, r *http.Request) {
	// Parse: /cdp/<uuid> or /cdp/<uuid>/json/...
	trimmed := strings.TrimPrefix(r.URL.Path, "/cdp/")
	parts := strings.SplitN(trimmed, "/", 2)
	sessionID := parts[0]
	if sessionID == "" {
		http.Error(w, `{"error":"session id required"}`, http.StatusBadRequest)
		return
	}

	subPath := ""
	if len(parts) > 1 {
		subPath = "/" + parts[1]
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

	// Auto-provision session
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	sess, err := m.ensureSession(ctx, sessionID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": err.Error()})
		return
	}



	if isWS {
		// WebSocket: resolve Chrome's real WS URL and proxy to it
		chromeWSURL, err := m.resolveChromeWSURL(sess)
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
	m.proxyCDPDiscovery(w, r, sess, subPath)
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

// spaFileServer serves the dashboard SPA, falling back to index.html for client-side routes.
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

	// SessionService — Clerk JWT or API key
	sessionPath, sessionHandler := apiv1connect.NewSessionServiceHandler(
		&sessionServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(sessionPath, corsMiddleware(sessionHandler))

	// ApiKeyService — Clerk JWT only
	apiKeyPath, apiKeyHandler := apiv1connect.NewApiKeyServiceHandler(
		&apiKeyServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(apiKeyPath, corsMiddleware(apiKeyHandler))

	// StreamService — Clerk JWT only
	streamPath, streamHandler := apiv1connect.NewStreamServiceHandler(
		&streamServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(streamPath, corsMiddleware(streamHandler))

	// UserService — Clerk JWT only
	userPath, userHandler := apiv1connect.NewUserServiceHandler(
		&userServer{mgr: mgr},
		connect.WithInterceptors(authInterceptor, clerkOnly),
	)
	mux.Handle(userPath, corsMiddleware(userHandler))

	// CDP auto-provisioning endpoint
	mux.Handle("/cdp/", corsMiddleware(http.HandlerFunc(mgr.handleCDP)))

	// Session proxy (API, workspace, WebSocket)
	mux.HandleFunc("/session/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if isWebSocketUpgrade(r) {
			mgr.handleWebSocketUpgrade(w, r)
			return
		}
		mgr.auth.authMiddlewareHTTP(http.HandlerFunc(mgr.handleSessionProxy)).ServeHTTP(w, r)
	})

	// MCP server (StreamableHTTP) — /mcp/<agent-uuid>/...
	mcpHandler := mgr.mcpMiddleware(mgr.setupMCP())
	mux.Handle("/mcp/", mcpHandler)

	// Dashboard SPA (fallback route)
	mux.Handle("/", spaFileServer("dashboard"))

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

	log.Printf("Session manager listening on :%s (max=%d)",
		port, mgr.maxSessions)
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
