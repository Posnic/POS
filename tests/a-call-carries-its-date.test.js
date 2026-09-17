'use strict';

/*
 * A table's call reaches the till, and the answer reaches the table.
 *
 * "A table can call somebody over" (7a0aac6e) wrote the call into whichever
 * database the ordering page was talking to - the cloud's - and marked the
 * collection synced. Two things stood between that row and the till's request
 * dock, and neither was visible from the feature's own tests:
 *
 *   NO LANE. The sync agent had no entry for waitercalls and the gateway
 *   accepted none. Built in Posnic/Gateway ("A call reaches the till"); the
 *   packaging guard in scripts/prepare-sync-agent.js is what noticed, by
 *   refusing a build on 2026-09-17.
 *
 *   NO DATE. The row was a native insert with no updated_date. The agent
 *   finds its work with { updated_date: { $exists: true } } and the gateway
 *   sends a till only rows whose updated_date moved. A lane would have
 *   carried nothing. Same trap as the settings save (#838), same family as
 *   the handset module nothing required: written, tested, read by nobody.
 *
 * Both writes are pinned here, because the second one is the one that gets
 * lost: marking a call seen at the till must move updated_date too, or the
 * cloud never learns the call was answered and the ordering page keeps
 * telling the customer "already calling".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPO = fs.readFileSync(path.join(ROOT, 'api', 'src', 'repositories', 'sale.repository.js'), 'utf8');
const DECISIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'src', 'sync', 'collections.json'), 'utf8'));

/** The source of one method, by name, so an assertion cannot match a neighbour. */
function methodSource(name) {
  const at = REPO.indexOf('async ' + name + '(');
  assert.ok(at > 0, name + ' is not in sale.repository.js');
  const next = REPO.indexOf(String.fromCharCode(10) + '  async ', at + 1);
  return REPO.slice(at, next > 0 ? next : undefined);
}

test('a new call carries created_date and updated_date', () => {
  const src = methodSource('callWaiter');
  assert.ok(src.includes('called_at: at,'), 'the call is no longer stamped with when it was made');
  assert.ok(src.includes('created_date: at,'), 'a call has no created_date');
  assert.ok(src.includes('updated_date: at,'), 'a call has no updated_date, so it never leaves the cloud');
});

test('answering a call moves updated_date, so the cloud learns it was answered', () => {
  const src = methodSource('seeWaiterCall');
  const set = src.slice(src.indexOf('$set:'), src.indexOf('}', src.indexOf('$set:')) + 1);
  assert.ok(set.includes('seen_at: new Date()'), 'seen no longer stamps seen_at');
  assert.ok(set.includes('updated_date: new Date()'), 'seen does not move updated_date; the answer never syncs back');
});

test('waitercalls is a synced, branch-scoped collection again', () => {
  /*
   * It was moved to undecided (#851) when the guard found the promise had no
   * lane behind it. With the lane built, the promise is true again - and the
   * guard keeps checking, against the agent actually bundled.
   */
  assert.strictEqual(DECISIONS.synced.waitercalls, 'branch');
  assert.ok(!(DECISIONS.undecided && DECISIONS.undecided.waitercalls), 'still listed as undecided');
});
