# 🎧 Relay Music Player

A free, ad-free music streaming client built with **HTML, CSS & JavaScript**, backed by a **PHP + MySQL** authentication system, and powered by the **Deezer API** for music search & playback.

## ✨ Features

- **Landing page** with animated hero, feature cards, and a navbar (Home / Sign Up / Login)
- **Sign up & login** — user accounts stored in MySQL with hashed passwords (bcrypt)
- **Login-gated player** — you must be logged in to listen or download
- **Ad-free streaming** — full-length, Creative Commons tracks via the Jamendo API
- **Full player controls** — play/pause, next/prev, seek bar, volume, shuffle & repeat
- **Download** any track as an MP3 with one click
- **Track details** — tap the ⓘ button on any track (or in the player bar) for a details panel with lyrics, release date, genre tags, and the Creative Commons license — with Play / Download / Add-to-playlist right there
- Responsive design that looks great on desktop and mobile

## 🚀 Getting Started

### 1. Install PHP

The login/signup backend is PHP. On macOS with Homebrew:

```bash
brew install php
```

(or use XAMPP/MAMP if you prefer)

### 2. Set up MySQL

Make sure MySQL is installed and running. Then pick **one** of these:

**Option A — one-click (recommended):** start the PHP server (step 4), then open

```
http://localhost:8000/php/setup.php
```

This automatically creates the `relay_music` database and `users` table, and
works from the command line too (`php php/setup.php`). It's safe to run
multiple times.

**Option B — manual:** import the schema directly:

```bash
mysql -u root -p < database.sql
```

Both create the `relay_music` database with a `users` table.

### 3. Configure database credentials

Fresh clone? First copy the template — the real `php/config.php` is
git-ignored so your credentials never get published:

```bash
cp php/config.example.php php/config.php
```

Then open `php/config.php` and update the `DB_*` constants to match your MySQL setup:

```php
define('DB_HOST', '127.0.0.1');
define('DB_USER', 'root');
define('DB_PASS', '');        // ← your MySQL password
define('DB_NAME', 'relay_music');
```

### 3b. Get a free Jamendo client_id (for full-length music)

