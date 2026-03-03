FROM node:24-alpine AS dashboard
ARG VITE_CLERK_PUBLISHABLE_KEY
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/src/ ./src/
COPY dashboard/index.html dashboard/tsconfig.json dashboard/vite.config.ts ./
RUN npm run build

FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY session-manager/go.mod session-manager/go.sum ./
RUN go mod download
COPY session-manager/*.go ./
COPY session-manager/gen/ ./gen/
COPY session-manager/migrations/ ./migrations/
RUN CGO_ENABLED=0 GOOS=linux go build -o session-manager .

# Build gobs-cli
RUN CGO_ENABLED=0 GOOS=linux go install github.com/onyx-and-iris/gobs-cli@latest

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/session-manager .
COPY --from=builder /go/bin/gobs-cli /usr/local/bin/gobs-cli
COPY --from=builder /app/migrations/ ./migrations/
COPY --from=dashboard /app/dist/ ./dashboard/
EXPOSE 8080
ENTRYPOINT ["./session-manager"]
