// views/shared.js — pieces reused across views: event rows, correction sheet,
// time pickers, export sheets.

import { el, chip, button, field, icon, openSheet, segmented, toast, copyText, downloadText, uid } from '../ui.js';
import { fromIso, formatTime, datetimeLocalValue, parseDatetimeLocal, describeWhen, DEFAULT_TZ } from '../time.js';
import { describeEvent, createCorrection, CORRECTION_REASONS, supersededIds } from '../events.js';
import { isSample } from '../sample-data.js';

export function statusChipFor(status) {
  const map = {
    needs_clinician_confirmation: ['Needs confirmation', 'warning'],
    needs_confirmation: ['Needs confirmation', 'warning'],
    needs_schedule_confirmation: ['Schedule needs confirmation', 'warning'],
    needs_prescriber_confirmation: ['Prescriber confirmation required', 'warning'],
    pending_clinician_confirmation: ['Pending clinician confirmation', 'warning'],
    planned: ['Planned', 'neutral'],
    confirmed: ['Confirmed', 'ok'],
    cleared: ['Cleared', 'ok'],
    resolved: ['Resolved', 'ok'],
    active: ['Active', 'neutral'],
    prn: ['As needed', 'neutral'],
  };
  const [text, tone] = map[status] || [String(status).replace(/_/g, ' '), 'muted'];
  return chip(text, tone);
}

/** A time picker: datetime-local plus quick "ago" chips. `get()` returns epoch ms or NaN. */
export function timePicker(ctx, initialMs, { label = 'When', hint } = {}) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const input = el('input', { type: 'datetime-local', value: datetimeLocalValue(initialMs, tz), max: datetimeLocalValue(ctx.now() + 60 * 60 * 1000, tz), step: '60' });
  const quick = el(
    'div',
    { class: 'segmented', 'aria-label': 'Quick time' },
    [
      ['Now', 0],
      ['15 min ago', 15],
      ['30 min ago', 30],
      ['1 h ago', 60],
      ['2 h ago', 120],
    ].map(([lbl, min]) =>
      el('button', { type: 'button', class: 'seg', onclick: () => {
        input.value = datetimeLocalValue(ctx.now() - min * 60000, tz);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } }, lbl)
    )
  );
  const node = el('div', { class: 'field' }, el('label', { class: 'field-label', for: (input.id = uid('time')) }, label), input, quick, hint ? el('p', { class: 'field-hint', text: hint }) : null);
  return { node, input, get: () => parseDatetimeLocal(input.value, tz) };
}

/** Who is entering this: the patient, or a named care partner (logs always keep the entrant). */
export function enteredBy(ctx) {
  const scope = ctx.state.sync?.scope;
  const memberMode = scope?.mode === 'member';
  const partner = memberMode ? scope.memberName : ctx.state.meta?.care_partner?.name;
  if (!partner) return { node: null, get: () => 'patient' };
  const seg = segmented(
    [
      { id: 'patient', label: memberMode ? `${scope.ownerName || 'Patient'} (patient)` : 'Me (patient)' },
      { id: partner, label: `${partner} (care partner)` },
    ],
    memberMode ? partner : 'patient',
    null,
    { label: 'Entered by' }
  );
  return { node: el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Entered by' }), seg.node), get: () => seg.value };
}

/** One row in an event list. */
export function eventRow(ctx, ev, { allowCorrect = true, showDate = false } = {}) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const byId = ctx.ordersById();
  const superseded = supersededIds(ctx.state.events).has(ev.id);
  const voided = ev.status === 'voided';
  const ms = fromIso(ev.occurred_at);
  const row = el('li', { class: `event-row${superseded ? ' is-superseded' : ''}${voided ? ' is-voided' : ''}` });
  row.append(el('span', { class: 'event-time', text: showDate ? describeWhen(ms, ctx.now(), tz) : formatTime(ms, tz) }));
  const text = el('div', { class: 'event-text' });
  const main = el('span', {}, voided ? `Voided: ${describeEvent(ev, byId, tz)}` : describeEvent(ev, byId, tz));
  if (isSample(ev)) main.append(chip('sample', 'muted'));
  if (ev.created_by && ev.created_by !== 'patient' && !isSample(ev)) main.append(chip(`entered by ${ev.created_by}`, 'muted'));
  if (ev.corrects) main.append(chip('correction', 'muted'));
  if (superseded) main.append(chip('corrected', 'muted'));
  text.append(main);
  if (ev.event_type === 'medication' && ev.pain != null) text.append(el('span', { class: 'event-note', text: `Pain ${ev.pain}/10 at the time` }));
  if (ev.notes) text.append(el('span', { class: 'event-note', text: ev.notes }));
  if (ev.correction_reason) text.append(el('span', { class: 'event-note', text: `Reason: ${CORRECTION_REASONS.find((r) => r.id === ev.correction_reason)?.label || ev.correction_reason}` }));
  row.append(text);
  if (allowCorrect && !superseded && !voided && !isSample(ev)) {
    row.append(button('Correct', { variant: 'ghost', cls: 'small', ariaLabel: `Correct entry: ${describeEvent(ev, byId, tz)}`, onClick: () => openCorrectionSheet(ctx, ev) }));
  } else row.append(el('span'));
  return row;
}

