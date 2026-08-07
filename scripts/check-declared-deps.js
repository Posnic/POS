/*
 * Every package a source file requires must be declared by the package that
 * owns that file.
 *
 * The API had six that were not. `winston` and `winston-daily-rotate-file` in
 * utils/logger.js, `node-cron` in the crons controller, `express-mongo-sanitize`
 * and `xss-clean` in middleware/security.js, and `aws-sdk` - AWS SDK v2, which
 * reached end of life - in three S3 code paths, while package.json declares the
 * v3 client. None of those files can be required at all; they throw
 * "Cannot find module" on the first line. They survive because nothing mounts
 * them and their tests mock the imports away.
 *
 * `mongodb` was the opposite and more dangerous: 56 files required it and
 * nothing declared it. It resolved anyway because mongoose hoists it, which
 * means a mongoose upgrade could have swapped the driver underneath the API
 * without a single line of this repo changing.
 *
 * This is a static check on purpose. Actually requiring these modules would
 * work - and would also open database connections, because some constructors
 * do that on import. Reading the require calls costs nothing and has no side
 * effects.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* Modules that are known not to load, with the reason. They are unreachable -
   nothing mounts or requires them - so they break nothing today, but they are
   debt, not an exemption to copy. Nothing may be added here without deciding
   whether the file should be fixed or deleted.

   Recorded 4 August 2026. */
const KNOWN_DEAD = new Map([
  [
    "api/src/utils/logger.js",
    "requires winston, never installed; the API logs through console",
  ],
  [
    "scripts/build-update.js",
    "requires archiver, never installed; nothing runs this script - it is not " +
      "in package.json scripts or any workflow",
  ],
  [
    "scripts/build-frontend-update.js",
    "same as build-update.js: requires archiver, and nothing runs it",
  ],
  [
    "api/src/middleware/security.js",
    "requires express-mongo-sanitize and xss-clean; never mounted, and app.js " +
      "already sanitises with its own middleware and the xss package",
  ],
  [
    "api/src/controllers/crons.controller.js",
    "requires node-cron; crons.routes.js is not mounted in routes/index.js",
  ],
]);

/* Packages a file may require without declaring, with the reason. Keep this
   short; the default answer is to declare the dependency. */
const ALLOWED_UNDECLARED = new Map([
  [
    "electron",
    "install.service.js reads Electron's userData path when it is running " +
      "inside the desktop app, inside a try/catch, and works without it. " +
      "Declaring Electron in the API would pull a 250 MB binary into a package " +
      "that is meant to run standalone too.",
  ],
]);

/* Packages Node provides. `node:`-prefixed ones are handled separately. */
const BUILTIN = new Set(require("module").builtinModules);

function sourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/* The package name, not the subpath: `@aws-sdk/client-s3` keeps both segments,
   `lodash/get` keeps only `lodash`. */
function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/* A comment that quotes a require - which the file explaining this check does,
   naming the package it removed - is not a dependency. Strings are left alone:
   a require inside one is unusual enough to be worth flagging. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function bareRequires(source) {
  const text = withoutComments(source);
  const found = new Set();
  const re = /require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("/")) continue;
    if (spec.startsWith("node:")) continue;
    const name = packageName(spec);
    if (BUILTIN.has(name)) continue;
    found.add(name);
  }
  return found;
}

function declaredBy(pkgDir) {
  const file = path.join(pkgDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ]);
}

/* Each entry is a package root and the directories whose requires it owns. */
const SCOPES = [
  { name: "api", pkgDir: path.join(ROOT, "api"), dirs: [path.join(ROOT, "api", "src")] },
  { name: "root", pkgDir: ROOT, dirs: [path.join(ROOT, "scripts")] },
];

const problems = [];
const deadSeen = new Set();

for (const scope of SCOPES) {
  const declared = declaredBy(scope.pkgDir);
  for (const dir of scope.dirs) {
    for (const file of sourceFiles(dir)) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const undeclared = [...bareRequires(fs.readFileSync(file, "utf8"))].filter(
        (name) => !declared.has(name) && !ALLOWED_UNDECLARED.has(name),
      );
      if (undeclared.length === 0) continue;

      if (KNOWN_DEAD.has(rel)) {
        deadSeen.add(rel);
        continue;
      }
      problems.push(
        `${rel} requires ${undeclared.join(", ")}, ` +
          `not declared in ${scope.name}/package.json`,
      );
    }
  }
}

/* A quarantine entry that has been fixed should be deleted, not left to rot. */
const stale = [...KNOWN_DEAD.keys()].filter((rel) => !deadSeen.has(rel));

if (problems.length > 0 || stale.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  for (const s of stale) {
    console.error(
      `  ✗ ${s} is listed as known-dead but now resolves. Remove it from ` +
        `KNOWN_DEAD in ${path.relative(ROOT, __filename)}.`,
    );
  }
  console.error(
    "\n  A package a source file requires must be declared by the package that " +
      "owns\n  the file. Relying on another package hoisting it means an upgrade " +
      "elsewhere\n  can change what you get.\n",
  );
  process.exit(1);
}

console.log(
  `[deps] every required package is declared` +
    (deadSeen.size ? `; ${deadSeen.size} known-dead modules skipped` : ""),
);
