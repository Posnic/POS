#!/usr/bin/env node
/*
 * Assemble builds/cdn-frontend/ for S3 + CloudFront.
 *
 * Only pure-asset routes go to the CDN; everything else (root pages,
 * /public/* which passes through branding middleware, and all API routes)
 * stays with the tenant app origin. The copy order below replicates the
 * express mount precedence in api/app.js, where the first mount wins:
 * later copies OVERWRITE earlier ones, so the highest-precedence source
 * is copied last.
 *
 *   /static  <- frontend/static, then frontend/public/static/static
 *   /fonts   <- frontend/static/fonts, then frontend/public/static/static/fonts
 *   /images  <- frontend/static/images
 *   /style   <- frontend/public/style
 *   /script  <- frontend/public/script
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FE = path.join(ROOT, 'frontend');
const OUT = path.join(ROOT, 'builds', 'cdn-frontend');

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

fs.rmSync(OUT, { recursive: true, force: true });
const plan = [
  [path.join(FE, 'static'), path.join(OUT, 'static')],
  [path.join(FE, 'public', 'static', 'static'), path.join(OUT, 'static')],
  [path.join(FE, 'static', 'fonts'), path.join(OUT, 'fonts')],
  [path.join(FE, 'public', 'static', 'static', 'fonts'), path.join(OUT, 'fonts')],
  [path.join(FE, 'static', 'images'), path.join(OUT, 'images')],
  [path.join(FE, 'public', 'style'), path.join(OUT, 'style')],
  [path.join(FE, 'public', 'script'), path.join(OUT, 'script')],
];
let total = 0;
for (const [src, dst] of plan) {
  const n = copyTree(src, dst);
  console.log(`${path.relative(ROOT, src)} -> ${path.relative(ROOT, dst)}: ${n} files`);
  total += n;
}
console.log(`cdn-frontend assembled: ${total} copies at ${path.relative(ROOT, OUT)}`);
