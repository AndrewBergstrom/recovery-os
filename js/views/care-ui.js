// views/care-ui.js — care circle (invite / accept / member mode) and push reminders UI.

import { el, chip, button, field, icon, openSheet, confirmDialog, toast, copyText } from '../ui.js';
import { APP_URL } from '../config.js';
import { formatDateStr, relativeAgo, fromIso, DEFAULT_TZ } from '../time.js';
import { pushSupported, isStandalone, isIos, currentSubscription, enablePush, disablePush, updatePrefs, loadPrefs, sendTest } from '../push.js';
import { DEFAULT_PREFS } from '../reminders-due.js';

export function inviteToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function inviteLink(token) {
  const base = (typeof location !== 'undefined' && /^https?:/.test(location.origin) && !/localhost|127\.0\.0\.1/.test(location.host) ? `${location.origin}${location.pathname}` : APP_URL).replace(/index\.html$/, '');
  return `${base}#invite=${token}`;
}

// ---------- Owner: care partners card ----------

export function careCircleCard(ctx) {
  const { actions } = ctx;
  const st = ctx.state.sync || {};
  const card = el('div', { class: 'card', id: 'care-card' });
  card.append(el('h2', { class: 'card-title', text: 'Care partners' }));
  if (!st.configured || !st.signedIn) {
    card.append(el('p', { class: 'muted small', text: 'Sign in to sync first; then you can invite a care partner. They get their own login, see everything, can log for you (entries show their name) and can receive reminders.' }));
    return card;
  }
  const list = el('div', { class: 'list' }, el('p', { class: 'muted small', text: 'Loading…' }));
  card.append(list);
  card.append(el('div', { class: 'btn-row' }, button('Invite a care partner', { variant: 'primary', icon: 'plus', onClick: () => openInviteSheet(ctx, () => fill()) })));
  card.append(el('p', { class: 'muted small', text: 'An invite link signs the person in on their phone and connects them to your recovery. Links are single-use; you can revoke access any time.' }));
  const fill = async () => {
    try {
      const rows = await ctx.sync.client.select('care_circle', `select=*&owner_id=eq.${ctx.sync.client.userId}&order=invited_at.asc`);
      list.replaceChildren();
      if (!rows.length) list.append(el('p', { class: 'muted small', text: 'No care partners yet.' }));
      for (const r of rows) {
        const status = r.revoked_at ? 'revoked' : r.accepted_at ? 'active' : 'invited';
        const row = el('div', { class: 'row-between' });
        row.append(el('div', {}, el('strong', { text: r.member_name }), ' ', chip(status === 'active' ? 'Active' : status === 'invited' ? 'Invite pending' : 'Revoked', status === 'active' ? 'ok' : status === 'invited' ? 'warning' : 'muted'), el('div', { class: 'muted small', text: status === 'active' ? `Joined ${formatDateStr(r.accepted_at.slice(0, 10))}${r.member_email ? ` · ${r.member_email}` : ''}` : status === 'invited' ? 'Waiting for them to open the link' : `Revoked ${formatDateStr(r.revoked_at.slice(0, 10))}` })));
        const btns = el('div', { class: 'btn-row' });
        if (status === 'invited' && r.invite_token) btns.append(button('Copy link', { cls: 'small', onClick: async () => toast((await copyText(inviteLink(r.invite_token))) ? 'Invite link copied' : 'Could not copy — open the invite to see the link') }), button('Show link', { cls: 'small', variant: 'ghost', onClick: () => showLinkSheet(ctx, r) }));
        if (status !== 'revoked') btns.append(button('New link', { cls: 'small', variant: 'ghost', onClick: async () => { await actions.regenerateInvite(r); fill(); } }), button('Revoke', { cls: 'small', variant: 'ghost', onClick: async () => { if (await confirmDialog({ title: `Revoke ${r.member_name}'s access?`, message: 'They lose access to your recovery immediately. Entries they already logged stay in your record.', confirmText: 'Revoke', danger: true })) { await actions.revokeMember(r); fill(); } } }));
        if (status === 'revoked') btns.append(button('Remove', { cls: 'small', variant: 'ghost', onClick: async () => { if (await confirmDialog({ title: `Remove ${r.member_name} from the list?`, message: 'Deletes this revoked invite. Entries they logged stay in your record.', confirmText: 'Remove' })) { await actions.removeMember(r); fill(); } } }));
        row.append(btns);
        list.append(row);
      }
    } catch (e) {
      list.replaceChildren(el('div', { class: 'error-box', text: `Could not load care partners: ${e.message}` }));
    }
  };
  fill();
  return card;
}

