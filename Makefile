HOST     ?= 5.78.145.53
CLERK_PK ?= pk_live_Y2xlcmsuZGF6emxlLmZtJA
SSH      := ssh root@$(HOST)
NS       := browser-streamer

.PHONY: help build-streamer build-session-manager build deploy restart \
        logs-sm logs-session sessions create-session status provision clean \
        proto dashboard-build secrets install-cert-manager setup-tls

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ── Code generation ───────────────────────────────────

proto: ## Generate protobuf code (Go + TypeScript)
	cd session-manager/proto && buf generate

dashboard-build: ## Build dashboard (Vite + React)
	cd dashboard && . ~/.nvm/nvm.sh && nvm use && npm run build

# ── Build ──────────────────────────────────────────────

build-streamer: ## Build streamer image on remote host
	$(SSH) "rm -rf /tmp/browser-streamer-build && mkdir -p /tmp/browser-streamer-build"
	scp -r docker/ server/ root@$(HOST):/tmp/browser-streamer-build/
	$(SSH) "cd /tmp/browser-streamer-build && buildctl build \
		--frontend=dockerfile.v0 \
		--local context=. \
		--local dockerfile=docker \
		--opt filename=Dockerfile \
		--output type=oci,dest=/tmp/browser-streamer.tar,name=docker.io/library/browser-streamer:latest"
	$(SSH) "k3s ctr images import /tmp/browser-streamer.tar"

build-session-manager: ## Build session-manager image on remote host
	$(SSH) "rm -rf /tmp/session-manager-build && mkdir -p /tmp/session-manager-build"
	rsync -a --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='dist' \
		session-manager/ root@$(HOST):/tmp/session-manager-build/session-manager/
	rsync -a --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='dist' \
		dashboard/ root@$(HOST):/tmp/session-manager-build/dashboard/
	scp docker/Dockerfile.session-manager root@$(HOST):/tmp/session-manager-build/Dockerfile
	$(SSH) "cd /tmp/session-manager-build && buildctl build \
		--frontend=dockerfile.v0 \
		--local context=. \
		--local dockerfile=. \
		--opt filename=Dockerfile \
		--opt build-arg:VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) \
		--output type=oci,dest=/tmp/session-manager.tar,name=docker.io/library/session-manager:latest"
	$(SSH) "k3s ctr images import /tmp/session-manager.tar"

build: build-streamer build-session-manager ## Build all images

# ── Secrets ────────────────────────────────────────────

secrets: ## Decrypt and apply SOPS-encrypted secrets
	sops -d k8s/postgres-auth.secrets.yaml | $(SSH) "k3s kubectl apply -f -"
	sops -d k8s/clerk-auth.secrets.yaml | $(SSH) "k3s kubectl apply -f -"
	sops -d k8s/encryption-key.secrets.yaml | $(SSH) "k3s kubectl apply -f -"

# ── TLS / cert-manager ────────────────────────────────

install-cert-manager: ## Install cert-manager on the cluster
	$(SSH) "k3s kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager -n cert-manager --timeout=120s"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=120s"
	$(SSH) "k3s kubectl rollout status deployment/cert-manager-cainjector -n cert-manager --timeout=120s"

setup-tls: ## Apply Traefik config, ClusterIssuer, and Ingress for TLS
	$(SSH) "k3s kubectl apply -f -" < k8s/traefik-config.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/cluster-issuer.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/ingress.yaml

# ── Deploy ─────────────────────────────────────────────

deploy: ## Apply all k8s manifests and restart session-manager
	$(SSH) "k3s kubectl apply -f -" < k8s/postgres.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/session-manager-rbac.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/session-manager-deployment.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/session-manager-service.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/ingress.yaml
	$(SSH) "k3s kubectl rollout restart deployment/session-manager -n $(NS)"
	$(SSH) "k3s kubectl rollout status deployment/session-manager -n $(NS) --timeout=60s"

restart: ## Restart session-manager pod (picks up new image)
	$(SSH) "k3s kubectl rollout restart deployment/session-manager -n $(NS)"
	$(SSH) "k3s kubectl rollout status deployment/session-manager -n $(NS) --timeout=60s"

# ── Observe ────────────────────────────────────────────

logs-sm: ## Tail session-manager logs
	$(SSH) "k3s kubectl logs -f deployment/session-manager -n $(NS)"

logs-session: ## Tail logs for a session pod (usage: make logs-session POD=streamer-abc12345)
	$(SSH) "k3s kubectl logs -f $(POD) -n $(NS)"

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

sessions: ## List active sessions via API
	@curl -s "https://stream.dazzle.fm/api/sessions?token=$(TOKEN)" | python3 -m json.tool

create-session: ## Create a new session
	@curl -s -X POST "https://stream.dazzle.fm/api/session?token=$(TOKEN)" | python3 -m json.tool

# ── Full provision ─────────────────────────────────────

provision: ## Full provision from scratch (usage: make provision HOST=x.x.x.x [TOKEN=...])
	./provision.sh $(HOST) $(TOKEN)

# ── Cleanup ────────────────────────────────────────────

clean: ## Delete all session pods
	$(SSH) "k3s kubectl delete pods -n $(NS) -l app=streamer-session --ignore-not-found"
