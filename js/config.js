// config.js — cross-device sync via the patient's own Supabase project.
// The publishable (anon) key is public by design; row-level security in
// supabase/schema.sql keeps rows private to the signed-in account. Values can
// also be entered in Settings → Sync, which overrides these on that device only.

export const SUPABASE_URL = 'https://aialohixjtwlmvywqqpe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_qwgCKRie180LXG1p_WKE7Q_o2iqvhws';

// Public VAPID key for push reminders (the private key lives only in the Edge Function's secrets).
export const VAPID_PUBLIC_KEY = 'BDjO6ibFckkNoRzMxPnDqKCHbYrXOO0ilVQZAtirqg1Jwc6ZT-OkwXqqFXDVW_WJV3PzoTSof6jdFBOlSbueRw4';
// Where invite links point. Must be an allowed redirect URL in the Supabase project.
export const APP_URL = 'https://andrewbergstrom.github.io/recovery-os/';
