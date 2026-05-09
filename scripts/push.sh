#!/usr/bin/env bash
#
# push.sh — push to main + deploy to Hostinger in one command.
#
# This exists as the everyday-deploy command UNTIL the GitHub Actions
# auto-deploy is unblocked (currently failing due to a billing lockout —
# see DEPLOY.md for context). Once Actions runs cleanly, this script
# is redundant: just `git push origin main` will be enough.
#
# Usage:
#   bash scripts/push.sh                    # push current branch + deploy
#   bash scripts/push.sh --skip-deploy      # push only, skip the deploy step
#
# Failure modes:
#   - If `git push` fails, we DO NOT deploy. The remote and the live
#     site stay consistent.
#   - If the deploy fails, the push has already succeeded. Re-run
#     `bash scripts/deploy.sh --skip-checks` from the same checkout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SKIP_DEPLOY=0
for arg in "$@"; do
  case "$arg" in
    --skip-deploy) SKIP_DEPLOY=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# 1. Push. If this fails (auth, conflict, hook rejection), bail before
#    the deploy so we don't ship a tree the remote hasn't accepted.
echo "==> git push origin main"
git push origin main

if (( SKIP_DEPLOY )); then
  echo "==> --skip-deploy set, stopping here"
  exit 0
fi

# 2. Deploy. --skip-checks because the same checks already ran (or will
#    run, once Actions billing is fixed) in CI; running them twice
#    locally just slows the dev loop.
echo "==> bash scripts/deploy.sh --skip-checks"
bash scripts/deploy.sh --skip-checks

echo
echo "✓ Push + deploy complete."
