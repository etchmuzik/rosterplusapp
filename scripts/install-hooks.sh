#!/usr/bin/env bash
#
# install-hooks.sh — copy scripts/git-hooks/* into .git/hooks/.
#
# Run once after cloning the repo so `git push origin main` triggers
# the auto-deploy via the pre-push hook (see scripts/git-hooks/pre-push
# for the why and the bypass flag).
#
# Idempotent — re-run any time you pull a hook update.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

if [[ ! -d "$HOOKS_DST" ]]; then
  echo "ERROR: $HOOKS_DST not found — is this a git checkout?" >&2
  exit 1
fi

if [[ ! -d "$HOOKS_SRC" ]]; then
  echo "ERROR: $HOOKS_SRC not found — has scripts/git-hooks/ been deleted?" >&2
  exit 1
fi

INSTALLED=0
for hook_src in "$HOOKS_SRC"/*; do
  [[ -f "$hook_src" ]] || continue
  hook_name=$(basename "$hook_src")
  hook_dst="$HOOKS_DST/$hook_name"
  cp "$hook_src" "$hook_dst"
  chmod +x "$hook_dst"
  echo "installed: .git/hooks/$hook_name"
  ((INSTALLED++))
done

echo
echo "✓ Installed $INSTALLED git hook(s)."
echo "  Bypass any hook with: --no-verify on the git command."
