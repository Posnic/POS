'use strict';

/*
 * A deploy must not break the tabs that are already open.
 *
 * Owner: "mobile view add category shown and page broken. crashed." The
 * beacon log told the real story: no JS error at all - the page had lost
 * style/dashboard.<oldhash>.css with a 404. Ten deploys shipped that day;
 * each one ran rsync --delete on the tenant instance, so every deploy
 * deleted the bundles every already-open tab still referenced. The page
 * kept running, unstyled - which a person reads as "broken. crashed."
 *
 * Three layers, pinned together because any one alone can silently rot:
 *  1. the tenant deploy PROTECTS hashed bundles from --delete and prunes
 *     by family instead (newest 3 stay),
 *  2. the service worker answers a 404'd hashed bundle with the CURRENT
 *     build's file of the same family,
 *  3. reference-data endpoints carry HTTP cache headers (pinned api-side
 *     in settings.routes.test.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the tenant deploy keeps the last builds\' hashed bundles alive', () => {
  const wf = read('.github/workflows/deploy-frontend.yml');
  assert.match(wf, /--filter='protect public\/script\/\*\.js'/,
    'hashed js is no longer protected from rsync --delete');
  assert.match(wf, /--filter='protect public\/style\/\*\.css'/,
    'hashed css is no longer protected from rsync --delete');
  /* and the retention prune bounds the growth */
  assert.match(wf, /Prune old hashed bundles/);
  assert.match(wf, /tail -n \+4/, 'the keep-newest-3 retention changed shape');
});

test('the CDN deploy never gained --delete on its bundle pass', () => {
  const wf = read('.github/workflows/deploy-frontend-cdn.yml');
  const bundlePass = wf.slice(wf.indexOf("--include 'style/*'"));
  assert.ok(!bundlePass.includes('--delete'),
    'the CDN bundle pass deletes old hashes - open tabs break on deploy');
});

test('the service worker answers a dead hashed bundle with its current sibling', () => {
  const sw = read('frontend/sw-template.js');
  assert.match(sw, /function familyFallback\(pathname\)/);
  /* only precached families are eligible - guessing at others would serve
     wrong bytes with confidence */
  assert.match(sw, /for \(const entry of PRECACHE\)/);
  /* wired on BOTH failure paths: http error and network throw */
  const hits = sw.match(/familyFallback\(url\.pathname\)/g) || [];
  assert.ok(hits.length >= 2, 'the fallback lost one of its two failure paths');
});

test('phantom images heal themselves instead of burning the beacon budget', () => {
  /* src='' or src='undefined' resolves to the page URL and "fails" - our
     own template bug, six of which once consumed the whole per-IP beacon
     window while a real stylesheet 404 waited behind them. The watchdog
     swaps them to the placeholder pixel and keeps them out of the journal. */
  const dash = read('frontend/dashboard.html');
  const at = dash.indexOf("tagName === 'IMG'");
  assert.ok(at > -1, 'the phantom-image healer is gone');
  const block = dash.slice(at, at + 700);
  assert.match(block, /data:image\/gif;base64/);
  assert.match(block, /return;/);
  assert.match(block, /\(undefined\|null\)/);
});
