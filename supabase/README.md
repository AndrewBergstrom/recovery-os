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
