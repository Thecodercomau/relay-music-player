/**
 * Relay Music Player — music API (hybrid: songs table first, Jamendo fallback).
 *
 * Supabase Edge Function port of php/music.php.
 *
 * Actions (query param ?action=):
 *   search   &q=chill&limit=30   → songs table, then Jamendo   (public)
 *   trending &limit=30           → songs table, then Jamendo   (public)
 *   details  &id=123456          → full details (lyrics, tags…) (public)
 *   seed     &q=chill&limit=20   → Jamendo → insert into songs (login)
 *   stream   &url=...            → audio proxy for downloads    (login)
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY, JAMENDO_CLIENT_ID
 */

import {
  admin,
  fetchJson,
  handleOptions,
  isJamendoUrl,
  isStorageUrl,
  JAMENDO_CLIENT_ID,
  json,
  requireUser,
} from "../_shared/helpers.ts";

type Track = Record<string, unknown>;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 30) || 30));

  try {
    switch (action) {
      case "search": {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return json({ error: "Missing search query." }, 400);
        const tracks = await dbSearchTracks(q, limit);
        if (tracks.length > 0) return json({ data: tracks, source: "database" });
        return json({ data: await jamendoSearchTracks(q, limit), source: "jamendo" });
      }

      case "trending": {
        const tracks = await dbTrendingTracks(limit);
        if (tracks.length > 0) return json({ data: tracks, source: "database" });
        return json({ data: await jamendoTrendingTracks(limit), source: "jamendo" });
      }

      case "details": {
        const id = Number(url.searchParams.get("id") ?? 0);
        if (!id || id <= 0) return json({ error: "Missing track id." }, 400);
        const details = await trackDetails(id);
        if (!details) return json({ error: "Track not found." }, 404);
        return json({ data: details });
      }

      case "seed": {
        const auth = await requireUser(req);
        if ("error" in auth) return auth.error;
        if (!JAMENDO_CLIENT_ID) {
          return json(
            { error: "Jamendo client_id is required for seeding. Set the JAMENDO_CLIENT_ID secret." },
            500,
          );
        }
        const q = (url.searchParams.get("q") ?? "").trim();
        const jUrl = jamendoBase()
          + `&limit=${limit}&order=popularity_total`
          + (q ? `&search=${encodeURIComponent(q)}` : "");
        const result = await fetchJson(jUrl, true);
        if (!result) return json({ error: "Could not reach the Jamendo API." }, 502);
        if ((result.headers as Record<string, unknown>)?.status === "failed") {
          return json(
            { error: String((result.headers as Record<string, unknown>)?.error_message ?? "Jamendo API error.") },
            502,
          );
        }
        const seeded = await seedSongs((result.results as Track[]) ?? []);
        return json({ success: true, seeded, query: q });
      }

      case "stream": {
        const auth = await requireUser(req);
        if ("error" in auth) return auth.error;
        const target = (url.searchParams.get("url") ?? "").trim();
        if (!isJamendoUrl(target)) return json({ error: "Invalid stream URL." }, 400);
        return await streamAudio(target);
      }

      default:
        return json(
          { error: "Unknown action. Use action=search, action=trending, action=details, action=seed or action=stream." },
          400,
        );
    }
  } catch (err) {
    console.error("music error:", err);
    return json({ error: "Database error." }, 500);
  }
});

/* =========================================================
   Database helpers
   ========================================================= */

async function dbSearchTracks(q: string, limit: number): Promise<Track[]> {
  // PostgREST `.or()` treats commas/parens as predicate separators and `%`/`_`
  // as wildcards — sanitize a copy so user queries can't break the filter or
  // behave like wildcards (the PHP original escaped these too).
  const fq = q.replace(/[(),]/g, " ").replace(/[%_\\]/g, (c) => "\\" + c).trim();
  if (!fq) return [];
  const { data, error } = await admin()
    .from("songs")
    .select("id, title, artist, album, cover, duration, audio_url")
    .or(`title.ilike.%${fq}%,artist.ilike.%${fq}%,album.ilike.%${fq}%`)
    .order("title")
    .limit(limit);
  if (error) {
    console.error("DB search error:", error.message);
    return [];
  }
  return (data ?? []).map(mapDbTrack);
}

async function dbTrendingTracks(limit: number): Promise<Track[]> {
  const { data, error } = await admin()
    .from("songs")
    .select("id, title, artist, album, cover, duration, audio_url")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("DB trending error:", error.message);
    return [];
  }
  return (data ?? []).map(mapDbTrack);
}

