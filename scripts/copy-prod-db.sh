#!/usr/bin/env bash
# Copies the production database to the dev database.
# Errors if the app appears to be running (WAL/SHM files present).

set -euo pipefail

DATA_DIR="$HOME/Library/Application Support/gh-projects"
PROD_DB="$DATA_DIR/gh-projects.db"
DEV_DB="$DATA_DIR/gh-projects-dev.db"

if [[ ! -f "$PROD_DB" ]]; then
  echo "Error: production database not found at: $PROD_DB" >&2
  exit 1
fi

# WAL mode creates .db-wal and .db-shm while the database is open.
# Copying while these exist risks a corrupt snapshot.
for db in "$PROD_DB" "$DEV_DB"; do
  for ext in wal shm; do
    if [[ -f "$db-$ext" ]]; then
      echo "Error: $db-$ext exists — the app may be running." >&2
      echo "Close the app and try again." >&2
      exit 1
    fi
  done
done

cp "$PROD_DB" "$DEV_DB"
echo "Copied prod → dev"
echo "  $PROD_DB"
echo "  → $DEV_DB"
