package agent

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	sidecarv1connect "github.com/browser-streamer/sidecar/gen/api/v1/sidecarv1connect"
)

const (
	// AgentPort is the management API port.
	AgentPort = 60443
	// BaseStagePort is the first port allocated to stages.
	BaseStagePort = 60444
	// BaseDisplay is the first Xvfb display number allocated to stages.
	BaseDisplay = 100
)

// Agent manages multiple isolated stage process groups on a single GPU node.
// Isolation is process-level: each stage gets its own Xvfb display, Chrome
// instance, sidecar, data directory, and port. No kernel namespaces are
// required, making this compatible with unprivileged container environments
// like RunPod.
type Agent struct {
	mu        sync.Mutex
	maxStages int
	slots     []*stageSlot // indexed by slot number
	stages    map[string]*stageSlot // stageID -> slot

	// mTLS server config
	tlsConfig *tls.Config
	// Supplementary GIDs for GPU device access (discovered at startup)
	gpuGIDs []uint32
	// GPU device index (e.g. "4" for /dev/nvidia4) for NVENC hwaccel_device
	gpuDeviceIndex string
}

// stageSlot tracks a stage occupying a particular slot.
type stageSlot struct {
	slotIndex int
	hostPort  int
	display   string // e.g. ":100"
	uid       int    // dedicated UID for process isolation (BaseUID + slotIndex)
	stageID   string
	userID    string
	status    string // "starting", "running", "failed"
	process   *stageProcess
}

// New creates an Agent with the given max stage capacity.
func New(maxStages int) *Agent {
	slots := make([]*stageSlot, maxStages)
	return &Agent{
		maxStages: maxStages,
		slots:     slots,
		stages:    make(map[string]*stageSlot),
	}
}

// detectGPUDeviceIndex returns the NVIDIA device index visible in the container.
// On multi-GPU RunPod hosts, the container may get /dev/nvidia4 instead of
// /dev/nvidia0. NVENC needs the correct device index passed via -hwaccel_device.
// Returns "0" as fallback if no device is found.
func detectGPUDeviceIndex() string {
	matches, _ := filepath.Glob("/dev/nvidia[0-9]*")
	for _, dev := range matches {
		name := filepath.Base(dev)
		idx := strings.TrimPrefix(name, "nvidia")
		if idx != "" && idx != "ctl" {
			log.Printf("Detected GPU device index: %s (%s)", idx, dev)
			return idx
		}
	}
	return "0"
}

// gpuDeviceGIDs returns the set of unique group IDs that own GPU device files.
// Stage processes are launched with these as supplementary groups so non-root
// UIDs can access the GPU.
func gpuDeviceGIDs() []uint32 {
	seen := make(map[uint32]bool)
	patterns := []string{"/dev/nvidia*", "/dev/dri/*"}
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, dev := range matches {
			info, err := os.Stat(dev)
			if err != nil {
				continue
			}
			if stat, ok := info.Sys().(*syscall.Stat_t); ok && stat.Gid != 0 {
				seen[stat.Gid] = true
			}
		}
	}
	var gids []uint32
	for gid := range seen {
		gids = append(gids, gid)
	}
	if len(gids) > 0 {
		log.Printf("GPU device GIDs: %v", gids)
	}
	return gids
}

// Run starts the agent management API server. Blocks until the server exits.
func (a *Agent) Run() error {
	// Discover GPU device group IDs for supplementary groups on stage processes
	a.gpuGIDs = gpuDeviceGIDs()
	// Detect GPU device index for NVENC (workaround for multi-GPU device mismatch)
	a.gpuDeviceIndex = detectGPUDeviceIndex()

	mux := http.NewServeMux()

	// Register AgentService RPC handlers — mTLS (RequireAndVerifyClientCert) is the auth gate
	path, handler := sidecarv1connect.NewAgentServiceHandler(newRPCHandler(a))
	mux.Handle(path, handler)

	// Health endpoint — always returns OK; internal details only over verified mTLS
	mux.HandleFunc("/_dz_9f7a3b1c/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if r.TLS != nil && len(r.TLS.VerifiedChains) > 0 {
			fmt.Fprintf(w, `{"ok":true,"maxStages":%d,"currentStages":%d}`, a.maxStages, a.currentStageCount())
		} else {
			fmt.Fprintf(w, `{"ok":true}`)
		}
	})

	addr := fmt.Sprintf(":%d", AgentPort)

	if a.tlsConfig != nil {
		ln, err := tls.Listen("tcp", addr, a.tlsConfig)
		if err != nil {
			return fmt.Errorf("tls listen: %w", err)
		}
		log.Printf("Agent listening on %s (mTLS, max_stages=%d)", addr, a.maxStages)
		return http.Serve(ln, mux)
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	log.Printf("Agent listening on %s (no TLS, max_stages=%d)", addr, a.maxStages)
	return http.Serve(ln, mux)
}

// ConfigureTLS sets up mTLS from environment variables.
func (a *Agent) ConfigureTLS() error {
	serverCertB64 := os.Getenv("TLS_SERVER_CERT")
	serverKeyB64 := os.Getenv("TLS_SERVER_KEY")
	caB64 := os.Getenv("TLS_CA_CERT")

	if serverCertB64 == "" || serverKeyB64 == "" {
		log.Println("Agent: TLS not configured (no TLS_SERVER_CERT/TLS_SERVER_KEY)")
		return nil
	}

	serverCertPEM, err := decodePEM(serverCertB64)
	if err != nil {
		return fmt.Errorf("decode TLS_SERVER_CERT: %w", err)
	}
	serverKeyPEM, err := decodePEM(serverKeyB64)
	if err != nil {
		return fmt.Errorf("decode TLS_SERVER_KEY: %w", err)
	}

	cert, err := tls.X509KeyPair(serverCertPEM, serverKeyPEM)
	if err != nil {
		return fmt.Errorf("load server keypair: %w", err)
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}

	if caB64 != "" {
		caPEM, err := decodePEM(caB64)
		if err != nil {
			return fmt.Errorf("decode TLS_CA_CERT: %w", err)
		}
		caPool := x509.NewCertPool()
		if !caPool.AppendCertsFromPEM(caPEM) {
			return fmt.Errorf("parse TLS_CA_CERT PEM")
		}
		tlsConfig.ClientCAs = caPool
		tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
	}

	a.tlsConfig = tlsConfig
	log.Println("Agent: mTLS configured")
	return nil
}

// decodePEM accepts either raw PEM or base64-encoded PEM and returns PEM bytes.
func decodePEM(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "-----BEGIN") {
		return []byte(s), nil
	}
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	return base64.StdEncoding.DecodeString(s)
}

func (a *Agent) currentStageCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.stages)
}