function showLinkSheet(ctx, row) {
  const link = inviteLink(row.invite_token);
  const ta = el('textarea', { class: 'export-text', readOnly: true, value: link, rows: '3' });
  const sheet = openSheet({
    title: `Invite link for ${row.member_name}`,
    content: el('div', { class: 'form' },
      el('p', { class: 'muted small', text: 'Text or message this link to them. Opening it on their phone signs them in and connects them to your recovery. Single-use — ask for a new one if it has been used or lost.' }),
      ta,
      el('div', { class: 'btn-row' }, button('Copy', { variant: 'primary', onClick: async () => toast((await copyText(link, ta)) ? 'Copied' : 'Select the text and copy it') }), typeof navigator !== 'undefined' && navigator.share ? button('Share…', { onClick: () => navigator.share({ title: 'Recovery OS invite', text: `Help with my recovery in Recovery OS: ${link}` }).catch(() => {}) }) : null),
      el('div', { class: 'btn-row' }, button('Close', { onClick: () => sheet.close('close') }))
    ),
  });
}

export function openInviteSheet(ctx, onDone) {
  const name = el('input', { type: 'text', placeholder: 'Their name, e.g. Lindsay', autocomplete: 'off', required: true });
  const email = el('input', { type: 'email', placeholder: 'Optional, just for your records', autocomplete: 'off' });
  const me = el('input', { type: 'text', placeholder: 'How they know you, e.g. Andrew', autocomplete: 'off', value: ctx.state.meta?.owner_name?.name || '', required: true });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: 'Invite a care partner',
    content: el('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errors.classList.add('hidden');
      try {
        const row = await ctx.actions.createInvite({ member_name: name.value.trim(), member_email: email.value.trim(), owner_name: me.value.trim() });
        sheet.close('created');
        showLinkSheet(ctx, row);
        onDone && onDone(row);
      } catch (err) {
        errors.textContent = err.message;
        errors.classList.remove('hidden');
      }
    } },
      el('p', { class: 'muted small', text: 'They will be able to see your calendar, medications, movement and plan, log entries on your behalf (every entry shows who entered it) and turn on reminders for themselves.' }),
      field('Their name', name, { required: true }),
      field('Their email', email),
      field('Your name, as shown to them', me, { required: true }),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Create invite link', { variant: 'primary', type: 'submit' }))
    ),
  });
}

// ---------- Member: accept screen and banner ----------

export function renderAcceptInvite(ctx, { token, onAccepted }) {
  const { sync } = ctx;
  const name = el('input', { type: 'text', placeholder: 'Your first name', autocomplete: 'given-name', required: true });
  const errors = el('div', { class: 'error-box hidden', role: 'alert' });
  const busy = el('p', { class: 'muted small hidden', text: 'Connecting…' });
  const wrap = el('section', { class: 'view onboarding' });
  wrap.append(el('h1', { text: 'You’ve been invited to help with a recovery' }));
  if (!sync?.client?.configured) {
    wrap.append(el('div', { class: 'error-box', text: 'Sync is not configured in this build, so the invite cannot be accepted here.' }));
    return wrap;
  }
  if (sync.client.session && !sync.client.isAnonymous && !sync.status.scope) {
    wrap.append(el('div', { class: 'banner banner-warning' }, icon('alert'), el('span', { text: 'This browser is signed in as the recovery owner. Open the invite link on the care partner’s own phone instead.' })), el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-primary', href: '#today', text: 'Back to the app' })));
    return wrap;
  }
  wrap.append(
    el('div', { class: 'card' },
      el('p', { text: 'Accepting connects this phone to their Recovery OS: you will see their calendar and medications, can log entries for them (each one shows your name), and can turn on reminders for yourself.' }),
      el('p', { class: 'muted small', text: 'No password or email is needed — this link signs you in on this device. Keep the app installed on your home screen so the sign-in stays.' })
    ),
    el('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errors.classList.add('hidden');
      busy.classList.remove('hidden');
      try {
        const result = await ctx.actions.acceptInvite({ token, name: name.value.trim() });
        onAccepted && onAccepted(result);
      } catch (err) {
        errors.textContent = err.message;
        errors.classList.remove('hidden');
      } finally {
        busy.classList.add('hidden');
      }
    } },
      field('Your name', name, { required: true, hint: 'Shown on entries you log.' }),
      errors,
      busy,
      el('div', { class: 'btn-row' }, button('Accept and connect', { variant: 'primary', cls: 'btn-large', type: 'submit' }))
    )
  );
  return wrap;
}

