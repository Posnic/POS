'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Merge legacy images without replacing newer retained files. Never follow links.
function migrateUploads(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (path.resolve(source) === path.resolve(destination) || !fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) migrateUploads(from, to);
    else if (entry.isFile()) {
      try { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
      catch (err) { if (err.code !== 'EEXIST') throw err; }
    }
  }
}
module.exports = { migrateUploads };
