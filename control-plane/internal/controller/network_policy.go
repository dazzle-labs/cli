package controller

import (
	"context"
	"fmt"
	"log"
	"sort"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

var ciliumNetworkPolicyGVR = schema.GroupVersionResource{
	Group:    "cilium.io",
	Version:  "v2",
	Resource: "ciliumnetworkpolicies",
}

const gpuEgressPolicyName = "control-plane-egress-gpu-nodes"

// reconcileGPUNodeEgressPolicy creates or updates a CiliumNetworkPolicy that
// restricts control-plane egress to only the public IPs of known GPU nodes.
// This replaces the wide-open 0.0.0.0/0 rule with a dynamic /32 allowlist.
func reconcileGPUNodeEgressPolicy(ctx context.Context, client dynamic.Interface, namespace string, nodes []unstructured.Unstructured) error {
	// Collect unique, non-empty public IPs from all GPU nodes
	seen := make(map[string]bool)
	for i := range nodes {
		status := getNestedMap(&nodes[i], "status")
		ip := getNestedString(status, "publicIp")
		if ip != "" {
			seen[ip] = true
		}
	}

	ips := make([]string, 0, len(seen))
	for ip := range seen {
		ips = append(ips, ip)
	}
	sort.Strings(ips) // deterministic ordering to avoid spurious updates

	// Build toCIDRSet entries
	cidrSet := make([]interface{}, len(ips))
	for i, ip := range ips {
		cidrSet[i] = map[string]interface{}{
			"cidr": fmt.Sprintf("%s/32", ip),
		}
	}

	// Build the desired policy object
	desired := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "cilium.io/v2",
			"kind":       "CiliumNetworkPolicy",
			"metadata": map[string]interface{}{
				"name":      gpuEgressPolicyName,
				"namespace": namespace,
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "gpu-node-controller",
				},
			},
			"spec": map[string]interface{}{
				"endpointSelector": map[string]interface{}{
					"matchLabels": map[string]interface{}{
						"app": "control-plane",
					},
				},
				"egress": buildEgressRules(cidrSet),
			},
		},
	}

	res := client.Resource(ciliumNetworkPolicyGVR).Namespace(namespace)

	existing, err := res.Get(ctx, gpuEgressPolicyName, metav1.GetOptions{})
	if err != nil {
		// Policy doesn't exist — create it
		if _, createErr := res.Create(ctx, desired, metav1.CreateOptions{}); createErr != nil {
			return fmt.Errorf("create %s: %w", gpuEgressPolicyName, createErr)
		}
		log.Printf("GPU egress policy: created with %d IPs", len(ips))
		return nil
	}

	// Policy exists — check if CIDRs changed
	if cidrSetMatches(existing, cidrSet) {
		return nil // no change
	}

	// Update: preserve resourceVersion for optimistic concurrency
	desired.SetResourceVersion(existing.GetResourceVersion())
	if _, err := res.Update(ctx, desired, metav1.UpdateOptions{}); err != nil {
		return fmt.Errorf("update %s: %w", gpuEgressPolicyName, err)
	}
	log.Printf("GPU egress policy: updated to %d IPs", len(ips))
	return nil
}

// buildEgressRules returns the egress array for the CiliumNetworkPolicy.
// When there are no IPs, returns an empty egress list (denies all on this policy).
func buildEgressRules(cidrSet []interface{}) []interface{} {
	if len(cidrSet) == 0 {
		return []interface{}{}
	}
	return []interface{}{
		map[string]interface{}{
			"toCIDRSet": cidrSet,
		},
	}
}

// cidrSetMatches checks whether the existing policy already has the desired CIDRs.
func cidrSetMatches(existing *unstructured.Unstructured, desiredCIDRs []interface{}) bool {
	spec, ok := existing.Object["spec"].(map[string]interface{})
	if !ok {
		return false
	}
	egress, ok := spec["egress"].([]interface{})
	if !ok {
		return len(desiredCIDRs) == 0
	}

	// Empty desired = empty egress
	if len(desiredCIDRs) == 0 {
		return len(egress) == 0
	}
	if len(egress) != 1 {
		return false
	}

	rule, ok := egress[0].(map[string]interface{})
	if !ok {
		return false
	}
	existingCIDRs, ok := rule["toCIDRSet"].([]interface{})
	if !ok {
		return false
	}
	if len(existingCIDRs) != len(desiredCIDRs) {
		return false
	}

	// Extract CIDR strings for comparison
	existingSet := make(map[string]bool, len(existingCIDRs))
	for _, c := range existingCIDRs {
		if m, ok := c.(map[string]interface{}); ok {
			if cidr, ok := m["cidr"].(string); ok {
				existingSet[cidr] = true
			}
		}
	}
	for _, c := range desiredCIDRs {
		if m, ok := c.(map[string]interface{}); ok {
			if cidr, ok := m["cidr"].(string); ok {
				if !existingSet[cidr] {
					return false
				}
			}
		}
	}
	return true
}
