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
