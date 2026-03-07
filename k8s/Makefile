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

.PHONY: prometheus prometheus/install prometheus/uninstall trimaran trimaran/install trimaran/uninstall deploy

prometheus: prometheus/install

prometheus/install: ## Install kube-prometheus-stack
	$(STEP) "Installing kube-prometheus-stack"
	$(KUBECTL) create namespace monitoring --dry-run=client -o yaml | $(KUBECTL) apply -f -
	helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
	helm repo update prometheus-community
	$(HELM) upgrade --install prometheus prometheus-community/kube-prometheus-stack \
		-n monitoring --create-namespace \
		-f monitoring/prometheus-values.yaml
	$(OK) "Prometheus deployed to monitoring namespace"

prometheus/uninstall: ## Uninstall kube-prometheus-stack
	$(HELM) uninstall prometheus -n monitoring || true
	$(KUBECTL) delete namespace monitoring --ignore-not-found
	$(OK) "Prometheus removed"

trimaran: trimaran/install

trimaran/install: ## Install Trimaran secondary scheduler
	$(STEP) "Installing Trimaran scheduler"
	helm repo add scheduler-plugins https://scheduler-plugins.sigs.k8s.io 2>/dev/null || true
	helm repo update scheduler-plugins
	$(HELM) upgrade --install trimaran scheduler-plugins/scheduler-plugins \
		-n kube-system \
		-f scheduling/trimaran/values.yaml
	$(OK) "Trimaran scheduler deployed"

trimaran/uninstall: ## Uninstall Trimaran scheduler
	$(HELM) uninstall trimaran -n kube-system || true
	$(OK) "Trimaran removed"

deploy: prometheus ## Deploy Helm charts then Kustomize manifests
	$(STEP) "Applying Kustomize manifests"
	kustomize build --enable-helm . | $(KUBECTL) apply -f -
	$(OK) "Kustomize deploy complete"
