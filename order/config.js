/*
 * Which server this page talks to.
 *
 * This bundle is served by the shop's own process, at
 * https://<shop>.posnic.io/order (and /menu, and any custom domain the shop
 * has). The API is the same origin, so the answer is almost always "wherever
 * this page came from".
 *
 * WHY SAME-ORIGIN IS THE DEFAULT RATHER THAN A HOST LIST.
 *
 * A shop can be reached at <shop>.posnic.io, at its own domain
 * (pos.theirshop.com), or at a till's address on the shop's wifi. Deriving the
 * API from the page's own origin covers all three and needs no configuration
 * when a new one appears. A hardcoded host covers exactly one, which is how
 * this file previously came to point every shop in the estate at a single
 * legacy backend.
 *
 * THE LEGACY HOST.
 *
 * qr.posnic.io serves this same bundle for QR codes that are already printed
 * and stuck on tables. That host has no API of its own, so it keeps pointing
 * at the shared backend until those codes are retired. It is the exception,
 * named explicitly, rather than the rule.
 */
const CONFIG = {};

/* The shared backend the already-printed codes still reach. */
const POSNIC_LEGACY_API = 'https://api.posnic.io';

/* Hosts that serve this bundle without serving an API next to it. */
const POSNIC_LEGACY_KIOSK_HOSTS = ['qr.posnic.io'];

/*
 * A till on the shop's own network, set by hand.
 *
 * Same storage key the table-ordering app uses, so a device configured for one
 * is configured for both.
 */
function posnicStoredApiUrl() {
    try {
        const stored = localStorage.getItem('POSNIC_API_URL');
        return stored ? String(stored).trim().replace(/\/+$/, '') : '';
    } catch (e) {
        /* Storage blocked (private mode, or a browser set to refuse it).
           Fall through to the page's own origin. */
        return '';
    }
}

function posnicResolveApiBase() {
    const stored = posnicStoredApiUrl();
    if (stored) return stored;

    const loc = window.location || {};
    const protocol = String(loc.protocol || '');
    const hostname = String(loc.hostname || '').toLowerCase();

    /* Opened from disk during development: there is no origin to speak of. */
    if (protocol === 'file:' || !hostname) return POSNIC_LEGACY_API;

    if (POSNIC_LEGACY_KIOSK_HOSTS.indexOf(hostname) !== -1) return POSNIC_LEGACY_API;

    return String(loc.origin || '').replace(/\/+$/, '') || POSNIC_LEGACY_API;
}

CONFIG.API_BASE_URL = posnicResolveApiBase();
CONFIG.IS_LOCAL = !!posnicStoredApiUrl();

async function loadEnvConfig() {
    /* Kept async and kept exported under this name: every page awaits it
       before its first request. Re-resolving costs nothing. */
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
