/**
 * The shop stays in the address bar.
 *
 * A customer arrives at /order/AZ100 and walks to products.html, cart.html,
 * payment.html. Every one of those pages resolves against <base href="/order/">,
 * so the address bar read /order/products.html - a page with no shop in it.
 * Refresh it on the same phone and IndexedDB remembers; copy it to a friend,
 * or open it after the browser cleared its storage, and it is nobody's menu.
 *
 * So each page puts the shop back once it knows it:
 *
 *   /order/products.html            ->  /order/AZ100/products.html
 *   /order/thankyou.html?token=42   ->  /order/AZ100/thankyou.html?token=42
 *
 * The server answers those (app.js, STORE_PAGE) with the page itself, and
 * service-point.js knows a page name at the end means a walk, not an arrival,
 * so the table a customer scanned is not thrown away on the way to checkout.
 *
 * TWO READINGS OF THE SAME URL:
 *
 *   keep(shop)   this page is showing `shop`; say so in the address bar.
 *                Called with what localStorage remembers as soon as this file
 *                runs, and again by rememberShop() with the branch row, which
 *                is the truth.
 *   follow(held) the address bar names a shop this browser does not hold.
 *                That is somebody opening a copied link, and the link wins:
 *                go to that shop's arrival page, which switches shops the
 *                proper way (clears the old one, fetches the new one).
 *
 * Nothing here is trusted by the server. The address is a hint for the
 * page; every read still goes to /online-ordering/<address> and the server
 * says whether such a shop exists.
 */
(function () {
    'use strict';

    var STORE = /^[A-Za-z0-9]{3,6}$/;
    var PAGE = /^[a-z_-]+\.html$/i;
    var STORE_KEY = 'posnic_store';

    function segments() {
        return String(window.location.pathname || '').split('/').filter(Boolean);
    }

    /* "/order" or "/menu" - whichever this bundle is mounted at. */
    function mount() {
        var first = segments()[0];
        return first === 'order' || first === 'menu' ? '/' + first : '/order';
    }

    /* The shop the path names, or ''. The first segment after the mount, and
       only when it is shaped like a store address (three to six letters and
       digits, no dot - a page name never is). */
    function fromPath() {
        var parts = segments();
        if (parts[0] === 'order' || parts[0] === 'menu') parts.shift();
        var first = parts[0] || '';
        return STORE.test(first) ? first : '';
    }

    /* The page this is, or '' on the arrival page (index.html or a bare
       shop address), which manages its own URL. */
    function page() {
        var parts = segments();
        var last = parts[parts.length - 1] || '';
        if (!PAGE.test(last) || last.toLowerCase() === 'index.html') return '';
        return last;
    }

    function remembered() {
        try {
            return String(localStorage.getItem(STORE_KEY) || '').trim();
        } catch (e) {
            return '';
        }
    }

    function arrivalUrl(shop) {
        return mount() + '/' + encodeURIComponent(shop);
    }

    /**
     * Put `shop` into the address bar, keeping the page, the query and the
     * fragment. A no-op on the arrival page, for a shop that is not one, and
     * when the bar already says so.
     */
    function keep(shop) {
        shop = String(shop || '').trim();
        var here = page();
        if (!here || !STORE.test(shop)) return false;
        if (fromPath() === shop) return true;
        var next =
            arrivalUrl(shop) + '/' + here + String(window.location.search || '') + String(window.location.hash || '');
        try {
            window.history.replaceState(window.history.state, '', next);
            return true;
        } catch (e) {
            /* A browser that will not rewrite its bar still shows the menu. */
            return false;
        }
    }

    /**
     * A link that names a shop other than the one this browser holds is an
     * arrival at that shop. `held` is what the caller knows this browser to
     * be showing - the branch row when there is one, else what localStorage
     * remembers. True when the page is being left.
     */
    function follow(held) {
        if (!page()) return false;
        var named = fromPath();
        held = String(held || remembered() || '').trim();
        if (!named || !held || named === held) return false;
        window.location.replace(arrivalUrl(named));
        return true;
    }

    window.ShopAddress = {
        fromPath: fromPath,
        page: page,
        remembered: remembered,
        keep: keep,
        follow: follow,
    };

    /* At once, from what this browser remembers, so the bar is right before
       the first paint; the branch row corrects it a moment later if need be. */
    if (!follow()) keep(remembered());
})();
