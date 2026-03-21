FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY gen/ ./gen/
COPY internal/ ./internal/
COPY syncutil/ ./syncutil/
RUN CGO_ENABLED=0 GOOS=linux go build -o sidecar ./cmd/sidecar/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates ffmpeg \
    libva mesa-va-gallium
WORKDIR /app
COPY assets/DMSerifDisplay-Regular.ttf /usr/share/fonts/dazzle.ttf
COPY --from=builder /app/sidecar /sidecar
ENTRYPOINT ["/sidecar"]
