#!/bin/bash
set -e

echo "============================================"
echo "  OpenClaw O11y — One-Click Server Installer"
echo "============================================"
echo ""

O11Y_DIR="${O11Y_DIR:-$HOME/.openclaw-o11y}"
mkdir -p "$O11Y_DIR"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"
AGENT_BINARY="clawo11y-agent"

echo "[1/3] Detecting platform: $OS / $ARCH"
if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    AGENT_URL="https://github.com/openclaw/clawo11y/releases/latest/download/clawo11y-agent-darwin-arm64"
elif [ "$OS" = "Darwin" ]; then
    AGENT_URL="https://github.com/openclaw/clawo11y/releases/latest/download/clawo11y-agent-darwin-amd64"
elif [ "$OS" = "Linux" ]; then
    AGENT_URL="https://github.com/openclaw/clawo11y/releases/latest/download/clawo11y-agent-linux-amd64"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

# Download agent binary
AGENT_PATH="$O11Y_DIR/$AGENT_BINARY"
if command -v curl >/dev/null 2>&1; then
    echo "[2/3] Downloading agent binary..."
    curl -fsSL "$AGENT_URL" -o "$AGENT_PATH" || echo "Binary download skipped (not yet released)"
    chmod +x "$AGENT_PATH"
else
    echo "[2/3] curl not found, skipping agent download"
fi

# Write docker-compose.yml
echo "[3/3] Writing docker-compose.yml..."
cat > "$O11Y_DIR/docker-compose.yml" << 'EOF'
services:
  o11y-server:
    image: clawo11y/server:latest
    ports:
      - "8000:8000"
    environment:
      - O11Y_SECRET=${O11Y_SECRET:-change-me-in-production}
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  o11y-web:
    image: clawo11y/web:latest
    ports:
      - "3000:80"
    depends_on:
      - o11y-server
    restart: unless-stopped
EOF

mkdir -p "$O11Y_DIR/data"

echo ""
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "  Config directory: $O11Y_DIR"
echo "  To start the server:"
echo "    cd $O11Y_DIR && docker compose up -d"
echo ""
echo "  To connect an agent node:"
echo "    O11Y_SERVER_URL=http://<your-server>:8000 $AGENT_PATH"
echo ""
echo "  Dashboard will be available at: http://localhost:3000"
echo ""
