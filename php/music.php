<?php
/**
 * Relay Music Player — music API (hybrid: your DB first, Jamendo fallback).
 *
 * Search & trending query your own MySQL `songs` table first. When the
 * database has no matches (or is empty), it falls back to the Jamendo API
 * so the app never shows an empty screen.
 *
 * Usage:
 *   php/music.php?action=search&q=chill&limit=30   → DB, then Jamendo
 *   php/music.php?action=trending&limit=30          → DB, then Jamendo
 *   php/music.php?action=details&id=123456          → full track details (lyrics, tags, license)
 *   php/music.php?action=seed&q=chill&limit=20      → fetch Jamendo → insert into songs
 *   php/music.php?action=seed&limit=20              → seed trending
 *   php/music.php?action=stream&url=...             → audio proxy for downloads (login)
 *
 * Populate your catalog:  php/music.php?action=seed&q=lo-fi&limit=25
 * (seed requires login and a Jamendo client_id; search/trending only need
 *  a client_id when falling back to Jamendo).
 */

require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';
$limit  = max(1, min(50, (int) ($_GET['limit'] ?? 30)));

/* ---------------------------------------------------------
   action=stream — proxy a Jamendo audio file for downloads.
   (Playback uses the direct audio URL; this is only for saving files.)
   --------------------------------------------------------- */
if ($action === 'stream') {
    if (!isset($_SESSION['user_id'])) {
        json_response(['error' => 'Not authenticated. Please log in.'], 401);
    }
    $url = trim($_GET['url'] ?? '');
    if (!is_jamendo_url($url)) {
        json_response(['error' => 'Invalid stream URL.'], 400);
    }
    stream_audio($url);
}

/* ---------------------------------------------------------
   action=seed — pull Jamendo results into your songs table.
   --------------------------------------------------------- */
if ($action === 'seed') {
    if (!isset($_SESSION['user_id'])) {
        json_response(['error' => 'Not authenticated. Please log in.'], 401);
    }
    if (JAMENDO_CLIENT_ID === '') {
        json_response(['error' => 'Jamendo client_id is required for seeding. Add JAMENDO_CLIENT_ID in php/config.php'], 500);
    }

    $q = trim($_GET['q'] ?? '');
    $url = 'https://api.jamendo.com/v3.0/tracks/?client_id=' . urlencode(JAMENDO_CLIENT_ID)
        . '&format=json&limit=' . $limit . '&order=popularity_total';
    if ($q !== '') {
        $url .= '&search=' . urlencode($q);
    }

    $result = fetch_json($url, true); // require results — Jamendo backends are flaky
    if ($result === null) {
        json_response(['error' => 'Could not reach the Jamendo API.'], 502);
    }
    if (isset($result['headers']['status']) && $result['headers']['status'] === 'failed') {
        json_response(['error' => $result['headers']['error_message'] ?? 'Jamendo API error.'], 502);
    }

    $seeded = seed_songs($result['results'] ?? []);
    json_response([
        'success' => true,
        'seeded'  => $seeded,
        'total'   => (int) count_songs(),
        'query'   => $q,
    ]);
}

/* ---------------------------------------------------------
   action=details — full track details (lyrics, tags, license).
   No login required: it's metadata only, like search/trending.
   --------------------------------------------------------- */
if ($action === 'details') {
    $id = (int) ($_GET['id'] ?? 0);
    if ($id <= 0) {
        json_response(['error' => 'Missing track id.'], 400);
    }
    $details = track_details($id);
    if ($details === null) {
        json_response(['error' => 'Track not found.'], 404);
    }
    json_response(['data' => $details]);
}

/* ---------------------------------------------------------
   search / trending — hybrid: DB first, Jamendo fallback.
   --------------------------------------------------------- */
switch ($action) {
    case 'search':
        $q = trim($_GET['q'] ?? '');
        if ($q === '') {
            json_response(['error' => 'Missing search query.'], 400);
        }
        $tracks = db_search_tracks($q, $limit);
        if (count($tracks) > 0) {
            json_response(['data' => $tracks, 'source' => 'database']);
        }
        // Fall through to Jamendo
        $tracks = jamendo_search_tracks($q, $limit);
        json_response(['data' => $tracks, 'source' => 'jamendo']);

    case 'trending':
        $tracks = db_trending_tracks($limit);
        if (count($tracks) > 0) {
            json_response(['data' => $tracks, 'source' => 'database']);
        }
        $tracks = jamendo_trending_tracks($limit);
        json_response(['data' => $tracks, 'source' => 'jamendo']);

    default:
        json_response(['error' => 'Unknown action. Use action=search, action=trending, action=seed or action=stream.'], 400);
}

