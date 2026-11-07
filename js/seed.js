// seed.js — initial care-plan seed, transcribed from the patient's paperwork as
// documented in docs/SPEC.md §3. These are ORDERS and open questions, never doses
// taken or sessions completed. Everything flagged "needs confirmation" stays that
// way until a clinician confirms it and the patient records who/when/source.

export const SEED_VERSION = 1;
export const SEED_SOURCE = 'User-provided discharge and physical therapy paperwork, November 6, 2026';

export const profile = {
  key: 'profile',
  surgery_date: '2026-11-06',
  surgical_side: 'left',
  joint: 'knee',
  procedures: [
    'ACL reconstruction with quadriceps tendon autograft',
    'Medial meniscus repair',
    'Lateral extra-articular tenodesis (LET)',
  ],
  timezone: 'America/Los_Angeles',
  source: SEED_SOURCE,
};

export function orderKey(order) {
  return `${order.id}@v${order.version}`;
}

const med = (o) => ({ type: 'medication', version: 1, unit: 'tablet', valid_from: '2026-11-06', valid_to: null, confirmed_by: null, confirmed_on: null, source: 'Prescription report dated 2026-11-06', ...o, key: `${o.id}@v1` });
const ex = (o) => ({
  type: 'exercise',
  version: 1,
  cleared: false,
  cleared_by: null,
  cleared_on: null,
  instructions_version: 'Discharge/PT paperwork 2026-11-06',
  status: 'pending_clinician_confirmation',
  valid_from: '2026-11-06',
  valid_to: null,
  source: SEED_SOURCE,
  ...o,
  key: `${o.id}@v1`,
});

export const orders = [
  med({
    id: 'med-aspirin-81',
    sort_order: 1,
    name: 'Aspirin (delayed-release)',
    short_name: 'aspirin',
    strength_mg: 81,
    display_strength: '81 mg',
    strength_display_unit: 'mg',
    directions: '1 tablet orally twice daily with meals for 6 weeks',
    why: 'Clot prevention — adherence matters',
    schedule: { kind: 'scheduled', frequency: 'twice daily', times: null, with_food: true, course_weeks: 6, course_start: null, course_end: null },
    status: 'needs_schedule_confirmation',
    default_quantity: 1,
    quantity_options: [1],
    notes: [
      'Confirm the course start date and exact times before this is shown as scheduled.',
      'Never take a double dose to catch up. If unsure whether a dose was taken, check the label, pharmacist or clinician.',
      'Ibuprofen is flagged for an interaction with aspirin — see the ibuprofen card; ask the prescriber or pharmacist before combining them.',
    ],
  }),
  med({
    id: 'med-oxycodone-5',
    sort_order: 2,
    name: 'Oxycodone',
    short_name: 'oxycodone',
    strength_mg: 5,
    display_strength: '5 mg',
    strength_display_unit: 'mg',
    directions: '1–2 tablets orally every 4–6 hours as needed for pain',
    why: 'As-needed pain relief',
    schedule: { kind: 'prn', reason: 'pain', min_interval_hours: 4, max_interval_hours: 6 },
    status: 'prn',
    default_quantity: 1,
    quantity_options: [1, 2],
    notes: [
      'As needed only — never shown as due or missed.',
      'Record tablet count, actual dose, pain level and time.',
      'This app does not invent a daily maximum; follow the prescription label.',
    ],
  }),
  med({
    id: 'med-acetaminophen-500',
    sort_order: 3,
    name: 'Acetaminophen (Tylenol)',
    short_name: 'acetaminophen',
    strength_mg: 500,
    display_strength: '500 mg',
    strength_display_unit: 'mg',
    directions: '1–2 tablets orally every 8 hours as needed; maximum 3,000 mg per rolling 24 hours',
    why: 'As-needed pain relief',
    schedule: { kind: 'prn', reason: 'pain', min_interval_hours: 8 },
    status: 'prn',
    default_quantity: 1,
    quantity_options: [1, 2],
    rolling_24h_max_mg: 3000,
    counts_as: 'acetaminophen',
    notes: [
      'The app adds up recorded acetaminophen over the preceding 24 hours (rolling, not midnight reset) and warns before 3,000 mg.',
      'Other products containing acetaminophen count toward the same total — add them as an order if used.',
    ],
  }),
  med({
    id: 'med-ibuprofen-400',
    sort_order: 4,
    name: 'Ibuprofen',
    short_name: 'ibuprofen',
    strength_mg: 400,
    display_strength: '400 mg',
    strength_display_unit: 'mg',
    directions: '1 tablet orally every 8 hours as needed with food; prescription notes maximum 2,400 mg/24 hours',
    why: 'As-needed anti-inflammatory',
    schedule: { kind: 'prn', reason: 'pain', min_interval_hours: 8, with_food: true },
    status: 'needs_prescriber_confirmation',
    default_quantity: 1,
    quantity_options: [1],
    rolling_24h_max_mg: 2400,
    interaction_flags: [{ with: 'med-aspirin-81', message: 'Aspirin–ibuprofen interaction: prescriber/pharmacist confirmation required before use.' }],
    notes: ['Not auto-scheduled.', 'Take with food per the prescription.'],
  }),
  med({
    id: 'med-peg-3350',
    sort_order: 5,
    name: 'Polyethylene glycol 3350 (MiraLAX)',
    short_name: 'MiraLAX',
    strength_mg: 17000,
    display_strength: '17 g',
    strength_display_unit: 'g',
    unit: 'packet',
    directions: '1 packet orally once daily as needed for constipation prevention; hold for loose stools',
    why: 'Constipation prevention (as needed)',
    schedule: { kind: 'prn', reason: 'constipation prevention', min_interval_hours: 24 },
    status: 'prn',
    default_quantity: 1,
    quantity_options: [1],
    notes: ['Hold for loose stools.', 'Only recorded once you confirm you took it.'],
  }),
  ex({
    id: 'ex-heel-slides',
    sort_order: 6,
    name: 'Assisted heel slides',
    how_to: 'Lying down, slide the heel toward you with hand or strap assistance, then slowly back out, staying within a comfortable range.',
    tracking: ['sets', 'reps', 'max_bend_deg'],
    parameters: 'Sets/reps as assigned by PT; maximum bend if measured',
    guardrail: 'Never exceed the currently authorized 90° flexion; do not force range of motion.',
  }),
  ex({
    id: 'ex-quad-sets',
    sort_order: 7,
    name: 'Quadriceps isometric sets',
    how_to: 'With the leg straight, tighten the thigh muscle to press the back of the knee gently down, hold, then relax.',
    tracking: ['sets', 'reps', 'hold_seconds'],
    parameters: 'Sets/reps and hold duration if PT assigns',
    guardrail: 'Gentle activation only; stop for concerning symptoms.',
  }),
  ex({
    id: 'ex-straight-leg-raise',
    sort_order: 8,
    name: 'Straight-leg raises',
    how_to: 'With the brace locked as instructed and the thigh tight, lift the straight leg a short distance, then lower it slowly.',
    tracking: ['reps', 'brace_on'],
    parameters: 'Reps; brace on/off; quality',
    guardrail: 'Brace locked initially as described; do not unlock or progress without quadriceps control and clearance.',
  }),
  ex({
    id: 'ex-gravity-extension',
    sort_order: 9,
    name: 'Heel-supported gravity extension',
    how_to: 'Rest the heel or ankle on a support with nothing under the knee and let gravity straighten the knee.',
    tracking: ['duration_minutes'],
    parameters: 'Packet suggests 30 minutes three times daily, subject to clinician confirmation',
    guardrail: 'Support the heel/ankle, never under the knee.',
  }),
];

