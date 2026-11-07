// time.js — time-zone aware helpers. No dependencies.
// All stored timestamps are ISO-8601 UTC; display uses the profile time zone.
// Daylight-saving transitions are handled by Intl, not by hand-rolled offsets.

export const DEFAULT_TZ = 'America/Los_Angeles';
export const DAY_MS = 24 * 60 * 60 * 1000;

const formatterCache = new Map();

function partsFormatter(tz) {
  if (!formatterCache.has(tz)) {
    formatterCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return formatterCache.get(tz);
}

const pad = (n) => String(n).padStart(2, '0');

export function nowMs() {
  return Date.now();
}

export function toIso(ms) {
  return new Date(ms).toISOString();
}

export function fromIso(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(ms, tz = DEFAULT_TZ) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

export function localDateString(ms, tz = DEFAULT_TZ) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localTimeString(ms, tz = DEFAULT_TZ) {
  const p = zonedParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (local − UTC) in ms for an instant in a time zone. */
export function tzOffsetMs(ms, tz = DEFAULT_TZ) {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = zonedParts(whole, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/** Convert a wall-clock date + time in a time zone to a UTC instant (ms). */
export function zonedToUtc(dateStr, timeStr, tz = DEFAULT_TZ) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi || 0, 0);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function utcOfDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar-day difference between two YYYY-MM-DD strings (b − a). */
export function daysBetween(a, b) {
  return Math.round((utcOfDateStr(b) - utcOfDateStr(a)) / DAY_MS);
}

export function addDays(dateStr, n) {
  const d = new Date(utcOfDateStr(dateStr) + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysSinceSurgery(surgeryDate, ms, tz = DEFAULT_TZ) {
  return daysBetween(surgeryDate, localDateString(ms, tz));
}

export function dayLabel(dayCount) {
  if (dayCount === 0) return 'Surgery day';
  if (dayCount < 0) return `Surgery in ${-dayCount} day${dayCount === -1 ? '' : 's'}`;
  return `Day ${dayCount} after surgery`;
}

export function formatTime(ms, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

export function formatDate(ms, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(ms)
  );
}

export function formatDateLong(ms, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

/** Format a YYYY-MM-DD string as a date (no time-zone shift). */
export function formatDateStr(dateStr, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!isValidDateStr(dateStr)) return dateStr || '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(utcOfDateStr(dateStr) + 12 * 3600 * 1000));
}

export function formatDateTime(ms, tz = DEFAULT_TZ) {
  return `${formatDate(ms, tz)} · ${formatTime(ms, tz)}`;
}

/** Human description of an instant relative to now, in the profile time zone. */
export function describeWhen(ms, now, tz = DEFAULT_TZ) {
  const today = localDateString(now, tz);
  const that = localDateString(ms, tz);
  const diff = daysBetween(that, today);
  const t = formatTime(ms, tz);
  if (diff === 0) return `${t} today`;
  if (diff === 1) return `${t} yesterday`;
  if (diff === -1) return `${t} tomorrow`;
  return `${formatDate(ms, tz)} · ${t}`;
}

export function relativeAgo(ms, now) {
  const diff = Math.max(0, now - ms);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

export function datetimeLocalValue(ms, tz = DEFAULT_TZ) {
  return `${localDateString(ms, tz)}T${localTimeString(ms, tz)}`;
}

export function parseDatetimeLocal(value, tz = DEFAULT_TZ) {
  if (typeof value !== 'string' || !value.includes('T')) return NaN;
  const [d, t] = value.split('T');
  if (!isValidDateStr(d) || !/^\d{2}:\d{2}/.test(t)) return NaN;
  return zonedToUtc(d, t.slice(0, 5), tz);
}

export function hourOf(ms, tz = DEFAULT_TZ) {
  return zonedParts(ms, tz).hour;
}

export function greeting(ms, tz = DEFAULT_TZ) {
  const h = hourOf(ms, tz);
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Next occurrence of a HH:mm wall-clock time at or after `now` in a time zone. */
export function nextOccurrence(timeStr, now, tz = DEFAULT_TZ) {
  const today = localDateString(now, tz);
  for (let i = 0; i < 3; i++) {
    const date = addDays(today, i);
    const ms = zonedToUtc(date, timeStr, tz);
    if (ms >= now) return { ms, date, isToday: i === 0 };
  }
  return null;
}

/** Most recent occurrence of a HH:mm wall-clock time at or before `now`. */
export function previousOccurrence(timeStr, now, tz = DEFAULT_TZ) {
  const today = localDateString(now, tz);
  for (let i = 0; i < 3; i++) {
    const date = addDays(today, -i);
    const ms = zonedToUtc(date, timeStr, tz);
    if (ms <= now) return { ms, date, isToday: i === 0 };
  }
  return null;
}