/* =========================================================
   Database helpers
   ========================================================= */

/** Search the local songs table. Returns [] if the table is missing. */
function db_search_tracks(string $q, int $limit): array {
    try {
        $db = get_db();
        // Escape LIKE wildcards so a query like "100%" matches literally
        // instead of matching every row containing "100".
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
        $like = '%' . $escaped . '%';
        $stmt = $db->prepare(
            'SELECT id, title, artist, album, cover, duration, audio_url
               FROM songs
              WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
              ORDER BY title ASC
              LIMIT ?'
        );
        $stmt->bind_param('sssi', $like, $like, $like, $limit);
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        return array_map('map_db_track', $rows);
    } catch (mysqli_sql_exception $e) {
        error_log('DB search error: ' . $e->getMessage());
        return [];
    }
}

/** Most recently added songs from the local table. */
function db_trending_tracks(int $limit): array {
    try {
        $db = get_db();
        $stmt = $db->prepare('SELECT id, title, artist, album, cover, duration, audio_url FROM songs ORDER BY created_at DESC, id DESC LIMIT ?');
        $stmt->bind_param('i', $limit);
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        return array_map('map_db_track', $rows);
    } catch (mysqli_sql_exception $e) {
        error_log('DB trending error: ' . $e->getMessage());
        return [];
    }
}

/** Map a songs row into the track shape the frontend expects. */
function map_db_track(array $row): array {
    $image = $row['cover'] ?? '';
    return [
        'id'       => (int) $row['id'],
        'title'    => $row['title'] ?? 'Unknown track',
        'artist'   => ['name' => $row['artist'] ?? 'Unknown artist'],
        'album'    => [
            'title'        => $row['album'] ?? '',
            'cover_medium' => $image,
            'cover_big'    => $image,
        ],
        'duration' => (int) ($row['duration'] ?? 0),
        'preview'  => $row['audio_url'] ?? '',
        'source'   => 'database',
    ];
}

