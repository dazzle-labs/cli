HOST     ?= 5.78.145.53
CLERK_PK ?= pk_test_cmFyZS13YWxsZXllLTQ4LmNsZXJrLmFjY291bnRzLmRldiQ
SSH      := ssh root@$(HOST)
NS       := browser-streamer
KCTL     := kubectl --context kind-browser-streamer -n browser-streamer
CP_IMG   := dazzlefm/agent-streamer-control-plane:latest
STR_IMG  := dazzlefm/agent-streamer-stage:latest
CP_BUILD := docker build -f control-plane/docker/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) -t $(CP_IMG) .
STR_BUILD := docker build --platform linux/amd64 -f streamer/docker/Dockerfile -t $(STR_IMG) streamer/

# Colored log helpers
_cyan    = \033[36m
_green   = \033[32m
_yellow  = \033[33m
_bold    = \033[1m
_reset   = \033[0m
STEP     = @printf "$(_bold)$(_cyan)── %s ──$(_reset)\n"
OK       = @printf "$(_bold)$(_green)✓ %s$(_reset)\n"

.PHONY: help check-deps proto up down build build-cp build-streamer build-runtime deploy dev harness logs status \
        deploy-runtime-scripts _patch-local-runtime \
        remote/build remote/build-streamer remote/build-control-plane \
        remote/deploy remote/restart remote/deploy-secrets \
        remote/install-cert-manager remote/setup-tls \
        remote/status remote/logs remote/clean remote/provision \
        control-plane/% streamer/% web/%

help: ## Show this help
	@echo "  Local (Kind):"
	@grep -E '^(up|down|build|build-cp|build-streamer|deploy|dev|logs|status|proto):.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo "    $(_cyan)make runtime/dev$(_reset)             Watch runtime sources"
	@echo "    $(_cyan)make web/dev$(_reset)                 Web dashboard dev server"
	@echo ""
	@echo "  Remote (VPS via SSH):"
	@grep -E '^remote/[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Component targets: make <component>/<target>"
	@echo "    make control-plane/build   make streamer/build   make web/dev"

# ══════════════════════════════════════════════════════
# Local development (Kind)
# ══════════════════════════════════════════════════════

check-deps:
	@which docker >/dev/null 2>&1 || { echo "ERROR: docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"; exit 1; }
	@which kind >/dev/null 2>&1 || { echo "ERROR: kind not found. Install: brew install kind"; exit 1; }
	@which kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not found. Install: brew install kubectl"; exit 1; }
	@which sops >/dev/null 2>&1 || { echo "ERROR: sops not found. Install: brew install sops"; exit 1; }
	@if [ -z "$$SOPS_AGE_KEY_FILE" ] && [ -z "$$SOPS_AGE_KEY" ] && [ ! -f "$$HOME/.config/sops/age/keys.txt" ]; then \
		echo ""; \
		echo "ERROR: No Age key found. SOPS needs an Age key to decrypt secrets."; \
		echo ""; \
		echo "  Copy the shared Age key from axis-router:"; \
		echo "    mkdir -p ~/.config/sops/age"; \
		echo "    cp ~/projects/axis-router/.age.key ~/.config/sops/age/keys.txt"; \
		echo ""; \
		echo "  Or point SOPS_AGE_KEY_FILE at your key:"; \
		echo "    export SOPS_AGE_KEY_FILE=/path/to/keys.txt"; \
		echo ""; \
		exit 1; \
	fi

proto: ## Generate protobuf code (Go + TypeScript)
	$(MAKE) -C control-plane proto

up: check-deps build-runtime ## Create Kind cluster, build images, deploy full stack
	$(STEP) "Building control-plane image"
	$(CP_BUILD)
	$(STEP) "Building streamer image"
	$(STR_BUILD)
	$(STEP) "Creating Kind cluster"
	@if kind get clusters 2>/dev/null | grep -q '^browser-streamer$$'; then \
		echo "  cluster already exists, reusing"; \
	else \
		kind create cluster --name browser-streamer --config k8s/local/kind-config.yaml; \
	fi
	$(STEP) "Loading images into Kind"
	kubectl --context kind-browser-streamer create namespace browser-streamer --dry-run=client -o yaml | kubectl --context kind-browser-streamer apply -f -
	kind load docker-image $(CP_IMG) --name browser-streamer
	kind load docker-image $(STR_IMG) --name browser-streamer
	$(STEP) "Applying secrets"
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	$(STEP) "Deploying postgres"
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(STEP) "Deploying control-plane"
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(STEP) "Patching runtime volumes → hostPath"
	$(MAKE) _patch-local-runtime
	$(KCTL) apply -f k8s/local/service.yaml
	$(STEP) "Waiting for pods"
	$(KCTL) wait --for=condition=ready pod -l app=postgres --timeout=120s
	$(KCTL) rollout status deployment/control-plane --timeout=120s
	$(OK) "Local stack ready — http://localhost:8080"

down: ## Delete the Kind cluster
	kind delete cluster --name browser-streamer

build-runtime: ## Build renderer JS bundle and catalog
	$(STEP) "Building runtime (prelude + renderer)"
	cd runtime && npm run build
	$(STEP) "Generating component catalog"
	cd runtime && npx tsx generate-catalog.ts

_patch-local-runtime:
	@$(KCTL) patch deployment control-plane --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0","value":{"name":"runtime-scripts","hostPath":{"path":"/runtime-dist","type":"Directory"}}}]'
	@$(KCTL) set env deployment/control-plane RUNTIME_HOSTPATH=/runtime-dist

deploy-runtime-scripts: build-runtime ## Create/update runtime-scripts ConfigMap from source files
	$(KCTL) create configmap runtime-scripts \
		--from-file=prelude.js=runtime/dist/prelude.js \
		--from-file=renderer.js=runtime/dist/renderer.js \
		--from-file=catalog-index.md=runtime/dist/catalog-index.md \
		--from-file=catalog-full.md=runtime/dist/catalog-full.md \
		--dry-run=client -o yaml | $(KCTL) apply -f -

build: check-deps build-cp build-streamer ## Build all images and load into Kind

build-cp: check-deps ## Build control-plane image and load into Kind
	$(STEP) "Building control-plane image"
	$(CP_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(CP_IMG) --name browser-streamer

build-streamer: check-deps ## Build streamer image and load into Kind
	$(STEP) "Building streamer image"
	$(STR_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(STR_IMG) --name browser-streamer

deploy: check-deps build-runtime ## Apply manifests and restart control-plane in Kind
	$(STEP) "Applying secrets"
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	$(STEP) "Deploying postgres"
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(STEP) "Deploying control-plane"
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(STEP) "Patching runtime volumes → hostPath"
	$(MAKE) _patch-local-runtime
	$(KCTL) apply -f k8s/local/service.yaml
	$(STEP) "Restarting control-plane"
	$(KCTL) rollout restart deployment/control-plane
	$(KCTL) rollout status deployment/control-plane --timeout=120s

harness: ## Run harness scenarios locally (usage: make harness SCENARIO=hello-world)
	@if [ -z "$(SCENARIO)" ]; then echo "Usage: make harness SCENARIO=<name>"; echo ""; echo "Available scenarios:"; ls harness/scenarios/ | sed 's/^/  /'; echo ""; echo "Set DAZZLE_API_KEY in harness/.env or environment."; exit 1; fi
	@if [ -z "$$DAZZLE_API_KEY" ] && ! grep -q '^DAZZLE_API_KEY=' harness/.env 2>/dev/null; then \
		echo "ERROR: No API key found."; \
		echo "  Add DAZZLE_API_KEY to harness/.env (sops --input-type dotenv --output-type dotenv harness/.env)"; \
		echo "  or export DAZZLE_API_KEY=bstr_... in your shell."; \
		exit 1; \
	fi
	cd harness && set -a && eval "$$(sops decrypt --input-type dotenv --output-type dotenv .env)" && set +a && DAZZLE_URL=http://localhost:8080 npx tsx run.ts $(SCENARIO)

dev: up ## Start local stack, then run all dev watchers (runtime + web + logs)
	@echo ""
	$(STEP) "Starting dev watchers"
	@printf "  $(_yellow)runtime/watch$(_reset)  rebuilds prelude.js, renderer.js, catalog on change\n"
	@printf "  $(_yellow)web/dev$(_reset)        Vite dev server with HMR\n"
	@printf "  $(_yellow)logs$(_reset)           control-plane log tail\n"
	@echo ""
	@trap 'kill 0' EXIT; \
	(cd runtime && npm run watch) & \
	(cd web && yarn dev) & \
	$(KCTL) logs -f deployment/control-plane & \
	wait

runtime/dev: build-runtime ## Watch runtime sources and rebuild on change (auto-syncs to Kind via hostPath)
	cd runtime && npm run watch

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
