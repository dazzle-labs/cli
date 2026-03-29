package controller

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/gofrs/uuid/v5"
	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
	sidecarv1connect "github.com/browser-streamer/sidecar/gen/api/v1/sidecarv1connect"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

var gpuStageGVR = schema.GroupVersionResource{
	Group:    "dazzle.fm",
	Version:  "v1",
	Resource: "gpustages",
}

// GPUStageGVR returns the GVR for GPUStage, for use by callers in main.
func GPUStageGVR() schema.GroupVersionResource { return gpuStageGVR }

const stageFinalizer = "dazzle.fm/gpu-stage"

// GPUStageController manages GPUStage CRDs via a polling reconciliation loop.
// It owns slot assignment and GPUNode lifecycle, freeing main.go from imperative
// provisioning logic.
type GPUStageController struct {
	dynamicClient   dynamic.Interface
	db              *sql.DB
	namespace       string
	agentHTTPClient *http.Client
}

// NewGPUStageController creates a new controller.
func NewGPUStageController(dynamicClient dynamic.Interface, db *sql.DB, namespace string, agentHTTPClient *http.Client) *GPUStageController {
	return &GPUStageController{
		dynamicClient:   dynamicClient,
		db:              db,
		namespace:       namespace,
		agentHTTPClient: agentHTTPClient,
	}
}

// Run starts the reconciliation loop (5s tick). Blocks until ctx is cancelled.
func (c *GPUStageController) Run(ctx context.Context) {
	log.Println("GPUStage controller started (5s tick)")
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("GPUStage controller stopped")
			return
		case <-ticker.C:
			if err := c.reconcileAll(ctx); err != nil {
				log.Printf("GPUStage reconcile error: %v", err)
			}
		}
	}
}

func (c *GPUStageController) reconcileAll(ctx context.Context) error {
	list, err := c.dynamicClient.Resource(gpuStageGVR).Namespace(c.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("list gpustages: %w", err)
	}
	for i := range list.Items {
		if err := c.reconcileStage(ctx, &list.Items[i]); err != nil {
			log.Printf("GPUStage %s reconcile error: %v", list.Items[i].GetName(), err)
		}
	}
	return nil
}

func (c *GPUStageController) reconcileStage(ctx context.Context, gs *unstructured.Unstructured) error {
	status := getNestedMap(gs, "status")
	phase := getNestedString(status, "phase")

	if gs.GetDeletionTimestamp() != nil {
		return c.handleTerminating(ctx, gs)
	}

	switch phase {
	case "", "Pending":
		return c.handlePending(ctx, gs)
	case "Scheduling":
		return c.handleScheduling(ctx, gs)
	case "Provisioning":
		return c.handleProvisioning(ctx, gs)
	case "Running", "Failed":
		return nil
	case "Terminating":
		return c.handleTerminating(ctx, gs)
	default:
		return nil
	}
}

func (c *GPUStageController) handlePending(ctx context.Context, gs *unstructured.Unstructured) error {
	// Add finalizer if missing
	finalizers := gs.GetFinalizers()
	hasFinalizer := false
	for _, f := range finalizers {
		if f == stageFinalizer {
			hasFinalizer = true
			break
		}
	}
	if !hasFinalizer {
		gs.SetFinalizers(append(finalizers, stageFinalizer))
		updated, err := c.dynamicClient.Resource(gpuStageGVR).Namespace(c.namespace).Update(ctx, gs, metav1.UpdateOptions{})
		if err != nil {
			return fmt.Errorf("add finalizer to GPUStage %s: %w", gs.GetName(), err)
		}
		gs = updated
	}
	return c.setStagePhase(ctx, gs, "Scheduling", "")
}