export const restrictions = [
  {
    id: 'weight-bearing',
    topic: 'Weight-bearing',
    current: 'Toe-touch weight-bearing',
    detail: 'Keep the conservative restriction. Do not increase loading at 2 weeks until the surgeon confirms the duration.',
    status: 'needs_clinician_confirmation',
    question_id: 'weight-bearing-duration',
  },
  {
    id: 'flexion',
    topic: 'Knee bending',
    current: 'Flexion limited to 0–90° in early recovery',
    detail: 'Keep the 90° limit until formally cleared. Generic packet says first 6 weeks.',
    status: 'active',
  },
  {
    id: 'brace-walking',
    topic: 'Brace for walking',
    current: 'Locked at 0° for ambulation',
    detail: 'Never walk unbraced.',
    status: 'active',
  },
  {
    id: 'brace-sleep-shower',
    topic: 'Brace for sleeping and showering',
    current: 'Unresolved — a separate packet says locked for sleeping/showering',
    detail: 'Shown as unresolved until confirmed.',
    status: 'needs_clinician_confirmation',
    question_id: 'brace-sleep-shower',
  },
  {
    id: 'cold-therapy',
    topic: 'Cold therapy',
    current: '20–30 minutes, at least four times daily during early recovery (handout)',
    detail: 'Dry barrier between the entire cold pad and skin. Continuous cooling is not implied to be safe.',
    status: 'active',
  },
  {
    id: 'wound-care',
    topic: 'Wound care and elevation',
    current: 'Keep the early dressing until about 48 hours as instructed; leave Steri-Strips in place',
    detail: 'Elevate without sustained pillow pressure behind the knee. Follow prescribed wound care and follow-up instructions.',
    status: 'active',
  },
];

