package main

import (
	"log"
	"os"
	"strings"
)

// syncStageOutputs builds the list of RTMP output destinations for a stage
// and sends them to the sidecar pipeline via SetOutputs.
func (m *Manager) syncStageOutputs(stageID, userID string) error {
	if m.db == nil {
		return nil
	}

	stage, ok := m.getStage(stageID)
	if !ok || !stageIsReady(stage) {
		return nil
	}

	row, err := dbGetStage(m.db, stageID)
	if err != nil || row == nil {
		return err
	}

	dests, err := dbListAllStageDestinations(m.db, stageID)
	if err != nil {
		return err
	}

	var outputs []OutputTarget
	for _, d := range dests {
		if !d.Enabled {
			continue
		}
		if d.Platform == "dazzle" {
			// Dazzle destination: the stream key IS the RTMP publish name,
			// matching how Twitch/Kick/etc work. The on_publish callback
			// looks up the stage from the key. We don't put the stageID in
			// the URL because ffmpeg drops RTMP query params (they go on
			// tcUrl, not the publish name, so nginx-rtmp never sees them).
			if row.StreamKey.Valid && row.StreamKey.String != "" {
				ingestURL := m.ingestURL(stage)
				rtmpURL := strings.TrimSuffix(ingestURL, "/") + "/" + row.StreamKey.String
				outputs = append(outputs, OutputTarget{Name: "dazzle", RtmpURL: rtmpURL})
			}
			continue
		}
		// External destination: decrypt stream key, build RTMP URL
		if d.RtmpURL == "" {
			continue
		}
		rtmpURL := d.RtmpURL
		if d.StreamKey != "" {
			decrypted, err := decryptString(m.encryptionKey, d.StreamKey)
			if err != nil {
				log.Printf("WARN: failed to decrypt stream key for destination %s: %v", d.DestinationID, err)
				continue
			}
			rtmpURL = strings.TrimSuffix(rtmpURL, "/") + "/" + decrypted
		}
		outputs = append(outputs, OutputTarget{Name: d.Platform + "-" + d.PlatformUsername, RtmpURL: rtmpURL})
	}

	if err := m.pc.SetOutputs(stage, outputs); err != nil {
		log.Printf("WARN: failed to set outputs for stage %s: %v", stageID, err)
		return err
	}

	log.Printf("INFO: synced %d output(s) for stage %s", len(outputs), stageID)
	return nil
}

// syncStageOutputsIfRunning is a fire-and-forget wrapper for use in RPC handlers.
func (m *Manager) syncStageOutputsIfRunning(stageID, userID string) {
	stage, ok := m.getStage(stageID)
	if !ok || !stageIsReady(stage) {
		return
	}
	go func() {
		if err := m.syncStageOutputs(stageID, userID); err != nil {
			log.Printf("WARN: syncStageOutputs failed for %s: %v", stageID, err)
		}
	}()
}

// ingestURL returns the RTMP ingest base URL for the given stage.
// Local k8s stages use the internal service DNS.
// GPU/RunPod stages use the public ingest URL.
func (m *Manager) ingestURL(stage *Stage) string {
	if stage.SidecarURL != "" {
		// GPU stage — needs public ingest URL
		if url := os.Getenv("INGEST_PUBLIC_URL"); url != "" {
			return url
		}
		return "rtmp://ingest.dazzle.fm:1935/v1"
	}
	// Local k8s stage — use internal service
	if url := os.Getenv("INGEST_INTERNAL_URL"); url != "" {
		return url
	}
	return "rtmp://ingest:1935/v1"
}