function mapDbTrack(row: Record<string, unknown>): Track {
  const image = String(row.cover ?? "");
  return {
    id: Number(row.id),
    title: String(row.title ?? "Unknown track"),
    artist: { name: String(row.artist ?? "Unknown artist") },
    album: { title: String(row.album ?? ""), cover_medium: image, cover_big: image },
    duration: Number(row.duration ?? 0),
    preview: String(row.audio_url ?? ""),
    source: "database",
  };
}

async function seedSongs(results: Track[]): Promise<number> {
  const db = admin();
  const rows = results
    .filter((t) => (t.audio ?? "") !== "")
    .map((t) => ({
      jamendo_id: Number(t.id),
      title: String(t.name ?? "Unknown track").slice(0, 255),
      artist: String(t.artist_name ?? "Unknown artist").slice(0, 255),
      album: String(t.album_name ?? "").slice(0, 255),
      cover: String(t.image ?? "").slice(0, 500),
      duration: Number(t.duration ?? 0),
      audio_url: String(t.audio),
    }));
  if (rows.length === 0) return 0;

  const { count: before } = await db.from("songs").select("id", { count: "exact", head: true });
  const { error } = await db.from("songs").upsert(rows, {
    onConflict: "jamendo_id",
    ignoreDuplicates: true,
  });
  if (error) {
    console.error("Seed error:", error.message);
    return 0;
  }
  const { count: after } = await db.from("songs").select("id", { count: "exact", head: true });
  return Math.max(0, Number(after ?? 0) - Number(before ?? 0));
}

/** Find a song row by local id OR Jamendo id. */
async function dbFindSong(id: number) {
  const { data, error } = await admin()
    .from("songs")
    .select("*")
    .or(`id.eq.${id},jamendo_id.eq.${id}`)
    .limit(1);
  if (error) return null;
  return (data ?? [])[0] as Record<string, unknown> | undefined ?? null;
}

async function trackDetails(id: number) {
  const row = await dbFindSong(id);

  if (row) {
    const jamendoId = Number(row.jamendo_id ?? 0);
    if (jamendoId > 0) {
      const details = await jamendoTrackDetails(jamendoId);
      if (details) {
        details.source = "database";
        const audio = String(row.audio_url ?? "");
        // Locally uploaded audio (our storage bucket) is authoritative.
        if (isStorageUrl(audio, Deno.env.get("SUPABASE_URL") ?? "")) {
          details.preview = audio;
          details.downloadUrl = audio;
        }
        return details;
      }
    }
    // Hand-added row (or Jamendo lookup failed) — return what we know.
    return {
      id: Number(row.id),
      title: String(row.title ?? "Unknown track"),
      artist: String(row.artist ?? "Unknown artist"),
      album: String(row.album ?? ""),
      cover: String(row.cover ?? ""),
      duration: Number(row.duration ?? 0),
      preview: String(row.audio_url ?? ""),
      downloadUrl: String(row.audio_url ?? ""),
      downloadAllowed: true,
      releasedate: "",
      lang: "",
      tags: [],
      license: "",
      lyrics: "",
      source: "database",
    };
  }

  return jamendoTrackDetails(id);
}

/* =========================================================
   Jamendo helpers
   ========================================================= */

function jamendoBase(): string {
  return "https://api.jamendo.com/v3.0/tracks/?client_id=" +
    encodeURIComponent(JAMENDO_CLIENT_ID) + "&format=json";
}

async function jamendoSearchTracks(q: string, limit: number): Promise<Track[]> {
  if (!JAMENDO_CLIENT_ID) return [];
  const url = jamendoBase() + `&search=${encodeURIComponent(q)}&limit=${limit}&order=popularity_total`;
  return fetchJamendoTracks(url);
}

async function jamendoTrendingTracks(limit: number): Promise<Track[]> {
  if (!JAMENDO_CLIENT_ID) return [];
  const url = jamendoBase() + `&limit=${limit}&order=popularity_total`;
  return fetchJamendoTracks(url);
}

async function fetchJamendoTracks(url: string): Promise<Track[]> {
  const result = await fetchJson(url, true);
  if (!result) return [];
  if ((result.headers as Record<string, unknown>)?.status === "failed") {
    console.error("Jamendo error:", (result.headers as Record<string, unknown>)?.error_message ?? "unknown");
    return [];
  }
  return ((result.results as Track[]) ?? []).map(mapJamendoTrack);
}

function collectTagGroups(groups: unknown): string[] {
  const tags: string[] = [];
  if (!Array.isArray(groups)) return tags;
  for (const group of groups) {
    if (Array.isArray(group)) {
      for (const tag of group) tags.push(String(tag));
    } else {
      tags.push(String(group));
    }
  }
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
}

