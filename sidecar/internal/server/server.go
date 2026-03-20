package server

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"connectrpc.com/connect"

	"github.com/browser-streamer/sidecar/internal/cdp"
	sidecarv1connect "github.com/browser-streamer/sidecar/gen/api/v1/sidecarv1connect"
	"github.com/browser-streamer/sidecar/internal/pipeline"
	"github.com/browser-streamer/sidecar/internal/r2"
)

const RoutePrefix = "/_dz_9f7a3b1c"

type Config struct {
	Port         string
	StageID      string
	UserID       string
	ScreenWidth  string
	ScreenHeight string
	ContentRoot  string
	SyncDir      string
	CDPHost      string
	CDPPort      string
	R2Bucket     string
	R2Endpoint   string
	R2AccessKey  string
	R2SecretKey  string
	ContentNonce string // random path prefix for content serving (multi-tenant isolation)
}

// ScreenSize returns "WxH" for ffmpeg.
func (c Config) ScreenSize() string {
	return c.ScreenWidth + "x" + c.ScreenHeight
}

// ContentURL returns the localhost URL for a content path, including
// the nonce prefix in multi-tenant mode. When TLS is configured, Chrome
// uses the localhost-only HTTP port instead of the mTLS port.
func (c Config) ContentURL(path string) string {
	port := c.Port
	// In mTLS mode, Chrome connects to the local HTTP port (not the mTLS port)
	if os.Getenv("TLS_SERVER_CERT") != "" {
		if lp := os.Getenv("LOCAL_HTTP_PORT"); lp != "" {
			port = lp
		} else {
			port = "8080"
		}
	}
	if c.ContentNonce != "" {
		return "http://localhost:" + port + "/" + c.ContentNonce + "/" + path
	}
	return "http://localhost:" + port + "/" + path
}

type Server struct {
	cfg          Config
	mux          *http.ServeMux
	localMux     *http.ServeMux // content-only mux for localhost HTTP (no internal APIs)
	cdpClient    cdp.CDP
	pipeline     *pipeline.Pipeline
	syncState    *SyncState
	logBuffer    *LogBuffer
	r2Syncer     *r2.Syncer
	lastActivity time.Time
	stageStart   time.Time

	// Thumbnail cache
	thumbMu         sync.Mutex
	thumbData       []byte
	thumbCapturedAt time.Time

	// Live stats (updated by pipeline callback and browser FPS poller)
	statsMu       sync.Mutex
	pipelineStart time.Time
	browserFPS    float64
}

func New(cfg Config) (*Server, error) {
	now := time.Now()
	// Pipeline options
	var pipelineOpts []pipeline.Option
	// On multi-GPU RunPod hosts, the container gets /dev/nvidiaN where N>0.
	// NVENC enumerates from device 0 and fails with "No capable devices found".
	// Set CUDA_VISIBLE_DEVICES=0 to remap the physical GPU to logical device 0
	// for the sidecar process (affects both probe and ffmpeg pipeline).
	if idx := os.Getenv("GPU_DEVICE_INDEX"); idx != "" && idx != "0" {
		os.Setenv("CUDA_VISIBLE_DEVICES", "0")
	}
	if codec := os.Getenv("SIDECAR_VIDEO_CODEC"); codec != "" && codec != "libx264" {
		if probeErr := pipeline.ProbeCodec(codec); probeErr == nil {
			log.Printf("Video codec: %s (probe passed)", codec)
			pipelineOpts = append(pipelineOpts, pipeline.WithVideoCodec(codec))
		} else {
			log.Printf("Video codec: %s probe failed: %v", codec, probeErr)
		}
	}

	// Choose CDP transport: pipe mode (no TCP port) or WebSocket (traditional)
	var cdpClient cdp.CDP
	if pipeIn := os.Getenv("CDP_PIPE_IN"); pipeIn != "" {
		pipeOut := os.Getenv("CDP_PIPE_OUT")
		cdpClient = cdp.NewPipeClient(pipeIn, pipeOut)
		log.Printf("CDP: using pipe transport (%s, %s)", pipeIn, pipeOut)
	} else {
		cdpClient = cdp.NewClient(cfg.CDPHost, cfg.CDPPort)
	}

	s := &Server{
		cfg:       cfg,
		mux:       http.NewServeMux(),
		cdpClient: cdpClient,
		pipeline: pipeline.New(
			func() string { if d := os.Getenv("DISPLAY"); d != "" { return d }; return ":99" }(), cfg.ScreenSize(), pipelineOpts...,
		),
		syncState:    NewSyncState(cfg.SyncDir),
		logBuffer:    NewLogBuffer(1000),
		lastActivity: now,
		stageStart:   now,
	}

	// Set up R2 syncer if configured
	if cfg.R2AccessKey != "" && cfg.R2Endpoint != "" {
		prefix := "users/" + cfg.UserID + "/stages/" + cfg.StageID + "/"
		syncer, err := r2.NewSyncer(cfg.R2Endpoint, cfg.R2AccessKey, cfg.R2SecretKey, cfg.R2Bucket, prefix, "/data/")
		if err != nil {
			log.Printf("WARN: R2 syncer init failed: %v (persistence disabled)", err)
		} else {
			s.r2Syncer = syncer
		}
	}

	s.routes()
	return s, nil
}

