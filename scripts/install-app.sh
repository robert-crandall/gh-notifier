#!/usr/bin/env bash
# Build and install GH Projects to /Applications
set -euo pipefail

APP_NAME="GH Projects"
INSTALL_DIR="/Applications"
INSTALLED="$INSTALL_DIR/$APP_NAME.app"

# Check for icon — suggest generating it if missing
if [ ! -f "build/icon.icns" ]; then
  echo "Warning: build/icon.icns not found. Place an icon at build/icon.icns before distributing."
  echo "         Continuing without a custom icon..."
fi

echo "==> Building $APP_NAME..."
bun run build

echo "==> Packaging app bundle..."
bunx electron-builder --dir --mac

# Find the .app (handles Intel and Apple Silicon output paths)
APP=$(find dist -maxdepth 2 -name "*.app" -type d 2>/dev/null | head -1)

if [ -z "$APP" ]; then
  echo "Error: Could not find a .app bundle under dist/"
  exit 1
fi

# Stop the app if it is currently running
if pgrep -x "$APP_NAME" &>/dev/null; then
  echo "==> Stopping running instance of $APP_NAME..."
  pkill -x "$APP_NAME" || true
  sleep 1
fi

# Remove any existing installation
if [ -d "$INSTALLED" ]; then
  echo "==> Removing previous installation..."
  rm -rf "$INSTALLED"
fi

echo "==> Installing to $INSTALL_DIR..."
cp -r "$APP" "$INSTALL_DIR/"

echo ""
echo "GH Projects installed to $INSTALLED"
echo "Launch it from Spotlight or Launchpad."
