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
  const circle = new Map(); // care_circle rows by id
  const pushSubs = new Map(); // push_subscriptions by endpoint
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

    if (u.pathname === '/auth/v1/signup' && (!body || (!body.email && !body.password))) {
      const user = { id: `anon-${users.size + 1}`, email: null, is_anonymous: true };
      users.set(`anon:${user.id}`, user);
      return json(200, newSession(user));
    }
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

    const isMember = (uid, ownerId) => [...circle.values()].some((c) => c.owner_id === ownerId && c.member_id === uid && c.accepted_at && !c.revoked_at);
    if (u.pathname === '/rest/v1/rpc/accept_invite') {
      const sess = sessions.get(auth);
      if (!sess) return json(401, { message: 'not signed in' });
      const row = [...circle.values()].find((c) => c.invite_token === body.p_token && !c.revoked_at);
      if (!row) return json(400, { message: 'This invite link is invalid, already used or revoked' });
      Object.assign(row, { member_id: sess.userId, accepted_at: serverNow(), invite_token: null, member_name: body.p_name || row.member_name });
      const profile = rows.get(`${row.owner_id}|meta|profile`)?.payload || null;
      return json(200, [{ owner_id: row.owner_id, owner_name: row.owner_name, member_name: row.member_name, owner_profile: profile }]);
    }
    if (u.pathname === '/rest/v1/rpc/my_memberships') {
      const sess = sessions.get(auth);
      return json(200, [...circle.values()].filter((c) => c.member_id === sess?.userId && c.accepted_at && !c.revoked_at).map((c) => ({ owner_id: c.owner_id, owner_name: c.owner_name, member_name: c.member_name })));
    }
    if (u.pathname === '/rest/v1/care_circle') {
      const sess = sessions.get(auth);
      if (!sess) return json(401, { message: 'not signed in' });
      if (method === 'POST') {
        const row = { id: `cc-${circle.size + 1}`, invited_at: serverNow(), accepted_at: null, revoked_at: null, member_id: null, ...body, owner_id: sess.userId };
        circle.set(row.id, row);
        return json(201, [row]);
      }
      const idFilter = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      if (method === 'PATCH') {
        const row = circle.get(idFilter);
        if (!row || row.owner_id !== sess.userId) return json(200, []);
        Object.assign(row, body);
        return json(200, [row]);
      }
      if (method === 'GET') return json(200, [...circle.values()].filter((c) => c.owner_id === sess.userId || c.member_id === sess.userId));
    }
    if (u.pathname === '/rest/v1/push_subscriptions') {
      const sess = sessions.get(auth);
      if (!sess) return json(401, { message: 'not signed in' });
      if (method === 'POST') {
        for (const r of body) {
          if (r.owner_id !== sess.userId && !isMember(sess.userId, r.owner_id)) return json(403, { message: 'row-level security' });
          pushSubs.set(r.endpoint, { id: `ps-${pushSubs.size + 1}`, ...r, subscriber_id: sess.userId });
        }
        return json(201, [...pushSubs.values()].filter((r) => body.some((b) => b.endpoint === r.endpoint)));
      }
      const ep = decodeURIComponent((u.searchParams.get('endpoint') || '').replace(/^eq\./, ''));
      if (method === 'DELETE') {
        pushSubs.delete(ep);
        return json(204, null);
      }
      if (method === 'PATCH') {
        const row = pushSubs.get(ep);
        if (row) Object.assign(row, body);
        return json(200, row ? [row] : []);
      }
      if (method === 'GET') return json(200, [...pushSubs.values()].filter((r) => r.subscriber_id === sess.userId && (!ep || r.endpoint === ep)));
    }
    if (u.pathname === '/rest/v1/records') {
      if (state.expireNext) {
        state.expireNext = false;
        return json(401, { message: 'JWT expired' });
      }
      const sess = sessions.get(auth);
      if (!sess) return json(401, { message: 'JWT expired' });
      const userId = sess.userId;
      const canAccess = (ownerId) => ownerId === userId || isMember(userId, ownerId);
      if (method === 'POST') {
        const stamp = serverNow(); // one statement → one now()
        for (const r of body) {
          const target = r.user_id || userId;
          if (!canAccess(target)) return json(403, { message: 'new row violates row-level security policy' });
          const k = `${target}|${r.store}|${r.key}`;
          const old = rows.get(k);
          if (old && r.updated_at < old.updated_at) continue; // trigger: older write loses
          rows.set(k, { ...r, user_id: target, synced_at: stamp });
        }
        return json(201, null);
      }
      if (method === 'GET') {
        const since = (u.searchParams.get('synced_at') || '').replace(/^gte\./, '');
        const limit = Number(u.searchParams.get('limit') || 1000);
        const offset = Number(u.searchParams.get('offset') || 0);
        const ownerFilter = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const list = [...rows.values()]
          .filter((r) => (ownerFilter ? r.user_id === ownerFilter : r.user_id === userId) && canAccess(r.user_id) && (!since || r.synced_at >= since))
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
  return { fetchImpl, rows, users, circle, pushSubs, state, implicitHash, count: (userId) => [...rows.values()].filter((r) => r.user_id === userId).length };
}

/** Minimal localStorage stand-in. */
export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
