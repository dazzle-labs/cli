# K8s infrastructure Makefile
# Modes:
#   Local Kind:  KUBE_ARGS="--context kind-browser-streamer"
#   Production:  KUBECONFIG=/path/to/decrypted-kubeconfig
#   CI/direct:   KUBECONFIG already set in environment

SHELL := /bin/bash

KUBE_ARGS ?=
KUBECTL   := kubectl $(KUBE_ARGS)
HELM      := helm $(KUBE_ARGS)

_cyan   = \033[36m
_green  = \033[32m
_bold   = \033[1m
_reset  = \033[0m
STEP    = @printf "$(_bold)$(_cyan)── %s ──$(_reset)\n"
OK      = @printf "$(_bold)$(_green)✓ %s$(_reset)\n"

.PHONY: apply-secrets cilium/install cilium/uninstall prometheus/install prometheus/uninstall trimaran/install trimaran/uninstall deploy \
       current-cp-image verify

apply-secrets: ## Decrypt SOPS secrets and apply them to the cluster
	$(STEP) "Applying secrets"
	@$(KUBECTL) create namespace monitoring --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@for secret in secrets/*.yaml; do \
		[ -f "$$secret" ] || continue; \
		echo "  $$secret"; \
		sops --decrypt "$$secret" | $(KUBECTL) apply -f -; \
	done
	$(OK) "Secrets applied"

CILIUM_VERSION     := 1.17.0
PROMETHEUS_VERSION := kube-prometheus-stack

cilium/install: ## Install/upgrade Cilium CNI to the cluster (skips if already at correct version)
	@current=$$($(HELM) list -n kube-system -f cilium -o json 2>/dev/null | \
		python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['chart'] if d else '')" 2>/dev/null); \
	if [ "$$current" = "cilium-$(CILIUM_VERSION)" ]; then \
		printf "$(_bold)$(_green)✓ Cilium $(CILIUM_VERSION) already installed — skipping$(_reset)\n"; \
	else \
		printf "$(_bold)$(_cyan)── Installing Cilium CNI ──$(_reset)\n"; \
		helm repo add cilium https://helm.cilium.io/ 2>/dev/null || true; \
		helm repo update cilium; \
		$(HELM) upgrade --install cilium cilium/cilium \
			--version $(CILIUM_VERSION) \
			-n kube-system \
			-f networking/cilium-values.yaml; \
		printf "$(_bold)$(_green)✓ Cilium CNI deployed to kube-system namespace$(_reset)\n"; \
	fi

cilium/uninstall: ## Remove Cilium CNI from the cluster
	$(HELM) uninstall cilium -n kube-system || true
	$(OK) "Cilium removed"

prometheus/install: ## Install/upgrade kube-prometheus-stack Helm chart to the cluster (skips if already installed)
	@current=$$($(HELM) list -n monitoring -f prometheus -o json 2>/dev/null | \
		python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['status'] if d else '')" 2>/dev/null); \
	if [ "$$current" = "deployed" ]; then \
		printf "$(_bold)$(_green)✓ Prometheus already deployed — skipping$(_reset)\n"; \
	else \
		printf "$(_bold)$(_cyan)── Installing kube-prometheus-stack ──$(_reset)\n"; \
		$(KUBECTL) create namespace monitoring --dry-run=client -o yaml | $(KUBECTL) apply -f -; \
		helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true; \
		helm repo update prometheus-community; \
		$(HELM) upgrade --install prometheus prometheus-community/kube-prometheus-stack \
			-n monitoring --create-namespace \
			-f monitoring/prometheus-values.yaml; \
		printf "$(_bold)$(_green)✓ Prometheus deployed to monitoring namespace$(_reset)\n"; \
	fi

prometheus/uninstall: ## Remove kube-prometheus-stack and monitoring namespace from the cluster
	$(HELM) uninstall prometheus -n monitoring || true
	$(KUBECTL) delete namespace monitoring --ignore-not-found
	$(OK) "Prometheus removed"

trimaran/install: ## Install/upgrade Trimaran scheduler plugin to the cluster
	$(STEP) "Installing Trimaran scheduler"
	helm repo add scheduler-plugins https://scheduler-plugins.sigs.k8s.io 2>/dev/null || true
	helm repo update scheduler-plugins
	$(HELM) upgrade --install trimaran scheduler-plugins/scheduler-plugins \
		-n kube-system \
		-f scheduling/trimaran/values.yaml
	$(OK) "Trimaran scheduler deployed"

trimaran/uninstall: ## Remove Trimaran scheduler from the cluster
	$(HELM) uninstall trimaran -n kube-system || true
	$(OK) "Trimaran removed"

deploy: apply-secrets cilium/install prometheus/install ## Apply secrets, install Helm charts, and deploy Kustomize manifests to the cluster
	$(STEP) "Applying CRDs"
	$(KUBECTL) apply -f crds/
	$(STEP) "Applying Kustomize manifests"
	kustomize build --enable-helm . | $(KUBECTL) apply -f -
	$(OK) "Kustomize deploy complete"

current-cp-image: ## Print current control-plane image tag (read-only)
	@$(KUBECTL) get deployment control-plane -n browser-streamer \
		-o jsonpath='{.spec.template.spec.containers[?(@.name=="control-plane")].image}' 2>/dev/null || true

verify: ## Wait for control-plane rollout to complete and show recent logs (read-only)
	@$(KUBECTL) rollout status deployment/control-plane -n browser-streamer --timeout=300s || { \
		echo ""; \
		echo "=== ROLLOUT FAILED — pod diagnostics ==="; \
		echo ""; \
		$(KUBECTL) get pods -n browser-streamer -l app=control-plane -o wide; \
		echo ""; \
		for POD in $$($(KUBECTL) get pods -n browser-streamer -l app=control-plane \
			--field-selector=status.phase!=Running -o jsonpath='{.items[*].metadata.name}'); do \
			echo "=== Logs: $$POD ==="; \
			$(KUBECTL) logs -n browser-streamer "$$POD" --tail=30 2>&1; \
			echo ""; \
		done; \
		exit 1; \
	}
	@echo ""
	@echo "=== Recent logs ==="
	@POD=$$($(KUBECTL) get pods -n browser-streamer -l app=control-plane \
		--sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}'); \
		$(KUBECTL) logs -n browser-streamer "$$POD" --tail=50
