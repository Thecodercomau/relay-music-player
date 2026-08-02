/**
 * Relay Music Player — Supabase client setup (Supabase edition).
 *
 * Paste your project values here (Dashboard → Project Settings → API):
 *   - URL:      https://<your-project-ref>.supabase.co
 *   - anon key: the public "anon public" key (safe to ship in the browser)
 *
 * Like the old php/config.php, this file is meant to be edited per
 * deployment — it is checked in with empty placeholders.
 */
const RELAY_SUPABASE = {
  url: "https://vtgtwqlkymmslyteqlmc.supabase.co",
  anonKey: "sb_publishable_lJmTtMV16ALJjETzL5HC2w_Cxnv0LrF",
};

/** True once the config above has been filled in. */
function supabaseConfigured() {
  return Boolean(RELAY_SUPABASE.url && RELAY_SUPABASE.anonKey);
}

/** The supabase-js client (throws a clear error when not configured). */
let __supabaseClient = null;
function supabaseClient() {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured yet. Edit js/supabase.js with your project URL and anon key."
    );
  }
  if (!__supabaseClient) {
    __supabaseClient = window.supabase.createClient(RELAY_SUPABASE.url, RELAY_SUPABASE.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return __supabaseClient;
}

/** Base URL for the Edge Functions. */
function functionsBase() {
  return `${RELAY_SUPABASE.url}/functions/v1`;
}
