window.ROSTR_VERSION = '2f4f930';
/* ═══════════════════════════════════════════════════════════
   ROSTR+ GCC — Core Application JS
   Supabase client, auth, router, UI helpers, live data
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Config ──
const SUPABASE_URL = 'https://vgjmfpryobsuboukbemr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnam1mcHJ5b2JzdWJvdWtiZW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTkzNTksImV4cCI6MjA5MDk3NTM1OX0.8bd3ki35UxHcLVJm3mUhzE3udZ7yec2im-oH0SzQoyw';

let _sb = null;
let DEMO_MODE = false;
// FORCE_DEMO: opt-in flag for local offline demos. Enable by adding
// ?demo=1 to any URL, or by setting localStorage.rostr_force_demo=1.
// Previously DEMO_MODE silently turned on when the Supabase CDN failed
// to load — which caused the 'logged in as demo-123456789' bug where
// users thought they had real accounts but were actually in fake mode.
// Now we fail loudly and show a connection-error state instead.
const FORCE_DEMO = (() => {
  try {
    if (new URLSearchParams(location.search).get('demo') === '1') return true;
    if (localStorage.getItem('rostr_force_demo') === '1') return true;
  } catch (_) { /* no storage / SSR */ }
  return false;
})();

function initSupabase() {
  if (FORCE_DEMO) {
    DEMO_MODE = true;
    console.warn('[ROSTR] FORCE_DEMO active — running on localStorage only. Real Supabase calls disabled.');
    return;
  }
  if (!window.supabase) {
    console.error('[ROSTR] Supabase SDK failed to load. Check CSP / ad-blocker / network.');
    // Do NOT silently fall into demo mode. Leave _sb null so DB functions
    // return a clear 'Not authenticated' / 'Offline' error rather than
    // quietly pretending everything works via fake data.
    DEMO_MODE = false;
    return;
  }
  try {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    DEMO_MODE = false;
    console.log('[ROSTR] Supabase connected');
  } catch(e) {
    console.error('[ROSTR] Supabase client creation failed:', e);
    DEMO_MODE = false;
    _sb = null;
  }
}

// ── Auth State ──
const Auth = {
  user: null,
  role: null, // 'promoter' | 'artist' | 'admin'
  _readyResolve: null,
  _readyPromise: null,
  _initialized: false,

  // Returns a promise that resolves when auth is initialized
  ready() {
    if (this._initialized) return Promise.resolve();
    if (!this._readyPromise) {
      this._readyPromise = new Promise(resolve => { this._readyResolve = resolve; });
    }
    return this._readyPromise;
  },

  init() {
    // Make sure Supabase is initialized first
    initSupabase();

    // Always check for demo user in localStorage (persists across page loads)
    const saved = localStorage.getItem('rostr_demo_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        parsed.role = (parsed.role === 'admin') ? 'promoter' : parsed.role;
        this.user = parsed;
        this.role = parsed.role;
      } catch(e) {
        localStorage.removeItem('rostr_demo_user');
      }
    }

    // If Supabase unavailable, finish sync
    if (DEMO_MODE) {
      this._initialized = true;
      if (this._readyResolve) this._readyResolve();
      this.updateUI();
      return;
    }

    // Async path for Supabase — real session overrides demo user.
    //
    // IMPORTANT: Supabase JS v2 holds an internal auth lock during
    // getSession() AND during every onAuthStateChange callback. If we
    // call a PostgREST query (like loadProfile) while that lock is held,
    // the query waits for the auth lock — which waits for our callback —
    // creating an infinite deadlock. The symptom is Auth._initialized
    // staying false forever and every DB query hanging.
    //
    // Fix: defer the loadProfile call via setTimeout(…, 0) so it runs on
    // the next macrotask, after the auth client has released its lock.
    // Safety net: resolve ready() after 6s regardless so a network stall
    // can't hang the whole UI indefinitely.
    const SAFETY_MS = 6000;
    let didResolveReady = false;
    const resolveReadyOnce = () => {
      if (didResolveReady) return;
      didResolveReady = true;
      this._initialized = true;
      if (this._readyResolve) this._readyResolve();
      this.updateUI();
    };
    const safetyTimer = setTimeout(() => {
      if (!didResolveReady) console.warn('[ROSTR] Auth init safety-timeout fired');
      resolveReadyOnce();
    }, SAFETY_MS);

    _sb.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        this.user = session.user;
        localStorage.removeItem('rostr_demo_user');
        // Defer — see note above.
        return new Promise((r) => setTimeout(() => this.loadProfile().then(r).catch(r), 0));
      }
    }).then(() => {
      clearTimeout(safetyTimer);
      resolveReadyOnce();
    }).catch((err) => {
      console.error('[ROSTR] Auth init failed:', err);
      clearTimeout(safetyTimer);
      resolveReadyOnce();
    });

    // Listen for auth changes (skip if demo user is active). Same
    // deadlock risk applies here — any sync DB call inside this handler
    // blocks forever. Defer via setTimeout so the auth lock releases.
    _sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        this.user = session.user;
        localStorage.removeItem('rostr_demo_user');
        setTimeout(() => {
          this.loadProfile().then(() => this.updateUI()).catch(() => this.updateUI());
        }, 0);
      } else if (!localStorage.getItem('rostr_demo_user')) {
        this.user = null;
        this.role = null;
        this.updateUI();
      }
    });
  },

  async loadProfile() {
    if (!this.user || DEMO_MODE) return;
    // Pull all the profile fields the app actually reads off Auth.user
    // elsewhere (dashboard greeting uses city, settings prefills phone/
    // company, etc.). Previously only role + display_name + avatar were
    // loaded so freshly-saved city/phone didn't surface until a reload.
    const { data } = await _sb
      .from('profiles')
      .select('role, display_name, avatar_url, city, phone, company, bio')
      .eq('id', this.user.id)
      .single();
    if (data) {
      this.role = data.role;
      this.user.display_name = data.display_name;
      this.user.avatar_url = data.avatar_url;
      this.user.city = data.city;
      this.user.phone = data.phone;
      this.user.company = data.company;
      this.user.bio = data.bio;
    }
  },

  async signUp(email, password, role, name) {
    if (DEMO_MODE) {
      this.user = { id: 'demo-' + Date.now(), email, display_name: name, role };
      this.role = role;
      localStorage.setItem('rostr_demo_user', JSON.stringify(this.user));
      this.updateUI();
      return { success: true };
    }

    // Custom signup via the 'signup' edge function. Bypasses Supabase's
    // built-in SMTP (which would require dashboard config + gets
    // rate-limited) by using the admin API to create the user with
    // email_confirm=true so they can sign in immediately.
    //
    // Flow:
    //   1. POST email/password/role/name to the edge function
    //   2. Edge function calls supaAdmin.auth.admin.createUser() with
    //      pre-confirmed email, which fires the handle_new_user trigger
    //      to create the matching profiles row
    //   3. Edge function sends the welcome email via Resend
    //   4. Client then does a normal _sb.auth.signInWithPassword()
    //      to establish a session locally
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password, role, display_name: name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the error codes our edge function returns in a friendly way
        const msgMap = {
          email_taken:   'An account with that email already exists. Try signing in.',
          weak_password: 'Password must be at least 8 characters.',
          invalid_email: 'That doesn\u2019t look like a valid email address.',
          invalid_role:  'Pick either Promoter or Artist.',
          rate_limited:  'Too many attempts. Wait a minute and try again.',
        };
        return { success: false, error: msgMap[body.error] || body.error || 'Sign up failed' };
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }

    // Signup succeeded server-side. Now sign in locally so the browser
    // has a valid Supabase session for subsequent DB queries.
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: 'Account created but sign-in failed: ' + error.message };

    this.user = data.user;
    this.role = role;
    await this.loadProfile();
    return { success: true };
  },

  async signIn(email, password) {
    if (DEMO_MODE) {
      // Demo sign in
      this.user = {
        id: 'demo-' + Date.now(),
        email,
        display_name: email.split('@')[0],
        role: 'promoter'
      };
      this.role = 'promoter';
      localStorage.setItem('rostr_demo_user', JSON.stringify(this.user));
      this.updateUI();
      return { success: true };
    }

    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    if (data.user) {
      this.user = data.user;
      await this.loadProfile();
    }
    return { success: true };
  },

  async signOut() {
    localStorage.removeItem('rostr_demo_user');
    if (!DEMO_MODE) {
      try { await _sb.auth.signOut(); } catch(e) { /* ignore signout errors */ }
    }
    this.user = null;
    this.role = null;
    this.updateUI();
    window.location.href = 'index.html';
  },

  // Revokes every active session for this user — on every device, every
  // browser, every tab. Uses Supabase's global scope which invalidates
  // the refresh token server-side, so other devices can't silently
  // refresh back to a valid session.
  //
  // Used from the settings "Security" section. Falls back to a local
  // signOut if the server call fails so the user isn't left in a weird
  // half-signed-out state.
  async signOutEverywhere() {
    localStorage.removeItem('rostr_demo_user');
    if (!DEMO_MODE) {
      try {
        await _sb.auth.signOut({ scope: 'global' });
      } catch (e) {
        // Fall through to local signOut so the user ends up logged out
        // at minimum on this device. They'll have to re-try on others.
      }
    }
    this.user = null;
    this.role = null;
    this.updateUI();
    window.location.href = 'index.html';
  },

  isLoggedIn() {
    return !!this.user;
  },

  // Synchronous check — use AFTER Auth.init() has run (e.g., in DOMContentLoaded after init)
  require(redirect = 'auth.html') {
    if (!this.isLoggedIn()) {
      window.location.href = redirect + '?redirect=' + encodeURIComponent(window.location.pathname);
      return false;
    }
    return true;
  },

  // Async check — safe to call anywhere, waits for init to finish first
  async requireAsync(redirect = 'auth.html') {
    await this.ready();
    return this.require(redirect);
  },

  updateUI() {
    // Update nav auth buttons
    document.querySelectorAll('[data-auth="logged-in"]').forEach(el => {
      // Check if element should use flex display
      const isFlex = el.getAttribute('data-auth-flex');
      el.style.display = this.isLoggedIn() ? (isFlex ? 'flex' : '') : 'none';
    });
    document.querySelectorAll('[data-auth="logged-out"]').forEach(el => {
      el.style.display = this.isLoggedIn() ? 'none' : '';
    });
    // Set user avatar — prefer uploaded avatar_url, fall back to first initial.
    document.querySelectorAll('.nav-avatar').forEach(el => {
      if (!this.user) return;
      const url = this.user.avatar_url;
      if (url) {
        el.textContent = '';
        el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.setAttribute('aria-label', this.user.display_name || 'Account');
      } else {
        const name = this.user.display_name || this.user.email || '';
        el.textContent = name.charAt(0).toUpperCase();
        el.style.backgroundImage = '';
      }
    });
    // Set display name
    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = this.user?.display_name || '';
    });
  }
};

// ── UI Helpers ──
// ── XSS Protection ──
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

