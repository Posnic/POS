'use strict';
/*
 * The page a till shows so a phone can be pointed at this shop.
 *
 * Setting up a staff handset meant typing an address, and the person holding
 * the phone is usually the one who does not know it: the owner knows the shop
 * code, a waiter on their first shift does not. So the till shows a code and
 * the phone reads it. Nothing to know, nothing to type, nothing to get wrong.
 *
 * Deliberately a plain page served by the API rather than a screen in the
 * frontend. It has to work on a till that is mid-setup, on a shop's own
 * machine with no internet, and be openable by reading a URL off a support
 * call - so it depends on nothing but this process.
 *
 * Public, and safe to be: the QR carries an ADDRESS, not a credential. It
 * says where this shop is, which is the same thing the browser's URL bar
 * already says to anybody looking at the screen. Signing in still needs a
 * username and a password.
 */

const express = require('express');
const QRCode = require('qrcode');
const { localAddresses, pairingTargets, escapeHtml } = require('../utils/pairing');

const router = express.Router();

router.get('/', async (req, res) => {
  const { targets, cloud } = pairingTargets(
    {
      host: req.headers.host,
      /* No protocol. req.protocol reads `http` behind nginx unless
         `trust proxy` is on, and it is only on in production - which printed
         an http QR on every other instance. A public host is https; see
         utils/pairing.js. */
      port: process.env.PORT || 5555,
    },
    localAddresses()
  );

  const cards = await Promise.all(
    targets.map(async (target) => {
      const image = await QRCode.toDataURL(target.url, { width: 320, margin: 1 });
      return `
        <figure>
          <img src="${image}" alt="QR code for ${escapeHtml(target.url)}" width="320" height="320">
          <figcaption>
            <strong>${escapeHtml(target.label)}</strong>
            <code>${escapeHtml(target.url)}</code>
          </figcaption>
        </figure>`;
    })
  );

  const nothing = `
    <p class="warn">
      This machine has no network address a phone could reach. Connect it to the
      shop Wi-Fi or to the network, then reload this page.
    </p>`;

  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect a phone to this shop</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         margin: 0; padding: 2rem 1rem 3rem; text-align: center; color: #111827; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  p  { color: #4b5563; margin: .25rem auto 1.5rem; max-width: 34rem; }
  figure { margin: 0 0 2rem; }
  img { border: 1px solid #e5e7eb; border-radius: 12px; }
  figcaption { margin-top: .6rem; }
  code { display: block; color: #6b7280; font-size: .85rem; margin-top: .2rem; }
  .warn { color: #b45309; }
  ol { max-width: 30rem; margin: 0 auto; text-align: left; color: #4b5563; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <h1>Connect a phone to this shop</h1>
  <p>
    Open Captain on the phone, choose <strong>Scan the shop code</strong>, and
    point it at the code below.
  </p>

  ${cards.length ? cards.join('\n') : nothing}

  <div class="noprint">
    <ol>
      <li>The phone must be on the same Wi-Fi as this till${cloud ? ', or have internet' : ''}.</li>
      <li>Leave this machine switched on while staff are taking orders.</li>
      <li>Print this page and keep it by the till, so a new phone needs nothing typed.</li>
    </ol>
  </div>
</body>
</html>`);
});

module.exports = router;
