#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="GitHub Task Manager"
BUNDLE_PATH="$REPO_ROOT/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
INSTALL_PATH="/Applications/${APP_NAME}.app"

cd "$REPO_ROOT"

echo "==> Running quality gates (bun run ci)..."
bun run ci

echo "==> Building release bundle..."
bun run tauri build

if [[ ! -d "$BUNDLE_PATH" ]]; then
  echo "ERROR: Build succeeded but app bundle not found at: $BUNDLE_PATH" >&2
  exit 1
fi

echo "==> Installing to /Applications..."
if [[ -d "$INSTALL_PATH" ]]; then
  rm -rf "$INSTALL_PATH"
fi
cp -r "$BUNDLE_PATH" "$INSTALL_PATH"

echo "==> Done. ${APP_NAME}.app installed to /Applications."