const UI = {
  // Generate initials avatar with color based on name
  avatar(name, size = 40) {
    const colors = ['#c9a84c', '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c'];
    const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
    const color = colors[idx];
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color}15;border:1px solid ${color}40;display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:${size * 0.35}px;font-weight:600;color:${color};flex-shrink:0">${initials}</div>`;
  },

  // Status tag
  stars(rating, max = 5) {
    const r = Math.round((rating || 0) * 2) / 2;
    let html = '<span class="stars">';
    for (let i = 1; i <= max; i++) {
      html += `<span class="star ${i <= r ? 'filled' : ''}">&#9733;</span>`;
    }
    return html + '</span>';
  },

  mediaEmbed(url) {
    if (!url) return '';
    if (url.includes('soundcloud.com')) {
      return `<div class="media-embed"><iframe height="166" scrolling="no" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23c9a84c&auto_play=false&show_artwork=true" loading="lazy"></iframe></div>`;
    }
    if (url.includes('open.spotify.com')) {
      const spotifyUri = url.replace('https://open.spotify.com/', '').replace(/\//g, ':').split('?')[0];
      return `<div class="media-embed"><iframe height="152" src="https://open.spotify.com/embed/${url.split('open.spotify.com/')[1]?.split('?')[0]}" allow="encrypted-media" loading="lazy"></iframe></div>`;
    }
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const id = url.includes('youtu.be/') ? url.split('youtu.be/')[1]?.split('?')[0] : new URLSearchParams(new URL(url).search).get('v');
      if (id) return `<div class="media-embed"><iframe height="315" src="https://www.youtube-nocookie.com/embed/${id}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    }
    return '';
  },

  statusTag(status) {
    const map = {
      confirmed: 'confirmed', signed: 'confirmed',
      pending: 'pending', sent: 'pending',
      cancelled: 'cancelled', rejected: 'cancelled',
      draft: 'draft'
    };
    return `<span class="tag tag--${map[status] || 'draft'}">${status}</span>`;
  },

  // Format currency
  currency(amount, code = 'AED') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
  },

  // Time ago
  timeAgo(date) {
    const now = new Date();
    const d = new Date(date);
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  // Format date
  formatDate(date) {
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  // Toast notification
  toast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = { success: '#34d399', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;padding:12px 20px;
      background:var(--bg-raised);border:1px solid ${colors[type]}40;
      border-radius:var(--radius-md);color:var(--text-primary);
      font-size:0.88rem;z-index:3000;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
      animation:fadeIn 400ms cubic-bezier(0.32,0.72,0,1) both;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 300ms ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Reusable empty-state renderer. Used across dashboards, bookings, messages,
  // contracts, payments, etc. to keep the "nothing here yet" visual language
  // consistent and always paired with a clear next-action.
  //
  // Opts:
  //   icon:    UI.icon name (default: 'inbox')
  //   title:   short heading (required)
  //   body:    1-2 sentence explanation (optional)
  //   cta:     { label, href } OR { label, onclick } to render a primary button
  //   compact: boolean — use tight vertical padding (for cards/panels) instead
  //            of the default spacious dashboard layout
  emptyState(opts = {}) {
    const {
      icon = 'inbox',
      title = 'Nothing here yet',
      body = '',
      cta = null,
      compact = false,
    } = opts;
    const padY = compact ? 'var(--space-xl)' : 'var(--space-4xl)';
    const iconSize = compact ? 36 : 56;
    const ctaHtml = (() => {
      if (!cta || !cta.label) return '';
      if (cta.href) {
        return `<a href="${cta.href}" class="btn btn-primary btn-sm" style="margin-top:var(--space-md)">${cta.label}</a>`;
      }
      if (cta.onclick) {
        return `<button class="btn btn-primary btn-sm" style="margin-top:var(--space-md)" onclick="${cta.onclick}">${cta.label}</button>`;
      }
      return '';
    })();
    const bodyHtml = body
      ? `<p style="color:var(--text-tertiary);max-width:40ch;margin:0 auto;font-size:0.88rem;line-height:1.55">${body}</p>`
      : '';
    return `
      <div class="ui-empty-state" style="text-align:center;padding:${padY} var(--space-lg)">
        <div style="color:var(--text-tertiary);opacity:0.28;margin-bottom:var(--space-md);display:flex;justify-content:center">${this.icon(icon, iconSize)}</div>
        <h3 style="color:var(--text-secondary);margin:0 0 var(--space-xs);font-size:${compact ? '0.95rem' : '1.1rem'};font-weight:600">${title}</h3>
        ${bodyHtml}
        ${ctaHtml}
      </div>
    `;
  },

  // Renders a small completion meter: accent-filled bar + "N% complete"
  // label. `variant: 'banner'` wraps it in a padded card with a heading
  // and the first missing field as an inline nudge — used on dashboards.
  // `variant: 'inline'` is just the bar + label, meant for the top of
  // the settings page.
  completionMeter(pct, opts = {}) {
    const { variant = 'inline', missing = [], heading = null, dismissId = null } = opts;
    pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    const barHtml = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);font-size:0.78rem;color:var(--text-tertiary)">
        <div style="flex:1;height:6px;background:var(--bg-card);border-radius:999px;overflow:hidden;border:1px solid var(--border-subtle)">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent-deep),var(--accent));transition:width 500ms ease-out"></div>
        </div>
        <span style="font-family:var(--font-mono);font-weight:600;color:${pct === 100 ? 'var(--status-confirmed)' : 'var(--text-secondary)'};min-width:44px;text-align:right">${pct}%</span>
      </div>
    `;
    if (variant === 'inline') return barHtml;

    // Banner variant — skip entirely if at 100%
    if (pct >= 100) return '';
    const first = missing && missing[0];
    const nudge = first
      ? `<a href="${first.href}" class="btn btn-secondary btn-sm" style="margin-left:auto;flex-shrink:0">${first.label} →</a>`
      : '';
    const dismissBtn = dismissId
      ? `<button onclick="UI.dismissCompletion('${dismissId}')" aria-label="Hide" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;padding:4px 6px;font-size:1.1rem;line-height:1">×</button>`
      : '';
    return `
      <div class="completion-banner" style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:var(--space-md) var(--space-lg);margin-bottom:var(--space-lg);display:flex;flex-direction:column;gap:var(--space-sm)">
        <div style="display:flex;align-items:center;gap:var(--space-md)">
          <div style="flex:1">
            <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:2px">${heading || 'Finish setting up your profile'}</div>
            <div style="font-size:0.76rem;color:var(--text-tertiary)">${missing.length} ${missing.length === 1 ? 'thing' : 'things'} left to make your profile shine</div>
          </div>
          ${nudge}
          ${dismissBtn}
        </div>
        ${barHtml}
      </div>
    `;
  },

  // First-session onboarding stepper. Renders a card with each checklist
  // item as a row: ring icon (done/todo), label, and a "Start" CTA for
  // the first open step. Completed steps are visually checked off.
  // Caller passes steps[] — each has { key, label, desc, href, done }.
  onboardingChecklist(steps, opts = {}) {
    const { heading = 'Welcome to ROSTR+', dismissId = 'onboard' } = opts;
    const total = steps.length;
    const done = steps.filter(s => s.done).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const nextIdx = steps.findIndex(s => !s.done);
    const rows = steps.map((s, i) => {
      const isNext = i === nextIdx;
      const ring = s.done
        ? `<div style="width:22px;height:22px;border-radius:50%;background:var(--status-confirmed);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff">${this.icon('check', 12)}</div>`
        : `<div style="width:22px;height:22px;border-radius:50%;border:1.5px solid ${isNext ? 'var(--accent)' : 'var(--border-medium)'};background:transparent;flex-shrink:0"></div>`;
      const cta = !s.done && isNext
        ? `<a href="${s.href}" class="btn btn-secondary btn-sm" style="margin-left:auto;flex-shrink:0">Start \u2192</a>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:var(--space-md);padding:10px 0;${s.done ? 'opacity:0.65' : ''}">
          ${ring}
          <div style="flex:1;min-width:0">
            <div style="font-size:0.88rem;color:var(--text-primary);font-weight:${isNext ? '600' : '500'};${s.done ? 'text-decoration:line-through' : ''}">${s.label}</div>
            ${s.desc ? `<div style="font-size:0.74rem;color:var(--text-tertiary);margin-top:2px">${s.desc}</div>` : ''}
          </div>
          ${cta}
        </div>
      `;
    }).join('');
    const dismissBtn = dismissId
      ? `<button onclick="UI.dismissCompletion('${dismissId}')" aria-label="Hide" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;padding:4px 6px;font-size:1.2rem;line-height:1">\u00d7</button>`
      : '';
    return `
      <div class="completion-banner" style="background:var(--bg-card);border:1px solid var(--accent-dim-20);border-radius:var(--radius-md);padding:var(--space-lg);margin-bottom:var(--space-lg);box-shadow:var(--accent-glow)">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-md)">
          <div style="flex:1">
            <div style="font-size:0.78rem;color:var(--accent);letter-spacing:0.12em;text-transform:uppercase;font-family:var(--font-mono);margin-bottom:4px">Get set up</div>
            <div style="font-size:1.1rem;font-weight:600;color:var(--text-primary)">${heading}</div>
            <div style="font-size:0.82rem;color:var(--text-tertiary);margin-top:2px">${done} of ${total} steps complete \u00b7 takes ~3 min</div>
          </div>
          ${dismissBtn}
        </div>
        ${this.completionMeter(pct, { variant: 'inline' })}
        <div style="margin-top:var(--space-md);display:flex;flex-direction:column">${rows}</div>
      </div>
    `;
  },

  // Persist a "hide this banner for today" flag in localStorage. Banner
  // reappears at midnight local time.
  dismissCompletion(id) {
    try { localStorage.setItem(`rostr_completion_dismissed_${id}`, new Date().toDateString()); } catch (_) {}
    const banner = document.querySelector('.completion-banner');
    if (banner) banner.remove();
  },

  isCompletionDismissedToday(id) {
    try { return localStorage.getItem(`rostr_completion_dismissed_${id}`) === new Date().toDateString(); }
    catch (_) { return false; }
  },

  // Render a share button that opens a popover with QR code, copy-link,
  // WhatsApp share, and native Web Share API (mobile). Used on artist
  // profile + EPK + artist dashboard. Returns HTML string for inline
  // placement; the open/close is wired via UI.openShare(url, title).
  shareButton({ label = 'Share', variant = 'ghost', size = 'sm' } = {}) {
    const btnClass = `btn btn-${variant}${size ? ' btn-' + size : ''}`;
    return `<button class="${btnClass}" onclick="UI.openShare(location.href, document.title)">${this.icon('send', 14)} ${label}</button>`;
  },

  // Open the share popover. Mounted lazily on body, hidden by default.
  openShare(url, title) {
    let overlay = document.getElementById('rostr-share-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rostr-share-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2500;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:var(--space-md)';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
      document.body.appendChild(overlay);
    }
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&format=svg&data=${encodeURIComponent(url)}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent((title || 'Check this out') + '\n' + url)}`;
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    overlay.innerHTML = `
      <div style="background:var(--bg-raised);border:1px solid var(--border-medium);border-radius:var(--radius-lg);padding:var(--space-lg);width:min(400px,94vw);box-shadow:var(--shadow-lg)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">
          <h3 style="margin:0;font-size:1rem">Share</h3>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('rostr-share-overlay').style.display='none'" aria-label="Close">&times;</button>
        </div>
        <div style="display:flex;justify-content:center;margin-bottom:var(--space-md)">
          <div style="background:#fff;padding:12px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center">
            <img src="${qrSrc}" alt="QR code" width="180" height="180" style="display:block" onerror="this.style.opacity='0.3';this.alt='QR unavailable'">
          </div>
        </div>
        <div style="font-size:0.76rem;color:var(--text-tertiary);text-align:center;margin-bottom:var(--space-md)">Scan with a phone camera</div>
        <div style="display:flex;gap:8px;align-items:stretch;margin-bottom:8px">
          <input type="text" value="${url.replace(/"/g,'&quot;')}" readonly class="form-input" style="flex:1;font-family:var(--font-mono);font-size:0.78rem" onclick="this.select()" id="rostr-share-url">
          <button class="btn btn-secondary btn-sm" onclick="UI._copyShareLink()">${this.icon('copy', 14)}</button>
        </div>
        <div style="display:flex;gap:8px">
          <a href="${waUrl}" target="_blank" rel="noopener" class="btn btn-sm" style="flex:1;background:#25D366;color:#fff;border:none">WhatsApp</a>
          ${hasNative ? `<button class="btn btn-secondary btn-sm" style="flex:1" onclick="UI._nativeShare('${url.replace(/'/g,'\\\'')}','${(title||'').replace(/'/g,'\\\'')}')">More\u2026</button>` : ''}
        </div>
      </div>
    `;
    overlay.style.display = 'flex';
  },

  _copyShareLink() {
    const input = document.getElementById('rostr-share-url');
    if (!input) return;
    input.select();
    try {
      navigator.clipboard.writeText(input.value).then(
        () => this.toast('Link copied', 'success'),
        () => this.toast('Copy failed', 'error')
      );
    } catch (_) { this.toast('Copy failed', 'error'); }
  },

  async _nativeShare(url, title) {
    try { await navigator.share({ url, title }); }
    catch (_) { /* user dismissed — fine */ }
  },

  // Trigger a browser download of rows as CSV. Inputs:
  //   filename: string, appended with .csv if missing
  //   rows: Array<Record<string, any>> \u2014 headers inferred from first row,
  //         callers can pass a consistent shape so column order is stable
  //   opts.headers: optional explicit column order (array of keys)
  // RFC 4180 escaping: wrap fields containing comma/quote/newline in quotes
  // and double any embedded quote. Prepends a UTF-8 BOM so Excel on Windows
  // opens it in the right encoding.
  downloadCSV(filename, rows, opts = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      this.toast('Nothing to export', 'info');
      return;
    }
    const headers = opts.headers && opts.headers.length
      ? opts.headers
      : Object.keys(rows[0]);
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => esc(row[h])).join(','));
    }
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`, 'success');
  },

  // SVG Icons (inline, no external deps)
  icon(name, size = 18) {
    const icons = {
      search: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
      music: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
      calendar: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      users: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      home: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>`,
      grid: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
      inbox: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22,12 16,12 14,15 10,15 8,12 2,12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
      fileText: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      dollar: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
      settings: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
      check: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>`,
      x: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      chevronRight: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9,18 15,12 9,6"/></svg>`,
      plus: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
      download: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
      moreVertical: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`,
      copy: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      trash: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
      eyeOff: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
      eye: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
      star: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
      filter: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/></svg>`,
      mapPin: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
      verified: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="var(--gold)" stroke="var(--bg-base)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01" stroke="var(--bg-base)" fill="none"/></svg>`,
      menu: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
      logout: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
      send: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>`,
      shield: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      activity: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>`,
      clock: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      barChart: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
    };
    return icons[name] || '';
  }
};

// ── Navigation Component ──
function renderNav(activePage = '') {
  const isLoggedIn = Auth.isLoggedIn();
  const isArtist = Auth.role === 'artist';
  const dashLink = isArtist ? '/artist-dashboard.html' : '/dashboard.html';
  const ac = (pg) => activePage === pg ? 'active' : '';

  const promoterLinks = `
    <li><a href="/dashboard.html" class="${ac('dashboard')}">${UI.icon('home', 16)} Dashboard</a></li>
    <li><a href="/directory.html" class="${ac('directory')}">${UI.icon('grid', 16)} Directory</a></li>
    <li><a href="/bookings.html" class="${ac('bookings')}">${UI.icon('calendar', 16)} Bookings</a></li>
    <li><a href="/calendar.html" class="${ac('calendar')}">${UI.icon('grid', 16)} Calendar</a></li>
    <li><a href="/analytics.html" class="${ac('analytics')}">${UI.icon('barChart', 16)} Analytics</a></li>
    <li><a href="/contracts.html" class="${ac('contracts')}">${UI.icon('fileText', 16)} Contracts</a></li>
    <li><a href="/payments.html" class="${ac('payments')}">${UI.icon('dollar', 16)} Payments</a></li>
    <li><a href="/messages.html" class="${ac('messages')}" style="position:relative">${UI.icon('inbox', 16)} Messages<span class="nav-unread-dot" data-nav-unread style="display:none;position:absolute;top:8px;right:-2px;min-width:8px;height:8px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 2px var(--bg-base)"></span></a></li>`;

  const artistLinks = `
    <li><a href="/artist-dashboard.html" class="${ac('artist-dashboard')}">${UI.icon('home', 16)} Dashboard</a></li>
    <li><a href="/artist-profile-edit.html" class="${ac('profile-edit')}">${UI.icon('music', 16)} My Profile</a></li>
    <li><a href="/epk.html" class="${ac('epk')}">${UI.icon('fileText', 16)} My EPK</a></li>
    <li><a href="/messages.html" class="${ac('messages')}" style="position:relative">${UI.icon('inbox', 16)} Messages<span class="nav-unread-dot" data-nav-unread style="display:none;position:absolute;top:8px;right:-2px;min-width:8px;height:8px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 2px var(--bg-base)"></span></a></li>`;

  return `
    <nav class="nav">
      <div class="nav-inner">
        <a href="/" class="nav-brand">ROSTR<span>+</span></a>

        <ul class="nav-links" data-auth="logged-in" style="display:${isLoggedIn ? '' : 'none'}">
          ${isArtist ? artistLinks : promoterLinks}
        </ul>

        <div class="nav-actions">
          <div data-auth="logged-out" style="${isLoggedIn ? 'display:none' : ''}">
            <a href="/auth.html" class="btn btn-primary btn-sm">Get Started</a>
          </div>
          <div data-auth="logged-in" data-auth-flex="1" style="${isLoggedIn ? 'display:flex;align-items:center;gap:12px' : 'display:none'}">
            <button onclick="openSearchPalette()" title="Search (\u2318K)" aria-label="Search" style="display:flex;align-items:center;gap:6px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:5px 10px;color:var(--text-tertiary);cursor:pointer;font-family:var(--font-mono);font-size:0.72rem;transition:border-color 120ms ease">
              ${UI.icon('search', 14)}
              <span style="display:none" class="nav-search-label-desktop">Search</span>
              <kbd style="font-family:inherit;font-size:0.68rem;background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:3px;padding:1px 5px">\u2318K</kbd>
            </button>
            <button class="nav-bell" id="notif-bell" onclick="toggleNotifications()" style="position:relative;background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" title="Notifications">
              ${UI.icon('inbox', 18)}
              <span id="notif-badge" style="display:none;position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--status-cancelled)"></span>
            </button>
            <div id="notif-dropdown" class="hidden" style="position:absolute;top:56px;right:70px;background:var(--bg-raised);border:1px solid var(--border-medium);border-radius:var(--radius-md);padding:0;min-width:300px;max-height:400px;overflow-y:auto;box-shadow:var(--shadow-lg);z-index:1001">
              <div style="padding:12px 16px;font-size:0.82rem;font-weight:600;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;gap:6px">
                Notifications
                <div style="display:flex;gap:4px">
                  <button class="btn btn-ghost" style="font-size:0.72rem;padding:2px 8px" onclick="exportNotificationsCSV()" title="Export as CSV">Export</button>
                  <button class="btn btn-ghost" style="font-size:0.72rem;padding:2px 8px" onclick="markAllRead()">Mark all read</button>
                </div>
              </div>
              <div id="notif-list" style="padding:8px"><div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:0.82rem">No notifications yet</div></div>
            </div>
            <div class="nav-avatar" onclick="document.getElementById('user-menu').classList.toggle('hidden')"${Auth.user?.avatar_url ? ` style="background-image:url(&quot;${String(Auth.user.avatar_url).replace(/"/g, '%22')}&quot;);background-size:cover;background-position:center" aria-label="${(Auth.user.display_name || 'Account').replace(/"/g, '&quot;')}"` : ''}>${Auth.user?.avatar_url ? '' : (Auth.user?.display_name?.charAt(0)?.toUpperCase() || 'U')}</div>
            <div id="user-menu" class="hidden" style="position:absolute;top:56px;right:24px;background:var(--bg-raised);border:1px solid var(--border-medium);border-radius:var(--radius-md);padding:8px;min-width:180px;box-shadow:var(--shadow-lg);z-index:1001">
              <div style="padding:8px 12px;font-size:0.82rem;color:var(--text-tertiary);border-bottom:1px solid var(--border-subtle);margin-bottom:4px" data-user-name>${Auth.user?.display_name || ''}</div>
              <a href="/invite.html" class="sidebar-item" style="font-size:0.85rem">${UI.icon('send', 14)} Invite</a>
              <a href="/settings.html" class="sidebar-item" style="font-size:0.85rem">${UI.icon('settings', 14)} Settings</a>
              <button class="sidebar-item" style="font-size:0.85rem;color:var(--status-cancelled)" onclick="Auth.signOut()">${UI.icon('logout', 14)} Sign out</button>
            </div>
          </div>
          <button class="nav-toggle" onclick="document.querySelector('.nav-links').classList.toggle('show')">${UI.icon('menu', 20)}</button>
        </div>
      </div>
    </nav>
  `;
  // Schedule unread-badge wiring after the caller mounts innerHTML. The caller
  // pattern is `el.innerHTML = renderNav(page)` — by the time this setTimeout
  // fires, the DOM nodes exist and refreshUnreadBadge() can find them.
  setTimeout(() => { try { _wireUnreadBadge(); } catch (_) {} }, 0);
}

// ── Unread-badge helper ──
// Polls DB.getUnreadCount() and toggles the dot beside the Messages nav link.
// Called automatically after renderNav() mounts the nav, and again whenever
// a Realtime INSERT fires on messages for the current user.
async function refreshUnreadBadge() {
  try {
    const dots = document.querySelectorAll('[data-nav-unread]');
    if (!dots.length) return;
    if (!Auth.isLoggedIn() || !DB || typeof DB.getUnreadCount !== 'function') {
      dots.forEach(d => { d.style.display = 'none'; });
      return;
    }
    const count = await DB.getUnreadCount();
    dots.forEach(d => {
      if (count > 0) {
        d.style.display = '';
        d.title = `${count} unread message${count === 1 ? '' : 's'}`;
      } else {
        d.style.display = 'none';
        d.removeAttribute('title');
      }
    });
  } catch (_) { /* best-effort — never break a page over a badge */ }
}

// Fire once the nav has had a chance to mount, and wire Realtime so incoming
// messages refresh the dot without a full page reload. Idempotent — guarded
// so multiple page scripts calling renderNav() don't stack subscriptions.
let _unreadBadgeWired = false;
function _wireUnreadBadge() {
  // Initial paint
  setTimeout(refreshUnreadBadge, 0);

  if (_unreadBadgeWired) return;
  _unreadBadgeWired = true;

  // Refresh when a new message arrives for me
  try {
    if (typeof Realtime !== 'undefined' && Realtime.subscribeToMessages) {
      Realtime.subscribeToMessages(() => { refreshUnreadBadge(); });
    }
  } catch (_) { /* no-op */ }

  // Refresh when focus returns to the tab (cheap correctness for mark-read
  // flows that happened in another tab / on messages.html).
  window.addEventListener('focus', () => { refreshUnreadBadge(); });
}

window.refreshUnreadBadge = refreshUnreadBadge;

// ══════════════════════════════════════════════════════════
// Global cmd+K / "/" search palette
// ══════════════════════════════════════════════════════════
// Mounted once at module load. Hidden by default; triggered by:
//   - cmd/ctrl + K  (everywhere)
//   - "/"           (when focus is NOT in an input/textarea)
// Searches artists + bookings + contracts in parallel via DB.globalSearch,
// debounced 180ms. Enter opens the selected result. Escape closes.
// ──────────────────────────────────────────────────────────

let _searchResults = [];
let _searchSelected = 0;
let _searchDebounceTimer = null;

function mountSearchPalette() {
  if (document.getElementById('rostr-search-overlay')) return;
  const wrap = document.createElement('div');
  wrap.id = 'rostr-search-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Search');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:none;align-items:flex-start;justify-content:center;padding-top:12vh';
  wrap.innerHTML = `
    <div style="width:min(620px, 94vw);max-height:70vh;background:var(--bg-raised);border:1px solid var(--border-medium);border-radius:var(--radius-lg);box-shadow:0 24px 80px rgba(0,0,0,0.6);overflow:hidden;display:flex;flex-direction:column" id="rostr-search-panel">
      <div style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-md) var(--space-lg);border-bottom:1px solid var(--border-subtle)">
        ${UI.icon('search', 18)}
        <input id="rostr-search-input" type="text" placeholder="Search artists, bookings, contracts\u2026" autocomplete="off" spellcheck="false"
          style="flex:1;background:transparent;border:none;outline:none;color:var(--text-primary);font-size:1rem;font-family:var(--font-body)">
        <kbd style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-tertiary);background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 6px">Esc</kbd>
      </div>
      <div id="rostr-search-results" style="overflow-y:auto;flex:1;padding:var(--space-xs) 0"></div>
      <div style="display:flex;align-items:center;gap:var(--space-md);padding:10px var(--space-lg);border-top:1px solid var(--border-subtle);font-size:0.72rem;color:var(--text-tertiary);font-family:var(--font-mono)">
        <span><kbd style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 5px">\u2191\u2193</kbd> navigate</span>
        <span><kbd style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 5px">\u21b5</kbd> open</span>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // Outside-click dismiss
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSearchPalette(); });

  const input = document.getElementById('rostr-search-input');
  input.addEventListener('input', () => {
    if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
    const q = input.value;
    _searchDebounceTimer = setTimeout(() => runSearch(q), 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearchPalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _searchSelected = Math.min(_searchSelected + 1, _searchResults.length - 1); renderSearchResults(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _searchSelected = Math.max(_searchSelected - 1, 0); renderSearchResults(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = _searchResults[_searchSelected];
      if (hit) { location.href = hit.href; }
    }
  });
}

function openSearchPalette() {
  if (!Auth.isLoggedIn()) return; // search is a signed-in feature
  mountSearchPalette();
  const overlay = document.getElementById('rostr-search-overlay');
  overlay.style.display = 'flex';
  const input = document.getElementById('rostr-search-input');
  input.value = '';
  _searchResults = [];
  _searchSelected = 0;
  renderSearchResults();
  setTimeout(() => input.focus(), 0);
}

function closeSearchPalette() {
  const overlay = document.getElementById('rostr-search-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function runSearch(query) {
  if (!query || !query.trim()) {
    _searchResults = [];
    _searchSelected = 0;
    renderSearchResults();
    return;
  }
  try {
    const { results } = await DB.globalSearch(query);
    _searchResults = results;
    _searchSelected = 0;
    renderSearchResults();
  } catch (_) { /* ignore */ }
}

function renderSearchResults() {
  const host = document.getElementById('rostr-search-results');
  if (!host) return;
  const input = document.getElementById('rostr-search-input');
  if (!_searchResults.length) {
    const msg = input && input.value.trim()
      ? '<div style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary);font-size:0.85rem">No matches</div>'
      : '<div style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary);font-size:0.85rem">Type to search artists, bookings, contracts\u2026</div>';
    host.innerHTML = msg;
    return;
  }
  const kindMeta = {
    artist:   { icon: 'music',    label: 'Artist' },
    booking:  { icon: 'calendar', label: 'Booking' },
    contract: { icon: 'fileText', label: 'Contract' },
  };
  host.innerHTML = _searchResults.map((r, i) => {
    const m = kindMeta[r.kind] || { icon: 'search', label: r.kind };
    const isSel = i === _searchSelected;
    return `
      <a href="${r.href}" data-idx="${i}" style="display:flex;align-items:center;gap:var(--space-md);padding:10px var(--space-lg);text-decoration:none;color:inherit;border-left:3px solid ${isSel ? 'var(--accent)' : 'transparent'};background:${isSel ? 'var(--bg-card)' : 'transparent'};transition:background 80ms ease">
        <div style="width:28px;height:28px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);flex-shrink:0">${UI.icon(m.icon, 14)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.9rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(r.title || '').replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>
          ${r.subtitle ? `<div style="font-size:0.75rem;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(r.subtitle || '').replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>` : ''}
        </div>
        <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.08em">${m.label}${r.meta ? ' \u00b7 ' + r.meta : ''}</div>
      </a>
    `;
  }).join('');
  // Scroll selected into view
  const sel = host.querySelector(`[data-idx="${_searchSelected}"]`);
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
}

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  // cmd/ctrl + K
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearchPalette();
    return;
  }
  // "/" — but only when focus is NOT in an input/textarea/contenteditable
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!typing) {
      e.preventDefault();
      openSearchPalette();
    }
  }
});

window.openSearchPalette = openSearchPalette;
window.closeSearchPalette = closeSearchPalette;

// ── Password Reset ──
// Calls our custom send-password-reset edge function rather than
// _sb.auth.resetPasswordForEmail(). The built-in method depends on
// Supabase's dashboard-configured SMTP, which we don't have set up.
// Our edge function generates a recovery link via the admin API and
// dispatches it through Resend (same vendor our other transactional
// emails use).
//
// The response is always success:true regardless of whether the email
// exists — prevents account-enumeration attacks. The edge function
// silently skips sending if the account doesn't exist.
Auth.sendPasswordReset = async function(email) {
  if (DEMO_MODE) return { success: false, error: 'Not available in demo mode' };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: body.error || 'Request failed' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

Auth.updatePassword = async function(newPassword) {
  if (DEMO_MODE) return { success: false, error: 'Not available in demo mode' };
  const { error } = await _sb.auth.updateUser({ password: newPassword });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

// ── Demo Banner ──
function renderDemoBanner() {
  if (!DEMO_MODE) return '';
  return `<div style="background:var(--gold-dim);border-bottom:1px solid var(--border-gold);padding:8px 16px;text-align:center;font-size:0.82rem;color:var(--gold-text);font-family:var(--font-mono)">Demo Mode — Connect Supabase for live data</div>`;
}

// ══════════════════════════════════════════════════════════
// DB — Live Supabase data access
// ══════════════════════════════════════════════════════════
const DB = {
  // ── Artists ──
  async getArtists({ search = '', genre = '', city = '', availableOnly = false } = {}) {
    if (DEMO_MODE) return { success: false, data: [], error: 'Offline: Supabase unavailable' };

    try {
    // LEFT join on profiles so unclaimed artists (profile_id = NULL) still appear.
    // Unclaimed artists are seeded before the artist signs up; profile is linked later.
    let query = _sb
      .from('artists')
      .select(`
        id, stage_name, genre, subgenres, base_fee, currency,
        rating, total_bookings, cities_active, social_links,
        epk_url, verified, status,
        profiles(display_name, avatar_url, city)
      `)
      .eq('status', 'active');

    if (search) query = query.ilike('stage_name', `%${search}%`);
    if (genre) query = query.contains('genre', [genre]);
    if (city) query = query.contains('cities_active', [city]);

    const { data, error } = await query;
    if (error) return { success: false, data: [], error: error.message };

    // Normalise to the shape the UI expects
    const normalised = (data || []).map(a => ({
      id: a.id,
      name: a.stage_name || (a.profiles && a.profiles.display_name) || 'Unknown',
      genre: Array.isArray(a.genre) ? a.genre[0] : (a.genre || ''),
      subgenre: Array.isArray(a.subgenres) ? a.subgenres[0] : '',
      city: (a.cities_active && a.cities_active[0]) || (a.profiles && a.profiles.city) || '',
      country: 'UAE',
      rate_min: a.base_fee || 0,
      rate_max: a.base_fee ? a.base_fee * 2 : 0,
      rateMin: a.base_fee || 0,
      rateMax: a.base_fee ? a.base_fee * 2 : 0,
      currency: a.currency || 'AED',
      rating: a.rating || 0,
      bookings: a.total_bookings || 0,
      reviewCount: a.total_bookings || 0,
      avatar_url: a.profiles && a.profiles.avatar_url,
      verified: a.verified,
      available: a.status === 'active',
      social: a.social_links || {},
      bio: (a.profiles && a.profiles.bio) || '',
      email: (a.profiles && a.profiles.email) || '',
    }));

    return { success: true, data: normalised };
    } catch(e) {
      console.error('Failed to load artists:', e);
      return { success: false, data: [], error: String(e) };
    }
  },

  async getArtistById(id) {
    if (DEMO_MODE) return { success: false, error: 'Offline: Supabase unavailable' };

    try {
    // LEFT join (no !inner) so unclaimed artists still resolve.
    const { data, error } = await _sb
      .from('artists')
      .select(`*, profiles(display_name, avatar_url, city, bio, phone)`)
      .eq('id', id)
      .single();

    if (error) return { success: false, error: error.message };

    // Normalise to same shape as getArtists
    const a = data;
    const normalised = {
      id: a.id,
      name: a.stage_name || (a.profiles && a.profiles.display_name) || 'Unknown',
      genre: Array.isArray(a.genre) ? a.genre[0] : (a.genre || ''),
      subgenre: Array.isArray(a.subgenres) ? a.subgenres[0] : '',
      city: (a.cities_active && a.cities_active[0]) || (a.profiles && a.profiles.city) || '',
      country: 'UAE',
      rate_min: a.base_fee || 0,
      rate_max: a.base_fee ? a.base_fee * 2 : 0,
      currency: a.currency || 'AED',
      rating: a.rating || 0,
      bookings: a.total_bookings || 0,
      avatar_url: a.profiles && a.profiles.avatar_url,
      verified: a.verified,
      available: a.status === 'active',
      social: a.social_links || {},
      bio: (a.profiles && a.profiles.bio) || '',
      email: (a.profiles && a.profiles.email) || '',
      // Real availability fields — consumed by profile.html's 21-day
      // calendar so promoters see actual blocked dates, not fake patterns.
      blocked_dates: Array.isArray(a.blocked_dates) ? a.blocked_dates : [],
      available_from: a.available_from || null,
      available_to: a.available_to || null,
      tech_rider: a.tech_rider || {},
      profile_id: a.profile_id || null,
    };

    return { success: true, data: normalised };
    } catch(e) {
      return { success: false, error: String(e) };
    }
  },

  // ── Bookings ──
  // Promoter-side booking list. By default excludes rows the promoter has
  // soft-hidden; pass { includeHidden: true } to show everything (for the
  // "Show hidden" toggle in the bookings filter bar).
  async getMyBookings({ includeHidden = false } = {}) {
    if (DEMO_MODE) return { success: true, data: [] };
    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
      let q = _sb.from('bookings')
        .select(`*, artists(stage_name, genre, cities_active, profiles(display_name))`)
        .eq('promoter_id', user.id);
      if (!includeHidden) q = q.eq('hidden_by_promoter', false);
      const { data, error } = await q.order('event_date', { ascending: true });
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: data || [] };
    } catch(e) { return { success: false, data: [], error: String(e) }; }
  },

  async createBooking(bookingData) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-' + Date.now(), ...bookingData } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('bookings')
        .insert({ ...bookingData, promoter_id: Auth.user.id })
        .select().single();
      if (error) return { success: false, error: error.message };

      // Notify the artist via branded email. Fire-and-forget — booking
      // success is not contingent on email delivery, so we don't await
      // it or let failure bubble up. Runs only when a real artist is
      // linked (profile_id != null); unclaimed artists have no inbox.
      this._notifyArtistBookingRequest(data).catch(() => {});

      return { success: true, data };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  /**
   * Internal: fire the branded 'booking_request' email to the artist
   * when a promoter creates a new booking. Loads artist + promoter
   * details, skips silently if the artist has no linked auth user yet
   * (pre-seeded unclaimed rows have profile_id = null).
   */
  async _notifyArtistBookingRequest(booking) {
    try {
      const { data } = await _sb.from('bookings')
        .select(`
          event_name, event_date, venue, venue_name, fee, currency,
          artists(profiles(email, display_name), stage_name),
          promoter:profiles!promoter_id(display_name, company)
        `)
        .eq('id', booking.id)
        .single();
      const artistEmail = data?.artists?.profiles?.email;
      if (!artistEmail) return;

      const promoterName = data.promoter?.company || data.promoter?.display_name || 'A promoter';
      const fee = booking.fee ? `${booking.currency || 'AED'} ${Number(booking.fee).toLocaleString()}` : 'On request';
      await Emails.send(artistEmail, 'booking_request', {
        promoter_name: promoterName,
        event_name:    data.event_name || 'Performance',
        event_date:    data.event_date ? new Date(data.event_date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
        venue_name:    data.venue || data.venue_name || '—',
        fee,
        booking_url:   window.location.origin + '/booking-detail.html?id=' + booking.id,
      });
    } catch (_) { /* ignore */ }
  },

  async updateBookingStatus(bookingId, status) {
    if (DEMO_MODE) return { success: true };

    const { error } = await _sb
      .from('bookings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', bookingId);

    return error ? { success: false, error: error.message } : { success: true };
  },

  // ── Contracts ──
  async getMyContracts() {
    if (DEMO_MODE) return { success: true, data: [] };
    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('contracts')
        .select(`*, bookings(event_name, event_date, venue_name, fee, currency, promoter_id, artist_id, artists(stage_name, profiles(display_name)))`)
        .order('created_at', { ascending: false });
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: data || [] };
    } catch(e) { return { success: false, data: [], error: String(e) }; }
  },

  async createContract({ booking_id, fee, title, content }) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-c1', status: 'draft', created_at: new Date().toISOString() } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('contracts')
        .insert({
          booking_id,
          fee: fee || 0,
          status: 'draft',
          title: title || 'Performance Contract',
          content: content || '',
        })
        .select().single();
      return error ? { success: false, error: error.message } : { success: true, data };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async updateContractStatus(contractId, status) {
    if (DEMO_MODE) return { success: true };

    const { error } = await _sb
      .from('contracts')
      .update({ status })
      .eq('id', contractId);

    return error ? { success: false, error: error.message } : { success: true };
  },

  async createPayment({ booking_id, amount, currency, payment_method, status }) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-pay1', status: 'pending', created_at: new Date().toISOString() } };

    const { data, error } = await _sb
      .from('payments')
      .insert({ booking_id, amount, currency, payment_method, status: status || 'pending' })
      .select()
      .single();

    return error ? { success: false, error: error.message } : { success: true, data };
  },

  // ── Two-sided manual payment flow ───────────────────────────
  // Works today with offline bank transfer. The same table rows get
  // flipped to status='completed' either by (a) an artist confirming
  // receipt here, or (b) a future Stripe/Tap webhook. One model, two
  // entry points.

  /**
   * Promoter clicks "Record payment" on a booking. Creates a payment
   * row with provider='manual', status='processing', auto-generated
   * invoice_number, and the bank transfer reference they entered.
   * Welcome email-style branded notification fires from the edge fn
   * side for the artist.
   */
  async recordPayment({ booking_id, amount, currency, payout_reference, notes, type }) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-rec-1' } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    if (!booking_id || !amount) return { success: false, error: 'booking_id and amount required' };

    try {
      // Mint an invoice number server-side so two concurrent promoters
      // can't clash on the same number.
      const { data: invData, error: invErr } = await _sb.rpc('generate_invoice_number');
      if (invErr) return { success: false, error: invErr.message };

      const { data, error } = await _sb.from('payments').insert({
        booking_id,
        amount,
        currency: currency || 'AED',
        type: type || 'final',
        status: 'processing',
        provider: 'manual',
        payment_method: 'bank_transfer',
        payout_reference: payout_reference || null,
        notes: notes || null,
        invoice_number: invData,
        promoter_recorded_at: new Date().toISOString(),
      }).select().single();

      if (error) return { success: false, error: error.message };

      // Notify artist via branded email (fire-and-forget — payment
      // doesn't depend on email success).
      this._notifyArtistPaymentRecorded(booking_id, data).catch(() => {});

      return { success: true, data };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  /**
   * Artist clicks "Confirm received" on a payment row. Flips
   * artist_confirmed_at + status='completed' and sets paid_at.
   * RLS policy 'Artists can confirm payment received' gates this
   * server-side — trying to confirm someone else's payment is a
   * silent 0-row UPDATE.
   */
  async confirmPaymentReceived(paymentId) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const now = new Date().toISOString();
      const { data, error } = await _sb.from('payments')
        .update({
          artist_confirmed_at: now,
          paid_at: now,
          status: 'completed',
        })
        .eq('id', paymentId)
        .select();
      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Not allowed or payment not found' };
      }
      return { success: true, data: data[0] };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  /**
   * Fetch payments for a specific booking. Used by the booking-detail
   * page to show the payment block contextually.
   */
  async getPaymentsForBooking(bookingId) {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!bookingId) return { success: false, error: 'bookingId required' };
    try {
      const { data, error } = await _sb.from('payments')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false });
      return error ? { success: false, error: error.message } : { success: true, data: data || [] };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  /**
   * Internal helper used by recordPayment() to email the artist.
   * Silently no-ops if we can't find the artist's email.
   */
  async _notifyArtistPaymentRecorded(bookingId, payment) {
    try {
      const { data } = await _sb.from('bookings')
        .select('event_name, artists(profiles(email, display_name))')
        .eq('id', bookingId)
        .single();
      const artistEmail = data?.artists?.profiles?.email;
      if (!artistEmail) return;
      const amount = `${payment.currency || 'AED'} ${Number(payment.amount).toLocaleString()}`;
      await Emails.send(artistEmail, 'payment_recorded', {
        event_name: data.event_name || 'your event',
        amount,
        reference: payment.payout_reference || payment.invoice_number || '',
        booking_url: window.location.origin + '/booking-detail.html?id=' + bookingId,
      });
    } catch (_) { /* ignore */ }
  },

  async signContract(contractId, role) {
    if (DEMO_MODE) return { error: null };

    const now = new Date().toISOString();
    const ua  = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';

    // Read current state so we can (a) decide if both parties have signed
    // and (b) append to audit_log without clobbering prior entries.
    const { data: contract } = await _sb
      .from('contracts')
      .select('promoter_signed, artist_signed, audit_log')
      .eq('id', contractId)
      .single();

    const priorLog = Array.isArray(contract?.audit_log) ? contract.audit_log : [];
    const auditEntry = {
      event: role === 'promoter' ? 'signed_by_promoter' : 'signed_by_artist',
      at: now,
      ua: ua.slice(0, 400), // cap so a weird UA string can't bloat the row
    };

    const update = role === 'promoter'
      ? { promoter_signed: true, promoter_signed_at: now, promoter_signed_ua: ua.slice(0, 400) }
      : { artist_signed: true,   artist_signed_at:   now, artist_signed_ua:   ua.slice(0, 400) };

    const bothSigned = role === 'promoter'
      ? contract?.artist_signed
      : contract?.promoter_signed;

    const finalUpdate = {
      ...update,
      audit_log: [...priorLog, auditEntry],
      ...(bothSigned ? { status: 'signed', signed_at: now } : {}),
    };

    const { error } = await _sb
      .from('contracts')
      .update(finalUpdate)
      .eq('id', contractId);

    return { error };
  },

  // ── Payments ──
  async getMyPayments() {
    if (DEMO_MODE) return { success: true, data: [] };

    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await _sb
      .from('payments')
      .select(`
        *,
        bookings!inner(
          event_name, event_date, venue_name, promoter_id,
          artists(name:stage_name, profiles(display_name))
        )
      `)
      .eq('bookings.promoter_id', user.id)
      .order('created_at', { ascending: false });

    return error ? { success: false, error: error.message } : { success: true, data: data || [] };
  },

  // Artist-facing: payouts owed to / paid to this artist.
  // Scoped via the bookings.artist_id → artists.profile_id chain (backed by RLS).
  async getArtistPayouts() {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    const artistId = await this._getMyArtistId();
    if (!artistId) return { success: true, data: [] };
    const { data, error } = await _sb
      .from('payments')
      .select(`*, bookings!inner(event_name, event_date, venue_name, artist_id, promoter:profiles!promoter_id(display_name))`)
      .eq('bookings.artist_id', artistId)
      .order('created_at', { ascending: false });
    return error ? { success: false, error: error.message } : { success: true, data: data || [] };
  },

  // ── Messages ──
  async getConversations() {
    if (DEMO_MODE) return { success: true, data: [] };

    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };

    // Get latest message per conversation partner
    const { data, error } = await _sb
      .from('messages')
      .select(`
        id, content, created_at, read, sender_id, receiver_id,
        sender:profiles!sender_id(display_name, avatar_url),
        receiver:profiles!receiver_id(display_name, avatar_url)
      `)
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };

    // Group by conversation partner, keep only the latest message per partner
    const seen = new Map();
    for (const msg of (data || [])) {
      const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
      if (!seen.has(otherId)) {
        const otherProfile = msg.sender_id === user.id ? msg.receiver : msg.sender;
        seen.set(otherId, {
          other_user_id: otherId,
          other_user_name: otherProfile?.display_name || 'Unknown',
          content: msg.content,
          last_message: msg.content,
          last_message_time: msg.created_at,
          unread: !msg.read && msg.receiver_id === user.id,
        });
      }
    }

    return { success: true, data: Array.from(seen.values()) };
  },

  async getMessages(otherUserId) {
    if (DEMO_MODE) return { success: true, data: [] };

    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await _sb
      .from('messages')
      .select(`
        id, content, created_at, read, sender_id,
        sender:profiles!sender_id(display_name, avatar_url)
      `)
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${otherUserId}),` +
        `and(sender_id.eq.${otherUserId},receiver_id.eq.${user.id})`
      )
      .order('created_at', { ascending: true });

    // Mark received messages as read
    await _sb
      .from('messages')
      .update({ read: true })
      .eq('receiver_id', user.id)
      .eq('sender_id', otherUserId)
      .eq('read', false);

    return error ? { success: false, error: error.message } : { success: true, data: data || [] };
  },

  // ── Booking-scoped threads ─────────────────────────────────
  //
  // Messages carry an optional booking_id. When present, they thread
  // under that specific booking so a promoter + artist can have
  // separate conversations for every gig without context collisions.
  // When absent (legacy / pre-booking DMs), they behave like the old
  // flat inbox.
  //
  // getBookingThreads() lists every booking the caller is party to
  // that has at least one message, ordered by most-recent activity,
  // with an unread count per thread.
  //
  // getThreadMessages(bookingId) is the thread-view equivalent of
  // getMessages(otherUserId) — same shape, but scoped to booking_id.

  async getBookingThreads() {
    if (DEMO_MODE) return { success: true, data: [] };
    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };

    // RLS already filters messages to ones the caller sent or received.
    // We group by booking_id client-side — cheaper than a window function
    // and gives us the flexibility to merge in booking metadata in one pass.
    const { data: rows, error } = await _sb
      .from('messages')
      .select(`
        id, content, created_at, read, sender_id, receiver_id, booking_id,
        sender:profiles!sender_id(display_name, avatar_url),
        receiver:profiles!receiver_id(display_name, avatar_url)
      `)
      .not('booking_id', 'is', null)
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };

    // Fold rows into per-booking summaries.
    const threads = new Map();
    for (const m of (rows || [])) {
      const id = m.booking_id;
      if (!threads.has(id)) {
        const otherProfile = m.sender_id === user.id ? m.receiver : m.sender;
        threads.set(id, {
          booking_id: id,
          other_user_id: m.sender_id === user.id ? m.receiver_id : m.sender_id,
          other_user_name: otherProfile?.display_name || 'Unknown',
          other_user_avatar: otherProfile?.avatar_url || null,
          last_message: m.content,
          last_message_time: m.created_at,
          last_message_was_mine: m.sender_id === user.id,
          unread_count: 0,
        });
      }
      if (!m.read && m.receiver_id === user.id) {
        threads.get(id).unread_count += 1;
      }
    }

    if (threads.size === 0) return { success: true, data: [] };

    // Hydrate booking metadata (event name, date) so the thread list
    // can show "Event — Artist · Date" instead of just a partner name.
    const ids = [...threads.keys()];
    const { data: bookings } = await _sb
      .from('bookings')
      .select(`
        id, event_name, event_date, status,
        artists(stage_name, profiles(display_name))
      `)
      .in('id', ids);

    for (const b of (bookings || [])) {
      const t = threads.get(b.id);
      if (!t) continue;
      t.event_name = b.event_name || 'Performance';
      t.event_date = b.event_date;
      t.booking_status = b.status;
      t.artist_name = b.artists?.stage_name || b.artists?.profiles?.display_name || null;
    }

    return {
      success: true,
      data: [...threads.values()].sort(
        (a, b) => new Date(b.last_message_time) - new Date(a.last_message_time)
      ),
    };
  },

  async getThreadMessages(bookingId) {
    if (DEMO_MODE) return { success: true, data: [] };
    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };
    if (!bookingId) return { success: false, error: 'bookingId required' };

    const { data, error } = await _sb
      .from('messages')
      .select(`
        id, content, created_at, read, sender_id, receiver_id,
        sender:profiles!sender_id(display_name, avatar_url)
      `)
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true });

    if (error) return { success: false, error: error.message };

    // Mark anything in this thread addressed to me as read.
    await _sb
      .from('messages')
      .update({ read: true })
      .eq('booking_id', bookingId)
      .eq('receiver_id', user.id)
      .eq('read', false);

    return { success: true, data: data || [] };
  },

  // Total unread across every booking thread. Used by nav badges.
  async getUnreadCount() {
    if (DEMO_MODE) return 0;
    const user = Auth.user;
    if (!user) return 0;
    const { count, error } = await _sb
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('read', false);
    return error ? 0 : (count || 0);
  },

  async sendMessage(receiverId, content, bookingId = null) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-' + Date.now(), sender_id: 'demo-1', receiver_id: receiverId, content, created_at: new Date().toISOString() } };

    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await _sb
      .from('messages')
      .insert({
        sender_id: user.id,
        receiver_id: receiverId,
        content,
        booking_id: bookingId,
      })
      .select()
      .single();

    return error ? { success: false, error: error.message } : { success: true, data };
  },

  // ── Profile ──
  async updateProfile(updates) {
    if (DEMO_MODE) return { error: null };
    if (!Auth.user) return { error: 'Not authenticated' };
    try {
      const { error } = await _sb.from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', Auth.user.id);
      return { error };
    } catch(e) { return { error: String(e) }; }
  },

  async getProfile(userId) {
    const id = userId || (Auth.user && Auth.user.id);
    if (!id) return { data: null, error: 'Not authenticated' };

    const { data, error } = await _sb
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    return { data, error };
  },

  // Compute profile completion for the current user. Role-aware: promoters
  // are scored on the profile row alone; artists merge profile + artist row
  // fields. Returns { percent, filled, total, missing: [{key,label,href}] }
  // where each missing entry links to the editor that fixes it.
  //
  // Kept cheap: does one profile fetch, plus one artists fetch when the
  // viewer is an artist. Safe to call on every dashboard render.
  async getProfileCompletion() {
    if (DEMO_MODE) return { percent: 100, filled: 0, total: 0, missing: [] };
    if (!Auth.user) return { percent: 0, filled: 0, total: 0, missing: [] };

    const hasValue = (v) => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return !!v;
    };

    const profRes = await this.getProfile();
    const p = profRes?.data || {};
    const role = Auth.role;
    const settingsHref = '/settings.html';

    // Promoter: scored on 6 fields (profile-row only).
    if (role !== 'artist') {
      const checks = [
        { key: 'display_name', label: 'Add your name',    present: hasValue(p.display_name), href: settingsHref },
        { key: 'avatar_url',   label: 'Upload a photo',   present: hasValue(p.avatar_url),   href: settingsHref },
        { key: 'company',      label: 'Add your company', present: hasValue(p.company),      href: settingsHref },
        { key: 'phone',        label: 'Add a phone',      present: hasValue(p.phone),        href: settingsHref },
        { key: 'city',         label: 'Set your city',    present: hasValue(p.city),         href: settingsHref },
        { key: 'bio',          label: 'Write a short bio',present: hasValue(p.bio),          href: settingsHref },
      ];
      const filled = checks.filter(c => c.present).length;
      return {
        percent: Math.round((filled / checks.length) * 100),
        filled,
        total: checks.length,
        missing: checks.filter(c => !c.present).map(({ key, label, href }) => ({ key, label, href })),
      };
    }

    // Artist: merge profile + artist row. 9 fields total.
    const artistRes = await this.getMyArtistProfile();
    const a = (artistRes && artistRes.success) ? (artistRes.data || {}) : {};
    const socials = a.social_links || a.social || {};
    const hasSocial = !!(socials.instagram || socials.soundcloud || socials.spotify || socials.mixcloud);
    const genres = Array.isArray(a.genre) ? a.genre : (a.genre ? [a.genre] : []);
    const cities = Array.isArray(a.cities_active) ? a.cities_active : [];
    const editor = '/artist-profile-edit.html';

    const checks = [
      { key: 'display_name', label: 'Add your name',        present: hasValue(p.display_name), href: settingsHref },
      { key: 'avatar_url',   label: 'Upload a photo',       present: hasValue(p.avatar_url),   href: settingsHref },
      { key: 'phone',        label: 'Add a phone',          present: hasValue(p.phone),        href: settingsHref },
      { key: 'city',         label: 'Set your city',        present: hasValue(p.city) || cities.length > 0, href: settingsHref },
      { key: 'bio',          label: 'Write a short bio',    present: hasValue(p.bio),          href: settingsHref },
      { key: 'stage_name',   label: 'Set a stage name',     present: hasValue(a.stage_name),   href: editor },
      { key: 'genre',        label: 'Pick your genres',     present: genres.length > 0,        href: editor },
      { key: 'base_fee',     label: 'Add a base fee',       present: hasValue(a.base_fee),     href: editor },
      { key: 'social',       label: 'Link one social profile', present: hasSocial,             href: editor },
    ];
    const filled = checks.filter(c => c.present).length;
    return {
      percent: Math.round((filled / checks.length) * 100),
      filled,
      total: checks.length,
      missing: checks.filter(c => !c.present).map(({ key, label, href }) => ({ key, label, href })),
    };
  },

  // ── Artist-Specific Methods ──

  async _getMyArtistId() {
    if (DEMO_MODE) return 'a1';
    if (!Auth.user) return null;
    if (this._cachedArtistId) return this._cachedArtistId;
    try {
      const { data } = await _sb.from('artists').select('id').eq('profile_id', Auth.user.id).single();
      this._cachedArtistId = data?.id || null;
      return this._cachedArtistId;
    } catch(e) { return null; }
  },

  async getMyArtistProfile() {
    if (DEMO_MODE) return { success: false, error: 'Offline: Supabase unavailable' };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('artists')
        .select('*, profiles!inner(display_name, avatar_url, city, bio, phone)')
        .eq('profile_id', Auth.user.id).single();
      if (error) return { success: false, error: error.message };
      if (!data) return { success: false, error: 'No artist profile' };
      return { success: true, data: { ...data, name: data.stage_name || data.profiles?.display_name || 'Unknown', genre: Array.isArray(data.genre) ? data.genre[0] : data.genre, subgenre: Array.isArray(data.subgenres) ? data.subgenres.join(', ') : '', city: data.cities_active?.[0] || data.profiles?.city || '', bio: data.profiles?.bio || '', avatar_url: data.profiles?.avatar_url, social: data.social_links || {} } };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // Search unclaimed artist rows by partial stage_name match.
  // Used by the claim-profile flow right after an artist signs up.
  async searchUnclaimedArtists(query) {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!query || !query.trim()) return { success: true, data: [] };
    try {
      const { data, error } = await _sb.from('artists')
        .select('id, stage_name, genre, cities_active, verified')
        .is('profile_id', null)
        .ilike('stage_name', `%${query.trim()}%`)
        .limit(10);
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: data || [] };
    } catch(e) { return { success: false, data: [], error: String(e) }; }
  },

  // Claim an unclaimed artist row. Runs the SECURITY DEFINER RPC that
  // enforces: caller is an artist, row is unclaimed, caller has no prior row.
  async claimArtistProfile(artistId) {
    if (DEMO_MODE) return { success: true, data: { id: artistId } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.rpc('claim_artist_profile', { target_artist_id: artistId });
      if (error) return { success: false, error: error.message };
      // Invalidate cached artist id so subsequent loads pick up the new claim
      this._cachedArtistId = null;
      return { success: true, data };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // ── Admin: manage the artist roster ──────────────────────
  // These are gated server-side by the is_admin() RLS helper. Non-admins
  // can still call them; Supabase just returns 0 rows affected.

  // List every artist, including pending/inactive ones that aren't in
  // the public directory. Only admins will actually get the hidden rows
  // if the SELECT policy ever tightens — today it's already public.
  async adminListAllArtists() {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('artists')
        .select('id, stage_name, genre, cities_active, base_fee, currency, status, verified, profile_id, created_at')
        .order('status', { ascending: true })
        .order('stage_name', { ascending: true });
      return error ? { success: false, error: error.message } : { success: true, data: data || [] };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // Change an artist's status. Valid values: 'active' | 'pending' | 'inactive'.
  // Blocked by RLS unless is_admin() returns true.
  async adminUpdateArtistStatus(artistId, status) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    if (!['active','pending','inactive'].includes(status)) return { success: false, error: 'Invalid status' };
    try {
      const { data, error } = await _sb.from('artists')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', artistId)
        .select();
      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) return { success: false, error: 'Not allowed (admin only) or artist not found' };
      return { success: true, data: data[0] };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // Toggle the verified checkmark. Same RLS gate as status.
  async adminSetArtistVerified(artistId, verified) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('artists')
        .update({ verified: !!verified, updated_at: new Date().toISOString() })
        .eq('id', artistId)
        .select();
      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) return { success: false, error: 'Not allowed or not found' };
      return { success: true, data: data[0] };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // Seed a new unclaimed artist (the way we seeded the initial 14).
  // Forbidden from setting profile_id — only unclaimed rows allowed via
  // this path. If the artist signs up later they claim it via the
  // claim-profile flow.
  async adminCreateUnclaimedArtist({ stage_name, genre, cities_active, status, verified, social_links, base_fee }) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    if (!stage_name) return { success: false, error: 'stage_name required' };
    try {
      const row = {
        profile_id: null,
        stage_name,
        genre: Array.isArray(genre) ? genre : (genre ? [genre] : []),
        cities_active: Array.isArray(cities_active) ? cities_active : (cities_active ? [cities_active] : []),
        status: ['active','pending','inactive'].includes(status) ? status : 'pending',
        verified: !!verified,
        social_links: social_links || {},
        base_fee: (typeof base_fee === 'number' && !isNaN(base_fee) && base_fee >= 0) ? base_fee : null,
        currency: 'AED',
      };
      const { data, error } = await _sb.from('artists').insert(row).select().single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  /**
   * Bulk-import artists from a parsed CSV. Rows is an array of raw
   * objects (whatever CSV.parse spat out); this normalises them,
   * validates, and inserts each one sequentially so partial failure
   * doesn't wipe successful rows. Returns per-row success/error list
   * so the UI can show a clean preview + outcome table.
   *
   * Expected column names (case-insensitive):
   *   stage_name (required)
   *   genre          — single value or comma-separated list
   *   city           — primary city (maps to cities_active[0])
   *   instagram      — handle or URL
   *   soundcloud     — URL
   *   spotify        — URL
   *   status         — 'active' | 'pending' (default 'pending')
   *   verified       — yes/true/1 -> true
   *   base_fee       — numeric, AED assumed
   */
  async adminBulkImportArtists(rows) {
    if (DEMO_MODE) return { success: true, results: [] };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    if (!Array.isArray(rows) || rows.length === 0) return { success: false, error: 'No rows to import' };

    const results = [];
    // Normalise keys once so "Stage Name", "stage_name", "STAGE NAME" all match.
    const norm = (k) => String(k || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    // Truthy parser for optional boolean columns.
    const toBool = (v) => ['yes','true','1','y','x','✓'].includes(String(v ?? '').toLowerCase().trim());
    // Instagram handle -> full URL. Accepts @handle, handle, or a full URL.
    const igUrl = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return null;
      if (/^https?:\/\//i.test(s)) return s;
      return 'https://instagram.com/' + s.replace(/^@/, '');
    };

    for (const raw of rows) {
      const r = {};
      for (const k of Object.keys(raw || {})) r[norm(k)] = raw[k];

      const stageName = String(r.stage_name || r.name || '').trim();
      if (!stageName) {
        results.push({ ok: false, stage_name: '(empty)', error: 'missing stage_name' });
        continue;
      }

      const genre = r.genre
        ? String(r.genre).split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const cities = r.city ? [String(r.city).trim()] : [];
      const social_links = {};
      if (r.instagram)  social_links.instagram  = igUrl(r.instagram);
      if (r.soundcloud) social_links.soundcloud = String(r.soundcloud).trim();
      if (r.spotify)    social_links.spotify    = String(r.spotify).trim();

      let baseFee = null;
      if (r.base_fee != null && r.base_fee !== '') {
        const n = Number(String(r.base_fee).replace(/[^\d.]/g, ''));
        if (!isNaN(n) && n >= 0) baseFee = n;
      }

      const payload = {
        stage_name: stageName,
        genre,
        cities_active: cities,
        status: String(r.status || 'pending').toLowerCase().trim(),
        verified: toBool(r.verified),
        social_links,
        base_fee: baseFee,
      };

      const res = await this.adminCreateUnclaimedArtist(payload);
      results.push({
        ok: res.success,
        stage_name: stageName,
        error: res.success ? null : res.error,
      });
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.length - succeeded;

    // Fire a grouped audit entry so the log shows "bulk import of 12
    // artists" as one line rather than 12 individual artist.create rows.
    // (Those individual rows are still there from the INSERT trigger —
    // this one links them together with shared context.)
    try {
      await this.logAdminAction({
        action: 'artist.bulk_import',
        target_type: 'batch',
        meta: {
          total:     results.length,
          succeeded,
          failed,
          failures:  results.filter(r => !r.ok).slice(0, 10).map(r => ({ stage_name: r.stage_name, error: r.error })),
        },
      });
    } catch (_) { /* best-effort audit; don't block the import */ }

    return { success: true, results, succeeded, failed };
  },

  // ── Admin audit log ──
  // Reads recent audit rows (admin only — RLS enforces). Default limit
  // 100 keeps payload small for the settings panel; pagination can come
  // later if needed.
  async adminListAuditLog({ limit = 100 } = {}) {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, data: [] };
    try {
      const { data, error } = await _sb.from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      return error ? { success: false, data: [], error: error.message } : { success: true, data: data || [] };
    } catch (e) { return { success: false, data: [], error: String(e) }; }
  },

  // Fire a free-form audit entry from the client. Used for actions that
  // don't map to a single-row trigger (bulk imports, admin notes, etc).
  // RPC is SECURITY DEFINER and silently no-ops for non-admins, so the
  // client doesn't need to pre-check is_admin() before calling.
  async logAdminAction({ action, target_type = null, target_id = null, meta = {} } = {}) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user || !action) return { success: false, error: 'missing args' };
    try {
      const { data, error } = await _sb.rpc('log_admin_action', {
        p_action: action,
        p_target_type: target_type,
        p_target_id: target_id,
        p_meta: meta,
      });
      return error ? { success: false, error: error.message } : { success: true, id: data };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  // Check if the current user is an admin. Used client-side to show/hide
  // the admin panel in settings.html. Server-side every mutation is still
  // re-checked via RLS, so spoofing this flag doesn't actually grant
  // any powers.
  async isAdmin() {
    if (DEMO_MODE) return false;
    if (!Auth.user) return false;
    try {
      const { data, error } = await _sb.rpc('is_admin');
      return !error && !!data;
    } catch(e) { return false; }
  },

  async createArtistProfile(data) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-artist-1', ...data } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data: result, error } = await _sb.from('artists')
        .insert({ profile_id: Auth.user.id, stage_name: data.stage_name, genre: data.genre ? [data.genre] : [], subgenres: data.subgenres || [], base_fee: data.base_fee || 0, currency: data.currency || 'AED', cities_active: data.cities_active || [], social_links: data.social_links || {}, status: 'active' })
        .select().single();
      return error ? { success: false, error: error.message } : { success: true, data: result };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async updateArtistProfile(data) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const artistUpdate = {};
      if (data.stage_name !== undefined) artistUpdate.stage_name = data.stage_name;
      if (data.genre !== undefined) artistUpdate.genre = Array.isArray(data.genre) ? data.genre : [data.genre];
      if (data.subgenres !== undefined) artistUpdate.subgenres = data.subgenres;
      if (data.base_fee !== undefined) artistUpdate.base_fee = data.base_fee;
      if (data.rate_max !== undefined) artistUpdate.rate_max = data.rate_max;
      if (data.currency !== undefined) artistUpdate.currency = data.currency;
      if (data.cities_active !== undefined) artistUpdate.cities_active = data.cities_active;
      if (data.social_links !== undefined) artistUpdate.social_links = data.social_links;
      if (data.tech_rider !== undefined) artistUpdate.tech_rider = data.tech_rider;
      if (data.status !== undefined) artistUpdate.status = data.status;
      if (data.press_quotes !== undefined) artistUpdate.press_quotes = data.press_quotes;
      if (data.past_performances !== undefined) artistUpdate.past_performances = data.past_performances;
      if (data.epk_gallery !== undefined) artistUpdate.epk_gallery = data.epk_gallery;

      const promises = [];
      if (Object.keys(artistUpdate).length > 0) {
        promises.push(_sb.from('artists').update(artistUpdate).eq('profile_id', Auth.user.id));
      }
      const profileUpdate = {};
      if (data.bio !== undefined) profileUpdate.bio = data.bio;
      if (data.display_name !== undefined) profileUpdate.display_name = data.display_name;
      if (data.avatar_url !== undefined) profileUpdate.avatar_url = data.avatar_url;
      if (Object.keys(profileUpdate).length > 0) {
        profileUpdate.updated_at = new Date().toISOString();
        promises.push(_sb.from('profiles').update(profileUpdate).eq('id', Auth.user.id));
      }
      await Promise.all(promises);
      this._cachedArtistId = null;
      return { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // Artist-side incoming booking list. By default excludes rows the artist
  // has soft-hidden; pass { includeHidden: true } to see everything.
  async getIncomingBookings({ includeHidden = false } = {}) {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const artistId = await this._getMyArtistId();
      if (!artistId) return { success: true, data: [] };
      let q = _sb.from('bookings')
        .select('*, promoter:profiles!promoter_id(display_name, avatar_url, email)')
        .eq('artist_id', artistId);
      if (!includeHidden) q = q.eq('hidden_by_artist', false);
      const { data, error } = await q.order('event_date', { ascending: true });
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: (data || []).map(b => ({ ...b, promoter_name: b.promoter?.display_name || 'Unknown', promoter_email: b.promoter?.email || '' })) };
    } catch(e) { return mockFallback(); }
  },

  // Soft-hide (or unhide) a booking from the caller's list. Figures out the
  // caller's role: promoter updates hidden_by_promoter, artist updates
  // hidden_by_artist. RLS "Involved parties can update bookings" already
  // enforces that a user can only update bookings they're actually in.
  async hideBooking(bookingId, hide = true) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      // Load the booking to figure out which side we're on — we don't trust
      // Auth.role alone because it's possible (edge-case) for a user to hit
      // a booking where they're the counterparty.
      const { data: row, error: loadErr } = await _sb
        .from('bookings')
        .select('promoter_id, artist_id')
        .eq('id', bookingId)
        .single();
      if (loadErr) return { success: false, error: loadErr.message };

      const isPromoter = row.promoter_id === Auth.user.id;
      const myArtistId = await this._getMyArtistId();
      const isArtist = myArtistId && row.artist_id === myArtistId;

      if (!isPromoter && !isArtist) {
        return { success: false, error: 'Not a party to this booking' };
      }

      const patch = isPromoter
        ? { hidden_by_promoter: hide }
        : { hidden_by_artist: hide };
      patch.updated_at = new Date().toISOString();

      const { error } = await _sb.from('bookings').update(patch).eq('id', bookingId);
      return error ? { success: false, error: error.message } : { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async acceptBooking(bookingId, message) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { error } = await _sb.from('bookings').update({ status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', bookingId);
      if (error) return { success: false, error: error.message };
      if (message) {
        const { data: booking } = await _sb.from('bookings').select('promoter_id').eq('id', bookingId).single();
        if (booking?.promoter_id) await this.sendMessage(booking.promoter_id, message, bookingId);
      }
      // Branded promoter notification (fire-and-forget). Centralised
      // here so every acceptance from any surface — artist dashboard,
      // booking-detail page, future admin override — triggers one.
      this._notifyPromoterBookingAccepted(bookingId).catch(() => {});
      return { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async rejectBooking(bookingId, reason) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { error } = await _sb.from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', bookingId);
      if (error) return { success: false, error: error.message };
      if (reason) {
        const { data: booking } = await _sb.from('bookings').select('promoter_id').eq('id', bookingId).single();
        if (booking?.promoter_id) await this.sendMessage(booking.promoter_id, reason, bookingId);
      }
      this._notifyPromoterBookingRejected(bookingId).catch(() => {});
      return { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async _notifyPromoterBookingAccepted(bookingId) {
    try {
      const { data } = await _sb.from('bookings')
        .select(`
          event_name, event_date, venue, venue_name, fee, currency,
          artists(stage_name, profiles(display_name)),
          promoter:profiles!promoter_id(email, display_name)
        `)
        .eq('id', bookingId)
        .single();
      const promoterEmail = data?.promoter?.email;
      if (!promoterEmail) return;
      const artistName = data?.artists?.stage_name || data?.artists?.profiles?.display_name || 'The artist';
      await Emails.send(promoterEmail, 'booking_accepted', {
        artist_name: artistName,
        event_name:  data.event_name || 'your event',
        event_date:  data.event_date ? new Date(data.event_date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
        venue_name:  data.venue || data.venue_name || '—',
        fee:         data.fee ? `${data.currency || 'AED'} ${Number(data.fee).toLocaleString()}` : 'As agreed',
        booking_url: window.location.origin + '/booking-detail.html?id=' + bookingId,
      });
    } catch (_) { /* ignore */ }
  },

  async _notifyPromoterBookingRejected(bookingId) {
    try {
      const { data } = await _sb.from('bookings')
        .select(`
          artists(stage_name, profiles(display_name)),
          promoter:profiles!promoter_id(email, display_name)
        `)
        .eq('id', bookingId)
        .single();
      const promoterEmail = data?.promoter?.email;
      if (!promoterEmail) return;
      const artistName = data?.artists?.stage_name || data?.artists?.profiles?.display_name || 'The artist';
      await Emails.send(promoterEmail, 'booking_rejected', {
        artist_name: artistName,
        browse_url:  window.location.origin + '/directory.html',
      });
    } catch (_) { /* ignore */ }
  },

  async getArtistEarnings() {
    const empty = { success: true, data: { total: 0, pending: 0, thisMonth: 0, count: 0 } };
    if (DEMO_MODE) return empty;
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const artistId = await this._getMyArtistId();
      if (!artistId) return empty;
      const { data, error } = await _sb.from('bookings')
        .select('fee, currency, status, event_date')
        .eq('artist_id', artistId)
        .in('status', ['confirmed', 'contracted', 'completed']);
      if (error) return { success: false, error: error.message };
      const now = new Date();
      const total = (data || []).filter(b => b.status === 'completed').reduce((s, b) => s + (b.fee || 0), 0);
      const pending = (data || []).filter(b => b.status === 'confirmed' || b.status === 'contracted').reduce((s, b) => s + (b.fee || 0), 0);
      const thisMonth = (data || []).filter(b => { const d = new Date(b.event_date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).reduce((s, b) => s + (b.fee || 0), 0);
      return { success: true, data: { total, pending, thisMonth, count: (data || []).length } };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async getArtistEPK(artistId) {
    if (DEMO_MODE) return { success: false, error: 'Offline: Supabase unavailable' };
    try {
      // LEFT join on profiles so unclaimed artists still return an EPK
      const { data, error } = await _sb.from('artists')
        .select('*, profiles(display_name, avatar_url, city, bio)')
        .eq('id', artistId).single();
      if (error) return { success: false, error: error.message };
      if (!data) return { success: false, error: 'Not found' };
      return { success: true, data: { ...data, name: data.stage_name || data.profiles?.display_name || 'Unknown', bio: data.profiles?.bio || '', avatar_url: data.profiles?.avatar_url, city: data.cities_active?.[0] || data.profiles?.city || '' } };
    } catch(e) { return { success: false, error: String(e) }; }
  },
  // ── Availability ──

  async updateAvailability({ blocked_dates, available_from, available_to }) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { error } = await _sb.from('artists')
        .update({ blocked_dates, available_from, available_to })
        .eq('profile_id', Auth.user.id);
      return error ? { success: false, error: error.message } : { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // Add one or more ISO dates (YYYY-MM-DD) to the current artist's
  // blocked_dates array. Deduped, sorted, merges with existing values.
  // Returns { success, data: { blocked_dates } } with the new list.
  async blockDates(dates) {
    if (DEMO_MODE) return { success: true, data: { blocked_dates: [] } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    if (!Array.isArray(dates) || dates.length === 0) return { success: false, error: 'No dates' };
    try {
      const { data: row, error: readErr } = await _sb.from('artists')
        .select('blocked_dates')
        .eq('profile_id', Auth.user.id)
        .single();
      if (readErr) return { success: false, error: readErr.message };
      const current = Array.isArray(row?.blocked_dates) ? row.blocked_dates : [];
      const merged = Array.from(new Set([...current, ...dates])).sort();
      const { error } = await _sb.from('artists')
        .update({ blocked_dates: merged })
        .eq('profile_id', Auth.user.id);
      return error ? { success: false, error: error.message } : { success: true, data: { blocked_dates: merged } };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  // Remove one or more ISO dates from the current artist's blocked_dates.
  async unblockDates(dates) {
    if (DEMO_MODE) return { success: true, data: { blocked_dates: [] } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    if (!Array.isArray(dates) || dates.length === 0) return { success: false, error: 'No dates' };
    try {
      const { data: row, error: readErr } = await _sb.from('artists')
        .select('blocked_dates')
        .eq('profile_id', Auth.user.id)
        .single();
      if (readErr) return { success: false, error: readErr.message };
      const current = Array.isArray(row?.blocked_dates) ? row.blocked_dates : [];
      const toRemove = new Set(dates);
      const filtered = current.filter(d => !toRemove.has(d));
      const { error } = await _sb.from('artists')
        .update({ blocked_dates: filtered })
        .eq('profile_id', Auth.user.id);
      return error ? { success: false, error: error.message } : { success: true, data: { blocked_dates: filtered } };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  // Current artist's own blocked-dates list (future dates only, sorted).
  // Used by the "Quick block" dashboard card to show already-blocked
  // upcoming dates that the user can unblock with one click.
  async getMyBlockedDates({ upcomingOnly = true } = {}) {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, data: [], error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('artists')
        .select('blocked_dates')
        .eq('profile_id', Auth.user.id)
        .single();
      if (error) return { success: false, data: [], error: error.message };
      const all = Array.isArray(data?.blocked_dates) ? [...data.blocked_dates].sort() : [];
      if (!upcomingOnly) return { success: true, data: all };
      const today = new Date().toISOString().slice(0, 10);
      return { success: true, data: all.filter(d => d >= today) };
    } catch (e) { return { success: false, data: [], error: String(e) }; }
  },

  async getArtistAvailability(artistId) {
    if (DEMO_MODE) return { success: true, data: { blocked_dates: [], available_from: null, available_to: null } };
    try {
      const { data, error } = await _sb.from('artists')
        .select('blocked_dates, available_from, available_to')
        .eq('id', artistId).single();
      return error ? { success: false, error: error.message } : { success: true, data };
    } catch(e) { return { success: false, data: { blocked_dates: [], available_from: null, available_to: null } }; }
  },

  async checkAvailability(artistId, date) {
    if (DEMO_MODE) return { available: true };
    try {
      const { data } = await _sb.from('artists')
        .select('blocked_dates, available_from, available_to')
        .eq('id', artistId).single();
      if (!data) return { available: true };
      const d = new Date(date);
      if (data.available_from && d < new Date(data.available_from)) return { available: false, reason: 'Before available range' };
      if (data.available_to && d > new Date(data.available_to)) return { available: false, reason: 'After available range' };
      if (data.blocked_dates && data.blocked_dates.includes(date)) return { available: false, reason: 'Date blocked' };
      // Check existing bookings for double-booking
      const { data: bookings } = await _sb.from('bookings')
        .select('id').eq('artist_id', artistId).eq('event_date', date)
        .in('status', ['confirmed', 'contracted', 'pending']);
      if (bookings && bookings.length > 0) return { available: false, reason: 'Already booked' };
      return { available: true };
    } catch(e) { return { available: true }; }
  },

  // ── Invoice ──

  async generateInvoice(bookingId) {
    if (DEMO_MODE) return { success: true, data: { invoice_number: 'INV-DEMO-001' } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data: booking, error: bErr } = await _sb.from('bookings')
        .select('*, artists(stage_name, profiles(display_name, city))')
        .eq('id', bookingId).single();
      if (bErr || !booking) return { success: false, error: 'Booking not found' };

      const invNum = 'INV-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-6);
      const invData = {
        invoice_number: invNum,
        date: new Date().toISOString(),
        promoter_id: booking.promoter_id,
        artist_name: booking.artists?.stage_name || booking.artists?.profiles?.display_name || 'Artist',
        event_name: booking.event_name,
        event_date: booking.event_date,
        venue_name: booking.venue_name,
        fee: booking.fee,
        platform_fee: booking.platform_fee || Math.ceil((booking.fee || 0) * 0.05),
        currency: booking.currency || 'AED',
        total: (booking.fee || 0) + (booking.platform_fee || Math.ceil((booking.fee || 0) * 0.05)),
        status: 'issued',
      };

      await _sb.from('payments').update({ invoice_number: invNum, invoice_data: invData }).eq('booking_id', bookingId);
      return { success: true, data: invData };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // ── Onboarding ──

  async completeOnboarding() {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      await _sb.from('profiles').update({ onboarding_complete: true }).eq('id', Auth.user.id);
      return { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async checkOnboarding() {
    if (DEMO_MODE) return { complete: true };
    if (!Auth.user) return { complete: true };
    // Demo/localStorage users skip onboarding
    if (localStorage.getItem('rostr_demo_user')) return { complete: true };
    try {
      const { data } = await _sb.from('profiles').select('onboarding_complete').eq('id', Auth.user.id).single();
      return { complete: data?.onboarding_complete === true };
    } catch(e) { return { complete: true }; }
  },

  // ── Invitations ──

  async sendInvitation({ email, name, role, message }) {
    if (DEMO_MODE) return { success: true, data: { id: 'demo-inv-1', token: 'demo-token' } };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('invitations')
        .insert({ invited_by: Auth.user.id, email, name: name || '', role: role || 'artist', message: message || '' })
        .select().single();
      if (error) return { success: false, error: error.message };

      // Send invitation email
      const inviteUrl = `${window.location.origin}/auth.html?invite=${data.token}&role=${role || 'artist'}`;
      await Emails.send(email, 'invitation', {
        inviter_name: Auth.user.display_name || Auth.user.email,
        role: role || 'artist',
        message: message || '',
        invite_url: inviteUrl,
      });

      return { success: true, data };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  async getMyInvitations() {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('invitations')
        .select('*').eq('invited_by', Auth.user.id)
        .order('created_at', { ascending: false });
      return error ? { success: false, error: error.message } : { success: true, data: data || [] };
    } catch(e) { return { success: true, data: [] }; }
  },

  async acceptInvitation(token) {
    if (DEMO_MODE) return { success: true };
    try {
      const { error } = await _sb.from('invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('token', token);
      return error ? { success: false, error: error.message } : { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
  },

  // ── Quick-reply templates ──
  // Persisted on profiles.quick_replies (jsonb array). UI falls back to
  // role-appropriate starter suggestions when empty.
  async getQuickReplies() {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, data: [] };
    try {
      const { data, error } = await _sb.from('profiles')
        .select('quick_replies')
        .eq('id', Auth.user.id)
        .single();
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: Array.isArray(data?.quick_replies) ? data.quick_replies : [] };
    } catch (e) { return { success: false, data: [], error: String(e) }; }
  },

  async setQuickReplies(arr) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    const clean = (Array.isArray(arr) ? arr : [])
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 20); // cap to keep profile rows small
    try {
      const { error } = await _sb.from('profiles')
        .update({ quick_replies: clean })
        .eq('id', Auth.user.id);
      return error ? { success: false, error: error.message } : { success: true, data: clean };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  // ── Notifications ──
  // Fetches the current user's notification feed, most recent first.
  // Default limit of 30 keeps payload small; the nav dropdown only shows
  // the last 20 anyway.
  async getNotifications({ limit = 30 } = {}) {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, data: [] };
    try {
      const { data, error } = await _sb
        .from('notifications')
        .select('*')
        .eq('user_id', Auth.user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: data || [] };
    } catch (e) { return { success: false, data: [], error: String(e) }; }
  },

  async markNotificationRead(id) {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { error } = await _sb.from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('user_id', Auth.user.id);
      return error ? { success: false, error: error.message } : { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  async markAllNotificationsRead() {
    if (DEMO_MODE) return { success: true };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const { error } = await _sb.from('notifications')
        .update({ read: true })
        .eq('user_id', Auth.user.id)
        .eq('read', false);
      return error ? { success: false, error: error.message } : { success: true };
    } catch (e) { return { success: false, error: String(e) }; }
  },

  // ── Global search (cmd+K) ──
  // Runs three parallel partial-match queries: artists (stage_name),
  // bookings (event_name/venue), contracts (via joined booking). All
  // scoped to the current user's visibility via RLS — no extra guard
  // needed here. Returns a unified result array with { kind, title,
  // subtitle, href, meta } for direct rendering.
  async globalSearch(query) {
    if (!query || !query.trim()) return { results: [] };
    const q = query.trim();
    const like = `%${q}%`;
    if (DEMO_MODE) return { results: [] };
    if (!Auth.user) return { results: [] };

    // Fire the three lookups in parallel, each guarded so a failure on
    // one doesn't torpedo the others.
    const [artistsRes, bookingsRes, contractsRes] = await Promise.all([
      _sb.from('artists')
        .select('id, stage_name, genre, cities_active, verified')
        .ilike('stage_name', like)
        .limit(6)
        .then(r => r).catch(() => ({ data: [] })),
      _sb.from('bookings')
        .select('id, event_name, venue_name, event_date, status, artists(stage_name, profiles(display_name))')
        .or(`event_name.ilike.${like},venue_name.ilike.${like}`)
        .limit(6)
        .then(r => r).catch(() => ({ data: [] })),
      _sb.from('contracts')
        .select('id, status, bookings!inner(event_name, venue_name, artists(stage_name))')
        .ilike('bookings.event_name', like)
        .limit(4)
        .then(r => r).catch(() => ({ data: [] })),
    ]);

    const results = [];
    for (const a of (artistsRes.data || [])) {
      const genre = Array.isArray(a.genre) ? a.genre[0] : a.genre;
      const city = Array.isArray(a.cities_active) ? a.cities_active[0] : '';
      results.push({
        kind: 'artist',
        title: a.stage_name || 'Unnamed artist',
        subtitle: [genre, city].filter(Boolean).join(' \u00b7 '),
        href: `/profile.html?id=${a.id}`,
        meta: a.verified ? 'Verified' : '',
      });
    }
    for (const b of (bookingsRes.data || [])) {
      const artistName = b.artists?.stage_name || b.artists?.profiles?.display_name || 'Artist';
      const dateStr = b.event_date ? new Date(b.event_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      results.push({
        kind: 'booking',
        title: b.event_name || b.venue_name || 'Booking',
        subtitle: [artistName, b.venue_name, dateStr].filter(Boolean).join(' \u00b7 '),
        href: `/booking-detail.html?id=${b.id}`,
        meta: b.status || '',
      });
    }
    for (const c of (contractsRes.data || [])) {
      const artistName = c.bookings?.artists?.stage_name || 'Artist';
      results.push({
        kind: 'contract',
        title: `Contract \u2014 ${c.bookings?.event_name || c.bookings?.venue_name || 'Event'}`,
        subtitle: artistName,
        href: `/contract.html?id=${c.id}`,
        meta: c.status || '',
      });
    }
    return { results };
  },
};

// ══════════════════════════════════════════════════════════
// Storage — Supabase Storage for artist media / EPKs
// ══════════════════════════════════════════════════════════
const Storage = {
  BUCKET: 'artist-media',

  async upload(file, path) {
    if (!_sb) return { url: null, error: 'Supabase not available' };
    if (!Auth.user) return { url: null, error: 'Not authenticated' };
    // Validate file type + size
    const ALLOWED = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
    if (!ALLOWED.includes(file.type)) return { url: null, error: 'File type not allowed' };
    if (file.size > 10 * 1024 * 1024) return { url: null, error: 'File too large (max 10MB)' };

    const ext = file.name.split('.').pop();
    const filePath = path || `${Auth.user.id}/${Date.now()}.${ext}`;

    const { data, error } = await _sb.storage
      .from(this.BUCKET)
      .upload(filePath, file, { upsert: true });

    if (error) return { url: null, error: error.message };

    const { data: urlData } = _sb.storage
      .from(this.BUCKET)
      .getPublicUrl(data.path);

    return { url: urlData.publicUrl, error: null };
  },

  async uploadAvatar(file) {
    return this.upload(file, `avatars/${Auth.user.id}.${file.name.split('.').pop()}`);
  },

  async uploadEPK(file) {
    return this.upload(file, `epks/${Auth.user.id}/${Date.now()}.${file.name.split('.').pop()}`);
  },

  // Returns a simple upload widget HTML string + wires events after insertion
  renderUploadWidget(containerId, onUpload, label = 'Upload File') {
    return `
      <label style="display:block;cursor:pointer">
        <input type="file" id="${containerId}-input" accept="image/*,.pdf" style="display:none">
        <div id="${containerId}-btn" class="btn btn-ghost" style="pointer-events:none">
          ${UI.icon('plus', 16)} ${label}
        </div>
      </label>
      <div id="${containerId}-status" style="font-size:0.82rem;color:var(--text-tertiary);margin-top:4px"></div>
    `;
  },

  wireUploadWidget(containerId, onUpload) {
    const input = document.getElementById(`${containerId}-input`);
    const status = document.getElementById(`${containerId}-status`);
    if (!input) return;

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      status.textContent = 'Uploading...';
      const { url, error } = await Storage.upload(file);
      if (error) {
        status.textContent = 'Upload failed: ' + error;
        UI.toast('Upload failed', 'error');
      } else {
        status.textContent = 'Uploaded';
        UI.toast('File uploaded', 'success');
        if (onUpload) onUpload(url);
      }
    });
  },
};

// ══════════════════════════════════════════════════════════
// Realtime — Supabase Realtime for live messages
// ══════════════════════════════════════════════════════════
const Realtime = {
  _channels: {},

  // Subscribe to new messages for the current user
  subscribeToMessages(onMessage) {
    if (!_sb || !Auth.user) return null;

    const userId = Auth.user.id;
    const channelName = `messages:${userId}`;

    if (this._channels[channelName]) {
      this._channels[channelName].unsubscribe();
    }

    const channel = _sb
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${userId}`,
        },
        (payload) => {
          if (onMessage) onMessage(payload.new);
        }
      )
      .subscribe();

    this._channels[channelName] = channel;
    return () => { channel.unsubscribe(); delete this._channels[channelName]; };
  },

  // Subscribe to UPDATEs on messages I sent. Fires when the recipient
  // marks the message as read — used for live read receipts ("✓" → "✓✓")
  // on the sender's side without requiring a full refetch.
  subscribeToMyMessageReads(onUpdate) {
    if (!_sb || !Auth.user) return () => {};
    const userId = Auth.user.id;
    const channelName = `messages-reads:${userId}`;
    if (this._channels[channelName]) {
      this._channels[channelName].unsubscribe();
    }
    const channel = _sb
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${userId}`,
        },
        (payload) => {
          if (onUpdate) onUpdate(payload.new);
        }
      )
      .subscribe();
    this._channels[channelName] = channel;
    return () => { channel.unsubscribe(); delete this._channels[channelName]; };
  },

  // Subscribe to booking status changes
  subscribeToBookings(onUpdate) {
    if (!_sb || !Auth.user) return () => {};

    const userId = Auth.user.id;
    const channelName = `bookings:${userId}`;

    if (this._channels[channelName]) {
      this._channels[channelName].unsubscribe();
    }

    const channel = _sb
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
          filter: `promoter_id=eq.${userId}`,
        },
        (payload) => {
          if (onUpdate) onUpdate(payload.new);
        }
      )
      .subscribe();

    this._channels[channelName] = channel;
    return () => { channel.unsubscribe(); delete this._channels[channelName]; };
  },

  async subscribeToArtistBookings(onUpdate) {
    if (!_sb || !Auth.user) return () => {};
    const artistId = await DB._getMyArtistId();
    if (!artistId) return () => {};
    const channelName = `artist-bookings:${artistId}`;
    if (this._channels[channelName]) { this._channels[channelName].unsubscribe(); }
    const channel = _sb.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `artist_id=eq.${artistId}` },
        (payload) => { if (onUpdate) onUpdate(payload.new); })
      .subscribe();
    this._channels[channelName] = channel;
    return () => { channel.unsubscribe(); delete this._channels[channelName]; };
  },

  unsubscribeAll() {
    Object.values(this._channels).forEach(ch => ch.unsubscribe());
    this._channels = {};
  },
};

// ══════════════════════════════════════════════════════════
// Emails — Send transactional emails via Supabase Edge Function
// ══════════════════════════════════════════════════════════
const Emails = {
  async send(to, type, data) {
    if (!_sb) return { error: 'Supabase not available' };
    try {
      const { data: result, error } = await _sb.functions.invoke('send-email', {
        body: { to, type, data },
      });
      if (error) return { error: error.message };
      return { success: true, result };
    } catch (err) {
      console.warn('[ROSTR] Email send failed:', err);
      return { error: String(err) };
    }
  },

  bookingRequest: (to, d) => Emails.send(to, 'booking_request', d),
  bookingConfirmation: (to, d) => Emails.send(to, 'booking_confirmation', d),
  bookingAccepted: (to, d) => Emails.send(to, 'booking_accepted', d),
  bookingRejected: (to, d) => Emails.send(to, 'booking_rejected', d),
  contractSigned: (to, d) => Emails.send(to, 'contract_signed', d),
  paymentReceived: (to, d) => Emails.send(to, 'payment_received', d),
  paymentRecorded: (to, d) => Emails.send(to, 'payment_recorded', d),
};

// ══════════════════════════════════════════════════════════
// In-App Notification feed
// ══════════════════════════════════════════════════════════
// Backed by the public.notifications table. Rows written by DB triggers
// on bookings/contracts/payments/messages so every lifecycle event
// surfaces in the bell, regardless of which surface initiated the
// change.
//
// On page load: fetch the last 30 notifications, paint the dropdown,
// show the red dot if any are unread. Then subscribe to Realtime INSERTs
// on notifications where user_id = me — new rows slide into the list
// without a refresh, and the bell badge lights up immediately.
// ──────────────────────────────────────────────────────────

let _notifications = [];
let _notifUnsub = null;

// Icon per notification type — drives the small badge inside each row.
const NOTIF_ICON = {
  booking_request:   'calendar',
  booking_accepted:  'check',
  booking_rejected:  'x',
  booking_cancelled: 'x',
  contract_sent:     'fileText',
  contract_signed:   'check',
  payment_recorded:  'dollar',
  payment_confirmed: 'check',
  message:           'inbox',
};

function toggleNotifications() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  const willOpen = dd.classList.contains('hidden');
  dd.classList.toggle('hidden');
  // Close user menu if open
  const um = document.getElementById('user-menu');
  if (um) um.classList.add('hidden');
  if (willOpen) {
    // Refresh from DB first so we're aligned with any reads from other
    // tabs. Once rendered, auto-clear unread state: if the user opened
    // the tray they've seen everything. Individual items already mark
    // read on click; this handles the "I just glanced at the dot" case.
    loadNotifications().then(_autoMarkSeenNotifications);
  }
}

async function _autoMarkSeenNotifications() {
  const unread = _notifications.filter(n => !n.read);
  if (!unread.length) return;
  // Optimistic: clear dot immediately so the nav badge hides. Server
  // call is fire-and-forget; if it fails, next page load picks up the
  // real state from the DB.
  unread.forEach(n => { n.read = true; });
  renderNotifications();
  DB.markAllNotificationsRead().catch(() => {});
}

async function loadNotifications() {
  const res = await DB.getNotifications({ limit: 30 });
  _notifications = res.success ? (res.data || []) : [];
  renderNotifications();
}

async function markAllRead() {
  const res = await DB.markAllNotificationsRead();
  if (res.success) {
    _notifications.forEach(n => n.read = true);
    renderNotifications();
  }
}
window.markAllRead = markAllRead;

// Export notifications as CSV via the existing UI.downloadCSV helper.
// Uses whatever is in the current loaded list (last 30). If the user
// needs more, this is a good forcing function to build pagination later.
function exportNotificationsCSV() {
  if (!_notifications.length) { UI.toast('Nothing to export', 'info'); return; }
  const rows = _notifications.map(n => ({
    created_at:  n.created_at || '',
    type:        n.type || '',
    title:       n.title || '',
    body:        n.body || '',
    href:        n.href || '',
    read:        n.read ? 'yes' : 'no',
    booking_id:  n.booking_id || '',
    contract_id: n.contract_id || '',
    payment_id:  n.payment_id || '',
  }));
  const today = new Date().toISOString().slice(0, 10);
  UI.downloadCSV(`rostr-notifications-${today}.csv`, rows);
}
window.exportNotificationsCSV = exportNotificationsCSV;

async function openNotification(id) {
  const n = _notifications.find(x => x.id === id);
  if (!n) return;
  if (!n.read) {
    n.read = true;
    DB.markNotificationRead(id).catch(() => {});
  }
  if (n.href) { location.href = n.href; }
  else { renderNotifications(); }
}
window.openNotification = openNotification;

function _relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('notif-badge');
  if (!list) return;

  const unread = _notifications.filter(n => !n.read).length;
  if (badge) badge.style.display = unread > 0 ? '' : 'none';

  if (_notifications.length === 0) {
    list.innerHTML = '<div style="padding:20px 16px;text-align:center;color:var(--text-tertiary);font-size:0.82rem">No notifications yet</div>';
    return;
  }

  list.innerHTML = _notifications.slice(0, 20).map(n => {
    const iconName = NOTIF_ICON[n.type] || 'inbox';
    const title = String(n.title || '').replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]));
    const body  = n.body ? String(n.body).replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c])) : '';
    const rel   = _relTime(n.created_at);
    const clickable = n.href ? `onclick="openNotification('${n.id}')"` : '';
    const unreadDot = !n.read
      ? '<span style="position:absolute;top:12px;right:12px;width:6px;height:6px;border-radius:50%;background:var(--accent)"></span>'
      : '';
    return `
      <div ${clickable} style="position:relative;padding:10px 14px;border-bottom:1px solid var(--border-subtle);display:flex;gap:10px;align-items:flex-start;${n.href ? 'cursor:pointer' : ''};${n.read ? 'opacity:0.7' : ''};transition:background 80ms ease"
           onmouseover="this.style.background='var(--bg-card)'" onmouseout="this.style.background=''">
        <div style="width:28px;height:28px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);flex-shrink:0;margin-top:2px">${UI.icon(iconName, 14)}</div>
        <div style="flex:1;min-width:0;padding-right:12px">
          <div style="font-size:0.86rem;font-weight:${n.read ? '400' : '600'};color:var(--text-primary);line-height:1.3">${title}</div>
          ${body ? `<div style="font-size:0.76rem;color:var(--text-tertiary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${body}</div>` : ''}
          <div style="font-size:0.68rem;color:var(--text-tertiary);margin-top:4px;font-family:var(--font-mono)">${rel}</div>
        </div>
        ${unreadDot}
      </div>
    `;
  }).join('');
}

// Subscribe to Realtime INSERTs on notifications for this user. New rows
// get prepended to the local list and the bell badge lights up. Idempotent
// — previous channel torn down on re-entry so we don't stack subscriptions.
function setupRealtimeNotifications() {
  if (!Auth.isLoggedIn() || !_sb) return;
  if (_notifUnsub) { _notifUnsub(); _notifUnsub = null; }

  // Initial paint from DB
  loadNotifications();

  const userId = Auth.user.id;
  const channel = _sb
    .channel(`notifications:${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, (payload) => {
      const n = payload.new;
      if (!n) return;
      _notifications = [n, ..._notifications].slice(0, 30);
      renderNotifications();
      // Subtle toast for immediacy — full details live in the dropdown.
      if (UI && UI.toast) UI.toast(n.title || 'New notification', 'info');
    })
    .subscribe();

  _notifUnsub = () => { channel.unsubscribe(); };
}

// ── Hydrate static icon placeholders ──
// Replaces <span class="js-icon" data-icon="name" data-size="16"></span> with real SVG
function hydrateIcons(root) {
  (root || document).querySelectorAll('.js-icon[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    const size = parseInt(el.dataset.size) || 16;
    if (typeof UI !== 'undefined' && UI.icon) {
      el.innerHTML = UI.icon(name, size);
      el.classList.remove('js-icon');
    }
  });
}

// ── Init ──
// Wait for DOMContentLoaded so the Supabase CDN script has finished loading.
// ── Analytics — Plausible (privacy-friendly, no cookies) ──
(function() {
  if (window.location.hostname === 'localhost') return;
  const s = document.createElement('script');
  s.defer = true;
  s.dataset.domain = 'rosterplus.io';
  s.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(s);
})();

// Tiny "Built from <sha>" tag in the corner — helps support triage stale
// caches and verifies the latest deploy landed. Set at deploy time by
// scripts/deploy.sh; falls back to 'dev' locally.
function _injectVersionTag() {
  if (document.getElementById('rostr-version-tag')) return;
  const ver = (typeof window !== 'undefined' && window.ROSTR_VERSION) || 'dev';
  const tag = document.createElement('div');
  tag.id = 'rostr-version-tag';
  tag.textContent = ver;
  tag.title = 'ROSTR+ build';
  tag.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:40;font-family:var(--font-mono,monospace);font-size:0.62rem;color:rgba(255,255,255,0.18);padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.25);backdrop-filter:blur(4px);pointer-events:none;user-select:none;letter-spacing:0.04em';
  document.body.appendChild(tag);
}

function _rostrInit() {
  Auth.init();
  hydrateIcons();
  _injectVersionTag();
  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-avatar') && !e.target.closest('#user-menu')) {
      const menu = document.getElementById('user-menu');
      if (menu) menu.classList.add('hidden');
    }
    if (!e.target.closest('.nav-bell') && !e.target.closest('#notif-dropdown')) {
      const dd = document.getElementById('notif-dropdown');
      if (dd) dd.classList.add('hidden');
    }
  });
  // Setup realtime notifications after auth resolves
  Auth.ready().then(() => setupRealtimeNotifications());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _rostrInit);
} else {
  _rostrInit();
}

// ══════════════════════════════════════════════════════════
// PWA Install Prompt
// ══════════════════════════════════════════════════════════
// Shows a tasteful banner on mobile nudging users to install the app.
//
// Two code paths:
//   1. Android/Chromium: listens for `beforeinstallprompt`, stashes the event,
//      and reveals an "Install" button that fires the native prompt.
//   2. iOS Safari: no native prompt exists, so we show an instructional
//      banner ("Tap Share → Add to Home Screen").
//
// Gating rules (all must be true to show):
//   - Not already running in standalone/PWA mode
//   - Mobile viewport (<= 768px) — PWA on desktop is rare; skip the noise
//   - At least one successful page visit prior (don't pounce on first landing)
//   - Not dismissed within the last 14 days
//   - Not on auth/landing pages (we want them logged in first)
// ──────────────────────────────────────────────────────────

const PWA_INSTALL_DISMISS_KEY = 'rostr_install_dismissed_at';
const PWA_INSTALL_VISIT_KEY = 'rostr_visit_count';
const PWA_INSTALL_DISMISS_DAYS = 14;
const PWA_INSTALL_MIN_VISITS = 2;
const PWA_INSTALL_SKIP_PAGES = ['/', '/index.html', '/auth.html', '/terms.html', '/privacy.html', '/claim-profile.html'];

let _deferredInstallPrompt = null;

// Track visit count — used to avoid prompting on the very first pageview.
try {
  const n = parseInt(localStorage.getItem(PWA_INSTALL_VISIT_KEY) || '0', 10);
  localStorage.setItem(PWA_INSTALL_VISIT_KEY, String(n + 1));
} catch (_) { /* private mode / no storage */ }

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  maybeShowInstallBanner({ ios: false });
});

