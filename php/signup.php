<?php
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Method not allowed'], 405);
}

$name     = trim($_POST['name'] ?? '');
$email    = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';

// ---- Validation ----
if ($name === '' || $email === '' || $password === '') {
    json_response(['error' => 'All fields are required.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['error' => 'Please enter a valid email address.'], 400);
}
if (strlen($password) < 6) {
    json_response(['error' => 'Password must be at least 6 characters.'], 400);
}

try {
    $db = get_db();

    // Check for duplicate email
    $stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->bind_param('s', $email);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0) {
        json_response(['error' => 'An account with this email already exists.'], 409);
    }

    // Create user with a securely hashed password
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $db->prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
    $stmt->bind_param('sss', $name, $email, $hash);
    $stmt->execute();
    $userId = (int) $db->insert_id;

    // Log the new user in immediately
    $_SESSION['user_id']    = $userId;
    $_SESSION['user_name']  = $name;
    $_SESSION['user_email'] = $email;
    $_SESSION['is_admin']   = 0; // new accounts are never admins

    json_response([
        'success' => true,
        'user'    => ['id' => $userId, 'name' => $name, 'email' => $email, 'is_admin' => 0],
    ]);
} catch (mysqli_sql_exception $e) {
    error_log('Signup error: ' . $e->getMessage());
    json_response(['error' => 'Database error — is MySQL running and the database imported?'], 500);
}
