// app.js — boot, state, routing and the actions views call. No frameworks.

import { openStore, deleteDatabase } from './db.js';
import { loadPrefs, savePrefs, applyPrefs, markHadData, hadData, clearHadData } from './prefs.js';
import { seedItems, SEED_VERSION, orderKey } from './seed.js';
import { el, icon, toast, closeAllSheets, confirmDialog, openSheet, button, field } from './ui.js';
import { nowMs, toIso, daysSinceSurgery, dayLabel, DEFAULT_TZ } from './time.js';
import { validateEvent, sortByOccurred } from './events.js';
import { ordersById } from './medications.js';
import { buildExport, validateExport, diffImport, applyImport, parseBackupText, buildVisitSummary } from './export-import.js';
import { sampleEvents, isSample } from './sample-data.js';
import { ESCALATION_TEXT } from './safety-rules.js';
import { renderCalendar, openRoutineSheet } from './views/calendar.js';
import { renderMedications } from './views/medications.js';
import { renderMovement } from './views/movement.js';
import { renderProgress } from './views/progress.js';
import { renderPlan } from './views/plan.js';
import { renderMore, openProfileEditor } from './views/more.js';
import { renderOnboarding } from './views/onboarding.js';
import { openQuickLog } from './views/quick-log.js';
import { openTextExportSheet } from './views/shared.js';

export const APP_VERSION = '0.2.1';

const ROUTES = {
  today: { label: 'Calendar', icon: 'plan', render: renderCalendar },
  medications: { label: 'Meds', icon: 'meds', render: renderMedications },
  movement: { label: 'Movement', icon: 'move', render: renderMovement },
  progress: { label: 'Progress', icon: 'progress', render: renderProgress },
  plan: { label: 'Plan', icon: 'note', render: renderPlan },
  more: { label: 'Settings', icon: 'more', render: renderMore, hidden: true },
};

const state = {
  prefs: loadPrefs(),
  profile: null,
  meta: {},
  orders: [],
  events: [],
  questions: [],
  milestones: [],
  appointments: [],
  contacts: [],
  slotStates: [],
  ui: {},
  storeVolatile: false,
  dataLossSuspected: false,
  swStatus: 'unsupported',
};
let store = null;
let onboarding = false;

const ctx = {
  state,
  appVersion: APP_VERSION,
  now: nowMs,
  ordersById: () => ordersById(state.orders),
  actions: {},
};

// ---------- Persistence helpers ----------
async function loadState() {
  const [events, orders, questions, milestones, appointments, contacts, metaRows, slotStates] = await Promise.all(
    ['events', 'orders', 'questions', 'milestones', 'appointments', 'contacts', 'meta', 'slot_states'].map((s) => store.getAll(s))
  );
  const bySeedOrder = (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.id).localeCompare(String(b.id)) || (a.version || 1) - (b.version || 1);
  state.events = sortByOccurred(events, 'asc');
  state.orders = [...orders].sort(bySeedOrder);
  state.questions = [...questions].sort(bySeedOrder);
  state.milestones = milestones;
  state.appointments = appointments;
  state.contacts = contacts;
  state.slotStates = slotStates;
  state.meta = Object.fromEntries(metaRows.map((m) => [m.key, m]));
  state.profile = state.meta.profile || null;
}

async function ensureSeed() {
  const seed = await store.get('meta', 'seed');
  if (seed && seed.version >= SEED_VERSION) return;
  await store.bulkPut(seedItems(toIso(nowMs())));
}

