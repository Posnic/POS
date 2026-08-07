'use strict';
/*
 * The value a signing secret takes when nobody supplied one.
 *
 * It used to be a string in the source - "your-secret-key",
 * "your_jwt_secret_key_here". Those were harmless while the repository was
 * private and every real launch set the environment variable anyway. The moment
 * the repository is public they become published signing keys: any deployment
 * that missed the variable would be signing login tokens with a string printed
 * on the internet, and anyone could mint a token for any user of any tenant.
 *
 * The API already refuses to boot without these - see verify-secrets, which
 * server.js runs before anything is served, and which the desktop app satisfies
 * by generating a set per machine. So the fallback is unreachable through both
 * front doors. This exists for every other door: a maintenance script, a test
 * harness, someone self-hosting who runs app.js directly, a future entry point
 * that forgets the check.
 *
 * Throwing on import was considered and rejected - see the note in
 * verify-secrets. A module that explodes when required cannot be read for
 * something harmless like a port, and every test that touches it fails for the
 * wrong reason.
 *
 * So it fails closed instead of failing public: a random value, generated once
 * per process. Tokens signed with it cannot be forged by a reader of this
 * source, and they stop working when the process restarts - which is a loud,
 * local, harmless failure rather than a quiet, global one.
 */

const crypto = require('crypto');

const generated = new Map();

/**
 * @param {string} name  The environment variable that should have carried it,
 *                       used only to keep separate secrets separate.
 * @returns {string}     32 random bytes, hex encoded. Stable within a process.
 */
function ephemeralSecret(name) {
  if (!generated.has(name)) {
    generated.set(name, crypto.randomBytes(32).toString('hex'));

    // Said once, so the reason for the sudden logouts is discoverable.
    console.warn(
      `[config] ${name} is not set. Using a random value for this process only; ` +
        `sessions will not survive a restart. Set ${name} to fix this.`
    );
  }
  return generated.get(name);
}

module.exports = { ephemeralSecret };
