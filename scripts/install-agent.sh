#!/bin/bash
set -e

echo "============================================"
echo "  OpenClaw O11y Agent — One-Click Installer"
echo "============================================"
echo ""

O11Y_DIR="${O11Y_DIR:-$HOME/.openclaw-o11y/agent}"
mkdir -p "$O11Y_DIR"

SERVER_URL="${O11Y_SERVER_URL:-http://127.0.0.1:8000}"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    BINARY="clawo11y-agent-darwin-arm64"
elif [ "$OS" = "Darwin" ]; then
    BINARY="clawo11y-agent-darwin-amd64"
elif [ "$OS" = "Linux" ]; then
    BINARY="clawo11y-agent-linux-amd64"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

AGENT_URL="https://github.com/openclaw/clawo11y/releases/latest/download/$BINARY"
AGENT_PATH="$O11Y_DIR/clawo11y-agent"

echo "[1/3] Downloading agent binary for $OS / $ARCH..."
curl -fsSL "$AGENT_URL" -o "$AGENT_PATH" || {
    echo "Binary download failed. Build from source with: cd clawo11y-agent && go build -o clawo11y-agent main.go"
    exit 1
}
chmod +x "$AGENT_PATH"

echo "[2/3] Writing launchd plist for macOS..."
if [ "$OS" = "Darwin" ]; then
    PLIST_PATH="$HOME/Library/LaunchAgents/com.openclaw.o11y-agent.plist"
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.openclaw.o11y-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$AGENT_PATH</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>O11Y_SERVER_URL</key>
        <string>$SERVER_URL</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
    echo "  Launchd plist written to: $PLIST_PATH"
    echo "  To start now: launchctl load $PLIST_PATH"
fi

echo "[3/3] Writing systemd unit for Linux..."
if [ "$OS" = "Linux" ]; then
    SERVICE_PATH="/etc/systemd/system/o11y-agent.service"
    cat > "$SERVICE_PATH" << EOF
[Unit]
Description=OpenClaw O11y Agent
After=network.target

[Service]
Type=simple
ExecStart=$AGENT_PATH
Environment="O11Y_SERVER_URL=$SERVER_URL"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    echo "  Systemd unit written to: $SERVICE_PATH"
    echo "  To start now: sudo systemctl start o11y-agent"
fi

echo ""
echo "============================================"
echo "  Agent installation complete!"
echo "============================================"
echo ""
echo "  Binary: $AGENT_PATH"
echo "  Server: $SERVER_URL"
echo ""
echo "  Start the agent:"
if [ "$OS" = "Darwin" ]; then
    echo "    launchctl load $PLIST_PATH"
elif [ "$OS" = "Linux" ]; then
    echo "    sudo systemctl enable --now o11y-agent"
else
    echo "    O11Y_SERVER_URL=$SERVER_URL $AGENT_PATH"
fi
echo ""
