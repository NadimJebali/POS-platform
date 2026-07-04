#!/usr/bin/env bash
# Nightly off-droplet backup of the SQLite database to DigitalOcean Spaces.
#
# Run on the droplet via cron (see DEPLOY.md). Reads its config from the environment
# (keep these in /root/pos-platform/backup.env, chmod 600, NOT in git):
#
#   DB_FILE            path to the live db (default ./data/pos-platform.db)
#   SPACES_BUCKET      e.g. pos-backups
#   SPACES_ENDPOINT    e.g. https://fra1.digitaloceanspaces.com
#   AWS_ACCESS_KEY_ID  DO Spaces access key
#   AWS_SECRET_ACCESS_KEY  DO Spaces secret key
#   KEEP_DAYS          local snapshots to retain (default 14)
#
# Requires: sqlite3 and the aws CLI (both installed in DEPLOY.md).
set -euo pipefail

DB_FILE="${DB_FILE:-./data/pos-platform.db}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$(dirname "$DB_FILE")/backups"
mkdir -p "$OUT_DIR"
SNAP="$OUT_DIR/pos-platform-$STAMP.db"

# Consistent snapshot even while the server is writing (uses SQLite's online backup).
sqlite3 "$DB_FILE" ".backup '$SNAP'"
gzip -f "$SNAP"
ARCHIVE="$SNAP.gz"

# Upload to Spaces (S3-compatible).
aws --endpoint-url "$SPACES_ENDPOINT" s3 cp "$ARCHIVE" "s3://$SPACES_BUCKET/$(basename "$ARCHIVE")"

# Prune old local snapshots (Spaces retention is handled by a bucket lifecycle rule).
find "$OUT_DIR" -name 'pos-platform-*.db.gz' -mtime "+$KEEP_DAYS" -delete

echo "backed up $ARCHIVE to s3://$SPACES_BUCKET/"
