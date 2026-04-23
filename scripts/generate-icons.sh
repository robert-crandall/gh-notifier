#!/usr/bin/env bash
# Generate build/icon.icns from assets/icon-1024.png
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
ICON_PNG="$ROOT/assets/icon-1024.png"
ICONSET="$ROOT/build/icon.iconset"
ICNS="$ROOT/build/icon.icns"

if [ ! -f "$ICON_PNG" ]; then
  echo "Error: $ICON_PNG not found."
  exit 1
fi

mkdir -p "$ICONSET"

echo "Generating icon sizes..."
sips -z 16   16   "$ICON_PNG" --out "$ICONSET/icon_16x16.png"    >/dev/null
sips -z 32   32   "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32   32   "$ICON_PNG" --out "$ICONSET/icon_32x32.png"    >/dev/null
sips -z 64   64   "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128  128  "$ICON_PNG" --out "$ICONSET/icon_128x128.png"  >/dev/null
sips -z 256  256  "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256  256  "$ICON_PNG" --out "$ICONSET/icon_256x256.png"  >/dev/null
sips -z 512  512  "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512  512  "$ICON_PNG" --out "$ICONSET/icon_512x512.png"  >/dev/null
cp "$ICON_PNG" "$ICONSET/icon_512x512@2x.png"

echo "Building .icns..."
iconutil -c icns "$ICONSET" -o "$ICNS"

rm -rf "$ICONSET"
echo "Done: $ICNS"
