#!/usr/bin/env bash
#
# ROSTR+ — Manual FTP deploy to Hostinger
#
# Why this script exists (read this before changing it):
#   The "natural" way to do this is `lftp mirror --reverse`. That command
#   LISTS the remote directory to decide what to upload, and lftp can't
#   parse the Arabic locale timestamps Hostinger's FTP returns ("أبريل" = April).
#   Mirror then silently concludes "nothing to do" and bails.
#
#   Workaround: enumerate files locally with `find`, upload each explicitly
#   with `put`. No remote listing = no parsing bug.
#
# Usage:
#   npm run deploy            # upload everything that isn't excluded
#   npm run deploy -- --dry   # list what would upload, don't transfer
#

set -euo pipefail

# ── Preflight ─────────────────────────────────────────────
if ! command -v lftp >/dev/null 2>&1; then
  echo "ERROR: lftp is not installed."
  echo "Install it with: brew install lftp"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.deploy"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  echo "Create it from .env.deploy.example and fill in FTP_PASSWORD."
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${FTP_HOST:?FTP_HOST missing in .env.deploy}"
: "${FTP_USER:?FTP_USER missing in .env.deploy}"
: "${FTP_PASSWORD:?FTP_PASSWORD missing in .env.deploy}"
: "${FTP_REMOTE_DIR:=/}"

# ── Flags ─────────────────────────────────────────────────
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry|--dry-run) DRY_RUN=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

cd "$REPO_ROOT"

# ── Build the file list ───────────────────────────────────
# find with prunes for excluded directory trees, then filter out excluded files.
# We also skip anything that's not tracked-by-git so we never upload debug
# scratch files or locally-generated junk.
FILES=$(find . \
  -type d \( \
    -name '.git' -o -name '.github' -o -name '.claude' -o \
    -name 'node_modules' -o -name 'scripts' -o -name 'supabase' -o -name 'e2e' \
  \) -prune -o \
  -type f \
  ! -name '.DS_Store' \
  ! -name '.env' ! -name '.env.*' \
  ! -name '.gitignore' \
  ! -name 'package.json' ! -name 'package-lock.json' \
  ! -name 'DEPLOY.md' ! -name 'README.md' \
  ! -name 'netlify.toml' ! -name 'serve.js' \
  ! -name 'supabase-schema.sql' ! -name '.mcp.json' \
  -print | sed 's|^\./||' | sort)

COUNT=$(echo "$FILES" | wc -l | tr -d ' ')

echo "Deploying $COUNT files: $REPO_ROOT  →  ftp://$FTP_HOST$FTP_REMOTE_DIR"
echo "User: $FTP_USER"
echo

if (( DRY_RUN )); then
  echo "───── DRY RUN — files that would upload ─────"
  echo "$FILES"
  echo
  echo "(no files transferred)"
  exit 0
fi

# ── Generate lftp script ──────────────────────────────────
# One `put -O /remote/dir localfile` per file. `put -O` auto-creates the
# remote directory. We use a heredoc with literal commands so quoting stays
# sane even for paths with spaces (there shouldn't be any, but safety first).
LFTP_SCRIPT=$(mktemp)
trap "rm -f $LFTP_SCRIPT" EXIT

{
  echo "set ssl:verify-certificate no"
  echo "set ftp:ssl-allow yes"
  echo "set ftp:passive-mode yes"
  echo "set net:max-retries 3"
  echo "set net:timeout 30"
  echo "set net:reconnect-interval-base 5"
  # Serial uploads. Parallel was dropping files silently on this server.
  echo "set cmd:parallel 1"
  # Ensure the remote base dir exists (harmless if already there)
  if [[ "$FTP_REMOTE_DIR" != "/" ]]; then
    echo "mkdir -p $FTP_REMOTE_DIR"
  fi
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    remote_dir=$(dirname "$f")
    if [[ "$remote_dir" == "." ]]; then
      remote_path="${FTP_REMOTE_DIR%/}/"
    else
      remote_path="${FTP_REMOTE_DIR%/}/$remote_dir/"
    fi
    # Echo + put so we see per-file progress in the transcript.
    # ! prefix runs the command locally. We use it to print a status line.
    printf '!echo "  ↑ %s"\n' "$f"
    printf 'put -O "%s" "%s"\n' "$remote_path" "$f"
  done <<< "$FILES"
  echo "bye"
} > "$LFTP_SCRIPT"

echo "Running $(wc -l < "$LFTP_SCRIPT") lftp commands..."
echo

lftp -u "$FTP_USER","$FTP_PASSWORD" "ftp://$FTP_HOST" < "$LFTP_SCRIPT"

echo
echo "✓ Deploy complete."
echo "  Live at https://rosterplus.io"
echo "  (hard-refresh may be needed — service worker cache)"
