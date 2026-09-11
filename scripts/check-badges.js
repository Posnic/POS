#!/usr/bin/env node
/*
 * Keep the numbers on the front page true.
 *
 * README.md carries a test count, a coverage percentage and an endpoint count.
 * All three are hardcoded, all three drift, and nothing notices - the readiness
 * audit found the test badge stale and predicted, correctly, that updating it
 * by hand would only make it stale again later. A number on a public README is
 * a claim; a claim nothing checks is a claim that will eventually be wrong.
 *
 * Two different kinds of number, handled differently:
 *
 *   - The test count is a floor: "8,000+ passing". A floor can only ever be
 *     conservative, never false, so it needs updating when there is something
 *     to boast about rather than every time a test is added. This fails when
 *     reality drops below the floor, which is the case that matters.
 *
 *   - Coverage and the endpoint count are exact, because both are measured
 *     precisely by something that already runs in CI. Coverage is compared with
 *     a tolerance, since it moves by fractions on every change.
 *
 * Run with --fix to rewrite the badges instead of failing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const API_DOCS = path.join(ROOT, 'docs', 'API.md');

/* Coverage that moves by a fraction of a point on any change should not fail a
   build. A drop of more than this is a real regression worth looking at. */
const COVERAGE_TOLERANCE = 2;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const problems = [];
const notes = [];
let readme = fs.readFileSync(README, 'utf8');

/* ---- the endpoint count, against the generated documentation ---- */

const badgeEndpoints = readme.match(/REST%20API-(\d+)%20endpoints/);
const docsEndpoints = fs.readFileSync(API_DOCS, 'utf8').match(/\*\*(\d[\d,]*) endpoints/);

if (!badgeEndpoints) {
  problems.push('README has no REST API endpoint badge to check.');
} else if (!docsEndpoints) {
  problems.push('docs/API.md does not state an endpoint count.');
} else {
  const actual = Number(docsEndpoints[1].replace(/,/g, ''));
  const claimed = Number(badgeEndpoints[1]);
  if (actual !== claimed) {
    if (args.fix) {
      readme = readme.replace(
        /REST%20API-\d+%20endpoints/g,
        `REST%20API-${actual}%20endpoints`
      );
      /* The same number appears in the documentation table, and half-fixing is
         worse than not fixing - the two would disagree. */
      readme = readme.replace(
        new RegExp(`\\b${claimed} endpoints\\b`, 'g'),
        `${actual} endpoints`
      );
      notes.push(`endpoint count: ${claimed} -> ${actual}`);
    } else {
      problems.push(
        `README claims ${claimed} endpoints; docs/API.md, which is generated ` +
          `from the routes, says ${actual}.`
      );
    }
  }
}

/* ---- the test count, as a floor ---- */

const badgeTests = readme.match(/tests-([\d,%C]+?)(?:%2B)?%20passing/);
const claimedFloor = badgeTests ? Number(badgeTests[1].replace(/%2C|,/g, '')) : null;

/*
 * The badge is one number covering two suites, so it can only be judged when
 * both have been counted. Comparing the API suite alone against a combined
 * floor would fail every run for a reason that is not a problem - and a check
 * that cries wolf gets switched off.
 */
const haveBoth = args.desktop !== undefined && args.api !== undefined;

if (haveBoth) {
  const total = Number(args.desktop) + Number(args.api);
  if (claimedFloor === null) {
    problems.push('README has no test badge to check.');
  } else if (total < claimedFloor) {
    problems.push(
      `README claims ${claimedFloor.toLocaleString()}+ passing tests, but ` +
        `${total.toLocaleString()} ran (desktop ${Number(args.desktop).toLocaleString()}, ` +
        `API ${Number(args.api).toLocaleString()}). Either tests were removed or a ` +
        'suite did not run at all - the second is the one to worry about.'
    );
  } else {
    notes.push(
      `tests: ${total.toLocaleString()} passing, floor ${claimedFloor.toLocaleString()} - ok`
    );
  }
} else if (!args.fix) {
  const counted = args.api !== undefined ? `API ${Number(args.api).toLocaleString()}` : null;
  notes.push(
    `tests: floor not checked${counted ? ` (${counted} counted; needs both suites)` : ''}`
  );
}

/* ---- coverage ---- */

let coverage = args.coverage !== undefined ? Number(args.coverage) : null;

if (args['coverage-from']) {
  /* Straight out of jest's text-summary, so nobody has to retype it. */
  try {
    const summary = fs.readFileSync(args['coverage-from'], 'utf8');
    const m = summary.match(/Statements\s*:\s*([\d.]+)%/);
    if (m) coverage = Number(m[1]);
    else problems.push(`no coverage summary found in ${args['coverage-from']}`);
  } catch (e) {
    problems.push(`could not read ${args['coverage-from']}: ${e.message}`);
  }
}

const badgeCoverage = readme.match(/coverage-(\d+)%25%20statements/);
if (coverage !== null && badgeCoverage) {
  const claimed = Number(badgeCoverage[1]);
  const rounded = Math.round(coverage);
  if (Math.abs(rounded - claimed) > COVERAGE_TOLERANCE) {
    if (args.fix) {
      readme = readme.replace(/coverage-\d+%25%20statements/, `coverage-${rounded}%25%20statements`);
      notes.push(`coverage: ${claimed}% -> ${rounded}%`);
    } else {
      problems.push(
        `README claims ${claimed}% statement coverage; the suite measured ` +
          `${coverage}%. Tolerance is ${COVERAGE_TOLERANCE} points.`
      );
    }
  } else {
    notes.push(`coverage: ${coverage}% against a claim of ${claimed}% - ok`);
  }
}

/* ---- report ---- */

if (args.fix) {
  fs.writeFileSync(README, readme);
  console.log(notes.length ? `Updated README:\n  ${notes.join('\n  ')}` : 'README already correct.');
  process.exit(0);
}

for (const n of notes) console.log(`  ${n}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`::error::${p}`);
  console.error('');
  console.error('Run `npm run badges:fix` to correct them.');
  process.exit(1);
}

console.log('README numbers are current.');
