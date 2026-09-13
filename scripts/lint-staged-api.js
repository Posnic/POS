"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repositoryRoot = process.cwd();
const apiRoot = path.join(repositoryRoot, "api");
const files = process.argv.slice(2).map((file) => {
  const relative = path.relative(apiRoot, path.resolve(repositoryRoot, file));
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Expected a staged API file, received: ${file}`);
  }
  return relative;
});

if (files.length === 0) process.exit(0);

const eslint = path.join(
  apiRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "eslint.cmd" : "eslint",
);
const result = spawnSync(eslint, ["--fix", ...files], {
  cwd: apiRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
if (result.status) process.exit(result.status);

/*
 * PRETTIER LAST, because eslint --fix can undo it.
 *
 * lint-staged runs `prettier --write` first and this second, and removing a
 * redundant eslint-disable comment leaves behind the blank line it was on.
 * The commit then contains a file prettier would reformat, `format:check`
 * fails in CI, and Full CI failing means beta.yml builds no installer at all -
 * so a stray blank line quietly costs a release. Running the formatter after
 * the fixer closes that.
 */
const prettier = path.join(
  apiRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prettier.cmd" : "prettier",
);
const formatted = spawnSync(prettier, ["--write", ...files], {
  cwd: apiRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (formatted.error) throw formatted.error;
process.exit(formatted.status || 0);
