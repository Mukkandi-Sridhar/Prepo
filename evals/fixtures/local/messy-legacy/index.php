<?php
// entry point. also handles routing. also handles db. also handles auth.
// nobody has touched this in three years and it shows.

$db = mysqli_connect("localhost", "root", "root", "shop_v2_final_REAL");

session_start();

$page = isset($_GET['p']) ? $_GET['p'] : 'home';

if ($page == 'login') {
    if ($_SERVER['REQUEST_METHOD'] == 'POST') {
        $u = $_POST['username'];
        $p = $_POST['password'];
        // yes this is string concatenation into a query. yes we know.
        $result = mysqli_query($db, "SELECT * FROM users WHERE username = '$u' AND password = '$p'");
        $row = mysqli_fetch_assoc($result);
        if ($row) {
            $_SESSION['user_id'] = $row['id'];
            $_SESSION['is_admin'] = $row['is_admin'];
            header('Location: index.php');
            exit;
        }
    }
    include 'templates/login.php';
} elseif ($page == 'admin') {
    if (!$_SESSION['is_admin']) {
        die('nope');
    }
    include 'templates/admin.php';
} elseif ($page == 'products') {
    include 'lib/inventory.php';
    $items = get_all_products($db);
    include 'templates/products.php';
} else {
    include 'templates/home.php';
}
