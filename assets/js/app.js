/* ═══════════════════════════════════════════════════════════
   ROSTR+ GCC — Core Application JS
   Supabase client, auth, router, UI helpers, live data
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Config ──
const SUPABASE_URL = 'https://vgjmfpryobsuboukbemr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnam1mcHJ5b2JzdWJvdWtiZW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTkzNTksImV4cCI6MjA5MDk3NTM1OX0.8bd3ki35UxHcLVJm3mUhzE3udZ7yec2im-oH0SzQoyw';

let _sb = null;
let DEMO_MODE = false;
const FORCE_DEMO = false;

function initSupabase() {
  if (FORCE_DEMO) { DEMO_MODE = true; return; }
  if (!window.supabase) {
    console.error('[ROSTR] Supabase library not loaded from CDN — falling back to demo mode');
    DEMO_MODE = true;
    return;
  }
  try {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    DEMO_MODE = false;
    console.log('[ROSTR] Supabase connected');
  } catch(e) {
    console.error('[ROSTR] Supabase client creation failed:', e);
    DEMO_MODE = true;
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

    // Async path for Supabase — real session overrides demo user
    _sb.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        this.user = session.user;
        localStorage.removeItem('rostr_demo_user'); // clear demo if real session
        return this.loadProfile();
      }
    }).then(() => {
      this._initialized = true;
      if (this._readyResolve) this._readyResolve();
      this.updateUI();
    }).catch((err) => {
      console.error('[ROSTR] Auth init failed:', err);
      this._initialized = true;
      if (this._readyResolve) this._readyResolve();
    });

    // Listen for auth changes (skip if demo user is active)
    _sb.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        this.user = session.user;
        localStorage.removeItem('rostr_demo_user');
        await this.loadProfile();
        this.updateUI();
      } else if (!localStorage.getItem('rostr_demo_user')) {
        this.user = null;
        this.role = null;
        this.updateUI();
      }
    });
  },

  async loadProfile() {
    if (!this.user || DEMO_MODE) return;
    const { data } = await _sb
      .from('profiles')
      .select('role, display_name, avatar_url')
      .eq('id', this.user.id)
      .single();
    if (data) {
      this.role = data.role;
      this.user.display_name = data.display_name;
      this.user.avatar_url = data.avatar_url;
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

    const { data, error } = await _sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name, role }
      }
    });
    if (error) return { success: false, error: error.message };

    // Profile is auto-created by database trigger using metadata above
    this.user = data.user;
    this.role = role;
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
    // Set user initials in avatar
    document.querySelectorAll('.nav-avatar').forEach(el => {
      if (this.user) {
        const name = this.user.display_name || this.user.email || '';
        el.textContent = name.charAt(0).toUpperCase();
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
      star: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
      filter: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/></svg>`,
      mapPin: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
      verified: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="var(--gold)" stroke="var(--bg-base)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01" stroke="var(--bg-base)" fill="none"/></svg>`,
      menu: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
      logout: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
      send: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>`,
      shield: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      activity: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>`,
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
    <li><a href="/messages.html" class="${ac('messages')}">${UI.icon('inbox', 16)} Messages</a></li>`;

  const artistLinks = `
    <li><a href="/artist-dashboard.html" class="${ac('artist-dashboard')}">${UI.icon('home', 16)} Dashboard</a></li>
    <li><a href="/artist-profile-edit.html" class="${ac('profile-edit')}">${UI.icon('music', 16)} My Profile</a></li>
    <li><a href="/epk.html" class="${ac('epk')}">${UI.icon('fileText', 16)} My EPK</a></li>
    <li><a href="/messages.html" class="${ac('messages')}">${UI.icon('inbox', 16)} Messages</a></li>`;

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
            <button class="nav-bell" id="notif-bell" onclick="toggleNotifications()" style="position:relative;background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" title="Notifications">
              ${UI.icon('inbox', 18)}
              <span id="notif-badge" style="display:none;position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--status-cancelled)"></span>
            </button>
            <div id="notif-dropdown" class="hidden" style="position:absolute;top:56px;right:70px;background:var(--bg-raised);border:1px solid var(--border-medium);border-radius:var(--radius-md);padding:0;min-width:300px;max-height:400px;overflow-y:auto;box-shadow:var(--shadow-lg);z-index:1001">
              <div style="padding:12px 16px;font-size:0.82rem;font-weight:600;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center">
                Notifications
                <button class="btn btn-ghost" style="font-size:0.72rem;padding:2px 8px" onclick="markAllRead()">Mark all read</button>
              </div>
              <div id="notif-list" style="padding:8px"><div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:0.82rem">No notifications yet</div></div>
            </div>
            <div class="nav-avatar" onclick="document.getElementById('user-menu').classList.toggle('hidden')">${Auth.user?.display_name?.charAt(0)?.toUpperCase() || 'U'}</div>
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
}

// ── Password Reset ──
Auth.sendPasswordReset = async function(email) {
  if (DEMO_MODE) return { success: false, error: 'Not available in demo mode' };
  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/auth.html?mode=reset'
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
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
    };

    return { success: true, data: normalised };
    } catch(e) {
      return { success: false, error: String(e) };
    }
  },

  // ── Bookings ──
  async getMyBookings() {
    if (DEMO_MODE) return { success: true, data: [] };
    const user = Auth.user;
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error } = await _sb.from('bookings')
        .select(`*, artists(stage_name, genre, cities_active, profiles(display_name))`)
        .eq('promoter_id', user.id)
        .order('event_date', { ascending: true });
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
      return error ? { success: false, error: error.message } : { success: true, data };
    } catch(e) { return { success: false, error: String(e) }; }
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

  async signContract(contractId, role) {
    if (DEMO_MODE) return { error: null };

    const update = role === 'promoter'
      ? { promoter_signed: true }
      : { artist_signed: true };

    const { data: contract } = await _sb
      .from('contracts')
      .select('promoter_signed, artist_signed')
      .eq('id', contractId)
      .single();

    const bothSigned = role === 'promoter'
      ? contract?.artist_signed
      : contract?.promoter_signed;

    const finalUpdate = {
      ...update,
      ...(bothSigned ? { status: 'signed', signed_at: new Date().toISOString() } : {})
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

  async getIncomingBookings() {
    if (DEMO_MODE) return { success: true, data: [] };
    if (!Auth.user) return { success: false, error: 'Not authenticated' };
    try {
      const artistId = await this._getMyArtistId();
      if (!artistId) return { success: true, data: [] };
      const { data, error } = await _sb.from('bookings')
        .select('*, promoter:profiles!promoter_id(display_name, avatar_url, email)')
        .eq('artist_id', artistId)
        .order('event_date', { ascending: true });
      if (error) return { success: false, data: [], error: error.message };
      return { success: true, data: (data || []).map(b => ({ ...b, promoter_name: b.promoter?.display_name || 'Unknown', promoter_email: b.promoter?.email || '' })) };
    } catch(e) { return mockFallback(); }
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
      return { success: true };
    } catch(e) { return { success: false, error: String(e) }; }
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
};

// ── In-App Notifications ──
const _notifications = [];

function toggleNotifications() {
  const dd = document.getElementById('notif-dropdown');
  if (dd) dd.classList.toggle('hidden');
  // Close user menu if open
  const um = document.getElementById('user-menu');
  if (um) um.classList.add('hidden');
}

function addNotification(text, type = 'info') {
  _notifications.unshift({ text, type, time: new Date(), read: false });
  renderNotifications();
}

function markAllRead() {
  _notifications.forEach(n => n.read = true);
  renderNotifications();
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('notif-badge');
  if (!list) return;

  const unread = _notifications.filter(n => !n.read).length;
  if (badge) badge.style.display = unread > 0 ? '' : 'none';

  if (_notifications.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:0.82rem">No notifications yet</div>';
    return;
  }

  list.innerHTML = _notifications.slice(0, 20).map(n => {
    const time = n.time ? new Date(n.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle);font-size:0.85rem;${n.read ? 'opacity:0.6' : ''}">
      <div>${esc(n.text)}</div>
      <div style="font-size:0.72rem;color:var(--text-tertiary);margin-top:2px">${time}</div>
    </div>`;
  }).join('');
}

// Hook into Realtime to push in-app notifications
function setupRealtimeNotifications() {
  if (!Auth.isLoggedIn()) return;

  Realtime.subscribeToMessages((msg) => {
    addNotification('New message received', 'message');
    UI.toast('New message', 'info');
  });

  if (Auth.role === 'promoter') {
    Realtime.subscribeToBookings((updated) => {
      addNotification('Booking updated: ' + (updated.status || ''), 'booking');
    });
  }
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

function _rostrInit() {
  Auth.init();
  hydrateIcons();
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

// ── PWA Install Prompt ──
let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  // Don't show if already installed or dismissed recently
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (localStorage.getItem('rostr_install_dismissed') === 'true') return;

  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.innerHTML = `
    <div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:16px;background:linear-gradient(135deg,#1a1a22,#0a0a0f);border-top:1px solid rgba(201,168,76,0.3);display:flex;align-items:center;gap:16px;animation:slideUp .4s ease-out">
      <div style="width:48px;height:48px;border-radius:12px;background:rgba(201,168,76,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:0.95rem;color:#fff;margin-bottom:2px">Install ROSTR+</div>
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.5)">Add to home screen for the best experience</div>
      </div>
      <button onclick="triggerInstall()" style="background:#c9a84c;color:#000;border:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;white-space:nowrap">Install</button>
      <button onclick="dismissInstall()" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:8px;font-size:1.2rem">&times;</button>
    </div>
  `;

  // Add slide up animation
  const style = document.createElement('style');
  style.textContent = '@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}';
  document.head.appendChild(style);

  document.body.appendChild(banner);
}

function triggerInstall() {
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    _deferredInstallPrompt.userChoice.then((choice) => {
      if (choice.outcome === 'accepted') {
        UI.toast('App installed!', 'success');
      }
      _deferredInstallPrompt = null;
      dismissInstall();
    });
  }
}

function dismissInstall() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.remove();
  localStorage.setItem('rostr_install_dismissed', 'true');
}

// iOS Safari install prompt (no beforeinstallprompt event)
function showIOSInstallHint() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

  if (isIOS && isSafari && !isStandalone && !localStorage.getItem('rostr_install_dismissed')) {
    const banner = document.createElement('div');
    banner.id = 'install-banner';
    banner.innerHTML = `
      <div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:16px;background:linear-gradient(135deg,#1a1a22,#0a0a0f);border-top:1px solid rgba(201,168,76,0.3);display:flex;align-items:center;gap:12px;animation:slideUp .4s ease-out">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(201,168,76,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16,6 12,2 8,6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:0.95rem;color:#fff;margin-bottom:2px">Install ROSTR+</div>
          <div style="font-size:0.78rem;color:rgba(255,255,255,0.5)">Tap <strong style="color:#c9a84c">Share</strong> then <strong style="color:#c9a84c">Add to Home Screen</strong></div>
        </div>
        <button onclick="dismissInstall()" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:8px;font-size:1.2rem">&times;</button>
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = '@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}';
    document.head.appendChild(style);
    document.body.appendChild(banner);
  }
}

// Show iOS hint after a short delay
setTimeout(showIOSInstallHint, 3000);
