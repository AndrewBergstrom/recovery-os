// sync.js — optional cross-device sync through the patient's own Supabase project.
//
// Design: IndexedDB stays the source of truth on each device (offline-first).
// Every local write is also queued in an `outbox`; when signed in and online the
// outbox is pushed to one row-level-secured table (`records`) and new rows are
// pulled back. Events are append-only (no conflicts); other documents use
// last-write-wins by the client's updated_at, enforced by a trigger on the server.
// No SDK: a handful of fetch calls against Supabase Auth (email OTP code) and
// PostgREST, so the page keeps its strict CSP and zero dependencies.

import { KEY_PATHS } from './db.js';

export const SYNCED_STORES = ['events', 'orders', 'questions', 'milestones', 'appointments', 'contacts', 'meta', 'slot_states'];
export const EXCLUDED_META_KEYS = new Set(['seed', 'last_export', 'sync']);
export const SESSION_KEY = 'recovery-os:supabase-session';
export const LOCAL_CONFIG_KEY = 'recovery-os:supabase-config';
const PAGE = 500;

export function docKey(store, obj) {
  return obj?.[KEY_PATHS[store]];
}

export function shouldSync(store, obj) {
  if (!SYNCED_STORES.includes(store)) return false;
  if (store === 'meta' && EXCLUDED_META_KEYS.has(obj?.key)) return false;
  return docKey(store, obj) != null;
}

/** Outbox entry for a local write (or a tombstone when deleted). Same doc → same id, so repeated writes coalesce. */
export function outboxEntry(store, obj, { deleted = false, now = Date.now() } = {}) {
  const key = String(docKey(store, obj));
  const updated_at = obj.updated_at || (store === 'events' ? obj.recorded_at : null) || new Date(now).toISOString();
  return { id: `${store}:${key}`, store, key, payload: deleted ? null : obj, deleted, updated_at, queued_at: new Date(now).toISOString() };
}

