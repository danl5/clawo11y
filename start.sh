#!/bin/bash
# Exit on error
set -e

# ==========================================
# OpenClaw O11y - Local One-Click Start
# ==========================================

echo "🚀 Starting OpenClaw O11y Local Setup..."

# 1. Build the Frontend
echo "📦 1/3: Building React Frontend..."
cd web
npm install
npm run build
cd ..

# 2. Build the Go Agent
echo "🐹 2/3: Compiling Go Agent..."
cd clawo11y-agent
go build -o clawo11y-agent .
cd ..

# 3. Setup Python Virtual Environment & Install Deps
echo "🐍 3/3: Setting up Python Backend..."
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt

# 4. Launch Services
echo "🟢 Launching Services..."

# Start Python Server in background
python -m core.server.main &
SERVER_PID=$!

echo "⏳ Waiting for server to boot..."
sleep 2

# Start Go Agent in background
./clawo11y-agent/clawo11y-agent &
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
