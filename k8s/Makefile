# K8s infrastructure Makefile
# Used by CI (no KUBE_ARGS needed), root Makefile local (--context kind-*),
# and root Makefile prod (--kubeconfig <decrypted>)

KUBE_ARGS ?=
KUBECTL   := kubectl $(KUBE_ARGS)
HELM      := helm $(KUBE_ARGS)

_cyan   = \033[36m
_green  = \033[32m
_bold   = \033[1m
_reset  = \033[0m
STEP    = @printf "$(_bold)$(_cyan)── %s ──$(_reset)\n"
OK      = @printf "$(_bold)$(_green)✓ %s$(_reset)\n"

.PHONY: apply-secrets prometheus/install prometheus/uninstall trimaran/install trimaran/uninstall deploy \
       current-cp-image set-streamer-env verify

apply-secrets: ## Decrypt SOPS secrets and apply them to the cluster
	$(STEP) "Applying secrets"
	@$(KUBECTL) create namespace monitoring --dry-run=client -o yaml | $(KUBECTL) apply -f -
	@for secret in secrets/*.yaml clerk/*.secrets.yaml infrastructure/*.secrets.yaml; do \
		[ -f "$$secret" ] || continue; \
		echo "  $$secret"; \
		sops --decrypt "$$secret" | $(KUBECTL) apply -f -; \
	done
	$(OK) "Secrets applied"

prometheus/install: ## Install/upgrade kube-prometheus-stack Helm chart to the cluster
	$(STEP) "Installing kube-prometheus-stack"
	$(KUBECTL) create namespace monitoring --dry-run=client -o yaml | $(KUBECTL) apply -f -
	helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
	helm repo update prometheus-community
	$(HELM) upgrade --install prometheus prometheus-community/kube-prometheus-stack \
		-n monitoring --create-namespace \
		-f monitoring/prometheus-values.yaml
	$(OK) "Prometheus deployed to monitoring namespace"

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

deploy: apply-secrets prometheus/install ## Apply secrets, install Helm charts, and deploy Kustomize manifests to the cluster
	$(STEP) "Applying Kustomize manifests"
	kustomize build --enable-helm . | $(KUBECTL) apply -f -
	$(OK) "Kustomize deploy complete"

current-cp-image: ## Print current control-plane image tag (read-only)
	@$(KUBECTL) get deployment control-plane -n browser-streamer \
		-o jsonpath='{.spec.template.spec.containers[?(@.name=="control-plane")].image}' 2>/dev/null || true

set-streamer-env: ## Update STREAMER_IMAGE env var on control-plane deployment (triggers rollout)
	$(KUBECTL) set env deployment/control-plane -n browser-streamer \
		STREAMER_IMAGE=$(STREAMER_IMAGE)

verify: ## Wait for control-plane rollout to complete and show recent logs (read-only)
	$(KUBECTL) rollout status deployment/control-plane -n browser-streamer --timeout=300s
	@echo ""
	@echo "=== Recent logs ==="
	@POD=$$($(KUBECTL) get pods -n browser-streamer -l app=control-plane \
		--sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}'); \
		$(KUBECTL) logs -n browser-streamer "$$POD" --tail=50
