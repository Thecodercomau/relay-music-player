/**
 * Relay Music Player — audio player engine.
 * Wraps the HTML5 Audio element and manages the queue.
 */
class Player {
  constructor() {
    this.audio = new Audio();
    this.queue = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.shuffle = false;
    this.repeat = false;
    this.order = []; // play order (respects shuffle)
    this._orderIndex = 0;

    this.audio.preload = "metadata";
    this.audio.volume = 0.7;

    this.listeners = {
      timeupdate: [],
      loadedmetadata: [],
      play: [],
      pause: [],
      ended: [],
      error: [],
    };

    this.audio.addEventListener("timeupdate", () =>
      this._emit("timeupdate", this.audio.currentTime, this.audio.duration)
    );
    this.audio.addEventListener("loadedmetadata", () =>
      this._emit("loadedmetadata", this.audio.duration)
    );
    this.audio.addEventListener("play", () => this._emit("play"));
    this.audio.addEventListener("pause", () => this._emit("pause"));
    this.audio.addEventListener("ended", () => this._emit("ended"));
    this.audio.addEventListener("error", (e) => this._emit("error", e));
  }

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
  }

  _emit(event, ...args) {
    this.listeners[event].forEach((fn) => fn(...args));
  }

  get playing() {
    return !this.audio.paused;
  }

  /** Load a new list of tracks and start playing at index. */
  playList(tracks, index = 0) {
    if (!tracks || !tracks.length) return;
    this.queue = tracks;
    this._rebuildOrder();
    this._orderIndex = this.order.indexOf(index);
    if (this._orderIndex === -1) this._orderIndex = 0;
    this._playAt(this.order[this._orderIndex]);
  }

  _rebuildOrder() {
    this.order = this.queue.map((_, i) => i);
    if (this.shuffle) {
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
    }
  }

  _playAt(index) {
    if (index === undefined || index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this.currentTrack = this.queue[index];
    if (!this.currentTrack || !this.currentTrack.preview) {
      this._emit("error", new Error("No preview available for this track."));
      return;
    }
    this.audio.src = this.currentTrack.preview;
    this.audio.play().catch(() => this._emit("error", new Error("Playback failed.")));
  }

  togglePlay() {
    if (!this.currentTrack) return;
    if (this.audio.paused) this.audio.play();
    else this.audio.pause();
  }

  next() {
    if (!this.queue.length) return;
    if (this._orderIndex < this.order.length - 1) {
      this._orderIndex++;
    } else if (this.repeat) {
      this._orderIndex = 0;
    } else {
      this._orderIndex = 0; // wrap around to keep things flowing
    }
    this._playAt(this.order[this._orderIndex]);
  }

  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (this._orderIndex > 0) {
      this._orderIndex--;
    } else {
      this._orderIndex = this.order.length - 1;
    }
    this._playAt(this.order[this._orderIndex]);
  }

  seek(percent) {
    if (!this.audio.duration) return;
    this.audio.currentTime = (percent / 100) * this.audio.duration;
  }

  setVolume(percent) {
    this.audio.volume = Math.min(1, Math.max(0, percent / 100));
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const current = this.currentIndex;
    this._rebuildOrder();
    if (current !== -1) {
      this._orderIndex = this.order.indexOf(current);
      if (this._orderIndex === -1) this._orderIndex = 0;
    }
    return this.shuffle;
  }

  toggleRepeat() {
    this.repeat = !this.repeat;
    this.audio.loop = this.repeat && this.queue.length === 1;
    return this.repeat;
  }

  /**
   * Download a track's audio as an MP3 file.
   * @param {Object} track - track with .preview (audio URL)
   * @param {string} [downloadUrl] - optional proxied URL to fetch instead of track.preview
   */
  async download(track = this.currentTrack, downloadUrl = null) {
    if (!track || !(track.preview || downloadUrl)) {
      throw new Error("This track has no downloadable audio.");
    }
    const res = await fetch(downloadUrl || track.preview, { mode: "cors" });
    if (!res.ok) throw new Error("Download failed.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(track.artist)} - ${sanitizeFilename(track.title)}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function sanitizeFilename(str) {
  return String(str).replace(/[\\/:*?"<>|]/g, "").trim() || "track";
}
