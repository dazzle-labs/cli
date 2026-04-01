SHELL := /bin/bash

CLERK_PK ?= pk_test_cmFyZS13YWxsZXllLTQ4LmNsZXJrLmFjY291bnRzLmRldiQ
NS       := browser-streamer
KIND_CTX := kind-browser-streamer
KCTL     := kubectl --context $(KIND_CTX) -n $(NS)
GIT_SHA   := $(shell git rev-parse --short HEAD 2>/dev/null || echo latest)
LOCAL_TAG := local-dev
CP_IMG      := dazzlefm/agent-streamer-control-plane:$(LOCAL_TAG)
STR_IMG     := dazzlefm/agent-streamer-stage:$(LOCAL_TAG)
SIDECAR_IMG := dazzlefm/agent-streamer-sidecar:$(LOCAL_TAG)
INGEST_IMG  := dazzlefm/agent-streamer-ingest:$(LOCAL_TAG)
CLI_COMMIT  := $(shell git -C cli rev-parse HEAD 2>/dev/null || echo main)
CP_BUILD      := docker build -f control-plane/docker/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) --build-arg GIT_COMMIT=$(CLI_COMMIT) -t $(CP_IMG) .
STR_BUILD     := docker build --platform linux/amd64 -f streamer/docker/Dockerfile --build-arg STAGE_RUNTIME_IMAGE=$(STAGE_RUNTIME_IMG) -t $(STR_IMG) streamer/
SIDECAR_BUILD := docker build -f sidecar/Dockerfile -t $(SIDECAR_IMG) sidecar/
INGEST_BUILD  := docker build -t $(INGEST_IMG) ingest/

