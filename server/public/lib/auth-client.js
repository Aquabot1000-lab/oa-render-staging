/**
 * /lib/auth-client.js — shared frontend auth helper (P0 fix, 2026-05-01)
 *
 * Replaces the previous pattern where each admin page hard-coded Tyler's
 * password and called /api/auth/login on load. That:
 *   1. Leaked Tyler's password to anyone with View-Source.
 *   2. Forced every visitor (including Uri) to operate as Tyler — fully
 *      bypassing the Phase 7 role gates.
 *
 * Now: every protected page calls AuthClient.requireAuth() at the top of its
 * script. If there's no JWT in localStorage, or the JWT is expired/malformed,
 * the user is redirected to /login?return=<current-path>. After login the
 * page reloads with a real token attached to the real signed-in user.
 *
 * Public surface:
 *   AuthClient.requireAuth({ minRole })  → kicks to /login or returns user
 *   AuthClient.getToken()                → string | null
 *   AuthClient.getUser()                 → { id, email, role } | null
 *   AuthClient.apiHeaders()              → { Authorization, Content-Type }
 *   AuthClient.logout()                  → clears storage, kicks to /login
 *   AuthClient.canPerform(action)        → boolean (mirrors server catalog)
 *
 *   AuthClient.fetchAuthed(url, opts)    → fetch wrapper that auto-attaches
 *                                          headers and kicks to /login on 401
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'oa_auth_token';
  const USER_KEY  = 'oa_auth_user';

  // Mirror of server/lib/auth-roles.js ROLE_RANK. Kept in sync manually — see
  // the server module for the source of truth. Used only for UI-side hide/show
  // decisions; the server still enforces every guard.
  const ROLE_RANK = { system: 100, admin: 50, operator: 10 };

  // Mirror of server-side ACTION_REQUIREMENTS, used purely for UI gating.
  // Server is still the source of truth.
  const ACTION_REQUIREMENTS = {
    'filing.approve':       'admin',
    'filing.file':          'admin',
    'filing.deny':          'admin',
    'filing.reject':        'admin',
    'case.lock':            'admin',
    'case.unlock':          'admin',
    'case.override_status': 'admin',
    'case.force':           'admin',
    'metrics.write':        'admin',
    'system.config':        'admin',
    'system.deploy':        'admin',
    'user.create':          'admin',
    'user.setup_token':     'admin',
    'case.note':            'operator',
    'case.message_send':    'operator',
    'case.request_doc':     'operator',
    'case.assign':          'operator',
    'case.follow_up':       'operator',
    'case.view':            'operator',
    'case.comps_rerun':     'operator',
    'case.status_update':   'operator',
  };

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) { console.error('[auth] setSession failed', e); }
  }

  function logout(redirect = true) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    if (redirect) toLogin();
  }

  function toLogin() {
    const ret = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?return=${ret}`);
  }

  /**
   * Decode a JWT payload without verifying signature (UI use only — server
   * still verifies every request). Returns null on malformed token.
   */
  function decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
      const json = atob(b64 + pad);
      return JSON.parse(json);
    } catch { return null; }
  }

  /**
   * requireAuth({ minRole }) — call at the top of every protected page.
   * Returns the decoded user object, or redirects to /login.
   */
  function requireAuth(opts = {}) {
    const token = getToken();
    if (!token) { toLogin(); return null; }

    const payload = decodeJwt(token);
    if (!payload) { logout(); return null; }

    // exp is seconds-since-epoch
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      console.warn('[auth] token expired, kicking to /login');
      logout();
      return null;
    }

    const user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };

    // Sync any updated user info into localStorage so getUser() is fresh
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch {}

    if (opts.minRole) {
      const userRank = ROLE_RANK[user.role] ?? 0;
      const needRank = ROLE_RANK[opts.minRole] ?? 0;
      if (userRank < needRank) {
        document.body.innerHTML =
          `<div style="padding:60px;text-align:center;color:#ef4444;font-family:system-ui;">
            <h1 style="font-size:22px;margin-bottom:12px;">⛔ Access Denied</h1>
            <p>This page requires <strong>${opts.minRole}</strong> role. You are signed in as <strong>${user.email}</strong> (${user.role || 'no role'}).</p>
            <p style="margin-top:20px;"><a href="/login" style="color:#58a6ff;">Sign in as a different user</a></p>
          </div>`;
        return null;
      }
    }

    return user;
  }

  function apiHeaders() {
    return {
      'Authorization': `Bearer ${getToken() || ''}`,
      'Content-Type':  'application/json',
    };
  }

  /**
   * fetchAuthed — wraps fetch() with Authorization header + 401 redirect.
   */
  async function fetchAuthed(url, opts = {}) {
    const headers = Object.assign({}, apiHeaders(), opts.headers || {});
    const r = await fetch(url, Object.assign({}, opts, { headers }));
    if (r.status === 401 || r.status === 403) {
      // 401: token bad/expired. 403: insufficient role; let caller handle.
      if (r.status === 401) { logout(); return r; }
    }
    return r;
  }

  function canPerform(action) {
    const user = getUser();
    if (!user || !user.role) return false;
    const required = ACTION_REQUIREMENTS[action];
    if (!required) return false;
    const userRank = ROLE_RANK[user.role] ?? 0;
    const needRank = ROLE_RANK[required] ?? 0;
    return userRank >= needRank;
  }

  global.AuthClient = {
    requireAuth,
    getToken,
    getUser,
    setSession,
    logout,
    apiHeaders,
    fetchAuthed,
    canPerform,
    ROLE_RANK,
  };
})(window);
