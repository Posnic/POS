'use strict';

const fs = require('node:fs');

const MESSAGE = 'This installation has extensions. Keep using this version until an extension-compatible Posnic release has been checked. Contact Posnic before installing an update.';

// Release feeds do not yet declare a verified extension capability contract.
// Never infer compatibility from a patch/minor version number. Queued and
// staged installations count too, including a damaged installation needing
// repair. This guard does not require an online licensing service.
function getExtensionUpdateHold(root) {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const installed = entries.some((entry) =>
      entry.name === '.activation-request.json' ||
      (/^[a-z][a-z0-9.-]{2,99}$/.test(entry.name) &&
        (entry.isDirectory() || entry.isSymbolicLink())));
    return installed ? MESSAGE : null;
  } catch (error) {
    return error.code === 'ENOENT' ? null : MESSAGE;
  }
}

module.exports = { getExtensionUpdateHold };
