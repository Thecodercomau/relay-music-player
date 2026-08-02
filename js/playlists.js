/**
 * Relay Music Player — playlists API wrapper (Supabase edition).
 * Talks to the `playlists` Edge Function (login-protected, Postgres-backed).
 */
const Playlists = {
  base() {
    return functionsBase();
  },

  async request(path, options = {}) {
    const headers = { ...(await Api.authHeaders()), ...(options.headers || {}) };
    const res = await fetch(`${this.base()}/playlists${path}`, { ...options, headers });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Unexpected response from the server.");
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Playlist request failed.");
    }
    if (data && data.error) {
      throw new Error(data.error.message || data.error);
    }
    return data;
  },

  list() {
    return this.request("?action=list");
  },

  create(name) {
    return this.request("?action=create", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  get(id) {
    return this.request(`?action=get&id=${encodeURIComponent(id)}`);
  },

  addTrack(payload) {
    return this.request("?action=addTrack", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  removeTrack(playlistId, trackId) {
    return this.request("?action=removeTrack", {
      method: "POST",
      body: JSON.stringify({ playlist_id: playlistId, deezer_id: trackId }),
    });
  },

  delete(id) {
    return this.request("?action=delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },
};
