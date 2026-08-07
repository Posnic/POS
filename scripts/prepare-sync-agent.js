/**
 * Optional build step: bundle the POSNIC Cloud sync agent into the installer.
 *
 * The agent is proprietary and lives in the private Cloud repo. If a sibling
 * checkout exists (../Cloud/apps/sync-agent, or SYNC_AGENT_DIR env), it is
 * copied (with production node_modules) into builds/sync-agent so
 * electron-builder ships it under resources/sync-agent.
 *
 * Open-source builds: the folder is absent → an empty placeholder is created
 * and the app simply runs without cloud sync.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'builds', 'sync-agent');
const source =
  process.env.SYNC_AGENT_DIR ||
  path.join(__dirname, '..', '..', 'Gateway', 'apps', 'sync-agent');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

if (fs.existsSync(path.join(source, 'src', 'index.js'))) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (src) => !/[\\/]\.env$/.test(src) && !/[\\/]agent-smoke\.log$/.test(src),
  });
  if (!fs.existsSync(path.join(target, 'node_modules'))) {
    console.warn('[prepare-sync-agent] WARNING: agent copied without node_modules — run npm install in the Cloud agent first');
  }
  console.log('[prepare-sync-agent] bundled sync agent from', source);
} else {
  fs.writeFileSync(
    path.join(target, '.placeholder'),
    'Sync agent not bundled in this build (open-source build).\n'
  );
  console.log('[prepare-sync-agent] no agent found — open-source build without cloud sync');
}
