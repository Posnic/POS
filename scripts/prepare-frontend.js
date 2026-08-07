const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const startedAt = Date.now();
const npmCli = process.env.npm_execpath;

if (!npmCli || !fs.existsSync(npmCli)) {
  throw new Error('Unable to locate the npm CLI used to start this build.');
}

console.log('[web] Building fresh public assets...');
const result = spawnSync(process.execPath, [npmCli, 'run', 'build:assets'], {
  cwd: frontend,
  stdio: 'inherit',
  shell: false
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const requiredArtifacts = [
  'public/login.html',
  'public/dashboard.html',
  'public/script/login.js',
  'public/script/dashboard.js'
];

for (const relativePath of requiredArtifacts) {
  const artifact = path.join(frontend, relativePath);
  if (!fs.existsSync(artifact)) {
    throw new Error(`web build did not create ${relativePath}`);
  }

  // Allow a small filesystem timestamp tolerance on Windows.
  if (fs.statSync(artifact).mtimeMs < startedAt - 2000) {
    throw new Error(`web artifact is stale: ${relativePath}`);
  }
}

console.log('[web] Public assets are fresh and ready for packaging.');
