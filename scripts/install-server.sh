#!/bin/bash
set -e

echo "============================================"
echo "  OpenClaw O11y — One-Click Server Installer"
echo "============================================"
echo ""

O11Y_DIR="${O11Y_DIR:-$HOME/.openclaw-o11y}"
mkdir -p "$O11Y_DIR"

# Write docker-compose.yml
echo "[1/1] Writing docker-compose.yml..."
cat > "$O11Y_DIR/docker-compose.yml" << 'EOF'
services:
  o11y-server:
    image: ghcr.io/danl5/clawo11y/server:latest
    ports:
      - "8000:8000"
    environment:
      - O11Y_SECRET=${O11Y_SECRET:-change-me-in-production}
      - O11Y_DB_URL=sqlite:////app/data/o11y_server.db
    volumes:
      - ./data:/app/data
    restart: unless-stopped
EOF

mkdir -p "$O11Y_DIR/data"

echo ""
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "  Config directory: $O11Y_DIR"
echo "  Data directory: $O11Y_DIR/data"
echo ""
echo "  To start the server:"
echo "    cd $O11Y_DIR && docker compose up -d"
echo ""
echo "  To connect an agent node (run on your OpenClaw machine):"
echo "    curl -fsSL https://raw.githubusercontent.com/danl5/clawo11y/main/scripts/install-agent.sh | O11Y_SERVER_URL=http://<your-server-ip>:8000 bash"
echo ""
echo "  Dashboard will be available at: http://<your-server-ip>:8000"
echo ""
