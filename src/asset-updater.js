'use strict';
/*
 * Updating the shop's JavaScript without reinstalling the app.
 *
 * Most of what goes wrong in a till is fixed by changing a few files: a receipt
 * that prints crooked, a button in the wrong place, a total rounding badly. A
 * shop will not run an installer for that, so those fixes sit unshipped until
 * something big enough justifies the disruption - and by then there are twenty
 * of them going out at once, which is its own risk.
 *
 * This applies them a directory at a time. The whole design is built around one
 * assumption: sooner or later a bad update will go out, to a machine nobody can
 * reach, in a shop that is mid-trade. Everything here exists to make that
 * survivable rather than to make the happy path elegant.
 *
 *   - Nothing is applied unless it is signed. An update channel that downloads
 *     JavaScript and runs it is remote code execution with extra steps; the
 *     only thing standing between a leaked publishing token and every till in
 *     the field is a signature the token cannot forge.
 *   - Nothing is applied in place. A new version is written to its own
 *     directory and becomes live by moving a pointer, so a download that dies
 *     halfway leaves the running version untouched.
 *   - The previous version is kept. Reverting is a pointer move, not a
 *     download, so it works on a machine whose network is the reason you are
 *     reverting.
 *   - A version that cannot boot twice is abandoned automatically. This is the
 *     one that matters: a shop with a white screen cannot click Revert, and
 *     cannot describe what happened.
 *
 * Deliberately no network code. This module decides what is safe to run; how
 * bytes arrive is somebody else's problem, and keeping them apart is what makes
 * any of this testable without a server.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Two failed boots is a broken version, not bad luck. */
const MAX_BOOT_ATTEMPTS = 2;

/* Keep one version back. Two would be a nicer story and more disk than a till
   has to spare; one is enough to undo the mistake you just made. */
const KEEP_PREVIOUS = 1;

class AssetUpdater {
  /**
   * @param {object}   opts
   * @param {string}   opts.root       directory this owns entirely
   * @param {string}   opts.publicKey  PEM Ed25519 key, or null to refuse all updates
   * @param {string}   opts.baseline   assets shipped in the installer (the floor)
   * @param {function} [opts.log]
   */
  constructor({ root, publicKey, baseline, log } = {}) {
    this.root = root;
    this.publicKey = publicKey || null;
    this.baseline = baseline || null;
    this.log = log || (() => {});
    this.versionsDir = path.join(root, 'versions');
    this.pointerFile = path.join(root, 'current');
    this.previousFile = path.join(root, 'previous');
    this.bootFile = path.join(root, 'boot-state.json');
  }

  /* ---------------------------------------------------------------- *
   * Where the app should load its assets from
   * ---------------------------------------------------------------- */

  /*
   * The directory to serve, right now.
   *
   * Falls back to the assets that came with the installer whenever anything is
   * missing or unreadable. A till that will not start is a worse outcome than
   * a till running last month's JavaScript, every time.
   */
  activeDir() {
    try {
      if (fs.existsSync(this.pointerFile)) {
        const version = fs.readFileSync(this.pointerFile, 'utf8').trim();
        const dir = path.join(this.versionsDir, version);
        if (version && fs.existsSync(dir)) return dir;
        this.log('[assets] pointer names a version that is not here: ' + version);
      }
    } catch (err) {
      this.log('[assets] pointer unreadable: ' + err.message);
    }
    return this.baseline;
  }

  activeVersion() {
    try {
      if (fs.existsSync(this.pointerFile)) {
        return fs.readFileSync(this.pointerFile, 'utf8').trim() || null;
      }
    } catch (err) { /* falls through to baseline */ }
    return null;
  }

