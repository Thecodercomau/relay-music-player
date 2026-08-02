<?php
require_once __DIR__ . '/config.php';

if (isset($_SESSION['user_id'])) {
    json_response([
        'logged_in' => true,
        'user' => [
            'id'       => (int) $_SESSION['user_id'],
            'name'     => $_SESSION['user_name'],
            'email'    => $_SESSION['user_email'],
            'is_admin' => (int) ($_SESSION['is_admin'] ?? 0),
        ],
    ]);
}

json_response(['logged_in' => false], 401);
