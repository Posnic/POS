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
process.exit(result.status || 0);
