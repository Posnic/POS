"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Resolve before the single-instance lock, credentials, logs or database open.
// Maintenance tools already honor this setting; the desktop must use the same
// folder. Reject relative paths rather than opening a different shop by cwd.
function configure(app, env = process.env) {
  if (!env.POSNIC_USER_DATA) return false;
  if (!path.isAbsolute(env.POSNIC_USER_DATA)) {
    throw new Error("POSNIC_USER_DATA must be an absolute directory path");
  }
  const directory = path.resolve(env.POSNIC_USER_DATA);
  fs.mkdirSync(directory, { recursive: true });
  const session = path.join(directory, "session");
  fs.mkdirSync(session, { recursive: true });
  app.setPath("userData", directory);
  app.setPath("sessionData", session);
  return true;
}

module.exports = { configure };
