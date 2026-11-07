# AGENTS.md (repo root)

Operating rules for any coding agent working here are in **`docs/AGENTS.md`** (verbatim from the build plan) and the product spec is **`docs/SPEC.md`**. Read both before changing anything.

Status: **Phase 1 implemented**, plus the items README.md lists under *Pulled forward* (safety guardrails, session timer, sync, care partners, push reminders). See README.md → "What Phase 1 includes" and "Implementation choices". Do not start further phases without the patient's explicit go-ahead.

Quick checks before any PR:
- `node --test tests/*.test.js` must pass.
- No new dependencies, analytics, remote fonts or inline scripts/styles (the page runs under a strict CSP). The only network features are the optional Supabase sync (`js/sync.js`), care circle and push reminders (`js/push.js`, `supabase/functions/reminders`), added at the patient's request on 2026-11-07; they are opt-in, use only `fetch`, and the app must keep working with them unconfigured.
- `supabase/functions/reminders/index.ts` imports `js/reminders-due.js` and `js/seed.js` from jsDelivr pinned to a commit SHA. When `js/reminders-due.js`, `js/schedule.js`, `js/seed.js` or `js/time.js` change, bump that SHA and redeploy the function (Supabase dashboard → Edge Functions → reminders → Code → Deploy updates).
- Exercise guides (`js/exercise-guides.js`) describe how to do a movement; they never add reps, sets, holds, ranges or new exercises. Parameters stay on the order.
- Never seed or commit doses taken, sessions completed, symptoms, names or contact details.
- Keep unresolved discrepancies visible as `needs_clinician_confirmation` until the patient records a clinician's answer with who/when/source.
- Bump `CACHE_VERSION` in `sw.js` and update its `ASSETS` list whenever files change.
- The calendar's pill statuses are derived in `js/schedule.js` from recorded events + `slot_states`; a pill can only turn green because an entry exists. Keep it that way.
