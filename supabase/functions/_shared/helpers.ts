/**
 * Relay Music Player — shared helpers for Supabase Edge Functions.
 *
 * Every function:
 *   - answers CORS preflight (OPTIONS)
 *   - reads the user from the `Authorization: Bearer <jwt>` header
 *   - talks to Postgres / Storage through the service role client
 */

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/** JSON response with CORS headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

/** Handle a CORS preflight request. Returns a Response, or null to continue. */
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }
  return null;
}

/** Service-role client — full database access, bypasses RLS. Server-side only. */
export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Verify the JWT in the Authorization header against Supabase Auth.
 * Returns the user, or null when missing/invalid.
 */
export async function getUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

/** The public profile row for a user, or null. */
export async function getProfile(userId: string) {
  const { data, error } = await admin()
    .from("profiles")
    .select("id, name, email, is_admin, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return data as {
    id: string;
    name: string;
    email: string;
    is_admin: boolean;
    created_at: string;
  } | null;
}

/** Require a logged-in user; returns the user or a 401 Response. */
export async function requireUser(req: Request): Promise<{ user: User } | { error: Response }> {
  const user = await getUser(req);
  if (!user) {
    return { error: json({ error: "Not authenticated. Please log in." }, 401) };
  }
  return { user };
}

/** Require an admin; returns { ok } or an error Response. */
export async function requireAdmin(userId: string): Promise<{ ok: true } | { error: Response }> {
  const profile = await getProfile(userId);
  if (!profile || !profile.is_admin) {
    return { error: json({ error: "Admin access required." }, 403) };
  }
  return { ok: true };
}

/** Read the JSON body of a request (empty object when absent). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Map a Supabase PostgREST error to a friendly message. */
export function dbErrorMessage(error: { message?: string } | null, fallback: string): string {
  if (!error || !error.message) return fallback;
  const msg = error.message;
  if (/duplicate key/i.test(msg)) return "That already exists.";
  return msg;
}

/** True when the URL is a Jamendo HTTPS host (SSRF guard for the stream proxy). */
export function isJamendoUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "jamendo.com" || host === "jamendo.net" ||
      host.endsWith(".jamendo.com") || host.endsWith(".jamendo.net");
  } catch {
    return false;
  }
}

/** True when the URL points at our own uploads storage bucket (relative or absolute). */
export function isStorageUrl(raw: string, supabaseUrl: string): boolean {
  if (raw.startsWith("/storage/v1/object/public/uploads/")) return true;
  if (supabaseUrl && raw.startsWith(supabaseUrl + "/storage/v1/object/public/uploads/")) return true;
  return false;
}

export function storageObjectName(raw: string): string | null {
  const marker = "/storage/v1/object/public/uploads/";
  const i = raw.indexOf(marker);
  if (i === -1) return null;
  const rest = raw.slice(i + marker.length);
  // Strip any query string
  const clean = rest.split("?")[0];
  return clean || null;
}

export const JAMENDO_CLIENT_ID = Deno.env.get("JAMENDO_CLIENT_ID") ?? "";

/**
 * Fetch a URL and decode JSON, retrying over Jamendo's flaky, load-balanced
 * backend (it intermittently answers valid queries with an empty result
 * list or a transient "failed" status).
 */
export async function fetchJson(
  url: string,
  requireResults = false,
  maxAttempts = 3,
): Promise<Record<string, unknown> | null> {
  let last: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await fetchJsonOnce(url);
    const failed = last === null ||
      (last.headers as Record<string, unknown> | undefined)?.status === "failed" ||
      (requireResults && Array.isArray(last.results) && last.results.length === 0);
    if (!failed) return last;
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1))); // 200ms, 400ms…
    }
  }
  return last;
}

async function fetchJsonOnce(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Relay-Music-Player/2.0 (+supabase)" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
