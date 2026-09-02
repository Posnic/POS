const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const PUBLIC = path.join(FRONTEND, 'public');
const ROOT_FILES = ['robots.txt', 'sitemap.xml', 'llms.txt', '_headers'];
const POSNIC_SEO_TITLE = 'Posnic POS - Offline POS & Billing Software';
const POSNIC_SEO_DESCRIPTION =
  'Posnic POS is offline-first open source POS and billing software for retail stores, restaurants, and small businesses.';
const POSNIC_SEO_KEYWORDS = ['POS', 'Billing Software', 'Offline POS', 'Online/Offline POS', 'open source POS'];

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

function extractJsonLd(html, scriptId) {
  const match = html.match(
    new RegExp(`<script\\s+type="application/ld\\+json"\\s+id="${scriptId}">([\\s\\S]*?)<\\/script>`),
  );
  assert.ok(match, `${scriptId} JSON-LD script is missing`);
  return JSON.parse(match[1]);
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

test('public app entry pages expose canonical POS metadata', () => {
  const index = read(FRONTEND, 'index.html');
  const login = read(FRONTEND, 'login.html');
  const keywordContent = POSNIC_SEO_KEYWORDS.join(', ');

  for (const html of [index, login]) {
    assert.match(html, new RegExp(`<title>${POSNIC_SEO_TITLE}</title>`));
    assert.match(html, new RegExp(`<meta name="description" content="${POSNIC_SEO_DESCRIPTION}">`));
    assert.match(html, new RegExp(`<meta name="keywords" content="${keywordContent}">`));
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.posnic\.io\/">/);
  }

  assert.match(login, /<meta property="og:title" content="Posnic POS - Offline POS & Billing Software">/);
  assert.match(login, /<meta property="og:url" content="https:\/\/www\.posnic\.io\/">/);
  assert.match(login, /<meta name="twitter:card" content="summary">/);
  assert.match(login, /<meta name="twitter:title" content="Posnic POS - Offline POS & Billing Software">/);

  const softwareSchema = extractJsonLd(login, 'posnic-software-schema');
  assert.equal(softwareSchema['@context'], 'https://schema.org');
  assert.equal(softwareSchema['@type'], 'SoftwareApplication');
  assert.equal(softwareSchema.name, 'Posnic POS');
  assert.equal(softwareSchema.url, 'https://www.posnic.io/');
  assert.equal(softwareSchema.codeRepository, 'https://github.com/Posnic/POS');
  assert.equal(softwareSchema.applicationCategory, 'BusinessApplication');
  assert.equal(softwareSchema.softwareVersion, '1.6.1');
  assert.deepEqual(softwareSchema.keywords, POSNIC_SEO_KEYWORDS);
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
