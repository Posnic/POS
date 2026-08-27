const http = require('http');

const AUTH_COOKIE_NAMES = new Set(['jwt', 'connect.sid']);
const STALE_COOKIE_NAMES = ['jwt', 'connect.sid', 'loginuser'];

function hasUnexpiredAuthCookie(cookies, now = Date.now()) {
  return (cookies || []).some(cookie =>
    AUTH_COOKIE_NAMES.has(cookie.name) &&
    (!cookie.expirationDate || cookie.expirationDate * 1000 > now)
  );
}

function validateSavedLogin(origin, cookies, options = {}) {
  const httpModule = options.httpModule || http;
  const timeoutMs = options.timeoutMs || 5000;
  const authCookies = (cookies || []).filter(cookie => AUTH_COOKIE_NAMES.has(cookie.name));
  if (!authCookies.length) return Promise.resolve(false);

  const cookieHeader = authCookies
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const request = httpModule.get(`${origin}/users/verify-token`, {
      headers: { Accept: 'application/json', Cookie: cookieHeader },
      timeout: timeoutMs
    }, response => {
      response.resume();
      finish(response.statusCode >= 200 && response.statusCode < 300);
    });

    request.on('timeout', () => {
      request.destroy();
      finish(false);
    });
    request.on('error', () => finish(false));
  });
}

async function clearStaleLogin(cookieStore, origin, logger = console) {
  for (const cookieName of STALE_COOKIE_NAMES) {
    try {
      await cookieStore.remove(origin, cookieName);
    } catch (error) {
      logger.warn(`[Auth] Could not remove ${cookieName} cookie:`, error.message);
    }
  }
}

module.exports = {
  hasUnexpiredAuthCookie,
  validateSavedLogin,
  clearStaleLogin
};
