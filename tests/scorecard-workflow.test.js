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
  ['ossf/scorecard-action', '2d1146689b8cda280b9bc96326124645441f03bc'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  /* v4.37.9. Verified against upstream before approving: the annotated tag
     v4.37.9 in github/codeql-action dereferences to this commit. That check is
     the entire point of this map, so do it again for the next bump rather than
     trusting the trailing comment in the workflow. */
  ['github/codeql-action/upload-sarif', 'cdf488f595d80d6e07e03d4674febd5ab45fa938'],
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
