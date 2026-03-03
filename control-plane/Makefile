HOST      ?= 5.78.145.53
NS        ?= browser-streamer
CLERK_PK  ?= pk_live_Y2xlcmsuZGF6emxlLmZtJA
SSH       := ssh root@$(HOST)

.PHONY: help proto build logs deploy restart

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ── Code generation ───────────────────────────────────

proto: ## Generate protobuf code (Go + TypeScript)
	cd proto && buf generate

# ── Build ──────────────────────────────────────────────

build: ## Build control-plane image on remote host
	$(SSH) "rm -rf /tmp/control-plane-build && mkdir -p /tmp/control-plane-build"
	rsync -a --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='dist' \
		. root@$(HOST):/tmp/control-plane-build/control-plane/
	rsync -a --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='dist' \
		../web/ root@$(HOST):/tmp/control-plane-build/web/
	scp docker/Dockerfile root@$(HOST):/tmp/control-plane-build/Dockerfile
	$(SSH) "cd /tmp/control-plane-build && buildctl build \
		--frontend=dockerfile.v0 \
		--local context=. \
		--local dockerfile=. \
		--opt filename=Dockerfile \
		--opt build-arg:VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) \
		--output type=oci,dest=/tmp/control-plane.tar,name=docker.io/library/control-plane:latest"
	$(SSH) "k3s ctr images import /tmp/control-plane.tar"

# ── Deploy ─────────────────────────────────────────────

deploy: ## Apply control-plane k8s manifests
	$(SSH) "k3s kubectl apply -f -" < ../k8s/control-plane/rbac.yaml
	$(SSH) "k3s kubectl apply -f -" < ../k8s/control-plane/deployment.yaml
	$(SSH) "k3s kubectl apply -f -" < ../k8s/control-plane/service.yaml

restart: ## Restart control-plane pod (picks up new image)
	$(SSH) "k3s kubectl rollout restart deployment/control-plane -n $(NS)"
	$(SSH) "k3s kubectl rollout status deployment/control-plane -n $(NS) --timeout=60s"

# ── Observe ────────────────────────────────────────────

logs: ## Tail control-plane logs
	$(SSH) "k3s kubectl logs -f deployment/control-plane -n $(NS)"