func (c *GPUStageController) handleScheduling(ctx context.Context, gs *unstructured.Unstructured) error {
	spec := getNestedMap(gs, "spec")
	stageID := getNestedString(spec, "stageId")
	userID := getNestedString(spec, "userId")
	nodeClassName := ""
	if ncRef := getMapField(spec, "nodeClassRef"); ncRef != nil {
		nodeClassName = getNestedString(ncRef, "name")
	}

	list, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("list gpunodes: %w", err)
	}

	var readyNodes []*unstructured.Unstructured
	var provisioningNodeName string

	for i := range list.Items {
		node := &list.Items[i]
		nodeStatus := getNestedMap(node, "status")
		phase := getNestedString(nodeStatus, "phase")

		// Filter by nodeClassRef if specified
		if nodeClassName != "" {
			nodeSpec := getNestedMap(node, "spec")
			classRef := getMapField(nodeSpec, "nodeClassRef")
			if getNestedString(classRef, "name") != nodeClassName {
				continue
			}
		}

		switch phase {
		case "Ready":
			current := getNestedInt(nodeStatus, "currentStages")
			max := getNestedInt(nodeStatus, "maxStages")
			if max == 0 {
				max = 3
			}
			if current < max {
				readyNodes = append(readyNodes, node)
			}
		case "Provisioning", "Initializing":
			if provisioningNodeName == "" {
				provisioningNodeName = node.GetName()
			}
		}
	}

	if len(readyNodes) > 0 {
		// Pick lowest utilization
		best := readyNodes[0]
		bestUtil := getNestedInt(getNestedMap(best, "status"), "currentStages")
		for _, n := range readyNodes[1:] {
			u := getNestedInt(getNestedMap(n, "status"), "currentStages")
			if u < bestUtil {
				best = n
				bestUtil = u
			}
		}
		return c.assignStageToNode(ctx, gs, best, stageID, userID)
	}

	if provisioningNodeName != "" {
		setNestedField(gs, "status", "provisioningNode", provisioningNodeName)
		return c.setStagePhase(ctx, gs, "Provisioning", "Waiting for node "+provisioningNodeName)
	}

	// No ready or provisioning node — provision a new one
	targetClass := nodeClassName
	if targetClass == "" {
		targetClass = os.Getenv("DEFAULT_GPU_NODE_CLASS")
	}
	if targetClass == "" {
		return c.setStagePhase(ctx, gs, "Failed", "no GPU node available and DEFAULT_GPU_NODE_CLASS not set")
	}

	newNodeName := "runpod-" + targetClass + "-" + uuid.Must(uuid.NewV7()).String()[:8]
	newNode := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "dazzle.fm/v1",
			"kind":       "GPUNode",
			"metadata": map[string]interface{}{
				"name":      newNodeName,
				"namespace": c.namespace,
			},
			"spec": map[string]interface{}{
				"nodeClassRef": map[string]interface{}{
					"name": targetClass,
				},
			},
		},
	}
	_, err = c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Create(ctx, newNode, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("create GPUNode: %w", err)
	}

	log.Printf("GPUStage %s: provisioning new GPUNode %s (class=%s)", gs.GetName(), newNodeName, targetClass)
	setNestedField(gs, "status", "provisioningNode", newNodeName)
	return c.setStagePhase(ctx, gs, "Provisioning", "Provisioning node "+newNodeName)
}

func (c *GPUStageController) handleProvisioning(ctx context.Context, gs *unstructured.Unstructured) error {
	status := getNestedMap(gs, "status")
	spec := getNestedMap(gs, "spec")
	stageID := getNestedString(spec, "stageId")
	userID := getNestedString(spec, "userId")
	provisioningNode := getNestedString(status, "provisioningNode")

	if provisioningNode == "" {
		return c.setStagePhase(ctx, gs, "Scheduling", "")
	}

	node, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Get(ctx, provisioningNode, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get provisioning node %s: %w", provisioningNode, err)
	}

	nodeStatus := getNestedMap(node, "status")
	nodePhase := getNestedString(nodeStatus, "phase")

	switch nodePhase {
	case "Ready":
		return c.assignStageToNode(ctx, gs, node, stageID, userID)
	case "Failed":
		return c.setStagePhase(ctx, gs, "Failed", "GPUNode "+provisioningNode+" failed")
	default:
		return nil // still provisioning — wait
	}
}

