'use strict';
/*
 * Refuse to start without the secrets this installation signs with.
 *
 * These used to be constants in config.js, so every Posnic in the world signed
 * its tokens with the same string and guarded its kiosk endpoints with the
 * same key. Anyone who read the source could mint a session for any till, and
 * publishing the repository would have made that public knowledge.
 *
 * They are generated per machine by the desktop app and handed in through the
 * environment. If one is missing, something is wrong with the launch - and
 * carrying on with a placeholder would quietly recreate the shared-secret
 * problem this replaced. So the API stops and says which one.
 *
 * Checked at startup rather than inside config.js, because a module that
 * throws when imported cannot be read for something harmless like a port, and
 * every test that touches it fails for the wrong reason.
 */

// Signing and encryption. Nothing works safely without these.
const REQUIRED = [
  ['JWT_SECRET', 'signs login tokens'],
  ['SESSION_SECRET', 'signs session cookies'],
  ['ENCRYPTION_KEY', 'encrypts record identifiers'],
  ['ENCRYPTION_IV', 'the initialisation vector paired with that key'],
];

// Guards the kiosk and kitchen endpoints. Absent means those routes stay shut,
// which is a working configuration for a shop that does not use them.
const OPTIONAL = [['KIOSK_API_KEY', 'kiosk and kitchen endpoints are disabled without it']];

function verifySecrets({ exitOnFailure = true, log = console } = {}) {
  const missing = REQUIRED.filter(([name]) => !process.env[name]);

  for (const [name, why] of OPTIONAL) {
    if (!process.env[name]) log.warn(`[config] ${name} is not set: ${why}`);
  }

  if (!missing.length) return { ok: true, missing: [] };

  log.error('[config] refusing to start; these are not set:');
  for (const [name, why] of missing) log.error(`  ${name} - ${why}`);
  log.error('');
  log.error('  The desktop app generates these per installation and passes them in.');
  log.error('  Running the API on its own? Put them in api/.env - see .env.example.');
  log.error('  There is deliberately no default: a shipped one would be shared by');
  log.error('  every installation, which is the problem this replaced.');

  if (exitOnFailure) process.exit(1);
  return { ok: false, missing: missing.map(([n]) => n) };
}

module.exports = { verifySecrets, REQUIRED, OPTIONAL };
