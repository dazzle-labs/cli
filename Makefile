.PHONY: proto build

proto:
	cd proto && buf generate

build:
	go build ./cmd/dazzle