// Dismissal is a sliding window: "not recently dismissed" means it's been
// longer than PWA_INSTALL_DISMISS_DAYS since the last "no thanks" tap.
function _installDismissedRecently() {
  try {
    const raw = localStorage.getItem(PWA_INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const when = parseInt(raw, 10);
    if (!Number.isFinite(when)) return false;
    const days = (Date.now() - when) / (1000 * 60 * 60 * 24);
    return days < PWA_INSTALL_DISMISS_DAYS;
  } catch (_) { return false; }
}

function _canShowInstallBanner() {
  // Already installed — bail
  if (window.matchMedia('(display-mode: standalone)').matches) return false;
  if (window.navigator.standalone === true) return false;
  // Desktop — bail (PWA on desktop is niche; keep the banner mobile-only)
  if (window.innerWidth > 768) return false;
  // Pages where an install prompt is premature
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (PWA_INSTALL_SKIP_PAGES.includes(path) || PWA_INSTALL_SKIP_PAGES.includes(path + '.html')) return false;
  // Minimum visit count — don't ambush a first-time visitor
  try {
    const n = parseInt(localStorage.getItem(PWA_INSTALL_VISIT_KEY) || '0', 10);
    if (n < PWA_INSTALL_MIN_VISITS) return false;
  } catch (_) { /* fall through */ }
  // Recently dismissed
  if (_installDismissedRecently()) return false;
  // Banner already on screen
  if (document.getElementById('install-banner')) return false;
  return true;
}

function maybeShowInstallBanner({ ios }) {
  if (!_canShowInstallBanner()) return;

  const iosHint = ios
    ? `Tap <strong style="color:var(--accent)">Share</strong>, then <strong style="color:var(--accent)">Add to Home Screen</strong>`
    : `Add to home screen for the best experience`;
  const cta = ios
    ? ''
    : `<button onclick="triggerInstall()" style="background:var(--accent);color:#0a0a0f;border:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;white-space:nowrap">Install</button>`;

  // Ensure the slideUp keyframes are only injected once per page
  if (!document.getElementById('install-banner-styles')) {
    const style = document.createElement('style');
    style.id = 'install-banner-styles';
    style.textContent = '@keyframes rostrSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(style);
  }

  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.style.cssText = 'position:fixed;bottom:env(safe-area-inset-bottom,0);left:0;right:0;z-index:9999;padding:14px 16px;background:linear-gradient(135deg,#141418,#0a0a0f);border-top:1px solid var(--accent-dim-20);display:flex;align-items:center;gap:14px;animation:rostrSlideUp .4s ease-out;box-shadow:0 -8px 24px rgba(0,0,0,0.4)';
  banner.innerHTML = `
    <div style="width:44px;height:44px;border-radius:12px;background:var(--accent-dim-10);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:0.92rem;color:#fff;margin-bottom:2px">Install ROSTR+</div>
      <div style="font-size:0.76rem;color:rgba(255,255,255,0.55);line-height:1.4">${iosHint}</div>
    </div>
    ${cta}
    <button onclick="dismissInstall()" aria-label="Dismiss install prompt" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:6px 4px;font-size:1.4rem;line-height:1">&times;</button>
  `;
  document.body.appendChild(banner);
}

function triggerInstall() {
  if (!_deferredInstallPrompt) { dismissInstall(); return; }
  _deferredInstallPrompt.prompt();
  _deferredInstallPrompt.userChoice.then((choice) => {
    if (choice && choice.outcome === 'accepted') {
      try { UI.toast('App installed!', 'success'); } catch (_) {}
      // Clear dismissal so if user uninstalls and comes back later, prompt can show again
      try { localStorage.removeItem(PWA_INSTALL_DISMISS_KEY); } catch (_) {}
    } else {
      // User cancelled at the native prompt — treat as dismissal
      try { localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now())); } catch (_) {}
    }
    _deferredInstallPrompt = null;
    const banner = document.getElementById('install-banner');
    if (banner) banner.remove();
  }).catch(() => { dismissInstall(); });
}

function dismissInstall() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.remove();
  try { localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now())); } catch (_) {}
}
window.triggerInstall = triggerInstall;
window.dismissInstall = dismissInstall;

// If the user accepts the prompt natively via the browser's omnibox (no banner
// interaction), the `appinstalled` event fires. Clear any dismissal record and
// hide the banner if we happened to have it up.
window.addEventListener('appinstalled', () => {
  try { localStorage.removeItem(PWA_INSTALL_DISMISS_KEY); } catch (_) {}
  const banner = document.getElementById('install-banner');
  if (banner) banner.remove();
});

// iOS Safari path — no `beforeinstallprompt` event exists, so poll once on load.
// Delay slightly so the banner doesn't race with page render / toast setup.
function _maybeShowIOSInstallHint() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
  if (!isIOS || !isSafari) return;
  maybeShowInstallBanner({ ios: true });
}
setTimeout(_maybeShowIOSInstallHint, 2500);