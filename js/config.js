// config.js — optional cross-device sync via your own Supabase project.
// Leave both empty to run fully local (the default). The anon key is a public
// key by design; row-level security in supabase/schema.sql keeps data private
// to the signed-in account. Values can also be entered in Settings → Sync,
// which overrides these on that device only.

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
