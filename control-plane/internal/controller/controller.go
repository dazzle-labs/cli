package controller

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/browser-streamer/control-plane/internal/runpod"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

var gpuNodeGVR = schema.GroupVersionResource{
	Group:    "dazzle.fm",
	Version:  "v1",
	Resource: "gpunodes",
}

var gpuNodeClassGVR = schema.GroupVersionResource{
	Group:    "dazzle.fm",
	Version:  "v1",
	Resource: "gpunodeclasses",
}

// AgentPort is the internal port the agent listens on inside the RunPod container.
const AgentPort = 60443

// StageBasePort is the first internal port for stage slots (60444, 60445, ...).
const StageBasePort = 60444

const finalizerName = "dazzle.fm/gpu-node-controller"

// DefaultChromeFlags is the baseline set of Chrome policy flags for GPU agent pods.
// Per-slot runtime flags (display, user-data-dir, window-size, CDP) are appended
// by stage-start.sh at launch time.
// Can be overridden via GPUNodeClass spec.template.env.CHROME_FLAGS.
const DefaultChromeFlags = "--no-sandbox --use-gl=desktop --ignore-gpu-blocklist " +
	"--disable-gpu-compositing --disable-gpu-watchdog " +
	"--no-first-run --no-default-browser-check --disable-infobars " +
	"--autoplay-policy=no-user-gesture-required " +
	"--renderer-process-limit=1 --kiosk " +
	"--disable-background-timer-throttling " +
	"--disable-backgrounding-occluded-windows --disable-renderer-backgrounding"

// GPUNodeController manages GPUNode CRDs via a polling reconciliation loop.
type GPUNodeController struct {
	dynamicClient dynamic.Interface
	runpodClient  *runpod.Client
	namespace     string
	healthClient  *http.Client
	tickCount     int
}

// NewGPUNodeController creates a new controller.
func NewGPUNodeController(dynamicClient dynamic.Interface, runpodClient *runpod.Client, namespace string, tlsConfig *tls.Config) *GPUNodeController {
	healthClient := &http.Client{Timeout: 10 * time.Second}
	if tlsConfig != nil {
		healthClient.Transport = &http.Transport{TLSClientConfig: tlsConfig}
	}
	return &GPUNodeController{
		dynamicClient: dynamicClient,
		runpodClient:  runpodClient,
		namespace:     namespace,
		healthClient:  healthClient,
	}
}

// Start launches the reconciliation loop (10s tick). Blocks until ctx is cancelled.
func (c *GPUNodeController) Start(ctx context.Context) {
	log.Println("GPUNode controller started (10s tick)")
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("GPUNode controller stopped")
			return
		case <-ticker.C:
			c.tickCount++
			if err := c.reconcileAll(ctx); err != nil {
				log.Printf("GPUNode reconcile error: %v", err)
			}
		}
	}
}

func (c *GPUNodeController) reconcileAll(ctx context.Context) error {
	list, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("list gpunodes: %w", err)
	}

	for i := range list.Items {
		if err := c.reconcileNode(ctx, &list.Items[i]); err != nil {
			log.Printf("GPUNode %s reconcile error: %v", list.Items[i].GetName(), err)
		}
	}
	return nil
}

func (c *GPUNodeController) reconcileNode(ctx context.Context, node *unstructured.Unstructured) error {
	name := node.GetName()
	status := getNestedMap(node, "status")
	phase := getNestedString(status, "phase")
	deletionTimestamp := node.GetDeletionTimestamp()

	// Handle deletion
	if deletionTimestamp != nil && phase != "Draining" {
		return c.transitionPhase(ctx, node, "Draining")
	}

	switch phase {
	case "", "Pending":
		return c.handleNew(ctx, node)
	case "Provisioning":
		return c.handleProvisioning(ctx, node)
	case "Initializing":
		return c.handleInitializing(ctx, node)
	case "Ready":
		return c.handleReady(ctx, node)
	case "Draining":
		return c.handleDraining(ctx, node)
	case "Failed", "Deleted":
		// Terminal states — no action
		return nil
	default:
		log.Printf("GPUNode %s: unknown phase %q", name, phase)
		return nil
	}
}

