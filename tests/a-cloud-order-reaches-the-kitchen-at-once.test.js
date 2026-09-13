'use strict';

/*
 * An order placed through the cloud reaches the kitchen the moment it lands.
 *
 * Owner: "prints are very slow. as soon receive order it needs to print. not
 * polling or something not good... if app connected to server then it might be
 * another delay of db sync."
 *
 * That reading was right, and this is the last of the three delays.
 *
 * A captain handset off the shop Wi-Fi, or a customer's phone, writes its order
 * into the tenant's CLOUD database. Nothing on this machine can find it until
 * the sync agent pulls it down, so reading the local database directly returns
 * nothing, faster. Measured before this change:
 *
 *   15 s   the realtime sync lane pulls the row down
 *   30 s   the kitchen printer's fallback poll finds it
 *   ---
 *   ~45 s  worst case, AND SILENT, because the chime listens for an event only
 *          a sale rung up on this machine emits
 *
 * The second half is now zero. The agent names the collection each pull filled,
 * and an order becomes the same two events a counter sale raises, so the
 * printer and the speaker are reached the way they always have been.
 *
 * THE LINE IS A CONTRACT with Posnic/Gateway, which ships and updates on its
 * own cycle. Its side is pinned by tests/the-till-hears-what-was-pulled.test.js
 * there. An agent too old to say the line is not broken by this: the fallback
 * poll underneath is exactly what it always was.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

/* The manager runs in the Electron main process. */
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { Notification: class { show() {} } };
  return load.call(this, request, ...rest);
};
const SyncAgentManager = require(path.join(ROOT, 'src', 'sync-agent-manager.js'));
Module._load = load;

const SRC = fs.readFileSync(path.join(ROOT, 'src', 'sync-agent-manager.js'), 'utf8');

/** Feed lines to a manager and collect the events it raises on the bus. */
function heard(lines) {
  const events = [];
  const onKot = (p) => events.push(['kot', p]);
  const onAttention = (p) => events.push(['attention', p]);
  process.on('posnic:kot-created', onKot);
  process.on('posnic:order-attention', onAttention);

  const manager = new SyncAgentManager({ app: { getPath: () => ROOT } });
  try {
    for (const line of lines) manager._trackSyncState(line);
  } finally {
    process.off('posnic:kot-created', onKot);
    process.off('posnic:order-attention', onAttention);
  }
  return events;
}

test('an order pulled from the cloud reaches the printer at once', () => {
  const events = heard(['[agent] pulled 1 into sales']);
  const kot = events.filter(([k]) => k === 'kot');
  assert.strictEqual(kot.length, 1, 'the printer was not told, so it waits for its own poll');
  assert.strictEqual(kot[0][1].reason, 'synced',
    'a synced order looks like a local one in the log, which makes a slow shop hard to read');
});

test('and it makes a noise, which it never did before', () => {
  /* The whole point of the chime is that nobody is looking at the screen. An
     order that arrives from the cloud is the case where that is most true. */
  const events = heard(['[agent] pulled 2 into sales']);
  const chimes = events.filter(([k]) => k === 'attention');
  assert.strictEqual(chimes.length, 1);
  assert.strictEqual(chimes[0][1].alert, 'received',
    'the agent cannot tell an approval hold from a normal order; the quieter sound is the safe one');
});

test('pulling anything else stays quiet', () => {
  /* A batch lane cycle pulls customers, items, categories and suppliers on a
     sixty second timer. Chiming for those would go off all day in an empty
     shop and staff would learn to ignore the sound that matters. */
  const events = heard([
    '[agent] pulled 40 into items',
    '[agent] pulled 7 into customers',
    '[agent] pulled 3 into recycle_bin',
  ]);
  assert.deepStrictEqual(events, []);
});

test('a pull of nothing is not an order', () => {
  assert.deepStrictEqual(heard(['[agent] pulled 0 into sales']), []);
});

test('ordinary agent chatter raises nothing', () => {
  assert.deepStrictEqual(heard([
    '[agent] realtime: pushed 0, pulled 0',
    '[agent] critical lane every 2s',
    '[agent] purge_branch abc deferred - unsynced records still uploading',
  ]), []);
});

test('several collections in one chunk are all read, not just the first', () => {
  /*
   * Node hands over whatever arrived on the pipe, which on a busy cycle is
   * several lines at once. Every reader here was written as though a chunk
   * were a line. A substring test survives that by accident; a regex does not,
   * and would have read only the first collection of a three-collection pull.
   */
  assert.match(SRC, /for \(const line of String\(d\)\.split\(\/\\r\?\\n\/\)\)/,
    'a multi-line chunk is still handled as one line');

  const chunk = '[agent] pulled 12 into items\n[agent] pulled 1 into sales\n';
  const events = heard(chunk.split('\n').filter(Boolean));
  assert.strictEqual(events.filter(([k]) => k === 'kot').length, 1,
    'the order behind another collection in the same chunk was missed');
});

test('the online and offline notice still works off the cycle summary', () => {
  /* Adding a reader must not disturb the one that was already there. */
  const manager = new SyncAgentManager({ app: { getPath: () => ROOT } });
  const said = [];
  manager._notify = (title) => said.push(title);

  manager._trackSyncState('[agent] realtime cycle failed: connect ETIMEDOUT');
  manager._trackSyncState('[agent] realtime: pushed 3, pulled 1');

  assert.deepStrictEqual(said, ['Posnic Cloud sync is offline', 'Posnic Cloud sync restored']);
});

test('an agent too old to say the line breaks nothing', () => {
  /* The agent ships separately and updates on its own cycle, so a shop can be
     running either version for a while. The older one simply never triggers
     this, and the fallback poll underneath is untouched. */
  const events = heard(['[agent] realtime: pushed 0, pulled 4']);
  assert.deepStrictEqual(events, [], 'a cycle total was mistaken for an order arriving');

  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.match(kot, /const KOT_FALLBACK_POLL_MS = 30000;/,
    'the fallback poll was removed; an old agent would leave the kitchen with nothing');
});

test('the announcer is in the packaged build', () => {
  /* build.files is an allowlist. A module missing from it throws "Cannot find
     module" on a customer's counter and nowhere else. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/sync-agent-manager.js'));
});
