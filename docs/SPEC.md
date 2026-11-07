# Recovery OS — Personal Knee Surgery Recovery Tracker

**Version:** 1.0 — build specification  
**Owner:** Single patient  
**Starting event:** Left knee surgery, November 6, 2026  
**Time zone:** `America/Los_Angeles`  
**Platform:** Mobile-first, static HTML/CSS/JavaScript, offline-capable  
**Primary goal:** Make the next safe recovery action obvious, fast, and low-effort.

> **Product boundary:** This is a personal tracking and organization tool, not a medical decision-maker. A clinician's confirmed directions control all medications, exercises, restrictions, and rehabilitation progression. Conflicting instructions remain visibly unresolved until verified.

## 1. Product vision and success criteria

The app should feel like a calm recovery companion, not a hospital portal or a gamified productivity app. On a difficult day, it should still be useful in ten seconds. Its first screen answers: **What needs my attention now? What did I already do? What is one safe thing I can do next?**

**Success looks like:**
- Log a medication in two taps after initial setup, with an explicit final confirmation.
- Start or finish a cleared exercise in no more than three taps.
- See last confirmed dose, upcoming prescribed scheduled dose, and relevant safety notes without navigating to another page.
- Resume after a missed day without an intimidating backlog or shame-based streak reset.
- Export a complete, understandable record for the patient, surgeon, physical therapist, or an authorized AI agent.
- Work offline and remain useful on a phone with one hand while resting.

**Not goals for v1:** Diagnosing complications, issuing medication advice, calculating individualized rehabilitation clearance, automatically modifying orders, managing multiple patients, collecting analytics, or building an account system.

## 2. Roles, responsibilities, and authority

| Role | Responsibilities | Permissions |
|---|---|---|
| **Patient (owner)** | Records actual doses, symptoms, exercises, questions, appointments, and confirmations | Full control over local data; can propose edits, export/import, and approve changes |
| **Care partner (optional)** | Helps record an action when the patient cannot comfortably use the phone | Assisted logging after patient consent; logs always retain who entered them |
| **Surgeon / PA-C** | Confirms weight-bearing, brace, range-of-motion, wound-care and post-op orders | Source of medical instructions; not assumed to have direct app access |
| **Physical therapist** | Confirms start date, exercise technique, repetitions, and progression | Source for exercise plan; can review an exported summary |
| **Pharmacist / prescriber** | Reconciles medications, dosing, and interactions | Confirms medication questions and updates |
| **AI assistant / coding agent** | Reads structured exports, summarizes trends, identifies missing data, proposes UI changes | Read-only by default; any change to recorded events or care orders requires explicit patient review and provenance |

**Order priority:** A verified individualized clinician instruction overrides a generic handout. When two documents disagree, mark **Needs confirmation** rather than silently choosing a new schedule or permitting progression.

## 3. Initial care-plan seed — must be reviewed before activation

### Documented surgery
- Date: `2026-11-06`
- Side: left knee
- Procedures: ACL reconstruction with quadriceps tendon autograft; medial meniscus repair; lateral extra-articular tenodesis (LET).
- Source: user-provided discharge and physical therapy paperwork, November 6, 2026.

### Medication orders to enter (not proof of ingestion)

| Medication | Prescription shown | Interface behavior |
|---|---|---|
| Aspirin, delayed-release, 81 mg | 1 tablet orally twice daily with meals for 6 weeks | Scheduled, but **confirm course start and exact times**; emphasize clot-prevention adherence; never suggest doubling |
| Oxycodone, 5 mg | 1–2 tablets orally every 4–6 hours **as needed** for pain | PRN; record tablet count, actual dose, pain, and timestamp; no invented daily maximum |
| Acetaminophen (Tylenol), 500 mg | 1–2 tablets orally every 8 hours **as needed**; maximum **3,000 mg per rolling 24 hours** | Compute recorded rolling 24-hour total and warn before exceeding; account for other acetaminophen products if added |
| Ibuprofen, 400 mg | 1 tablet orally every 8 hours **as needed** with food; prescription notes maximum 2,400 mg/24 hours | Display **aspirin–ibuprofen interaction: prescriber/pharmacist confirmation required**; do not auto-schedule |
| Polyethylene glycol 3350 (MiraLAX), 17 g | 1 packet orally once daily **as needed** for constipation prevention; hold for loose stools | PRN; track bowel movement if desired; do not mark taken until confirmed |

