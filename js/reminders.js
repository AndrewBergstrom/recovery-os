// reminders.js — reminder policy that does not overpromise (SPEC §8).
// Phase 1 ships the policy and operating-system reminder suggestions only.
// In-app visual reminders while the app is open are Phase 2.

import { isScheduleConfirmed } from './medications.js';
import { formatDateStr, zonedToUtc, formatTime, DEFAULT_TZ } from './time.js';

export const REMINDER_POLICY = [
  'A reminder means “check status”. It never records a dose for you.',
  'A static web page cannot reliably ring while it is closed. Browser background notifications are not dependable enough on phones to be the only reminder for a safety-critical medication.',
  'For important scheduled doses, set an operating-system alarm or a Reminders/Calendar entry that you review yourself.',
  'As-needed (PRN) medicines are never scheduled and never counted as missed.',
];

/** Plain-language suggestions for OS-level reminders, for confirmed scheduled orders only. */
export function osReminderSuggestions(orders, tz = DEFAULT_TZ) {
  const out = [];
  for (const o of orders) {
    if (!isScheduleConfirmed(o)) continue;
    const times = o.schedule.times.map((t) => formatTime(zonedToUtc('2026-01-01', t, tz), tz)).join(' and ');
    const until = o.schedule.course_end ? ` until ${formatDateStr(o.schedule.course_end, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
    out.push({
      order: o,
      title: `${o.name} ${o.display_strength}`,
      line: `Daily at ${times}${until}${o.schedule.with_food ? ' (with meals)' : ''}.`,
      howto: 'iPhone: open Reminders → New Reminder → turn on Date and Time → Repeat: Daily. Or use the Clock app → Alarm → Repeat every day.',
    });
  }
  return out;
}
