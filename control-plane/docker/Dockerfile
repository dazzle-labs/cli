FROM node:24-alpine AS web
ARG VITE_CLERK_PUBLISHABLE_KEY
WORKDIR /app
COPY web/package.json web/yarn.lock web/.yarnrc.yml ./
COPY web/.yarn/ ./.yarn/
RUN corepack enable && yarn install --immutable
COPY web/src/ ./src/
COPY web/public/ ./public/
COPY web/index.html web/tsconfig.json web/vite.config.ts ./
RUN yarn build

FROM golang:1.25-alpine AS builder
WORKDIR /src

# Copy sidecar module (needed as local replace dependency)
COPY sidecar/go.mod sidecar/go.sum ./sidecar/
COPY sidecar/cmd/ ./sidecar/cmd/
COPY sidecar/gen/ ./sidecar/gen/
COPY sidecar/internal/ ./sidecar/internal/
COPY sidecar/syncutil/ ./sidecar/syncutil/

# Copy control-plane module
COPY control-plane/go.mod control-plane/go.sum ./control-plane/
WORKDIR /src/control-plane
RUN go mod download
COPY control-plane/*.go ./
COPY control-plane/internal/ ./internal/
COPY control-plane/migrations/ ./migrations/
ARG GIT_COMMIT=main
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-X main.gitCommit=${GIT_COMMIT}" -o control-plane .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /src/control-plane/control-plane .
COPY --from=builder /src/control-plane/migrations/ ./migrations/
COPY --from=web /app/dist/ ./web/
RUN mkdir -p ./web/.well-known && cp ./web/llms.txt ./web/.well-known/llms.txt
EXPOSE 8080
ENTRYPOINT ["./control-plane"]
