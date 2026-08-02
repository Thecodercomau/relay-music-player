/**
 * Relay Music Player — playlists API wrapper.
 * Talks to php/playlists.php (login-protected, MySQL-backed).
 */
const Playlists = {
  base() {
    return location.pathname.includes("/pages/") ? "../php" : "php";
  },

  async request(path, options = {}) {
    const res = await fetch(`${this.base()}/playlists.php${path}`, {
      credentials: "same-origin",
      ...options,
    });
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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name }),
    });
  },

  get(id) {
    return this.request(`?action=get&id=${encodeURIComponent(id)}`);
  },

  addTrack(payload) {
    return this.request("?action=addTrack", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload),
    });
  },

  removeTrack(playlistId, deezerId) {
    return this.request("?action=removeTrack", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ playlist_id: playlistId, deezer_id: deezerId }),
    });
  },

  delete(id) {
    return this.request("?action=delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id }),
    });
  },
};
