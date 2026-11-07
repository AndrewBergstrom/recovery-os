// tests/fake-supabase.js — an in-memory stand-in for the few Supabase endpoints
// the app uses (Auth OTP + PostgREST on the `records` table), with the same
// last-write-wins rule the real trigger enforces.

export function createFakeSupabase({ otp = '123456' } = {}) {
  const users = new Map(); // email → user
  const sessions = new Map(); // access_token → { userId, refresh }
  const refreshTokens = new Map(); // refresh_token → userId
  const rows = new Map(); // `${userId}|${store}|${key}` → row
  let clock = 1;
  let tokenSeq = 1;
  const state = { calls: [], expireNext: false, lastLink: null };
  const linkTokens = new Map(); // token_hash → email
  const serverNow = () => new Date(1800000000000 + clock++ * 1000).toISOString();

  const json = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function newSession(user) {
    const access = `access-${tokenSeq++}`;
    const refresh = `refresh-${tokenSeq++}`;
    sessions.set(access, { userId: user.id, refresh });
    refreshTokens.set(refresh, user.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user };
  }

  async function fetchImpl(url, opts = {}) {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const auth = (opts.headers?.Authorization || '').replace('Bearer ', '');
    state.calls.push(`${method} ${u.pathname}`);
    if (opts.headers?.apikey !== 'anon-key') return json(401, { message: 'No API key found in request' });

    if (u.pathname === '/auth/v1/otp') {
      const t = `hash-${tokenSeq++}`;
      linkTokens.set(t, body.email);
      state.lastLink = `https://example.supabase.co/auth/v1/verify?token=${t}&type=magiclink&redirect_to=${encodeURIComponent(u.searchParams.get('redirect_to') || '')}`;
      return json(200, {});
    }
    if (u.pathname === '/auth/v1/verify') {
      if (body.token_hash) {
        const email = linkTokens.get(body.token_hash);
        if (!email) return json(403, { error_code: 'otp_expired', msg: 'Email link is invalid or has expired' });
        linkTokens.delete(body.token_hash); // single use
        const user = users.get(email) || { id: `user-${users.size + 1}`, email };
        users.set(email, user);
        return json(200, newSession(user));
      }
      if (body.token !== otp) return json(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      const user = users.get(body.email) || { id: `user-${users.size + 1}`, email: body.email };
      users.set(body.email, user);
      return json(200, newSession(user));
    }
    if (u.pathname === '/auth/v1/user') {
      const sess = sessions.get(auth);
      if (!sess) return json(401, { message: 'invalid JWT' });
      return json(200, [...users.values()].find((x) => x.id === sess.userId));
    }
    if (u.pathname === '/auth/v1/token') {
      const userId = refreshTokens.get(body.refresh_token);
      if (!userId) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      refreshTokens.delete(body.refresh_token);
      const user = [...users.values()].find((x) => x.id === userId);
      return json(200, newSession(user));
    }
    if (u.pathname === '/auth/v1/logout') return json(204, null);

    if (u.pathname === '/rest/v1/records') {
      if (state.expireNext) {
        state.expireNext = false;
        return json(401, { message: 'JWT expired' });
      }
      const sess = sessions.get(auth);
      if (!sess) return json(401, { message: 'JWT expired' });
      const userId = sess.userId;
      if (method === 'POST') {
        const stamp = serverNow(); // one statement → one now()
        for (const r of body) {
          const k = `${userId}|${r.store}|${r.key}`;
          const old = rows.get(k);
          if (old && r.updated_at < old.updated_at) continue; // trigger: older write loses
          rows.set(k, { ...r, user_id: userId, synced_at: stamp });
        }
        return json(201, null);
      }
      if (method === 'GET') {
        const since = (u.searchParams.get('synced_at') || '').replace(/^gte\./, '');
        const limit = Number(u.searchParams.get('limit') || 1000);
        const offset = Number(u.searchParams.get('offset') || 0);
        const list = [...rows.values()]
          .filter((r) => r.user_id === userId && (!since || r.synced_at >= since))
          .sort((a, b) => a.synced_at.localeCompare(b.synced_at) || a.store.localeCompare(b.store) || a.key.localeCompare(b.key))
          .slice(offset, offset + limit)
          .map(({ store, key, payload, deleted, updated_at, synced_at }) => ({ store, key, payload, deleted, updated_at, synced_at }));
        return json(200, list);
      }
      if (method === 'DELETE') {
        for (const [k, r] of rows) if (r.user_id === userId) rows.delete(k);
        return json(204, null);
      }
    }
    return json(404, { message: `not found: ${u.pathname}` });
  }

  const implicitHash = (email) => {
    const user = users.get(email) || { id: `user-${users.size + 1}`, email };
    users.set(email, user);
    const sess = newSession(user);
    return `#access_token=${sess.access_token}&expires_at=${sess.expires_at}&expires_in=3600&refresh_token=${sess.refresh_token}&token_type=bearer&type=magiclink`;
  };
  return { fetchImpl, rows, users, state, implicitHash, count: (userId) => [...rows.values()].filter((r) => r.user_id === userId).length };
}

/** Minimal localStorage stand-in. */
export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
