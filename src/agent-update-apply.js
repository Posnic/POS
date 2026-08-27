'use strict';
/*
 * The desktop's half of the sync agent's self-update (U3.5).
 *
 * The agent (a Gateway-repo process this app supervises) only DOWNLOADS: it
 * leaves <updates-root>/incoming/<version>/{bundle.zip, manifest.json} and
 * carries on syncing. THIS code - running in the app, not in the process
 * being replaced - verifies the Ed25519 manifest with the same committed
 * public key that guards frontend asset updates, unpacks the bundle, and
 * stages/activates it through the same AssetUpdater engine, which also
 * brings the crash-loop auto-revert: an updated agent that cannot stay up
 * is abandoned after MAX_BOOT_ATTEMPTS and the installer's copy runs again.
 *
 * Separated from sync-agent-manager.js so the decision logic is testable
 * without Electron or 7za: the extractor is injected.
 */
const fs = require('fs');
const path = require('path');

/*
 * Apply every downloaded release sitting in incomingDir, oldest first.
 * Each attempt consumes its directory whatever the outcome: a refused
 * artifact must not be retried forever - the agent's next daily check
 * re-downloads anything still current.
 *
 * extract(zipPath, destDir) -> Promise; loadTree(dir) -> Map<relPath,Buffer>.
 */
async function applyIncoming({ engine, incomingDir, extract, loadTree, log = () => {} }) {
  if (!engine || !engine.publicKey) return { applied: [], reason: 'no-key' };
  if (!fs.existsSync(incomingDir)) return { applied: [] };

  const applied = [];
  const entries = fs
    .readdirSync(incomingDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.endsWith('.partial'))
    .map((e) => e.name)
    .sort();

  for (const version of entries) {
    const dir = path.join(incomingDir, version);
    try {
      const manifestFile = path.join(dir, 'manifest.json');
      const zipFile = path.join(dir, 'bundle.zip');
      if (!fs.existsSync(manifestFile) || !fs.existsSync(zipFile)) {
        log(`[agent-update] ${version}: incomplete download, discarding`);
        continue;
      }
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (manifest.kind !== 'agent' || String(manifest.version) !== String(version)) {
        log(`[agent-update] ${version}: manifest does not describe this release, discarding`);
        continue;
      }
      const verdict = engine.verifyManifest(manifest);
      if (!verdict.ok) {
        log(`[agent-update] refusing ${version}: ${verdict.reason}`);
        continue;
      }

      const treeDir = path.join(dir, 'tree');
      fs.mkdirSync(treeDir, { recursive: true });
      await extract(zipFile, treeDir);

      const staged = engine.stage(manifest, loadTree(treeDir));
      if (!staged.ok) {
        log(`[agent-update] stage refused ${version}: ${staged.reason}`);
        continue;
      }
      const active = engine.activate(version);
      if (!active.ok) {
        log(`[agent-update] activate refused ${version}: ${active.reason}`);
        continue;
      }
      applied.push(version);
      log(`[agent-update] agent ${version} verified and active for this start`);
    } catch (err) {
      log(`[agent-update] ${version} failed: ${err.message}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return { applied };
}

module.exports = { applyIncoming };