// ---------- Rendering ----------
function currentRoute() {
  const name = (location.hash || '#today').replace(/^#\/?/, '').toLowerCase();
  return ROUTES[name] ? name : 'today';
}

function renderNav() {
  const nav = document.getElementById('app-nav');
  const route = currentRoute();
  nav.replaceChildren(
    ...Object.entries(ROUTES)
      .filter(([, r]) => !r.hidden)
      .map(([name, r]) => el('a', { class: 'nav-item', href: `#${name}`, 'aria-current': route === name ? 'page' : null }, icon(r.icon), el('span', { text: r.label })))
  );
  const more = document.getElementById('more-link');
  if (more && !more.childElementCount) more.append(icon('more'));
  if (more) more.setAttribute('aria-current', route === 'more' ? 'page' : 'false');
}

function renderHeader() {
  const dayEl = document.getElementById('brand-day');
  if (!dayEl || !state.profile) return;
  dayEl.textContent = dayLabel(daysSinceSurgery(state.profile.surgery_date, nowMs(), state.profile.timezone || DEFAULT_TZ));
}

function render() {
  const main = document.getElementById('main');
  renderHeader();
  renderNav();
  main.setAttribute('aria-busy', 'false');
  if (onboarding || !state.meta.activation) {
    onboarding = true;
    document.getElementById('app-nav').classList.add('hidden');
    main.replaceChildren(renderOnboarding(ctx, { onDone: activate }));
    return;
  }
  document.getElementById('app-nav').classList.remove('hidden');
  const route = currentRoute();
  main.replaceChildren(ROUTES[route].render(ctx));
}

async function refresh() {
  await loadState();
  render();
}

async function activate() {
  await store.put('meta', { key: 'activation', activated_at: toIso(nowMs()), reviewed_seed_version: SEED_VERSION, app_version: APP_VERSION });
  onboarding = false;
  state.dataLossSuspected = false;
  markHadData();
  await refresh();
  if (location.hash !== '#today') location.hash = '#today';
  toast('Recovery OS is ready. One thing at a time.');
}

// ---------- Actions ----------
Object.assign(ctx.actions, {
  navigate(route) {
    location.hash = `#${route}`;
  },
  refresh,
  openQuickLog(initial) {
    return openQuickLog(ctx, initial);
  },
  openProfileEditor() {
    return openProfileEditor(ctx);
  },
  openOnboarding() {
    onboarding = true;
    closeAllSheets();
    render();
  },
  openRoutine() {
    return openRoutineSheet(ctx);
  },
  quietRender() {
    const y = window.scrollY;
    render();
    window.scrollTo({ top: y });
  },
  async setSlotState(s) {
    await store.put('slot_states', s);
    await refresh();
  },
  async clearSlotState(slotId) {
    await store.delete('slot_states', slotId);
    await refresh();
  },
  async addEvent(ev, { toastText } = {}) {
    const problems = validateEvent(ev);
    if (problems.length) throw new Error(problems.join(' '));
    await store.put('events', ev);
    if (ev.slot_id) await store.delete('slot_states', ev.slot_id); // a recorded entry ends any in-progress/skipped state
    if (!isSample(ev)) markHadData();
    await refresh();
    if (toastText) toast(toastText);
  },
  async putOrderVersion(newVersion, previous) {
    newVersion.key = orderKey(newVersion);
    previous.key = orderKey(previous);
    await store.bulkPut([
      { store: 'orders', obj: previous },
      { store: 'orders', obj: newVersion },
    ]);
    await refresh();
    toast(newVersion.type === 'exercise' ? `${newVersion.name}: clearance recorded` : `${newVersion.name}: schedule saved as version ${newVersion.version}`);
  },
  async resolveQuestion(q, resolution) {
    await store.put('questions', { ...q, status: 'resolved', resolution: { ...resolution, recorded_at: toIso(nowMs()) } });
    await refresh();
    toast('Answer recorded');
  },
  async reopenQuestion(q) {
    const ok = await confirmDialog({ title: 'Reopen this question?', message: 'It will show as “needs confirmation” again. The recorded answer stays in history.', confirmText: 'Reopen' });
    if (!ok) return;
    await store.put('questions', { ...q, status: 'needs_clinician_confirmation', previous_resolution: q.resolution, resolution: null });
    await refresh();
  },
  async putMilestone(m) {
    await store.put('milestones', m);
    await refresh();
    toast('Milestone updated');
  },
  async putAppointment(a) {
    await store.put('appointments', a);
    await refresh();
    toast('Appointment saved');
  },
  async putContact(c) {
    await store.put('contacts', c);
    await refresh();
    toast('Contact saved');
  },
  async putMeta(obj) {
    await store.put('meta', obj);
    await refresh();
    toast('Saved');
  },
  setPref(key, value) {
    state.prefs = { ...state.prefs, [key]: value };
    savePrefs(state.prefs);
    applyPrefs(state.prefs);
    render();
  },
  toggleLowEnergy() {
    ctx.actions.setPref('lowEnergy', !state.prefs.lowEnergy);
    toast(state.prefs.lowEnergy ? 'Low-energy mode on. One thing at a time.' : 'Full view restored');
  },
  showEscalation(esc) {
    openSheet({
      title: 'Please act on this now',
      size: 'compact',
      content: el('div', { class: 'confirm' }, el('div', { class: 'danger-box', role: 'alert' }, icon('alert'), el('span', { text: esc.message })), el('p', { class: 'muted small', text: 'Your check-in was recorded. This app cannot assess symptoms — a person needs to.' }), el('div', { class: 'btn-row' }, button('OK', { variant: 'primary', onClick: () => closeAllSheets() }))),
    });
  },
  async requestPersistence() {
    try {
      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist();
        toast(granted ? 'The browser agreed to keep this data' : 'Persistent storage not granted — keep exporting backups');
        return granted;
      }
    } catch {
      /* ignore */
    }
    toast('Persistent storage is not available in this browser');
    return false;
  },
  async storageInfo() {
    const info = { kind: store.kind, reason: store.reason, persisted: null, usage: null, serviceWorker: state.swStatus };
    try {
      if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
      if (navigator.storage?.estimate) info.usage = (await navigator.storage.estimate()).usage;
    } catch {
      /* ignore */
    }
    return info;
  },
  async exportJson() {
    const data = buildExport(state, { nowIso: toIso(nowMs()), appVersion: APP_VERSION });
    const text = JSON.stringify(data, null, 2);
    const stamp = data.exported_at.replace(/[:.]/g, '-');
    await store.put('meta', { key: 'last_export', at: data.exported_at, events: state.events.length });
    await loadState();
    openTextExportSheet({ title: 'JSON backup', filename: `recovery-os-backup-${stamp}.json`, text, note: `${state.events.length} entries, ${state.orders.length} order versions, ${state.questions.length} questions. Keep this file private — it is your medical record.` });
  },
  exportSummary() {
    const text = buildVisitSummary(state, { now: nowMs() });
    openTextExportSheet({ title: 'Visit summary', filename: `recovery-os-visit-summary-${toIso(nowMs()).slice(0, 10)}.md`, text, mime: 'text/markdown', note: 'Generated from recorded entries only. Share it with your surgeon or PT, or paste it into a message.' });
  },
  openImport() {
    openImportSheet();
  },
  dismissDataLoss() {
    state.dataLossSuspected = false;
    clearHadData();
    render();
  },
  async loadSample() {
    const ok = await confirmDialog({ title: 'Load sample entries?', message: 'Adds a few clearly-labelled demo entries (ice, a check-in, a note). No medication doses. You can remove them any time.', confirmText: 'Load samples' });
    if (!ok) return;
    const items = sampleEvents({ nowMs: nowMs(), tz: state.profile.timezone || DEFAULT_TZ }).map((obj) => ({ store: 'events', obj }));
    await store.bulkPut(items);
    await refresh();
    toast('Sample entries loaded (labelled “sample”)');
  },
  async removeSample() {
    const samples = state.events.filter(isSample);
    for (const s of samples) await store.delete('events', s.id);
    await refresh();
    toast('Sample entries removed');
  },
  async eraseAll() {
    const first = await confirmDialog({ title: 'Erase all local data?', message: 'This deletes every order, entry, question, appointment and contact stored on this device. Export a backup first if you have not.', confirmText: 'Continue', danger: true });
    if (!first) return;
    const second = await confirmDialog({ title: 'Really erase everything?', message: 'This cannot be undone. The app will restart with the care-plan seed and no entries.', confirmText: 'Yes, erase', danger: true });
    if (!second) return;
    await store.clear();
    clearHadData();
    state.dataLossSuspected = false;
    onboarding = true;
    await ensureSeed();
    await refresh();
    toast('Local data erased');
  },
});

