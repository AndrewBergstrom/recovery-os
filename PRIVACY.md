# Recovery OS — privacy and data handling

*Last updated 2026-11-07. This page describes how the app handles your information. It is not legal advice.*

## The short version

- Recovery OS is a personal tracking tool. **It is not a hospital, clinic, doctor, health plan or insurer, and it does not work on behalf of one.**
- Because of that, **HIPAA does not govern this app.** HIPAA applies to "covered entities" (providers, health plans, clearinghouses) and the contractors that handle data for them. A tool you choose to keep your own records in is neither. Nothing you put in the app changes your clinic's HIPAA duties, and the app never connects to a clinic, a patient portal or an insurer.
- You are always free to keep and share your own medical information. Entering your own discharge paperwork, medication list or PT schedule into the app breaks no privacy law.
- "Not covered by HIPAA" is not "no rules." The app is built to the rules that *do* reach consumer health apps: the FTC Act (truthful privacy practices and reasonable security), the FTC Health Breach Notification Rule, and Washington's My Health My Data Act. What that means in practice is below.

## What the app stores, and where

| Data | Where it lives | Who can see it |
|---|---|---|
| Your entries (doses, sessions, check-ins, notes), your care plan, settings | Your device, in the browser's local database | You, on that device |
| The same, if you turn on sync | A Supabase project **you own**, in a table locked to your account by row-level security | You, on your signed-in devices, and care partners you invite |
| Care partner access | A row in your project saying who you invited and when | You and that partner |
| Reminder subscriptions | A row per device that asked for reminders | The reminder function, to deliver pushes |

Nothing is sent anywhere else. There are no analytics, trackers, ad pixels, remote fonts or third-party scripts; the page's Content-Security-Policy forbids them. The public source code contains the care-plan *orders* transcribed from paperwork and no identifiers.

## What the app never does

- Never sells, rents or shares your information with anyone you did not invite.
- Never gives medical advice, diagnoses, or changes an order. It organizes what your clinicians already told you.
- Never records a dose, session or symptom on its own. Every entry is something you (or a partner you invited) confirmed.
- Never sends your data to an AI service. (If a document-upload feature is added later, it will ask for a separate, specific opt-in first, delete the uploaded files after extraction, and keep only the plan you confirm.)

## Your controls

- **Export** everything as JSON or a visit summary at any time (Settings → Backup and export).
- **Delete** every row in the cloud (Settings → Sync → Danger zone) and erase the device copy (Settings → Erase local data).
- **Revoke** a care partner at any time; they lose access immediately.
- **Turn reminders off** per device; the subscription is deleted.

## Security

- Access is limited by row-level security on every table: a signed-in account can read and write only its own rows and those of a circle it was invited into.
- Data is encrypted in transit (TLS) and at rest by the database host.
- Secrets (push signing keys, the cron secret) live only in the server function's secret store, never in the repository or the browser.
- The app runs under a strict Content-Security-Policy; no inline scripts, no third-party code.

## If something goes wrong

If information were ever accessed or shared without authorization, affected people would be told what happened and what was exposed, and the notices required by the FTC Health Breach Notification Rule and Washington law would be made.

## Contact

Questions or requests about your data: open an issue on the project repository or email the project owner (address in the repository profile). Requests to see or delete your data are honored; there is nothing to appeal because the answer is yes.