  previousVersion() {
    try {
      if (fs.existsSync(this.previousFile)) {
        return fs.readFileSync(this.previousFile, 'utf8').trim() || null;
      }
    } catch (err) { /* nothing to go back to */ }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * Verifying
   * ---------------------------------------------------------------- */

  /*
   * What was signed.
   *
   * The signature covers the version and the file list including every hash,
   * so neither the contents nor the set of files can be changed without
   * invalidating it. Serialised deliberately rather than with JSON.stringify of
   * the whole manifest: a signer and a verifier that disagree by one key order
   * produce a failure nobody can debug.
   */
  static signedPayload(manifest) {
    const files = (manifest.files || [])
      .map((f) => `${f.path}:${f.sha256}`)
      .sort()
      .join('\n');
    return `version=${manifest.version}\nkind=${manifest.kind || 'assets'}\n${files}`;
  }

  /*
   * Whether this manifest really came from us.
   *
   * No key configured means no updates, not "updates without checking". A build
   * that forgot to embed the key must be inert, not trusting.
   */
  verifyManifest(manifest) {
    if (!this.publicKey) return { ok: false, reason: 'no-public-key' };
    if (!manifest || !manifest.version || !Array.isArray(manifest.files)) {
      return { ok: false, reason: 'malformed-manifest' };
    }
    if (!manifest.signature) return { ok: false, reason: 'unsigned' };

    // A path that escapes the version directory would let an update write
    // anywhere on the machine - the database, the startup folder, the app
    // itself. Checked before the signature, because a malformed path is worth
    // refusing even from a correctly signed manifest.
    for (const f of manifest.files) {
      if (typeof f.path !== 'string' || !f.path || typeof f.sha256 !== 'string') {
        return { ok: false, reason: 'malformed-file-entry' };
      }
      const normalised = path.normalize(f.path).replace(/\\/g, '/');
      if (normalised.startsWith('../') || normalised.startsWith('/') || path.isAbsolute(f.path)
          || normalised.includes('../')) {
        return { ok: false, reason: 'path-escape', path: f.path };
      }
    }

    let ok = false;
    try {
      ok = crypto.verify(
        null,
        Buffer.from(AssetUpdater.signedPayload(manifest), 'utf8'),
        this.publicKey,
        Buffer.from(manifest.signature, 'base64'),
      );
    } catch (err) {
      return { ok: false, reason: 'signature-error', detail: err.message };
    }
    return ok ? { ok: true } : { ok: false, reason: 'bad-signature' };
  }

  static hash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /* ---------------------------------------------------------------- *
   * Applying
   * ---------------------------------------------------------------- */

  /*
   * Write a verified version to disk, without making it live.
   *
   * Staged whole, then checked, then activated separately - so a download that
   * fails at the last file leaves a half-written directory that nothing points
   * at, rather than a half-written app that everything does.
   *
   * @param {object} manifest
   * @param {Map<string,Buffer>} contents  path -> bytes
   */
  stage(manifest, contents) {
    const verdict = this.verifyManifest(manifest);
    if (!verdict.ok) return { ok: false, ...verdict };

    for (const f of manifest.files) {
      const buf = contents.get(f.path);
      if (!buf) return { ok: false, reason: 'missing-file', path: f.path };
      if (AssetUpdater.hash(buf) !== f.sha256) {
        return { ok: false, reason: 'hash-mismatch', path: f.path };
      }
    }

    const target = path.join(this.versionsDir, manifest.version);
    const partial = target + '.partial';
    try {
      fs.rmSync(partial, { recursive: true, force: true });
      fs.mkdirSync(partial, { recursive: true });

      for (const f of manifest.files) {
        const dest = path.join(partial, f.path);
        // Second line of defence: even a signed manifest does not get to write
        // outside the directory being staged.
        if (!path.resolve(dest).startsWith(path.resolve(partial))) {
          throw new Error('path escapes staging directory: ' + f.path);
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, contents.get(f.path));
      }
      fs.writeFileSync(path.join(partial, 'manifest.json'), JSON.stringify(manifest, null, 2));

      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(partial, target);
    } catch (err) {
      fs.rmSync(partial, { recursive: true, force: true });
      return { ok: false, reason: 'write-failed', detail: err.message };
    }

    this.log('[assets] staged ' + manifest.version);
    return { ok: true, version: manifest.version, dir: target };
  }

  /*
   * Make a staged version live.
   *
   * The pointer is written last and is a single small file, so the window in
   * which a power cut could leave things inconsistent is as small as a write
   * gets. Whatever was live becomes "previous", which is what revert reads.
   */
  activate(version) {
    const dir = path.join(this.versionsDir, version);
    if (!fs.existsSync(dir)) return { ok: false, reason: 'not-staged', version };

    const outgoing = this.activeVersion();
    try {
      fs.mkdirSync(this.root, { recursive: true });
      if (outgoing && outgoing !== version) {
        fs.writeFileSync(this.previousFile, outgoing);
      }
      fs.writeFileSync(this.pointerFile, version);
      // A newly activated version has not proved it can boot yet.
      this._writeBootState({ version, attempts: 0 });
    } catch (err) {
      return { ok: false, reason: 'activate-failed', detail: err.message };
    }

    this._prune();
    this.log('[assets] activated ' + version + (outgoing ? ' (was ' + outgoing + ')' : ''));
    return { ok: true, version, previous: outgoing };
  }

  /*
   * Go back to the version before this one.
   *
   * A pointer move and nothing else: no download, no unpacking, no network.
   * That is the point - the machine you most need to revert is the one that
   * cannot reach you.
   */
  revert() {
    const previous = this.previousVersion();
    const current = this.activeVersion();

    if (previous && fs.existsSync(path.join(this.versionsDir, previous))) {
      try {
        fs.writeFileSync(this.pointerFile, previous);
        fs.rmSync(this.previousFile, { force: true });
        this._writeBootState({ version: previous, attempts: 0 });
      } catch (err) {
        return { ok: false, reason: 'revert-failed', detail: err.message };
      }
      this.log('[assets] reverted to ' + previous);
      return { ok: true, version: previous, from: current };
    }

    // Nothing to go back to but the installer's own copy, which is always
    // there and always works, because it is what was tested before shipping.
    try {
      fs.rmSync(this.pointerFile, { force: true });
      fs.rmSync(this.previousFile, { force: true });
      this._writeBootState({ version: null, attempts: 0 });
    } catch (err) {
      return { ok: false, reason: 'revert-failed', detail: err.message };
    }
    this.log('[assets] reverted to the installed baseline');
    return { ok: true, version: null, from: current, baseline: true };
  }

  /* ---------------------------------------------------------------- *
   * The health gate
   * ---------------------------------------------------------------- */

  _readBootState() {
    try {
      if (fs.existsSync(this.bootFile)) return JSON.parse(fs.readFileSync(this.bootFile, 'utf8'));
    } catch (err) { /* treat as first boot */ }
    return { version: null, attempts: 0 };
  }

  _writeBootState(state) {
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fs.writeFileSync(this.bootFile, JSON.stringify(state));
    } catch (err) {
      this.log('[assets] could not record boot state: ' + err.message);
    }
  }

