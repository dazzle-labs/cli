FROM node:24-alpine AS web
ARG VITE_CLERK_PUBLISHABLE_KEY
WORKDIR /app
COPY web/package.json web/yarn.lock web/.yarnrc.yml ./
COPY web/.yarn/ ./.yarn/
RUN corepack enable && yarn install --immutable
COPY web/src/ ./src/
COPY web/index.html web/tsconfig.json web/vite.config.ts ./
RUN yarn build

FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY control-plane/go.mod control-plane/go.sum ./
RUN go mod download
COPY control-plane/*.go ./
COPY control-plane/gen/ ./gen/
COPY control-plane/migrations/ ./migrations/
RUN CGO_ENABLED=0 GOOS=linux go build -o control-plane .

# Build gobs-cli
RUN CGO_ENABLED=0 GOOS=linux go install github.com/onyx-and-iris/gobs-cli@latest

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/control-plane .
COPY --from=builder /go/bin/gobs-cli /usr/local/bin/gobs-cli
COPY --from=builder /app/migrations/ ./migrations/
COPY --from=web /app/dist/ ./web/
EXPOSE 8080
ENTRYPOINT ["./control-plane"]
