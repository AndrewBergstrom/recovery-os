// views/more.js — settings, backup/restore, storage status, demo data, about.
// (Routed as #more: some embedding viewers reserve the #settings hash.)

import { el, chip, button, field, icon, openSheet, segmented, toast, confirmDialog } from '../ui.js';
import { TEXT_SIZES, THEMES } from '../prefs.js';
import { formatDateStr, isValidDateStr, DEFAULT_TZ } from '../time.js';
import { PRODUCT_BOUNDARY } from '../safety-rules.js';
import { SEED_VERSION } from '../seed.js';
import { isSample } from '../sample-data.js';
import { kv } from './shared.js';
import { syncCard } from './sync-ui.js';

export function renderMore(ctx) {
  const { state, actions } = ctx;
  const view = el('section', { class: 'view' });
  view.append(el('h1', { text: 'Settings & backup' }));
  view.append(syncCard(ctx));

  // Display
  const textSize = segmented(TEXT_SIZES.map((s) => ({ id: s, label: { small: 'Small', default: 'Default', large: 'Large', xl: 'Extra large' }[s] })), state.prefs.textSize, (v) => actions.setPref('textSize', v), { label: 'Text size' });
  const theme = segmented(THEMES.map((t) => ({ id: t, label: { auto: 'Match device', light: 'Light', dark: 'Dark (low-stimulation)' }[t] })), state.prefs.theme, (v) => actions.setPref('theme', v), { label: 'Appearance' });
  const motion = segmented([{ id: 'auto', label: 'Match device' }, { id: 'reduce', label: 'Reduce motion' }], state.prefs.motion || 'auto', (v) => actions.setPref('motion', v), { label: 'Motion' });
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'Display' }),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Text size' }), textSize.node),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Appearance' }), theme.node),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Motion' }), motion.node),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!state.prefs.lowEnergy, onchange: (e) => actions.setPref('lowEnergy', e.target.checked) }), el('span', { text: 'Low-energy mode (bigger text, one task at a time, fewer controls)' })),
      el('p', { class: 'muted small', text: 'Display preferences never change a clinical restriction.' })
    )
  );

  // Profile / care partner
  const partner = state.meta?.care_partner?.name || '';
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'You and your care partner' }),
      kv([
        ['Surgery', `${formatDateStr(state.profile.surgery_date, { month: 'long', day: 'numeric', year: 'numeric' })} · ${state.profile.surgical_side} ${state.profile.joint || 'knee'}`],
        ['Time zone', state.profile.timezone || DEFAULT_TZ],
        ['Care partner', partner || 'None set'],
      ]),
      el('div', { class: 'card-actions' }, button('Edit surgery details', { onClick: () => actions.openProfileEditor() }), button(partner ? 'Change care partner' : 'Add care partner', { onClick: () => openCarePartnerSheet(ctx) }), button('Daily routine (calendar times)', { onClick: () => actions.openRoutine() })),
      el('p', { class: 'muted small', text: 'A care partner can record an action for you when the phone is hard to use. Every entry keeps who entered it.' })
    )
  );

  // Storage
  const storageCard = el('div', { class: 'card' }, el('h2', { class: 'card-title', text: 'Storage on this device' }));
  const storageBody = el('div', { class: 'card-meta' }, el('span', { text: 'Checking…' }));
  storageCard.append(storageBody);
  storageCard.append(el('div', { class: 'card-actions' }, button('Ask the browser to keep this data', { onClick: () => actions.requestPersistence().then(() => fillStorage()) })));
  storageCard.append(el('p', { class: 'muted small', text: 'Browser storage can still be cleared or evicted. Export a backup regularly — it is the only copy that is truly yours.' }));
  view.append(storageCard);
  const fillStorage = async () => {
    const info = await actions.storageInfo();
    storageBody.replaceChildren(
      el('span', {}, el('strong', { text: 'Engine: ' }), info.kind === 'indexeddb' ? 'IndexedDB (on-device)' : `In-memory only — ${info.reason || 'storage unavailable'}`),
      el('span', {}, el('strong', { text: 'Persistent: ' }), info.persisted == null ? 'Unknown' : info.persisted ? 'Yes — the browser agreed not to evict it' : 'Not granted (data may be evicted under storage pressure)'),
      el('span', {}, el('strong', { text: 'Entries: ' }), `${state.events.length} total · last backup: ${state.meta?.last_export?.at ? formatDateStr(state.meta.last_export.at.slice(0, 10)) : 'never'}`),
      info.usage != null ? el('span', {}, el('strong', { text: 'Usage: ' }), `${Math.round(info.usage / 1024)} KB`) : null,
      el('span', {}, el('strong', { text: 'Offline: ' }), info.serviceWorker === 'active' ? 'App shell cached — works offline after the first visit' : info.serviceWorker === 'unsupported' ? 'Not available in this browser context (works when hosted over HTTPS or on localhost)' : 'Not cached yet')
    );
  };
  fillStorage();

  // Backup
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'Backup and export' }),
      el('p', { class: 'muted small', text: 'JSON is the complete, canonical record (orders, every entry, corrections, open questions). The visit summary is a readable Markdown digest generated from recorded facts only.' }),
      el('div', { class: 'btn-row' },
        button('Export JSON backup', { variant: 'primary', onClick: () => actions.exportJson() }),
        button('Export visit summary (Markdown)', { onClick: () => actions.exportSummary() }),
        button('Import backup', { onClick: () => actions.openImport() })
      )
    )
  );

  // Danger zone
  const sampleCount = state.events.filter(isSample).length;
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'Demo and reset' }),
      el('p', { class: 'muted small', text: 'Sample entries are clearly labelled, contain no medication doses, and can be removed in one tap.' }),
      el('div', { class: 'btn-row' },
        button('Load sample entries', { onClick: () => actions.loadSample() }),
        button(`Remove sample entries${sampleCount ? ` (${sampleCount})` : ''}`, { disabled: !sampleCount, onClick: () => actions.removeSample() })
      ),
      el('div', { class: 'btn-row' }, button('Erase all local data', { variant: 'danger-soft', onClick: () => actions.eraseAll() })),
      el('p', { class: 'muted small', text: 'Erasing removes everything on this device: orders, entries, questions, appointments and contacts. Export first. If sync is signed in, the cloud copy syncs back.' })
    )
  );

  // About
  view.append(
    el('div', { class: 'card' },
      el('h2', { class: 'card-title', text: 'About' }),
      kv([
        ['Version', `${ctx.appVersion} · Phase 1 (foundation)`],
        ['Care-plan seed', `v${SEED_VERSION}${state.meta?.activation ? ` · reviewed ${formatDateStr(state.meta.activation.activated_at.slice(0, 10))}` : ' · not yet reviewed'}`],
        ['Data', 'Stays on this device. No accounts, analytics, remote fonts or scripts.'],
      ]),
      el('p', { class: 'small', text: PRODUCT_BOUNDARY }),
      el('div', { class: 'card-actions' }, button('Review the care-plan seed again', { onClick: () => actions.openOnboarding() }))
    )
  );
  return view;
}