func (c *GPUNodeController) handleNew(ctx context.Context, node *unstructured.Unstructured) error {
	name := node.GetName()
	spec := getNestedMap(node, "spec")
	classRef := getMapField(spec, "nodeClassRef")
	className := getNestedString(classRef, "name")

	if className == "" {
		return fmt.Errorf("GPUNode %s: missing spec.nodeClassRef.name", name)
	}

	// Read GPUNodeClass
	classObj, err := c.dynamicClient.Resource(gpuNodeClassGVR).Namespace(c.namespace).Get(ctx, className, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get GPUNodeClass %s: %w", className, err)
	}
	classSpec := getMapField(classObj.Object, "spec")

	provider := getNestedString(classSpec, "provider")
	if provider != "runpod" {
		return fmt.Errorf("GPUNodeClass %s: unsupported provider %q (only 'runpod' is supported)", className, provider)
	}

	gpuTypeId := getNestedString(classSpec, "gpuTypeId")
	cloudType := getNestedString(classSpec, "cloudType")
	if cloudType == "" {
		cloudType = "SECURE"
	}
	containerDisk := getNestedInt(classSpec, "containerDiskInGb")
	if containerDisk == 0 {
		containerDisk = 20
	}

	// Resolve GPU agent image: GPUNodeClass override > GPU_NODE_IMAGE env
	gpuImage := getNestedString(classSpec, "gpuNodeImage")
	if gpuImage == "" {
		gpuImage = os.Getenv("GPU_NODE_IMAGE")
	}
	if gpuImage == "" {
		return fmt.Errorf("GPU_NODE_IMAGE env not set and no gpuNodeImage in GPUNodeClass")
	}

	// Read maxStages from GPUNodeClass (defaults to 3)
	maxStages := getNestedInt(classSpec, "maxStages")
	if maxStages == 0 {
		maxStages = 3
	}

	// Layer 1: Default env vars
	env := map[string]string{
		"CHROME_FLAGS":          DefaultChromeFlags,
		"LIBGL_ALWAYS_SOFTWARE": "0",
		"SIDECAR_VIDEO_CODEC":   "h264_nvenc",
		"DISPLAY":               ":99",
		// Explicitly request all NVIDIA driver capabilities so the
		// nvidia-container-toolkit mounts video (NVENC/NVDEC) and graphics
		// (Vulkan/EGL) libraries — not just compute+utility defaults.
		"NVIDIA_DRIVER_CAPABILITIES": "compute,video,graphics,utility",
		"NVIDIA_VISIBLE_DEVICES":     "all",
	}

	// Layer 2: Operator overrides from GPUNodeClass spec.template
	template := getMapField(classSpec, "template")
	if templateEnv := getMapField(template, "env"); templateEnv != nil {
		for k, v := range templateEnv {
			if s, ok := v.(string); ok {
				env[k] = s
			}
		}
	}

	// Layer 3: Controller-injected values (always win)
	env["MAX_STAGES"] = fmt.Sprintf("%d", maxStages)

	// Sensitive values: use RunPod secrets ({{ RUNPOD_SECRET_... }} syntax)
	// so credentials aren't passed as plaintext in the pod creation API call.
	// RunPod secrets must be pre-created in the RunPod console:
	//   mtls_server_cert, mtls_server_key, mtls_ca_cert,
	//   r2_access_key_id, r2_secret_access_key
	// Set RUNPOD_RAW_SECRETS=true to disable and pass raw values instead.
	useRunPodSecrets := os.Getenv("RUNPOD_RAW_SECRETS") != "true"

	if useRunPodSecrets {
		env["TLS_SERVER_CERT"] = "{{ RUNPOD_SECRET_mtls_server_cert }}"
		env["TLS_SERVER_KEY"] = "{{ RUNPOD_SECRET_mtls_server_key }}"
		env["TLS_CA_CERT"] = "{{ RUNPOD_SECRET_mtls_ca_cert }}"
		env["R2_ACCESS_KEY_ID"] = "{{ RUNPOD_SECRET_r2_access_key_id }}"
		env["R2_SECRET_ACCESS_KEY"] = "{{ RUNPOD_SECRET_r2_secret_access_key }}"
	} else {
		// Fallback: pass raw values from control-plane env (less secure)
		if serverCert := os.Getenv("MTLS_SERVER_CERT"); serverCert != "" {
			env["TLS_SERVER_CERT"] = ensurePEM(serverCert)
		}
		if serverKey := os.Getenv("MTLS_SERVER_KEY"); serverKey != "" {
			env["TLS_SERVER_KEY"] = ensurePEM(serverKey)
		}
		if caCert := os.Getenv("MTLS_CA_CERT"); caCert != "" {
			env["TLS_CA_CERT"] = ensurePEM(caCert)
		}
		if v := os.Getenv("R2_ACCESS_KEY_ID"); v != "" {
			env["R2_ACCESS_KEY_ID"] = v
		}
		if v := os.Getenv("R2_SECRET_ACCESS_KEY"); v != "" {
			env["R2_SECRET_ACCESS_KEY"] = v
		}
	}
	// Non-sensitive R2 config — always from env
	for _, key := range []string{"R2_ENDPOINT", "R2_BUCKET"} {
		if v := os.Getenv(key); v != "" {
			env[key] = v
		}
	}

	// Build port list: agent port + one per stage slot + template extras
	ports := []string{fmt.Sprintf("%d/tcp", AgentPort)}
	for i := int64(0); i < maxStages; i++ {
		ports = append(ports, fmt.Sprintf("%d/tcp", StageBasePort+int(i)))
	}
	if extraPorts, ok := template["ports"].([]interface{}); ok {
		for _, p := range extraPorts {
			if s, ok := p.(string); ok {
				ports = append(ports, s)
			}
		}
	}

	// Create RunPod pod with agent entrypoint
	podInput := runpod.PodInput{
		Name:                fmt.Sprintf("dazzle-gpu-%s", name),
		ImageName:           gpuImage,
		GpuTypeIds:          []string{gpuTypeId},
		GpuCount:            1,
		CloudType:           cloudType,
		ContainerDiskInGb:   int(containerDisk),
		Ports:               ports,
		Env:                 env,
		AllowedCudaVersions: []string{"12.8", "12.9", "13.0"},
	}
	if regAuth := os.Getenv("RUNPOD_REGISTRY_AUTH_ID"); regAuth != "" {
		podInput.ContainerRegistryAuthId = regAuth
	}
	pod, err := c.runpodClient.CreatePod(ctx, podInput)
	if err != nil {
		return fmt.Errorf("create RunPod pod: %w", err)
	}

	log.Printf("GPUNode %s: created RunPod pod %s (gpu=%s, cloud=%s)", name, pod.ID, gpuTypeId, cloudType)

	// Add finalizer (requires Update on metadata, not UpdateStatus)
	addFinalizer(node)
	updated, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Update(ctx, node, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("add finalizer to GPUNode %s: %w", name, err)
	}

	// Update status subresource (separate call required when status subresource is enabled)
	setNestedField(updated, "status", "phase", "Provisioning")
	setNestedField(updated, "status", "runpodPodId", pod.ID)
	setNestedField(updated, "status", "maxStages", maxStages)
	setNestedField(updated, "status", "currentStages", int64(0))
	setNestedField(updated, "status", "lastTransitionTime", time.Now().UTC().Format(time.RFC3339))

	return c.updateStatus(ctx, updated)
}

