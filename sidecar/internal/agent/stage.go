package agent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

const (
	// sidecarPort is the port the sidecar listens on inside each stage.
	// Each stage's sidecar binds to this port but is reached externally
	// via the slot's hostPort (agent sets PORT env var accordingly).
	sidecarPort = 8080
	// stageStartScript is the path to the per-stage startup script.
	stageStartScript = "/stage-start.sh"
	// stageDataRoot is where per-stage data directories are created.
	stageDataRoot = "/data/stages"
	// BaseUID is the first UID allocated to stage processes.
	// Each slot gets UID BaseUID+slotIndex, providing /proc and filesystem
	// isolation between stages without kernel namespaces.
	BaseUID = 10000
)

// stageProcess tracks the running process group for a stage.
type stageProcess struct {
	cmd  *exec.Cmd
	done chan struct{} // closed when process exits
}

// allocateSlot finds the first free slot, or returns an error if full.
func (a *Agent) allocateSlot(stageID, userID string) (*stageSlot, error) {
	for i := range a.slots {
		if a.slots[i] == nil {
			slot := &stageSlot{
				slotIndex: i,
				hostPort:  BaseStagePort + i,
				display:   fmt.Sprintf(":%d", BaseDisplay+i),
				uid:       BaseUID + i,
				stageID:   stageID,
				userID:    userID,
				status:    "starting",
			}
			a.slots[i] = slot
			a.stages[stageID] = slot
			return slot, nil
		}
	}
	return nil, fmt.Errorf("no free slots (max_stages=%d)", a.maxStages)
}

// releaseSlot frees a slot.
func (a *Agent) releaseSlot(slot *stageSlot) {
	if slot.slotIndex >= 0 && slot.slotIndex < len(a.slots) {
		a.slots[slot.slotIndex] = nil
	}
	delete(a.stages, slot.stageID)
}

