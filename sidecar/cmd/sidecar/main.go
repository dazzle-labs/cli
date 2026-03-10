package main

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/browser-streamer/sidecar/internal/bench"
	"github.com/browser-streamer/sidecar/internal/r2"
	"github.com/browser-streamer/sidecar/internal/server"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: sidecar <serve|restore|bench>\n")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "serve":
		runServe()
	case "restore":
		runRestore()
	case "bench":
		runBench()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runServe() {
	cfg := server.Config{
		Port:         envOrDefault("PORT", "8080"),
		Token:        os.Getenv("TOKEN"),
		StageID:      envOrDefault("STAGE_ID", "unknown"),
		UserID:       envOrDefault("USER_ID", "unknown"),
		ScreenWidth:  envOrDefault("SCREEN_WIDTH", "1280"),
		ScreenHeight: envOrDefault("SCREEN_HEIGHT", "720"),
		ContentRoot:  "/data/content",
		SyncDir:      "/data/content/sync",
		HLSDir:       "/tmp/hls",
		CDPHost:      "localhost",
		CDPPort:      "9222",
		OBSHost:      "localhost",
		OBSPort:      "4455",
		R2Bucket:     os.Getenv("R2_BUCKET"),
		R2Endpoint:   os.Getenv("R2_ENDPOINT"),
		R2AccessKey:  os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretKey:  os.Getenv("R2_SECRET_ACCESS_KEY"),
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

	prefix := fmt.Sprintf("users/%s/stages/%s/", userID, stageID)
	if err := r2.Restore(endpoint, accessKey, secretKey, bucket, prefix, "/data/"); err != nil {
		log.Printf("WARN: restore failed: %v", err)
	}
	ensureDirs()
}

func ensureDirs() {
	os.MkdirAll("/data/content", 0o755)
	os.MkdirAll("/data/chrome", 0o755)
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

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
