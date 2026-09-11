/*
 * Which address a staff phone is told to use.
 *
 * The whole substance of the pairing page is this decision, and getting it
 * wrong is not visible on the till: the page renders a perfectly good QR code
 * for an address the phone cannot reach, and the failure surfaces minutes
 * later on somebody else's handset as "cannot find the shop".
 *
 * A till opened locally sees `localhost:5555` in its own address bar. Putting
 * that on the code points the phone at ITSELF, which is the specific mistake
 * these tests exist to prevent.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

/* The pure decision, not the route: no express, no qrcode, no server. */
const { pairingTargets, localAddresses } = require(
  path.join(__dirname, '..', 'api', 'src', 'utils', 'pairing.js'));

const LOCAL = [
  { name: 'Wi-Fi', address: '192.168.1.5' },
  { name: 'Ethernet', address: '10.0.0.7' },
];

test('a cloud shop is told its own public address', () => {
  const { targets, cloud } = pairingTargets(
    { host: 'demo.posnic.io', protocol: 'https', port: 5555 }, LOCAL);

  assert.equal(cloud, true);
  assert.equal(targets.length, 1);
  /* The public address, not a LAN one: it keeps working from anywhere, which
     is the point of a cloud shop. */
  assert.equal(targets[0].url, 'https://demo.posnic.io/api');
});

test('a till never puts localhost on the code', () => {
  /* A phone pointed at localhost is pointed at itself. This is the failure
     the page exists to prevent, and it looks fine on the till. */
  for (const host of ['localhost:5555', '127.0.0.1:5555']) {
    const { targets, cloud } = pairingTargets({ host, protocol: 'http', port: 5555 }, LOCAL);
    assert.equal(cloud, false);
    assert.ok(targets.length > 0, `no address offered for ${host}`);
    for (const target of targets) {
      assert.doesNotMatch(target.url, /localhost|127\.0\.0\.1/,
        `${host} produced an address a phone cannot reach: ${target.url}`);
    }
  }
});

test('a till offers every address a phone might reach it on', () => {
  const { targets } = pairingTargets({ host: 'localhost:5555', protocol: 'http', port: 5555 }, LOCAL);
  const urls = targets.map((t) => t.url);
  assert.deepEqual(urls, [
    'http://192.168.1.5:5555/api',
    'http://10.0.0.7:5555/api',
  ]);
  /* Labelled by interface, because a till with two cards gives two codes and
     somebody has to know which is the Wi-Fi. */
  assert.match(targets[0].label, /Wi-Fi/);
});

test('the address carries the /api prefix the app expects', () => {
  const { targets } = pairingTargets({ host: 'shop.example', protocol: 'https', port: 5555 }, LOCAL);
  assert.ok(targets[0].url.endsWith('/api'),
    'without /api the phone would scan an address that serves the web UI, not the API');
});

test('a machine with no network says so rather than offering nothing', () => {
  const { targets, cloud } = pairingTargets({ host: 'localhost:5555', protocol: 'http', port: 5555 }, []);
  assert.equal(cloud, false);
  assert.deepEqual(targets, [],
    'an empty list is what the page turns into an explanation; it must not invent an address');
});

test('the non-default port is carried through', () => {
  /* A shop running two tills moves one off 5555, and a code with the wrong
     port fails in a way nobody connects to the port. */
  const { targets } = pairingTargets({ host: 'localhost:6001', protocol: 'http', port: 6001 }, LOCAL);
  assert.equal(targets[0].url, 'http://192.168.1.5:6001/api');
});

test('the real interfaces are readable and never include a loopback', () => {
  const found = localAddresses();
  assert.ok(Array.isArray(found));
  for (const entry of found) {
    assert.doesNotMatch(entry.address, /^127\./, 'a loopback address is useless to a phone');
    assert.match(entry.address, /^\d{1,3}(\.\d{1,3}){3}$/);
  }
});

test('the page is reachable without a credential', () => {
  /* It carries an address, not a secret - the same thing the till's own
     address bar shows anyone standing at it. Requiring a login would mean a
     device cannot be paired until somebody signs in on the till, which is
     backwards. */
  const fs = require('node:fs');
  const app = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  const mountedAt = app.indexOf("require('./src/routes/pair.routes')");
  assert.ok(mountedAt > -1, 'the pairing page is not mounted');

  const limiterAt = app.indexOf("app.use('/api', limiter)");
  assert.ok(mountedAt < limiterAt,
    'a page a shop reloads while setting up handsets must not be rate limited');
});
