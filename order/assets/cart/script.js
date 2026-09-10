// ✅ Ensure cart is loaded only once on page load
$(document).ready(async function () {
    const branches = await getData(BRANCH_STORE);
    const branchId = branches[0]?.id;
    await fetchAndStoreBranch(branchId, false);
    let cartData = await getCartData();
    renderCart(cartData);
});