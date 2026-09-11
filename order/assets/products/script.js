async function setKioskImagesFromIndexedDB() {
    try {
        const images = await getKioskImages();
        if (images) {
            updateKioskImageUI(images);
        }
    } catch (error) {
        console.warn("⚠ Could not load kiosk images:", error);
    }
}


document.addEventListener("DOMContentLoaded", async () => {
    await loadProducts(); // already there
    await openDB(); // ensures DB is ready
    await setKioskImagesFromIndexedDB(); // now safe to call
});

// ✅ Click anywhere on the product card to increase quantity (excluding buttons)
// $(document).on("click", ".product-card", async function (e) {
//     if ($(e.target).hasClass("btn-increase") || $(e.target).hasClass("btn-decrease")) {
//         return; // Don't trigger if user clicked the buttons
//     }

//     const $button = $(this);
//     const $productCard = $button.closest(".product-card");
//     const productId = $(this).data("id");

//     const $originalImg = $productCard.find("img").first();
//     const offset = $originalImg.offset();
//     const $img = $originalImg.clone().css({
//         position: "absolute",
//         width: $originalImg.width(),
//         height: $originalImg.height(),
//         zIndex: 1000,
//         top: offset.top,
//         left: offset.left,
//         pointerEvents: "none"
//     });

//     $("body").append($img);

//     const $cart = $(".floating-cart");
//     const cartOffset = $cart.offset();

//     $img.animate({
//         top: cartOffset.top + 10,
//         left: cartOffset.left + 10,
//         width: 30,
//         height: 30,
//         opacity: 0.1
//     }, 800, "swing", function () {
//         $img.remove();
//     });

//     await updateQuantity(productId, 1);
// });

$(document).on("click", ".btn-increase", async function (e) {
    const $button = $(this);
    const $productCard = $button.closest(".product-card");
    const productId = String($productCard.attr("data-id") ?? "");

    const $originalImg = $productCard.find("img").first(); // ✅ get the original image
    const offset = $originalImg.offset();
    const $img = $originalImg.clone().css({
        position: "absolute",
        width: $originalImg.width(),
        height: $originalImg.height(),
        zIndex: 1000,
        top: offset.top,
        left: offset.left,
        pointerEvents: "none"
    });

    $("body").append($img);

    // Get cart position
    const $cart = $(".floating-cart");
    const cartOffset = $cart.offset();

    // Animate to cart
    $img.animate({
        top: cartOffset.top + 10,
        left: cartOffset.left + 10,
        width: 30,
        height: 30,
        opacity: 0.1
    }, 800, "swing", function () {
        $img.remove(); // Cleanup after animation
    });

    await updateQuantity(productId, 1); // ✅ Update quantity logic
});


$(document).on("click", ".btn-decrease", async function (e) {
    const $button = $(this);
    const $productCard = $button.closest(".product-card");
    const productId = String($productCard.attr("data-id") ?? "");
    const $targetImg = $productCard.find("img").first();

    // Get destination coordinates (product image)
    const targetOffset = $targetImg.offset();

    // Create clone from cart icon
    const $cartIcon = $(".floating-cart").first();
    const cartOffset = $cartIcon.offset();
    const $clone = $("<img>")
        .attr("src", $targetImg.attr("src"))
        .css({
            position: "absolute",
            top: cartOffset.top,
            left: cartOffset.left,
            width: 40,
            height: 40,
            zIndex: 1000,
            pointerEvents: "none",
            borderRadius: "10px"
        });

    $("body").append($clone);

    // Animate from cart to product
    $clone.animate({
        top: targetOffset.top,
        left: targetOffset.left,
        width: $targetImg.width(),
        height: $targetImg.height(),
        opacity: 0.1
    }, 800, "swing", function () {
        $clone.remove();
    });

    // Update quantity after animation starts
    await updateQuantity(productId, -1);
});