async function jamendoTrackDetails(id: number): Promise<Track | null> {
  if (!JAMENDO_CLIENT_ID) return null;

  // Main call: better audio (mp32), hi-res cover, lyrics.
  const url = jamendoBase() +
    `&id=${id}&include=lyrics&audioformat=mp32&audiodlformat=mp32&imagesize=600`;
  const result = await fetchJson(url, true);
  if (!result || (result.headers as Record<string, unknown>)?.status === "failed") return null;
  const t = (result.results as Track[] | undefined)?.[0];
  if (!t) return null;

  const details = mapJamendoDetails(t);

  // Second call — genre tags + language (Jamendo's backend is flaky, so require results).
  const miUrl = jamendoBase() + `&id=${id}&include=musicinfo&limit=1`;
  const mi = await fetchJson(miUrl, true);
  const miInfo = ((mi?.results as Track[] | undefined)?.[0]?.musicinfo) as Record<string, unknown> | undefined;
  if (miInfo) {
    if ((details.tags as string[]).length === 0 && Array.isArray(miInfo.tags)) {
      details.tags = collectTagGroups(miInfo.tags).slice(0, 8);
    }
    if (details.lang === "" && miInfo.lang) details.lang = String(miInfo.lang);
  }

  // License fallback — license_ccurl may only appear with include=licenses.
  if (details.license === "") {
    const licUrl = jamendoBase() + `&id=${id}&include=licenses&limit=1`;
    const lic = await fetchJson(licUrl);
    const licences = ((lic?.results as Track[] | undefined)?.[0]?.licenses) as
      | Array<Record<string, unknown>>
      | undefined;
    if (licences) {
      for (const l of licences) {
        const found = l.ccurl ?? l.url;
        if (found) {
          details.license = String(found);
          break;
        }
      }
    }
  }

  return details;
}

function mapJamendoDetails(t: Track): Track {
  const image = String(t.album_image ?? t.image ?? "");
  const license = String(t.license_ccurl ?? "");

  let tags: string[] = [];
  if (Array.isArray(t.tags)) tags = collectTagGroups(t.tags);
  const miTags = (t.musicinfo as Record<string, unknown> | undefined)?.tags;
  if (Array.isArray(miTags)) tags = collectTagGroups(miTags);

  let lyrics = "";
  if (typeof t.lyrics === "string") lyrics = t.lyrics;
  else if (typeof (t.lyrics as Record<string, unknown> | undefined)?.lyrics === "string") {
    lyrics = String((t.lyrics as Record<string, unknown>).lyrics);
  }

  let lang = String(t.lang ?? "");
  if (!lang && (t.musicinfo as Record<string, unknown> | undefined)?.lang) {
    lang = String((t.musicinfo as Record<string, unknown>).lang);
  }

  return {
    id: Number(t.id),
    title: String(t.name ?? "Unknown track"),
    artist: String(t.artist_name ?? "Unknown artist"),
    album: String(t.album_name ?? ""),
    cover: image,
    duration: Number(t.duration ?? 0),
    preview: String(t.audio ?? ""),
    downloadUrl: String(t.audiodownload ?? ""),
    downloadAllowed: t.audiodownload_allowed !== false,
    releasedate: String(t.releasedate ?? ""),
    lang,
    tags: tags.slice(0, 8),
    license,
    lyrics,
    source: "jamendo",
  };
}

function mapJamendoTrack(t: Track): Track {
  const image = String(t.image ?? "");
  return {
    id: Number(t.id),
    title: String(t.name ?? "Unknown track"),
    artist: { name: String(t.artist_name ?? "Unknown artist") },
    album: { title: String(t.album_name ?? ""), cover_medium: image, cover_big: image },
    duration: Number(t.duration ?? 0),
    preview: String(t.audio ?? ""),
    source: "jamendo",
  };
}

/** Stream a Jamendo audio file back to the browser (download support). */
async function streamAudio(target: string): Promise<Response> {
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Relay-Music-Player/2.0 (+supabase)" },
      redirect: "follow",
    });
    if (!res.ok || !res.body) return json({ error: "Could not stream audio." }, 502);
    const headers: Record<string, string> = {
      "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
    };
    // Only echo Content-Length when the upstream provides one (chunked
    // responses omit it and must not carry an empty header).
    const contentLength = res.headers.get("Content-Length");
    if (contentLength) headers["Content-Length"] = contentLength;
    return new Response(res.body, { status: 200, headers });
  } catch {
    return json({ error: "Could not stream audio." }, 502);
  }
}
