const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const PUBLIC = path.join(FRONTEND, 'public');
const ROOT_FILES = ['robots.txt', 'sitemap.xml', 'llms.txt', '_headers'];

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

test('frontend source carries machine-readable discovery files for the app domain', () => {
  for (const file of ROOT_FILES) {
    assert.ok(fs.existsSync(path.join(FRONTEND, file)), `${file} is missing from frontend/`);
  }

  const robots = read(FRONTEND, 'robots.txt');
  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/www\.posnic\.io\/sitemap\.xml$/m);

  const sitemap = read(FRONTEND, 'sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /<loc>https:\/\/www\.posnic\.io\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.posnic\.io\/login\.html<\/loc>/);
  assert.doesNotMatch(sitemap, /<loc>https:\/\/posnic\.com\//);

  const llms = read(FRONTEND, 'llms.txt');
  assert.match(llms, /^# Posnic POS$/m);
  assert.match(llms, /^Canonical app domain: https:\/\/posnic\.io\/$/m);
  assert.match(llms, /^Preferred backlink target: https:\/\/posnic\.io\/$/m);
  assert.match(llms, /^Official GitHub source: https:\/\/github\.com\/Posnic\/POS$/m);
  assert.match(llms, /POS; Billing Software; Offline POS; Online\/Offline POS; open source POS/);

  const headers = read(FRONTEND, '_headers');
  assert.match(headers, /\/robots\.txt[\s\S]*Content-Type: text\/plain; charset=utf-8/);
  assert.match(headers, /\/llms\.txt[\s\S]*Content-Type: text\/plain; charset=utf-8/);
  assert.match(headers, /\/sitemap\.xml[\s\S]*Content-Type: application\/xml; charset=utf-8/);
  assert.match(
    headers,
    /\/static\/manifest\.webmanifest[\s\S]*Content-Type: application\/manifest\+json; charset=utf-8/,
  );
});

test('gulp publishes discovery files into frontend/public', () => {
  const gulpIndex = read(FRONTEND, 'gulpfile.js', 'index.js');
  assert.match(gulpIndex, /function copyRootPublicFiles\(\)/);
  for (const file of ROOT_FILES) {
    assert.match(gulpIndex, new RegExp(`['"]${file.replace('.', '\\.')}['"]`));
  }
  assert.match(gulpIndex, /exports\.rootPublicFiles = copyRootPublicFiles/);
  assert.match(gulpIndex, /parallel\(copyRootPublicFiles,/);

  if (!fs.existsSync(PUBLIC)) return;
  for (const file of ROOT_FILES) {
    const built = path.join(PUBLIC, file);
    assert.ok(fs.existsSync(built), `${file} is missing from frontend/public after build`);
    assert.equal(read(FRONTEND, file), read(PUBLIC, file), `${file} changed during copy`);
  }
});

test('tenant frontend deploy checks discovery files before rsync', () => {
  const deployWorkflow = read(ROOT, '.github', 'workflows', 'deploy-frontend.yml');
  const developWorkflow = read(ROOT, '.github', 'workflows', 'deploy-develop.yml');
  for (const file of ['frontend/public/robots.txt', 'frontend/public/sitemap.xml', 'frontend/public/llms.txt']) {
    assert.match(deployWorkflow, new RegExp(file.replace(/[./]/g, '\\$&')));
    assert.match(developWorkflow, new RegExp(file.replace(/[./]/g, '\\$&')));
  }
});
