const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const agent  = new https.Agent({ keepAlive: true, timeout: 600000 });

const TOKEN     = process.argv[2];
const RELEASE_ID = 331394021;
const OWNER     = 'Posnic';
const REPO      = 'installer';

if (!TOKEN) { console.error('Usage: node upload-release.js <github-token>'); process.exit(1); }

const FILE_PATH = path.join(__dirname, '..', 'dist', 'Posnic-Setup-1.0.2.exe');
const FILE_NAME = 'Posnic-Setup-1.0.2.exe';

function upload(filePath, fileName) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
    console.log(`Uploading ${fileName} (${sizeMB} MB)...`);

    const options = {
      hostname: 'uploads.github.com',
      path: `/repos/${OWNER}/${REPO}/releases/${RELEASE_ID}/assets?name=${encodeURIComponent(fileName)}`,
      method: 'POST',
      agent: agent,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'User-Agent': 'posnic-uploader',
        'Accept': 'application/vnd.github+json',
        'Connection': 'keep-alive'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        if (res.statusCode === 201) {
          const json = JSON.parse(body);
          console.log('Uploaded:', json.browser_download_url);
          resolve(json);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(new Error('Timeout after 5 min')); });

    let uploaded = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      uploaded += chunk.length;
      const pct = ((uploaded / stat.size) * 100).toFixed(1);
      process.stdout.write(`\r  Progress: ${pct}% (${(uploaded/1024/1024).toFixed(1)} MB)`);
    });
    stream.on('end', () => process.stdout.write('\n'));
    stream.pipe(req);
  });
}

async function uploadWithRetry(filePath, fileName, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      await upload(filePath, fileName);
      return;
    } catch (e) {
      console.error(`\nAttempt ${i}/${retries} failed: ${e.message}`);
      if (i < retries) { console.log('Retrying in 5s...'); await new Promise(r => setTimeout(r, 5000)); }
      else process.exit(1);
    }
  }
}

uploadWithRetry(FILE_PATH, FILE_NAME).then(() => console.log('\nAll done!'));
