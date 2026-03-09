FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY gen/ ./gen/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -o sidecar ./cmd/sidecar/

# Build gobs-cli
RUN CGO_ENABLED=0 GOOS=linux go install github.com/onyx-and-iris/gobs-cli@v0.18.2

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/sidecar /sidecar
COPY --from=builder /go/bin/gobs-cli /usr/local/bin/gobs-cli
ENTRYPOINT ["/sidecar"]
