#!/usr/bin/env node
'use strict';
/*
 * The ordering pages, on this machine, reachable from a phone on the same wifi.
 *
 * Owner: "for testing give me link in local via lan. i will test and give you
 * feedback ... as soon as you modify code i need only refresh the page to see."
 *
 * The deploy loop is four minutes - commit, checks, merge, deploy - which is
 * the wrong speed for "is this animation right yet". This serves order/ and
 * menu/ straight off the working copy, so a save and a pull-to-refresh is the
 * whole round trip.
 *
 * IT PROXIES THE API RATHER THAN POINTING AT ONE. order/config.js expects the
 * API on the page's own origin, which is true everywhere the bundle really
 * runs. Pointing the page at develop.posnic.io instead would mean a cross
 * origin request, which means CORS, which means the phone quietly fails on the
 * first fetch. So everything under /api goes through here to the sandbox and
 * comes back as though it were local. Same origin, nothing to configure, and
 * the page is byte for byte the one that will be deployed.
 *
 * NOTHING IS CACHED, deliberately. A phone that holds on to yesterday's
 * script is the whole reason this exists.
 *
 *   node scripts/dev/serve-order.js            serve, proxying the sandbox
 *   node scripts/dev/serve-order.js --port 8080
 *   node scripts/dev/serve-order.js --api https://azure.posnic.io
 *
 * This is a development tool. It serves a working copy over the local network
 * with no authentication of its own; it is not for a shop floor.
 */

const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};

const PORT = Number(flag('port', 8787));
const API = String(flag('api', 'https://develop.posnic.io')).replace(/\/+$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/*
 * The deep URLs the real server answers, so a printed code works here too.
 * Same shapes as api/app.js: the store address on its own, with a table,
 * with a venue and room, or saying it is a takeaway.
 */
const STORE_ADDRESS =
  /^\/order\/[A-Za-z0-9]{3,6}(\/takeaway|\/table\/[A-Za-z0-9_-]{1,24}|\/venue\/[A-Za-z0-9]{1,12}(\/[A-Za-z0-9_-]{1,24})?)?$/;
const STORE_PAGE =
  /^\/order\/[A-Za-z0-9]{3,6}\/((?:home|products|cart|payment|thankyou|history|phonepe_status|receipt|access-denied)\.html)$/;

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    /* A phone holding yesterday's script is the whole reason this exists. */
    'Cache-Control': 'no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(body);
}

function file(res, full) {
  fs.readFile(full, (err, body) => {
    if (err) return send(res, 404, 'Not here: ' + full);
    send(res, 200, body, TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream');
  });
}

/** Everything under /api, forwarded to the sandbox and handed straight back. */
function proxy(req, res) {
  const target = new URL(API + req.url);
  const body = [];
  req.on('data', (chunk) => body.push(chunk));
  req.on('end', () => {
    const payload = Buffer.concat(body);
    const out = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: req.method,
        headers: {
          ...req.headers,
          /* The sandbox decides which shop by its own host, not ours. */
          host: target.hostname,
          origin: API,
          referer: API + '/order/',
          'accept-encoding': 'identity',
          ...(payload.length ? { 'content-length': String(payload.length) } : {}),
        },
      },
      (answer) => {
        res.writeHead(answer.statusCode || 502, {
          ...answer.headers,
          'Cache-Control': 'no-store',
        });
        answer.pipe(res);
      }
    );
    out.on('error', (e) => send(res, 502, 'The sandbox did not answer: ' + e.message));
    if (payload.length) out.write(payload);
    out.end();
  });
}

