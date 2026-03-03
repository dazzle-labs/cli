HOST  ?= 5.78.145.53
NS    ?= browser-streamer
SSH   := ssh root@$(HOST)

.PHONY: help build logs

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ── Build ──────────────────────────────────────────────

build: ## Build streamer image on remote host
	$(SSH) "rm -rf /tmp/browser-streamer-build && mkdir -p /tmp/browser-streamer-build"
	scp -r docker/ . root@$(HOST):/tmp/browser-streamer-build/
	$(SSH) "cd /tmp/browser-streamer-build && buildctl build \
		--frontend=dockerfile.v0 \
		--local context=. \
		--local dockerfile=docker \
		--opt filename=Dockerfile \
		--output type=oci,dest=/tmp/browser-streamer.tar,name=docker.io/library/browser-streamer:latest"
	$(SSH) "k3s ctr images import /tmp/browser-streamer.tar"

# ── Observe ────────────────────────────────────────────

logs: ## Tail logs for a session pod (usage: make logs POD=streamer-abc12345)
	$(SSH) "k3s kubectl logs -f $(POD) -n $(NS)"
