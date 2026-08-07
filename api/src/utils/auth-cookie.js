const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Cookies used by the browser frontend must be cross-site capable in live
 * environments (including pro.dev.posnic.io -> localhost:5000). Modern browsers
 * require SameSite=None cookies to also carry Secure. Localhost is treated as a
 * potentially trustworthy origin by supported browsers, so this also works for
 * the development API while preventing the JWT from being rejected as Lax.
 */
const authCookieOptions = (overrides = {}) => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/',
  ...overrides,
});

module.exports = { authCookieOptions, isProduction };