const handle = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const at = decodeURIComponent(url.pathname);

  /*
   * THE BUNDLES ARE MINE; EVERYTHING ELSE IS THE SERVER'S.
   *
   * The first cut proxied only /api, on the assumption that the page asks
   * there. It does not: order/config.js sets API_BASE_URL to the page's own
   * ORIGIN with no prefix at all, because everywhere the bundle really runs
   * the API is the same origin it came from. So the page asks for
   * /online-ordering/ABC, that fell through to the static handler, and the
   * page got "Only /order and /menu are served here" where it expected JSON -
   * which is the "product synch json error" the owner saw.
   *
   * The shop's server answers at both /api/... and the root, so the rule that
   * works is the other way round: serve the two bundles from the working copy
   * and hand everything else upstream.
   */
  const page = STORE_PAGE.exec(at);
  if (page) return file(res, path.join(ROOT, 'order', page[1]));
  if (STORE_ADDRESS.test(at)) return file(res, path.join(ROOT, 'order', 'index.html'));

  if (at === '/' || at === '/order' || at === '/order/') {
    return file(res, path.join(ROOT, 'order', 'index.html'));
  }

  /* A file in one of the two bundles: resolved, then CHECKED to be inside
     them, so a path with .. in it cannot walk out of the repository. */
  if (/^\/(order|menu)\//.test(at)) {
    const full = path.resolve(ROOT, at.replace(/^\/+/, ''));
    const allowed = [path.join(ROOT, 'order'), path.join(ROOT, 'menu')];
    if (allowed.some((dir) => full === dir || full.startsWith(dir + path.sep))) {
      return file(res, full);
    }
  }

  /* Everything else is the shop's server: the menu, the order, the voice
     line, the images the shop uploaded. */
  return proxy(req, res);
};

/*
 * THE CARD A PHONE CAN ACTUALLY REACH.
 *
 * This machine has four: minikube, two Hyper-V switches and the Wi-Fi. The
 * virtual ones have perfectly good 192.168 addresses that nothing on the
 * wifi can see, so they are skipped by name - which is the only thing that
 * distinguishes them.
 */
function lanAddress() {
  const virtual = /virtual|vethernet|hyper-v|vmware|virtualbox|loopback|minikube|docker|wsl/i;
  const real = [];
  const rest = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      (virtual.test(name) ? rest : real).push(net.address);
    }
  }
  const wifi = real.find((a) => a.startsWith('192.168')) || real[0];
  return wifi || rest.find((a) => a.startsWith('192.168')) || rest[0] || 'localhost';
}

/*
 * A certificate for this address, made in a private directory for this run.
 *
 * Self-signed, so the phone warns the first time: accept it and the page is
 * a secure context from then on. Without one the microphone button does
 * nothing at all and does not say why, because getUserMedia is refused
 * outside localhost and https.
 */
function certificate(host) {
  /* A predictable directory in the shared OS temp folder lets another local
     process pre-create or replace the key files. A private, unique directory
     gives this development-only certificate the same ownership boundary as a
     production secret without leaving a reusable path behind. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-dev-cert-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key, '-out', crt, '-days', '365',
        '-subj', '/CN=' + host,
        /* The address is in the SAN, or a phone refuses it outright rather
           than offering to continue. */
        '-addext', 'subjectAltName=IP:' + host + ',IP:127.0.0.1,DNS:localhost',
      ],
      { stdio: 'ignore' }
    );
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  } catch (e) {
    return null;
  }
}

const host = lanAddress();
const pair = certificate(host);
const server = pair ? https.createServer(pair, handle) : http.createServer(handle);
const scheme = pair ? 'https' : 'http';

server.listen(PORT, '0.0.0.0', () => {
  const at = scheme + '://' + host + ':' + PORT + '/order/ABC';
  console.log('');
  console.log('  the ordering pages, off the working copy');
  console.log('  api ...... ' + API + '  (proxied, so the page stays same-origin)');
  console.log('');
  console.log('  on your phone     ' + at);
  console.log('  talking           ' + at + '?ai=talk');
  console.log('  at a table        ' + scheme + '://' + host + ':' + PORT + '/order/ABC/table/34?ai=talk');
  console.log('  taking away       ' + scheme + '://' + host + ':' + PORT + '/order/ABC/takeaway?ai=talk');
  console.log('  seeing the words  ' + at + '?ai=talk&transcript=1');
  console.log('');
  if (pair) {
    console.log('  The certificate is self-signed, so the phone will warn once.');
    console.log('  Accept it: the microphone is refused on anything but https.');
  } else {
    console.log('  NO CERTIFICATE could be made, so this is plain http - and the');
    console.log('  microphone will NOT work on a phone, only on localhost.');
  }
  console.log('');
  console.log('  Save a file, pull to refresh. Nothing is cached.');
  console.log('');
});