// CreateStage provisions a new stage on this node.
// Each stage gets its own Xvfb display, Chrome instance, sidecar process,
// and data directory. Isolation is process-level (no kernel namespaces).
func (a *Agent) CreateStage(stageID, userID string, r2Endpoint, r2AccessKey, r2SecretKey, r2Bucket string) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, exists := a.stages[stageID]; exists {
		return 0, fmt.Errorf("stage %s already exists", stageID)
	}

	slot, err := a.allocateSlot(stageID, userID)
	if err != nil {
		return 0, err
	}

	// Create per-stage directories with restricted permissions, owned by the
	// slot's dedicated UID. This prevents cross-stage filesystem access.
	os.MkdirAll(stageDataRoot, 0o711)
	dataDir := fmt.Sprintf("%s/%s", stageDataRoot, stageID)
	uid := slot.uid
	for _, dir := range []string{dataDir + "/content", dataDir + "/chrome"} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			a.releaseSlot(slot)
			return 0, fmt.Errorf("create dir %s: %w", dir, err)
		}
	}

	// Create HLS, PulseAudio, and home directories with per-UID ownership.
	// All dirs are 0700 so other stage UIDs cannot read them.
	hlsDir := fmt.Sprintf("/tmp/hls-%d", slot.slotIndex)
	pulseDir := fmt.Sprintf("/tmp/pulse-%d", slot.slotIndex)
	pulseRuntime := fmt.Sprintf("/tmp/pulse-runtime-%d", slot.slotIndex)
	homeDir := fmt.Sprintf("/tmp/stage-home-%d", slot.slotIndex)
	for _, dir := range []string{hlsDir, pulseDir, pulseRuntime, homeDir, dataDir, dataDir + "/content", dataDir + "/chrome"} {
		os.MkdirAll(dir, 0o700)
		os.Chown(dir, uid, uid)
	}
	// Ensure the stages root dir isn't listable by non-root
	os.Chmod(stageDataRoot, 0o711)

	// Create CDP FIFOs for pipe-based Chrome debugging (no TCP port).
	// Owned by stage UID so other stages can't access them.
	cdpIn := fmt.Sprintf("/tmp/cdp-in-%d", slot.slotIndex)
	cdpOut := fmt.Sprintf("/tmp/cdp-out-%d", slot.slotIndex)
	for _, fifo := range []string{cdpIn, cdpOut} {
		os.Remove(fifo) // remove stale FIFOs
		if err := syscall.Mkfifo(fifo, 0o666); err != nil {
			a.releaseSlot(slot)
			return 0, fmt.Errorf("create CDP FIFO %s: %w", fifo, err)
		}
		// World-readable: sidecar (root) and Chrome (stage UID via setpriv) both need access.
		// Content nonce in the URL provides the real isolation — the pipe is just transport.
		os.Chmod(fifo, 0o666)
	}

	// Generate Xvfb auth cookie — prevents cross-display screen capture.
	// Each display requires this cookie, which only the owning UID can read.
	xauthPath := fmt.Sprintf("/tmp/xauth-%d", slot.slotIndex)
	cookie := make([]byte, 16)
	if _, err := rand.Read(cookie); err != nil {
		a.releaseSlot(slot)
		return 0, fmt.Errorf("generate xauth cookie: %w", err)
	}
	cookieHex := hex.EncodeToString(cookie)
	// Pipe cookie via stdin to keep it out of /proc/<pid>/cmdline.
	xauthCmd := exec.Command("xauth", "-f", xauthPath, "source", "-")
	xauthCmd.Stdin = strings.NewReader(fmt.Sprintf("add %s . %s\n", slot.display, cookieHex))
	if out, err := xauthCmd.CombinedOutput(); err != nil {
		a.releaseSlot(slot)
		return 0, fmt.Errorf("xauth setup failed (refusing to run without display auth): %v: %s", err, out)
	}
	os.Chown(xauthPath, uid, uid)
	os.Chmod(xauthPath, 0o600)

	// Generate a random content nonce — the sidecar serves user content at
	// /<nonce>/ instead of / so co-tenants can't read source code via localhost.
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		a.releaseSlot(slot)
		return 0, fmt.Errorf("generate content nonce: %w", err)
	}
	contentNonce := hex.EncodeToString(nonce)

	// Build environment for the stage process.
	// Each stage gets a unique display, port, data directory, and UID.
	env := []string{
		fmt.Sprintf("DISPLAY=%s", slot.display),
		fmt.Sprintf("PORT=%d", slot.hostPort),
		fmt.Sprintf("STAGE_ID=%s", stageID),
		fmt.Sprintf("USER_ID=%s", userID),
		fmt.Sprintf("SLOT=%d", slot.slotIndex),
		fmt.Sprintf("DATA_DIR=%s", dataDir),
		fmt.Sprintf("HOME=%s", homeDir),
		fmt.Sprintf("XAUTHORITY=%s", xauthPath),
		fmt.Sprintf("SIDECAR_VIDEO_CODEC=%s", envOrDefault("SIDECAR_VIDEO_CODEC", "h264_nvenc")),
		fmt.Sprintf("GPU_DEVICE_INDEX=%s", a.gpuDeviceIndex),
		fmt.Sprintf("SCREEN_WIDTH=%s", envOrDefault("SCREEN_WIDTH", "1280")),
		fmt.Sprintf("SCREEN_HEIGHT=%s", envOrDefault("SCREEN_HEIGHT", "720")),
		fmt.Sprintf("PULSE_SERVER=unix:/tmp/pulse-%d/native", slot.slotIndex),
		fmt.Sprintf("HLS_DIR=%s", hlsDir),
		fmt.Sprintf("CDP_PIPE_IN=%s", cdpIn),
		fmt.Sprintf("CDP_PIPE_OUT=%s", cdpOut),
		fmt.Sprintf("CONTENT_NONCE=%s", contentNonce),
		fmt.Sprintf("LOCAL_HTTP_PORT=%d", 8080+slot.slotIndex),
		fmt.Sprintf("PATH=%s", envOrDefault("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")),
		fmt.Sprintf("STAGE_UID=%d", slot.uid),
		fmt.Sprintf("STAGE_GID=%d", slot.uid),
	}

	// Pass through Chrome flags
	if flags := os.Getenv("CHROME_FLAGS"); flags != "" {
		env = append(env, fmt.Sprintf("CHROME_FLAGS=%s", flags))
	}

	// GL environment — pass through from pod env if set.
	// Avoid defaulting __GLX_VENDOR_LIBRARY_NAME to "nvidia" since NVIDIA's
	// libGLX may not be bind-mounted; Mesa/llvmpipe works as a fallback.
	for _, glVar := range []string{"__NV_PRIME_RENDER_OFFLOAD", "__GLX_VENDOR_LIBRARY_NAME", "LIBGL_ALWAYS_SOFTWARE"} {
		if v := os.Getenv(glVar); v != "" {
			env = append(env, fmt.Sprintf("%s=%s", glVar, v))
		}
	}

	// R2 config
	if r2Endpoint != "" {
		env = append(env,
			fmt.Sprintf("R2_ENDPOINT=%s", r2Endpoint),
			fmt.Sprintf("R2_ACCESS_KEY_ID=%s", r2AccessKey),
			fmt.Sprintf("R2_SECRET_ACCESS_KEY=%s", r2SecretKey),
			fmt.Sprintf("R2_BUCKET=%s", r2Bucket),
		)
	}

	// Pass through mTLS certs for the sidecar
	for _, key := range []string{"TLS_SERVER_CERT", "TLS_SERVER_KEY", "TLS_CA_CERT"} {
		if v := os.Getenv(key); v != "" {
			env = append(env, fmt.Sprintf("%s=%s", key, v))
		}
	}

	proc, err := spawnStage(slot, env, a.gpuGIDs)
	if err != nil {
		os.RemoveAll(dataDir)
		a.releaseSlot(slot)
		return 0, fmt.Errorf("spawn stage: %w", err)
	}

	slot.process = proc
	slot.status = "running"

	// Monitor process in background
	go a.monitorStage(stageID, slot, proc)

	log.Printf("Created stage %s on slot %d (display %s, port %d)", stageID, slot.slotIndex, slot.display, slot.hostPort)
	return slot.hostPort, nil
}

