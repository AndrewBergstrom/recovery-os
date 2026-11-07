# Recovery OS

A personal knee-surgery recovery tracker. Static HTML/CSS/vanilla JS, installable as a PWA, works offline after the first visit; optional cross-device sync, care-partner access and push reminders through a Supabase project you own. **Phase 1 (foundation) is implemented**, plus the items listed under *Pulled forward* below; the remaining phases are not.

> Recovery OS organizes the patient's own entries. It does not give medical advice, diagnose complications or change orders. A clinician's confirmed directions control medications, exercises, restrictions and progression. Conflicting paperwork stays visibly unresolved until a clinician settles it.

Spec: [`docs/SPEC.md`](docs/SPEC.md) · Agent rules: [`docs/AGENTS.md`](docs/AGENTS.md) · Export schema: [`schemas/recovery-export.schema.json`](schemas/recovery-export.schema.json)

## Run locally

No build step and no dependencies.

```bash
# any static server works; the service worker needs localhost or HTTPS
python3 -m http.server 8080 --bind 127.0.0.1
# then open http://127.0.0.1:8080/
```

Or `npx serve .` — anything that serves the folder as-is.

## Tests

```bash
node --experimental-strip-types --test tests/*.test.js   # Node 22+ (node:test, no packages)
```

65 tests cover: care circle + member mode (invite → anonymous sign-in → member sees the owner's records; revoked members drop out of reminder fan-out), reminder computation, Web Push crypto (RFC 8291/8292) against an independent receiver; every exercise has a visual guide whose steps prescribe no counts; surgery day is never red; sync (two devices exchanging entries, order versions, tombstones; last-write-wins; erase-and-restore; token refresh) via an in-memory stand-in for Supabase; calendar slots and their statuses (upcoming → due → red; PRN never a slot; uncleared exercises never a slot; loose entries attach to the nearest slot); no fabricated events in the seed; cancel stores nothing; a stored dose round-trips exactly; corrections supersede but preserve originals; the acetaminophen total is a **rolling 24 h** window across midnight and both 2026 DST transitions; PRN medicines are never due; uncleared exercises are never due; day 14 never auto-advances weight-bearing; export → import into a clean store keeps every entry; malformed or conflicting backups never partially overwrite.

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` publishes the repo root on every push to `main`. In the repo settings, Pages → Source must be **GitHub Actions** (done once). The site is served over HTTPS, so the service worker and "Add to Home Screen" work.

Any other static host works too. If the host lets you set headers, send this Content-Security-Policy as a header as well as the `<meta>` tag already in `index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

**Data placement.** The repo contains the care-plan *orders* transcribed from the paperwork (medication directions, exercise descriptions, open questions) and no identifiers — no name, date of birth, address, MRN or contact details. Real entries (doses, sessions, check-ins, contacts, appointments) live only in the browser's IndexedDB and in backups the patient exports. Never commit an exported backup.

## The calendar (main screen)

- **Still to do today** panel under the day header: what is left, grouped — scheduled meds by medicine, **as-needed** medicines with their earliest-next window ("not before 3:05 PM" / "ok now"), exercises as one chip per session ("9:30 AM · 2/4"), ice times, check-in, and the day's visits — each a tappable chip in its status colour, with the next thing (or an unrecorded one) called out on top. On future days it reads *Planned*.
- **Day strip** (phones) with a completion ring per day; **7-day grid** on wide screens, each column grouped into Morning / Afternoon / Evening, past days dimmed.
- **Pills**, one per planned item, on an hour-by-hour timeline: scheduled medications (confirmed times, or dashed placeholder times until the schedule is confirmed — an unconfirmed twice-daily placeholder re-anchors 12 h after the last recorded dose), ice + elevate, the optional check-in, milestones and appointments. All cleared exercises at one routine time are **one "Exercises" pill** with its progress; tapping it lists that session's exercises.
- Tap a pill → answer its questions → it changes colour: **green** done · **amber** in progress (after *Start now*) or partly done (a session with some exercises recorded) · **red** not recorded once its time plus a grace window has passed · indigo = due now · grey = upcoming / optional / skipped. Translucent fill, bold border. Pills that have no status colour yet carry an icon tinted by kind (indigo meds, orange exercise, blue ice, plum visits) so a column scans by hue, not by reading.
- Entries recorded from a pill carry its `slot_id`; entries logged loosely attach to the nearest unfilled slot of the same kind that day.
- **As-needed** medicines also sit in their own row below the timeline: tap to log, shows today's count and last time. Never due, never red. A predicted *earliest next* pill appears on the timeline after each as-needed dose (minimum interval from the order).
- **Surgery day** is never red and counts nothing — the home routine starts the next day.
- Times come from the **Daily routine** in Settings (ice 4×/day, check-in, exercise sessions, aspirin placeholders). They place pills only; they never change an order.
- *I feel overwhelmed* collapses the screen to the single next pill.

## Cross-device sync (optional, Supabase)

Off by default. When configured, the app stays offline-first: every write lands in IndexedDB, then in an outbox that pushes to a single row-level-secured `records` table in **your own** Supabase project; other signed-in devices pull on open, on foreground and about once a minute. Sign-in is an emailed link (tap it, or paste it into the installed app, or type the 6-digit code if the project's email template includes one) — no password. Entries are append-only and never conflict; everything else is last-write-wins by `updated_at`, enforced by a server trigger. Setup: [`supabase/README.md`](supabase/README.md) (schema in [`supabase/schema.sql`](supabase/schema.sql); keys in [`js/config.js`](js/config.js) or Settings → Sync). No SDK — a few `fetch` calls, so the strict CSP and zero-dependency rule still hold.

## Care partners and reminders

A care partner gets their own login through an invite link (no email needed), sees everything, can log entries under their own name, and can turn on push reminders. The owner can revoke a partner at any time (and remove the revoked row); the reminder function drops subscriptions of anyone who is no longer an active member. Reminders come from a Supabase Edge Function on a 5-minute cron that reuses `js/reminders-due.js` — the same schedule as the calendar — so a push arrives when a pill comes due, plus a "not logged yet" nudge to partners after the grace window. Setup in [`supabase/README.md`](supabase/README.md).

## What Phase 1 includes

- Mobile-first shell with bottom navigation (side navigation ≥ 880 px): **Calendar · Meds · Movement · Progress · Plan**, plus Settings & backup behind the gear.
- Onboarding that reviews the care-plan seed (orders, open questions, exercises, restrictions, milestones) before activation. Activation records that the orders were reviewed — never that anything was taken.
- **Calendar**: see above. Plus the *to confirm with clinicians* banner, *Quick log*, *I feel overwhelmed*, current restrictions and *If something feels wrong*.
- **Quick Log** bottom sheet: Medication, Exercise, Ice/elevate, Pain/check-in, Note. Defaults are shown but nothing is stored until the final *Record* button; closing the sheet creates no event.
  - Medication: pill count, mg total, actual time, optional pain score, optional care-partner attribution; shows the rolling 24 h acetaminophen total and an unmistakable warning (with explicit acknowledgement) above 3,000 mg; gentle possible-duplicate warning within 60 min; aspirin–ibuprofen interaction notice; ibuprofen's own label maximum.
  - Exercise: cleared vs not-cleared is explicit; stopping early or *Not today* carries no penalty; max bend > 90° is refused until cleared.
  - Ice/elevate: requires confirming the dry barrier; handout guidance shown.
  - Check-in: pain 0–10, swelling, high-priority symptom flags → explicit care-seeking instruction, never a score.
- **Medications**: order cards with prescription wording, status (*Schedule needs confirmation*, *As needed · available to log if taken*, *Prescriber confirmation required*, *Confirmed*), last confirmed dose or *Not recorded*, safeguards, *Confirm schedule* (creates a new order **version** with who/when/source; the old version is kept and historical events keep their version), full history with *Correct* (reason required; originals preserved), honest reminder policy and OS-reminder suggestions.
- **Movement**: Cleared / Pending clinician confirmation / Completed. Every exercise card carries a **start → finish diagram** (side view, operated leg highlighted, guardrail drawn in) and numbered plain-language steps; the same guide opens from the calendar's exercise sheet and, collapsed, inside the record form. *Mark as cleared* requires who, when and instructions version. Uncleared exercises are never presented as due. *Start now* keeps a session in progress until you confirm what you actually did.
- **Progress**: chartless last-7-days table (*Not recorded* for empty days), recent check-ins, symptom flags, *Prepare follow-up summary*.
- **Plan**: surgery details, the five open questions with *Record the answer* (requires who/when/source), patient questions for the visit, current restrictions, milestones (informational until confirmed), appointments, care-team contacts, original prescription wording, source documents, journal.
- **Settings & backup**: text size, light/dark (low-stimulation) theme, reduced motion, low-energy mode, care partner (with patient consent), storage status + persistent-storage request, **Export JSON**, **Export visit summary (Markdown)**, **Import backup** (validated, diffed, confirmed, written in one transaction, conflicts never overwrite), sample entries (clearly labelled, no doses), **Erase local data** (double confirmation).
- Data-loss notice: if this browser had entries before and the store is now empty, Today says so and offers *Import backup* instead of presenting an empty history as complete.
- PWA: `manifest.webmanifest`, `sw.js` (app shell cached; navigations network-first), icons, iOS meta tags, safe-area padding.
- Accessibility: semantic landmarks, 48 px tap targets, visible focus, dialog focus trap + Escape, `aria-live` toasts, text-size control, `prefers-reduced-motion` honoured, no inline scripts/styles (strict CSP).

## Implementation choices (unresolved in the spec; sensible defaults chosen)

| Choice | Default |
|---|---|
| Day count | Surgery day = **Day 0** (clinical POD convention); Nov 7 = Day 1 |
| Open questions | The four discrepancies in the spec plus *first clinic visit timing* (5 total) |
| Settings route | `#more` rather than `#settings` (some embedding viewers reserve that hash) |
| Order versions | Stored as `id@v<n>` keys; the highest version per id is current; previous versions keep `valid_to` |
| Corrections | A correction event references the prior event (`corrects`); a *void* is a tombstone correction; the current view is derived |
| Pill grace windows (minutes after slot time before red) | medication 60 · ice 90 · exercise 120 · check-in never red (optional) |
| Routine defaults | ice 09:00/13:00/17:00/21:00 · check-in 20:00 · exercises 09:30/14:30/19:30 · aspirin placeholders 08:00/18:00 |
| Pulled forward from later phases | Rolling acetaminophen warning, duplicate warning and interaction notice in the Quick Log medication sheet (Phase 2); *Start now* session timer for exercises and ice (Phase 3); cross-device sync, care-partner access and push reminders (not in the original phases — added at the patient's request on 2026-11-07). |
| Exports in embedded viewers | Export sheets offer **Copy** as well as **Download**, because some viewers block downloads |
| Sample data | Loaded only on request from Settings, tagged `created_by: "sample"`, contains no medication doses |
| Exercise sessions | Drawn as one pill per routine time; status = in progress > all done > partly done (amber) > due > not recorded > upcoming. Completion still counts each exercise |
| Exercise guides | `js/exercise-guides.js` — original line diagrams + steps per seeded exercise; steps never add reps, sets, holds or ranges (a test enforces it) |
| Surgery day | Routine slots are optional that day: loggable, never red, not counted |
| Service worker | Fetches with `cache: 'no-cache'` and precaches with `cache: 'reload'`, so a deploy lands on the next load despite GitHub Pages' 10-minute HTTP cache |
| Edge Function imports | `supabase/functions/reminders/index.ts` imports app modules from jsDelivr pinned to a commit SHA (branch URLs cache for hours); bump the SHA and redeploy when schedule code changes |

## Repository layout

```
index.html  styles.css  manifest.webmanifest  sw.js  package.json
icons/            PNG icons (generated, abstract mark)
js/               app.js db.js events.js schedule.js sync.js push.js reminders-due.js config.js medications.js
                  exercises.js exercise-guides.js safety-rules.js reminders.js export-import.js time.js ui.js prefs.js
                  seed.js sample-data.js
js/views/         calendar medications movement progress plan more onboarding quick-log shared sync-ui care-ui
supabase/         schema.sql  02_care_circle_and_reminders.sql  functions/reminders/  README.md
docs/             SPEC.md  AGENTS.md  care-plan-template.md
schemas/          recovery-export.schema.json
tests/            event-log meds safety schedule sync care-circle webpush guides export-import time
                  (node:test; fake-supabase.js stand-in)
.github/workflows/pages.yml
```

## Known limitations (Phase 1)

- Reminders need sync + the Edge Function and a device with notifications allowed (on iPhone: installed on the Home Screen). Without them the app never claims to ring while closed.
- The in-progress timer is a prompt, not proof: a session is recorded only when you confirm what you did.
- No encryption of exports (Phase 5); keep backups private.
- Cross-device sync is optional and needs your own Supabase project; without it, move data with export/import.
- Browser storage can still be evicted. The JSON export is the real backup.
