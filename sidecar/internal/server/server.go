package server

import (
	"context"
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
	Token        string
	StageID      string
	UserID       string
	ScreenWidth  string
	ScreenHeight string
	ContentRoot  string
	SyncDir      string
	HLSDir       string
	CDPHost      string
	CDPPort      string
	OBSHost      string // kept for config compat, unused by pipeline
	OBSPort      string // kept for config compat, unused by pipeline
	R2Bucket     string
	R2Endpoint   string
	R2AccessKey  string
	R2SecretKey  string
}

// ScreenSize returns "WxH" for ffmpeg.
func (c Config) ScreenSize() string {
	return c.ScreenWidth + "x" + c.ScreenHeight
}

type Server struct {
	cfg          Config
	mux          *http.ServeMux
	cdpClient    *cdp.Client
	pipeline     *pipeline.Pipeline
	syncState    *SyncState
	logBuffer    *LogBuffer
	r2Syncer     *r2.Syncer
	lastActivity time.Time
	stageStart   time.Time

	// Live stats (updated by pipeline callback and browser FPS poller)
	statsMu       sync.Mutex
	pipelineStats pipeline.Stats
	pipelineStart time.Time
	browserFPS    float64
}

func New(cfg Config) (*Server, error) {
	now := time.Now()
	s := &Server{
		cfg:       cfg,
		mux:       http.NewServeMux(),
		cdpClient: cdp.NewClient(cfg.CDPHost, cfg.CDPPort),
		pipeline: pipeline.New(
			":99", cfg.ScreenSize(), cfg.HLSDir,
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

// tokenAuthInterceptor returns a connect interceptor that checks the TOKEN.
func tokenAuthInterceptor(token string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if token == "" {
				return next(ctx, req)
			}
			auth := req.Header().Get("Authorization")
			t := strings.TrimPrefix(auth, "Bearer ")
			if t != token {
				return nil, connect.NewError(connect.CodeUnauthenticated, nil)
			}
			return next(ctx, req)
		}
	}
}

// tokenAuthStreamInterceptor returns a connect interceptor for streaming RPCs.
func tokenAuthStreamInterceptor(token string) connect.UnaryInterceptorFunc {
	return tokenAuthInterceptor(token)
}

func (s *Server) routes() {
	p := RoutePrefix

	// ConnectRPC handler options with auth interceptor
	interceptors := connect.WithInterceptors(tokenAuthInterceptor(s.cfg.Token))

	// Build a sub-mux that lives behind /_dz_9f7a3b1c/.
	// All internal endpoints — both ConnectRPC and plain HTTP — go here.
	subMux := http.NewServeMux()

	// ConnectRPC services
	syncHandler := &syncServer{s: s}
	runtimeHandler := &runtimeServer{s: s}
	obsHandler := &obsServer{s: s}

	syncPath, syncH := sidecarv1connect.NewSyncServiceHandler(syncHandler, interceptors)
	runtimePath, runtimeH := sidecarv1connect.NewRuntimeServiceHandler(runtimeHandler, interceptors)
	obsPath, obsH := sidecarv1connect.NewObsServiceHandler(obsHandler, interceptors)

	subMux.Handle(syncPath, syncH)
	subMux.Handle(runtimePath, runtimeH)
	subMux.Handle(obsPath, obsH)

	// Plain HTTP routes (also behind prefix)
	subMux.HandleFunc("/health", s.handleHealth)
	subMux.HandleFunc("/metrics", s.handleMetrics)
	subMux.HandleFunc("/hls/", s.handleHLS)
	subMux.HandleFunc("/cdp/", s.authWrap(s.handleCDPProxy))

	// Mount everything behind the prefix
	s.mux.Handle(p+"/", http.StripPrefix(p, subMux))

	// User content at root (fallback — no prefix, no auth)
	s.mux.Handle("/", http.FileServer(http.Dir(s.cfg.SyncDir)))
}

func (s *Server) authWrap(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.lastActivity = time.Now()
		if s.cfg.Token == "" {
			handler(w, r)
			return
		}
		token := r.URL.Query().Get("token")
		if token == "" {
			auth := r.Header.Get("Authorization")
			token = strings.TrimPrefix(auth, "Bearer ")
		}
		if token != s.cfg.Token {
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

	srv := &http.Server{
		Addr:    ":" + s.cfg.Port,
		Handler: s.mux,
	}

	// Start background services
	go s.cdpClient.ConnectLoop(s.logBuffer)
	go s.startPipeline()
	if s.r2Syncer != nil {
		go s.r2Syncer.Watch()
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	go func() {
		log.Printf("Sidecar listening on :%s", s.cfg.Port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()

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
	return srv.Shutdown(shutdownCtx)
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
		s.statsMu.Lock()
		s.pipelineStats = stats
		s.statsMu.Unlock()
	})

	s.statsMu.Lock()
	s.pipelineStart = time.Now()
	s.statsMu.Unlock()

	if err := s.pipeline.Start(); err != nil {
		log.Printf("FATAL: ffmpeg pipeline failed to start: %v", err)
		return
	}
	log.Println("ffmpeg pipeline started (HLS preview)")

	// Start browser FPS polling after pipeline is running
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

		// Read the current FPS
		val, err := s.cdpClient.Evaluate("window.__dzFPS ? window.__dzFPS.current : 0")
		if err != nil {
			injected = false
			continue
		}
		fps, _ := strconv.ParseFloat(val, 64)
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