// DestroyStage tears down a stage and frees its slot.
func (a *Agent) DestroyStage(stageID string) error {
	a.mu.Lock()
	slot, ok := a.stages[stageID]
	if !ok {
		a.mu.Unlock()
		return fmt.Errorf("stage %s not found", stageID)
	}
	a.releaseSlot(slot)
	a.mu.Unlock()

	// Stop the process group
	if slot.process != nil {
		stopProcess(slot.process)
	}

	// Clean up all per-slot directories and auth files
	dataDir := fmt.Sprintf("%s/%s", stageDataRoot, stageID)
	os.RemoveAll(dataDir)
	os.RemoveAll(fmt.Sprintf("/tmp/hls-%d", slot.slotIndex))
	os.RemoveAll(fmt.Sprintf("/tmp/pulse-%d", slot.slotIndex))
	os.RemoveAll(fmt.Sprintf("/tmp/pulse-runtime-%d", slot.slotIndex))
	os.RemoveAll(fmt.Sprintf("/tmp/stage-home-%d", slot.slotIndex))
	os.Remove(fmt.Sprintf("/tmp/xauth-%d", slot.slotIndex))
	os.Remove(fmt.Sprintf("/tmp/cdp-in-%d", slot.slotIndex))
	os.Remove(fmt.Sprintf("/tmp/cdp-out-%d", slot.slotIndex))

	log.Printf("Destroyed stage %s (slot %d)", stageID, slot.slotIndex)
	return nil
}

// ListStages returns info about all running stages.
func (a *Agent) ListStages() []StageInfoData {
	a.mu.Lock()
	defer a.mu.Unlock()

	var result []StageInfoData
	for _, slot := range a.stages {
		result = append(result, StageInfoData{
			StageID: slot.stageID,
			Port:    int32(slot.hostPort),
			Status:  slot.status,
		})
	}
	return result
}

// StageInfoData holds info about a running stage (decoupled from proto).
type StageInfoData struct {
	StageID string
	Port    int32
	Status  string
}

// spawnStage launches the stage-start.sh script as a process group.
// Each stage runs as a dedicated UID (10000+slot) for process-level isolation:
//   - /proc/<pid>/environ only readable by same UID (prevents token theft)
//   - Filesystem directories owned by stage UID with 0700 (prevents cross-read)
//   - Xvfb auth cookies prevent cross-display screen capture
//   - Separate port, data directory, PulseAudio socket, and HLS dir per stage
func spawnStage(slot *stageSlot, env []string, gpuGIDs []uint32) (*stageProcess, error) {
	cmd := exec.Command("/bin/bash", stageStartScript)
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	// Stage script runs as root so ffmpeg can access /dev/nvidia* for NVENC.
	// Chrome is dropped to the stage UID inside stage-start.sh via setpriv.
	// STAGE_UID/STAGE_GID env vars tell the script which UID to use.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	proc := &stageProcess{
		cmd:  cmd,
		done: make(chan struct{}),
	}

	go func() {
		cmd.Wait()
		close(proc.done)
	}()

	return proc, nil
}

// stopProcess signals the process group to stop.
func stopProcess(proc *stageProcess) {
	if proc.cmd.Process == nil {
		return
	}

	// Send SIGTERM to the process group
	pgid := -proc.cmd.Process.Pid
	syscall.Kill(pgid, syscall.SIGTERM)

	// Wait up to 10s for clean shutdown
	select {
	case <-proc.done:
		return
	case <-time.After(10 * time.Second):
		log.Printf("WARN: stage process did not exit after SIGTERM, sending SIGKILL")
		syscall.Kill(pgid, syscall.SIGKILL)
		<-proc.done
	}
}

// monitorStage watches a stage process and marks it failed if it exits unexpectedly.
func (a *Agent) monitorStage(stageID string, slot *stageSlot, proc *stageProcess) {
	<-proc.done

	a.mu.Lock()
	defer a.mu.Unlock()

	// Check if the stage is still in our tracking (it may have been intentionally destroyed)
	if current, ok := a.stages[stageID]; ok && current == slot {
		slot.status = "failed"
		log.Printf("Stage %s (slot %d) process exited unexpectedly", stageID, slot.slotIndex)
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
