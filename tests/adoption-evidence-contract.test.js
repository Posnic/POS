'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const TEMPLATE = read('.github/ISSUE_TEMPLATE/deployment_evidence.yml');
const POLICY = read('docs/ADOPTION_EVIDENCE.md');
const README = read('README.md');
const CONTRIBUTING = read('CONTRIBUTING.md');
const ROADMAP = read('ROADMAP.md');

test('deployment evidence form captures identity, scope, failures, and limits', () => {
  for (const id of [
    'reporter_relationship',
    'relationship_details',
    'product_identity',
    'deployment_status',
    'observation_window',
    'market_scope',
    'environment',
    'workflows_observed',
    'observed_results',
    'evidence_and_method',
    'limitations',
    'citation_permission',
    'public_data_confirmation',
  ]) {
    assert.match(TEMPLATE, new RegExp(`id: ${id}\\b`), `missing issue field ${id}`);
  }

  assert.match(TEMPLATE, /Failures, workarounds, stopped trials/);
  assert.match(TEMPLATE, /required: true/g);
  assert.match(TEMPLATE, /Do not use this as marketing; keep it as a public issue only/);
  assert.match(TEMPLATE, /separate written approval is still required/i);
});

test('deployment evidence form excludes sensitive records and forced promotion', () => {
  for (const boundary of [
    'customer records',
    'card or bank data',
    'credentials',
    'tax identifiers',
    'production database files',
    'exact shop address',
  ]) {
    assert.match(TEMPLATE.toLowerCase(), new RegExp(boundary));
  }

  assert.match(TEMPLATE, /not automatically a testimonial, case study, certification, endorsement/i);
  assert.doesNotMatch(TEMPLATE, /required to give Posnic permission/i);
});

test('adoption policy preserves evidence states, corrections, and material disclosures', () => {
  for (const marker of [
    'Submitted',
    'Clarification requested',
    'Bounded public observation',
    'Case-study eligible',
    'Disputed or withdrawn',
    'No bought proof',
    'Corrections and withdrawal',
  ]) {
    assert.match(POLICY, new RegExp(marker));
  }

  assert.match(POLICY, /does not buy favorable deployment reports/i);
  assert.match(POLICY, /downloads and GitHub stars into customer counts/i);
  assert.match(POLICY, /Marketing reuse is optional and secondary/);
});

test('repository entry points link to the deployment evidence contract', () => {
  const formUrl = 'issues/new?template=deployment_evidence.yml';
  const escapedFormUrl = formUrl.replace(/[.?]/g, '\\$&');
  assert.match(README, new RegExp(escapedFormUrl));
  assert.match(CONTRIBUTING, new RegExp(escapedFormUrl));
  assert.match(README, /docs\/ADOPTION_EVIDENCE\.md/);
  assert.match(CONTRIBUTING, /docs\/ADOPTION_EVIDENCE\.md/);
  assert.match(ROADMAP, /structured deployment evidence/i);
  assert.match(ROADMAP, /not\s+customer proof/i);
});
