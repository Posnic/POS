'use strict';

// Missing versions are the pre-recovery generation. Incrementing the account
// version revokes both JWTs and sessions, including tokens issued in the same
// second as a reset. Password timestamps alone cannot do that.
const version = (value) => Number(value && value.authVersion) || 0;
const current = (user, credential) => version(user) === version(credential);
function stampSession(req, user) {
  if (req && req.session) req.session.authVersion = version(user);
}
module.exports = { version, current, stampSession };
