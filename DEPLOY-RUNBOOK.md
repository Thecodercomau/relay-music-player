# 📖 Relay Music Player — deploy runbook (Supabase edition)

Everything below is clickable in the Supabase dashboard; the CLI is optional
(only needed for local commands, and CI can deploy for you once configured).

**Total time: ~30 minutes. Cost: $0.**

---

## Step 1 — Create the Supabase project

1. Go to **https://supabase.com** → **Start your project** (free tier).
2. Pick an org, a name (e.g. `relay-music-player`), and a password.
   The region doesn't matter much — nearest to you.
3. Wait ~2 minutes for provisioning. Then click into the project.

## Step 2 — Apply the database schema

1. Open **Dashboard → SQL Editor → New query**.
2. Copy the **entire** contents of `supabase/schema.sql` from this repo and
   paste it in.
3. Click **Run**.
4. Success looks like: `Success. No rows returned` and a green check.
   It creates `profiles`, `playlists`, `playlist_tracks`, `songs`, and the
   `uploads` storage bucket.

## Step 3 — Grab your three project values

Dashboard → **Project Settings → API**:

| Value | Where |
|---|---|
| **Project URL** | top of the page — `https://<project-ref>.supabase.co` |
| **anon public** key | `Project API keys` section |
| **service_role** key | `Project API keys` section (⚠️ secret — never ship it) |

## Step 4 — Set the function secrets

The Edge Functions read secrets from the project (Dashboard → **Edge
Functions → Secrets**), or with the CLI after linking:

| Secret | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | your `service_role` key from Step 3 |
| `JAMENDO_CLIENT_ID` | `d760e6b5` (your Jamendo client id) |

> `SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — don't
> add them.

## Step 5 — Deploy the Edge Functions

**Option A — GitHub Actions (recommended, automatic):**

1. Commit & push this repo's `supabase` branch (the workflow file is already there).
2. Add two repo secrets (Settings → **Secrets and variables → Actions**):
   - `SUPABASE_ACCESS_TOKEN` — Supabase Dashboard → **Account → Access
     tokens** → *Generate new token*
   - `SUPABASE_PROJECT_ID` — the `abc…` part of your Project URL
3. Any future push to `supabase` re-deploys the functions automatically.

**Option B — CLI (manual):**

```bash
supabase login                      # opens a browser to authorize
supabase link --project-ref <project-ref>
supabase db push                    # applies supabase/schema.sql
supabase functions deploy music songs users playlists
```

**Option C — Dashboard (no CLI):**

Dashboard → **Edge Functions** → *Deploy a new function* for each of
`music`, `songs`, `users`, `playlists`, pasting the file contents from
`supabase/functions/<name>/index.ts` (and `_shared/helpers.ts` first).

## Step 6 — Configure the frontend

Edit **`js/supabase.js`** in the repo:

```js
const RELAY_SUPABASE = {
  url: "https://<project-ref>.supabase.co",
  anonKey: "eyJhbGciOi...",   // the anon public key
};
```

Commit and push — GitHub Pages publishes it (step 7).

## Step 7 — Publish the frontend (GitHub Pages)

1. Repo → **Settings → Pages**.
2. **Source: GitHub Actions** (not "Deploy from a branch" — our workflow
   handles it). Save — nothing else to click.
3. First deploy happens on the next push to `supabase` (or use **Actions →
   Deploy → Run workflow** to trigger manually).
4. Your site URL: `https://<username>.github.io/relay-music-player/`

## Step 8 — First run

1. Open your site → **Sign up**. The **first account is auto-promoted to
   admin** (so the Admin tab is unlocked for you).
2. If signup says "check your email", either confirm it in your inbox, or
   turn confirmation off (Dashboard → **Authentication → Providers →
   Email → “Confirm email”** off) for instant login — fine for a demo.
3. Log in → the Player loads "Suggested for you" from Jamendo. ✔
4. Optional: seed your library — Admin tab → add a URL, or call
   `https://<project-ref>.supabase.co/functions/v1/music?action=seed&q=lo-fi&limit=25`
   in a logged-in tab.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Supabase is not configured yet" | Step 6 — fill `js/supabase.js` |
| Functions return 401 | The `Authorization` header isn't sent — log in first |
| Search returns empty | `JAMENDO_CLIENT_ID` secret missing (Step 4) |
| Upload fails | Check the `uploads` bucket exists (Step 2) and you're logged in |
| Pages shows a 404 | Settings → Pages → Source must be **GitHub Actions** |