// ---------- Import ----------
function openImportSheet() {
  const file = el('input', { type: 'file', accept: '.json,application/json' });
  const paste = el('textarea', { class: 'export-text', placeholder: 'Or paste the backup JSON here' });
  const result = el('div', { class: 'form' });
  const sheet = openSheet({ title: 'Import backup', content: null });
  let pending = null;

  const review = async () => {
    result.replaceChildren();
    pending = null;
    let text = paste.value.trim();
    try {
      if (file.files && file.files[0]) text = await file.files[0].text();
    } catch (e) {
      result.append(el('div', { class: 'error-box', text: `Could not read the file: ${e.message}` }));
      return;
    }
    if (!text) {
      result.append(el('div', { class: 'error-box', text: 'Choose a file or paste the backup text first.' }));
      return;
    }
    const parsed = parseBackupText(text);
    if (!parsed.ok) {
      result.append(el('div', { class: 'error-box' }, el('strong', { text: 'Nothing was imported.' }), el('ul', {}, parsed.errors.map((m) => el('li', { text: m })))));
      return;
    }
    const v = validateExport(parsed.value);
    if (!v.ok) {
      result.append(el('div', { class: 'error-box' }, el('strong', { text: 'Backup failed validation — nothing was imported.' }), el('ul', {}, v.errors.map((m) => el('li', { text: m })))));
      return;
    }
    const diff = diffImport(state, parsed.value);
    pending = diff;
    const labels = { events: 'Entries', orders: 'Order versions', questions: 'Questions', milestones: 'Milestones', appointments: 'Appointments', contacts: 'Contacts' };
    const rows = Object.values(diff.sections).map((s) => el('tr', {}, el('td', { text: labels[s.store] }), el('td', { class: 'num', text: String(s.new.length) }), el('td', { class: 'num', text: String(s.identical) }), el('td', { class: 'num', text: String(s.conflicts.length) })));
    result.append(
      el('div', { class: 'summary-box' },
        el('strong', { text: `Backup from ${parsed.value.exported_at || 'unknown date'} · schema ${parsed.value.schema_version}` }),
        el('span', { class: 'small', text: `Profile: ${diff.profile.status === 'adopt' ? 'will be adopted (no local history yet)' : diff.profile.status === 'same' ? 'matches' : diff.profile.status === 'conflict' ? 'differs — the existing profile is kept' : 'not included'}` })
      ),
      el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Collection' }), el('th', { text: 'New' }), el('th', { text: 'Identical' }), el('th', { text: 'Conflicts' }))), el('tbody', {}, rows))),
      diff.totalConflicts ? el('div', { class: 'warning-box' }, el('strong', { text: `${diff.totalConflicts} conflicting ${diff.totalConflicts === 1 ? 'entry has' : 'entries have'} the same id but different content.` }), el('span', { text: 'Existing entries are kept; the conflicting imported versions are skipped. Nothing is overwritten.' })) : null,
      el('p', { class: 'muted small', text: diff.totalNew ? `${diff.totalNew} new ${diff.totalNew === 1 ? 'item' : 'items'} will be written in one transaction — all or nothing.` : 'Nothing new to import.' }),
      el('div', { class: 'btn-row' }, button('Cancel', { onClick: () => sheet.close('cancel') }), button(`Import ${diff.totalNew} new`, { variant: 'primary', disabled: !diff.totalNew && diff.profile.status !== 'adopt', onClick: commit }))
    );
  };
  const commit = async () => {
    if (!pending) return;
    try {
      const r = await applyImport(store, pending);
      markHadData();
      state.dataLossSuspected = false;
      await refresh();
      sheet.close('imported');
      toast(`Imported ${r.written} ${r.written === 1 ? 'item' : 'items'}`);
    } catch (e) {
      result.append(el('div', { class: 'error-box', text: `Import failed and nothing was written: ${e.message}` }));
    }
  };
  sheet.setContent(
    el('div', { class: 'form' },
      el('p', { class: 'muted small', text: 'The backup is validated and compared with what is on this device before anything is written. Existing entries are never overwritten.' }),
      field('Backup file', file),
      field('Or paste JSON', paste),
      el('div', { class: 'btn-row' }, button('Review import', { variant: 'primary', onClick: review })),
      result
    )
  );
}