export function rowFromEntry(entry, userId) {
  return { user_id: userId, store: entry.store, key: entry.key, payload: entry.payload ?? {}, deleted: !!entry.deleted, updated_at: entry.updated_at };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Decide how remote rows apply locally. Pure.
 * - A doc with a pending local change keeps the local version unless the remote one is newer.
 * - Any other doc takes the remote version (seed rows and already-synced docs never "win" over the cloud).
 * - Tombstones delete locally.
 */
export function planPull(rows, { localDocs, pending }) {
  const puts = [];
  const deletes = [];
  const dropPending = [];
  for (const r of rows) {
    const id = `${r.store}:${r.key}`;
    const pend = pending.get(id);
    if (pend) {
      if (pend.updated_at >= r.updated_at) continue;
      dropPending.push(id);
    }
    const local = localDocs.get(id);
    if (r.deleted) {
      if (local) deletes.push({ store: r.store, key: r.key });
      continue;
    }
    if (!r.payload || typeof r.payload !== 'object') continue;
    if (local && same(local, r.payload)) continue;
    puts.push({ store: r.store, obj: r.payload });
  }
  return { puts, deletes, dropPending };
}

// ---------- Supabase client (fetch only) ----------

function readJson(res) {
  return res
    .text()
    .then((t) => (t ? JSON.parse(t) : null))
    .catch(() => null);
}

export function createSupabaseClient({ url = '', anonKey = '', fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null, storage = null, now = Date.now } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const configured = !!(base && anonKey && fetchImpl);
  let session = null;
  try {
    const raw = storage?.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  const save = () => {
    try {
      if (session) storage?.setItem(SESSION_KEY, JSON.stringify(session));
      else storage?.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  };
  const headers = (auth) => {
    const h = { apikey: anonKey, 'Content-Type': 'application/json' };
    if (auth && session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  };
  async function request(path, { method = 'GET', body, auth = true, prefer, retried = false } = {}) {
    if (!configured) throw new Error('Sync is not configured.');
    const res = await fetchImpl(`${base}${path}`, { method, headers: { ...headers(auth), ...(prefer ? { Prefer: prefer } : {}) }, body: body != null ? JSON.stringify(body) : undefined });
    if (res.status === 401 && auth && session?.refresh_token && !retried) {
      await client.refresh();
      return request(path, { method, body, auth, prefer, retried: true });
    }
    const data = await readJson(res);
    if (!res.ok) {
      const msg = data?.msg || data?.message || data?.error_description || data?.error || `${res.status} ${res.statusText || ''}`.trim();
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const client = {
    configured,
    get session() {
      return session;
    },
    get userId() {
      return session?.user?.id || null;
    },
    get email() {
      return session?.user?.email || null;
    },
    /** Sends the sign-in email. The link (default template) returns to redirectTo; a code is included only if the project's template has {{ .Token }}. */
    async signInStart(email, { redirectTo } = {}) {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      await request(`/auth/v1/otp${q}`, { method: 'POST', auth: false, body: { email, create_user: true } });
    },
    /** Sign in from a pasted magic link (long-press → Copy on iPhone): the link's token is verified directly, so the installed app gets the session. */
    async signInVerifyLink(linkText) {
      let u;
      try {
        u = new URL(String(linkText).trim());
      } catch {
        throw new Error('That does not look like the sign-in link from the email.');
      }
      const tokenHash = u.searchParams.get('token') || u.searchParams.get('token_hash');
      const type = u.searchParams.get('type') || 'magiclink';
      if (!tokenHash) throw new Error('The link has no sign-in token. Copy the whole link from the email.');
      const data = await request('/auth/v1/verify', { method: 'POST', auth: false, body: { type, token_hash: tokenHash } });
      if (!data?.access_token) throw new Error('Sign-in did not return a session.');
      session = data;
      save();
      return session;
    },
    /** Adopt a session from the URL hash after a magic-link redirect (implicit flow). Returns true if one was found. */
    async adoptSessionFromHash(hash) {
      const h = String(hash || '').replace(/^#\/?/, '');
      if (!h.includes('access_token=')) return false;
      const params = new URLSearchParams(h);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token) return false;
      session = { access_token, refresh_token, token_type: params.get('token_type') || 'bearer', expires_in: Number(params.get('expires_in') || 3600), expires_at: Number(params.get('expires_at') || Math.floor(now() / 1000) + 3600), user: null };
      try {
        session.user = await request('/auth/v1/user');
      } catch (e) {
        session = null;
        throw new Error(`The sign-in link was accepted but the account could not be loaded: ${e.message}`);
      }
      save();
      return true;
    },
    hashError(hash) {
      const h = String(hash || '').replace(/^#\/?/, '');
      if (!h.includes('error=') && !h.includes('error_description=')) return null;
      const params = new URLSearchParams(h);
      return params.get('error_description') || params.get('error_code') || params.get('error');
    },
    async signInVerify(email, token) {
      const data = await request('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', email, token: String(token).trim() } });
      if (!data?.access_token) throw new Error('Sign-in did not return a session.');
      session = data;
      save();
      return session;
    },
    async refresh() {
      if (!session?.refresh_token) throw new Error('Not signed in.');
      let data;
      try {
        data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
      } catch (e) {
        if (e.status === 400 || e.status === 401 || e.status === 403) {
          session = null;
          save();
          throw new Error('Session expired — sign in again.');
        }
        throw e;
      }
      session = data;
      save();
      return session;
    },
    async ensureFreshToken() {
      if (!session) throw new Error('Not signed in.');
      const expiresAt = Number(session.expires_at || 0) * 1000;
      if (expiresAt && expiresAt - now() < 2 * 60 * 1000) await client.refresh();
    },
    async signOut() {
      try {
        if (session) await request('/auth/v1/logout', { method: 'POST' });
      } catch {
        /* best effort */
      }
      session = null;
      save();
    },
    /** Anonymous session (used by care-partner invite links). Requires "Allow anonymous sign-ins" in the project. */
    async signInAnonymously() {
      const data = await request('/auth/v1/signup', { method: 'POST', auth: false, body: {} });
      if (!data?.access_token) throw new Error('Anonymous sign-in is not enabled for this project.');
      session = data;
      save();
      return session;
    },
    get isAnonymous() {
      return !!session?.user?.is_anonymous;
    },
    /** Generic PostgREST helpers for the small side tables (care circle, push subscriptions). */
    async rpc(name, args = {}) {
      return request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });
    },
    async select(table, query = '') {
      const rows = await request(`/rest/v1/${table}${query ? `?${query}` : ''}`);
      return Array.isArray(rows) ? rows : [];
    },
    async insert(table, row) {
      const rows = await request(`/rest/v1/${table}`, { method: 'POST', body: row, prefer: 'return=representation' });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async upsertRows(table, rows, onConflict) {
      return request(`/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' });
    },
    async patch(table, query, patch) {
      return request(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    },
    async remove(table, query) {
      return request(`/rest/v1/${table}?${query}`, { method: 'DELETE', prefer: 'return=minimal' });
    },
    async callFunction(name, { query = '', body = {} } = {}) {
      return request(`/functions/v1/${name}${query ? `?${query}` : ''}`, { method: 'POST', body });
    },
    async upsert(rows) {
      if (!rows.length) return;
      await request('/rest/v1/records', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async fetchRows({ since, limit = PAGE, offset = 0, ownerId = null }) {
      const q = new URLSearchParams();
      q.set('select', 'store,key,payload,deleted,updated_at,synced_at');
      if (ownerId) q.set('user_id', `eq.${ownerId}`);
      if (since) q.set('synced_at', `gte.${since}`);
      q.set('order', 'synced_at.asc,store.asc,key.asc');
      q.set('limit', String(limit));
      if (offset) q.set('offset', String(offset));
      const rows = await request(`/rest/v1/records?${q.toString()}`);
      return Array.isArray(rows) ? rows : [];
    },
    async deleteAll() {
      if (!session?.user?.id) throw new Error('Not signed in.');
      await request(`/rest/v1/records?user_id=eq.${encodeURIComponent(session.user.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    },
  };
  return client;
}

// ---------- Sync engine ----------

export function createSync({ store, client, seedDocs = () => [], onStatus = () => {}, onChange = () => {}, now = Date.now, online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false) }) {
  const status = { configured: !!client?.configured, signedIn: !!client?.session, email: client?.email || null, syncing: false, pending: 0, lastSyncAt: null, lastError: null, online: online(), scope: null };
  let scope = null; // null = owner mode; { mode: 'member', ownerId, ownerName, memberName } = care-partner mode
  const ownerId = () => scope?.ownerId || client.userId;
  async function loadScope() {
    const meta = await store.get('meta', 'sync');
    scope = meta?.scope || null;
    status.scope = scope;
    return scope;
  }
  async function setScope(next) {
    const meta = (await store.get('meta', 'sync')) || { key: 'sync' };
    scope = next || null;
    status.scope = scope;
    await store.put('meta', { ...meta, key: 'sync', scope, cursor: null, backfilled_at: next ? new Date(now()).toISOString() : meta.backfilled_at });
    emit();
  }
  let running = false;
  let queued = false;
  let debounce = null;
  let interval = null;
  const listeners = [];
  const emit = () => onStatus({ ...status });

  async function refreshPending() {
    status.pending = await store.count('outbox');
  }

  async function enqueue(storeName, obj, opts = {}) {
    if (!shouldSync(storeName, obj)) return;
    await store.put('outbox', outboxEntry(storeName, obj, { ...opts, now: now() }));
    await refreshPending();
    emit();
    schedule();
  }

  async function enqueueMany(items, opts = {}) {
    const entries = items.filter((i) => shouldSync(i.store, i.obj)).map((i) => ({ store: 'outbox', obj: outboxEntry(i.store, i.obj, { ...opts, now: now() }) }));
    if (!entries.length) return;
    await store.bulkPut(entries);
    await refreshPending();
    emit();
    schedule();
  }

  function schedule(delay = 1500) {
    if (!status.configured || !client.session) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => syncNow({ reason: 'write' }), delay);
  }

  async function push() {
    const entries = await store.getAll('outbox');
    if (!entries.length) return 0;
    const rows = entries.map((e) => rowFromEntry(e, ownerId()));
    for (let i = 0; i < rows.length; i += 200) await client.upsert(rows.slice(i, i + 200));
    for (const e of entries) {
      const current = await store.get('outbox', e.id);
      if (current && current.queued_at === e.queued_at) await store.delete('outbox', e.id);
    }
    return entries.length;
  }

  /**
   * One-time per device: queue every local document that predates sync (or was written
   * while signed out before the outbox existed). Untouched seed rows are skipped — they are
   * deterministic on every device and uploading them could reopen a version another device closed.
   */
  async function backfill() {
    const meta = (await store.get('meta', 'sync')) || { key: 'sync' };
    if (meta.backfilled_at) return 0;
    const seeds = new Map((typeof seedDocs === 'function' ? seedDocs() : seedDocs).map((i) => [`${i.store}:${docKey(i.store, i.obj)}`, i.obj]));
    const pending = new Set((await store.getAll('outbox')).map((e) => e.id));
    const entries = [];
    for (const storeName of SYNCED_STORES) {
      for (const doc of await store.getAll(storeName)) {
        if (!shouldSync(storeName, doc)) continue;
        const id = `${storeName}:${docKey(storeName, doc)}`;
        if (pending.has(id)) continue;
        const seed = seeds.get(id);
        if (seed && same(seed, doc) && storeName !== 'meta') continue; // meta (profile, routine…) always goes up so partners and reminders see the owner's own values
        entries.push({ store: 'outbox', obj: outboxEntry(storeName, doc, { now: now() }) });
      }
    }
    if (entries.length) await store.bulkPut(entries);
    await store.put('meta', { ...meta, key: 'sync', backfilled_at: new Date(now()).toISOString(), backfilled: entries.length });
    return entries.length;
  }

  async function pull() {
    const meta = (await store.get('meta', 'sync')) || { key: 'sync' };
    let cursor = meta.cursor || null;
    let offset = 0;
    let applied = 0;
    for (let guard = 0; guard < 200; guard++) {
      const rows = await client.fetchRows({ since: cursor, limit: PAGE, offset, ownerId: ownerId() });
      if (!rows.length) break;
      const pending = new Map((await store.getAll('outbox')).map((e) => [e.id, e]));
      const localDocs = new Map();
      for (const r of rows) {
        const d = await store.get(r.store, r.key);
        if (d) localDocs.set(`${r.store}:${r.key}`, d);
      }
      const plan = planPull(rows, { localDocs, pending });
      if (plan.puts.length) await store.bulkPut(plan.puts);
      for (const d of plan.deletes) await store.delete(d.store, d.key);
      for (const id of plan.dropPending) await store.delete('outbox', id);
      applied += plan.puts.length + plan.deletes.length;
      const last = rows[rows.length - 1].synced_at;
      if (rows.length < PAGE) {
        cursor = last;
        break;
      }
      if (last === cursor) offset += PAGE;
      else {
        cursor = last;
        offset = 0;
      }
    }
    await store.put('meta', { ...meta, key: 'sync', cursor, pulled_at: new Date(now()).toISOString() });
    return applied;
  }

  async function syncNow({ reason = 'manual' } = {}) {
    if (!status.configured || !client.session) return { skipped: 'not signed in' };
    if (!online()) {
      status.online = false;
      emit();
      return { skipped: 'offline' };
    }
    if (running) {
      queued = true;
      return { skipped: 'busy' };
    }
    running = true;
    status.syncing = true;
    status.lastError = null;
    status.online = true;
    emit();
    try {
      await client.ensureFreshToken();
      await backfill();
      let applied = await pull();
      const pushed = await push();
      if (pushed) applied += await pull();
      status.lastSyncAt = new Date(now()).toISOString();
      const meta = (await store.get('meta', 'sync')) || { key: 'sync' };
      await store.put('meta', { ...meta, key: 'sync', last_sync_at: status.lastSyncAt });
      if (applied) await onChange({ applied, reason });
      return { applied, pushed };
    } catch (e) {
      status.lastError = e?.message || String(e);
      status.signedIn = !!client.session;
      status.email = client.email;
      return { error: status.lastError };
    } finally {
      running = false;
      status.syncing = false;
      await refreshPending();
      emit();
      if (queued) {
        queued = false;
        schedule(500);
      }
    }
  }

  async function afterSignIn() {
    status.signedIn = true;
    status.email = client.email;
    emit();
    return syncNow({ reason: 'sign-in' });
  }

  async function signOut() {
    stop();
    await client.signOut();
    status.signedIn = false;
    status.email = null;
    await setScope(null);
  }

  function start() {
    stop();
    if (!status.configured || !client.session) return;
    if (typeof window !== 'undefined') {
      const onOnline = () => syncNow({ reason: 'online' });
      const onVisible = () => {
        if (document.visibilityState === 'visible') syncNow({ reason: 'visible' });
      };
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisible);
      listeners.push(() => window.removeEventListener('online', onOnline), () => document.removeEventListener('visibilitychange', onVisible));
      interval = setInterval(() => {
        if (document.visibilityState === 'visible') syncNow({ reason: 'interval' });
      }, 60 * 1000);
    }
    syncNow({ reason: 'start' });
  }

  function stop() {
    clearTimeout(debounce);
    clearInterval(interval);
    for (const off of listeners.splice(0)) off();
  }

  async function resetCursor() {
    const meta = (await store.get('meta', 'sync')) || { key: 'sync' };
    await store.put('meta', { ...meta, key: 'sync', cursor: null });
  }

  loadScope().then(() => refreshPending()).then(emit);
  return { status, enqueue, enqueueMany, syncNow, start, stop, afterSignIn, signOut, resetCursor, backfill, setScope, loadScope, ownerId, client };
}