/** Insert Jamendo results into songs (skips duplicates via jamendo_id). */
function seed_songs(array $results): int {
    $seeded = 0;
    try {
        $db = get_db();
        $stmt = $db->prepare(
            'INSERT IGNORE INTO songs (jamendo_id, title, artist, album, cover, duration, audio_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        // One transaction for the whole batch — faster and atomic.
        $db->begin_transaction();
        foreach ($results as $t) {
            if (empty($t['audio'])) continue;
            $stmt->bind_param(
                'issssis',
                (int) $t['id'],
                $t['name'] ?? 'Unknown track',
                $t['artist_name'] ?? 'Unknown artist',
                $t['album_name'] ?? '',
                $t['image'] ?? '',
                (int) ($t['duration'] ?? 0),
                $t['audio']
            );
            $stmt->execute();
            if ($stmt->affected_rows > 0) {
                $seeded++;
            }
        }
        $db->commit();
    } catch (mysqli_sql_exception $e) {
        if (isset($db)) {
            $db->rollback();
        }
        error_log('Seed error: ' . $e->getMessage());
    }
    return $seeded;
}

/** Total number of songs in the local table. */
function count_songs(): int {
    try {
        $db = get_db();
        $res = $db->query('SELECT COUNT(*) FROM songs');
        return (int) $res->fetch_row()[0];
    } catch (mysqli_sql_exception $e) {
        return 0;
    }
}

/** Find a song row by its local id OR its Jamendo id. */
function db_find_song(int $id): ?array {
    try {
        $db = get_db();
        $stmt = $db->prepare(
            'SELECT id, jamendo_id, title, artist, album, cover, duration, audio_url
               FROM songs
              WHERE id = ? OR jamendo_id = ?
              LIMIT 1'
        );
        $stmt->bind_param('ii', $id, $id);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        return $row ?: null;
    } catch (mysqli_sql_exception $e) {
        error_log('DB find song error: ' . $e->getMessage());
        return null;
    }
}

/**
 * Full details for one track — local DB first (so hand-added songs
 * and uploaded files keep working without Jamendo), Jamendo fallback.
 */
function track_details(int $id): ?array {
    $row = db_find_song($id);

    if ($row !== null) {
        $jamendoId = (int) ($row['jamendo_id'] ?? 0);
        if ($jamendoId > 0) {
            $details = jamendo_track_details($jamendoId);
            if ($details !== null) {
                $details['source'] = 'database';
                // Locally uploaded audio (path starts with "/") is the
                // authoritative source for this row.
                if (isset($row['audio_url']) && str_starts_with($row['audio_url'], '/')) {
                    $details['preview']     = $row['audio_url'];
                    $details['downloadUrl'] = $row['audio_url'];
                }
                return $details;
            }
        }
        // Hand-added row (or Jamendo lookup failed) — return what we know.
        return [
            'id'              => (int) $row['id'],
            'title'           => $row['title'] ?? 'Unknown track',
            'artist'          => $row['artist'] ?? 'Unknown artist',
            'album'           => $row['album'] ?? '',
            'cover'           => $row['cover'] ?? '',
            'duration'        => (int) ($row['duration'] ?? 0),
            'preview'         => $row['audio_url'] ?? '',
            'downloadUrl'     => $row['audio_url'] ?? '',
            'downloadAllowed' => true,
            'releasedate'     => '',
            'lang'            => '',
            'tags'            => [],
            'license'         => '',
            'lyrics'          => '',
            'source'          => 'database',
        ];
    }

    return jamendo_track_details($id);
}

/* =========================================================
   Jamendo helpers (fallback + seeding source)
   ========================================================= */

function jamendo_search_tracks(string $q, int $limit): array {
    if (JAMENDO_CLIENT_ID === '') {
        return [];
    }
    $url = 'https://api.jamendo.com/v3.0/tracks/?client_id=' . urlencode(JAMENDO_CLIENT_ID)
        . '&format=json&search=' . urlencode($q)
        . '&limit=' . $limit . '&order=popularity_total';
    return fetch_jamendo_tracks($url);
}

function jamendo_trending_tracks(int $limit): array {
    if (JAMENDO_CLIENT_ID === '') {
        return [];
    }
    $url = 'https://api.jamendo.com/v3.0/tracks/?client_id=' . urlencode(JAMENDO_CLIENT_ID)
        . '&format=json&limit=' . $limit . '&order=popularity_total';
    return fetch_jamendo_tracks($url);
}

function fetch_jamendo_tracks(string $url): array {
    $result = fetch_json($url, true); // require results — Jamendo backends are flaky
    if ($result === null) {
        return [];
    }
    if (isset($result['headers']['status']) && $result['headers']['status'] === 'failed') {
        error_log('Jamendo error: ' . ($result['headers']['error_message'] ?? 'unknown'));
        return [];
    }
    return array_map('map_jamendo_track', $result['results'] ?? []);
}

/**
 * Flatten assorted tag-group shapes (e.g. {genres: [], instruments: [],
 * vartags: []} or a flat list) into a clean, de-duplicated tag list.
 */
function collect_tag_groups(array $groups): array {
    $tags = [];
    foreach ($groups as $group) {
        if (is_array($group)) {
            foreach ($group as $tag) {
                $tags[] = (string) $tag;
            }
        } else {
            $tags[] = (string) $group;
        }
    }
    return array_values(array_unique(array_filter(array_map('trim', $tags))));
}

/**
 * Full details for one Jamendo track — lyrics, tags, license.
 * Uses only single-value `include` params (the documented syntax).
 */
function jamendo_track_details(int $id): ?array {
    if (JAMENDO_CLIENT_ID === '') {
        return null;
    }

    // Main call: better audio (mp32), hi-res cover, lyrics.
    // NOTE: keep every `include` to a SINGLE value — curl's FOLLOWLOCATION
    // re-encodes '+' as %2B when following a redirect, and multi-value
    // includes like "musicinfo+lyrics" then match nothing (0 results).
    $url = 'https://api.jamendo.com/v3.0/tracks/?client_id=' . urlencode(JAMENDO_CLIENT_ID)
        . '&id=' . $id
        . '&format=json'
        . '&include=lyrics'
        . '&audioformat=mp32&audiodlformat=mp32&imagesize=600';
    $result = fetch_json($url, true); // require results — Jamendo backends are flaky
    if ($result === null || (isset($result['headers']['status']) && $result['headers']['status'] === 'failed')) {
        return null;
    }
    $t = $result['results'][0] ?? null;
    if (!is_array($t)) {
        return null;
    }

    $details = map_jamendo_details($t);

    // Second call — genre tags + language (single include again; also
    // subject to the flaky backend, so require results too).
    $miUrl = 'https://api.jamendo.com/v3.0/tracks/?client_id=' . urlencode(JAMENDO_CLIENT_ID)
        . '&id=' . $id . '&format=json&include=musicinfo&limit=1';
    $mi = fetch_json($miUrl, true);
    if ($mi !== null && is_array($mi['results'][0]['musicinfo'] ?? null)) {
        $miInfo = $mi['results'][0]['musicinfo'];
        if ($details['tags'] === [] && isset($miInfo['tags']) && is_array($miInfo['tags'])) {
            $details['tags'] = array_slice(collect_tag_groups($miInfo['tags']), 0, 8);
        }
        if ($details['lang'] === '' && isset($miInfo['lang'])) {
            $details['lang'] = (string) $miInfo['lang'];
        }
    }

    // License fallback — license_ccurl may only appear with include=licenses.
    if ($details['license'] === '') {
        $licUrl = 'https://api.jamendo.com/v3.0/tracks/?client_id=' . urlencode(JAMENDO_CLIENT_ID)
            . '&id=' . $id . '&format=json&include=licenses&limit=1';
        $lic = fetch_json($licUrl);
        if ($lic !== null && is_array($lic['results'][0]['licenses'] ?? null)) {
            foreach ($lic['results'][0]['licenses'] as $l) {
                foreach (['ccurl', 'url'] as $k) {
                    if (!empty($l[$k])) {
                        $details['license'] = $l[$k];
                        break 2;
                    }
                }
            }
        }
    }

    return $details;
}

/** Map a full Jamendo track into the details shape the frontend expects. */
function map_jamendo_details(array $t): array {
    $image = !empty($t['album_image']) ? $t['album_image'] : ($t['image'] ?? '');

    // Creative Commons license URL, e.g. https://creativecommons.org/licenses/by-nc-nd/3.0/
    $license = $t['license_ccurl'] ?? '';

    // Genre / instrument / theme tags (assorted shapes across API versions).
    $tags = [];
    if (is_array($t['tags'] ?? null)) {
        $tags = collect_tag_groups($t['tags']);
    }
    if (isset($t['musicinfo']['tags']) && is_array($t['musicinfo']['tags'])) {
        $tags = collect_tag_groups($t['musicinfo']['tags']);
    }

    // Lyrics come back as a plain string (some API versions wrap it).
    $lyrics = '';
    if (isset($t['lyrics']) && is_string($t['lyrics'])) {
        $lyrics = $t['lyrics'];
    } elseif (isset($t['lyrics']['lyrics']) && is_string($t['lyrics']['lyrics'])) {
        $lyrics = $t['lyrics']['lyrics'];
    }

    // Language lives under musicinfo (top-level lang is usually absent).
    $lang = $t['lang'] ?? '';
    if ($lang === '' && isset($t['musicinfo']['lang'])) {
        $lang = $t['musicinfo']['lang'];
    }

    return [
        'id'              => (int) $t['id'],
        'title'           => $t['name'] ?? 'Unknown track',
        'artist'          => $t['artist_name'] ?? 'Unknown artist',
        'album'           => $t['album_name'] ?? '',
        'cover'           => $image,
        'duration'        => (int) ($t['duration'] ?? 0),
        'preview'         => $t['audio'] ?? '',
        'downloadUrl'     => $t['audiodownload'] ?? '',
        'downloadAllowed' => (bool) ($t['audiodownload_allowed'] ?? true),
        'releasedate'     => $t['releasedate'] ?? '',
        'lang'            => (string) $lang,
        'tags'            => array_slice($tags, 0, 8),
        'license'         => $license,
        'lyrics'          => $lyrics,
        'source'          => 'jamendo',
    ];
}

/** Map a Jamendo track into the shape js/api.js normalizeTrack() expects. */
function map_jamendo_track(array $t): array {
    $image = $t['image'] ?? '';
    return [
        'id'       => (int) $t['id'],
        'title'    => $t['name'] ?? 'Unknown track',
        'artist'   => ['name' => $t['artist_name'] ?? 'Unknown artist'],
        'album'    => [
            'title'        => $t['album_name'] ?? '',
            'cover_medium' => $image,
            'cover_big'    => $image,
        ],
        'duration' => (int) ($t['duration'] ?? 0),
        'preview'  => $t['audio'] ?? '',
        'source'   => 'jamendo',
    ];
}

/**
 * SSRF guard: is this URL an https URL on a *.jamendo.com / *.jamendo.net host?
 */
function is_jamendo_url(string $url): bool {
    $parts = parse_url($url);
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
        return false;
    }
    $host = strtolower($parts['host']);
    return $host === 'jamendo.com' || $host === 'jamendo.net'
        || str_ends_with($host, '.jamendo.com')
        || str_ends_with($host, '.jamendo.net');
}

