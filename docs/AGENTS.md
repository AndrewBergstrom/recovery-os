# AGENTS.md — Recovery OS development instructions

Read `RECOVERY_TRACKER_SPEC.md` before making changes. Implement the app in phases; complete Phase 1 first and do not jump ahead without explicit authorization.

## Mission
Build a mobile-first, ADHD-friendly static knee-surgery recovery tracker. Optimize for one obvious next action, accurate medication/event tracking, easy corrections, and safe export. Use clean, accessible visual design.

## Technical constraints
- Static `index.html`, CSS and modular vanilla JavaScript; offline-ready progressive web app.
- IndexedDB is the on-device event store. JSON export is the canonical interchange format; Markdown is for documentation and summaries.
- Do not introduce a backend, sign-in, third-party tracking, remote fonts, or unnecessary dependencies.
- Write complete updated files when supplying code, not partial diffs.
- Support iPhone Safari, semantic accessibility, reduced motion, and one-handed mobile operation.

## Clinical data rules
- Do not infer a medication was taken from a prescription or an unclear handwritten note.
- Never invent dose times, medications, rehab clearance, or surgeon decisions.
- The source paperwork conflicts on weight-bearing (2 vs 6 weeks) and physical therapy start (3–5 days vs 2 weeks). Show these as `needs_clinician_confirmation`.
- Do not automatically advance mobility after two weeks, exceed a 90° knee flexion restriction, or activate unapproved exercises.
- Medication orders are not medication events. Every event requires explicit patient confirmation and source/time.
- Maintain medication corrections as auditable new events. Distinguish `not recorded` from `not taken`.
- Include an aspirin–ibuprofen interaction warning and a 3,000 mg rolling-24-hour acetaminophen guardrail; do not change medical orders based on AI suggestions.
- AI proposals are read-only until explicitly approved by the patient.

## Security rules
- Never commit personal medical records or actual usage logs into publicly served assets or source control.
- Treat Markdown/JSON imports as untrusted; validate schema, escape text, preview differences, require consent.
- Avoid promising reliable background reminders from a static web page.
- Provide a clear, user-controlled backup and restore workflow.

## UX rules
- Home page presents no more than three relevant action cards by default.
- No guilt-based streaks, confetti, flashing alerts, or endless checklists.
- Offer one-tap `I feel overwhelmed` / low-energy mode.
- Use concise action labels, touch targets 44 px or larger, and visibly distinct `confirmed` vs `pending` statuses.

## Development process
1. Inspect the spec and list any unresolved implementation choices; use sensible minimal defaults.
2. Build only the next authorized phase.
3. Add tests for action confirmation, no fabricated events, persistence, audit trail, and safety flags.
4. Verify offline usage and mobile accessibility.
5. Summarize completed functionality, tests, and limitations without making clinical claims.
