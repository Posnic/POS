const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN = process.argv[2];
const OWNER = 'Posnic';
const REPO  = 'installer';

if (!TOKEN) { console.error('Usage: node scripts/publish-release.js <github-token>'); process.exit(1); }

const pkg     = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = pkg.version;
const TAG     = `v${VERSION}`;
const DIST    = path.join(__dirname, '..', 'dist');

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'posnic-publisher',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(opts, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${b}`));
        resolve(JSON.parse(b || '{}'));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(releaseId, filePath, fileName) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const mb   = (stat.size / 1024 / 1024).toFixed(1);
    console.log(`  Uploading ${fileName} (${mb} MB)...`);
    const opts = {
      hostname: 'uploads.github.com',
      path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`,
      method: 'POST',
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'User-Agent': 'posnic-publisher',
        'Accept': 'application/vnd.github+json'
      }
    };
    const req = https.request(opts, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        if (res.statusCode === 201) { console.log(`  Done: ${JSON.parse(b).browser_download_url}`); resolve(); }
        else reject(new Error(`Upload failed HTTP ${res.statusCode}: ${b}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(600000, () => req.destroy(new Error('Upload timeout')));
    let uploaded = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      uploaded += chunk.length;
      process.stdout.write(`\r    ${((uploaded/stat.size)*100).toFixed(1)}% (${(uploaded/1024/1024).toFixed(1)} MB)`);
    });
    stream.on('end', () => process.stdout.write('\n'));
    stream.pipe(req);
  });
}

async function main() {
  console.log(`\nPublishing ${TAG} to ${OWNER}/${REPO}...\n`);

  // 1. Check if release exists
  let release;
  try {
    release = await apiRequest('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    console.log(`Release ${TAG} already exists (id=${release.id})`);
  } catch {
    // Create release
    console.log(`Creating release ${TAG}...`);
    release = await apiRequest('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      name: `Version ${VERSION}`,
      body: `Posnic ${TAG}`,
      draft: false,
      prerelease: false
    });
    console.log(`Created: id=${release.id}`);
  }

  // 2. Upload assets
  const files = [
    { src: path.join(DIST, 'latest.yml'),                          name: 'latest.yml' },
    { src: path.join(DIST, `Posnic-Setup-${VERSION}.exe`),     name: `Posnic-Setup-${VERSION}.exe` },
    { src: path.join(DIST, `Posnic-Setup-${VERSION}.exe.blockmap`), name: `Posnic-Setup-${VERSION}.exe.blockmap` },
  ];

  for (const f of files) {
    if (!fs.existsSync(f.src)) { console.log(`  Skipping (not found): ${f.src}`); continue; }
    try {
      await uploadAsset(release.id, f.src, f.name);
    } catch (e) {
      console.error(`  Failed: ${e.message}`);
      if (f.name.endsWith('.exe') && !f.name.endsWith('.blockmap')) {
        console.log(`  Upload exe manually via browser: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
      }
    }
  }

  console.log(`\nDone: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
