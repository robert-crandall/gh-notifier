#!/usr/bin/env bash
# Copies the production database to the dev database.
# Safe to run while the app is not open (SQLite WAL mode — no hot-copy needed).

set -euo pipefail

DATA_DIR="$HOME/Library/Application Support/gh-projects"
PROD_DB="$DATA_DIR/gh-projects.db"
DEV_DB="$DATA_DIR/gh-projects-dev.db"

if [[ ! -f "$PROD_DB" ]]; then
  echo "Error: production database not found at: $PROD_DB" >&2
  exit 1
fi

cp "$PROD_DB" "$DEV_DB"
echo "Copied prod → dev"
echo "  $PROD_DB"
echo "  → $DEV_DB"