func (c *GPUStageController) assignStageToNode(ctx context.Context, gs *unstructured.Unstructured, node *unstructured.Unstructured, stageID, userID string) error {
	nodeStatus := getNestedMap(node, "status")
	nodeName := node.GetName()
	publicIP := getNestedString(nodeStatus, "publicIp")
	agentPort := getNestedInt(nodeStatus, "agentPort")
	portMappings := getMapField(nodeStatus, "portMappings")
	runpodPodID := getNestedString(nodeStatus, "runpodPodId")

	agentURL := fmt.Sprintf("https://%s:%d", publicIP, agentPort)

	// Call agent CreateStage RPC — retry once if stage already exists
	assignedPort, err := c.agentCreateStage(ctx, agentURL, stageID, userID)
	if err != nil && strings.Contains(err.Error(), "already exists") {
		log.Printf("GPUStage %s: stage already on agent, destroying and retrying", gs.GetName())
		_ = c.agentDestroyStage(ctx, agentURL, stageID)
		assignedPort, err = c.agentCreateStage(ctx, agentURL, stageID, userID)
	}
	if err != nil {
		return c.setStagePhase(ctx, gs, "Failed", fmt.Sprintf("agent CreateStage: %v", err))
	}

	// Resolve external port from port mappings
	internalPortKey := fmt.Sprintf("%d", assignedPort)
	externalPort := getNestedInt(portMappings, internalPortKey)
	if externalPort == 0 {
		externalPort = int64(assignedPort)
		log.Printf("GPUStage %s: no port mapping for %s, using direct port", gs.GetName(), internalPortKey)
	}

	sidecarURL := fmt.Sprintf("https://%s:%d/_dz_9f7a3b1c", publicIP, externalPort)

	// Update DB
	if c.db != nil {
		stageUpdateProvider(c.db, stageID, "gpu", runpodPodID, sidecarURL, nodeName)
		stageUpdateStatus(c.db, stageID, "running")
	}

	// Increment GPUNode currentStages and cancel any drain window
	currentStages := getNestedInt(nodeStatus, "currentStages") + 1
	stagesList, _ := nodeStatus["stages"].([]interface{})
	stagesList = append(stagesList, map[string]interface{}{
		"stageId": stageID,
		"port":    int64(assignedPort),
		"status":  "running",
	})
	freshNode, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Get(ctx, nodeName, metav1.GetOptions{})
	if err == nil {
		setNestedField(freshNode, "status", "currentStages", currentStages)
		setNestedField(freshNode, "status", "stages", stagesList)
		deleteNestedField(freshNode, "status", "drainAfter") // cancel drain if active
		if _, uerr := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).UpdateStatus(ctx, freshNode, metav1.UpdateOptions{}); uerr != nil {
			log.Printf("GPUStage %s: update GPUNode %s stages: %v", gs.GetName(), nodeName, uerr)
		}
	}

	// Transition GPUStage to Running
	setNestedField(gs, "status", "assignedNode", nodeName)
	setNestedField(gs, "status", "assignedPort", int64(assignedPort))
	setNestedField(gs, "status", "sidecarUrl", sidecarURL)
	setNestedField(gs, "status", "provisioningNode", "")
	log.Printf("GPUStage %s: Running on %s (internalPort=%d externalPort=%d)", gs.GetName(), nodeName, assignedPort, externalPort)
	return c.setStagePhase(ctx, gs, "Running", "")
}

func (c *GPUStageController) handleTerminating(ctx context.Context, gs *unstructured.Unstructured) error {
	status := getNestedMap(gs, "status")
	spec := getNestedMap(gs, "spec")
	stageID := getNestedString(spec, "stageId")
	assignedNode := getNestedString(status, "assignedNode")

	if assignedNode != "" {
		node, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Get(ctx, assignedNode, metav1.GetOptions{})
		if err == nil {
			nodeStatus := getNestedMap(node, "status")
			publicIP := getNestedString(nodeStatus, "publicIp")
			agentPort := getNestedInt(nodeStatus, "agentPort")
			agentURL := fmt.Sprintf("https://%s:%d", publicIP, agentPort)

			if err := c.agentDestroyStage(ctx, agentURL, stageID); err != nil {
				log.Printf("GPUStage %s: agent DestroyStage: %v", gs.GetName(), err)
			}

			// Decrement GPUNode currentStages
			currentStages := getNestedInt(nodeStatus, "currentStages")
			if currentStages > 0 {
				currentStages--
			}
			stagesList, _ := nodeStatus["stages"].([]interface{})
			var updatedStages []interface{}
			for _, s := range stagesList {
				sm, ok := s.(map[string]interface{})
				if ok && sm["stageId"] == stageID {
					continue
				}
				updatedStages = append(updatedStages, s)
			}

			freshNode, err := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).Get(ctx, assignedNode, metav1.GetOptions{})
			if err == nil {
				setNestedField(freshNode, "status", "currentStages", currentStages)
				setNestedField(freshNode, "status", "stages", updatedStages)
				if currentStages == 0 {
					// Start idle drain window
					drainAfter := time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339)
					setNestedField(freshNode, "status", "drainAfter", drainAfter)
					log.Printf("GPUStage %s: GPUNode %s is idle, drain window started (deletes at %s)", gs.GetName(), assignedNode, drainAfter)
				}
				if _, uerr := c.dynamicClient.Resource(gpuNodeGVR).Namespace(c.namespace).UpdateStatus(ctx, freshNode, metav1.UpdateOptions{}); uerr != nil {
					log.Printf("GPUStage %s: update GPUNode %s after termination: %v", gs.GetName(), assignedNode, uerr)
				}
			}
		}
	}

	// Update DB — clear runtime fields, set inactive
	if c.db != nil {
		stageUpdateProvider(c.db, stageID, "gpu", "", "", "")
		stageUpdateStatus(c.db, stageID, "inactive")
	}

	// Remove finalizer to allow k8s to delete the object
	finalizers := gs.GetFinalizers()
	var remaining []string
	for _, f := range finalizers {
		if f != stageFinalizer {
			remaining = append(remaining, f)
		}
	}
	gs.SetFinalizers(remaining)
	_, err := c.dynamicClient.Resource(gpuStageGVR).Namespace(c.namespace).Update(ctx, gs, metav1.UpdateOptions{})
	return err
}

