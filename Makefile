CLERK_PK ?= pk_test_cmFyZS13YWxsZXllLTQ4LmNsZXJrLmFjY291bnRzLmRldiQ
NS       := browser-streamer
KIND_CTX := kind-browser-streamer
KCTL     := kubectl --context $(KIND_CTX) -n $(NS)
CP_IMG   := dazzlefm/agent-streamer-control-plane:main
STR_IMG  := dazzlefm/agent-streamer-stage:main
CLI_COMMIT := $(shell git -C cli rev-parse HEAD 2>/dev/null || echo main)
CP_BUILD := docker build -f control-plane/docker/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) --build-arg GIT_COMMIT=$(CLI_COMMIT) -t $(CP_IMG) .
SIDECAR_IMG := dazzlefm/agent-streamer-sidecar:main
STR_BUILD := docker build --platform linux/amd64 -f streamer/docker/Dockerfile -t $(STR_IMG) streamer/
SIDECAR_BUILD := docker build -f sidecar/Dockerfile -t $(SIDECAR_IMG) sidecar/

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

RKCTL = kubectl --kubeconfig <(sops -d --input-type yaml --output-type yaml k8s/hetzner/kubeconfig.yaml.enc)
INFRA_DIR := k8s/hetzner
TFSTATE   := $(INFRA_DIR)/terraform.tfstate
TFSTATE_ENC := $(INFRA_DIR)/terraform.tfstate.enc

.PHONY: help check-deps check-hooks check-cli pull-cli proto up down build build-cp build-streamer deploy dev llms-txt logs status \
        install-hooks \
        kubectx prod/kubectl prod/status prod/nodes \
        prod/infra/init prod/infra/plan prod/infra/apply prod/infra/output \
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

pull-cli: ## Pull latest cli, update go.mod, and commit
	@if ! git -C cli diff --quiet || ! git -C cli diff --cached --quiet; then \
		printf "$(_yellow)ERROR: cli/ has uncommitted changes. Commit or stash them first.$(_reset)\n"; \
		git -C cli status --short; \
		exit 1; \
	fi
	$(STEP) "Pulling latest cli"
	git -C cli checkout main
	git -C cli pull
	$(STEP) "Updating control-plane go.mod"
	cd control-plane && go get github.com/dazzle-labs/cli@$$(git -C ../cli rev-parse HEAD)
	cd control-plane && go build ./...
	$(OK) "cli bumped to $$(git -C cli rev-parse --short HEAD)"

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
	$(STEP) "Regenerating llms.txt"
	./scripts/generate-llms-txt.sh > llms.txt
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
	$(STEP) "Applying secrets"
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	@if sops -d k8s/secrets/oauth.secrets.yaml 2>/dev/null | $(KCTL) apply -f - 2>/dev/null; then \
		echo "  oauth secrets applied"; \
	fi
	@if sops -d k8s/secrets/r2-credentials.secrets.yaml 2>/dev/null | $(KCTL) apply -f - 2>/dev/null; then \
		echo "  r2 credentials applied"; \
	fi
	$(STEP) "Deploying postgres"
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(STEP) "Deploying control-plane"
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(KCTL) apply -f k8s/local/service.yaml
	$(KCTL) set env deployment/control-plane OAUTH_REDIRECT_BASE_URL=http://localhost:5173
	$(STEP) "Waiting for pods"
	$(KCTL) wait --for=condition=ready pod -l app=postgres --timeout=120s
	$(KCTL) rollout status deployment/control-plane --timeout=120s
	$(OK) "Local stack ready — http://localhost:5173"

down: ## Delete the Kind cluster
	kind delete cluster --name $(NS)

build: check-deps build-cp build-streamer build-sidecar llms-txt ## Build all images, regenerate llms.txt, load into Kind

build-cp: check-deps check-cluster ## Build control-plane image and load into Kind
	$(STEP) "Building control-plane image"
	$(CP_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(CP_IMG) --name $(NS)

build-streamer: check-deps check-cluster ## Build streamer image and load into Kind
	$(STEP) "Building streamer image"
	$(STR_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(STR_IMG) --name $(NS)

build-sidecar: check-deps check-cluster ## Build sidecar image and load into Kind
	$(STEP) "Building sidecar image"
	$(SIDECAR_BUILD)
	$(STEP) "Loading into Kind"
	kind load docker-image $(SIDECAR_IMG) --name $(NS)

deploy: check-deps check-cluster ## Apply manifests and restart control-plane in Kind
	$(STEP) "Applying secrets"
	sops -d k8s/local/local.secrets.yaml | $(KCTL) apply -f -
	@if sops -d k8s/secrets/oauth.secrets.yaml 2>/dev/null | $(KCTL) apply -f - 2>/dev/null; then \
		echo "  oauth secrets applied"; \
	fi
	@if sops -d k8s/secrets/r2-credentials.secrets.yaml 2>/dev/null | $(KCTL) apply -f - 2>/dev/null; then \
		echo "  r2 credentials applied"; \
	fi
	$(STEP) "Deploying postgres"
	$(KCTL) apply -f k8s/infrastructure/postgres.yaml
	$(STEP) "Deploying control-plane"
	$(KCTL) apply -f k8s/control-plane/rbac.yaml
	$(KCTL) apply -f k8s/control-plane/deployment.yaml
	$(KCTL) apply -f k8s/local/service.yaml
	$(KCTL) set env deployment/control-plane OAUTH_REDIRECT_BASE_URL=http://localhost:5173
	$(STEP) "Restarting control-plane"
	$(KCTL) rollout restart deployment/control-plane
	$(KCTL) rollout status deployment/control-plane --timeout=120s

dev: up ## ★ Full local dev — build, deploy, watch everything
	@echo ""
	$(STEP) "Starting dev watchers"
	@printf "  $(_yellow)web/dev$(_reset)        Vite dev server with HMR\n"
	@printf "  $(_yellow)logs$(_reset)           control-plane log tail\n"
	@echo ""
	@trap ' \
		kill 0 2>/dev/null; \
		echo ""; \
		printf "$(_bold)$(_yellow)Tear down Kind cluster? [y/N] $(_reset)"; \
		read ans; \
		if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
			kind delete cluster --name $(NS); \
			printf "$(_bold)$(_green)✓ Cluster deleted$(_reset)\n"; \
		else \
			printf "Cluster kept running. Use $(_cyan)make down$(_reset) to delete later.\n"; \
		fi; \
		exit 0; \
	' INT TERM; \
	(cd web && yarn dev) & \
	$(KCTL) logs -f deployment/control-plane & \
	wait

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

prod/kubectl: ## Run kubectl against prod cluster (use ARGS="get pods")
	@bash -c '$(RKCTL) $(ARGS)'

prod/status: ## Show prod cluster nodes and pods
	@bash -c '\
		echo "── Nodes ──"; \
		$(RKCTL) get nodes -o wide; \
		echo ""; \
		echo "── Pods (all namespaces) ──"; \
		$(RKCTL) get pods -A'

prod/nodes: ## Show prod cluster nodes
	@bash -c '$(RKCTL) get nodes -o wide'

prod/k8s/%: ## Run k8s/ Makefile target against prod (e.g. make prod/k8s/prometheus)
	@tmpkc=$$(mktemp) && \
		trap "rm -f $$tmpkc" EXIT && \
		sops -d --input-type yaml --output-type yaml k8s/hetzner/kubeconfig.yaml.enc > $$tmpkc && \
		KUBECONFIG=$$tmpkc $(MAKE) -C k8s $*

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