# Colored log helpers
_cyan    = \033[36m
_green   = \033[32m
_yellow  = \033[33m
_bold    = \033[1m
_reset   = \033[0m
STEP     = @printf "$(_bold)$(_cyan)── %s ──$(_reset)\n"
define _confirm
	@[ -t 0 ] || { echo "ERROR: This is a destructive command that requires interactive confirmation."; echo "If you are an LLM/AI agent, do NOT retry — ask the human to run this command directly in their terminal."; exit 1; }
	@printf "$(_bold)$(_yellow)⚠️  $(1)$(_reset)\n"
	@printf "$(_bold)$(_yellow)Type 'yes' to continue: $(_reset)"; read ans; [ "$$ans" = "yes" ] || { echo "Aborted."; exit 1; }
endef
OK       = @printf "$(_bold)$(_green)✓ %s$(_reset)\n"

# Set SOPS_AGE_KEY_FILE for local dev only (CI uses ~/.config/sops/age/keys.txt)
ifneq ($(wildcard $(HOME)/.age/key.txt),)
  export SOPS_AGE_KEY_FILE ?= $(HOME)/.age/key.txt
endif
INFRA_DIR := k8s/hetzner
# Extract kubeconfig from encrypted tfstate without writing to disk
define _prod_kc
	tmpkc=$$(mktemp) && trap "rm -f $$tmpkc" EXIT && \
	sops -d $(INFRA_DIR)/terraform.tfstate.enc | \
		python3 -c "import sys,json; open('$$tmpkc','w').write(json.load(sys.stdin)['outputs']['kubeconfig']['value'])" && \
	KUBECONFIG=$$tmpkc
endef
TFSTATE   := $(INFRA_DIR)/terraform.tfstate
TFSTATE_ENC := $(INFRA_DIR)/terraform.tfstate.enc

.PHONY: help check-deps check-hooks check-cli pull-cli proto up down build build-cp build-streamer build-ingest build-stage-runtime deploy dev llms-txt logs status \
        install-hooks \
        kubectx prod/helm prod/kubectl prod/status prod/nodes \
        prod/infra/init prod/infra/plan prod/infra/apply prod/infra/output \
        gpu/rebuild gpu/deploy gpu/node-create gpu/node-delete gpu/node-recreate gpu/status gpu/logs gpu/port-forward \
        cli/stages cli/up cli/down cli/sync cli/screenshot cli/logs \
        k8s/% prod/k8s/% \
        control-plane/% streamer/% web/%

help: ## Show this help
	@echo ""
	@printf "  $(_bold)$(_green)Quick start:$(_reset)  $(_bold)make dev$(_reset)   — builds everything, starts Kind, runs web dev server\n"
	@echo ""
	@echo "  Local (Kind):"
	@grep -E '^(dev|up|down|build|build-cp|build-streamer|deploy|kubectx|logs|status|proto):.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo "    $(_cyan)make web/dev$(_reset)                 Web dashboard dev server only"
	@echo ""
	@echo ""
	@echo "  Production cluster (Hetzner):"
	@grep -E '^prod/[a-z]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo "    $(_cyan)make prod/kubectl ARGS=\"get pods -n foo\"$(_reset)"
	@echo ""
	@echo "  Production infrastructure (OpenTofu — ⚠️  CAUTION):"
	@grep -E '^prod/infra/[a-z]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  GPU development (RunPod):"
	@grep -E '^gpu/[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  CLI (local, requires make gpu/port-forward in another terminal):"
	@grep -E '^cli/[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "    \033[36m%-28s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Component targets: make <component>/<target>"
	@echo "    make control-plane/proto   make web/dev"

# ══════════════════════════════════════════════════════
# Local development (Kind)
# ══════════════════════════════════════════════════════

check-hooks:
	@if [ "$$(git config core.hooksPath)" != ".githooks" ]; then \
		echo "Installing git hooks..."; \
		git config core.hooksPath .githooks; \
	fi

check-deps: check-hooks
	@which docker >/dev/null 2>&1 || { echo "ERROR: docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"; exit 1; }
	@which kind >/dev/null 2>&1 || { echo "ERROR: kind not found. Install: brew install kind"; exit 1; }
	@which kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not found. Install: brew install kubectl"; exit 1; }
	@which sops >/dev/null 2>&1 || { echo "ERROR: sops not found. Install: brew install sops"; exit 1; }
	@which kustomize >/dev/null 2>&1 || { echo "ERROR: kustomize not found. Install: brew install kustomize"; exit 1; }
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

check-cluster:
	@kind get clusters 2>/dev/null | grep -q '^$(NS)$$' || { echo "ERROR: Kind cluster not running. Run 'make up' first."; exit 1; }
	@kubectl --context $(KIND_CTX) cluster-info >/dev/null 2>&1 || { echo "ERROR: Kind cluster not reachable. Try 'make down && make up'."; exit 1; }

check-cli:
	@if git submodule status cli | grep -q '^-'; then \
		echo ""; \
		echo "ERROR: cli/ submodule is not initialized."; \
		echo ""; \
		echo "  Run:  git submodule update --init cli"; \
		echo ""; \
		exit 1; \
	fi
	@if git submodule status cli | grep -q '^\+'; then \
		printf "$(_yellow)WARNING: cli/ submodule is out-of-date (checked-out commit differs from what this branch expects).$(_reset)\n"; \
		printf "$(_yellow)  To update:  git submodule update cli$(_reset)\n"; \
		echo ""; \
	fi

check-cli-commands: check-cli ## Validate all frontend CLI commands against the CLI binary
	bash scripts/smoke-test-cli.sh

pull-cli: ## Pull latest cli release tag, update go.mod, and commit
	@if ! git -C cli diff --quiet || ! git -C cli diff --cached --quiet; then \
		printf "$(_yellow)ERROR: cli/ has uncommitted changes. Commit or stash them first.$(_reset)\n"; \
		git -C cli status --short; \
		exit 1; \
	fi
	$(STEP) "Fetching latest cli release tag"
	@git -C cli fetch --tags origin
	@CLI_TAG=$$(git -C cli tag --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+' | head -1) && \
		printf "$(_bold)$(_cyan)── Bumping cli to $$CLI_TAG ──$(_reset)\n" && \
		git -C cli checkout $$CLI_TAG && \
		cd control-plane && go get github.com/dazzle-labs/cli@$$CLI_TAG && go build ./... && \
		printf "$(_bold)$(_green)✓ cli bumped to $$CLI_TAG$(_reset)\n"

proto: check-cli ## Generate protobuf code (Go + TypeScript)
	$(MAKE) -C cli proto
	$(MAKE) -C control-plane proto

up: check-deps check-cli ## Create Kind cluster, build images, deploy full stack
	$(STEP) "Building control-plane image"
	$(CP_BUILD)
	$(STEP) "Building streamer image"
	$(STR_BUILD)
	$(STEP) "Building sidecar image"
	$(SIDECAR_BUILD)
	$(STEP) "Building ingest image"
	$(INGEST_BUILD)
	$(STEP) "Regenerating llms.txt"
	go run ./control-plane/cmd/gen-llms-txt
	$(STEP) "Creating Kind cluster"
	@if kind get clusters 2>/dev/null | grep -q '^browser-streamer$$'; then \
		echo "  cluster already exists, reusing"; \
	else \
		kind create cluster --name $(NS) --config k8s/local/kind-config.yaml; \
	fi
	$(STEP) "Loading images into Kind"
	kubectl --context $(KIND_CTX) create namespace $(NS) --dry-run=client -o yaml | kubectl --context $(KIND_CTX) apply -f -
	kind load docker-image $(CP_IMG) --name $(NS)
	kind load docker-image $(STR_IMG) --name $(NS)
	kind load docker-image $(SIDECAR_IMG) --name $(NS)
	kind load docker-image $(INGEST_IMG) --name $(NS)
	$(STEP) "Applying secrets"
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	@for secret in k8s/secrets/*.secrets.yaml; do \
		[ -f "$$secret" ] || continue; \
		case "$$secret" in *clerk-auth*) continue;; esac; \
		if sops -d "$$secret" 2>/dev/null | $(KCTL) apply -f - 2>/dev/null; then \
			echo "  $$secret"; \
		fi; \
	done
	$(STEP) "Applying CRDs"
	@if [ -d k8s/crds ] && ls k8s/crds/*.yaml >/dev/null 2>&1; then \
		$(KCTL) apply -f k8s/crds/; \
	fi
	$(STEP) "Deploying stack via kustomize (local-dev images)"
	kustomize build --load-restrictor LoadRestrictionsNone k8s/local | $(KCTL) apply -f -
	$(STEP) "Waiting for pods"
	$(KCTL) wait --for=condition=ready pod -l app=postgres --timeout=120s
	$(KCTL) rollout status deployment/control-plane --timeout=120s
	$(OK) "Local stack ready — http://localhost:5173 (API on :38080)"

down: ## Delete the Kind cluster
	kind delete cluster --name $(NS)

build: check-deps build-cp build-streamer build-sidecar build-ingest llms-txt ## Build all images, regenerate llms.txt, load into Kind

build-cp: check-deps check-cluster ## Build control-plane image and load into Kind
	$(STEP) "Building control-plane image"
	$(CP_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(CP_IMG) --name $(NS)

build-streamer: check-deps check-cluster build-stage-runtime ## Build streamer image and load into Kind
	$(STEP) "Building streamer image"
	$(STR_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(STR_IMG) --name $(NS)

build-sidecar: check-deps check-cluster ## Build sidecar image and load into Kind
	$(STEP) "Building sidecar image"
	$(SIDECAR_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(SIDECAR_IMG) --name $(NS)

build-ingest: check-deps check-cluster ## Build ingest (nginx-rtmp) image and load into Kind
	$(STEP) "Building ingest image"
	$(INGEST_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(INGEST_IMG) --name $(NS)

STAGE_RUNTIME_IMG := dazzlefm/stage-runtime-builder:main
GPU_NODE_IMG := dazzlefm/agent-streamer-gpu-node:main
GPU_NODE_BUILD := docker build --platform linux/amd64 -f streamer/docker/Dockerfile --build-arg VARIANT=gpu --build-arg SIDECAR_IMAGE=$(SIDECAR_IMG) --build-arg STAGE_RUNTIME_IMAGE=$(STAGE_RUNTIME_IMG) --target gpu-node -t $(GPU_NODE_IMG) streamer/

build-stage-runtime: check-deps ## Build stage-runtime Rust binary (linux/amd64)
	$(STEP) "Building stage-runtime"
	docker build --platform linux/amd64 -f stage-runtime/Dockerfile --target builder -t $(STAGE_RUNTIME_IMG) stage-runtime/

build-gpu-node: check-deps build-stage-runtime ## Build GPU node image (streamer + sidecar + stage-runtime)
	$(STEP) "Building sidecar image (dependency)"
	$(SIDECAR_BUILD)
	$(STEP) "Building GPU node image"
	$(GPU_NODE_BUILD)

push-gpu-node: build-gpu-node ## Build and push GPU node image to Docker Hub
	$(STEP) "Pushing GPU node image"
	docker push $(GPU_NODE_IMG)

# ══════════════════════════════════════════════════════
# GPU node testing (RunPod)
# ══════════════════════════════════════════════════════

# Local CLI alias — builds the CLI and runs it against the local control-plane
CLI := DAZZLE_API_URL=http://localhost:8080 go run ./cli/cmd/dazzle

gpu/rebuild: check-deps ## Rebuild sidecar + stage-runtime + GPU node images for amd64 and push to Docker Hub
	$(STEP) "Building stage-runtime (amd64)"
	docker build --platform linux/amd64 -f stage-runtime/Dockerfile --target builder -t dazzlefm/stage-runtime-builder:$(GIT_SHA) stage-runtime/
	$(STEP) "Building sidecar (amd64)"
	docker build --platform linux/amd64 -f sidecar/Dockerfile -t dazzlefm/agent-streamer-sidecar:$(GIT_SHA)-amd64 sidecar/
	$(STEP) "Building GPU node (amd64)"
	docker build --platform linux/amd64 -f streamer/docker/Dockerfile \
		--build-arg VARIANT=gpu \
		--build-arg SIDECAR_IMAGE=dazzlefm/agent-streamer-sidecar:$(GIT_SHA)-amd64 \
		--build-arg STAGE_RUNTIME_IMAGE=dazzlefm/stage-runtime-builder:$(GIT_SHA) \
		--target gpu-node -t dazzlefm/agent-streamer-gpu-node:$(GIT_SHA) streamer/
	$(STEP) "Pushing sidecar"
	docker push dazzlefm/agent-streamer-sidecar:$(GIT_SHA)-amd64
	$(STEP) "Pushing GPU node"
	docker push dazzlefm/agent-streamer-gpu-node:$(GIT_SHA)
	$(OK) "GPU images pushed: gpu-node:$(GIT_SHA)"

gpu/deploy: check-cluster ## Deploy control-plane with current GPU node image tag
	$(MAKE) build-cp deploy
	$(STEP) "Applying GPU node classes"
	$(KCTL) apply -f k8s/gpu/
	$(KCTL) set env deployment/control-plane GPU_NODE_IMAGE=dazzlefm/agent-streamer-gpu-node:$(GIT_SHA)
	$(KCTL) rollout status deployment/control-plane --timeout=120s
	$(OK) "Control-plane deployed with GPU node image gpu-node:$(GIT_SHA)"

GPU_CLASS ?= l40s
gpu/node-create: check-cluster ## Create a GPU node (GPU_CLASS=l40s|a40)
	$(KCTL) apply -f - <<< '{"apiVersion":"dazzle.fm/v1","kind":"GPUNode","metadata":{"name":"gpu-1","namespace":"$(NS)"},"spec":{"nodeClassRef":{"name":"$(GPU_CLASS)"}}}'
	$(OK) "GPUNode gpu-1 created (class=$(GPU_CLASS)) — watch with: make gpu/logs"

gpu/node-delete: check-cluster ## Delete the GPU node (terminates RunPod pod)
	$(KCTL) delete gpunode gpu-1 --ignore-not-found
	$(OK) "GPUNode gpu-1 deleted"

gpu/node-recreate: gpu/node-delete ## Delete and recreate GPU node (pulls fresh image)
	@sleep 10
	$(MAKE) gpu/node-create

gpu/status: check-cluster ## Show GPU node status and stages
	@echo "── GPU Nodes ──"
	@$(KCTL) get gpunodes -o wide 2>/dev/null || echo "  (none)"
	@echo ""
	@echo "── GPU Node Classes ──"
	@$(KCTL) get gpunodeclasses -o wide 2>/dev/null || echo "  (none)"

gpu/logs: check-cluster ## Tail control-plane logs (GPU provisioning)
	$(KCTL) logs -f deployment/control-plane

gpu/port-forward: check-cluster ## Port-forward control-plane for CLI access
	$(KCTL) port-forward svc/control-plane 8080:8080

# CLI convenience targets (require port-forward running in another terminal)
cli/stages: ## List stages via local CLI
	@$(CLI) stage list

cli/up: ## Activate a stage (STAGE=name)
	@$(CLI) stage up -s $(STAGE)

cli/down: ## Deactivate a stage (STAGE=name)
	@$(CLI) stage down -s $(STAGE)

cli/sync: ## Sync content to a stage (STAGE=name DIR=path)
	@$(CLI) stage sync -s $(STAGE) $(DIR)

cli/screenshot: ## Take a screenshot (STAGE=name)
	@$(CLI) stage screenshot -s $(STAGE) -o /tmp/stage-screenshot.png
	@echo "Screenshot saved to /tmp/stage-screenshot.png"

cli/logs: ## Show stage console logs (STAGE=name)
	@$(CLI) stage logs -s $(STAGE)

deploy: check-deps check-cluster ## Apply manifests and restart control-plane in Kind
	$(STEP) "Applying secrets"
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	@for secret in k8s/secrets/*.secrets.yaml; do \
		[ -f "$$secret" ] || continue; \
		case "$$secret" in *clerk-auth*) continue;; esac; \
		if sops -d "$$secret" 2>/dev/null | $(KCTL) apply -f - 2>/dev/null; then \
			echo "  $$secret"; \
		fi; \
	done
	$(STEP) "Applying CRDs"
	@if [ -d k8s/crds ] && ls k8s/crds/*.yaml >/dev/null 2>&1; then \
		$(KCTL) apply -f k8s/crds/; \
	fi
	$(STEP) "Deploying stack via kustomize (local-dev images)"
	kustomize build --load-restrictor LoadRestrictionsNone k8s/local | $(KCTL) apply -f -
	$(STEP) "Restarting control-plane"
	$(KCTL) rollout restart deployment/control-plane
	$(KCTL) rollout status deployment/control-plane --timeout=120s

dev: up ## ★ Full local dev — build, deploy, watch everything
	@echo ""
	$(STEP) "Starting dev watchers"
	@printf "  $(_yellow)web/dev$(_reset)        Vite dev server with HMR\n"
	@printf "  $(_yellow)logs$(_reset)           control-plane log tail\n"
	@echo ""
	@trap 'exit 0' INT TERM; \
	(cd web && VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) pnpm dev) & \
	$(KCTL) logs -f deployment/control-plane & \
	wait; true

llms-txt: check-cli ## Regenerate llms.txt
	go run ./control-plane/cmd/gen-llms-txt
	$(OK) "llms.txt updated"

install-hooks: ## Install git hooks (run once after cloning)
	git config core.hooksPath .githooks

kubectx: check-cluster ## Set kubectl context to local Kind cluster + browser-streamer namespace
	@kubectl config use-context $(KIND_CTX)
	@kubectl config set-context --current --namespace=$(NS)
	$(OK) "kubectl now targets $(KIND_CTX)/$(NS)"

logs: check-cluster ## Tail control-plane logs in Kind
	$(KCTL) logs -f deployment/control-plane

status: check-cluster ## Show pods and services in Kind
	@echo "── Pods ──"
	$(KCTL) get pods -o wide
	@echo ""
	@echo "── Services ──"
	$(KCTL) get svc

# ══════════════════════════════════════════════════════
# Production cluster (Hetzner)
# ══════════════════════════════════════════════════════

prod/helm: ## Run helm against prod cluster (use ARGS="list -A")
	@$(_prod_kc) helm $(ARGS)

prod/kubectl: ## Run kubectl against prod cluster (use ARGS="get pods")
	@$(_prod_kc) kubectl $(ARGS)

prod/status: ## Show prod cluster nodes and pods
	@$(_prod_kc) bash -c '\
		echo "── Nodes ──"; \
		kubectl --kubeconfig $$KUBECONFIG get nodes -o wide; \
		echo ""; \
		echo "── Pods (all namespaces) ──"; \
		kubectl --kubeconfig $$KUBECONFIG get pods -A'

prod/nodes: ## Show prod cluster nodes
	@$(_prod_kc) kubectl get nodes -o wide

prod/k8s/%: ## Run k8s/ Makefile target against prod (e.g. make prod/k8s/prometheus)
	@$(_prod_kc) $(MAKE) -C k8s $*

ci/k8s/%: ## Run k8s/ target using KUBECONFIG from environment (CI with OIDC auth)
	$(MAKE) -C k8s $*

# ══════════════════════════════════════════════════════
# Production infrastructure (OpenTofu) — CAUTION
# These targets modify live production infrastructure.
# ══════════════════════════════════════════════════════

# Decrypt state before tofu, re-encrypt after
prod/infra/decrypt-state:
	@if [ -f "$(TFSTATE_ENC)" ]; then \
		sops -d $(TFSTATE_ENC) > $(TFSTATE); \
	fi

prod/infra/encrypt-state:
	@if [ -f "$(TFSTATE)" ]; then \
		sops --encrypt $(TFSTATE) > $(TFSTATE_ENC); \
		rm -f $(TFSTATE) $(TFSTATE).backup; \
		printf "$(_bold)$(_green)✓ State encrypted to $(TFSTATE_ENC)$(_reset)\n"; \
	fi

prod/infra/init: ## Initialize OpenTofu providers
	cd $(INFRA_DIR) && tofu init

prod/infra/plan: prod/infra/decrypt-state ## Plan infrastructure changes (read-only)
	@cd $(INFRA_DIR) && tofu plan; \
		EXIT=$$?; \
		cd ->/dev/null; \
		$(MAKE) prod/infra/encrypt-state; \
		exit $$EXIT

prod/infra/apply: ## ⚠️  Apply infrastructure changes (DESTRUCTIVE)
	$(call _confirm,This will modify LIVE PRODUCTION infrastructure.)
	@$(MAKE) prod/infra/decrypt-state
	@cd $(INFRA_DIR) && tofu apply; \
		EXIT=$$?; \
		cd ->/dev/null; \
		$(MAKE) prod/infra/encrypt-state; \
		exit $$EXIT

prod/infra/output: prod/infra/decrypt-state ## Show OpenTofu outputs
	@cd $(INFRA_DIR) && tofu output; \
		EXIT=$$?; \
		cd ->/dev/null; \
		$(MAKE) prod/infra/encrypt-state; \
		exit $$EXIT

# ══════════════════════════════════════════════════════
# Nested component targets
# ══════════════════════════════════════════════════════

k8s/%: check-cluster ## Run k8s/ Makefile target against local Kind (e.g. make k8s/deploy)
	$(MAKE) -C k8s $* KUBE_ARGS="--context $(KIND_CTX)"

control-plane/%:
	$(MAKE) -C control-plane $*

streamer/%:
	$(MAKE) -C streamer $*

web/%:
	$(MAKE) -C web $*
