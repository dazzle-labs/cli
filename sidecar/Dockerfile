FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY gen/ ./gen/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -o sidecar ./cmd/sidecar/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates ffmpeg
WORKDIR /app
COPY --from=builder /app/sidecar /sidecar
ENTRYPOINT ["/sidecar"]