// mtlsAuthInterceptor returns a connect interceptor that requires a verified mTLS peer cert.
// If TLS is not configured (plain HTTP mode), all requests are allowed.
func mtlsAuthInterceptor() connect.UnaryInterceptorFunc {
	tlsConfigured := os.Getenv("TLS_SERVER_CERT") != ""
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if !tlsConfigured {
				return next(ctx, req)
			}
			// peer cert is verified by the TLS handshake (RequireAndVerifyClientCert);
			// if we reach here over TLS the chain is already valid.
			return next(ctx, req)
		}
	}
}

func (s *Server) routes() {
	p := RoutePrefix

	// ConnectRPC handler options with auth interceptor
	interceptors := connect.WithInterceptors(mtlsAuthInterceptor())

	// Build a sub-mux that lives behind /_dz_9f7a3b1c/.
	// All internal endpoints — both ConnectRPC and plain HTTP — go here.
	subMux := http.NewServeMux()

	// ConnectRPC services
	syncHandler := &syncServer{s: s}
	runtimeHandler := &runtimeServer{s: s}
	outputHandler := &outputServer{s: s}

	syncPath, syncH := sidecarv1connect.NewSyncServiceHandler(syncHandler, interceptors)
	runtimePath, runtimeH := sidecarv1connect.NewRuntimeServiceHandler(runtimeHandler, interceptors)
	outputPath, outputH := sidecarv1connect.NewOutputPipelineServiceHandler(outputHandler, interceptors)

	subMux.Handle(syncPath, syncH)
	subMux.Handle(runtimePath, runtimeH)
	subMux.Handle(outputPath, outputH)

	// Plain HTTP routes (also behind prefix)
	subMux.HandleFunc("/health", s.handleHealth)
	subMux.HandleFunc("/metrics", s.authWrap(s.handleMetrics))
	subMux.HandleFunc("/thumbnail.png", s.authWrap(s.handleThumbnail))
	subMux.HandleFunc("/cdp/", s.authWrap(s.handleCDPProxy))

	// Mount everything behind the prefix
	s.mux.Handle(p+"/", http.StripPrefix(p, subMux))

	// User content serving.
	// In multi-tenant mode (ContentNonce set), content is served at /<nonce>/
	// so co-tenants can't read source code via localhost without knowing the nonce.
	// Chrome loads /_boot (no secret in cmdline) which redirects to /<nonce>/.
	// The nonce only exists in the sidecar's environ (mode 0400, same-UID only).
	// In single-tenant mode (no nonce), content is served at / as before.
	fs := http.FileServer(http.Dir(s.cfg.SyncDir))
	if s.cfg.ContentNonce != "" {
		contentPrefix := "/" + s.cfg.ContentNonce
		s.mux.Handle(contentPrefix+"/", http.StripPrefix(contentPrefix, fs))
		s.mux.HandleFunc("/_boot", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, contentPrefix+"/", http.StatusFound)
		})
		s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.NotFound(w, r)
		})
	} else {
		s.mux.Handle("/", fs)
	}

	// Build a separate mux for the localhost-only HTTP listener (Chrome content).
	// This mux only serves content routes — no /_dz_9f7a3b1c/ prefix routes
	// (HLS, thumbnails, metrics, CDP proxy, RPCs). On multi-tenant GPU pods,
	// co-tenant stages share the network namespace and could otherwise hit
	// these endpoints on another stage's local HTTP port without mTLS.
	s.localMux = http.NewServeMux()
	if s.cfg.ContentNonce != "" {
		contentPrefix := "/" + s.cfg.ContentNonce
		s.localMux.Handle(contentPrefix+"/", http.StripPrefix(contentPrefix, fs))
		s.localMux.HandleFunc("/_boot", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, contentPrefix+"/", http.StatusFound)
		})
		s.localMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.NotFound(w, r)
		})
	} else {
		s.localMux.Handle("/", fs)
	}
	// Health check is needed on the local port for stage-start.sh readiness probe
	s.localMux.HandleFunc(p+"/health", s.handleHealth)
}