func (c *GPUNodeController) handleProvisioning(ctx context.Context, node *unstructured.Unstructured) error {
	status := getNestedMap(node, "status")
	podID := getNestedString(status, "runpodPodId")
	if podID == "" {
		return c.transitionPhase(ctx, node, "Failed")
	}

	pod, err := c.runpodClient.GetPod(ctx, podID)
	if err != nil {
		if _, ok := err.(*runpod.ErrNotFound); ok {
			log.Printf("GPUNode %s: RunPod pod %s not found, marking Failed", node.GetName(), podID)
			return c.transitionPhase(ctx, node, "Failed")
		}
		return fmt.Errorf("get RunPod pod %s: %w", podID, err)
	}

	if pod.DesiredStatus == "RUNNING" && pod.PublicIp != "" {
		agentPort := pod.PortMappings[fmt.Sprintf("%d", AgentPort)]

		setNestedField(node, "status", "phase", "Initializing")
		setNestedField(node, "status", "publicIp", pod.PublicIp)
		setNestedField(node, "status", "agentPort", int64(agentPort))
		setNestedField(node, "status", "lastTransitionTime", time.Now().UTC().Format(time.RFC3339))

		// Store all port mappings for stage slot resolution
		portMap := make(map[string]interface{})
		for k, v := range pod.PortMappings {
			portMap[k] = int64(v)
		}
		setNestedField(node, "status", "portMappings", portMap)

		log.Printf("GPUNode %s: provisioned (ip=%s, agentPort=%d)", node.GetName(), pod.PublicIp, agentPort)
		return c.updateStatus(ctx, node)
	}

	return nil // still provisioning
}