// ---------- Boot ----------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    state.swStatus = 'unsupported';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    state.swStatus = reg.active ? 'active' : 'installing';
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'activated') state.swStatus = 'active';
      });
    });
    if (navigator.serviceWorker.controller) state.swStatus = 'active';
  } catch {
    state.swStatus = 'unsupported';
  }
}

async function boot() {
  applyPrefs(state.prefs);
  document.getElementById('skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('main')?.focus();
  });
  try {
    store = await openStore();
    state.storeVolatile = !!store.volatile;
    await ensureSeed();
    await loadState();
    const activation = state.meta.activation;
    if (!activation && hadData() && state.events.length === 0) state.dataLossSuspected = true;
    if (state.dataLossSuspected) {
      // Show Today with the data-loss panel instead of onboarding, so the person can restore first.
      await store.put('meta', { key: 'activation', activated_at: toIso(nowMs()), reviewed_seed_version: SEED_VERSION, app_version: APP_VERSION, note: 'auto-activated after suspected data loss; seed not re-reviewed' });
      await loadState();
    }
  } catch (e) {
    document.getElementById('main').replaceChildren(el('div', { class: 'error-box' }, el('strong', { text: 'Recovery OS could not start. ' }), String(e?.message || e)));
    return;
  }
  window.addEventListener('hashchange', () => {
    closeAllSheets();
    render();
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });
  render();
  registerServiceWorker();
  // Keep "next dose" and the day count current: when the app returns to the
  // foreground, and every few minutes on Today. Never while a sheet is open.
  const quietRender = () => {
    if (document.querySelector('.sheet-wrap') || onboarding) return;
    ctx.actions.quietRender();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') quietRender();
  });
  setInterval(() => {
    renderHeader();
    if (currentRoute() === 'today' && document.visibilityState === 'visible') quietRender();
  }, 5 * 60 * 1000);
}

boot();
