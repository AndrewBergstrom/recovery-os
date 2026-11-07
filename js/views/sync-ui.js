// views/sync-ui.js — sign-in with an emailed code, the Settings sync card, and the
// local configuration sheet. Nothing here touches clinical data directly.

import { el, chip, button, field, icon, openSheet, confirmDialog, toast } from '../ui.js';
import { relativeAgo, fromIso, DEFAULT_TZ } from '../time.js';
import { LOCAL_CONFIG_KEY } from '../sync.js';

export function readLocalConfig() {
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? { url: String(v.url || ''), anonKey: String(v.anonKey || '') } : null;
  } catch {
    return null;
  }
}

export function writeLocalConfig(cfg) {
  try {
    if (cfg) localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(LOCAL_CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

/** Email → 6-digit code → signed in. Works inside an installed PWA (no redirect needed). */
export function openSignInSheet(ctx, { onSignedIn } = {}) {
  const sync = ctx.sync;
  const email = el('input', { type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true });
  const code = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '8', placeholder: '6-digit code' });
  const errors = el('div', { class: 'error-box hidden', role: 'alert' });
  const showError = (m) => {
    errors.textContent = m;
    errors.classList.remove('hidden');
  };
  const sheet = openSheet({ title: 'Sign in to sync', content: null });
  let step = 1;
  const render = () => {
    errors.classList.add('hidden');
    if (step === 1) {
      sheet.setContent(
        el('form', { class: 'form', onsubmit: async (e) => {
          e.preventDefault();
          try {
            await sync.client.signInStart(email.value.trim());
            step = 2;
            render();
          } catch (err) {
            showError(err.message);
          }
        } },
          el('p', { class: 'muted', text: 'Enter the email for your Supabase-backed account. You will get a 6-digit code by email — no password, no link to tap.' }),
          field('Email', email, { required: true }),
          errors,
          el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Send code', { variant: 'primary', type: 'submit' }))
        )
      );
    } else {
      sheet.setContent(
        el('form', { class: 'form', onsubmit: async (e) => {
          e.preventDefault();
          try {
            await sync.client.signInVerify(email.value.trim(), code.value.trim());
            toast(`Signed in as ${email.value.trim()}`);
            sheet.close('signed-in');
            const r = await sync.afterSignIn();
            if (r?.error) toast(`Signed in, but sync failed: ${r.error}`);
            onSignedIn && onSignedIn(r);
          } catch (err) {
            showError(err.message);
          }
        } },
          el('p', { class: 'muted', text: `Code sent to ${email.value.trim()}. It expires after a few minutes.` }),
          field('Code', code, { required: true }),
          errors,
          el('div', { class: 'btn-row' }, button('Back', { icon: 'back', onClick: () => { step = 1; render(); } }), button('Verify', { variant: 'primary', type: 'submit' })),
          el('p', { class: 'muted small', text: 'If the email only shows a link instead of a code, the project’s "Magic Link" email template needs {{ .Token }} added — see supabase/README.md.' })
        )
      );
    }
  };
  render();
  return sheet;
}

export function openSyncConfigSheet(ctx) {
  const current = readLocalConfig();
  const url = el('input', { type: 'url', value: current?.url || '', placeholder: 'https://xxxx.supabase.co', autocomplete: 'off', spellcheck: 'false' });
  const key = el('input', { type: 'text', value: current?.anonKey || '', placeholder: 'anon public key (eyJ… or sb_publishable_…)', autocomplete: 'off', spellcheck: 'false' });
  const sheet = openSheet({
    title: 'Sync settings (this device)',
    content: el('form', { class: 'form', onsubmit: (e) => {
      e.preventDefault();
      const u = url.value.trim().replace(/\/+$/, '');
      const k = key.value.trim();
      if ((u && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(u)) || (u && !k) || (!u && k)) {
        toast('Enter both the project URL (https://xxxx.supabase.co) and the anon key, or clear both');
        return;
      }
      writeLocalConfig(u && k ? { url: u, anonKey: k } : null);
      sheet.close('saved');
      toast('Saved — reloading to apply');
      setTimeout(() => location.reload(), 600);
    } },
      el('p', { class: 'muted small', text: 'Normally these live in js/config.js so every device gets them. Entering them here overrides that on this device only. The anon key is public by design; row-level security keeps your rows private to your account.' }),
      field('Supabase project URL', url),
      field('Anon (public) key', key),
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save and reload', { variant: 'primary', type: 'submit' }))
    ),
  });
  return sheet;
}

/** The Settings card. Re-rendered whenever sync status changes. */
export function syncCard(ctx) {
  const { actions } = ctx;
  const st = ctx.state.sync || {};
  const card = el('div', { class: 'card', id: 'sync-card' });
  card.append(el('h2', { class: 'card-title' }, 'Sync across devices', syncChip(st)));
  if (!st.configured) {
    card.append(
      el('p', { class: 'muted small', text: 'Not configured: everything stays on this device. To sync phone ↔ laptop, create a free Supabase project, run supabase/schema.sql in its SQL editor, then put the project URL and anon key in js/config.js (or enter them here for this device).' }),
      el('div', { class: 'btn-row' }, button('Enter project URL and key', { onClick: () => openSyncConfigSheet(ctx) }))
    );
    return card;
  }
  if (!st.signedIn) {
    card.append(
      el('p', { class: 'muted small', text: 'Configured. Sign in with an emailed code to start syncing. Entries made while signed out are kept and pushed once you sign in.' }),
      st.pending ? el('p', { class: 'small', text: `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to sync.` }) : null,
      el('div', { class: 'btn-row' }, button('Sign in with email code', { variant: 'primary', onClick: () => openSignInSheet(ctx) }), button('Change project', { onClick: () => openSyncConfigSheet(ctx) }))
    );
    return card;
  }
  const meta = el('div', { class: 'card-meta' });
  meta.append(el('span', {}, el('strong', { text: 'Account: ' }), st.email || '—'));
  meta.append(el('span', {}, el('strong', { text: 'Last sync: ' }), st.lastSyncAt ? relativeAgo(fromIso(st.lastSyncAt), ctx.now()) : 'not yet'));
  meta.append(el('span', {}, el('strong', { text: 'Waiting to push: ' }), String(st.pending || 0)));
  if (!st.online) meta.append(el('span', { class: 'muted', text: 'Offline — will sync when the connection is back.' }));
  if (st.lastError) meta.append(el('span', { class: 'error-box', text: `Last error: ${st.lastError}` }));
  card.append(meta);
  card.append(
    el('div', { class: 'btn-row' },
      button(st.syncing ? 'Syncing…' : 'Sync now', { variant: 'primary', disabled: !!st.syncing, onClick: () => actions.syncNow() }),
      button('Sign out', { onClick: () => actions.signOut() })
    ),
    el('details', { class: 'plain' }, el('summary', { text: 'Danger zone' }),
      el('div', { class: 'details-body' },
        el('p', { class: 'muted small', text: 'Deletes every row for this account in your Supabase project. Devices that are still signed in will push their local copies back up unless you sign them out first.' }),
        el('div', { class: 'btn-row' }, button('Delete my cloud data', { variant: 'danger-soft', onClick: () => actions.deleteCloud() }))
      )
    ),
    el('p', { class: 'muted small', text: 'How it works: every entry is saved on this device first, then pushed to your project; other signed-in devices pull it on open and about once a minute. Entries never conflict (they are append-only); settings use last-write-wins.' })
  );
  return card;
}

export function syncChip(st) {
  if (!st?.configured) return chip('Off', 'muted');
  if (!st.signedIn) return chip('Signed out', 'warning');
  if (st.lastError) return chip('Error', 'danger');
  if (!st.online) return chip('Offline', 'muted');
  if (st.syncing) return chip('Syncing', 'neutral');
  if (st.pending) return chip(`${st.pending} pending`, 'warning');
  return chip('Synced', 'ok');
}

/** The small dot in the header. */
export function renderSyncDot(st) {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  if (!st?.configured) {
    dot.classList.add('hidden');
    return;
  }
  dot.classList.remove('hidden');
  const state = !st.signedIn ? 'off' : st.lastError ? 'error' : !st.online ? 'offline' : st.syncing ? 'syncing' : st.pending ? 'pending' : 'ok';
  dot.dataset.state = state;
  dot.setAttribute('aria-label', { off: 'Sync: signed out', error: `Sync error: ${st.lastError}`, offline: 'Sync: offline', syncing: 'Syncing', pending: `Sync: ${st.pending} pending`, ok: 'Synced' }[state]);
  dot.title = dot.getAttribute('aria-label');
}