**Medication safeguards:**
- Initial entries from photographs of a handwritten medication log are **unverified**. Ask the patient to confirm the medication, amount, and time before importing them as taken.
- Distinguish `scheduled`, `as needed (PRN)`, `taken`, `skipped`, `snoozed`, `not recorded`, and `not yet confirmed`.
- Never equate a prescription's presence with a dose taken.
- No automatic 'take now' recommendation for a missed or conflicting dose. Instead show the label and advise checking the prescription or clinician.
- Record the exact local time plus a UTC timestamp and time-zone identifier; handle daylight saving time.
- Provide a gentle possible-duplicate warning, not an irreversible block; require explicit correction/override and log it.
- Medication orders are versioned with start/end validity and the person/source confirming them. Historical logs retain the order version in effect.

### Restrictions and conflicts — launch with an unresolved banner

| Topic | What is in the paperwork | v1 state |
|---|---|---|
| Toe-touch weight-bearing | Individual PT order: **2 weeks**; generic postoperative packet: **6 weeks** | **Needs surgeon confirmation.** Do not suggest increased loading at 2 weeks. Until clarified, keep conservative restriction and recommend direct contact. |
| Physical therapy start | Individual discharge/PT instructions: **3–5 days / week 1**; another handout: **after 2-week appointment** | **Needs surgeon confirmation.** Do not assert that exercise sessions have been approved. |
| Knee bending | Restrict flexion to **0–90°** in early recovery; generic packet says first 6 weeks | Keep 90° limit until formally cleared. |
| Brace | Locked at **0°** for ambulation; separate packet also says locked for sleeping/showering | Show as an unresolved instruction for sleeping/showering until confirmed; never prompt unsafe unbraced walking. |
| Cold therapy | 20–30 minutes, at least four times daily during early recovery per handout | Require dry barrier between the entire cold pad and skin; do not imply continuous cooling is safe. |

Other documented care: keep early postoperative dressing until approximately 48 hours as instructed; leave Steri-Strips in place; elevate without sustained pillow pressure behind the knee; follow prescribed wound care and follow-up instructions.

### Exercises provided (not automatically cleared)

| Exercise | Tracking input | Key guardrail |
|---|---|---|
| Assisted heel slides | Sets/reps; comfort; maximum bend if measured | Never exceed currently authorized 90° flexion; do not force range of motion |
| Quadriceps isometric sets | Sets/reps and hold duration, if PT assigns | Gentle activation; stop for concerning symptoms |
| Straight-leg raises | Reps; brace on/off; quality | Brace locked initially as described; do not unlock or progress without quadriceps control and clearance |
| Heel-supported gravity extension | Session duration; comfort | Support heel/ankle, not under knee; packet suggests 30 minutes three times daily, subject to clinician confirmation |

Exercises require fields `cleared: true/false`, `cleared_by`, `cleared_on`, `instructions_version`, and user-confirmed session completion. Do **not** create additional exercises as if prescribed.

### Follow-up milestones (not automatic clearance)
- Dressing/shower check: 48 hours post-surgery, subject to actual surgery finish time and wound instructions.
- First clinic visit: documents variously mention 7–10 days or approximately 2 weeks; confirmation needed.
- Surgeon follow-up: about 6 weeks.
- Milestones are informational until appointments are actually confirmed.

## 4. Information architecture: five views, one primary action

**Navigation:** `Today` · `Medications` · `Movement` · `Progress` · `Plan`. Settings and Export live behind a small utility menu. The default landing view is always Today.

### Today — the ADHD-friendly command center

```text
RECOVERY OS                                 Day 1 after surgery
Good evening. One thing at a time.

[ NEEDS CONFIRMATION ]  Weight-bearing / PT start differ

UP NEXT
┌─────────────────────────────────────────────────────────┐
│ Scheduled medication or approved recovery task         │
│ What • why • when • last confirmed                     │
│ [Review]                            [Log when done]     │
└─────────────────────────────────────────────────────────┘

TODAY AT A GLANCE
[ Meds logged  ]  [ Movement ]  [ Ice / elevate ]

[ + Quick log ]     [ I feel overwhelmed ]

Recently done     7:25 PM  •  Ice session (sample only)
```

The sample time is placeholder UI, not a claimed patient action. No more than **three actionable cards** are visible initially. Remaining tasks sit under a collapsed **Later** section. PRN medication must never appear as a compulsory overdue task.

**Quick Log** opens a bottom sheet with large choices: `Medication`, `Exercise`, `Ice/elevate`, `Pain/check-in`, `Note`. Default values are not pre-committed. Confirmation creates the event.