func (c *GPUNodeController) handleInitializing(ctx context.Context, node *unstructured.Unstructured) error {
	status := getNestedMap(node, "status")
	ip := getNestedString(status, "publicIp")
	port := getNestedInt(status, "agentPort")
	if ip == "" || port == 0 {
		return nil
	}

	healthURL := fmt.Sprintf("https://%s:%d/_dz_9f7a3b1c/health", ip, port)
	req, err := http.NewRequest("GET", healthURL, nil)
	if err != nil {
		return nil
	}
	resp, err := c.healthClient.Do(req)
	if err != nil {
		log.Printf("GPUNode %s: health check failed: %v", node.GetName(), err)
		return nil // not ready yet
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		setNestedField(node, "status", "phase", "Ready")
		setNestedField(node, "status", "healthFailures", int64(0))
		setNestedField(node, "status", "lastTransitionTime", time.Now().UTC().Format(time.RFC3339))
		log.Printf("GPUNode %s: Ready (ip=%s, agentPort=%d)", node.GetName(), ip, port)
		return c.updateStatus(ctx, node)
	}
	return nil
}

func (c *GPUNodeController) handleReady(ctx context.Context, node *unstructured.Unstructured) error {
	status := getNestedMap(node, "status")
	ip := getNestedString(status, "publicIp")
	port := getNestedInt(status, "agentPort")
	podID := getNestedString(status, "runpodPodId")

	// Refresh port mappings every 5 ticks (~50s)
	if c.tickCount%5 == 0 && podID != "" {
		pod, err := c.runpodClient.GetPod(ctx, podID)
		if err == nil {
			newPort := pod.PortMappings[fmt.Sprintf("%d", AgentPort)]
			if newPort != 0 && newPort != int(port) {
				log.Printf("GPUNode %s: agent port changed %d -> %d", node.GetName(), port, newPort)
				setNestedField(node, "status", "agentPort", int64(newPort))
				port = int64(newPort)
			}
			if pod.PublicIp != "" && pod.PublicIp != ip {
				log.Printf("GPUNode %s: IP changed %s -> %s", node.GetName(), ip, pod.PublicIp)
				setNestedField(node, "status", "publicIp", pod.PublicIp)
				ip = pod.PublicIp
			}
			// Update all port mappings
			portMap := make(map[string]interface{})
			for k, v := range pod.PortMappings {
				portMap[k] = int64(v)
			}
			setNestedField(node, "status", "portMappings", portMap)
		}
	}

	// Health check
	healthURL := fmt.Sprintf("https://%s:%d/_dz_9f7a3b1c/health", ip, port)
	req, err := http.NewRequest("GET", healthURL, nil)
	if err != nil {
		return nil
	}
	resp, herr := c.healthClient.Do(req)
	healthy := herr == nil && resp != nil && resp.StatusCode == http.StatusOK
	if resp != nil {
		resp.Body.Close()
	}

	failures := getNestedInt(status, "healthFailures")
	if healthy {
		needsUpdate := failures > 0
		if failures > 0 {
			setNestedField(node, "status", "healthFailures", int64(0))
		}

		// Drain window: delete idle nodes after 5 minutes with no stages
		currentStages := getNestedInt(status, "currentStages")
		drainAfterStr := getNestedString(status, "drainAfter")
		if currentStages == 0 {
			if drainAfterStr == "" {
				drainAfter := time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339)
				setNestedField(node, "status", "drainAfter", drainAfter)
				log.Printf("GPUNode %s: idle, drain window started (deletes at %s)", node.GetName(), drainAfter)
				needsUpdate = true
			} else if t, err := time.Parse(time.RFC3339, drainAfterStr); err == nil && time.Now().After(t) {
				log.Printf("GPUNode %s: idle drain window expired, deleting", node.GetName())
				return c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Delete(ctx, node.GetName(), metav1.DeleteOptions{})
			}
		} else if drainAfterStr != "" {
			// Stages came back before window expired — cancel drain
			deleteNestedField(node, "status", "drainAfter")
			log.Printf("GPUNode %s: stages resumed, drain window cancelled", node.GetName())
			needsUpdate = true
		}

		if needsUpdate {
			return c.updateStatus(ctx, node)
		}
		return nil
	}

	failures++
	setNestedField(node, "status", "healthFailures", failures)
	if failures >= 3 {
		log.Printf("GPUNode %s: 3 consecutive health failures, marking Failed", node.GetName())
		return c.transitionPhase(ctx, node, "Failed")
	}
	return c.updateStatus(ctx, node)
}

