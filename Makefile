HOST     ?= 5.78.145.53
CLERK_PK ?= pk_live_Y2xlcmsuZGF6emxlLmZtJA
SSH      := ssh root@$(HOST)
NS       := browser-streamer

.PHONY: help proto build-streamer build-control-plane build deploy restart \
        logs-cp logs-session status sessions create-session provision clean \
        secrets install-cert-manager setup-tls \
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

deploy: ## Apply all k8s manifests and restart control-plane
	$(SSH) "k3s kubectl apply -f -" < k8s/postgres.yaml
	$(MAKE) -C control-plane deploy
	$(SSH) "k3s kubectl apply -f -" < k8s/ingress.yaml
	$(MAKE) -C control-plane restart

restart: ## Restart control-plane pod (picks up new image)
	$(MAKE) -C control-plane restart

# ── Observe ────────────────────────────────────────────

logs-cp: ## Tail control-plane logs
	$(MAKE) -C control-plane logs

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

# ── Nested component targets ───────────────────────────────

control-plane/%:
	$(MAKE) -C control-plane $*

streamer/%:
	$(MAKE) -C streamer $*

web/%:
	$(MAKE) -C web $*
