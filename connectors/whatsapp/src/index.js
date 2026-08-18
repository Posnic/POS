'use strict';
/*
 * WhatsApp connector bootstrap - the signed sidecar the I5 runtime spawns.
 *
 * Everything real lives here and nothing testable does: the HTTP calls to
 * the connector lane (Bearer = the scoped token the shop minted), and the
 * whatsapp-web.js client factory whose LocalAuth sessions live in
 * CONNECTOR_DATA_DIR - which the supervisor keeps OUTSIDE the versioned
 * directory, so a connector update never costs the shop its WhatsApp login.
 * The loop itself is core.js, tested without any of this.
 */

const path = require('path');
const { ConnectorCore } = require('./core');

const API = (process.env.LOCAL_API_URL || 'http://127.0.0.1:5555').replace(/\/+$/, '');
const TOKEN = process.env.CONNECTOR_TOKEN || '';
const DATA_DIR = process.env.CONNECTOR_DATA_DIR || path.join(__dirname, '..', '.data');

async function call(method, route, body) {
  const res = await fetch(API + '/api' + route, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(route + ' -> HTTP ' + res.status);
  const data = await res.json();
  if (data && data.type === 'error') throw new Error(route + ' -> ' + data.message);
  return data && data.data;
}

const api = {
  claim: (limit) => call('POST', '/connector/whatsapp/claim', { limit }),
  report: (id, ok, error) => call('POST', '/connector/whatsapp/result', { id, ok, error }),
  getStates: () => call('GET', '/connector/whatsapp/state'),
  postState: (s) => call('POST', '/connector/whatsapp/state', s),
};

const wa = {
  create(branchId, deviceId) {
    /* Lazy so the module loads without the dependency tree (tests, and a
       bundle whose install is still finishing). */
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const key = String(branchId).replace(/[^A-Za-z0-9_-]/g, '');
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: key, dataPath: path.join(DATA_DIR, '.wwebjs_auth') }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });
    const wrapped = {
      onQr: (cb) => client.on('qr', cb),
      onReady: (cb) => client.on('ready', cb),
      onDisconnected: (cb) => client.on('disconnected', cb),
      sendMessage: async (phone, text) => {
        const chatId = String(phone).includes('@c.us') ? String(phone) : String(phone) + '@c.us';
        await client.sendMessage(chatId, text);
      },
      destroy: () => client.destroy(),
    };
    client.initialize().catch((e) => console.error('[wa] initialize failed:', e.message));
    return wrapped;
  },
};

const core = new ConnectorCore({ api, wa, log: (m) => console.log(m) });

process.on('SIGTERM', () => core.stop().then(() => process.exit(0)));
process.on('SIGINT', () => core.stop().then(() => process.exit(0)));

core.runForever().catch((e) => {
  console.error('[wa] fatal:', e.message);
  process.exit(1);
});