### Medications
- Compact medication cards: name and strength, prescribed directions, last confirmed taken, current status, and `Log dose`.
- PRN drugs show **Available to log if taken**, not **Due**.
- Dose sheet confirms pill count, milligrams, actual administration time, optional pain score, and `Record dose`.
- Show a 24-hour acetaminophen tally and alerts for possible overlap, uncertain orders, or potentially interacting drugs.
- Clear, editable history with an audit trail for corrections; no silent changes.

### Movement
- Daily exercise list is separated into `Cleared`, `Pending clinician confirmation`, and `Completed`.
- Exercise cards include a single sentence on how to perform it, optional illustration, prescribed parameters, and a clear `Start` action.
- Sessions can be paused, stopped early, or marked **Not today** without penalty.
- Record sets/reps/duration and a simple comfort response: `Comfortable`, `Mild discomfort`, `Stopped due to symptoms`.
- Do not treat a timer completing as proof of exercise completion.

### Progress
- Optional 15-second check-in: pain (0–10), swelling (`less / same / more / unsure`), sleep, bowel movement, medication side effects, and a free-text note.
- Show week-over-week patterns, not artificial health scores or pseudo-clinical predictions.
- One-tap `Prepare follow-up` creates a short summary of logged doses, completed sessions, symptom trends, questions, and unresolved discrepancies.
- High-priority symptoms (such as chest pain, shortness of breath, severe calf symptoms, fever, concerning wound changes) show an explicit care-seeking instruction rather than a reassuring score.

### Plan
- Dated milestone timeline with `confirmed`, `planned`, or `needs confirmation` labels.
- Care-team contact card, visit questions, original prescription wording, and source-document notes.
- A prominent **Questions for surgeon** list with the weight-bearing, physical therapy, brace, and aspirin/ibuprofen discrepancies.
- A simple journal and appointment log.

## 5. ADHD / ADD-specific interaction principles

1. **One next action:** No giant master checklist on the home page.
2. **Progressive disclosure:** Extra history, instructions, and complex details open on demand.
3. **Visible completion:** Small, calm checkmarks and a recent-events list; avoid confetti, flashing, loud sounds, and high-pressure streaks.
4. **No shame:** Replace `Missed 3 tasks` with `You can pick up here`. Hide stale tasks unless they remain medically relevant.
5. **Low-energy mode:** Larger text, fewer controls, one task at a time, simple language, no animations.
6. **Fast recovery from mistakes:** Undo or correct with a reason; preserve the original event and corrected event in an audit trail.
7. **Task initiation support:** Buttons say `Log aspirin` or `Start heel slide session`, never vague `Continue`.
8. **Context always visible:** Show surgery day count, current restrictions, and last confirmed medication event without searching.
9. **Gentle reminders:** Custom windows and a `Not now` option. No guilt messaging. Never count PRN doses as missed.
10. **Accessible interaction:** WCAG 2.2 AA target; 44×44 px touch targets as a practical design minimum, large readable type, strong focus states, semantic labels, screen-reader support, reduced-motion mode, and tested contrast.

## 6. Styling and visual system

**Aesthetic:** Minimal, calm, clinically trustworthy without looking institutional. Off-white background, charcoal typography, muted indigo as the primary accent, and restrained amber only for unresolved confirmation items. No gradients or colorful dashboards.

Suggested tokens:

```css
:root {
  --background: #F7F8F6;
  --surface: #FFFFFF;
  --text: #20262B;
  --muted: #64717A;
  --primary: #3D5675;
  --primary-soft: #E9EEF4;
  --warning: #805A1D;
  --warning-soft: #FBF2DF;
  --border: #DDE3E6;
  --radius-card: 16px;
  --radius-control: 12px;
  --tap-target: 48px;
}
```

Use system fonts; body 16–18 px, section headings 20–24 px, generous vertical spacing, 1 px borders, restrained shadows, no horizontal scrolling. Bottom navigation on phones; compact side navigation only on larger screens. Dark mode is optional, with a low-stimulation rather than high-contrast neon palette.

## 7. Static architecture and agent-readable data

**Recommended stack:** `index.html`, `styles.css`, modular vanilla JavaScript, an installable Progressive Web App (PWA) manifest, and a service worker to cache static assets. Avoid frameworks, authentication, and cloud dependencies for v1. Serve over HTTPS (or localhost during development).

**Persistence:** IndexedDB is the primary browser-side event store. Store derived UI preferences separately. Use schema migrations, transactional writes, periodic export prompts, and `navigator.storage.persist()` when available. Browser data can still be deleted, evicted, or lost: **exported backups are essential**.

