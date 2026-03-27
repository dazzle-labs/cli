package main

import (
	"fmt"
	"log"
	"mime"
	"os"
	"strconv"
	"strings"

	"github.com/browser-streamer/sidecar/internal/agent"
	"github.com/browser-streamer/sidecar/internal/bench"
	"github.com/browser-streamer/sidecar/internal/r2"
	"github.com/browser-streamer/sidecar/internal/server"
)

func init() {
	// Ensure correct MIME types regardless of the host system's /etc/mime.types.
	// The GPU image (nvidia/cuda) may have a missing or incomplete MIME database,
	// causing http.FileServer to fall back to content sniffing (text/plain).
	for ext, ct := range map[string]string{
		".css":  "text/css; charset=utf-8",
		".js":   "text/javascript; charset=utf-8",
		".mjs":  "text/javascript; charset=utf-8",
		".json": "application/json",
		".html": "text/html; charset=utf-8",
		".htm":  "text/html; charset=utf-8",
		".svg":  "image/svg+xml",
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".webp": "image/webp",
		".woff": "font/woff",
		".woff2": "font/woff2",
		".ttf":  "font/ttf",
		".otf":  "font/otf",
		".wasm": "application/wasm",
		".mp4":  "video/mp4",
		".webm": "video/webm",
		".mp3":  "audio/mpeg",
		".ogg":  "audio/ogg",
		".wav":  "audio/wav",
	} {
		mime.AddExtensionType(ext, ct)
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: sidecar <serve|restore|bench|agent>\n")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "serve":
		runServe()
	case "restore":
		runRestore()
	case "bench":
		runBench()
	case "agent":
		runAgent()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runServe() {
	cfg := server.Config{
		Port:         envOrDefault("PORT", "8080"),
		StageID:      envOrDefault("STAGE_ID", "unknown"),
		UserID:       envOrDefault("USER_ID", "unknown"),
		ScreenWidth:  envOrDefault("SCREEN_WIDTH", "1280"),
		ScreenHeight: envOrDefault("SCREEN_HEIGHT", "720"),
		ContentRoot:  envOrDefault("CONTENT_ROOT", "/data/content"),
		SyncDir:      envOrDefault("SYNC_DIR", "/data/content/sync"),
		CDPHost:      "localhost",
		CDPPort:      envOrDefault("CDP_PORT", "9222"),
		R2Bucket:     os.Getenv("R2_BUCKET"),
		R2Endpoint:   os.Getenv("R2_ENDPOINT"),
		R2AccessKey:  os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretKey:  os.Getenv("R2_SECRET_ACCESS_KEY"),
		ContentNonce: os.Getenv("CONTENT_NONCE"),
	}

	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("failed to create server: %v", err)
	}
	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func runRestore() {
	endpoint := os.Getenv("R2_ENDPOINT")
	accessKey := os.Getenv("R2_ACCESS_KEY_ID")
	secretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	bucket := os.Getenv("R2_BUCKET")
	userID := os.Getenv("USER_ID")
	stageID := os.Getenv("STAGE_ID")

	if accessKey == "" || endpoint == "" {
		log.Println("R2 not configured, skipping restore")
		ensureDirs()
		return
	}

	// DATA_DIR is set by the GPU agent to /data/stages/<stageID>;
	// CPU init containers use the default /data/.
	dataDir := envOrDefault("DATA_DIR", "/data")

	prefix := fmt.Sprintf("users/%s/stages/%s/", userID, stageID)
	if err := r2.Restore(endpoint, accessKey, secretKey, bucket, prefix, dataDir); err != nil {
		log.Printf("WARN: restore failed: %v", err)
	}
	ensureDirs()
}

func ensureDirs() {
	dataDir := envOrDefault("DATA_DIR", "/data")
	os.MkdirAll(dataDir+"/content", 0o755)
	os.MkdirAll(dataDir+"/chrome", 0o755)
}

func runBench() {
	cfg := bench.DefaultConfig()

	// Parse flags from remaining args
	args := os.Args[2:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--duration", "-d":
			if i+1 < len(args) {
				i++
				if d, err := strconv.Atoi(args[i]); err == nil {
					cfg.SceneDuration = d
				}
			}
		case "--scene", "-s":
			if i+1 < len(args) {
				i++
				cfg.Scenes = strings.Split(args[i], ",")
			}
		case "--min-fps":
			if i+1 < len(args) {
				i++
				if f, err := strconv.ParseFloat(args[i], 64); err == nil {
					cfg.MinBrowserFPS = f
				}
			}
		default:
			fmt.Fprintf(os.Stderr, "bench: unknown flag %q\n", args[i])
			fmt.Fprintf(os.Stderr, "usage: sidecar bench [--duration 30] [--scene static,css_animation,...] [--min-fps 25]\n")
			os.Exit(1)
		}
	}

	report, err := bench.Run(cfg)
	if err != nil {
		log.Fatalf("bench failed: %v", err)
	}
	bench.PrintReport(report)

	if !report.AllPass {
		os.Exit(1)
	}
}

func runAgent() {
	maxStages := 5
	if v := os.Getenv("MAX_STAGES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxStages = n
		}
	}

	a := agent.New(maxStages)

	if err := a.ConfigureTLS(); err != nil {
		log.Fatalf("agent TLS config: %v", err)
	}

	if err := a.Run(); err != nil {
		log.Fatalf("agent: %v", err)
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
