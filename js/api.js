/**
 * Relay Music Player — music API wrapper (Supabase edition).
 *
 * The browser talks to our Edge Functions (music, songs, users), which
 * proxy the Jamendo API server-side and talk to Postgres via the service
 * role. The function set is a drop-in replacement for the old php/*.php
 * endpoints, so the rest of the app is untouched.
 */
const Api = {
  base() {
    return functionsBase();
  },

  /** Authorization header from the current Supabase session. */
  async authHeaders() {
    const headers = { "Content-Type": "application/json" };
    try {
      const { data } = await supabaseClient().auth.getSession();
      if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
    } catch {
      // not configured — callers surface the error
    }
    return headers;
  },

  async request(fn, path, options = {}) {
    const headers = { ...(await this.authHeaders()), ...(options.headers || {}) };
    const res = await fetch(`${this.base()}/${fn}${path}`, { ...options, headers });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected response from the server.");
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Request failed.");
    }
    if (data && data.error) {
      throw new Error(data.error.message || data.error.type || data.error);
    }
    return data;
  },

  /** Search tracks by query. */
  async searchTracks(query, limit = 30) {
    const data = await this.request(
      `music?action=search&q=${encodeURIComponent(query)}&limit=${limit}`
    );
    return (data.data || []).map((t) => normalizeTrack(t, data.source));
  },

  /** Global trending / chart tracks. */
  async getTrending(limit = 30) {
    const data = await this.request(`music?action=trending&limit=${limit}`);
    return (data.data || []).map((t) => normalizeTrack(t, data.source));
  },

  /** Full details for one track — lyrics, tags, license, download URL. */
  async getTrackDetails(id) {
    const data = await this.request(`music?action=details&id=${encodeURIComponent(id)}`);
    return normalizeDetails(data.data);
  },

  /** The current user's profile (users function, action=me). */
  async me() {
    return this.request("users?action=me");
  },

  /** Admin: all songs in your own library (songs function, admin only). */
  async adminSongs() {
    return this.request("songs?action=list");
  },

  /** Admin: all user accounts (users function, admin only). */
  async adminUsers() {
    return this.request("users?action=list");
  },

  /** Admin: grant or revoke admin for a user (users function). */
  async setAdmin(userId, isAdmin) {
    return this.request("users?action=setAdmin", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, is_admin: isAdmin ? 1 : 0 }),
    });
  },

  /** Admin: add a song. audio_url is a storage public URL or an http(s) URL. */
  async addSong(payload) {
    return this.request("songs?action=add", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** Admin: delete a song (also removes its file from the uploads bucket). */
  async deleteSong(id) {
    return this.request("songs?action=delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },

  /** Proxy URL for downloading external (Jamendo) audio. */
  streamUrl(audioUrl) {
    return `${this.base()}/music?action=stream&url=${encodeURIComponent(audioUrl)}`;
  },
};

/** Shape a raw track into what our player UI needs. */
function normalizeTrack(t, source = "") {
  return {
    id: t.id,
    title: t.title,
    artist: (t.artist && t.artist.name) || "Unknown artist",
    album: (t.album && t.album.title) || "",
    duration: t.duration || 0,
    preview: t.preview || "",
    cover: (t.album && (t.album.cover_medium || t.album.cover_small)) || "",
    coverBig: (t.album && t.album.cover_big) || "",
    // Prefer the per-track source (survives saving to playlists), fall
    // back to the response-level source the proxy provides.
    source: t.source || source || "",
  };
}

/** Shape the backend's details payload (music?action=details). */
function normalizeDetails(d) {
  return {
    id: d.id,
    title: d.title || "Unknown track",
    artist: d.artist || "Unknown artist",
    album: d.album || "",
    cover: d.cover || "",
    duration: d.duration || 0,
    preview: d.preview || "",
    downloadUrl: d.downloadUrl || d.preview || "",
    downloadAllowed: d.downloadAllowed !== false,
    releasedate: d.releasedate || "",
    lang: d.lang || "",
    tags: Array.isArray(d.tags) ? d.tags : [],
    license: d.license || "",
    lyrics: d.lyrics || "",
    source: d.source || "",
  };
}