export const questions = [
  {
    id: 'weight-bearing-duration',
    sort_order: 1,
    topic: 'Toe-touch weight-bearing duration',
    short: 'Weight-bearing',
    ask: 'Surgeon',
    conflicting_values: ['2 weeks (individual PT order)', '6 weeks (generic postoperative packet)'],
    note: 'Keep the conservative restriction and do not suggest increased loading at 2 weeks until clarified.',
    status: 'needs_clinician_confirmation',
    resolution: null,
  },
  {
    id: 'pt-start',
    sort_order: 2,
    topic: 'Physical therapy start',
    short: 'PT start',
    ask: 'Surgeon',
    conflicting_values: ['3–5 days / week 1 (discharge/PT instructions)', 'After the 2-week appointment (another handout)'],
    note: 'Exercise sessions are not shown as approved until confirmed.',
    status: 'needs_clinician_confirmation',
    resolution: null,
  },
  {
    id: 'brace-sleep-shower',
    sort_order: 3,
    topic: 'Brace locked for sleeping and showering?',
    short: 'Brace',
    ask: 'Surgeon',
    conflicting_values: ['Locked at 0° for ambulation (individual instruction)', 'Also locked for sleeping/showering (separate packet)'],
    note: 'Never prompts unbraced walking either way.',
    status: 'needs_clinician_confirmation',
    resolution: null,
  },
  {
    id: 'aspirin-ibuprofen',
    sort_order: 4,
    topic: 'Aspirin and ibuprofen together',
    short: 'Aspirin + ibuprofen',
    ask: 'Prescriber or pharmacist',
    conflicting_values: ['Aspirin 81 mg twice daily for 6 weeks', 'Ibuprofen 400 mg as needed'],
    note: 'Interaction check required before ibuprofen is used; ibuprofen is not scheduled.',
    status: 'needs_clinician_confirmation',
    resolution: null,
  },
  {
    id: 'first-visit-timing',
    sort_order: 5,
    topic: 'First clinic visit timing',
    short: 'First visit',
    ask: "Surgeon's office",
    conflicting_values: ['7–10 days', 'Approximately 2 weeks'],
    note: 'Milestone stays informational until the appointment is actually confirmed.',
    status: 'needs_clinician_confirmation',
    resolution: null,
  },
];

export const milestones = [
  {
    id: 'dressing-check',
    title: 'Dressing / shower check',
    when: { kind: 'offset_hours', hours: 48 },
    status: 'planned',
    note: 'Subject to the actual surgery finish time and wound instructions.',
  },
  {
    id: 'first-clinic-visit',
    title: 'First clinic visit',
    when: { kind: 'range_days', from: 7, to: 14 },
    status: 'needs_confirmation',
    note: 'Documents mention 7–10 days or about 2 weeks.',
    question_id: 'first-visit-timing',
  },
  {
    id: 'surgeon-followup-6w',
    title: 'Surgeon follow-up',
    when: { kind: 'offset_days', days: 42 },
    status: 'planned',
    note: 'About 6 weeks.',
  },
  {
    id: 'aspirin-course-end',
    title: 'Aspirin course ends',
    when: { kind: 'offset_days', days: 42 },
    status: 'needs_confirmation',
    note: '6 weeks from the confirmed course start.',
  },
  // The road back. These carry no dates on purpose: each one is a decision a clinician
  // makes, recorded here (who, when) once they make it. Nothing below is a timeline.
  { id: 'rtp-brace-off', title: 'Brace unlocked / off', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by surgeon or PT.' },
  { id: 'rtp-full-weight-bearing', title: 'Full weight-bearing', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by surgeon or PT.' },
  { id: 'rtp-flexion-past-90', title: 'Knee bend past 90° allowed', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by surgeon; meniscus repair keeps the limit until then.' },
  { id: 'rtp-bike', title: 'Stationary bike', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by PT.' },
  { id: 'rtp-running', title: 'Jogging / running', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by PT, usually after strength and hop testing.' },
  { id: 'rtp-agility', title: 'Cutting, agility, ball work', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by PT.' },
  { id: 'rtp-soccer', title: 'Cleared for soccer', when: { kind: 'to_be_set' }, status: 'needs_confirmation', note: 'Set by surgeon and PT together.' },
];

export const sourceDocuments = [
  'Discharge instructions (November 6, 2026)',
  'Physical therapy instructions (November 6, 2026)',
  'Generic postoperative packet',
  'Prescription report (November 6, 2026)',
  'Photographs of a handwritten medication log — unverified; entries are not imported as doses taken',
];

export const contactsTemplate = [
  { id: 'surgeon-office', role: "Surgeon's office", name: '', phone: '', notes: '' },
  { id: 'physical-therapy', role: 'Physical therapy', name: '', phone: '', notes: '' },
  { id: 'pharmacy', role: 'Pharmacy', name: '', phone: '', notes: '' },
];

/** Items to write on first run. Contains no events. */
export function seedItems(nowIso) {
  return [
    { store: 'meta', obj: profile },
    { store: 'meta', obj: { key: 'seed', version: SEED_VERSION, seeded_at: nowIso, source: SEED_SOURCE } },
    ...orders.map((o) => ({ store: 'orders', obj: o })),
    ...questions.map((q) => ({ store: 'questions', obj: q })),
    ...milestones.map((m) => ({ store: 'milestones', obj: m })),
    ...contactsTemplate.map((c) => ({ store: 'contacts', obj: c })),
  ];
}
