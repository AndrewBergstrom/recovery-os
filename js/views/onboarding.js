// views/onboarding.js — first-run review of the care-plan seed. Activation records
// that the patient reviewed the ORDERS; it never records a dose or a session.

import { el, chip, button, icon } from '../ui.js';
import { activeOrders, statusLabel } from '../medications.js';
import { partitionExercises } from '../exercises.js';
import { restrictions } from '../seed.js';
import { formatDateStr } from '../time.js';
import { PRODUCT_BOUNDARY } from '../safety-rules.js';
import { statusChipFor } from './shared.js';
import { milestoneDate } from './plan.js';

export function renderOnboarding(ctx, { onDone }) {
  const { state, actions } = ctx;
  let step = 0;
  const root = el('section', { class: 'view onboarding' });
  const steps = [stepWelcome, stepSurgery, stepSeed, stepStorage];

  const render = () => {
    root.replaceChildren(
      el('div', { class: 'steps', 'aria-hidden': 'true' }, steps.map((_, i) => el('span', { class: i <= step ? 'is-done' : '' }))),
      el('p', { class: 'eyebrow', text: `Setup · step ${step + 1} of ${steps.length}` }),
      steps[step]()
    );
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  };
  const nav = ({ nextLabel = 'Continue', onNext, showBack = true } = {}) =>
    el('div', { class: 'btn-row' }, showBack && step > 0 ? button('Back', { icon: 'back', onClick: () => { step -= 1; render(); } }) : null, button(nextLabel, { variant: 'primary', cls: 'btn-large', onClick: onNext || (() => { step += 1; render(); }) }));

  function stepWelcome() {
    return el('div', { class: 'view' },
      el('h1', { text: 'Recovery OS' }),
      el('p', { class: 'greeting', text: 'A calm place to keep track of your recovery — one thing at a time.' }),
      el('div', { class: 'card' },
        el('h2', { class: 'card-title', text: 'Before you start' }),
        el('p', { text: PRODUCT_BOUNDARY }),
        el('ul', {},
          el('li', { text: 'Everything stays on this device. No account, no cloud, no analytics.' }),
          el('li', { text: 'A medication only counts as taken when you record it. No entry means “not recorded”, never “missed”.' }),
          el('li', { text: 'Where your paperwork disagrees with itself, the app shows “needs confirmation” until a clinician settles it.' })
        )
      ),
      nav({ showBack: false })
    );
  }

  function stepSurgery() {
    const p = state.profile;
    return el('div', { class: 'view' },
      el('h1', { text: 'Your surgery' }),
      el('p', { class: 'muted', text: 'Transcribed from your discharge paperwork. Check it; you can edit it any time from Plan.' }),
      el('div', { class: 'card' },
        el('div', { class: 'kv' },
          el('dt', { text: 'Date' }), el('dd', { text: formatDateStr(p.surgery_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }),
          el('dt', { text: 'Side' }), el('dd', { text: `${p.surgical_side} ${p.joint || 'knee'}` }),
          el('dt', { text: 'Procedures' }), el('dd', {}, el('ul', {}, (p.procedures || []).map((x) => el('li', { text: x })))),
          el('dt', { text: 'Time zone' }), el('dd', { text: p.timezone })
        ),
        el('div', { class: 'card-actions' }, button('Edit details', { onClick: () => actions.openProfileEditor() }))
      ),
      nav()
    );
  }

  function stepSeed() {
    const meds = activeOrders(state.orders, 'medication');
    const { pending, cleared } = partitionExercises(state.orders);
    const open = state.questions.filter((q) => q.status === 'needs_clinician_confirmation');
    return el('div', { class: 'view' },
      el('h1', { text: 'Review your care plan' }),
      el('p', { class: 'muted', text: 'These are orders from your paperwork, entered as written. Nothing below is marked as taken or done.' }),
      el('div', { class: 'card' },
        el('h2', { class: 'card-title', text: `Medication orders (${meds.length})` }),
        el('ul', { class: 'list plain-list' }, meds.map((m) => { const st = statusLabel(m); return el('li', {}, el('div', {}, el('strong', { text: `${m.name} ${m.display_strength} ` }), chip(st.text, st.tone)), el('div', { class: 'muted small', text: m.directions })); }))
      ),
      el('div', { class: 'card card-warning' },
        el('h2', { class: 'card-title' }, icon('alert'), ` Needs clinician confirmation (${open.length})`),
        el('ul', { class: 'list plain-list' }, open.map((q) => el('li', {}, el('strong', { text: q.topic }), el('div', { class: 'muted small', text: q.conflicting_values.join('  vs.  ') })))),
        el('p', { class: 'small', text: 'The app keeps the conservative reading of each until you record the clinician’s answer in Plan.' })
      ),
      el('div', { class: 'card' },
        el('h2', { class: 'card-title', text: `Exercises from the paperwork (${pending.length + cleared.length})` }),
        el('ul', { class: 'list plain-list' }, [...cleared, ...pending].map((x) => el('li', {}, el('div', {}, el('strong', { text: `${x.name} ` }), statusChipFor(x.status)), el('div', { class: 'muted small', text: x.guardrail })))),
        el('p', { class: 'small muted', text: 'Not shown as due until a PT or surgeon clears them and you record who, when and which instructions.' })
      ),
      el('div', { class: 'card' },
        el('h2', { class: 'card-title', text: 'Restrictions' }),
        el('ul', { class: 'list plain-list' }, restrictions.map((r) => el('li', {}, el('div', {}, el('strong', { text: `${r.topic}: ` }), r.current, ' ', statusChipFor(r.status)))))
      ),
      el('div', { class: 'card' },
        el('h2', { class: 'card-title', text: 'Milestones (informational)' }),
        el('ul', { class: 'list plain-list' }, state.milestones.map((m) => { const d = milestoneDate(m, state.profile.surgery_date); return el('li', {}, el('div', {}, el('strong', { text: `${m.title} ` }), statusChipFor(m.status)), el('div', { class: 'muted small', text: `${d ? d.label : ''}${m.note ? ` · ${m.note}` : ''}` })); }))
      ),
      nav({ nextLabel: 'I’ve reviewed this' })
    );
  }

  function stepStorage() {
    return el('div', { class: 'view' },
      el('h1', { text: 'Keeping your entries safe' }),
      el('div', { class: 'card' },
        el('ul', {},
          el('li', { text: 'Entries are stored in this browser on this device (IndexedDB). They survive closing the app and losing connectivity.' }),
          el('li', { text: 'Browsers can still clear or evict data. The JSON export in Settings is your real backup — do it every few days and before clinic visits.' }),
          el('li', { text: 'There is no automatic sync between devices. Move data by exporting and importing a backup.' }),
          el('li', { text: 'Reminders inside the app only work while it is open. For scheduled medicines, set a phone alarm you control.' })
        ),
        el('p', { class: 'muted small', text: 'Next, the browser may ask whether this site can keep its data persistently. Allowing it reduces the chance of eviction.' })
      ),
      nav({ nextLabel: 'Activate Recovery OS', onNext: async () => { await actions.requestPersistence(); await onDone(); } })
    );
  }

  render();
  return root;
}
