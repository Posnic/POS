/*
 * Which server this page talks to.
 *
 * The shop's own, always. This bundle is served BY the shop's process, at
 * https://<shop>.posnic.io/order and /menu, at any custom domain the shop has,
 * and by a till on the shop's own wifi. In every one of those the API is the
 * same origin the page came from, so there is nothing to configure and nothing
 * to guess.
 *
 * There used to be a hardcoded host here, and a named exception for the one
 * legacy address that served the bundle without an API beside it. Both are
 * gone: a single hardcoded backend is how one server came to answer for every
 * shop in the estate, and an exception list is a second thing to keep true.
 *
 * The one override left is a till pointed at a server by hand, which is a
 * person making a deliberate choice rather than the code guessing.
 */
const CONFIG = {};

/*
 * A server set by hand, for a till on the shop's own network.
 *
 * Same storage key the table-ordering app uses, so a device configured for one
 * is configured for both.
 */
function posnicStoredApiUrl() {
    try {
        const stored = localStorage.getItem('POSNIC_API_URL');
        return stored ? String(stored).trim().replace(/\/+$/, '') : '';
    } catch (e) {
        /* Private mode, or a browser set to refuse storage. Fall through to
           the page's own origin, which is the answer anyway. */
        return '';
    }
}

function posnicResolveApiBase() {
    const stored = posnicStoredApiUrl();
    if (stored) return stored;

    const loc = window.location || {};
    return String(loc.origin || '').replace(/\/+$/, '');
}

CONFIG.API_BASE_URL = posnicResolveApiBase();
CONFIG.IS_LOCAL = !!posnicStoredApiUrl();

async function loadEnvConfig() {
    /* Kept async and kept under this name: every page awaits it before its
       first request. Re-resolving costs nothing. */
    CONFIG.API_BASE_URL = posnicResolveApiBase();
    CONFIG.IS_LOCAL = !!posnicStoredApiUrl();
}

function saveLocalServer(url) {
    localStorage.setItem('POSNIC_API_URL', String(url).trim().replace(/\/+$/, ''));
    loadEnvConfig();
}

function clearLocalServer() {
    localStorage.removeItem('POSNIC_API_URL');
    loadEnvConfig();
}
