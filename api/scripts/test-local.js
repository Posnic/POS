#!/usr/bin/env node
"use strict";
/*
 * Run the whole suite locally, against a real database.
 *
 *   npm run test:local
 *
 * Starts the MongoDB that ships with the desktop app, on a port of its own and
 * a data directory of its own, runs every test including the ones that need a
 * real database, and stops it again. No cluster, no credentials, no network -
 * so there is no reason not to run it before pushing.
 *
 * The point is that the local run and the CI run exercise the same things. A
 * suite that only runs fully on a machine somebody else owns is a suite people
 * stop trusting, and then stop reading.
 *
 * Leaves the database directory behind between runs so a second run starts
 * quickly; it holds nothing but test data and is in .gitignore.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MONGOD = path.join(ROOT, "mongodb", "bin",
  process.platform === "win32" ? "mongod.exe" : "mongod");
const DBPATH = path.join(ROOT, ".devdb");
const PORT = Number(process.env.LOCAL_DB_PORT || 47600);
const URI = `mongodb://127.0.0.1:${PORT}`;

function log(msg) { console.log(`[test:local] ${msg}`); }

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
}

async function waitForPort(port, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  let mongod = null;

  if (await portOpen(PORT)) {
    log(`a database is already listening on ${PORT}; using it`);
  } else {
    if (!fs.existsSync(MONGOD)) {
      console.error(`[test:local] no mongod at ${MONGOD}`);
      console.error("[test:local] point LOCAL_MONGODB_URI at any MongoDB and run jest directly.");
      process.exit(2);
    }
    fs.mkdirSync(DBPATH, { recursive: true });
    log(`starting mongod on ${PORT}`);
    mongod = spawn(MONGOD, [
      "--dbpath", DBPATH,
      "--port", String(PORT),
      "--bind_ip", "127.0.0.1",
      "--quiet",
    ], { stdio: "ignore", detached: false });

    if (!await waitForPort(PORT, 30)) {
      console.error("[test:local] mongod did not come up within 30s");
      if (mongod) mongod.kill();
      process.exit(2);
    }
    log("mongod is up");
  }

  /*
   * Secrets the app refuses to boot without. Obviously fake, and obviously
   * only for a test run - the application is right to demand them and wrong to
   * ever invent them for itself.
   */
  const env = {
    ...process.env,
    LOCAL_MONGODB_URI: URI,
    JWT_SECRET: process.env.JWT_SECRET || "local-test-jwt-secret-0123456789abcdef",
    SESSION_SECRET: process.env.SESSION_SECRET || "local-test-session-secret-0123456789",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef",
    ENCRYPTION_IV: process.env.ENCRYPTION_IV || "0123456789abcdef",
    TZ: process.env.TZ || "Asia/Kolkata",
  };

  const args = process.argv.slice(2);
  const jestArgs = args.length ? args : ["--forceExit", "--runInBand"];

  log(`running jest ${jestArgs.join(" ")}`);
  const result = spawnSync("npx", ["jest", ...jestArgs], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (mongod) {
    log("stopping mongod");
    mongod.kill();
  }

  process.exit(result.status === null ? 1 : result.status);
})().catch((err) => {
  console.error("[test:local] " + err.message);
  process.exit(2);
});