export function eventList(ctx, events, opts = {}) {
  if (!events.length) return el('p', { class: 'muted', text: opts.emptyText || 'Nothing recorded.' });
  return el('ul', { class: 'event-list' }, events.map((e) => eventRow(ctx, e, opts)));
}

/** Correct or void an entry. The original stays in the audit trail. */
export function openCorrectionSheet(ctx, original) {
  const tz = ctx.state.profile.timezone || DEFAULT_TZ;
  const byId = ctx.ordersById();
  const reasonSel = el('select', {}, el('option', { value: '', text: 'Choose a reason…' }), CORRECTION_REASONS.map((r) => el('option', { value: r.id, text: r.label })));
  const time = timePicker(ctx, fromIso(original.occurred_at), { label: 'Corrected time' });
  const qty = original.event_type === 'medication' ? el('input', { type: 'number', min: '0.25', step: '0.25', value: original.quantity }) : null;
  const note = el('textarea', { placeholder: 'What was wrong, in your words (optional)' });
  const editFields = el('div', { class: 'form' }, time.node, qty ? field('Corrected quantity', qty) : null);
  const errors = el('div', { class: 'error-box hidden' });
  const sheet = openSheet({ title: 'Correct an entry', content: null });
  const update = () => {
    const def = CORRECTION_REASONS.find((r) => r.id === reasonSel.value);
    editFields.classList.toggle('hidden', !def || def.voids);
  };
  reasonSel.addEventListener('change', update);
  const form = el(
    'form',
    { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      errors.classList.add('hidden');
      try {
        const def = CORRECTION_REASONS.find((r) => r.id === reasonSel.value);
        if (!def) throw new Error('Choose a reason for the correction.');
        const changes = {};
        if (!def.voids) {
          const ms = time.get();
          if (!Number.isFinite(ms)) throw new Error('Enter a valid time.');
          changes.occurred_ms = ms;
          if (qty) {
            const q = Number(qty.value);
            if (!(q > 0)) throw new Error('Quantity must be greater than zero.');
            const order = byId[original.medication_id];
            changes.quantity = q;
            changes.total_mg = order ? Math.round(order.strength_mg * q * 1000) / 1000 : original.strength_mg * q;
          }
        }
        const correction = createCorrection(original, changes, { reason: def.id, note: note.value.trim() || original.notes, nowMs: ctx.now(), tz });
        await ctx.actions.addEvent(correction, { toastText: def.voids ? 'Entry voided — original kept in the audit trail' : 'Correction recorded — original kept' });
        sheet.close('saved');
      } catch (err) {
        errors.textContent = err.message;
        errors.classList.remove('hidden');
      }
    } },
    el('div', { class: 'summary-box' }, el('span', { class: 'muted small', text: 'Original entry' }), el('strong', { text: `${describeWhen(fromIso(original.occurred_at), ctx.now(), tz)} — ${describeEvent(original, byId, tz)}` })),
    field('Reason', reasonSel, { required: true }),
    editFields,
    field('Note', note),
    errors,
    el('p', { class: 'muted small', text: 'Corrections never delete anything. The original stays visible as “corrected” in history and in exports.' }),
    el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button('Save correction', { variant: 'primary', type: 'submit' }))
  );
  update();
  sheet.setContent(form);
  return sheet;
}

/** Shows generated text with Copy and Download (downloads are blocked in some embedded viewers; Copy always works). */
export function openTextExportSheet({ title, filename, text, mime = 'application/json', note }) {
  const ta = el('textarea', { class: 'export-text', readOnly: true, value: text, 'aria-label': `${title} contents` });
  const sheet = openSheet({
    title,
    content: el(
      'div',
      { class: 'form' },
      note ? el('p', { class: 'muted small', text: note }) : null,
      el('div', { class: 'btn-row' },
        button('Copy', { variant: 'primary', icon: 'check', onClick: async () => toast((await copyText(text, ta)) ? 'Copied to clipboard' : 'Select the text and copy it manually') }),
        button(`Download ${filename}`, { onClick: () => toast(downloadText(filename, text, mime) ? 'Download started (if your browser allows downloads here)' : 'Download not available here — use Copy') })
      ),
      ta
    ),
  });
  return sheet;
}

export function sectionHeading(text, action = null) {
  return el('div', { class: 'section-head' }, el('h2', { class: 'section-title', text }), action);
}

export function kv(pairs) {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of pairs) {
    dl.append(el('dt', { text: k }));
    dl.append(el('dd', {}, v));
  }
  return dl;
}

export function iconFor(type) {
  return { medication: 'meds', exercise: 'move', ice_elevate: 'ice', checkin: 'pulse', note: 'note' }[type] || 'note';
}

export { icon };
