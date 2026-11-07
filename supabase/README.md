# Supabase sync — setup (about five minutes)

Sync is optional. Without it the app is fully local. With it, every entry still saves on the device first, then pushes to **your own** Supabase project, and your other signed-in devices pull it (on open, when the app comes to the foreground, and about once a minute).

## 1. Create the project and the table

1. [supabase.com](https://supabase.com) → **New project** (free tier is fine). Pick a region near you.
2. **SQL Editor** → paste the contents of [`schema.sql`](schema.sql) → **Run**.

## 2. Turn on email-code sign-in

1. **Authentication → Providers → Email**: keep *Enable email provider* on. Password sign-in isn't used.
2. **Authentication → Email Templates → Magic Link**: make sure the body contains the one-time code, for example:

   ```
   <h2>Your Recovery OS code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```

   The app signs in with the 6-digit code rather than a link, because a link opened from Mail lands in Safari instead of the installed home-screen app.
3. Optional but recommended: **Authentication → Sign In / Up → Allow new users to sign up** can be turned *off* after your first sign-in, so only your account exists.

The built-in email sender is rate-limited (a few emails per hour) — plenty for one person. For anything more, add a custom SMTP provider under **Project Settings → Authentication**.

## 3. Point the app at the project

**Project Settings → API**: copy the **Project URL** and the **anon public** key.

Either put them in [`js/config.js`](../js/config.js) and push (every device gets them):

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ…';
```

…or, on one device only, enter them in the app under **Settings → Sync across devices → Enter project URL and key**.

The anon key is designed to be public; the row-level security policy in `schema.sql` is what keeps your rows private. Keep the **service_role** key out of the app and out of the repo.

## 4. Sign in on each device

**Settings → Sync across devices → Sign in with email code.** The first sign-in creates the account. On a second device the care plan, entries and settings sync down and the setup review is skipped.

## How conflicts are handled

- Entries (doses, sessions, check-ins, notes) are append-only and never conflict. Corrections are new entries that reference the original.
- Everything else (order versions, questions, milestones, appointments, contacts, settings, pill states) is last-write-wins by the device's `updated_at`, enforced on the server by a trigger so an old write arriving late can't overwrite a newer one.
- Deletions (clearing an in-progress pill, removing sample entries) travel as tombstones.
- Each device keeps its own pull cursor (`synced_at`), so a device that was offline catches up in order.

## Privacy notes

- Data lives in your project's `records` table. Supabase encrypts at rest and in transit; enable **2FA** on your Supabase account.
- "Delete my cloud data" in Settings removes every row for your account. Sign other devices out first or they will push their copies back.
- JSON export/import keeps working and is still the recommended backup.
