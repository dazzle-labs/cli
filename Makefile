HOST     ?= 5.78.145.53
CLERK_PK ?= pk_live_Y2xlcmsuZGF6emxlLmZtJA
SSH      := ssh root@$(HOST)
NS       := browser-streamer

.PHONY: help proto build-streamer build-control-plane build deploy restart \
        logs-cp status provision clean \
        secrets install-cert-manager setup-tls \
        local-build local-build-cp local-build-streamer \
        local-up local-down local-deploy local-logs local-status \
        control-plane/% streamer/% web/%

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Nested component targets: make <component>/<target>"
	@echo "    make control-plane/build   # Build control-plane"
	@echo "    make control-plane/deploy  # Deploy control-plane"
	@echo "    make control-plane/logs    # Tail control-plane logs"
	@echo "    make streamer/build        # Build streamer"
	@echo "    make web/build             # Build web"
	@echo "    make web/dev               # Run web dev server"

# ── Code generation ───────────────────────────────────

proto: ## Generate protobuf code (Go + TypeScript)
	$(MAKE) -C control-plane proto

# ── Build ──────────────────────────────────────────────

build-streamer: ## Build streamer image on remote host
	$(MAKE) -C streamer build

build-control-plane: ## Build control-plane image on remote host
	$(MAKE) -C control-plane build

build: build-streamer build-control-plane ## Build all images

# ── Secrets ────────────────────────────────────────────

secrets: ## Decrypt and apply SOPS-encrypted secrets
	sops -d k8s/infrastructure/postgres-auth.secrets.yaml | $(SSH) "k3s kubectl apply -f -"
	sops -d k8s/clerk/clerk-auth.secrets.yaml | $(SSH) "k3s kubectl apply -f -"
	sops -d k8s/infrastructure/encryption-key.secrets.yaml | $(SSH) "k3s kubectl apply -f -"

# ── TLS / cert-manager ────────────────────────────────

install-cert-manager: ## Install cert-manager on the cluster
	$(SSH) "k3s kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager -n cert-manager --timeout=120s"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=120s"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager-cainjector -n cert-manager --timeout=120s"

setup-tls: ## Apply Traefik config, ClusterIssuer, and Ingress for TLS
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/traefik-config.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/cluster-issuer.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/ingress.yaml

# ── Deploy ─────────────────────────────────────────────

deploy: ## Apply all k8s manifests and restart control-plane
	$(SSH) "k3s kubectl apply -f -" < k8s/infrastructure/postgres.yaml
	$(MAKE) -C control-plane deploy
	$(SSH) "k3s kubectl apply -f -" < k8s/networking/ingress.yaml
	$(MAKE) -C control-plane restart

restart: ## Restart control-plane pod (picks up new image)
	$(MAKE) -C control-plane restart

# ── Observe ────────────────────────────────────────────

logs-cp: ## Tail control-plane logs
	$(MAKE) -C control-plane logs

status: ## Show pods and services
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

# ── Full provision ─────────────────────────────────────

provision: ## Full provision from scratch (usage: make provision HOST=x.x.x.x [TOKEN=...])
	./provision.sh $(HOST) $(TOKEN)

# ── Cleanup ────────────────────────────────────────────

clean: ## Delete all session pods
	$(SSH) "k3s kubectl delete pods -n $(NS) -l app=streamer-session --ignore-not-found"

# ── Local dev (Kind) ──────────────────────────────────────

KCTL           := kubectl --context kind-browser-streamer -n browser-streamer
LOCAL_CLERK_PK ?= pk_test_cmFyZS13YWxsZXllLTQ4LmNsZXJrLmFjY291bnRzLmRldiQ
CP_BUILD       := docker build -f control-plane/docker/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=$(LOCAL_CLERK_PK) -t control-plane:latest .
STR_BUILD := docker build --platform linux/amd64 -f streamer/docker/Dockerfile -t browser-streamer:latest streamer/

local-build: local-build-cp local-build-streamer ## Build all images locally and load into Kind

local-build-cp: ## Build control-plane image locally and load into Kind
	$(CP_BUILD)
	kind load docker-image control-plane:latest --name browser-streamer

local-build-streamer: ## Build streamer image locally and load into Kind
	$(STR_BUILD)
	kind load docker-image browser-streamer:latest --name browser-streamer

local-up: ## Create Kind cluster, build images, deploy full stack locally
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

local-down: ## Delete the Kind cluster
	kind delete cluster --name browser-streamer

local-deploy: ## Apply manifests and restart control-plane in Kind
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(KCTL) apply -f k8s/local/service.yaml
	$(KCTL) rollout restart deployment/control-plane
	$(KCTL) rollout status deployment/control-plane --timeout=120s

local-logs: ## Tail control-plane logs in Kind
	$(KCTL) logs -f deployment/control-plane

local-status: ## Show pods and services in Kind
	@echo "── Pods ──"
	$(KCTL) get pods -o wide
	@echo ""
	@echo "── Services ──"
	$(KCTL) get svc

# ── Nested component targets ───────────────────────────────

control-plane/%:
	$(MAKE) -C control-plane $*

streamer/%:
	$(MAKE) -C streamer $*

web/%:
	$(MAKE) -C web $*