function openCarePartnerSheet(ctx) {
  const name = el('input', { type: 'text', value: ctx.state.meta?.care_partner?.name || '', placeholder: 'First name', autocomplete: 'off' });
  const consent = el('input', { type: 'checkbox', checked: !!ctx.state.meta?.care_partner?.consented });
  const sheet = openSheet({
    title: 'Care partner',
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const n = name.value.trim();
        if (n && !consent.checked) {
          toast('Tick the consent box to enable assisted logging');
          return;
        }
        await ctx.actions.putMeta({ key: 'care_partner', name: n || null, consented: n ? consent.checked : false, updated_at: new Date(ctx.now()).toISOString() });
        sheet.close('saved');
      } },
      field('Care partner’s name', name, { hint: 'Leave blank to remove.' }),
      el('label', { class: 'check' }, consent, el('span', { text: 'I (the patient) agree that this person may record entries for me. Each entry will show their name.' })),
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save', { variant: 'primary', type: 'submit' }))
    ),
  });
}

export function openProfileEditor(ctx) {
  const p = ctx.state.profile;
  const date = el('input', { type: 'date', value: p.surgery_date });
  const side = segmented([{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'both', label: 'Both' }], p.surgical_side, null, { label: 'Side' });
  const procedures = el('textarea', { value: (p.procedures || []).join('\n'), placeholder: 'One procedure per line' });
  const source = el('input', { type: 'text', value: p.source || '', placeholder: 'Where these details come from', autocomplete: 'off' });
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({
    title: 'Surgery details',
    content: el(
      'form',
      { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        errors.classList.add('hidden');
        try {
          if (!isValidDateStr(date.value)) throw new Error('Enter the surgery date.');
          const ok = await confirmDialog({ title: 'Update surgery details?', message: 'The day count, milestone dates and visit summary all derive from this. Existing entries are not changed.', confirmText: 'Update' });
          if (!ok) return;
          await ctx.actions.putMeta({ ...p, key: 'profile', surgery_date: date.value, surgical_side: side.value, procedures: procedures.value.split('\n').map((s) => s.trim()).filter(Boolean), source: source.value.trim(), updated_at: new Date(ctx.now()).toISOString() });
          sheet.close('saved');
        } catch (err) {
          errors.textContent = err.message;
          errors.classList.remove('hidden');
        }
      } },
      field('Surgery date', date, { required: true }),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Side' }), side.node),
      field('Procedures', procedures),
      field('Source', source),
      errors,
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save', { variant: 'primary', type: 'submit' }))
    ),
  });
}
