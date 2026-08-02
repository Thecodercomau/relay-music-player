/**
 * Relay Music Player — playlists API (Supabase Edge Function port of php/playlists.php).
 *
 * Actions (all require login):
 *   list        GET  → all playlists for the current user (with track counts)
 *   create      POST → { name } → new playlist
 *   get         GET  → &id=… → playlist with its tracks
 *   addTrack    POST → { playlist_id, deezer_id, title, artist, album,
 *                       cover, cover_big, preview, duration, source }
 *   removeTrack POST → { playlist_id, deezer_id }
 *   delete      POST → { id } → delete a playlist (cascades its tracks)
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY
 */

import {
  admin,
  dbErrorMessage,
  handleOptions,
  json,
  readBody,
  requireUser,
} from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.user.id;

  const db = admin();

  try {
    switch (action) {
      /* ---------------- list ---------------- */
      case "list": {
        const { data, error } = await db
          .from("playlists")
          .select("id, name, created_at, playlist_tracks(id)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) return json({ error: dbErrorMessage(error, "Could not load playlists.") }, 500);
        const playlists = (data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          created_at: p.created_at,
          track_count: Array.isArray(p.playlist_tracks) ? p.playlist_tracks.length : 0,
        }));
        return json({ success: true, playlists });
      }

      /* ---------------- create ---------------- */
      case "create": {
        const body = await readBody(req);
        let name = String(body.name ?? "").trim();
        if (!name) return json({ error: "Playlist name is required." }, 400);
        if (name.length > 120) name = name.slice(0, 120);

        const { data, error } = await db.from("playlists").insert({
          user_id: userId,
          name,
        }).select("id, name").single();
        if (error) return json({ error: dbErrorMessage(error, "Could not create playlist.") }, 500);
        return json({
          success: true,
          playlist: { id: data.id, name: data.name, track_count: 0 },
        }, 201);
      }

      /* ---------------- get (with tracks) ---------------- */
      case "get": {
        const id = Number(url.searchParams.get("id") ?? 0);
        const { data: playlist, error: plErr } = await db
          .from("playlists")
          .select("id, name, created_at")
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (plErr || !playlist) return json({ error: "Playlist not found." }, 404);

        const { data: tracks, error: trErr } = await db
          .from("playlist_tracks")
          .select("id, deezer_id, title, artist, album, cover, cover_big, preview, duration, source, added_at")
          .eq("playlist_id", id)
          .order("added_at");
        if (trErr) return json({ error: dbErrorMessage(trErr, "Could not load tracks.") }, 500);

        return json({ success: true, playlist, tracks: tracks ?? [] });
      }

      /* ---------------- add track ---------------- */
      case "addTrack": {
        const body = await readBody(req);
        const playlistId = Number(body.playlist_id ?? 0);
        const deezerId = Number(body.deezer_id ?? 0);
        const title = String(body.title ?? "").trim();
        const artist = String(body.artist ?? "").trim();

        if (!(await ownsPlaylist(playlistId, userId))) {
          return json({ error: "Playlist not found." }, 404);
        }
        if (!deezerId || !title) return json({ error: "Invalid track data." }, 400);

        const { data: inserted, error } = await db.from("playlist_tracks").insert({
          playlist_id: playlistId,
          deezer_id: deezerId,
          title: title.slice(0, 255),
          artist: (artist || "Unknown artist").slice(0, 255),
          album: String(body.album ?? "").slice(0, 255),
          cover: String(body.cover ?? "").slice(0, 500),
          cover_big: String(body.cover_big ?? "").slice(0, 500),
          preview: String(body.preview ?? "").slice(0, 500),
          duration: Math.max(0, Number(body.duration ?? 0) || 0),
          source: String(body.source ?? "").slice(0, 20),
        })
          .select("id")
          .maybeSingle();

        if (error) {
          // Unique (playlist_id, deezer_id) → the track is already there.
          if (error.code === "23505") {
            return json({ success: true, added: false });
          }
          return json({ error: dbErrorMessage(error, "Could not add track.") }, 500);
        }

        return json({ success: true, added: Boolean(inserted) });
      }

      /* ---------------- remove track ---------------- */
      case "removeTrack": {
        const body = await readBody(req);
        const playlistId = Number(body.playlist_id ?? 0);
        const deezerId = Number(body.deezer_id ?? 0);

        if (!(await ownsPlaylist(playlistId, userId))) {
          return json({ error: "Playlist not found." }, 404);
        }

        const { error } = await db
          .from("playlist_tracks")
          .delete()
          .eq("playlist_id", playlistId)
          .eq("deezer_id", deezerId);
        if (error) return json({ error: dbErrorMessage(error, "Could not remove track.") }, 500);

        return json({ success: true });
      }

      /* ---------------- delete ---------------- */
      case "delete": {
        const body = await readBody(req);
        const id = Number(body.id ?? 0);

        const { data, error } = await db
          .from("playlists")
          .delete()
          .eq("id", id)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle();
        if (error) return json({ error: dbErrorMessage(error, "Could not delete playlist.") }, 500);

        return json({ success: true, deleted: Boolean(data) });
      }

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (err) {
    console.error("playlists error:", err);
    return json({ error: "Database error." }, 500);
  }
});

/** True when the playlist exists and belongs to this user. */
async function ownsPlaylist(playlistId: number, userId: string): Promise<boolean> {
  const { data } = await admin()
    .from("playlists")
    .select("id")
    .eq("id", playlistId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
