// prefs.js — UI preferences only (text size, low-energy mode, theme).
// Stored separately from clinical data. Preferences can never waive a restriction.

const KEY = 'recovery-os:prefs';
const HAD_DATA_KEY = 'recovery-os:had-data';

export const DEFAULT_PREFS = { textSize: 'default', lowEnergy: false, theme: 'auto', motion: 'auto' };
export const TEXT_SIZES = ['small', 'default', 'large', 'xl'];
export const THEMES = ['auto', 'light', 'dark'];

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadPrefs() {
  try {
    const raw = storage()?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const p = { ...DEFAULT_PREFS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    if (!TEXT_SIZES.includes(p.textSize)) p.textSize = 'default';
    if (!THEMES.includes(p.theme)) p.theme = 'auto';
    p.lowEnergy = !!p.lowEnergy;
    return p;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try {
    storage()?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage may be unavailable; preferences simply do not persist */
  }
}

export function applyPrefs(prefs, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return;
  root.dataset.textSize = prefs.textSize;
  root.dataset.theme = prefs.theme;
  root.dataset.motion = prefs.motion || 'auto';
  root.classList.toggle('low-energy', !!prefs.lowEnergy);
}

/** Marker that real entries once existed here — used to explain data loss honestly. */
export function markHadData() {
  try {
    storage()?.setItem(HAD_DATA_KEY, '1');
  } catch {
    /* ignore */
  }
}
export function hadData() {
  try {
    return storage()?.getItem(HAD_DATA_KEY) === '1';
  } catch {
    return false;
  }
}
export function clearHadData() {
  try {
    storage()?.removeItem(HAD_DATA_KEY);
  } catch {
    /* ignore */
  }
}
