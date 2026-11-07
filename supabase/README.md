# Supabase sync — setup (about five minutes)

Sync is optional. Without it the app is fully local. With it, every entry still saves on the device first, then pushes to **your own** Supabase project, and your other signed-in devices pull it (on open, when the app comes to the foreground, and about once a minute).

## 1. Create the project and the table

1. [supabase.com](https://supabase.com) → **New project** (free tier is fine). Pick a region near you.
2. **SQL Editor** → paste the contents of [`schema.sql`](schema.sql) → **Run**.

## 2. Sign-in emails

1. **Authentication → Sign In / Providers → Email**: keep *Enable email provider* on. Passwords aren't used.
2. **Authentication → URL Configuration**: set **Site URL** to the app's address (for example `https://andrewbergstrom.github.io/recovery-os/`) and add the same address with `**` to **Redirect URLs** (`https://andrewbergstrom.github.io/recovery-os/**`). The sign-in link returns there.
3. The built-in sender delivers only to members of your Supabase organization and is limited to about 2 emails per hour — fine for one person. New free projects can't edit the email templates until a **custom SMTP** provider is configured (Project Settings → Authentication → SMTP, e.g. Resend's free tier). With custom SMTP you can add `{{ .Token }}` to the *Magic link or OTP* template so the email also carries a 6-digit code.

### How signing in works in the app

Settings → Sync across devices → **Sign in with email**. The email contains a link (and a code, if you set up SMTP). Any of these finishes the sign-in:

- **Tap the link** — it opens the site, which picks up the session automatically. Easiest on a laptop.
- **Paste the link** — on an iPhone, a tapped link opens Safari rather than the installed home-screen app. Long-press the link in Mail → *Copy*, open the app, and paste it into *Paste the sign-in link*. The app verifies the link's token directly. Links are single-use.
- **Enter the code** — if the email shows one.

## 3. Point the app at the project

**Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (`sb_publishable_…`; older projects call it the *anon* key).

Either put them in [`js/config.js`](../js/config.js) and push (every device gets them):

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_…';
```

…or, on one device only, enter them in the app under **Settings → Sync across devices → Enter project URL and key**.

The publishable key is designed to be public; the row-level security policy in `schema.sql` is what keeps your rows private. Keep the **secret** key out of the app and out of the repo.

## 4. Sign in on each device

**Settings → Sync across devices → Sign in with email.** The first sign-in creates the account. On a second device the care plan, entries and settings sync down and the setup review is skipped. Optional hardening after your first sign-in: **Authentication → Sign In / Up → Allow new users to sign up: off**, so only your account can exist.

## How conflicts are handled

- Entries (doses, sessions, check-ins, notes) are append-only and never conflict. Corrections are new entries that reference the original.
- Everything else (order versions, questions, milestones, appointments, contacts, settings, pill states) is last-write-wins by the device's `updated_at`, enforced on the server by a trigger so an old write arriving late can't overwrite a newer one.
- Deletions (clearing an in-progress pill, removing sample entries) travel as tombstones.
- Each device keeps its own pull cursor (`synced_at`), so a device that was offline catches up in order.

## Privacy notes

- Data lives in your project's `records` table. Supabase encrypts at rest and in transit; enable **2FA** on your Supabase account.
- "Delete my cloud data" in Settings removes every row for your account. Sign other devices out first or they will push their copies back.
- JSON export/import keeps working and is still the recommended backup.

## Care partners (shared access)

Run [`02_care_circle_and_reminders.sql`](02_care_circle_and_reminders.sql) after `schema.sql`, and turn on **Authentication → Sign In / Providers → Allow anonymous sign-ins**.

- The owner invites a care partner from **Settings → Care partners → Invite a care partner** and texts them the link (`…/#invite=<token>`). Opening it on the partner's phone signs them in (anonymous auth bound to that device) and connects them to the owner's circle — no email, no password. Links are single-use; the owner can revoke access or issue a new link at any time.
- A care partner sees the owner's calendar, medications, movement and plan, can log entries (each entry records `created_by` = their name), and can turn on reminders for themselves. They cannot see other people's data: row-level security checks `care_circle` membership on every row.
- If a partner clears their browser data, the owner sends a new link.

## Push reminders

1. Deploy the Edge Function in [`functions/reminders`](functions/reminders) (Edge Functions → Deploy a new function → via editor: paste `index.ts` and `webpush.ts`, name it `reminders`). Turn **Verify JWT** off for this function — the cron calls it with a secret header, and the test path verifies the user's JWT itself.
2. Add the function secrets: `VAPID_PUBLIC_KEY` (same value as `js/config.js`), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:you@example.com`), `CRON_SECRET` (any long random string).
3. Schedule it: run the commented cron block at the end of `02_care_circle_and_reminders.sql` with your `CRON_SECRET`.
4. On each device: **Settings → Reminders on this device → Turn reminders on** (on iPhone the app must be on the Home Screen). "Send a test" confirms delivery.

The function imports the same schedule code the calendar uses (`js/reminders-due.js` via jsDelivr `@main`), so what it sends matches what the pills show: a "Time for …" push within five minutes of a required pill coming due, and — for care partners only — a "Not logged yet" nudge once the pill's grace window has passed. As-needed medicines and the optional check-in never trigger reminders. Each reminder is sent once (`reminder_log`).
