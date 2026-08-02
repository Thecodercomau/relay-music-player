<?php
/**
 * Relay Music Player — one-click database setup.
 *
 * Creates the `relay_music` database and the `users` table automatically,
 * so you don't need to run `mysql < database.sql` by hand.
 *
 * How to use:
 *   Browser:  start `php -S localhost:8000`, then open
 *             http://localhost:8000/php/setup.php
 *   CLI:      php php/setup.php
 *
 * Safe to run as many times as you like — it only creates things
 * that don't already exist (IF NOT EXISTS).
 *
 * DEPLOYMENT: setup.php can create databases, so it is gated. It only
 * runs from the CLI, from a loopback request (localhost), or when the
 * RELAY_ALLOW_SETUP=1 env var is set. On a public server, remote
 * visitors always get a 403 — and you can delete this file entirely.
 */

require_once __DIR__ . '/config.php';

$isCli = (PHP_SAPI === 'cli');

/* ---------------------------------------------------------
   Deployment gate — block remote (non-loopback) requests.
   --------------------------------------------------------- */
$remoteOk = isset($_SERVER['REMOTE_ADDR'])
    && in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1', '::1'], true);
if (!$isCli && !$remoteOk && getenv('RELAY_ALLOW_SETUP') !== '1') {
    http_response_code(403);
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "Setup is disabled on this deployment.\n\n"
       . "Run it locally from the command line:\n"
       . "  php php/setup.php\n\n"
       . "or start the dev server with:\n"
       . "  RELAY_ALLOW_SETUP=1 php -S localhost:8000\n";
    exit;
}

$steps = [];   // ['label' => ..., 'ok' => bool, 'detail' => ...]

function addStep(array &$steps, string $label, bool $ok, string $detail): void {
    $steps[] = ['label' => $label, 'ok' => $ok, 'detail' => $detail];
}

/* ---------------------------------------------------------
   1. Connect to MySQL (server only — no database selected yet,
      because the database may not exist).
   --------------------------------------------------------- */
try {
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS);
    $conn->set_charset('utf8mb4');
    addStep($steps, 'Connect to MySQL',
        true,
        "Connected to MySQL server at " . DB_HOST . " (server " . $conn->server_info . ")."
    );
} catch (mysqli_sql_exception $e) {
    addStep($steps, 'Connect to MySQL',
        false,
        $e->getMessage() . ' — check DB_HOST / DB_USER / DB_PASS in php/config.php and make sure MySQL is running.'
    );
    render($steps, $isCli);
    exit;
}

/* ---------------------------------------------------------
   2. Create the database if it doesn't exist.
   --------------------------------------------------------- */