func (c *GPUNodeController) handleDraining(ctx context.Context, node *unstructured.Unstructured) error {
	status := getNestedMap(node, "status")
	podID := getNestedString(status, "runpodPodId")

	if podID != "" {
		if err := c.runpodClient.TerminatePod(ctx, podID); err != nil {
			log.Printf("GPUNode %s: terminate RunPod pod %s: %v", node.GetName(), podID, err)
		} else {
			log.Printf("GPUNode %s: terminated RunPod pod %s", node.GetName(), podID)
		}
	}

	// Remove finalizer to allow k8s to delete the object
	removeFinalizer(node)
	_, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Update(ctx, node, metav1.UpdateOptions{})
	return err
}

// RecoverNodes reconciles all existing GPUNode CRDs on startup.
func (c *GPUNodeController) RecoverNodes(ctx context.Context) {
	list, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Printf("GPUNode recovery: failed to list: %v", err)
		return
	}

	for i := range list.Items {
		node := &list.Items[i]
		status := getNestedMap(node, "status")
		phase := getNestedString(status, "phase")
		podID := getNestedString(status, "runpodPodId")
		name := node.GetName()

		if podID == "" || (phase != "Provisioning" && phase != "Initializing" && phase != "Ready") {
			continue
		}

		pod, err := c.runpodClient.GetPod(ctx, podID)
		if err != nil {
			if _, ok := err.(*runpod.ErrNotFound); ok {
				log.Printf("GPUNode %s: RunPod pod %s not found on recovery, marking Failed", name, podID)
				c.transitionPhase(ctx, node, "Failed")
			} else {
				log.Printf("GPUNode %s: failed to query RunPod on recovery: %v (skipping)", name, err)
			}
			continue
		}

		if pod.DesiredStatus == "RUNNING" && pod.PublicIp != "" {
			agentPort := pod.PortMappings[fmt.Sprintf("%d", AgentPort)]
			setNestedField(node, "status", "publicIp", pod.PublicIp)
			setNestedField(node, "status", "agentPort", int64(agentPort))

			// Update port mappings
			portMap := make(map[string]interface{})
			for k, v := range pod.PortMappings {
				portMap[k] = int64(v)
			}
			setNestedField(node, "status", "portMappings", portMap)

			if phase == "Provisioning" {
				setNestedField(node, "status", "phase", "Initializing")
				setNestedField(node, "status", "lastTransitionTime", time.Now().UTC().Format(time.RFC3339))
			}
			if err := c.updateStatus(ctx, node); err != nil {
				log.Printf("GPUNode %s: recovery update failed: %v", name, err)
			} else {
				log.Printf("GPUNode %s: recovered (phase=%s, ip=%s)", name, getNestedString(getNestedMap(node, "status"), "phase"), pod.PublicIp)
			}
		} else if pod.DesiredStatus == "EXITED" {
			log.Printf("GPUNode %s: RunPod pod %s exited, marking Failed", name, podID)
			c.transitionPhase(ctx, node, "Failed")
		}
	}
}

