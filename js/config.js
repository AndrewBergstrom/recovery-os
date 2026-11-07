// config.js — cross-device sync via the patient's own Supabase project.
// The publishable (anon) key is public by design; row-level security in
// supabase/schema.sql keeps rows private to the signed-in account. Values can
// also be entered in Settings → Sync, which overrides these on that device only.

export const SUPABASE_URL = 'https://aialohixjtwlmvywqqpe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_qwgCKRie180LXG1p_WKE7Q_o2iqvhws';
