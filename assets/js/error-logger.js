/* ══════════════════════════════════════════════════════════
 * ROSTR+ client error logger
 *
 * Loaded BEFORE app.js on every page. Captures:
 *   - Uncaught errors via window.addEventListener('error', …)
 *   - Unhandled promise rejections via 'unhandledrejection'
 *   - Manual window.logError(err, context) calls from any catch block
 *
 * Dual sink:
 *   1. Supabase public.client_errors (always, archival)
 *   2. Sentry (if window.ROSTR_SENTRY_DSN is set AND the Sentry CDN
 *      script loaded — falls through silently if either is missing).
 *
 * Guarantees:
 *   - Never throws inside its own error path. A bug in the logger
 *     must not create a crash loop.
 *   - Rate-limited to 20 events / 5-minute window per tab.
 *   - Never blocks page rendering — everything fires after init.
 *
 * Why it lives in a separate file (not app.js): we want it loaded
 * and registered before app.js so that any error during app.js
 * initialization is still captured. Loading order matters.
 * ══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Configuration (both safe to leave unset)
  // ──────────────────────────────────────────────
  // Paste the Sentry DSN here (or set window.ROSTR_SENTRY_DSN inline
  // on the page). Leave empty to skip Sentry entirely; Supabase sink
  // continues to work.
  var SENTRY_DSN = window.ROSTR_SENTRY_DSN || '';

  // Supabase endpoint — hard-coded to avoid circular dep with app.js.
  // Must match SUPABASE_URL + SUPABASE_ANON_KEY in app.js.
  var SUPA_URL  = 'https://vgjmfpryobsuboukbemr.supabase.co';
  var SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnam1mcHJ5b2JzdWJvdWtiZW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTkzNTksImV4cCI6MjA5MDk3NTM1OX0.8bd3ki35UxHcLVJm3mUhzE3udZ7yec2im-oH0SzQoyw';

  // Rate limit: stop runaway loops from DoSing our own table + Sentry quota.
  var WINDOW_MS = 5 * 60 * 1000;
  var MAX_EVENTS = 20;
  var events = [];

  // ──────────────────────────────────────────────
  // Sentry bootstrap (CDN version, optional)
  // ──────────────────────────────────────────────
  // If the Sentry SDK script loaded (via a separate <script> tag on
  // the page) AND we have a DSN, initialise. Otherwise we run without.
  function initSentry() {
    if (!SENTRY_DSN) return false;
    if (typeof window.Sentry === 'undefined' || typeof window.Sentry.init !== 'function') return false;
    try {
      window.Sentry.init({
        dsn: SENTRY_DSN,
        release: window.ROSTR_VERSION || 'dev',
        environment: location.hostname === 'rosterplus.io' ? 'production' : 'local',
        // We do our own capture inside the error/rejection handlers so
        // Sentry's auto-instrumentation would double-count. Disable the
        // redundant defaults.
        defaultIntegrations: false,
        // Trim stack traces at 50 frames; anything deeper is noise.
        maxValueLength: 2000,
        // Scrub query strings to avoid leaking booking IDs / tokens.
        beforeSend: function (event) {
          try {
            if (event.request && event.request.url) {
              event.request.url = event.request.url.split('?')[0];
            }
          } catch (_) { /* no-op */ }
          return event;
        },
      });
      return true;
    } catch (e) {
      // Sentry failed to init — don't let that break us.
      return false;
    }
  }

  var sentryReady = initSentry();

  // ──────────────────────────────────────────────
  // Core logger
  // ──────────────────────────────────────────────
  function rateLimitOk() {
    var now = Date.now();
    // Drop events older than the window.
    while (events.length && now - events[0] > WINDOW_MS) events.shift();
    if (events.length >= MAX_EVENTS) return false;
    events.push(now);
    return true;
  }

  function userId() {
    try {
      var t = localStorage.getItem('sb-vgjmfpryobsuboukbemr-auth-token');
      if (!t) return null;
      return JSON.parse(t).user && JSON.parse(t).user.id || null;
    } catch (_) { return null; }
  }

  function truncate(s, max) {
    if (!s) return '';
    s = String(s);
    return s.length > max ? s.slice(0, max) : s;
  }

  function toSupabase(payload) {
    // Fire-and-forget POST. We never await this — logger must never
    // block the page's error path.
    try {
      fetch(SUPA_URL + '/rest/v1/client_errors', {
        method: 'POST',
        headers: {
          'apikey': SUPA_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
        keepalive: true, // survives page unload
      }).catch(function () { /* swallow — don't create a crash loop */ });
    } catch (_) { /* no-op */ }
  }

  function toSentry(err, context) {
    if (!sentryReady || !window.Sentry) return;
    try {
      window.Sentry.captureException(err, { extra: context || {} });
    } catch (_) { /* no-op */ }
  }

  function logError(err, context) {
    if (!rateLimitOk()) return;
    try {
      // Normalise: accept Error instances or plain strings.
      var message, stack;
      if (err instanceof Error) {
        message = err.message || String(err);
        stack = err.stack || '';
      } else if (typeof err === 'string') {
        message = err;
        stack = (new Error()).stack || '';
      } else {
        message = 'Non-error thrown: ' + String(err);
        stack = '';
        try { message = 'Non-error thrown: ' + JSON.stringify(err); } catch (_) {}
      }

      var payload = {
        user_id:    userId(),
        url:        truncate(location.href, 512),
        user_agent: truncate(navigator.userAgent, 512),
        build:      window.ROSTR_VERSION || 'dev',
        message:    truncate(message, 2000),
        stack:      truncate(stack, 8000),
        context:    context || {},
      };

      toSupabase(payload);
      toSentry(err, context);
    } catch (e) {
      // Don't let the logger throw. Ever.
    }
  }

  // ──────────────────────────────────────────────
  // Global handlers
  // ──────────────────────────────────────────────
  window.addEventListener('error', function (ev) {
    // 'error' fires for uncaught exceptions AND for resource load
    // failures (img/script 404s). We filter the latter because
    // they're spammy and already surface in the Network tab.
    if (ev.target && ev.target !== window && ev.target.tagName) return;
    logError(ev.error || ev.message || 'Unknown error', {
      filename: ev.filename,
      lineno:   ev.lineno,
      colno:    ev.colno,
      kind:     'uncaught',
    });
  });

  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    logError(reason instanceof Error ? reason : new Error(String(reason)), {
      kind: 'unhandled_rejection',
    });
  });

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────
  window.logError = logError;
})();
