<?php
/**
 * Relay Music Player — admin songs API.
 *
 * Manage your own `songs` table (the DB-first source for search/trending)
 * without touching MySQL by hand. Admin accounts only.
 *
 * Actions:
 *   add     POST  — add a song. Audio comes from an uploaded file
 *                   (field `audio`) OR a direct URL (field `audio_url`).
 *                   Other fields: title, artist, album, cover, duration.
 *   list    GET   — all songs (newest first)
 *   delete  POST  — remove a song by id (also deletes its uploaded file)
 *
 * Admin rule: the FIRST account ever created is auto-promoted to admin by
 * php/setup.php (or you can set is_admin=1 on any user manually).
 */

require_once __DIR__ . '/config.php';

if (!isset($_SESSION['user_id'])) {
    json_response(['error' => 'Not authenticated. Please log in.'], 401);
}

try {
    $db = get_db();

    // Always verify admin from the DB — the session flag could be stale if
    // a user was demoted after login.
    $stmt = $db->prepare('SELECT is_admin FROM users WHERE id = ?');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $isAdmin = (int) ($stmt->get_result()->fetch_assoc()['is_admin'] ?? 0);
    if ($isAdmin !== 1) {
        json_response(['error' => 'Admin access required.'], 403);
    }

    $action = $_GET['action'] ?? ($_POST['action'] ?? '');

    switch ($action) {

        /* ---------------- add ---------------- */
        case 'add': {
            // When a POST body exceeds post_max_size (default 8M), PHP drops
            // the whole body, so $_POST and $_FILES come back EMPTY. Give a
            // clear "too large" message instead of a confusing missing-fields
            // error.
            if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && empty($_FILES) && empty($_POST)) {
                $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
                $postMax = (int) ini_get('post_max_size'); // e.g. 8 (MB)
                if ($contentLength > 0 && $postMax > 0 && $contentLength > $postMax * 1024 * 1024) {
                    json_response([
                        'error' => 'The upload is too large. PHP discards the request above '
                            . ini_get('post_max_size')
                            . '. Restart the server with: php -d upload_max_filesize=100M -d post_max_size=105M -S localhost:8000',
                    ], 400);
                }
            }

            $title  = trim($_POST['title'] ?? '');
            $artist = trim($_POST['artist'] ?? '');
            $album  = trim($_POST['album'] ?? '');
            if ($title === '' || $artist === '' || $album === '') {
                json_response(['error' => 'Title, artist and album are required.'], 400);
            }
            $cover    = trim($_POST['cover'] ?? '');
            $duration = max(0, (int) ($_POST['duration'] ?? 0));

            // ----- audio source: uploaded file OR URL -----
            $audioUrl = '';
            $savedFile = false; // did we store a file in uploads/?

            if (!empty($_FILES['audio']['name'])) {
                // Clear, specific error when the file exceeds PHP's upload limit
                // (default 2M) instead of a generic failure.
                $uploadError = $_FILES['audio']['error'] ?? UPLOAD_ERR_OK;
                if ($uploadError === UPLOAD_ERR_INI_SIZE || $uploadError === UPLOAD_ERR_FORM_SIZE) {
                    json_response([
                        'error' => 'The audio file is too large. PHP allows at most '
                            . ini_get('upload_max_filesize')
                            . ' per upload. Restart the server with: php -d upload_max_filesize=100M -d post_max_size=105M -S localhost:8000',
                    ], 400);
                }
                if ($uploadError === UPLOAD_ERR_PARTIAL || $uploadError === UPLOAD_ERR_NO_FILE) {
                    json_response(['error' => 'The audio file did not upload completely. Please try again.'], 400);
                }
                $stored = store_uploaded_audio($_FILES['audio']);
                if ($stored === null) {
                    json_response(['error' => 'Could not save the audio file. Check the file type/size and that the uploads/ folder is writable.'], 400);
                }
                $audioUrl  = $stored;
                $savedFile = true;
            } else {
                $audioUrl = trim($_POST['audio_url'] ?? '');
                if ($audioUrl === '' || !filter_var($audioUrl, FILTER_VALIDATE_URL)) {
                    json_response(['error' => 'Provide an audio file or a valid audio URL.'], 400);
                }
                if (!preg_match('#^https?://#i', $audioUrl)) {
                    json_response(['error' => 'Audio URL must start with http:// or https://.'], 400);
                }
            }

            $stmt = $db->prepare(
                'INSERT INTO songs (jamendo_id, title, artist, album, cover, duration, audio_url)
                 VALUES (NULL, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->bind_param('ssssis', $title, $artist, $album, $cover, $duration, $audioUrl);
            $stmt->execute();
            $id = (int) $db->insert_id;

            // If the DB insert failed after we saved a file, don't leave orphans.
            if ($id <= 0 && $savedFile) {
                @unlink(UPLOADS_DIR . '/' . basename($audioUrl));
            }

            json_response([
                'success' => true,
                'song'    => [
                    'id'         => $id,
                    'title'      => $title,
                    'artist'     => $artist,
                    'album'      => $album,
                    'cover'      => $cover,
                    'duration'   => $duration,
                    'audio_url'  => $audioUrl,
                    'uploaded'   => $savedFile,
                ],
            ], 201);
        }

        /* ---------------- list ---------------- */
        case 'list': {
            $rows = $db->query(
                'SELECT id, title, artist, album, cover, duration, audio_url, created_at
                   FROM songs
                  ORDER BY created_at DESC, id DESC'
            )->fetch_all(MYSQLI_ASSOC);
            json_response(['success' => true, 'songs' => $rows]);
        }

        /* ---------------- delete ---------------- */
        case 'delete': {
            $id = (int) ($_POST['id'] ?? 0);
            if ($id <= 0) {
                json_response(['error' => 'Invalid song id.'], 400);
            }
            $stmt = $db->prepare('SELECT audio_url FROM songs WHERE id = ?');
            $stmt->bind_param('i', $id);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            if (!$row) {
                json_response(['error' => 'Song not found.'], 404);
            }

            $stmt = $db->prepare('DELETE FROM songs WHERE id = ?');
            $stmt->bind_param('i', $id);
            $stmt->execute();

            // Best-effort cleanup of the uploaded file (never follow outside uploads/)
            if (!empty($row['audio_url']) && str_starts_with($row['audio_url'], UPLOADS_URL . '/')) {
                $file = UPLOADS_DIR . '/' . basename($row['audio_url']);
                if (is_file($file)) {
                    @unlink($file);
                }
            }

            json_response(['success' => true, 'deleted' => $id]);
        }

        default:
            json_response(['error' => 'Unknown action. Use action=add, action=list or action=delete.'], 400);
    }
} catch (mysqli_sql_exception $e) {
    error_log('Songs API error: ' . $e->getMessage());
    json_response(['error' => 'Database error.'], 500);
}

/**
 * Validate an uploaded audio file and store it in uploads/.
 * Returns the public URL (e.g. /uploads/abc123-song.mp3) or null on failure.
 */
function store_uploaded_audio(array $file): ?string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        error_log('Upload error code: ' . ($file['error'] ?? 'unknown'));
        return null;
    }
    if (($file['size'] ?? 0) <= 0) {
        return null;
    }

    // Audio extensions we accept.
    $allowed = ['mp3', 'm4a', 'ogg', 'oga', 'wav', 'flac', 'aac', 'opus'];
    $ext = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed, true)) {
        error_log('Rejected upload extension: ' . $ext);
        return null;
    }

    // Only look at the first bytes — the actual content.
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = $finfo ? finfo_file($finfo, $file['tmp_name']) : '';
    // Note: finfo_close() is deprecated since PHP 8.5 — finfo objects are
    // freed automatically, so we deliberately don't call it.
    if ($mime !== '' && !str_starts_with($mime, 'audio/') && $mime !== 'application/octet-stream') {
        error_log('Rejected upload MIME: ' . $mime);
        return null;
    }

    if (!is_dir(UPLOADS_DIR)) {
        @mkdir(UPLOADS_DIR, 0775, true);
    }
    if (!is_dir(UPLOADS_DIR) || !is_writable(UPLOADS_DIR)) {
        return null;
    }

    // Unique, web-safe filename: uniqid + original name (sanitized).
    $safeBase = preg_replace('/[^A-Za-z0-9._-]+/', '-', pathinfo($file['name'], PATHINFO_FILENAME));
    $safeBase = trim($safeBase, '-') ?: 'song';
    $name = uniqid('', true) . '-' . $safeBase . '.' . $ext;

    if (!move_uploaded_file($file['tmp_name'], UPLOADS_DIR . '/' . $name)) {
        return null;
    }
    return UPLOADS_URL . '/' . $name;
}
