'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { cloudServerUrl } = require('./cloud-activation');
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

// The verifier, authorization code and device token never enter the renderer.
class BrowserCloudAuth {
  constructor({ openExternal, fetch: request = globalThis.fetch, website = 'https://www.posnic.com', timeoutMs = 15 * 60_000 }) {
    this.openExternal = openExternal;
    this.request = request;
    this.website = cloudServerUrl(website);
    this.timeoutMs = timeoutMs;
  }

  cancel() {
    if (this.active) this.active.finish(new Error('Authorization cancelled. You can try again.'));
  }

  async reopen() {
    if (!this.active || !this.active.url) throw new Error('Start browser sign-in first.');
    await this.openExternal(this.active.url);
  }

  authorize({ intent = 'login', machineId, deviceName }) {
    if (this.active) return Promise.reject(new Error('Browser authorization is already in progress.'));
    if (!['login', 'signup'].includes(intent)) return Promise.reject(new Error('Invalid authorization choice.'));
    return new Promise((resolve, reject) => {
      const state = crypto.randomBytes(32).toString('base64url');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const controller = new AbortController();
      let settled = false;
      let exchanging = false;
      let redirectUri;
      const server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        let url;
        try { url = new URL(req.url, redirectUri); }
        catch { res.writeHead(400); res.end('Invalid authorization response.'); return; }
        if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host
            || url.pathname !== '/posnic-authorized' || url.searchParams.get('state') !== state
            || exchanging || settled) {
          res.writeHead(400); res.end('This authorization response is not valid.'); return;
        }
        if (url.searchParams.get('error')) {
          res.end('Connection cancelled. Return to Posnic Desktop.');
          finish(new Error('You cancelled the connection in your browser.')); return;
        }
        const code = url.searchParams.get('code');
        if (!opaque(code)) { res.writeHead(400); res.end('Invalid authorization code.'); return; }
        exchanging = true;
        try {
          const response = await this.request(`${this.website}/api/desktop/token`, {
            method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code, codeVerifier, redirectUri }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Authorization failed. Please start again.');
          res.end('Computer authorized. Return to Posnic Desktop to finish downloading your shop.');
          finish(null, result);
        } catch (error) {
          res.writeHead(502); res.end('The connection could not finish. Return to Posnic Desktop and retry.');
          finish(error);
        }
      });
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.abort();
        server.close();
        if (this.active === active) this.active = null;
        if (error) reject(error); else resolve(result);
      };
      const active = { finish, url: null };
      this.active = active;
      const timer = setTimeout(() => finish(new Error('Browser authorization expired. Please start again.')), this.timeoutMs);
      server.on('error', () => finish(new Error('Could not open the secure return connection. Please retry.')));
      server.listen(0, '127.0.0.1', async () => {
        if (settled) { server.close(); return; }
        redirectUri = `http://127.0.0.1:${server.address().port}/posnic-authorized`;
        try {
          const response = await this.request(`${this.website}/api/desktop/requests`, {
            method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ intent, machineId, deviceName, redirectUri, state, codeChallenge }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          });
          if (!response.ok) throw new Error('Browser sign-in is unavailable. Check your internet connection or use a pairing code.');
          const result = await response.json();
          const url = new URL(result.authorizationUrl);
          if (url.origin !== new URL(this.website).origin || url.pathname !== '/api/desktop/authorize'
              || url.username || url.password || url.hash || !opaque(url.searchParams.get('request'))
              || [...url.searchParams.keys()].length !== 1) throw new Error('The authorization address could not be verified.');
          if (settled) return;
          active.url = url.href;
          await this.openExternal(active.url);
        } catch (error) { finish(error); }
      });
    });
  }
}

module.exports = { BrowserCloudAuth };
