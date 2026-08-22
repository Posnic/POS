'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = fs.readFileSync(path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'scorecard.yml'
), 'utf8');

test('publishes an official OpenSSF Scorecard from the default branch', () => {
  assert.match(WORKFLOW, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(WORKFLOW, /schedule:\s*\n\s*- cron: "30 1 \* \* 6"/);
  assert.doesNotMatch(WORKFLOW, /pull_request:/);
  assert.match(WORKFLOW, /permissions: read-all/);
  assert.match(WORKFLOW, /contents: read/);
  assert.match(WORKFLOW, /security-events: write/);
  assert.match(WORKFLOW, /id-token: write/);
  assert.match(WORKFLOW, /results_format: sarif/);
  assert.match(WORKFLOW, /publish_results: true/);
});

test('pins every Scorecard workflow action and avoids persisted checkout credentials', () => {
  assert.match(
    WORKFLOW,
    /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/
  );
  assert.match(
    WORKFLOW,
    /ossf\/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc # v2\.4\.4/
  );
  assert.match(
    WORKFLOW,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/
  );
  assert.match(
    WORKFLOW,
    /github\/codeql-action\/upload-sarif@f205ea1c3313d32999d8d6a48b4f6530d4437b38 # v4\.37\.4/
  );
  assert.match(WORKFLOW, /persist-credentials: false/);

  const actionReferences = [...WORKFLOW.matchAll(/^\s*uses:\s*([^\s]+).*$/gm)]
    .map((match) => match[1]);
  assert.equal(actionReferences.length, 4);
  for (const reference of actionReferences) {
    assert.match(reference, /@[0-9a-f]{40}$/);
  }
});