func (c *GPUStageController) setStagePhase(ctx context.Context, gs *unstructured.Unstructured, phase, message string) error {
	setNestedField(gs, "status", "phase", phase)
	setNestedField(gs, "status", "message", message)
	setNestedField(gs, "status", "lastTransitionTime", time.Now().UTC().Format(time.RFC3339))
	_, err := c.dynamicClient.Resource(gpuStageGVR).Namespace(c.namespace).UpdateStatus(ctx, gs, metav1.UpdateOptions{})
	return err
}

// WaitForRunning polls the GPUStage CR until it reaches Running or Failed phase.
// Returns the sidecarUrl on success.
func (c *GPUStageController) WaitForRunning(ctx context.Context, stageCRName string) (string, error) {
	for {
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("timeout waiting for GPUStage %s to become Running", stageCRName)
		case <-time.After(2 * time.Second):
		}

		gs, err := c.dynamicClient.Resource(gpuStageGVR).Namespace(c.namespace).Get(ctx, stageCRName, metav1.GetOptions{})
		if err != nil {
			return "", fmt.Errorf("get GPUStage %s: %w", stageCRName, err)
		}

		status := getNestedMap(gs, "status")
		phase := getNestedString(status, "phase")
		switch phase {
		case "Running":
			return getNestedString(status, "sidecarUrl"), nil
		case "Failed":
			return "", fmt.Errorf("GPUStage %s failed: %s", stageCRName, getNestedString(status, "message"))
		}
	}
}

// --- Agent RPC ---

func (c *GPUStageController) agentCreateStage(ctx context.Context, agentURL, stageID, userID string) (int32, error) {
	httpClient := c.agentHTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}

	client := sidecarv1connect.NewAgentServiceClient(httpClient, agentURL)
	req := &sidecarv1.CreateStageRequest{
		StageId: stageID,
		UserId:  userID,
	}

	r2Endpoint := os.Getenv("R2_ENDPOINT")
	r2AccessKey := os.Getenv("R2_ACCESS_KEY_ID")
	r2SecretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	r2Bucket := os.Getenv("R2_BUCKET")
	if r2Endpoint != "" && r2AccessKey != "" && r2SecretKey != "" {
		req.R2Config = &sidecarv1.R2Config{
			Endpoint:        r2Endpoint,
			AccessKeyId:     r2AccessKey,
			SecretAccessKey: r2SecretKey,
			Bucket:          r2Bucket,
		}
	}

	resp, err := client.CreateStage(ctx, connect.NewRequest(req))
	if err != nil {
		return 0, err
	}
	return resp.Msg.Port, nil
}

func (c *GPUStageController) agentDestroyStage(ctx context.Context, agentURL, stageID string) error {
	httpClient := c.agentHTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}

	client := sidecarv1connect.NewAgentServiceClient(httpClient, agentURL)
	_, err := client.DestroyStage(ctx, connect.NewRequest(&sidecarv1.DestroyStageRequest{StageId: stageID}))
	return err
}

// --- DB helpers (package-level to avoid importing main) ---

func stageUpdateProvider(db *sql.DB, id, provider, runpodPodID, sidecarURL, gpuNodeName string) {
	db.Exec(
		`UPDATE stages SET provider=$2, runpod_pod_id=$3, sidecar_url=$4, gpu_node_name=$5, updated_at=NOW() WHERE id=$1`,
		id,
		provider,
		nullableString(runpodPodID),
		nullableString(sidecarURL),
		nullableString(gpuNodeName),
	)
}

func stageUpdateStatus(db *sql.DB, id, status string) {
	db.Exec(`UPDATE stages SET status=$2, updated_at=NOW() WHERE id=$1`, id, status)
}

func nullableString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}
