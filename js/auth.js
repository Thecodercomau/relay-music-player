/**
 * Relay Music Player — auth helpers.
 * Talks to the PHP backend (php/*.php) backed by MySQL.
 */

// Path to the php/ folder depends on which page we're on.
const PHP_BASE = location.pathname.includes("/pages/") ? "../php" : "php";

const Auth = {
  /** Returns the logged-in user object, or null. */
  async checkSession() {
    try {
      const res = await fetch(`${PHP_BASE}/session.php`, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.logged_in ? data.user : null;
    } catch {
      return null;
    }
  },

  /** POST to signup.php with name/email/password. */
  async signup(name, email, password) {
    const res = await fetch(`${PHP_BASE}/signup.php`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name, email, password }),
    });
    return res.json();
  },

  /** POST to login.php with email/password. */
  async login(email, password) {
    const res = await fetch(`${PHP_BASE}/login.php`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password }),
    });
    return res.json();
  },

  /** POST to logout.php. */
  async logout() {
    await fetch(`${PHP_BASE}/logout.php`, {
      method: "POST",
      credentials: "same-origin",
    });
  },
};

/** Escape user-provided strings before injecting into HTML. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format seconds as m:ss. */
function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