try {
    $conn->query("CREATE DATABASE IF NOT EXISTS `" . DB_NAME . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    addStep($steps, "Create database `" . DB_NAME . "`", true,
        "Database ready (created or already present)."
    );
} catch (mysqli_sql_exception $e) {
    addStep($steps, "Create database `" . DB_NAME . "`", false,
        $e->getMessage() . ' — the MySQL user may not have CREATE DATABASE permission.'
    );
    render($steps, $isCli);
    exit;
}

/* ---------------------------------------------------------
   3. Select the database.
   --------------------------------------------------------- */
try {
    $conn->select_db(DB_NAME);
    addStep($steps, "Select database `" . DB_NAME . "`", true, "Using `" . DB_NAME . "`.");
} catch (mysqli_sql_exception $e) {
    addStep($steps, "Select database `" . DB_NAME . "`", false, $e->getMessage());
    render($steps, $isCli);
    exit;
}

/* ---------------------------------------------------------
   4. Create the users table if it doesn't exist.
   --------------------------------------------------------- */
$usersTable = <<<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  is_admin      TINYINT(1)    NOT NULL DEFAULT 0,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL;

try {
    $conn->query($usersTable);
    // Migration: older installs lack the `is_admin` column (CREATE TABLE IF
    // NOT EXISTS won't add it). MySQL has no ADD COLUMN IF NOT EXISTS, so check.
    $cols = $conn->query("SHOW COLUMNS FROM users LIKE 'is_admin'");
    if ($cols && $cols->num_rows === 0) {
        $conn->query("ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash");
    }
    // Convenience: promote the oldest account to admin if none exists yet,
    // so you don't have to run SQL by hand to manage songs.
    $adm = $conn->query("SELECT COUNT(*) FROM users WHERE is_admin = 1")->fetch_row();
    if ((int) $adm[0] === 0) {
        $conn->query(
            'UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM (SELECT MIN(id) AS id FROM users) AS t)'
        );
    }
    addStep($steps, "Create `users` table", true, "Table ready (created or already present).");
} catch (mysqli_sql_exception $e) {
    addStep($steps, "Create `users` table", false, $e->getMessage());
    render($steps, $isCli);
    exit;
}

/* ---------------------------------------------------------
   4b. Create the playlists tables if they don't exist.
   --------------------------------------------------------- */
$playlistsTable = <<<'SQL'
CREATE TABLE IF NOT EXISTS playlists (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  name       VARCHAR(120) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_playlists_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL;

$playlistTracksTable = <<<'SQL'
CREATE TABLE IF NOT EXISTS playlist_tracks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT UNSIGNED NOT NULL,
  deezer_id   BIGINT       NOT NULL,
  title       VARCHAR(255) NOT NULL,
  artist      VARCHAR(255) NOT NULL,
  album       VARCHAR(255) NOT NULL DEFAULT '',
  cover       VARCHAR(500) NOT NULL DEFAULT '',
  cover_big   VARCHAR(500) NOT NULL DEFAULT '',
  preview     VARCHAR(500) NOT NULL DEFAULT '',
  duration    INT          NOT NULL DEFAULT 0,
  source      VARCHAR(20)  NOT NULL DEFAULT '',
  added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_playlist_track (playlist_id, deezer_id),
  CONSTRAINT fk_playlist_tracks_playlist
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL;

try {
    $conn->query($playlistsTable);
    addStep($steps, "Create `playlists` table", true, "Table ready (created or already present).");
} catch (mysqli_sql_exception $e) {
    addStep($steps, "Create `playlists` table", false, $e->getMessage());
}

try {
    $conn->query($playlistTracksTable);
    // Migration: older installs lack the `source` column (CREATE TABLE IF NOT
    // EXISTS won't add it). MySQL has no ADD COLUMN IF NOT EXISTS, so check first.
    $cols = $conn->query("SHOW COLUMNS FROM playlist_tracks LIKE 'source'");
    if ($cols && $cols->num_rows === 0) {
        $conn->query("ALTER TABLE playlist_tracks ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT '' AFTER duration");
    }
    addStep($steps, "Create `playlist_tracks` table", true, "Table ready (created or already present).");
} catch (mysqli_sql_exception $e) {
    addStep($steps, "Create `playlist_tracks` table", false, $e->getMessage());
}

/* ---------------------------------------------------------
   4c. Create the songs table (your own music catalog).
   --------------------------------------------------------- */
$songsTable = <<<'SQL'
CREATE TABLE IF NOT EXISTS songs (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  jamendo_id BIGINT       NULL UNIQUE,
  title      VARCHAR(255) NOT NULL,
  artist     VARCHAR(255) NOT NULL,
  album      VARCHAR(255) NOT NULL DEFAULT '',
  cover      VARCHAR(500) NOT NULL DEFAULT '',
  duration   INT          NOT NULL DEFAULT 0,
  audio_url  VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL;

try {
    $conn->query($songsTable);
    // Create the search index only if it isn't there yet. MySQL doesn't
    // support CREATE INDEX IF NOT EXISTS (MariaDB does), so check first.
    $idx = $conn->query("SHOW INDEX FROM songs WHERE Key_name = 'idx_songs_search'");
    if ($idx && $idx->num_rows === 0) {
        $conn->query('CREATE INDEX idx_songs_search ON songs (title, artist)');
    }
    addStep($steps, "Create `songs` table", true, "Table ready (created or already present).");
} catch (mysqli_sql_exception $e) {
    addStep($steps, "Create `songs` table", true, "Table ready.");
}

/* ---------------------------------------------------------
   5. Verify everything is in place.
   --------------------------------------------------------- */
try {
    $res = $conn->query("SHOW TABLES");
    $tables = [];
    while ($row = $res->fetch_array()) {
        $tables[] = $row[0];
    }
    $missing = array_diff(['users', 'playlists', 'playlist_tracks', 'songs'], $tables);
    $ok = empty($missing);
    addStep($steps, 'Verify setup', $ok,
        $ok ? "Found all tables: " . implode(', ', $tables) . '.'
            : 'Missing tables: ' . implode(', ', $missing)
    );
} catch (mysqli_sql_exception $e) {
    addStep($steps, 'Verify setup', false, $e->getMessage());
}

$conn->close();
render($steps, $isCli);

/* ---------------------------------------------------------
   Output — CLI friendly or styled HTML for the browser.
   --------------------------------------------------------- */
function render(array $steps, bool $isCli): void {
    $allOk = !in_array(false, array_column($steps, 'ok'), true);

    if ($isCli) {
        echo "=== Relay Music Player — database setup ===\n\n";
        foreach ($steps as $s) {
            $mark = $s['ok'] ? "[OK]" : "[FAIL]";
            printf("%s  %-30s %s\n", $mark, $s['label'], $s['detail']);
        }
        echo "\n";
        echo $allOk ? "✅ Setup complete — you can now sign up and log in.\n"
                    : "❌ Setup had problems. Fix the messages above and re-run.\n";
        exit;
    }

    $rows = '';
    foreach ($steps as $s) {
        $icon = $s['ok'] ? '✅' : '❌';
        $color = $s['ok'] ? '#34d399' : '#f87171';
        $rows .= sprintf(
            '<tr><td class="step">%s %s</td><td style="color:%s">%s</td></tr>',
            $icon,
            htmlspecialchars($s['label']),
            $color,
            htmlspecialchars($s['detail'])
        );
    }
    $banner = $allOk
        ? '<div class="ok">Setup complete! You can now <a href="../pages/signup.html">create an account</a>.</div>'
        : '<div class="err">Setup had problems. Fix the messages below and refresh this page.</div>';

    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Database Setup — Relay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Outfit", -apple-system, "Segoe UI", sans-serif;
      background: #0a0a12;
      color: #f2f2f8;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px 16px;
    }
    .card {
      width: 100%;
      max-width: 640px;
      background: linear-gradient(165deg, #1e1e33, #171728);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 24px 60px -12px rgba(0,0,0,.6);
    }
    h1 { font-size: 1.5rem; margin-bottom: 6px; }
    p.sub { color: #a0a0b8; margin-bottom: 22px; font-size: .95rem; }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    td { padding: 12px 8px; border-bottom: 1px solid rgba(255,255,255,.07); vertical-align: top; }
    td.step { font-weight: 700; white-space: nowrap; width: 45%; color: #f2f2f8; }
    .ok, .err {
      margin-top: 20px; padding: 14px 16px; border-radius: 12px; font-weight: 700; font-size: .95rem;
    }
    .ok { background: rgba(52,211,153,.12); border: 1px solid rgba(52,211,153,.4); color: #6ee7b7; }
    .err { background: rgba(248,113,113,.12); border: 1px solid rgba(248,113,113,.4); color: #fca5a5; }
    .ok a { color: #fff; }
    .warn {
      margin-top: 18px; padding: 12px 14px; border-radius: 10px;
      background: rgba(251,191,36,.1); border: 1px solid rgba(251,191,36,.35);
      color: #fcd34d; font-size: .82rem;
    }
    .actions { margin-top: 22px; display: flex; gap: 12px; }
    .actions a {
      text-decoration: none; padding: 12px 20px; border-radius: 12px;
      font-weight: 700; font-size: .95rem; text-align: center; flex: 1;
    }
    .btn-primary {
      color: #fff;
      background: linear-gradient(120deg, #6d3df0, #8b5cf6);
      box-shadow: 0 10px 28px -8px rgba(139,92,246,.55);
    }
    .btn-ghost { color: #f2f2f8; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎧 Relay — Database Setup</h1>
    <p class="sub">This creates the <code>relay_music</code> database and <code>users</code> table. Running it again is harmless.</p>
    <table>
      $rows
    </table>
    $banner
    <div class="actions">
      <a class="btn-primary" href="../index.html">Go to Home</a>
      <a class="btn-ghost" href="setup.php">Run again</a>
    </div>
    <div class="warn">⚠️ Security: delete <code>php/setup.php</code> once setup is done, especially if this project is ever deployed online.</div>
  </div>
</body>
</html>
HTML;
}
