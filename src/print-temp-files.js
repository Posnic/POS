'use strict';
const fs = require('fs');
const path = require('path');
const RETAIN_MS = 5 * 60 * 1000;
const ownPdf = /^posnic-(?:kot|print|document)-[a-zA-Z0-9-]+\.pdf$/;

// No recursion, links, directories, arbitrary extensions or foreign prefixes.
function cleanup(directory, now = Date.now()) {
  let names;
  try { names = fs.readdirSync(directory); } catch (_) { return; }
  for (const name of names) {
    if (!ownPdf.test(name)) continue;
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isSymbolicLink() && stat.isFile() && now - stat.mtimeMs >= RETAIN_MS) fs.unlinkSync(file);
    } catch (_) { /* In-use files remain for a later cleanup. */ }
  }
}
function retain(file) {
  // A full retention period after submission, even if rendering was slow.
  try { fs.utimesSync(file, new Date(), new Date()); } catch (_) { return; }
  const timer = setTimeout(() => cleanup(path.dirname(file)), RETAIN_MS + 1000);
  timer.unref();
}
module.exports = { cleanup, retain, RETAIN_MS };
