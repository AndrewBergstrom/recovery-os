# Care-plan template (no personal identifiers)

This is the shape of the care-plan seed in `js/seed.js`. Copy it to transcribe a new
set of paperwork. Transcribe orders **as written**; never invent times, maximums,
clearances or follow-up dates. Where two documents disagree, add a question instead
of choosing.

## Profile
- Surgery date (YYYY-MM-DD), side, joint
- Procedures (list, as named in the operative/discharge report)
- Time zone (IANA id)
- Source document and date

## Medication orders (`type: medication`)
| Field | Meaning |
|---|---|
| `id` | stable slug, e.g. `med-<name>-<strength>` |
| `name`, `short_name`, `strength_mg`, `display_strength`, `unit` | as on the label |
| `directions` | verbatim prescription wording |
| `why` | one plain-language line for the patient |
| `schedule.kind` | `scheduled` or `prn` — PRN is never shown as due |
| `schedule.times` | `null` until confirmed; set via "Confirm schedule" which creates a new version |
| `rolling_24h_max_mg` | only if the label states one |
| `interaction_flags` | `{ with: <order id>, message }` for interactions needing prescriber review |
| `status` | `needs_schedule_confirmation`, `needs_prescriber_confirmation`, `prn`, `confirmed` |
| `source` | document and date |

## Exercise orders (`type: exercise`)
- `how_to` (one sentence), `tracking` (fields to record), `parameters`, `guardrail`
- `cleared: false` with `cleared_by`, `cleared_on`, `instructions_version` empty until a clinician clears it

## Restrictions
- Topic, current conservative reading, detail, `status` (`active` or `needs_clinician_confirmation`), linked `question_id`

## Questions (`needs_clinician_confirmation`)
- `topic`, who to ask, the conflicting values quoted from each document, a note on the conservative behaviour meanwhile

## Milestones
- Title, `when` (`offset_hours`, `offset_days` or `range_days` from surgery), `status` (`planned` / `needs_confirmation`), note

## Never in the seed
- Doses taken, sessions completed, symptoms — those are events the patient records.
- Names, dates of birth, addresses, MRNs, insurance or contact details.
