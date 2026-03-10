.PHONY: proto build readme check-hooks install-hooks

check-hooks:
	@if [ "$$(git config core.hooksPath)" != ".githooks" ]; then \
		echo "Installing git hooks..."; \
		git config core.hooksPath .githooks; \
	fi

proto: check-hooks
	cd proto && buf generate

build: check-hooks
	go build ./cmd/dazzle

readme:
	go run ./cmd/gen-readme

install-hooks:
	git config core.hooksPath .githooks
