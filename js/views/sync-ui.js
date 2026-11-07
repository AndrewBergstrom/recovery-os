// views/sync-ui.js — sign-in with an emailed code, the Settings sync card, and the
// local configuration sheet. Nothing here touches clinical data directly.

import { el, chip, button, field, icon, openSheet, confirmDialog, toast, append } from '../ui.js';
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
  const link = el('textarea', { placeholder: 'Paste the whole sign-in link here', rows: '3', autocomplete: 'off', spellcheck: 'false' });
  const sheet = openSheet({ title: 'Sign in to sync', content: null });
  const finish = async (label) => {
    toast(`Signed in as ${label}`);
    sheet.close('signed-in');
    const r = await sync.afterSignIn();
    if (r?.error) toast(`Signed in, but sync failed: ${r.error}`);
    onSignedIn && onSignedIn(r);
  };
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  let step = 1;
  const render = () => {
    errors.classList.add('hidden');
    if (step === 1) {
      sheet.setContent(
        el('form', { class: 'form', onsubmit: async (e) => {
          e.preventDefault();
          try {
            await sync.client.signInStart(email.value.trim(), { redirectTo: `${location.origin}${location.pathname}` });
            step = 2;
            render();
          } catch (err) {
            showError(err.message);
          }
        } },
          el('p', { class: 'muted', text: 'Enter your email. You will get a sign-in email — no password.' }),
          field('Email', email, { required: true }),
          errors,
          el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Send sign-in email', { variant: 'primary', type: 'submit' }))
        )
      );
    } else {
      sheet.setContent(
        el('div', { class: 'form' },
          el('p', { class: 'muted', text: `Email sent to ${email.value.trim()}. It expires after a few minutes. Three ways to finish:` }),
          el('div', { class: 'summary-box' }, el('strong', { text: standalone ? '1. On this installed app: copy the link' : '1. Tap the link in the email' }), el('span', { class: 'small', text: standalone ? 'A tapped link opens in the browser, not in this home-screen app. Instead, long-press the link in the email → Copy, then paste it below.' : 'This page picks up the sign-in automatically when the link opens here.' })),
          el('form', { class: 'form', onsubmit: async (e) => {
            e.preventDefault();
            try {
              await sync.client.signInVerifyLink(link.value);
              await finish(email.value.trim());
            } catch (err) {
              showError(err.message);
            }
          } },
            field(standalone ? 'Paste the sign-in link' : '2. Or paste the sign-in link', link),
            el('div', { class: 'btn-row' }, button('Sign in with pasted link', { variant: 'primary', type: 'submit' }))
          ),
          el('form', { class: 'form', onsubmit: async (e) => {
            e.preventDefault();
            try {
              await sync.client.signInVerify(email.value.trim(), code.value.trim());
              await finish(email.value.trim());
            } catch (err) {
              showError(err.message);
            }
          } },
            field(standalone ? 'Or enter the code, if the email shows one' : '3. Or enter the code, if the email shows one', code),
            el('div', { class: 'btn-row' }, button('Verify code', { type: 'submit' }))
          ),
          errors,
          el('div', { class: 'btn-row' }, button('Back', { icon: 'back', onClick: () => { step = 1; render(); } }), button('Resend email', { variant: 'ghost', onClick: async () => { try { await sync.client.signInStart(email.value.trim(), { redirectTo: `${location.origin}${location.pathname}` }); toast('Sent again'); } catch (err) { showError(err.message); } } })),
          el('p', { class: 'muted small', text: 'The default Supabase email carries a link only; a code appears once the project uses custom SMTP with {{ .Token }} in the template (see supabase/README.md). Links are single-use.' })
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
    append(card, [
      el('p', { class: 'muted small', text: 'Not configured: everything stays on this device. To sync phone ↔ laptop, create a free Supabase project, run supabase/schema.sql in its SQL editor, then put the project URL and anon key in js/config.js (or enter them here for this device).' }),
      el('div', { class: 'btn-row' }, button('Enter project URL and key', { onClick: () => openSyncConfigSheet(ctx) })),
    ]);
    return card;
  }
  if (!st.signedIn) {
    append(card, [
      el('p', { class: 'muted small', text: 'Configured. Sign in with an emailed link (or code) to start syncing. Entries made while signed out are kept and pushed once you sign in.' }),
      st.pending ? el('p', { class: 'small', text: `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to sync.` }) : null,
      el('div', { class: 'btn-row' }, button('Sign in with email', { variant: 'primary', onClick: () => openSignInSheet(ctx) }), button('Change project', { onClick: () => openSyncConfigSheet(ctx) })),
    ]);
    return card;
  }
  const meta = el('div', { class: 'card-meta' });
  if (st.scope?.mode === 'member') meta.append(el('span', {}, el('strong', { text: 'Care partner: ' }), `${st.scope.memberName} · connected to ${st.scope.ownerName || 'their'} recovery`));
  else meta.append(el('span', {}, el('strong', { text: 'Account: ' }), st.email || (st.signedIn ? 'signed in' : '—')));
  meta.append(el('span', {}, el('strong', { text: 'Last sync: ' }), st.lastSyncAt ? relativeAgo(fromIso(st.lastSyncAt), ctx.now()) : 'not yet'));
  meta.append(el('span', {}, el('strong', { text: 'Waiting to push: ' }), String(st.pending || 0)));
  if (!st.online) meta.append(el('span', { class: 'muted', text: 'Offline — will sync when the connection is back.' }));
  if (st.lastError) meta.append(el('span', { class: 'error-box', text: `Last error: ${st.lastError}` }));
  card.append(meta);
  append(card, [
    el('div', { class: 'btn-row' },
      button(st.syncing ? 'Syncing…' : 'Sync now', { variant: 'primary', disabled: !!st.syncing, onClick: () => actions.syncNow() }),
      button(st.scope?.mode === 'member' ? 'Leave care circle' : 'Sign out', { onClick: () => actions.signOut() })
    ),
    st.scope?.mode === 'member' ? null : el('details', { class: 'plain' }, el('summary', { text: 'Danger zone' }),
      el('div', { class: 'details-body' },
        el('p', { class: 'muted small', text: 'Deletes every row for this account in your Supabase project. Devices that are still signed in will push their local copies back up unless you sign them out first.' }),
        el('div', { class: 'btn-row' }, button('Delete my cloud data', { variant: 'danger-soft', onClick: () => actions.deleteCloud() }))
      )
    ),
    el('p', { class: 'muted small', text: 'How it works: every entry is saved on this device first, then pushed to your project; other signed-in devices pull it on open and about once a minute. Entries never conflict (they are append-only); settings use last-write-wins.' }),
  ]);
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
