<?php
/**
 * Relay Music Player — shared configuration (TEMPLATE).
 *
 * To use, copy this file to `php/config.php` and fill in your values:
 *
 *     cp php/config.example.php php/config.php
 *
 * `php/config.php` is git-ignored, so your credentials are never published.
 * The first account you create is automatically promoted to admin by
 * php/setup.php.
 */

// Buffer all output from the very start so that any stray PHP
// warning/deprecation/notice can be discarded by json_response() instead
// of corrupting the JSON the browser tries to parse (the classic "upload
// fails with a JSON error" bug). Must be the first statement so even
// session_start() warnings are captured.
ob_start();

// ---- Database credentials (change these!) ----
define('DB_HOST', '127.0.0.1');
define('DB_USER', 'root');
define('DB_PASS', '');              // ← your MySQL password
define('DB_NAME', 'relay_music');

// ---- Music API (Jamendo) ----
// Free client_id for full-length, ad-free Creative Commons music.
// Get yours (takes ~1 minute): https://developers.jamendo.com -> create an app.
// Without a valid client_id, search/trending will return a helpful error.
define('JAMENDO_CLIENT_ID', '');    // ← your Jamendo client_id

// ---- Uploads (admin-managed songs) ----
// Uploaded audio files are stored here (web-accessible so they can be played).
define('UPLOADS_DIR', __DIR__ . '/../uploads');
define('UPLOADS_URL', '/uploads');

// ---- Session (used for login state) ----
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 0,          // session cookie
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('RELAY_SESSION');
    session_start();
}

function json_response(array $data, int $status = 200): void {
    // Throw away anything PHP may have printed before this point
    // (e.g. deprecation warnings while handling an upload).
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

function get_db(): mysqli {
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    return new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
}
