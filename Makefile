HOST ?= 5.78.145.53
SSH  := ssh root@$(HOST)
NS   := browser-streamer

.PHONY: help build-streamer build-session-manager build deploy restart \
        logs-sm logs-session sessions create-session status provision clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

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
	scp -r session-manager/ viewer.html root@$(HOST):/tmp/session-manager-build/
	scp docker/Dockerfile.session-manager root@$(HOST):/tmp/session-manager-build/Dockerfile
	$(SSH) "cd /tmp/session-manager-build && buildctl build \
		--frontend=dockerfile.v0 \
		--local context=. \
		--local dockerfile=. \
		--opt filename=Dockerfile \
		--output type=oci,dest=/tmp/session-manager.tar,name=docker.io/library/session-manager:latest"
	$(SSH) "k3s ctr images import /tmp/session-manager.tar"

build: build-streamer build-session-manager ## Build all images

# ── Deploy ─────────────────────────────────────────────

deploy: ## Apply all k8s manifests and restart session-manager
	$(SSH) "k3s kubectl apply -f -" < k8s/session-manager-rbac.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/session-manager-deployment.yaml
	$(SSH) "k3s kubectl apply -f -" < k8s/session-manager-service.yaml
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

sessions: ## List active sessions via API (requires TOKEN env var)
	@curl -s "http://$(HOST):30080/api/sessions?token=$(TOKEN)" | python3 -m json.tool

create-session: ## Create a new session (requires TOKEN env var)
	@curl -s -X POST "http://$(HOST):30080/api/session?token=$(TOKEN)" | python3 -m json.tool

# ── Full provision ─────────────────────────────────────

provision: ## Full provision from scratch (usage: make provision HOST=x.x.x.x [TOKEN=...])
	./provision.sh $(HOST) $(TOKEN)

# ── Cleanup ────────────────────────────────────────────

clean: ## Delete all session pods
	$(SSH) "k3s kubectl delete pods -n $(NS) -l app=streamer-session --ignore-not-found"
