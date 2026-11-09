// pt-schedule.js — pure helpers that pick the physical-therapy visits out of the
// appointments list and shape them for an at-a-glance view. No DOM, no storage.

import { localDateString, daysBetween, formatDateStr } from './time.js';

const PT_RE = /\bPT\b|physical therapy|hidef/i;

/** True when an appointment is a physical-therapy visit (by title, or who it is with). */
export function isPtVisit(a) {
  if (!a || a.status === 'cancelled') return false;
  return PT_RE.test(`${a.title || ''} ${a.with || ''}`);
}

/** PT visits that have a valid time, oldest first. */
export function ptVisits(appointments) {
  return (appointments || [])
    .filter((a) => isPtVisit(a) && Number.isFinite(Date.parse(a.at)))
    .map((a) => ({ ...a, ms: Date.parse(a.at) }))
    .sort((x, y) => x.ms - y.ms);
}

/** "PT visit 7 — HiDEF" → 7, otherwise null. */
export function visitNumber(a) {
  const m = /\bPT visit\s+(\d+)/i.exec(a?.title || '');
  return m ? Number(m[1]) : null;
}

/** The first visit that has not finished yet (a visit stays "next" for 90 minutes). */
export function nextVisit(visits, now) {
  return visits.find((v) => v.ms + 90 * 60 * 1000 > now) || null;
}

/** Group visits by calendar month in the profile time zone. */
export function groupByMonth(visits, tz) {
  const groups = [];
  for (const v of visits) {
    const key = localDateString(v.ms, tz).slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: formatDateStr(`${key}-01`, { month: 'long', year: 'numeric' }), visits: [] };
      groups.push(g);
    }
    g.visits.push(v);
  }
  return groups;
}

/** "Today", "Tomorrow", "In 5 days", "3 days ago" for a visit instant. */
export function relativeDay(ms, now, tz) {
  const diff = daysBetween(localDateString(now, tz), localDateString(ms, tz));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}
