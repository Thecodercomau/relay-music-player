<?php
/**
 * Relay Music Player — playlists API.
 *
 * CRUD for user playlists backed by MySQL.
 * All endpoints require a logged-in session.
 *
 * Actions (GET or POST):
 *   list                → all playlists for the current user (with track counts)
 *   create  &name=...   → create a playlist
 *   get     &id=...     → a playlist with its tracks
 *   addTrack            → add a track snapshot to a playlist
 *   removeTrack         → remove a track from a playlist
 *   delete  &id=...     → delete a playlist (cascades its tracks)
 */

require_once __DIR__ . '/config.php';

if (!isset($_SESSION['user_id'])) {
    json_response(['error' => 'Not authenticated. Please log in.'], 401);
}

$userId = (int) $_SESSION['user_id'];
$action = $_GET['action'] ?? ($_POST['action'] ?? '');

try {
    $db = get_db();

    switch ($action) {

        /* ---------------- list ---------------- */
        case 'list': {
            $stmt = $db->prepare(
                'SELECT p.id, p.name, p.created_at, COUNT(t.id) AS track_count
                   FROM playlists p
                   LEFT JOIN playlist_tracks t ON t.playlist_id = p.id
                  WHERE p.user_id = ?
                  GROUP BY p.id
                  ORDER BY p.created_at DESC'
            );
            $stmt->bind_param('i', $userId);
            $stmt->execute();
            $playlists = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
            json_response(['success' => true, 'playlists' => $playlists]);
        }

        /* ---------------- create ---------------- */
        case 'create': {
            $name = trim($_POST['name'] ?? '');
            if ($name === '') {
                json_response(['error' => 'Playlist name is required.'], 400);
            }
            if (mb_strlen($name) > 120) {
                $name = mb_substr($name, 0, 120);
            }
            $stmt = $db->prepare('INSERT INTO playlists (user_id, name) VALUES (?, ?)');
            $stmt->bind_param('is', $userId, $name);
            $stmt->execute();
            json_response([
                'success'  => true,
                'playlist' => ['id' => (int) $db->insert_id, 'name' => $name, 'track_count' => 0],
            ], 201);
        }

        /* ---------------- get (with tracks) ---------------- */
        case 'get': {
            $id = (int) ($_GET['id'] ?? 0);
            $stmt = $db->prepare('SELECT id, name, created_at FROM playlists WHERE id = ? AND user_id = ?');
            $stmt->bind_param('ii', $id, $userId);
            $stmt->execute();
            $playlist = $stmt->get_result()->fetch_assoc();
            if (!$playlist) {
                json_response(['error' => 'Playlist not found.'], 404);
            }

            $stmt = $db->prepare(
                'SELECT id, deezer_id, title, artist, album, cover, cover_big, preview, duration, source, added_at
                   FROM playlist_tracks
                  WHERE playlist_id = ?
                  ORDER BY added_at ASC'
            );
            $stmt->bind_param('i', $id);
            $stmt->execute();
            $tracks = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

            json_response(['success' => true, 'playlist' => $playlist, 'tracks' => $tracks]);
        }

        /* ---------------- add track ---------------- */
        case 'addTrack': {
            $playlistId = (int) ($_POST['playlist_id'] ?? 0);
            $deezerId   = (int) ($_POST['deezer_id'] ?? 0);
            $title      = trim($_POST['title'] ?? '');
            $artist     = trim($_POST['artist'] ?? '');
            $album      = trim($_POST['album'] ?? '');
            $cover      = trim($_POST['cover'] ?? '');
            $coverBig   = trim($_POST['cover_big'] ?? '');
            $preview    = trim($_POST['preview'] ?? '');
            $duration   = (int) ($_POST['duration'] ?? 0);
            $source     = trim($_POST['source'] ?? '');

            // Ensure the playlist belongs to the user
            $stmt = $db->prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?');
            $stmt->bind_param('ii', $playlistId, $userId);
            $stmt->execute();
            if (!$stmt->get_result()->fetch_assoc()) {
                json_response(['error' => 'Playlist not found.'], 404);
            }
            if ($deezerId <= 0 || $title === '') {
                json_response(['error' => 'Invalid track data.'], 400);
            }

            $stmt = $db->prepare(
                'INSERT INTO playlist_tracks
                   (playlist_id, deezer_id, title, artist, album, cover, cover_big, preview, duration, source)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE id = id'
            );
            $stmt->bind_param(
                'iissssssis',
                $playlistId, $deezerId, $title, $artist, $album,
                $cover, $coverBig, $preview, $duration, $source
            );
            $stmt->execute();

            // affected_rows: 1 = inserted, 2 = duplicate updated (already present)
            json_response(['success' => true, 'added' => $stmt->affected_rows === 1]);
        }

        /* ---------------- remove track ---------------- */
        case 'removeTrack': {
            $playlistId = (int) ($_POST['playlist_id'] ?? 0);
            $deezerId   = (int) ($_POST['deezer_id'] ?? 0);

            $stmt = $db->prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?');
            $stmt->bind_param('ii', $playlistId, $userId);
            $stmt->execute();
            if (!$stmt->get_result()->fetch_assoc()) {
                json_response(['error' => 'Playlist not found.'], 404);
            }

            $stmt = $db->prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND deezer_id = ?');
            $stmt->bind_param('ii', $playlistId, $deezerId);
            $stmt->execute();

            json_response(['success' => true]);
        }

        /* ---------------- delete ---------------- */
        case 'delete': {
            $id = (int) ($_POST['id'] ?? 0);
            $stmt = $db->prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?');
            $stmt->bind_param('ii', $id, $userId);
            $stmt->execute();

            json_response(['success' => true, 'deleted' => $stmt->affected_rows > 0]);
        }

        default:
            json_response(['error' => 'Unknown action.'], 400);
    }
} catch (mysqli_sql_exception $e) {
    error_log('Playlists error: ' . $e->getMessage());
    json_response(['error' => 'Database error.'], 500);
}
