// Empties builds/brand-seed before a build.
//
// That directory is packaged into the installer as `resources/brand-seed`, and
// whatever is sitting in it on disk when electron-builder runs is what a shop
// sees on first launch. It is build output, not source - nothing regenerates it
// and nothing cleaned it, so a brand seed left behind by an earlier run stayed
// there.
//
// Which is exactly what happened: a stock installer went out wearing a
// customer's name and logo, because the previous build had been a branded one
// and this directory still held its files. Brand building has since moved to a
// separate private repository, so the only way to populate this now is by hand
// - but the failure was silent and shipped, so the guard stays.
//
// .gitkeep survives; it is what keeps the empty directory in git, and
// extraResources skips a `from` path that does not exist without saying so.

const fs = require("fs");
const path = require("path");

const seedDir = path.join(__dirname, "..", "builds", "brand-seed");

if (!fs.existsSync(seedDir)) {
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(path.join(seedDir, ".gitkeep"), "");
  console.log("[brand-seed] created empty builds/brand-seed");
  process.exit(0);
}

let removed = 0;
for (const entry of fs.readdirSync(seedDir)) {
  if (entry === ".gitkeep") continue;
  fs.rmSync(path.join(seedDir, entry), { recursive: true, force: true });
  removed += 1;
}

if (removed > 0) {
  console.log(
    `[brand-seed] cleared ${removed} leftover item${removed === 1 ? "" : "s"} - this build is stock Posnic`,
  );
} else {
  console.log("[brand-seed] empty, as a stock build needs it to be");
}
