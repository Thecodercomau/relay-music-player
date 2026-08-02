/**
 * Relay Music Player — auth helpers (Supabase edition).
 * Backed by Supabase Auth + the `users` Edge Function for the profile.
 */

// Kept for the navbar link logic in app.js (page-location based).
const PHP_BASE = location.pathname.includes("/pages/") ? "../php" : "php";

const Auth = {
  /**
   * Returns the logged-in user's profile ({ id, name, email, is_admin }),
   * or null when there is no session.
   */
  async checkSession() {
    let session;
    try {
      const s = await supabaseClient().auth.getSession();
      session = s.data.session;
    } catch {
      return null;
    }
    if (!session) return null;
    try {
      const data = await Api.me();
      return data && data.user ? data.user : null;
    } catch {
      // Session exists but profile fetch failed — treat as logged out.
      return null;
    }
  },

  /** Sign up with Supabase Auth. Returns { success } or { success:false, error }. */
  async signup(name, email, password) {
    try {
      const { data, error } = await supabaseClient().auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) {
        return { success: false, error: friendlyAuthError(error) };
      }
      // No session → email confirmation is enabled on this project.
      if (!data.session) {
        return {
          success: false,
          error: "Account created! Check your email to confirm, then log in.",
        };
      }
      return { success: true };
    } catch {
      return { success: false, error: "Cannot reach Supabase. Check your connection." };
    }
  },

  /** Log in with Supabase Auth. Returns { success } or { success:false, error }. */
  async login(email, password) {
    try {
      const { error } = await supabaseClient().auth.signInWithPassword({ email, password });
      if (error) {
        return { success: false, error: friendlyAuthError(error) };
      }
      return { success: true };
    } catch {
      return { success: false, error: "Cannot reach Supabase. Check your connection." };
    }
  },

  /** Log out. */
  async logout() {
    try {
      await supabaseClient().auth.signOut();
    } catch {
      // ignore — the UI redirects regardless
    }
  },
};

/** Turn supabase-js auth errors into friendly copy. */
function friendlyAuthError(error) {
  const msg = (error && error.message) || "";
  if (/Invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/User already registered/i.test(msg)) return "An account with that email already exists.";
  if (/Email not confirmed/i.test(msg)) return "Please confirm your email before logging in.";
  if (/Password should be at least/i.test(msg)) return "Password must be at least 6 characters.";
  if (/rate limit/i.test(msg)) return "Too many attempts — please wait a moment and try again.";
  return msg || "Something went wrong. Please try again.";
}

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