export function memberBanner(ctx) {
  const scope = ctx.state.sync?.scope;
  if (!scope || scope.mode !== 'member') return null;
  return el('div', { class: 'banner banner-info banner-compact' }, icon('calm'), el('span', {}, el('strong', { text: `Care partner view · ${scope.ownerName ? `${scope.ownerName}’s` : 'their'} recovery` }), ` · your entries are logged as ${scope.memberName}`));
}

// ---------- Reminders card (owner or member) ----------

export function remindersCard(ctx) {
  const st = ctx.state.sync || {};
  const card = el('div', { class: 'card', id: 'reminders-card' });
  card.append(el('h2', { class: 'card-title', text: 'Reminders on this device' }));
  if (!st.configured || !st.signedIn) {
    card.append(el('p', { class: 'muted small', text: 'Sign in to sync first. Reminders are push notifications sent by your Supabase project when a pill on the calendar comes due.' }));
    return card;
  }
  if (!pushSupported()) {
    card.append(el('p', { class: 'muted small', text: isIos() && !isStandalone() ? 'On iPhone: add Recovery OS to the Home Screen (Share → Add to Home Screen), open it from there, and this card will let you turn reminders on.' : 'This browser does not support push notifications.' }));
    return card;
  }
  const body = el('div', { class: 'form' }, el('p', { class: 'muted small', text: 'Checking…' }));
  card.append(body);
  const scope = st.scope;
  const isOwner = !scope || scope.mode !== 'member';
  const render = async () => {
    let existing = null;
    try {
      existing = await loadPrefs({ client: ctx.sync.client });
    } catch {
      existing = null;
    }
    const sub = await currentSubscription();
    const prefs = { ...DEFAULT_PREFS, ...(existing?.prefs || {}) };
    const toggles = [
      ['meds', 'Medications (scheduled)'],
      ['exercise', 'Exercise sessions (cleared exercises)'],
      ['ice', 'Ice + elevate sessions'],
      ...(isOwner ? [] : [['missed', `Nudge me when something is not logged ${60} min after its time`]]),
    ];
    const inputs = {};
    const quietFrom = el('input', { type: 'time', value: prefs.quiet_from || '22:00' });
    const quietTo = el('input', { type: 'time', value: prefs.quiet_to || '07:00' });
    const getPrefs = () => ({ ...prefs, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.checked])), quiet_from: quietFrom.value, quiet_to: quietTo.value });
    body.replaceChildren(
      el('p', { class: 'small' }, el('strong', { text: sub && existing ? `On · ${existing.device || 'this device'}` : 'Off' }), sub && existing ? '' : ' — notifications arrive only while reminders are on for this device.'),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Remind me about' }), toggles.map(([k, label]) => { inputs[k] = el('input', { type: 'checkbox', checked: prefs[k] !== false }); return el('label', { class: 'check' }, inputs[k], el('span', { text: label })); })),
      el('div', { class: 'inline-fields' }, field('Quiet from', quietFrom), field('Quiet until', quietTo)),
      el('div', { class: 'btn-row' },
        button(sub && existing ? 'Save' : 'Turn reminders on', { variant: 'primary', onClick: async () => { try { if (sub && existing) await updatePrefs({ client: ctx.sync.client, prefs: getPrefs() }); else await enablePush({ client: ctx.sync.client, ownerId: ctx.sync.ownerId(), subscriberName: isOwner ? 'patient' : scope.memberName, prefs: getPrefs() }); toast('Reminders saved'); render(); } catch (e) { toast(e.message, { duration: 6000 }); } } }),
        sub && existing ? button('Send a test', { onClick: async () => { try { const r = await sendTest({ client: ctx.sync.client }); toast(r?.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}` : `Function replied: ${JSON.stringify(r).slice(0, 80)}`); } catch (e) { toast(`Test failed: ${e.message}`, { duration: 6000 }); } } }) : null,
        sub && existing ? button('Turn off', { variant: 'ghost', onClick: async () => { await disablePush({ client: ctx.sync.client }); toast('Reminders off on this device'); render(); } }) : null
      ),
      el('p', { class: 'muted small', text: 'Reminders are a prompt to check the calendar; they never record a dose. Sent about once per pill, within five minutes of its time, outside quiet hours.' })
    );
  };
  render();
  return card;
}
