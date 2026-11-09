// views/pt-schedule.js — "PT schedule" card: the next visit up top, then every visit
// by month with weekday, date and time. Tapping a visit opens it for editing.

import { el, chip, icon } from '../ui.js';
import { formatTime, formatDate, DEFAULT_TZ } from '../time.js';
import { ptVisits, nextVisit, groupByMonth, visitNumber, relativeDay } from '../pt-schedule.js';

function weekdayAndDate(ms, tz) {
  const [weekday, rest] = formatDate(ms, tz).split(', ');
  return { weekday, rest: rest || '' };
}

export function ptScheduleCard(ctx, { onEdit } = {}) {
  const { state } = ctx;
  const now = ctx.now();
  const tz = state.profile.timezone || DEFAULT_TZ;
  const visits = ptVisits(state.appointments);
  const card = el('div', { class: 'card pt-card' });
  card.append(el('div', { class: 'section-head' }, el('h2', { class: 'card-title', text: 'PT schedule' }), visits.length ? chip(`${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`, 'neutral') : null));
  if (!visits.length) {
    card.append(el('p', { class: 'muted', text: 'No PT visits recorded yet.' }));
    return card;
  }

  const next = nextVisit(visits, now);
  if (next) {
    const { weekday, rest } = weekdayAndDate(next.ms, tz);
    const n = visitNumber(next);
    card.append(
      el('div', { class: 'pt-next', role: 'group', 'aria-label': 'Next PT visit' },
        el('span', { class: 'pt-next-label', text: n ? `Next · visit ${n}` : 'Next visit' }),
        el('span', { class: 'pt-next-when' }, el('strong', { text: `${weekday}, ${rest}` }), ' · ', el('strong', { text: formatTime(next.ms, tz) })),
        el('span', { class: 'pt-next-rel', text: relativeDay(next.ms, now, tz) })
      )
    );
  } else {
    card.append(el('p', { class: 'muted small', text: 'All PT visits on the list are done. Add the next ones as they get booked.' }));
  }

  for (const g of groupByMonth(visits, tz)) {
    card.append(el('h3', { class: 'pt-month', text: g.label }));
    card.append(
      el('ul', { class: 'pt-list' }, g.visits.map((v) => {
        const past = v.ms + 90 * 60 * 1000 <= now;
        const isNext = next && v.id === next.id;
        const { weekday, rest } = weekdayAndDate(v.ms, tz);
        const n = visitNumber(v);
        const row = el('button', { type: 'button', class: `pt-row${past ? ' is-past' : ''}${isNext ? ' is-next' : ''}`, 'aria-label': `${n ? `Visit ${n}, ` : ''}${weekday} ${rest}, ${formatTime(v.ms, tz)}${past ? ', done' : ''}`, onclick: () => onEdit && onEdit(v) });
        row.append(
          el('span', { class: 'pt-date' }, el('span', { class: 'pt-dow', text: weekday }), el('span', { text: rest })),
          el('span', { class: 'pt-time', text: formatTime(v.ms, tz) }),
          el('span', { class: 'pt-num' }, past ? icon('check', 'icon icon-sm') : null, n ? `Visit ${n}` : '')
        );
        return el('li', {}, row);
      }))
    );
  }
  card.append(el('p', { class: 'muted small', text: 'Dates and times are from your clinic confirmations. Tap a visit to change it.' }));
  return card;
}
