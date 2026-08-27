const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function extractArchive(sevenZipPath, archivePath, destination, onPercent) {
  return new Promise((resolve, reject) => {
    // -bsp1 streams progress percentages to stdout so the loading screen
    // can show real extraction progress instead of a silent wait.
    const proc = spawn(
      sevenZipPath,
      ['x', '-y', '-aoa', '-bsp1', `-o${destination}`, archivePath],
      { windowsHide: true }
    );
    let stderr = '';
    proc.stdout.on('data', (data) => {
      const match = String(data).match(/(\d{1,3})%/);
      if (match && typeof onPercent === 'function') {
        onPercent(Math.min(100, parseInt(match[1], 10)));
      }
    });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', (error) => {
      error.message = `API runtime extraction failed: ${error.message}`;
      reject(error);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`API runtime extraction failed (exit ${code})\n${stderr}`));
    });
  });
}

function getArchiveId(archivePath) {
  /*
   * Prefer the build fingerprint shipped beside the archive
   * (node_modules.zip.id, written by scripts/prepare-api-runtime.js): it only
   * changes when the dependencies or build settings genuinely change. Hashing
   * the archive bytes - the fallback for older installs that shipped without
   * the id - changes on every CI build (fresh file mtimes inside the zip), so
   * it forced the slow full re-extraction on every update even when nothing
   * in the runtime had changed.
   */
  try {
    const shipped = fs.readFileSync(`${archivePath}.id`, 'utf8').trim();
    if (/^[0-9a-f]{16,}$/i.test(shipped)) return shipped;
  } catch (e) { /* no id file: fall back to hashing the bytes */ }
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(archivePath));
  return hash.digest('hex');
}

async function ensureApiRuntime({ archivePath, sevenZipPath, userDataPath, onProgress }) {
  const archiveId = getArchiveId(archivePath);
  const runtimeRoot = path.join(userDataPath, 'api-runtime', 'current');
  const nodeModulesPath = path.join(runtimeRoot, 'node_modules');
  const readyMarker = path.join(runtimeRoot, '.ready');

  if (fs.existsSync(readyMarker) && fs.existsSync(nodeModulesPath)) {
    const installedArchiveId = fs.readFileSync(readyMarker, 'utf8').trim();
    if (installedArchiveId === archiveId) return nodeModulesPath;
  }

  const temporaryRoot = `${runtimeRoot}.extracting`;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(temporaryRoot, 'node_modules'), { recursive: true });

  console.log('Preparing API runtime for first launch...');
  await extractArchive(
    sevenZipPath,
    archivePath,
    path.join(temporaryRoot, 'node_modules'),
    onProgress
  );
  fs.writeFileSync(path.join(temporaryRoot, '.ready'), archiveId, 'utf8');

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.renameSync(temporaryRoot, runtimeRoot);
  console.log('API runtime is ready:', nodeModulesPath);
  return nodeModulesPath;
}

module.exports = { ensureApiRuntime };