// ListReadyNodes returns all GPUNodes in Ready phase.
func (c *GPUNodeController) ListReadyNodes(ctx context.Context) ([]*unstructured.Unstructured, error) {
	list, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list gpunodes: %w", err)
	}
	var ready []*unstructured.Unstructured
	for i := range list.Items {
		status := getNestedMap(&list.Items[i], "status")
		if getNestedString(status, "phase") == "Ready" {
			ready = append(ready, &list.Items[i])
		}
	}
	return ready, nil
}

// UpdateNodeStages updates the currentStages count and stages list on a GPUNode.
func (c *GPUNodeController) UpdateNodeStages(ctx context.Context, nodeName string, currentStages int64, stages []interface{}) error {
	node, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get gpunode %s: %w", nodeName, err)
	}
	setNestedField(node, "status", "currentStages", currentStages)
	setNestedField(node, "status", "stages", stages)
	return c.updateStatus(ctx, node)
}

// --- helpers ---

func (c *GPUNodeController) transitionPhase(ctx context.Context, node *unstructured.Unstructured, phase string) error {
	setNestedField(node, "status", "phase", phase)
	setNestedField(node, "status", "lastTransitionTime", time.Now().UTC().Format(time.RFC3339))
	return c.updateStatus(ctx, node)
}

func (c *GPUNodeController) updateStatus(ctx context.Context, node *unstructured.Unstructured) error {
	_, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).UpdateStatus(ctx, node, metav1.UpdateOptions{})
	return err
}

// updateNode updates the full object (including metadata like finalizers).
func (c *GPUNodeController) updateNode(ctx context.Context, node *unstructured.Unstructured) error {
	_, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Update(ctx, node, metav1.UpdateOptions{})
	return err
}

func addFinalizer(node *unstructured.Unstructured) {
	finalizers := node.GetFinalizers()
	for _, f := range finalizers {
		if f == finalizerName {
			return
		}
	}
	node.SetFinalizers(append(finalizers, finalizerName))
}

func removeFinalizer(node *unstructured.Unstructured) {
	finalizers := node.GetFinalizers()
	var updated []string
	for _, f := range finalizers {
		if f != finalizerName {
			updated = append(updated, f)
		}
	}
	node.SetFinalizers(updated)
}

func getNestedMap(obj *unstructured.Unstructured, key string) map[string]interface{} {
	if obj == nil {
		return nil
	}
	return getMapField(obj.Object, key)
}

func getMapField(m map[string]interface{}, key string) map[string]interface{} {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok {
		return nil
	}
	mm, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	return mm
}

func getNestedString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

func getNestedInt(m map[string]interface{}, key string) int64 {
	if m == nil {
		return 0
	}
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	case int:
		return int64(n)
	}
	return 0
}

func deleteNestedField(node *unstructured.Unstructured, section, key string) {
	m, ok := node.Object[section]
	if !ok {
		return
	}
	mm, ok := m.(map[string]interface{})
	if !ok {
		return
	}
	delete(mm, key)
}

func setNestedField(node *unstructured.Unstructured, section, key string, value interface{}) {
	m, ok := node.Object[section]
	if !ok {
		m = map[string]interface{}{}
		node.Object[section] = m
	}
	mm, ok := m.(map[string]interface{})
	if !ok {
		mm = map[string]interface{}{}
		node.Object[section] = mm
	}
	mm[key] = value
}


// ensurePEM returns the PEM data as a string, decoding from base64 if needed.
// The agent/sidecar accept both raw PEM and base64-encoded PEM, but raw PEM
// is preferred to avoid base64 mangling by intermediate systems (e.g. RunPod).
func ensurePEM(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "-----BEGIN") {
		return s
	}
	// Assume base64-encoded PEM — decode it
	b, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(s, "\n", ""))
	if err != nil {
		return s // pass through as-is if decode fails
	}
	return string(b)
}
