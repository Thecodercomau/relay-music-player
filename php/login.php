<?php
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Method not allowed'], 405);
}

$email    = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';

if ($email === '' || $password === '') {
    json_response(['error' => 'Email and password are required.'], 400);
}

try {
    $db = get_db();

    $stmt = $db->prepare('SELECT id, name, email, password_hash, is_admin FROM users WHERE email = ?');
    $stmt->bind_param('s', $email);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();

    // Same message for unknown email / wrong password (don't leak which one)
    if (!$user || !password_verify($password, $user['password_hash'])) {
        json_response(['error' => 'Invalid email or password.'], 401);
    }

    // Regenerate id to prevent session fixation
    session_regenerate_id(true);
    $_SESSION['user_id']    = (int) $user['id'];
    $_SESSION['user_name']  = $user['name'];
    $_SESSION['user_email'] = $user['email'];
    $_SESSION['is_admin']   = (int) ($user['is_admin'] ?? 0);

    json_response([
        'success' => true,
        'user'    => [
            'id'       => (int) $user['id'],
            'name'     => $user['name'],
            'email'    => $user['email'],
            'is_admin' => (int) ($user['is_admin'] ?? 0),
        ],
    ]);
} catch (mysqli_sql_exception $e) {
    error_log('Login error: ' . $e->getMessage());
    json_response(['error' => 'Database error — is MySQL running and the database imported?'], 500);
}
