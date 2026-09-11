/*
 * Guards for the ring-ordered deploy (api/scripts/ring-reload.sh).
 *
 * The script carries rules that were each learned from a production
 * incident; this test keeps a refactor from quietly dropping one. It is
 * a string-level guard on purpose - the script runs on the tenant
 * instance against live pm2, which no CI environment reproduces.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'api', 'scripts', 'ring-reload.sh'), 'utf8');
const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'deploy-api.yml'),
  'utf8'
);

test('the script is LF-only - CRLF makes bash reject it on the server', () => {
  assert.ok(!script.includes('\r'), 'ring-reload.sh contains CR characters');
});

test('never pm2 --update-env: it wipes each tenant\'s cached PORT and MONGODB_URI', () => {
  // The header COMMENT documents the rule, so only code lines count.
  const codeLines = script.split('\n').filter((l) => !l.trim().startsWith('#'));
  assert.ok(!codeLines.some((l) => l.includes('--update-env')));
});

test('reloads one process per pm2 call - `pm2 reload a b c` acts on the first only', () => {
  assert.match(script, /pm2 reload "\$name"/);
  assert.doesNotMatch(script, /pm2 reload [^"]*\$names/);
});

test('touches only ONLINE posnic processes - reload on a stopped process STARTS it', () => {
  assert.ok(script.includes('p.pm2_env.status === "online"'));
  assert.ok(script.includes('/^posnic-(tenant|shard)-/'));
});

test('smoke runs quiet, because the Actions log is public', () => {
  assert.ok(script.includes('SMOKE_QUIET=true'));
  assert.ok(script.includes('--quiet'));
});

test('a red ring halts the deploy before later rings load the new build', () => {
  assert.match(script, /if ! smoke; then[\s\S]*?exit 1/);
  assert.ok(script.includes('later rings still run the previous build'));
});

test('shard health is verified after its reload', () => {
  assert.ok(script.includes('posnic-shard-*)'));
  assert.match(script, /::error::\$name is \$st after reload/);
});

test('a malformed rings file fails the deploy rather than deploying everything at once', () => {
  assert.ok(script.includes('rings file unreadable'));
});

test('no rings file means one ring - the single-pass deploy this replaced', () => {
  assert.ok(script.includes('out.push("ga\\t" + n)'));
});

test('the workflow delegates to the script the rsync just delivered', () => {
  assert.ok(workflow.includes('bash scripts/ring-reload.sh'));
  assert.ok(workflow.includes('npm ci --omit=dev --silent'));
});

test('the smoke never picks a SUSPENDED shop to prove the reload', () => {
  /*
   * A suspended shop is answered 403 by nginx without the request ever
   * reaching the app, so it can never return 200 and the gate waits the full
   * 120s and halts the rollout. Twenty-one shops are suspended and which one
   * sits first in tenants.map is an accident of provisioning order, so this
   * was a release outage waiting for the wrong shop to stop paying.
   */
  assert.ok(script.includes('suspended.map'),
    'the smoke picks its shop without checking whether it is suspended');
  assert.ok(/grep -vxF -f <\(grep -oE[^)]*suspended\.map/.test(script),
    'suspended shops are no longer excluded from the candidates');
});

test('more than one shop can prove the reload', () => {
  /* Betting a release on one shop means any single broken or half-provisioned
     shop halts every deploy. */
  assert.ok(/head -5/.test(script), 'the candidate list is back down to one shop');
  assert.ok(/for host in \$hosts; do/.test(script),
    'the poll no longer tries more than the first candidate');
});

test('no unsuspended shop is an error, not a 120 second wait', () => {
  assert.ok(script.includes('no unsuspended shop is routed'),
    'an empty candidate list would poll nothing until it timed out');
});

test('the smoke wait is bounded by a deadline, not by a round count', () => {
  /*
   * The poll used to be 60 rounds of one request. Trying several hosts per
   * round would multiply that by the number of candidates, so a slow reload
   * could hold the deploy far past the 120s it promises. A wall-clock
   * deadline keeps the budget the same however many hosts are tried.
   */
  assert.ok(/deadline=\$\(\( \$\(date \+%s\) \+ 120 \)\)/.test(script),
    'the smoke no longer bounds itself by wall-clock time');
  assert.ok(/while \[ "\$\(date \+%s\)" -lt "\$deadline" \]/.test(script),
    'the poll is not driven by the deadline');
});

test('host matching stays portable - grep -P is not everywhere', () => {
  /* The pattern has no PCRE-only syntax, and -E costs nothing. */
  assert.ok(!script.includes('grep -oP'), 'grep -P crept back in');
});
