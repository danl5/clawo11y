# ==========================================
# Build the Go Agent
# ==========================================
FROM golang:1.24-alpine AS builder

WORKDIR /app
COPY . .

# Build the static binary
RUN CGO_ENABLED=0 GOOS=linux go build -o clawo11y-agent .

# ==========================================
# Run the Go Agent
# ==========================================
FROM alpine:latest

WORKDIR /app
COPY --from=builder /app/clawo11y-agent .

# The agent needs to monitor the OpenClaw directories
# Make sure to mount ~/.openclaw to /root/.openclaw when running this container
CMD ["./clawo11y-agent"]
