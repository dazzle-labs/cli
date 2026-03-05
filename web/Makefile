.PHONY: help build dev

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ── Build ──────────────────────────────────────────────

build: ## Build web (Vite + React)
	. ~/.nvm/nvm.sh && nvm use && yarn build

# ── Dev ────────────────────────────────────────────────

dev: ## Start dev server
	. ~/.nvm/nvm.sh && nvm use && yarn dev