**Key rule:** Markdown is excellent for **human/AI instructions and summaries**, but not a reliable transactional medication database. Structured JSON is the canonical exchange format; Markdown is a generated, readable representation.

Suggested repository structure:

```text
recovery-os/
├── index.html
├── styles.css
├── manifest.webmanifest
├── sw.js
├── js/
│   ├── app.js
│   ├── db.js
│   ├── medications.js
│   ├── exercises.js
│   ├── reminders.js
│   ├── export-import.js
│   └── safety-rules.js
├── docs/
│   ├── SPEC.md                   # this document
│   ├── AGENTS.md                 # AI operating instructions
│   └── care-plan-template.md     # no personal identifiers
├── schemas/
│   └── recovery-export.schema.json
└── tests/
    ├── meds.test.js
    ├── event-log.test.js
    └── safety.test.js
```

**Data placement:** Do not commit real patient event logs, medical files, full names, dates of birth, addresses, or prescriptions to a publicly served repository. Real data lives in the patient's device and private, manually exported files. De-identified sample data is allowed in tests.

### Canonical JSON export, simplified example

```json
{
  "schema_version": "1.0.0",
  "exported_at": "<ISO-8601 UTC timestamp>",
  "timezone": "America/Los_Angeles",
  "profile": { "surgery_date": "2026-11-06", "surgical_side": "left" },
  "care_orders": [
    {
      "id": "med-aspirin-81",
      "type": "medication",
      "status": "needs_schedule_confirmation",
      "directions": "81 mg by mouth twice daily with meals for six weeks",
      "source": "Prescription report dated 2026-11-06"
    }
  ],
  "events": [],
  "unresolved_questions": [
    {
      "id": "weight-bearing-duration",
      "status": "needs_clinician_confirmation",
      "conflicting_values": ["2 weeks", "6 weeks"]
    }
  ]
}
```

`events: []` intentionally contains **no assumed doses or exercise completions**.

### Event schema (conceptual)

Every logged activity includes `id`, `event_type`, `occurred_at`, `recorded_at`, `timezone`, `created_by`, `source`, `order_version`, `status`, and `notes`; medication events also store `medication_id`, `strength_mg`, `quantity`, and `total_mg`. Exercise events store `exercise_id`, `sets`, `reps`, `duration_seconds`, `symptom_response`, and `completed`.

Changes are modeled as **corrections** referencing the prior event. The current UI view is derived from events, preserving what was first entered and what was later corrected.

### Agent interoperability contract

- An authorized AI agent can read `AGENTS.md`, the de-identified product spec, and an explicitly provided `recovery-export.json` or generated `daily-summary.md`.
- The agent may summarize patterns, draft visit questions, or propose a data correction, but cannot invent doses, automatically mark medication taken, or revise orders.
- Agent suggestions are saved as **proposals**, not applied events. The patient previews and explicitly accepts or rejects each change.
- Every accepted proposal records who proposed it, who approved it, timestamp, and source.
- Import validates the JSON schema, checks duplicate IDs, shows a human-readable diff, and requires confirmation before committing.
- Treat all text imported from external documents or AI output as untrusted data. Never execute code embedded in notes or Markdown.

### Privacy and security

- No third-party analytics, ad trackers, remote fonts, or CDN scripts.
- Default to local-only operation; HTTPS for hosting; Content Security Policy; safe text rendering without injecting untrusted HTML.
- Optional passphrase-encrypted **exports** using Web Crypto can be added later. A cosmetic PIN without encryption is not a meaningful privacy guarantee.
- Provide `Export JSON`, `Export visit summary (Markdown)`, `Import backup`, and `Erase local data` with prominent confirmations.
- A static site has **no automatic cross-device synchronization**. If synchronization becomes necessary, design a separate opt-in authenticated and encrypted sync service; do not pretend local browser storage syncs itself.

## 8. Reminders that do not overpromise

- **Inside the open app:** Time-based visual reminders and optional sound/vibration only with the patient's preferences and consent.
- **Outside the app:** Browser background notifications and periodic background tasks are not dependable enough across mobile browsers to serve as the only safety-critical medication reminders.
- For important scheduled doses, offer a user-reviewed `Add to iPhone Reminders / Calendar` workflow or instructions to configure an operating-system alarm. Do not claim that a static page can reliably ring while closed.
- Each reminder means **check status**; it never records a dose on behalf of the patient.
- Do not schedule reminders for PRN medicines by default.

