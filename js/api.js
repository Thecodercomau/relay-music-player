/**
 * Relay Music Player — music API wrapper.
 *
 * The browser talks to our own PHP proxy (php/music.php), which fetches from
 * the Jamendo API server-side (search, trending, full track details).
 *
 * Later you can swap php/music.php for your own song database endpoints —
 * the frontend will keep working because it only relies on this wrapper.
 */
const Api = {
  /** Path to the php/ folder depends on which page we're on. */
  base() {
    return location.pathname.includes("/pages/") ? "../php" : "php";
  },

  async request(path) {
    const res = await fetch(`${this.base()}/music.php${path}`, {
      credentials: "same-origin",
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected response from the server.");
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Music API request failed.");
    }
    if (data && data.error) {
      throw new Error(data.error.message || data.error.type || "Music API error.");
    }
    return data;
  },

  /** Search tracks by query. */
  async searchTracks(query, limit = 30) {
    const data = await this.request(
      `?action=search&q=${encodeURIComponent(query)}&limit=${limit}`
    );
    return (data.data || []).map((t) => normalizeTrack(t, data.source));
  },

  /** Global trending / chart tracks. */
  async getTrending(limit = 30) {
    const data = await this.request(`?action=trending&limit=${limit}`);
    return (data.data || []).map((t) => normalizeTrack(t, data.source));
  },

  /** Full details for one track — lyrics, tags, license, download URL. */
  async getTrackDetails(id) {
    const data = await this.request(`?action=details&id=${encodeURIComponent(id)}`);
    return normalizeDetails(data.data);
  },

  /** Admin: all songs in your own library (php/songs.php, admin only). */
  async adminSongs() {
    const res = await fetch(`${this.base()}/songs.php?action=list`, {
      credentials: "same-origin",
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected response from the server.");
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Could not load your library.");
    }
    return data;
  },

  /** Admin: all user accounts (php/users.php, admin only). */
  async adminUsers() {
    const res = await fetch(`${this.base()}/users.php?action=list`, {
      credentials: "same-origin",
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected response from the server.");
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Could not load users.");
    }
    return data;
  },

  /** Admin: grant or revoke admin for a user (php/users.php). */
  async setAdmin(userId, isAdmin) {
    const res = await fetch(`${this.base()}/users.php?action=setAdmin`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_id: userId, is_admin: isAdmin ? 1 : 0 }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected response from the server.");
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Could not update admin access.");
    }
    return data;
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
    // back to the response-level source the PHP proxy provides.
    source: t.source || source || "",
  };
}

/** Shape the backend's details payload (php/music.php?action=details). */
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
