'use strict';
// Upstream fix: https://github.com/wwebjs/whatsapp-web.js/pull/201923
// Remove when a published dependency contains the media ID fix.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let packageRoot = path.join(root, 'node_modules', 'whatsapp-web.js');
if (process.argv.includes('--isolated')) {
  const destination = path.join(root, 'src', 'node_modules', 'whatsapp-web.js');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) {
    fs.cpSync(fs.realpathSync(packageRoot), destination, { recursive: true, verbatimSymlinks: true });
  }
  if (!fs.realpathSync(destination).startsWith(root + path.sep)) {
    throw new Error('Isolated dependency resolves outside this checkout.');
  }
  packageRoot = destination;
} else if (!fs.realpathSync(packageRoot).startsWith(root + path.sep)) {
  throw new Error('Shared dependency directory: use --isolated instead.');
}
const filename = path.join(packageRoot, 'src', 'util', 'Injected', 'Utils.js');
let source = fs.readFileSync(filename, 'utf8');
if (!source.includes('delete message.__x_id;')) {
  const anchor = "        // Bot's won't reply if canonicalUrl is set (linking)";
  if (!source.includes(anchor)) throw new Error('WhatsApp source changed; review the media fix before installing.');
  source = source.replace(anchor, '        delete message.__x_id;\n\n' + anchor);
  fs.writeFileSync(filename, source);
}
const marker = '// Posnic: restore message-key serialization compatibility';
if (!source.includes(marker)) {
  const anchor = '    window.WWebJS = {};';
  if (!source.includes(anchor)) throw new Error('WhatsApp source changed; review message-key compatibility.');
  const restore = require('./whatsapp-msgkey-compat.cjs');
  source = source.replace(anchor, `${anchor}\n    ${marker}\n    (${restore.toString()})(window);\n`);
  fs.writeFileSync(filename, source);
}
console.log('WhatsApp media and message-key compatibility fixes verified.');
