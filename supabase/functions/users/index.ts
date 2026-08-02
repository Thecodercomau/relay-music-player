/**
 * Relay Music Player — user API (Supabase Edge Function port of php/users.php).
 *
 * Actions:
 *   me       GET  — the current user's profile (name, email, is_admin)   [login]
 *   list     GET  — every user                                           [admin]
 *   setAdmin POST — set is_admin { user_id, is_admin: 0|1 }              [admin]
 *
 * Guards (ported from PHP):
 *   - You can't demote yourself.
 *   - You can't demote the last remaining admin.
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY
 */

import {
  admin,
  dbErrorMessage,
  getProfile,
  handleOptions,
  json,
  readBody,
  requireAdmin,
  requireUser,
} from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const db = admin();

  try {
    switch (action) {
      case "me": {
        const profile = await getProfile(auth.user.id);
        if (!profile) return json({ error: "Profile not found." }, 404);
        return json({ success: true, user: profile });
      }

      case "list": {
        const adminCheck = await requireAdmin(auth.user.id);
        if ("error" in adminCheck) return adminCheck.error;

        const { data, error } = await db
          .from("profiles")
          .select("id, name, email, is_admin, created_at")
          .order("is_admin", { ascending: false })
          .order("created_at");
        if (error) return json({ error: dbErrorMessage(error, "Could not load users.") }, 500);
        return json({ success: true, users: data ?? [] });
      }

      case "setAdmin": {
        const adminCheck = await requireAdmin(auth.user.id);
        if ("error" in adminCheck) return adminCheck.error;

        const body = await readBody(req);
        const userId = String(body.user_id ?? "");
        const adminOn = Number(body.is_admin ?? -1);
        if (!userId || (adminOn !== 0 && adminOn !== 1)) {
          return json({ error: "Invalid user id or admin flag." }, 400);
        }

        const { data: target, error: targetErr } = await db
          .from("profiles")
          .select("id, name, is_admin")
          .eq("id", userId)
          .maybeSingle();
        if (targetErr || !target) return json({ error: "User not found." }, 404);

        const targetIsAdmin = Boolean(target.is_admin);

        // Refuse to demote yourself or the last admin.
        if (adminOn === 0 && targetIsAdmin) {
          if (userId === auth.user.id) {
            return json({ error: "You can't remove your own admin access." }, 400);
          }
          const { count } = await db
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("is_admin", true);
          if (Number(count ?? 0) <= 1) {
            return json({ error: "At least one admin must remain." }, 400);
          }
        }

        const { error: updErr } = await db
          .from("profiles")
          .update({ is_admin: adminOn === 1 })
          .eq("id", userId);
        if (updErr) return json({ error: dbErrorMessage(updErr, "Could not update admin access.") }, 500);

        return json({
          success: true,
          user: { id: userId, name: target.name, is_admin: adminOn === 1 },
        });
      }

      default:
        return json({ error: "Unknown action. Use action=me, action=list or action=setAdmin." }, 400);
    }
  } catch (err) {
    console.error("users error:", err);
    return json({ error: "Database error." }, 500);
  }
});
