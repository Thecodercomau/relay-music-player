<?php
/**
 * Relay Music Player — admin user management API.
 *
 * Lets admins decide who is (and isn't) an admin. Admin accounts only.
 *
 * Actions:
 *   list     GET  — every user (id, name, email, is_admin, created_at)
 *   setAdmin POST — set is_admin for a user. Params: user_id, is_admin (0|1)
 *
 * Safety guards:
 *   - You can't demote yourself (you'd lock yourself out).
 *   - You can't demote the last remaining admin (same reason, app-wide).
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

        /* ---------------- list ---------------- */
        case 'list': {
            $rows = $db->query(
                'SELECT id, name, email, is_admin, created_at
                   FROM users
                  ORDER BY is_admin DESC, id ASC'
            )->fetch_all(MYSQLI_ASSOC);
            foreach ($rows as &$r) {
                $r['id']       = (int) $r['id'];
                $r['is_admin'] = (int) $r['is_admin'];
            }
            unset($r);
            json_response(['success' => true, 'users' => $rows]);
        }

        /* ---------------- setAdmin ---------------- */
        case 'setAdmin': {
            $userId  = (int) ($_POST['user_id'] ?? 0);
            $adminOn = isset($_POST['is_admin']) ? (int) $_POST['is_admin'] : -1;
            if ($userId <= 0 || ($adminOn !== 0 && $adminOn !== 1)) {
                json_response(['error' => 'Invalid user id or admin flag.'], 400);
            }

            $stmt = $db->prepare('SELECT id, name, is_admin FROM users WHERE id = ?');
            $stmt->bind_param('i', $userId);
            $stmt->execute();
            $target = $stmt->get_result()->fetch_assoc();
            if (!$target) {
                json_response(['error' => 'User not found.'], 404);
            }

            $targetIsAdmin = (int) $target['is_admin'];

            // Refuse to demote yourself or the last admin.
            if ($adminOn === 0 && $targetIsAdmin === 1) {
                if ($userId === (int) $_SESSION['user_id']) {
                    json_response(['error' => "You can't remove your own admin access."], 400);
                }
                $adm = $db->query("SELECT COUNT(*) FROM users WHERE is_admin = 1")->fetch_row();
                if ((int) $adm[0] <= 1) {
                    json_response(['error' => 'At least one admin must remain.'], 400);
                }
            }

            $stmt = $db->prepare('UPDATE users SET is_admin = ? WHERE id = ?');
            $stmt->bind_param('ii', $adminOn, $userId);
            $stmt->execute();

            json_response([
                'success'  => true,
                'user'     => [
                    'id'       => $userId,
                    'name'     => $target['name'],
                    'is_admin' => $adminOn,
                ],
            ]);
        }

        default:
            json_response(['error' => 'Unknown action. Use action=list or action=setAdmin.'], 400);
    }
} catch (mysqli_sql_exception $e) {
    error_log('Users API error: ' . $e->getMessage());
    json_response(['error' => 'Database error.'], 500);
}
