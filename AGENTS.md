# AGENTS.md (repo root)

Operating rules for any coding agent working here are in **`docs/AGENTS.md`** (verbatim from the build plan) and the product spec is **`docs/SPEC.md`**. Read both before changing anything.

Status: **Phase 1 implemented** (see README.md → "What Phase 1 includes" and "Implementation choices"). Do not start Phase 2 without the patient's explicit go-ahead.

Quick checks before any PR:
- `node --test tests/*.test.js` must pass.
- No new dependencies, backend, analytics, remote fonts or inline scripts/styles (the page runs under a strict CSP).
- Never seed or commit doses taken, sessions completed, symptoms, names or contact details.
- Keep unresolved discrepancies visible as `needs_clinician_confirmation` until the patient records a clinician's answer with who/when/source.
- Bump `CACHE_VERSION` in `sw.js` and update its `ASSETS` list whenever files change.
