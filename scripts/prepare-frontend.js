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

/* Bundle names carry a content hash (dashboard.<hash8>.js), so the JS
   artifacts are matched by pattern rather than exact name. */
const requiredArtifacts = [
  'public/login.html',
  'public/dashboard.html',
  { dir: 'public/script', pattern: /^login\.[0-9a-f]{8}\.js$/ },
  { dir: 'public/script', pattern: /^dashboard\.[0-9a-f]{8}\.js$/ },
];

for (const spec of requiredArtifacts) {
  let artifact;
  if (typeof spec === 'string') {
    artifact = path.join(frontend, spec);
    if (!fs.existsSync(artifact)) {
      throw new Error(`web build did not create ${spec}`);
    }
  } else {
    const dir = path.join(frontend, spec.dir);
    const match = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((n) => spec.pattern.test(n))
      : null;
    if (!match) {
      throw new Error(`web build did not create ${spec.dir}/${spec.pattern}`);
    }
    artifact = path.join(dir, match);
  }

  // Allow a small filesystem timestamp tolerance on Windows.
  if (fs.statSync(artifact).mtimeMs < startedAt - 2000) {
    throw new Error(`web artifact is stale: ${artifact}`);
  }
}

console.log('[web] Public assets are fresh and ready for packaging.');
