'use strict';

const bcrypt = require('bcryptjs');

// Current till passwords use bcrypt(base64(UTF-8(password))). Older installers
// used bcrypt(password); both must remain usable after recovery or an update.
async function passwordMatches(password, hash) {
  if (
    typeof password !== 'string' ||
    !password ||
    password.length > 256 ||
    typeof hash !== 'string'
  )
    return false;
  return (
    (await bcrypt.compare(Buffer.from(password).toString('base64'), hash)) ||
    (await bcrypt.compare(password, hash))
  );
}

module.exports = { passwordMatches };
