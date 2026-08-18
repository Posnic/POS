/*
 * Module-key wiring guard, strict edition (MODULE_SYSTEM_ROADMAP M5).
 *
 * The companion guard (module-toggle-persistence.test.js) checks one seam in
 * one direction: keys the client sends are keys the server persists. This one
 * starts from the server's own key list - setting.model moduleToggleMap, the
 * single shared truth - and walks every client site a key must be wired
 * through, because each miss has shipped as its own silent field bug:
 *
 *   - a key missing from a generalSettings localStorage blob builder falls
 *     back to default-ON everywhere the cached blob is read (the Cash Book
 *     bug, 11ee85f: gate read the blob, blob never carried the key);
 *   - a key missing from the updateCommonSettings payload is never saved, so
 *     a refresh restores the default (the switched-everything-off-and-back
 *     bug, ede3f1f);
 *   - a checkbox key whose control id is absent from settings_write.html is
 *     WORSE than unsaved: $('#missing').is(':checked') is false, so saving
 *     any other setting silently switches that module OFF (the d1446f8
 *     lesson - a control removed from the DOM resets its setting on save);
 *   - a key missing from _moduleToggleIds is dropped from the M4 remote
 *     branch save, so editing another branch's modules quietly skips it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SETTINGS_JS = path.join(
  __dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'
);
const SETTINGS_HTML = path.join(__dirname, '..', 'frontend', 'modules', 'settings_write.html');
const API_MODEL = path.join(__dirname, '..', 'api', 'src', 'models', 'setting.model.js');

/*
 * Keys that legitimately skip a site, each with the reason. An entry here is
 * a claim to be re-checked when the key's consumers change - not a mute.
 */
const EXEMPT = {
  pl_include_cashbook: {
    blobs: 'read server-side only (dashboard.model gates netProfit/margin); no client reads the blob for it',
  },
  till_lock_idle_minutes: {
    control: 'a number input, not a checkbox - the :checked reset failure mode does not apply',
  },
};

function mapKeys(modelSource) {
  const start = modelSource.indexOf('static moduleToggleMap()');
  assert.ok(start >= 0, 'moduleToggleMap not found in setting.model.js');
  const open = modelSource.indexOf('return {', start);
  const close = modelSource.indexOf('};', open);
  assert.ok(open > start && close > open, 'moduleToggleMap return block not found');
  const body = modelSource.slice(open, close);
  const keys = [...body.matchAll(/^\s*([a-z_]+):\s*\{ parse:/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 15, `expected the full key map, parsed ${keys.length}`);
  return keys;
}

/* Each generalSettings blob: from its `var generalSettings = {` to the
   localStorage write that closes the site. */
function blobBlocks(clientSource) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const open = clientSource.indexOf('generalSettings = {', from);
    if (open < 0) break;
    const close = clientSource.indexOf("PosnicPro.local.set('general_settings'", open);
    assert.ok(close > open, 'generalSettings block without its localStorage write');
    blocks.push(clientSource.slice(open, close));
    from = close + 1;
  }
  assert.strictEqual(blocks.length, 3, `expected the 3 known blob builders, found ${blocks.length}`);
  return blocks;
}

test('every moduleToggleMap key is wired through every client site', () => {
  const model = fs.readFileSync(API_MODEL, 'utf8');
  const client = fs.readFileSync(SETTINGS_JS, 'utf8');
  const html = fs.readFileSync(SETTINGS_HTML, 'utf8');
  const keys = mapKeys(model);

  const payloadStart = client.indexOf("'setting/updateCommonSettings'");
  assert.ok(payloadStart >= 0, 'updateCommonSettings payload not found');
  const payload = client.slice(payloadStart, client.indexOf('PosnicPro.put', payloadStart));

  const togglesStart = client.indexOf('_moduleToggleIds: [');
  assert.ok(togglesStart >= 0, '_moduleToggleIds not found');
  const toggles = client.slice(togglesStart, client.indexOf(']', togglesStart));

  const blobs = blobBlocks(client);
  const failures = [];

  for (const key of keys) {
    const exempt = EXEMPT[key] || {};

    if (!exempt.blobs) {
      blobs.forEach((blob, i) => {
        if (!blob.includes(key)) {
          failures.push(`${key}: missing from generalSettings blob builder #${i + 1} - cached reads fall back to default`);
        }
      });
    }
    if (!payload.includes(key)) {
      failures.push(`${key}: missing from the updateCommonSettings payload - never saved, refresh restores default`);
    }
    if (!exempt.control && !html.includes(`id="${key}"`)) {
      failures.push(`${key}: no id="${key}" control in settings_write.html - .is(':checked') reads false and every save silently disables it`);
    }
    if (!toggles.includes(`'${key}'`)) {
      failures.push(`${key}: missing from _moduleToggleIds - the M4 remote-branch save drops it`);
    }
  }

  assert.deepStrictEqual(failures, [], `module key wiring gaps:\n  ${failures.join('\n  ')}`);
});
