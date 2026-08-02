/**
 * Relay Music Player — admin songs API (Supabase Edge Function port of php/songs.php).
 *
 * Actions:
 *   list   GET — all songs (newest first)                    [admin]
 *   add    POST — add a song { title, artist, album, cover,
 *                 audio_url }                                [admin]
 *   delete POST — remove a song { id } (also removes the
 *                 uploaded file from the uploads bucket)     [admin]
 *
 * Upload flow: the browser uploads the audio file straight to the
 * `uploads` storage bucket, then calls add with the public URL.
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY
 */

import {
  admin,
  dbErrorMessage,
  handleOptions,
  isStorageUrl,
  json,
  readBody,
  requireAdmin,
  requireUser,
  storageObjectName,
} from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const adminCheck = await requireAdmin(auth.user.id);
  if ("error" in adminCheck) return adminCheck.error;

  const db = admin();

  try {
    switch (action) {
      case "list": {
        const { data, error } = await db
          .from("songs")
          .select("id, title, artist, album, cover, duration, audio_url, created_at")
          .order("created_at", { ascending: false });
        if (error) return json({ error: dbErrorMessage(error, "Could not load songs.") }, 500);
        return json({ success: true, songs: data ?? [] });
      }

      case "add": {
        const body = await readBody(req);
        const title = String(body.title ?? "").trim();
        const artist = String(body.artist ?? "").trim();
        const album = String(body.album ?? "").trim();
        if (!title || !artist || !album) {
          return json({ error: "Title, artist and album are required." }, 400);
        }
        const cover = String(body.cover ?? "").trim();
        const duration = Math.max(0, Number(body.duration ?? 0) || 0);
        let audioUrl = String(body.audio_url ?? "").trim();

        if (!audioUrl) return json({ error: "Provide an audio file or a valid audio URL." }, 400);
        if (!audioUrl.startsWith("/storage/v1/object/public/") && !/^https?:\/\//i.test(audioUrl)) {
          return json({ error: "Audio URL must be a storage path or an http(s) URL." }, 400);
        }

        const { data, error } = await db.from("songs").insert({
          title,
          artist,
          album,
          cover,
          duration,
          audio_url: audioUrl,
        }).select("id, title, artist, album, cover, duration, audio_url").single();

        if (error) return json({ error: dbErrorMessage(error, "Could not add song.") }, 500);
        return json({ success: true, song: data }, 201);
      }

      case "delete": {
        const body = await readBody(req);
        const id = Number(body.id ?? 0);
        if (!id || id <= 0) return json({ error: "Invalid song id." }, 400);

        const { data: existing, error: findErr } = await db
          .from("songs")
          .select("audio_url")
          .eq("id", id)
          .maybeSingle();
        if (findErr || !existing) {
          return json({ error: "Song not found." }, 404);
        }

        const { error: delErr } = await db.from("songs").delete().eq("id", id);
        if (delErr) return json({ error: dbErrorMessage(delErr, "Could not delete song.") }, 500);

        // Best-effort cleanup of the uploaded file in the uploads bucket.
        const audioUrl = String(existing.audio_url ?? "");
        if (isStorageUrl(audioUrl, Deno.env.get("SUPABASE_URL") ?? "")) {
          const name = storageObjectName(audioUrl);
          if (name) {
            await db.storage.from("uploads").remove([name]).catch(() => null);
          }
        }

        return json({ success: true, deleted: id });
      }

      default:
        return json({ error: "Unknown action. Use action=add, action=list or action=delete." }, 400);
    }
  } catch (err) {
    console.error("songs error:", err);
    return json({ error: "Database error." }, 500);
  }
});
