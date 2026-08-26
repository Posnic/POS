/*
 * PRIVACY.md tells shops the application has no analytics library and no crash
 * reporter, and calls that verifiable rather than a promise. This is what makes
 * it verifiable.
 *
 * It was not always true. Twelve frontend pages carried a loader that read
 * localStorage 'posnic_monitoring' and, if it held a config, injected Google
 * Tag Manager and Sentry from their CDNs. Nothing in the product ever wrote
 * that key, so it never ran - but it shipped in the installer, and the API's
 * Content-Security-Policy allowlisted exactly those hosts to let it work. A
 * switch that needs one localStorage write is not "no analytics", whatever the
 * default is.
 *
 * Both are gone. This fails if either comes back, in source or in the generated
 * public/ copies that are what actually ship.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Hosts that exist to receive information about how software is being used.
// Not a general blocklist: cdnjs serves print.js and is legitimately allowed.
const TELEMETRY_HOSTS = [
  'googletagmanager.com',
  'google-analytics.com',
  'sentry-cdn.com',
  'sentry.io',
  'mixpanel.com',
  'segment.com',
  'amplitude.com',
  'posthog.com',
  'bugsnag.com',
  'fullstory.com',
  'hotjar.com',
];

function htmlFiles() {
  const dirs = [
    path.join(ROOT, 'frontend'),
    path.join(ROOT, 'frontend', 'public'),
    ROOT,
  ];
  const found = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.html')) found.push(path.join(dir, name));
    }
  }
  return found;
}

test('no shipped page loads an analytics or error-reporting script', () => {
  const offenders = [];
  for (const file of htmlFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const host of TELEMETRY_HOSTS) {
      if (text.includes(host)) {
        offenders.push(`${path.relative(ROOT, file)} references ${host}`);
      }
    }
    if (text.includes('posnic_monitoring')) {
      offenders.push(
        `${path.relative(ROOT, file)} still has the posnic_monitoring loader`,
      );
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'PRIVACY.md says there is no analytics library. These say otherwise:\n  ' +
      offenders.join('\n  '),
  );
});

test('the BASE content-security-policy does not allow a telemetry host', () => {
  const app = fs.readFileSync(path.join(ROOT, 'api', 'app.js'), 'utf8');

  /*
   * The contract evolved with the owner's Google Analytics FEATURE
   * (2026-08-27, "make it as feature. on / off with entering GA value"):
   * an opt-in toggle whose id belongs to the shop. The promise this pin
   * guards is unchanged where it matters - the policy an UNCONFIGURED
   * shop serves must never name a telemetry host. The Google domains may
   * appear ONLY inside the gaCspDirectives variant, which the server
   * serves exclusively while the shop's own toggle is on, and the
   * dispatch between the two must exist.
   */
  const gaStart = app.indexOf('const gaCspDirectives');
  assert.ok(gaStart !== -1, 'the GA CSP variant vanished - did the feature move?');
  const gaEnd = app.indexOf('};', gaStart) + 2;
  const outsideGaBlock = app.slice(0, gaStart) + app.slice(gaEnd);

  const directives = outsideGaBlock
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  const allowed = TELEMETRY_HOSTS.filter((host) => directives.includes(host));
  assert.deepStrictEqual(
    allowed,
    [],
    `The base CSP (or anything outside gaCspDirectives) allowlists ${allowed.join(', ')}. ` +
      'Only the opt-in GA variant may name Google, and only inside its own block.',
  );

  /* the dispatch that keeps the base policy the default */
  assert.match(app, /a\.enabled \? helmetGa : helmetBase/);
});

test('no analytics or crash-reporting package is a dependency', () => {
  const suspicious = /^(@sentry\/|@bugsnag\/|mixpanel|analytics-node|posthog-|amplitude-|@amplitude\/|electron-google-analytics|universal-analytics)/;

  for (const rel of ['package.json', 'api/package.json', 'frontend/package.json']) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const names = Object.keys(pkg.dependencies || {});
    const hits = names.filter((n) => suspicious.test(n));
    assert.deepStrictEqual(hits, [], `${rel} depends on ${hits.join(', ')}`);
  }
});

test("Electron's crash reporter is never started", () => {
  const mainProcess = ['main.js', 'preload.js', 'update-service.js', 'hardware-manager.js'];
  for (const rel of mainProcess) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      !/crashReporter\s*\.\s*start/.test(text),
      `${rel} starts Electron's crash reporter; PRIVACY.md says it is not enabled`,
    );
  }
});
