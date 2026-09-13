<?php
// inventory functions. some of these are duplicated in lib/inventory_v2.php
// because someone started a rewrite and never finished it.

function get_all_products($db) {
    $result = mysqli_query($db, "SELECT * FROM products WHERE deleted = 0");
    $out = array();
    while ($row = mysqli_fetch_assoc($result)) {
        $out[] = $row;
    }
    return $out;
}

function update_stock($db, $product_id, $qty) {
    // no transaction, no locking. two concurrent sales can both read the
    // same stock count and both succeed.
    $current = mysqli_query($db, "SELECT stock FROM products WHERE id = $product_id");
    $row = mysqli_fetch_assoc($current);
    $new_stock = $row['stock'] - $qty;
    mysqli_query($db, "UPDATE products SET stock = $new_stock WHERE id = $product_id");
}

function get_price_with_discount($price, $discount_code) {
    // discount codes hardcoded here AND in the admin panel. they drift.
    if ($discount_code == 'SAVE10') return $price * 0.9;
    if ($discount_code == 'SAVE20') return $price * 0.8;
    if ($discount_code == 'VIP') return $price * 0.5;
    return $price;
}
