#!/bin/bash
# Exit on error
set -e

# ==========================================
# OpenClaw O11y - Local One-Click Start
# ==========================================

echo "🚀 Starting OpenClaw O11y Local Setup..."

# 1. Build all components using Makefile
echo "� 1/2: Building all components (Web, Server, Agent)..."
make build

# 2. Launch Services
echo "🟢 2/2: Launching Services..."

# Start Go Server in background
./bin/clawo11y-server &
SERVER_PID=$!

echo "⏳ Waiting for server to boot..."
sleep 2

# Start Go Agent in background
./bin/clawo11y-agent &
AGENT_PID=$!

echo ""
echo "=========================================="
echo "✨ OpenClaw O11y is now running!"
echo "👉 Access the Dashboard at: http://localhost:8000"
echo "=========================================="
echo "Press Ctrl+C to stop both the Server and the Agent."

# Trap exit signals to gracefully shut down background processes
trap "echo 'Shutting down...'; kill $SERVER_PID $AGENT_PID 2>/dev/null; exit" SIGINT SIGTERM EXIT

# Wait indefinitely to keep the script running
wait