The app streams **full-length, ad-free Creative Commons tracks** via the
[Jamendo API](https://developers.jamendo.com). Deezer only serves 30-second
previews — Jamendo gives you whole songs.

1. Go to **https://developers.jamendo.com** and create a free account
2. Open **My Apps → Add an app** — you'll get a `client_id` instantly
3. Paste it into `php/config.php`:

```php
define('JAMENDO_CLIENT_ID', 'your-client-id-here');
```

No client_id yet? The app still loads — search/trending just falls back to
your local songs table (if you've seeded one) or shows a helpful error.

### 3c. Build your own music database (optional)

The app is **hybrid**: it searches your own MySQL `songs` table first, and
only falls back to Jamendo when the database has no matches. To populate your
catalog, run `php/setup.php` once (creates the `songs` table), then seed it
from Jamendo — requires login and the `client_id` above:

```bash
# Seed 25 popular tracks:
php -S localhost:8000   # (in another terminal)
curl -b cookies.txt -c cookies.txt -X POST http://localhost:8000/php/login.php \
  --data 'email=you@example.com&password=yourpassword'
curl -b cookies.txt 'http://localhost:8000/php/music.php?action=seed&q=lo-fi&limit=25'
```

Or run in the browser after logging in:
`http://localhost:8000/php/music.php?action=seed&q=chill&limit=20`

Seeding is idempotent — running it again skips tracks already in the table.
Once your `songs` table has rows, **search and trending use your database**
until a query finds nothing, then fall back to Jamendo.

### 3d. Add songs manually — the Admin tab (no curl needed)

The player has an **Admin** tab (only visible to admins) where you can add
songs to your `songs` table straight from the browser:

- **Upload an audio file** (mp3, m4a, ogg, wav, flac…) — saved to `uploads/`
- **Or paste a direct audio URL**
- Then delete songs you don't want anymore

**Who is admin?** The very first account created in your app is automatically
promoted to admin by `php/setup.php`. New accounts are never admins.

To manage admins, open the **Admin tab → Manage users** — it lists every
account with a toggle to grant/revoke admin access (you can't remove your
own admin, and at least one admin must always remain). You can also set
`is_admin = 1` on any user manually via SQL.

> 💡 PHP's default `upload_max_filesize` is 2 MB. To upload bigger audio
> files, start the server with a higher limit:
>
> ```bash
> php -d upload_max_filesize=100M -d post_max_size=105M -S localhost:8000
> ```

All admin endpoints (`php/songs.php`) require a logged-in admin session.
Uploaded files live in `uploads/` and are served back for playback/downloads.

### 4. Run the dev server

From the project root:

```bash
php -S localhost:8000
```

Then open **http://localhost:8000** in your browser.

## 📁 Project structure

```
├── index.html          → Landing page (Home)
├── pages/
│   ├── signup.html     → Sign up
│   ├── login.html      → Login
│   └── player.html     → Music player (login required)
├── css/                → Styles (main, landing, auth, player, responsive)
├── js/
│   ├── api.js          → Deezer API wrapper
│   ├── auth.js         → Session / signup / login / logout helpers
│   ├── player.js       → Audio player engine (queue, shuffle, repeat, download)
│   └── app.js          → Page logic
├── php/                → Backend endpoints (mysqli + sessions)
│   ├── config.example.php → template — copy to config.php (git-ignored)
│   ├── config.php      → DB credentials + helpers (never committed)
│   ├── signup.php      → POST / create account
│   ├── login.php       → POST / verify credentials
│   ├── logout.php      → POST / destroy session
│   ├── session.php     → GET / current user
│   ├── songs.php       → Admin-only: add/list/delete songs
│   ├── users.php       → Admin-only: list users + toggle admin access
│   └── setup.php       → One-click DB/table creation (browser or CLI)
├── uploads/            → Audio files uploaded via the Admin tab
└── database.sql        → MySQL schema (manual alternative to setup.php)
```

## ⚠️ Before deploying

`php/setup.php` can create databases, so it's gated: it only runs from the
CLI, from `localhost`, or when `RELAY_ALLOW_SETUP=1` is set. For extra
safety on a public server, delete it entirely.

## 🚀 Deploying to alwaysdata (free)

This is a PHP + MySQL app, so it needs a host that provides **both**. The
[alwaysdata free plan](https://www.alwaysdata.com) includes PHP 8.x, a
MySQL/MariaDB database, SSH, a subdomain (`you.alwaysdata.net`) — no ads,
no credit card, no spin-down.

### 1. Sign up & create the site

1. Create a free account at https://www.alwaysdata.com
2. **Web → Sites → Add a site**: type `PHP`, pick the latest **PHP 8.x**
   runtime, keep the default root directory (`www/`).
3. **Databases → MySQL → Add a database** — note the values you get:
   database name, user, password, and the **MySQL host** (e.g.
   `mysql-xxx.alwaysdata.net`). Names include your account id
   (e.g. `u123456_dbname`).

### 2. Upload the code

Either clone over SSH (free plan has it — see **Account → Remote access**)
or upload with any SFTP client into `www/`:

```bash
cd www
git clone https://github.com/Thecodercomau/relay-music-player.git .
```

### 3. Configure the database

1. Copy the template: `cp php/config.example.php php/config.php`
2. Edit `php/config.php` with your alwaysdata values:

```php
define('DB_HOST', 'mysql-xxx.alwaysdata.net');   // NOT localhost
#define('DB_USER', 'u123456_dbname');
#define('DB_PASS', 'your-db-password');
#define('DB_NAME', 'u123456_dbname');
#define('JAMENDO_CLIENT_ID', 'your-jamendo-client-id');
```

3. Create the tables. Your alwaysdata account may not have `CREATE
   DATABASE` rights, so use **phpMyAdmin**
   (https://phpmyadmin.alwaysdata.com) to import `database.sql`, or from
   SSH run:

```bash
mysql -h mysql-xxx.alwaysdata.net -u u123456_dbname -p u123456_dbname < database.sql
```

### 4. Finish

- Open `https://you.alwaysdata.net` — you should see the landing page.
- Sign up — the **first account is auto-promoted to admin**.
- `uploads/` is tracked (`.gitkeep`) and writable by your account, so the
  Admin tab works out of the box.
- 🛡️ After setup, delete `php/setup.php` (or leave it — it returns 403
  for remote visitors).

## 🔌 The music database

The app already queries your MySQL `songs` table (created by `php/setup.php`)
before falling back to Jamendo. The `songs` table columns:

```sql
id, jamendo_id, title, artist, album, cover, duration, audio_url, created_at
```

You can add songs with `INSERT` statements (leave `jamendo_id` NULL for
hand-added rows), pull them from Jamendo with `?action=seed`, or — easiest —
use the **Admin tab** in the player (no SQL, no curl). The frontend only
relies on the normalized track shape:

```js
{
  id, title, artist, album, duration, preview, cover, coverBig
}
```

## 📄 License

Released under the [MIT License](LICENSE). The app streams Creative Commons
music via the Jamendo API; audio uploaded by admins through the Admin tab is
the responsibility of the uploader.

## 🔐 Security notes

- Passwords are hashed with PHP's `password_hash()` (bcrypt)
- All DB queries use prepared statements (SQL-injection safe)
- Sessions use `httponly` + `SameSite=Lax` cookies
- `session_regenerate_id()` on login prevents session fixation
- Admin endpoints are gated on `is_admin` (re-verified from the DB on every
  request); uploaded audio is validated (extension + MIME) and stored under
  a unique, web-safe filename
- User management guards: you can't demote yourself, and at least one admin
  must always remain
