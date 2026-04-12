# ==========================================
# Build the Go Agent
# ==========================================
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy Go module files
COPY services/agent/go.mod services/agent/go.sum ./services/agent/
WORKDIR /app/services/agent
RUN go mod download

# Copy the source code
WORKDIR /app
COPY services/agent/ ./services/agent/

# Build the static binary
WORKDIR /app/services/agent
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/clawo11y-agent .

# ==========================================
# Run the Go Agent
# ==========================================
FROM alpine:latest

WORKDIR /app
COPY --from=builder /app/clawo11y-agent .

# The agent needs to monitor the OpenClaw directories
# Make sure to mount ~/.openclaw to /root/.openclaw when running this container
CMD ["./clawo11y-agent"]
