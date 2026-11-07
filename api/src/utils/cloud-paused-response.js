'use strict';

// Public recovery guidance only: never embed tenant data, tokens or return URLs.
// API callers must still receive a machine-readable denial, not an HTML login page.
function sendCloudPaused(req, res, tenant) {
  const trialEnded = tenant.suspendedReason === 'Free trial ended';
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  const browserPage =
    (req.method === 'GET' || req.method === 'HEAD') &&
    String(req.headers.accept || '').includes('text/html') &&
    !/^\/(?:api|users)(?:\/|\?|$)/i.test(req.url || '/');
  if (!browserPage) {
    res.writeHead(403, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
      error: 'account_suspended',
      reason: trialEnded ? 'trial_ended' : 'account_suspended',
    }));
    return;
  }
  const title = trialEnded ? 'Your cloud trial has ended' : 'Cloud access is paused';
  res.writeHead(403, {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Posnic</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#172b4d;font:16px/1.6 system-ui,sans-serif}main{max-width:850px;margin:6vh auto;padding:32px;background:white;border:1px solid #dbe2ec;border-radius:16px}h1{font-size:30px;line-height:1.25}h2{font-size:19px}p{color:#52637a}.brand{font-size:25px;font-weight:750;color:#0068df}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{padding:20px;border:1px solid #dbe2ec;border-radius:10px}a{color:#0068df}.action{display:inline-block;margin:8px 8px 8px 0;padding:10px 17px;border:1px solid #0068df;border-radius:7px;text-decoration:none}.primary{background:#0068df;color:white}.note{background:#f4f6fa;padding:16px;border-radius:8px}@media(max-width:600px){main{margin:16px;padding:22px}.grid{grid-template-columns:1fr}h1{font-size:25px}}</style></head>
<body><main><div class="brand">Posnic</div><h1>${title}</h1>
<p>${trialEnded ? 'Cloud sync and online access are paused. You can keep using an existing local shop in Posnic Desktop.' : 'Please contact support to check your account status. Installing the desktop app does not remove an account restriction.'}</p>
<div class="grid"><section class="card"><h2>Already using Posnic Desktop?</h2><p>Open the app on the computer where your shop data was downloaded. Continue local sales, receipts, stock and local backups in Community mode.</p><a class="action primary" href="posnic://open">Open Posnic Desktop</a><p>If the app does not open, launch Posnic from your Start menu. Keep this computer and its backups safe while cloud sync is paused.</p></section>
<section class="card"><h2>Installing on a new computer?</h2><p>Installing Posnic alone will not recover your cloud shop. Restore a local backup, or restore cloud access before downloading your shop. You can also create a separate offline shop.</p><a class="action" href="https://www.posnic.com/download.html">Download Posnic</a></section></div>
<h2>Restore cloud access</h2><p>${trialEnded ? 'Choose a cloud plan for your existing account. Sync can resume after payment is verified and access is restored.' : 'Contact support before purchasing a plan so we can confirm what is required to restore access.'}</p>
${trialEnded ? '<a class="action primary" href="https://www.posnic.com/pricing.html">View cloud plans</a>' : ''}<a class="action" href="mailto:info@posnic.com">Contact support</a>
<p class="note">Local use requires an existing downloaded shop or a restored backup. Keep your existing shop and device connection; do not create a replacement account to renew.</p></main></body></html>`);
}

module.exports = { sendCloudPaused };
