#!/usr/bin/env bash
#
# deploy-stamp.sh — write the build SHA into sw.js + app.js + every
# HTML asset reference. Called by Netlify as the build command.
#
# Why these stamps exist:
#   1. sw.js CACHE_NAME rotates → service worker invalidates its cache
#      bucket on the next activate, old clients refetch fresh app.js.
#   2. window.ROSTR_VERSION lets support triage eyeball "what build is
#      this user running" from devtools.
#   3. ?v=<sha> on every <link>/<script> ref to /assets/* makes the
#      effective URL unique per deploy, so the netlify.toml's 1-year
#      immutable cache header on /assets/* is safe — repeat visitors
#      in a deploy window fetch zero bytes on the hot path.
#
# This is the *Netlify-callable* version. The local lftp deploy script
# (scripts/deploy.sh) does the same stamping, deploys, then restores
# originals from .deploy-bak. On Netlify there's no restore — the
# build environment is ephemeral, every build starts from a fresh
# checkout of the commit being deployed.

set -euo pipefail

# Netlify exposes the deploying commit as $COMMIT_REF. Locally fall
# back to git or epoch-seconds if neither is available.
BUILD_SHA="${COMMIT_REF:-}"
if [[ -z "$BUILD_SHA" ]]; then
  BUILD_SHA=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
fi
# Trim to 7 chars to match what scripts/deploy.sh stamps locally.
BUILD_SHA="${BUILD_SHA:0:7}"
echo "Build SHA: $BUILD_SHA"

# ── Stamp sw.js ───────────────────────────────────────────
sed -i.tmp "s/^const CACHE_NAME = .*/const CACHE_NAME = 'rostr-$BUILD_SHA';/" sw.js
rm -f sw.js.tmp

# ── Stamp window.ROSTR_VERSION at the top of app.js ───────
if grep -q '^window.ROSTR_VERSION' assets/js/app.js; then
  sed -i.tmp "s/^window.ROSTR_VERSION.*/window.ROSTR_VERSION = '$BUILD_SHA';/" assets/js/app.js
else
  printf "window.ROSTR_VERSION = '%s';\n%s" "$BUILD_SHA" "$(cat assets/js/app.js)" > assets/js/app.js.tmp
  mv assets/js/app.js.tmp assets/js/app.js
fi
rm -f assets/js/app.js.tmp

# ── Minify app.js + error-logger.js (2026-05-13 audit v2 P2) ─────
# esbuild runs in-place on the build artifact. Source files in git
# stay unminified — only the deployed copy gets minified. Wins:
#   app.js          207 KB → ~120 KB (~30 KB brotli savings per cold visit)
#   error-logger.js  10 KB → ~5  KB
#
# Stamps SURVIVE minification because esbuild preserves variable
# assignments. The ROSTR_VERSION line above becomes
# `window.ROSTR_VERSION="$SHA";` (no functional change).
#
# Sourcemaps land next to the JS so Sentry / DevTools resolve traces
# to original lines. They're served at the same path; ignored by
# normal page-load.
#
# Local lftp deploy (scripts/deploy.sh) backs up app.js to
# .deploy-bak BEFORE this script runs, then restores after FTP
# upload — so locally, git stays unminified too. On Netlify the
# build env is ephemeral so there's no restore step.
#
# If npx isn't available (rare), the step skips silently and the
# unminified file ships. App still works, just ~30 KB heavier.
if command -v npx >/dev/null 2>&1; then
  echo "Minifying assets/js/app.js..."
  if npx --yes esbuild assets/js/app.js \
       --minify --target=es2020 --legal-comments=none --keep-names \
       --outfile=assets/js/app.js.min --sourcemap=external 2>/dev/null; then
    mv assets/js/app.js.min assets/js/app.js
    mv assets/js/app.js.min.map assets/js/app.js.map
    echo "  app.js minified ($(wc -c < assets/js/app.js) bytes)"
  else
    echo "  esbuild failed for app.js — shipping unminified"
  fi

  echo "Minifying assets/js/error-logger.js..."
  if npx --yes esbuild assets/js/error-logger.js \
       --minify --target=es2020 --legal-comments=none --keep-names \
       --outfile=assets/js/error-logger.js.min --sourcemap=external 2>/dev/null; then
    mv assets/js/error-logger.js.min assets/js/error-logger.js
    mv assets/js/error-logger.js.min.map assets/js/error-logger.js.map
    echo "  error-logger.js minified ($(wc -c < assets/js/error-logger.js) bytes)"
  else
    echo "  esbuild failed for error-logger.js — shipping unminified"
  fi
else
  echo "npx not found — skipping minification"
fi

# ── Cache-bust HTML asset references ──────────────────────
# Match: src="assets/js/X.js" or href="assets/css/X.css", with or
#        without an existing ?v=… query string.
# Set:   ?v=<sha>
#
# Two passes per pattern:
#   1. Replace existing ?v=… with the current SHA. Catches stamps
#      that got committed from past local lftp deploys (the
#      .deploy-bak restore wasn't always run cleanly).
#   2. Append ?v=<sha> to bare refs that have no query at all.
#
# Order matters — rewrite first, append second, otherwise the
# append regex would double-stamp ?v=<sha>?v=<sha>.
for html in *.html; do
  [[ -f "$html" ]] || continue
  sed -i.tmp -E \
    -e "s@(src|href)=\"(assets/(js|css)/[^\"?]+\.(js|css))\?v=[^\"]*\"@\1=\"\2?v=$BUILD_SHA\"@g" \
    -e "s@(src|href)=\"/(assets/(js|css)/[^\"?]+\.(js|css))\?v=[^\"]*\"@\1=\"/\2?v=$BUILD_SHA\"@g" \
    -e "s@(src|href)=\"(assets/(js|css)/[^\"?]+\.(js|css))\"@\1=\"\2?v=$BUILD_SHA\"@g" \
    -e "s@(src|href)=\"/(assets/(js|css)/[^\"?]+\.(js|css))\"@\1=\"/\2?v=$BUILD_SHA\"@g" \
    "$html"
  rm -f "$html.tmp"
done

echo "Stamped sw.js + app.js + HTML asset refs with $BUILD_SHA"
