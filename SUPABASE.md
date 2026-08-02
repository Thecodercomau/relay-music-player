# 🚀 Relay Music Player — Supabase edition

This edition (now on `main`; the PHP + MySQL version lives on the
`php-mysql` branch) replaces the old backend with:

| Old (PHP + MySQL) | New (Supabase) |
|---|---|
| `php/music.php` | Edge Function `music` (Jamendo proxy, hybrid search) |
| `php/songs.php` | Edge Function `songs` (admin library) |
| `php/users.php` | Edge Function `users` (profile + admin mgmt) |
| `php/playlists.php` | Edge Function `playlists` |
| `php/login.php` `signup.php` `session.php` | **Supabase Auth** (email + password) |
| `uploads/` folder | **Supabase Storage** bucket `uploads` (public read) |
| MySQL `users` table | `profiles` table linked to `auth.users` |

Everything else (the HTML/CSS/JS frontend) is unchanged — the frontend now
talks to Edge Functions instead of `/php/*.php`.

---

## 1. Create a Supabase project (free)

1. Go to **https://supabase.com** → **Start your project** (free tier is fine).
2. Note your **Project URL** (Dashboard → Project Settings → API):
   `https://<project-ref>.supabase.co`
3. Grab the **anon public** key from the same page — this is safe to ship.

## 2. Apply the database schema

Either:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push          # applies supabase/schema.sql
```

…or open **Dashboard → SQL Editor**, paste the contents of
`supabase/schema.sql`, and run it. This creates:

- `profiles` (auto-created on signup; **the first account becomes admin**)
- `playlists`, `playlist_tracks`, `songs`
- the `uploads` storage bucket (100 MB files, public read, auth write)

## 3. Set the function secrets

The Edge Functions need three secrets (Dashboard → Edge Functions → Secrets,
or the CLI):

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase secrets set JAMENDO_CLIENT_ID=<your-jamendo-client-id>
```

(`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically.)

Get your Jamendo `client_id` free at https://developers.jamendo.com.

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security — keep it
> server-side only (it lives in the function secrets, never in the browser).

## 4. Deploy the Edge Functions

```bash
supabase functions deploy music songs users playlists
```

## 5. Configure the frontend

Edit **`js/supabase.js`** and paste your two values:

```js
const RELAY_SUPABASE = {
  url: "https://<project-ref>.supabase.co",
  anonKey: "eyJhbGciOi...",
};
```

## 6. Host the static files

The frontend is plain HTML/CSS/JS — host it anywhere that serves static
files (GitHub Pages, Netlify, Vercel, alwaysdata static, …). It calls the
Edge Functions cross-origin, which is why the functions send CORS headers.

## 7. First run

1. Open your site → **Sign up**. The first account is auto-promoted to
   **admin** (so you can manage songs/users in the Admin tab).
2. If signup asks for email confirmation, either confirm in your inbox or
   turn it off: Dashboard → **Authentication → Providers → Email →
   “Confirm email” off** (fine for a portfolio demo).
3. Play anything — search/trending fall back to Jamendo when your `songs`
   table is empty. Seed your catalog from the Admin tab or via the function:
   `https://<project-ref>.supabase.co/functions/v1/music?action=seed&q=lo-fi&limit=25`
   (logged-in browser tab, or with `Authorization: Bearer <access_token>`).

## Local development

```bash
supabase start          # local Postgres + functions runtime
supabase db push        # apply schema locally
supabase functions serve --env-file .env.local
```

Then edit `js/supabase.js` to point at `http://127.0.0.1:54321`.

## Security notes (ported from the PHP edition)

- All data access goes through Edge Functions with the service role;
  PostgREST is locked down with deny-all RLS.
- Passwords never touch your code — Supabase Auth hashes them (bcrypt/argon).
- Admin actions re-verify `is_admin` from the DB on every request.
- The `stream` proxy only fetches `*.jamendo.com` / `*.jamendo.net` (SSRF guard).
- Uploads are validated by the storage bucket (`audio/*` MIME, 100 MB cap).
