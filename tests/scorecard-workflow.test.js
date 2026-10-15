'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'scorecard.yml'),
  'utf8',
);

const APPROVED_ACTIONS = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['ossf/scorecard-action', 'fa7117db83c52d787ae5a89f350999701505d78e'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  /* Verified upstream annotated release tags, not only PR comments:
     ossf/scorecard-action v2.5.0 tag 46dc3187a971a9febf3aeb7f94ccde489f7bb46a
       -> fa7117db83c52d787ae5a89f350999701505d78e
     github/codeql-action v4.38.3 tag cee97f86b972a3ded3c58d04148362b193ddc518
       -> 24c54180a607b1449ed407dd24f251e4e9147c8d
     Dereference each annotated tag again when updating these pins. */
  ['github/codeql-action/upload-sarif', '24c54180a607b1449ed407dd24f251e4e9147c8d'],
]);

test('Scorecard runs only on supported default-branch and scheduled triggers', () => {
  assert.match(WORKFLOW, /^on:\n  push:\n    branches: \[develop\]/m);
  assert.match(WORKFLOW, /^  schedule:\n    - cron: '[^']+'$/m);
  assert.match(WORKFLOW, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(WORKFLOW, /^  pull_request(?:_target)?:/m);
  assert.match(WORKFLOW, /if: github\.event\.repository\.private == false/);
});

test('Scorecard uses bounded permissions and the published-result contract', () => {
  assert.match(WORKFLOW, /^permissions: read-all$/m);
  for (const permission of [
    'actions: read',
    'checks: read',
    'contents: read',
    'id-token: write',
    'issues: read',
    'pull-requests: read',
    'security-events: write',
  ]) {
    assert.match(WORKFLOW, new RegExp(`^      ${permission}$`, 'm'));
  }
  assert.match(WORKFLOW, /^          persist-credentials: false$/m);
  assert.match(WORKFLOW, /^          results_file: results\.sarif$/m);
  assert.match(WORKFLOW, /^          results_format: sarif$/m);
  assert.match(WORKFLOW, /^          publish_results: true$/m);
  assert.match(WORKFLOW, /^          sarif_file: results\.sarif$/m);
});

test('every Scorecard workflow dependency is approved and commit-pinned', () => {
  const actions = [...WORKFLOW.matchAll(/^\s+uses:\s+([^@\s]+)@([^\s#]+)/gm)]
    .map((match) => ({ action: match[1], ref: match[2] }));

  assert.equal(actions.length, APPROVED_ACTIONS.size);
  for (const { action, ref } of actions) {
    assert.equal(APPROVED_ACTIONS.get(action), ref, `${action} is not pinned to the reviewed commit`);
    assert.match(ref, /^[0-9a-f]{40}$/);
  }
});

test('the publishing job contains no mutable execution extensions', () => {
  assert.doesNotMatch(WORKFLOW, /^env:/m);
  assert.doesNotMatch(WORKFLOW, /^defaults:/m);
  assert.doesNotMatch(WORKFLOW, /^    (?:container|services|env|defaults):/m);
});