func (s *Server) authWrap(handler http.HandlerFunc) http.HandlerFunc {
	tlsConfigured := os.Getenv("TLS_SERVER_CERT") != ""
	return func(w http.ResponseWriter, r *http.Request) {
		s.lastActivity = time.Now()
		// In plain HTTP mode (no TLS certs) the server is only reachable inside the
		// pod network, so no additional auth is needed.
		// In mTLS mode, the TLS handshake already enforced RequireAndVerifyClientCert.
		if tlsConfigured && (r.TLS == nil || len(r.TLS.VerifiedChains) == 0) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		handler(w, r)
	}
}

func (s *Server) Run() error {
	// Ensure content directories exist
	os.MkdirAll(s.cfg.ContentRoot, 0o755)
	os.MkdirAll(s.cfg.SyncDir, 0o755)

	// Seed placeholder if no index.html
	s.seedPlaceholder()

	// Start background services
	go s.cdpClient.ConnectLoop(s.logBuffer)
	go s.startPipeline()
	if s.r2Syncer != nil {
		go s.r2Syncer.Watch()
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	tlsCfg := buildSidecarTLSConfig()

	var mainSrv, localSrv *http.Server

	if tlsCfg != nil {
		// mTLS mode: serve mTLS on the main port (0.0.0.0:PORT) for external
		// access, and plain HTTP on localhost only for Chrome content loading.
		mainSrv = &http.Server{
			Handler:   s.mux,
			TLSConfig: tlsCfg,
		}
		ln, err := tls.Listen("tcp", ":"+s.cfg.Port, tlsCfg)
		if err != nil {
			log.Fatalf("mTLS listener failed on :%s: %v", s.cfg.Port, err)
		}
		go func() {
			log.Printf("Sidecar mTLS listening on :%s", s.cfg.Port)
			if err := mainSrv.Serve(ln); err != http.ErrServerClosed {
				log.Printf("mTLS server error: %v", err)
			}
		}()

		// Localhost-only plain HTTP for Chrome to load content.
		// Chrome connects to http://127.0.0.1:<localPort>/<nonce>/
		localPort := os.Getenv("LOCAL_HTTP_PORT")
		if localPort == "" {
			localPort = "8080"
		}
		localSrv = &http.Server{
			Addr:    "127.0.0.1:" + localPort,
			Handler: s.localMux,
		}
		go func() {
			log.Printf("Sidecar local HTTP on 127.0.0.1:%s (Chrome only)", localPort)
			if err := localSrv.ListenAndServe(); err != http.ErrServerClosed {
				log.Printf("Local HTTP server error: %v", err)
			}
		}()
	} else {
		// No TLS: plain HTTP on all interfaces (local k8s pod)
		mainSrv = &http.Server{
			Addr:    ":" + s.cfg.Port,
			Handler: s.mux,
		}
		go func() {
			log.Printf("Sidecar listening on :%s", s.cfg.Port)
			if err := mainSrv.ListenAndServe(); err != http.ErrServerClosed {
				log.Printf("HTTP server error: %v", err)
			}
		}()
	}

	<-ctx.Done()
	log.Println("Shutting down...")

	// Stop pipeline
	s.pipeline.Stop()

	// Final R2 sync
	if s.r2Syncer != nil {
		s.r2Syncer.FinalSync()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if localSrv != nil {
		localSrv.Shutdown(shutdownCtx)
	}
	return mainSrv.Shutdown(shutdownCtx)
}

func (s *Server) startPipeline() {
	// Wait for Chrome to be rendering before capturing the screen
	log.Println("Waiting for Chrome before starting pipeline...")
	for i := 0; i < 60; i++ {
		if s.cdpClient.IsConnected() {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	s.pipeline.SetStatsCallback(func(stats pipeline.Stats) {
		UpdatePipelineStats(stats)
	})

	s.statsMu.Lock()
	s.pipelineStart = time.Now()
	s.statsMu.Unlock()

	// Pipeline starts idle — control-plane will call SetOutputs with
	// RTMP destinations (Dazzle ingest + any user-configured destinations)
	// after stage activation completes.
	log.Println("ffmpeg pipeline ready (waiting for outputs from control-plane)")

	// Start browser FPS polling
	go s.pollBrowserFPS()
}

// fpsScript is injected into the browser to measure rendering FPS via requestAnimationFrame.
const fpsScript = `(function() {
  if (window.__dzFPS !== undefined) return 'ok';
  window.__dzFPS = { current: 0 };
  let frames = 0, lastTime = performance.now();
  function tick(now) {
    frames++;
    const elapsed = now - lastTime;
    if (elapsed >= 1000) {
      window.__dzFPS.current = Math.round(frames * 1000 / elapsed * 10) / 10;
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return 'ok';
})();`

// pollBrowserFPS periodically injects the FPS counter and reads the current value via CDP.
func (s *Server) pollBrowserFPS() {
	// Wait a bit for the page to load
	time.Sleep(3 * time.Second)

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	injected := false
	for range ticker.C {
		if !s.cdpClient.IsConnected() {
			injected = false
			continue
		}

		// Inject the FPS script if not yet done (or after a page reload)
		if !injected {
			if _, err := s.cdpClient.Evaluate(fpsScript); err == nil {
				injected = true
			}
			continue
		}

		// Read the current FPS; -1 means window.__dzFPS was lost (page navigated)
		val, err := s.cdpClient.Evaluate("window.__dzFPS ? window.__dzFPS.current : -1")
		if err != nil {
			injected = false
			continue
		}
		fps, _ := strconv.ParseFloat(val, 64)
		if fps < 0 {
			// Page navigated — re-inject on next tick
			injected = false
			continue
		}
		s.statsMu.Lock()
		s.browserFPS = fps
		s.statsMu.Unlock()
	}
}

func (s *Server) seedPlaceholder() {
	indexPath := s.cfg.SyncDir + "/index.html"
	if _, err := os.Stat(indexPath); err == nil {
		return
	}
	os.WriteFile(indexPath, []byte(placeholderHTML), 0o644)
}

// buildSidecarTLSConfig creates a TLS config for the mTLS listener.
// Returns nil if TLS env vars are not set.
func buildSidecarTLSConfig() *tls.Config {
	caB64 := os.Getenv("TLS_CA_CERT")
	certB64 := os.Getenv("TLS_SERVER_CERT")
	keyB64 := os.Getenv("TLS_SERVER_KEY")
	if caB64 == "" || certB64 == "" || keyB64 == "" {
		return nil
	}

	caPEM, err := decodePEM(caB64)
	if err != nil {
		log.Printf("WARN: failed to decode TLS_CA_CERT: %v", err)
		return nil
	}
	certPEM, err := decodePEM(certB64)
	if err != nil {
		log.Printf("WARN: failed to decode TLS_SERVER_CERT: %v", err)
		return nil
	}
	keyPEM, err := decodePEM(keyB64)
	if err != nil {
		log.Printf("WARN: failed to decode TLS_SERVER_KEY: %v", err)
		return nil
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		log.Printf("WARN: failed to parse TLS_CA_CERT PEM")
		return nil
	}

	serverCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		log.Printf("WARN: failed to load TLS server keypair: %v", err)
		return nil
	}

	return &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    caPool,
	}
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

const placeholderHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #666;
  }
  .container { text-align: center; }
  h1 { font-size: 2rem; font-weight: 300; margin-bottom: 0.5rem; color: #888; }
  p { font-size: 1rem; font-weight: 300; }
</style>
</head>
<body>
<div class="container">
  <h1>dazzle</h1>
  <p>Create something for it to show up here.</p>
</div>
</body>
</html>`
