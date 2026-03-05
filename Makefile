HOST     ?= 5.78.145.53
CLERK_PK ?= pk_test_cmFyZS13YWxsZXllLTQ4LmNsZXJrLmFjY291bnRzLmRldiQ
SSH      := ssh root@$(HOST)
NS       := browser-streamer
KCTL     := kubectl --context kind-browser-streamer -n browser-streamer
CP_BUILD := docker build -f control-plane/docker/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) -t control-plane:latest .
STR_BUILD := docker build --platform linux/amd64 -f streamer/docker/Dockerfile -t browser-streamer:latest streamer/

.PHONY: help proto up down build build-cp build-streamer deploy logs status \
        remote/build remote/build-streamer remote/build-control-plane \
        remote/deploy remote/restart remote/deploy-secrets \
        remote/install-cert-manager remote/setup-tls \
        remote/status remote/logs remote/clean remote/provision \
        control-plane/% streamer/% web/%

help: ## Show this help
	@echo "  Local (Kind):"
	@grep -E '^(up|down|build|build-cp|build-streamer|deploy|logs|status|proto):.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Remote (VPS via SSH):"
	@grep -E '^remote/[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Component targets: make <component>/<target>"
	@echo "    make control-plane/build   make streamer/build   make web/dev"

# ══════════════════════════════════════════════════════
# Local development (Kind)
# ══════════════════════════════════════════════════════

proto: ## Generate protobuf code (Go + TypeScript)
	$(MAKE) -C control-plane proto

up: ## Create Kind cluster, build images, deploy full stack
	@which sops >/dev/null 2>&1 || { echo "ERROR: sops not found. Install: brew install sops"; exit 1; }
	$(CP_BUILD)
	$(STR_BUILD)
	@if kind get clusters 2>/dev/null | grep -q '^browser-streamer$$'; then \
		echo "Kind cluster 'browser-streamer' already exists, reusing."; \
	else \
		kind create cluster --name browser-streamer --config k8s/local/kind-config.yaml; \
	fi
	kubectl --context kind-browser-streamer create namespace browser-streamer --dry-run=client -o yaml | kubectl --context kind-browser-streamer apply -f -
	kind load docker-image control-plane:latest --name browser-streamer
	kind load docker-image browser-streamer:latest --name browser-streamer
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(KCTL) apply -f k8s/local/service.yaml
	$(KCTL) wait --for=condition=ready pod -l app=postgres --timeout=120s
	$(KCTL) wait --for=condition=ready pod -l app=control-plane --timeout=120s
	@echo ""
	@echo "Local stack ready! Control-plane at http://localhost:8080"

down: ## Delete the Kind cluster
	kind delete cluster --name browser-streamer

build: build-cp build-streamer ## Build all images and load into Kind

build-cp: ## Build control-plane image and load into Kind
	$(CP_BUILD)
	kind load docker-image control-plane:latest --name browser-streamer

build-streamer: ## Build streamer image and load into Kind
	$(STR_BUILD)
	kind load docker-image browser-streamer:latest --name browser-streamer

deploy: ## Apply manifests and restart control-plane in Kind
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(KCTL) apply -f k8s/local/service.yaml
	$(KCTL) rollout restart deployment/control-plane
	$(KCTL) rollout status deployment/control-plane --timeout=120s

logs: ## Tail control-plane logs in Kind
	$(KCTL) logs -f deployment/control-plane

status: ## Show pods and services in Kind
	@echo "── Pods ──"
	$(KCTL) get pods -o wide
	@echo ""
	@echo "── Services ──"
	$(KCTL) get svc

# ══════════════════════════════════════════════════════
# Remote (VPS via SSH)
# ══════════════════════════════════════════════════════

remote/build-streamer: ## Build streamer image on remote host
	$(MAKE) -C streamer build

remote/build-control-plane: ## Build control-plane image on remote host
	$(MAKE) -C control-plane build

remote/build: remote/build-streamer remote/build-control-plane ## Build all images on remote host

remote/deploy: ## Apply k8s manifests and restart control-plane on remote
	$(SSH) "k3s kubectl apply -f -" < k8s/infrastructure/postgres.yaml
	$(MAKE) -C control-plane deploy
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/ingress.yaml
	$(MAKE) -C control-plane restart

remote/restart: ## Restart control-plane pod on remote
	$(MAKE) -C control-plane restart

remote/deploy-secrets: ## Decrypt SOPS secrets and apply to remote cluster
	sops -d k8s/infrastructure/postgres-auth.secrets.yaml | $(SSH) "k3s kubectl apply -f -"
	sops -d k8s/clerk/clerk-auth.secrets.yaml | $(SSH) "k3s kubectl apply -f -"
	sops -d k8s/infrastructure/encryption-key.secrets.yaml | $(SSH) "k3s kubectl apply -f -"

remote/install-cert-manager: ## Install cert-manager on remote cluster
	$(SSH) "k3s kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager -n cert-manager --timeout=120s"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=120s"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager-cainjector -n cert-manager --timeout=120s"

remote/setup-tls: ## Apply Traefik config, ClusterIssuer, and Ingress on remote
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/traefik-config.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/cluster-issuer.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/ingress.yaml

remote/logs: ## Tail control-plane logs on remote
	$(MAKE) -C control-plane logs

remote/status: ## Show pods, services, ingress, certificates on remote
	@echo "── Pods ──"
	$(SSH) "k3s kubectl get pods -n $(NS) -o wide"
	@echo ""
	@echo "── Services ──"
	$(SSH) "k3s kubectl get svc -n $(NS)"
	@echo ""
	@echo "── Ingress ──"
	$(SSH) "k3s kubectl get ingress -n $(NS)"
	@echo ""
	@echo "── Certificates ──"
	$(SSH) "k3s kubectl get certificate -n $(NS)"

remote/provision: ## Full provision from scratch (usage: make remote/provision HOST=x.x.x.x [TOKEN=...])
	./provision.sh $(HOST) $(TOKEN)

remote/clean: ## Delete all session pods on remote
	$(SSH) "k3s kubectl delete pods -n $(NS) -l app=streamer-session --ignore-not-found"

# ══════════════════════════════════════════════════════
# Nested component targets
# ══════════════════════════════════════════════════════

control-plane/%:
	$(MAKE) -C control-plane $*

streamer/%:
	$(MAKE) -C streamer $*

web/%:
	$(MAKE) -C web $*
