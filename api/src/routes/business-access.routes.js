'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { MongoRateLimitStore } = require('../middleware/rate-limit-store');
const { perClientKey } = require('../middleware/rate-limit-key');
const { loginLimiter } = require('../middleware/auth-rate-limit');
const { createBusinessAccess, opaque, hash, validOpaque } = require('../services/business-access');
const router = express.Router();
const PATH = '/api/business/v1';
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const jsonForHtml = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: { code: error.status ? error.code : 'server_unavailable' } });
  }
};
const limiter = (prefix, limit) =>
  rateLimit({
    store: new MongoRateLimitStore({ prefix }),
    keyGenerator: perClientKey,
    windowMs: 60_000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
  });
router.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  // Express trusts only the deployment's configured proxy. Never infer HTTPS
  // from a caller-supplied body or arbitrary forwarding header here.
  if (!req.secure) return res.status(426).json({ error: { code: 'https_required' } });
  if (!req.db) return res.status(503).json({ error: { code: 'server_unavailable' } });
  try {
    const origin = new URL('https://' + req.get('host'));
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error();
    req.businessOrigin = origin.origin;
    req.businessAccess = createBusinessAccess(req.db);
    next();
  } catch {
    res.status(400).json({ error: { code: 'invalid_origin' } });
  }
});
router.get('/discovery', (_req, res) =>
  res.json({
    product: 'posnic-business',
    apiVersion: 1,
    issuer: _req.businessOrigin,
    authorization: 'business-pkce-v1',
    audience: 'posnic-business',
    reporting: 'unavailable',
  })
);
router.post(
  '/requests',
  limiter('business-requests', 10),
  wrap(async (req, res) => {
    const result = await req.businessAccess.request(req.body || {});
    res.json({
      ...result,
      authorizationUrl: `${req.businessOrigin}${PATH}/authorize?request=${result.request}`,
    });
  })
);
router.get(
  '/authorize',
  limiter('business-consent-pages', 30),
  wrap(async (req, res) => {
    if (typeof req.query.request !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(req.query.request))
      return res.status(400).json({ error: { code: 'invalid_request' } });
    const row = await req.businessAccess.pending(req.query.request);
    if (!req.session) return res.status(503).json({ error: { code: 'server_unavailable' } });
    const csrf = opaque(),
      nonce = opaque();
    req.session.businessConsent = {
      requestHash: hash(req.query.request),
      csrf,
      expiresAt: Date.now() + 10 * 60_000,
    };
    res.set(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
    );
    res.type('html')
      .send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Posnic Business</title><style>body{margin:0;background:#f5f7f8;color:#172b37;font:16px/1.55 system-ui}main{max-width:460px;margin:5vh auto;padding:28px;border-radius:20px;background:white}h1{line-height:1.2}label{display:block;margin:18px 0 5px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:13px;border:1px solid #ccd8dd;border-radius:12px}button{margin-top:12px;background:#146b54;color:white;cursor:pointer}button.secondary{background:white;color:#146b54}button:disabled{opacity:.5}code{font-size:22px;letter-spacing:3px}p{color:#566a77}@media(max-width:520px){main{margin:16px;padding:22px}}</style><main><strong>Posnic Business</strong><h1>Connect your business</h1><p>Authorize <strong>${escape(row.deviceName)}</strong> to view the branches and business information your account permits. This connection cannot take sales.</p><p>Only continue if you started this request. Match this code with the one on your phone:</p><code>${escape(req.query.request.slice(-6).toUpperCase())}</code><form id="consent" method="post" action="${PATH}/approve"><label for="identifier">Email or username</label><input id="identifier" name="identifier" autocomplete="username" required maxlength="254" autocapitalize="none"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><button type="submit">Connect Business</button><button class="secondary" id="deny" type="button">Cancel request</button></form><p id="status" role="status" aria-live="polite">Your password stays in this browser. Posnic Business receives a separate session.</p><script nonce="${nonce}">
const form=document.getElementById('consent'),status=document.getElementById('status');
const headers={'Content-Type':'application/json'};
const globalCsrf=${jsonForHtml(res.get('X-CSRF-TOKEN') || '')};
if(globalCsrf)headers['X-XSRF-TOKEN']=globalCsrf;
async function decide(decision){
const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
try{const response=await fetch(${jsonForHtml(PATH + '/approve')},{method:'POST',credentials:'same-origin',redirect:'error',headers,body:JSON.stringify({request:${jsonForHtml(req.query.request)},csrf:${jsonForHtml(csrf)},decision,identifier:form.identifier.value,password:decision==='allow'?form.password.value:''})});
form.password.value='';
if(!response.ok){status.textContent=response.status===401?'Check your sign-in details and try again.':response.status===429?'Too many attempts. Please wait before trying again.':'This connection could not be authorized. Return to the app and start again.';return;}
form.hidden=true;status.textContent=decision==='allow'?'Connected. Return to Posnic Business.':'Request cancelled. You can close this page.';
}catch{form.password.value='';status.textContent='Unable to reach the server. Please try again.';}finally{buttons.forEach(b=>b.disabled=false);}}
form.addEventListener('submit',e=>{e.preventDefault();decide('allow');});document.getElementById('deny').addEventListener('click',()=>decide('deny'));
</script></main></html>`);
  })
);
router.post(
  '/approve',
  loginLimiter,
  wrap(async (req, res) => {
    const body = req.body || {},
      consent = req.session?.businessConsent;
    if (
      !validOpaque(body.request) ||
      !validOpaque(body.csrf) ||
      !consent ||
      consent.requestHash !== hash(body.request) ||
      consent.expiresAt <= Date.now() ||
      req.get('origin') !== req.businessOrigin ||
      !validOpaque(consent.csrf) ||
      !crypto.timingSafeEqual(Buffer.from(body.csrf), Buffer.from(consent.csrf))
    ) {
      return res.status(403).json({ error: { code: 'invalid_consent' } });
    }
    const result = await req.businessAccess.decide(
      body.request,
      body.decision,
      body.identifier,
      body.password
    );
    delete req.session.businessConsent;
    res.json(result);
  })
);
router.post(
  '/token',
  limiter('business-token', 60),
  wrap(async (req, res) => {
    res.json(await req.businessAccess.exchange(req.body?.request, req.body?.codeVerifier));
  })
);
const token = (req) =>
  /^Bearer pb1_[A-Za-z0-9_-]{43}$/.test(req.get('authorization') || '')
    ? req.get('authorization').slice(7)
    : '';
const protectBusiness = async (req, res, next) => {
  try {
    req.businessIdentity = await req.businessAccess.authenticate(token(req));
    next();
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: { code: error.status ? error.code : 'server_unavailable' } });
  }
};
router.use(protectBusiness);
router.get(
  '/context',
  wrap(async (req, res) => res.json(await req.businessAccess.contextFor(req.businessIdentity.user)))
);
router.post(
  '/session/rotate',
  wrap(async (req, res) => res.json(await req.businessAccess.rotate(token(req))))
);
router.delete(
  '/session',
  wrap(async (req, res) => res.json(await req.businessAccess.revoke(token(req))))
);
router.get(
  '/sessions',
  wrap(async (req, res) => res.json(await req.businessAccess.listSessions(token(req))))
);
router.delete(
  '/sessions/:id',
  wrap(async (req, res) => res.json(await req.businessAccess.revoke(token(req), req.params.id)))
);
module.exports = router;
