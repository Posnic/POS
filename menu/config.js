/*
 * Which server this menu reads from.
 *
 * The shop's own, always. This page is served BY the shop's process - at
 * <shop>.posnic.io/menu, at a custom domain, or at localhost on a self-hosted
 * install - so the API is the same origin the page came from and there is
 * nothing to configure.
 *
 * DUPLICATED FROM order/config.js ON PURPOSE. It is forty lines, and the
 * alternative is coupling a read-only page to the ordering bundle's machinery -
 * 1,500 lines of IndexedDB, a cart and two payment integrations - to render a
 * list of dishes. The menu's whole value is being fast; borrowing that weight
 * to save forty lines would be the wrong trade. If a third page ever needs it,
 * that is the moment to lift it out, not before.
 */
const CONFIG = {};

/* A server set by hand, for a device on the shop's own network. Same key the
   ordering page and the table app use, so one device is configured once. */
function posnicStoredApiUrl() {
  try {
    const stored = localStorage.getItem("POSNIC_API_URL");
    return stored ? String(stored).trim().replace(/\/+$/, "") : "";
  } catch (e) {
    /* Private mode, or a browser set to refuse storage. The origin is the
           answer anyway. */
    return "";
  }
}

function posnicApiBase() {
  const stored = posnicStoredApiUrl();
  if (stored) return stored;
  return String((window.location || {}).origin || "").replace(/\/+$/, "");
}

CONFIG.API_BASE_URL = posnicApiBase();