/**
 * Stream a Jamendo audio file back to the browser (download support).
 */
function stream_audio(string $url): void {
    // Drop any buffered output so the binary audio below is sent unbuffered
    // and Content-Length always matches the body exactly (a stray PHP warning
    // must never corrupt a downloaded file).
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER     => true,
        CURLOPT_FOLLOWLOCATION     => true,
        CURLOPT_MAXREDIRS          => 3,
        // Note: CURLOPT_PROTOCOLS is deprecated since PHP 8.3 — use _STR variant.
        CURLOPT_PROTOCOLS_STR      => 'https',
        CURLOPT_REDIR_PROTOCOLS_STR => 'https',
        CURLOPT_TIMEOUT            => 30,
        CURLOPT_USERAGENT          => 'Relay-Music-Player/1.0 (+https://localhost)',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    if ($body === false || $code >= 400) {
        json_response(['error' => 'Could not stream audio.'], 502);
    }

    header('Content-Type: audio/mpeg');
    header('Content-Length: ' . strlen($body));
    header('Access-Control-Allow-Origin: *');
    echo $body;
    exit;
}

/**
 * Fetch a URL server-side and decode it as JSON.
 *
 * Jamendo's backend is load-balanced behind Cloudflare and occasionally
 * answers a perfectly valid query with an empty result list (or a transient
 * "failed" status) — we retry a few times with a short backoff to ride over
 * those blips. Verified empirically: the same URL flips between 1 and 0
 * results across repeated requests.
 *
 * @param string $url            URL to fetch
 * @param bool   $requireResults also retry when the API returns an empty
 *                               result list (details/search/trending need rows)
 * @param int    $maxAttempts    total attempts (default 3)
 * @return array|null decoded JSON, or null on final failure
 */
function fetch_json(string $url, bool $requireResults = false, int $maxAttempts = 3): ?array {
    $last = null;
    for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
        $last = fetch_json_once($url);
        $retryable = $last === null
            || (isset($last['headers']['status']) && $last['headers']['status'] === 'failed')
            || ($requireResults && empty($last['results']));
        if (!$retryable) {
            return $last;
        }
        if ($attempt < $maxAttempts - 1) {
            usleep(200000 * ($attempt + 1)); // 200ms, 400ms… backoff
        }
    }
    return $last;
}

/** Single, non-retrying fetch attempt (curl or stream fallback). */
function fetch_json_once(string $url): ?array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_USERAGENT      => 'Relay-Music-Player/1.0 (+https://localhost)',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        // Note: no curl_close() — it's a no-op and deprecated since PHP 8.5.
    } else {
        $context = stream_context_create([
            'http' => [
                'timeout' => 10,
                'user_agent' => 'Relay-Music-Player/1.0 (+https://localhost)',
                'ignore_errors' => true,
            ],
        ]);
        $body = @file_get_contents($url, false, $context);
        $code = 200;
    }

    if ($body === false || $code >= 400) {
        return null;
    }

    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}
