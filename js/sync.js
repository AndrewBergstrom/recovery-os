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
    async signInStart(email) {
      await request('/auth/v1/otp', { method: 'POST', auth: false, body: { email, create_user: true } });
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
    async upsert(rows) {
      if (!rows.length) return;
      await request('/rest/v1/records', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async fetchRows({ since, limit = PAGE, offset = 0 }) {
      const q = new URLSearchParams();
      q.set('select', 'store,key,payload,deleted,updated_at,synced_at');
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

export function createSync({ store, client, onStatus = () => {}, onChange = () => {}, now = Date.now, online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false) }) {
  const status = { configured: !!client?.configured, signedIn: !!client?.session, email: client?.email || null, syncing: false, pending: 0, lastSyncAt: null, lastError: null, online: online() };
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
    const rows = entries.map((e) => rowFromEntry(e, client.userId));
    for (let i = 0; i < rows.length; i += 200) await client.upsert(rows.slice(i, i + 200));
    for (const e of entries) {
      const current = await store.get('outbox', e.id);
      if (current && current.queued_at === e.queued_at) await store.delete('outbox', e.id);
    }
    return entries.length;
  }

  async function pull() {
    const meta = (await store.get('meta', 'sync')) || { key: 'sync' };
    let cursor = meta.cursor || null;
    let offset = 0;
    let applied = 0;
    for (let guard = 0; guard < 200; guard++) {
      const rows = await client.fetchRows({ since: cursor, limit: PAGE, offset });
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
    emit();
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

  refreshPending().then(emit);
  return { status, enqueue, enqueueMany, syncNow, start, stop, afterSignIn, signOut, resetCursor, client };
}