## 9. Safety, escalation, and guardrails

- Separate **clinical restrictions** from **UI preferences**; a user can change font size but not silently waive a clinician-imposed range-of-motion limit.
- Prominently display unresolved medical conflicts; require source and date when updating them.
- Give explicit emergency direction for chest pain or shortness of breath; prompt immediate clinician contact for severe calf pain/swelling, fever, unusual wound changes, or uncontrolled pain.
- Medication checks should warn about potentially hazardous acetaminophen totals, possible duplicate entries, and the aspirin–ibuprofen issue; warnings are **not** a substitute for clinician/pharmacist review.
- `No log` does not mean `not taken`; missing data must be labeled **Not recorded**.
- If data is stale or missing, say so. Never infer adherence, healing, recovery clearance, or diagnosis from incomplete data.
- Display a concise note that the app organizes information and does not replace individualized medical advice.

## 10. Build sequence and acceptance criteria

### Phase 1 — Stable foundation
Create mobile-first static shell, navigation, light visual system, data schema, IndexedDB event storage, offline shell, onboarding, source-of-truth plan, and safe export/import. Seed medication/exercise orders as **unconfirmed where required**; do not seed fake taken events.

**Done when:** The site loads offline after first visit; a real action survives refresh; an export can be re-imported on a clean browser without losing history; medical conflicts remain visible.

### Phase 2 — Medication tracking
Implement medication cards, dose-entry sheets, actual-versus-planned timestamps, PRN handling, rolling acetaminophen calculation, duplicate warning, correction trail, and optional scheduled reminders while the app is open.

**Done when:** No dose is recorded without confirmation; an attempted amount above 3,000 mg acetaminophen in the preceding 24 hours prompts an unmistakable warning; PRN medication is never shown as overdue; past entries remain auditable.

### Phase 3 — Exercises, recovery check-ins, and insights
Implement exercise clearance gates, simple session tracking, icing/elevation tracker, daily symptom check-in, milestone list, chartless concise trend views, and clinician visit summary.

**Done when:** Uncleared exercises cannot be presented as prescribed due tasks; the user can stop midway without marking success; the visit summary quotes only recorded facts and flags unknowns.

### Phase 4 — Engagement and reliability polish
Add low-energy mode, accessibility review, concise optional encouragement, installable PWA, offline/error states, backup reminders, timezone/DST tests, export diff and import confirmation.

**Done when:** One-handed navigation works; screen readers can name all actionable controls; no user is penalized for a missed day; medication reminders do not imply reliable closed-app delivery.

### Phase 5 — Optional later upgrades
Private encrypted synchronization, caregiver mode, photo attachments stored only locally, PDF visit report, clinician-readable sharing packet, configurable operating-system reminders, and narrowly scoped AI-powered summaries. None of these should block a usable v1.

## 11. Test scenarios required before using it for real care logs

1. Record and confirm an actual dose; restart browser; verify identical dose and timestamp.
2. Cancel a dose-entry sheet; verify no event was created.
3. Attempt the same dose twice; verify duplicate warning and correction/audit path.
4. Log acetaminophen doses across midnight and daylight saving transitions; confirm **rolling 24-hour** total, not midnight-reset total.
5. Leave all doses blank; verify **Not recorded**, not **Missed** or **Taken**.
6. Verify oxycodone and ibuprofen remain **PRN** rather than scheduled tasks.
7. Verify unresolved 2-vs-6-week restriction prevents automatic clearance at day 14.
8. Import malformed or conflicting JSON; verify no partial overwrite.
9. Work in airplane mode; confirm normal logging after initial app cache and check secure backup recovery.
10. Check iPhone Safari Home Screen behavior, large text, VoiceOver, reduced motion, and 44+ px tap areas.
11. Simulate cleared site data; verify the app explains data loss and offers backup restore rather than presenting an empty history as complete.
12. Confirm the deployment contains no personal health logs or private exports.

## 12. First implementation task for the coding agent

> Implement **Phase 1 only** with complete files (not diffs). Create the static HTML/CSS/JavaScript structure, IndexedDB persistence, sample non-personal data, a working Today view, a Quick Log confirmation flow, export/import JSON, and `AGENTS.md`. Use the visual tokens in this document. Do not introduce a backend, account system, analytics, external libraries, or invented clinical guidance. Preserve all unresolved medical instructions as pending until clinician confirmation. Provide local run instructions and tests. Stop after Phase 1 so the patient can review the UI before medication behavior is implemented.