  /*
   * Called as the app starts, before any of the updated code runs.
   *
   * Counts the attempt. If this version has already failed to reach a healthy
   * state twice, it is abandoned and the previous one is put back - which is
   * the only recovery available to a shop looking at a white screen, because
   * they cannot click anything on it.
   */
  beginBoot() {
    const version = this.activeVersion();

    /*
     * There is nothing behind the baseline to go back to.
     *
     * activeVersion() is null when no update has been applied, which is every
     * fresh install. Counted like any other version, null reached the attempt
     * limit on the second launch and the app announced
     *
     *   [assets] null failed to start 2 times - going back
     *   [assets] reverted to the installed baseline
     *
     * on a shop that had never updated anything. Harmless - it "reverted" to
     * where it already was - but it is alarming to read in a log and it is
     * work done for no reason on every second start.
     *
     * The counter exists to catch an update that will not boot. With no
     * update applied there is no such thing to catch.
     */
    if (!version) return { reverted: false, version: null };

    const state = this._readBootState();

    if (state.version === version && state.attempts >= MAX_BOOT_ATTEMPTS) {
      this.log('[assets] ' + version + ' failed to start ' + state.attempts
        + ' times - going back');
      const result = this.revert();
      return { reverted: true, from: version, to: result.version };
    }

    this._writeBootState({
      version,
      attempts: state.version === version ? (state.attempts || 0) + 1 : 1,
    });
    return { reverted: false, version };
  }

  /*
   * Called once the app is actually working.
   *
   * "Working" has to mean further along than "the process started" - a version
   * that crashes after painting a blank screen would otherwise clear its own
   * strike. The caller decides where that line is; this only records it.
   */
  markHealthy() {
    const version = this.activeVersion();
    this._writeBootState({ version, attempts: 0, healthyAt: new Date().toISOString() });
  }

  /* ---------------------------------------------------------------- *
   * Housekeeping
   * ---------------------------------------------------------------- */

  /* Old versions are disk a till does not have. Keep the live one and the one
     revert needs; delete the rest. */
  _prune() {
    try {
      if (!fs.existsSync(this.versionsDir)) return;
      const keep = new Set([this.activeVersion(), this.previousVersion()].filter(Boolean));
      const all = fs.readdirSync(this.versionsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      if (all.length <= keep.size + KEEP_PREVIOUS) return;
      for (const name of all) {
        if (keep.has(name)) continue;
        fs.rmSync(path.join(this.versionsDir, name), { recursive: true, force: true });
        this.log('[assets] pruned ' + name);
      }
    } catch (err) {
      this.log('[assets] prune failed: ' + err.message);
    }
  }

  /* Everything the About window and support need to know in one call. */
  status() {
    return {
      active: this.activeVersion(),
      previous: this.previousVersion(),
      canRevert: Boolean(this.previousVersion()) || Boolean(this.activeVersion()),
      dir: this.activeDir(),
      boot: this._readBootState(),
      verifies: Boolean(this.publicKey),
    };
  }
}

module.exports = { AssetUpdater, MAX_BOOT_ATTEMPTS };
