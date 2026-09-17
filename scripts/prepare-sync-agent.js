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
  /*
   * NO node_modules IS THE NORMAL CASE, not a mistake, and the old warning
   * here said the opposite.
   *
   * The agent declares bson, dotenv and mongodb, and ships with none of them.
   * It works because it is spawned from the Electron main process, which
   * inherits NODE_PATH pointing at the API's own node_modules - see
   * src/server.js, where that is set up for the in-process API. The agent
   * needs the same three packages the API already carries, so a second copy
   * would be dead weight in the installer.
   *
   * The old text told whoever saw it to run npm install in the Cloud agent,
   * which would have made every installer larger to fix nothing. A warning
   * that fires on every correct build is a warning people learn to scroll
   * past, and then the real one goes past too.
   *
   * Said out loud rather than deleted, because the coupling is invisible from
   * here and somebody should know it exists. tests/the-sync-agent-finds-its-
   * modules.test.js pins it.
   */
  if (!fs.existsSync(path.join(target, 'node_modules'))) {
    console.log('[prepare-sync-agent] no node_modules, as expected: the agent resolves bson, dotenv and mongodb through NODE_PATH from the API runtime');
  }
  console.log('[prepare-sync-agent] bundled sync agent from', source);

  /*
   * THE TWO LISTS MUST AGREE, or a collection syncs on paper only.
   *
   * api/src/sync/collections.json is what this app says must travel between
   * the cloud and a till. The agent's sync-config.json, bundled just above,
   * is what the till will actually push and pull. The restaurant's tables
   * were in neither, and nothing compared them, so a shop ran with two
   * different floors for as long as sync has existed.
   *
   * A bundle that would sync less than the app promises, or more than the
   * app has decided, does not get built. Fixing it is a line in one file
   * or the other, and a decision; that is the point.
   */
  const decisions = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'sync', 'collections.json'), 'utf8')
  );
  const bundled = JSON.parse(fs.readFileSync(path.join(target, 'sync-config.json'), 'utf8')).collections || {};
  const promised = Object.keys(decisions.synced || {});
  const missing = promised.filter((name) => !bundled[name]);
  const extra = Object.keys(bundled).filter((name) => !decisions.synced[name]);
  if (missing.length || extra.length) {
    if (missing.length) {
      console.error('[prepare-sync-agent] the bundled agent does NOT sync: ' + missing.join(', '));
      console.error('  api/src/sync/collections.json marks these synced; the agent at ' + source + ' has no lane for them.');
    }
    if (extra.length) {
      console.error('[prepare-sync-agent] the bundled agent syncs collections this app has not decided on: ' + extra.join(', '));
      console.error('  Add them to "synced" in api/src/sync/collections.json, or drop them from the agent.');
    }
    process.exit(1);
  }
  console.log('[prepare-sync-agent] the agent syncs every collection the app promises (' + promised.length + ')');
} else {
  fs.writeFileSync(
    path.join(target, '.placeholder'),
    'Sync agent not bundled in this build (open-source build).\n'
  );
  console.log('[prepare-sync-agent] no agent found — open-source build without cloud sync');
}
