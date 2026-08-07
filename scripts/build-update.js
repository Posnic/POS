/**
 * Full Update Package Builder (api + web)
 *
 * Creates update packages with both api (backend) and web changes.
 * Usage: node build-update.js [version] [output-dir]
 *
 * Output zip name: posnic-update-v<version>.zip
 * The zip is placed in the output dir (default: ./update-packages).
 *
 * Copy the generated zip to:
 *   C:\Users\<user>\AppData\Roaming\posnic\update-packages\
 * on the client machine to trigger the in-app notification.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');

// Directories/patterns to skip when copying
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', '.vscode',
  'dist', 'coverage', '__pycache__', '.DS_Store'
]);
const SKIP_EXTENSIONS = new Set(['.log', '.map', '.lock']);

async function buildUpdatePackage(version = '1.0.1', outputDir = './update-packages') {
  console.log(`\n🔧 Building full update package v${version} (api + web)...\n`);

  try {
    const workDir = path.join(outputDir, `_build-${version}`);
    const zipFilePath = path.join(outputDir, `posnic-update-v${version}.zip`);

    // Clean up
    if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });

    fs.mkdirSync(path.join(workDir, 'updates'), { recursive: true });

    // ── Sources to include ──────────────────────────────────────────────────
    const sources = {
      'api/':    path.join(__dirname, 'api'),
      'frontend/': path.join(__dirname, 'frontend'),
    };

    let totalFiles = 0;
    const includedKeys = [];

    for (const [targetKey, srcDir] of Object.entries(sources)) {
      if (!fs.existsSync(srcDir)) {
        console.log(`   ⚠️  ${targetKey} - not found at ${srcDir}, skipping`);
        continue;
      }
      const destDir = path.join(workDir, 'updates', targetKey);
      copyDirectory(srcDir, destDir);
      const count = countFiles(destDir);
      totalFiles += count;
      includedKeys.push(targetKey);
      console.log(`   ✅ ${targetKey} (${count} files)`);
    }

    if (includedKeys.length === 0) {
      throw new Error('No source directories found. Check that api/ and web/ exist.');
    }

    // ── manifest.json ───────────────────────────────────────────────────────
    const manifest = {
      version,
      releaseDate: new Date().toISOString(),
      checksum: '',
      changelog: [
        `v${version} full update`,
        'Updated api backend',
        'Updated web UI',
      ],
      requirements: {
        minVersion: '1.0.0',
        nodeVersion: '>=14.0.0',
        platforms: ['win32', 'darwin', 'linux'],
      },
      files: includedKeys,
      metadata: {
        totalFiles,
        buildDate: new Date().toISOString(),
        buildEnvironment: process.platform,
        updateType: 'full',
        components: includedKeys,
        excludes: ['node_modules/', '.git/'],
      },
      nodeModules: { required: false, downloadUrl: null, checksum: null },
    };

    fs.writeFileSync(
      path.join(workDir, 'updates', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    console.log(`   ✅ manifest.json`);

    // ── Build zip (two-pass for checksum) ───────────────────────────────────
    console.log(`\n🗜️  Creating zip archive...`);
    await zipDirectory(workDir, zipFilePath);

    const buf = fs.readFileSync(zipFilePath);
    const checksum = crypto.createHash('sha256').update(buf).digest('hex');

    // Patch checksum into manifest and re-zip
    manifest.checksum = checksum;
    fs.writeFileSync(
      path.join(workDir, 'updates', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    fs.unlinkSync(zipFilePath);
    await zipDirectory(workDir, zipFilePath);

    const finalBuf = fs.readFileSync(zipFilePath);
    const finalChecksum = crypto.createHash('sha256').update(finalBuf).digest('hex');

    console.log(`\n✅ Full update package created!`);
    console.log(`📦 File     : ${zipFilePath}`);
    console.log(`📏 Size     : ${(finalBuf.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`🔐 Checksum : ${finalChecksum}`);
    console.log(`📄 Files    : ${totalFiles}`);
    console.log(`🎯 Includes : ${includedKeys.join(', ')}`);

    // console.log(`\n📋 Deploy steps:`);
    // console.log(`   1. Copy the zip to the client machine:`);
    // console.log(`      C:\\Users\\<user>\\AppData\\Roaming\\posnic\\update-packages\\`);
    // console.log(`   2. The app detects it automatically and shows the badge.`);

    // Cleanup temp build dir
    fs.rmSync(workDir, { recursive: true, force: true });

  } catch (err) {
    console.error('❌ Build failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

function zipDirectory(srcDir, destZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_EXTENSIONS.has(path.extname(entry.name))) continue;

    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return count;
}

if (require.main === module) {
  const version   = process.argv[2] || '1.0.1';
  const outputDir = process.argv[3] || './update-packages';
  buildUpdatePackage(version, outputDir);
}

module.exports = { buildUpdatePackage };
