'use strict';
/*
 * WhatsApp connector core (INTEGRATIONS_ROADMAP I6).
 *
 * The logic of the sidecar that takes Chromium out of the API process: it
 * drains the shop's whatsapp_outbox through the connector lane and mirrors
 * its link state back. Everything external is injected - the API transport
 * and the WhatsApp client factory - so this file tests without a browser,
 * a phone, or whatsapp-web.js installed at all. index.js wires the real
 * pieces around it.
 *
 * The shape of the loop, deliberately boring:
 *   1. read the state mirror; start a client for any branch a screen is
 *      waiting on ('init_requested') and for any branch with claimed work;
 *   2. claim a batch; send each message on its branch's client; report
 *      every verdict, success or failure - the outbox owns retries and
 *      death, this side never re-queues on its own;
 *   3. sleep; repeat. One loop, one claim batch in flight at a time, so
 *      the CLAIM_TTL contract stays honest.
 */

const POLL_MS = 10_000;

class ConnectorCore {
  /**
   * @param {object} opts
   * @param {object} opts.api        {claim(limit), report(id, ok, error), getStates(), postState(s)}
   * @param {object} opts.wa         {create(branchId, deviceId)} -> client with
   *                                 {onQr(cb), onReady(cb), onDisconnected(cb),
   *                                  sendMessage(phone, text), destroy()}
   * @param {function} [opts.log]
   * @param {function} [opts.sleep]
   */
  constructor({ api, wa, log = () => {}, sleep } = {}) {
    this.api = api;
    this.wa = wa;
    this.log = log;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clients = new Map(); // branchId -> {client, status}
    this.running = false;
  }

  /* One client per branch, created on demand and reused. Its lifecycle
     events go straight to the state mirror - the settings screen polls
     the same shapes it always did. */
  async ensureClient(branchId, deviceId) {
    if (this.clients.has(branchId)) return this.clients.get(branchId);
    const entry = { client: null, status: 'initializing' };
    this.clients.set(branchId, entry);
    try {
      const client = this.wa.create(branchId, deviceId);
      entry.client = client;
      client.onQr(async (qr) => {
        entry.status = 'qr_ready';
        await this._postState(branchId, deviceId, 'qr_ready', qr);
      });
      client.onReady(async () => {
        entry.status = 'connected';
        await this._postState(branchId, deviceId, 'connected', null);
      });
      client.onDisconnected(async (reason) => {
        entry.status = 'disconnected';
        this.clients.delete(branchId);
        await this._postState(branchId, deviceId, 'disconnected', null);
        this.log(`[wa] branch ${branchId} disconnected: ${reason}`);
      });
      await this._postState(branchId, deviceId, 'initializing', null);
      return entry;
    } catch (err) {
      this.clients.delete(branchId);
      await this._postState(branchId, deviceId, 'error', null);
      this.log(`[wa] client for ${branchId} failed: ${err.message}`);
      return null;
    }
  }

  async _postState(branchId, deviceId, status, qr) {
    try {
      await this.api.postState({ branch_id: branchId, device_id: deviceId, status, qr });
    } catch (err) {
      this.log('[wa] state post failed: ' + err.message);
    }
  }

  /* A screen clicked Connect: the mirror says init_requested. */
  async handleInitRequests() {
    let states = [];
    try {
      states = (await this.api.getStates()) || [];
    } catch (err) {
      this.log('[wa] state read failed: ' + err.message);
      return;
    }
    for (const s of states) {
      if (s.status === 'init_requested' && s.branch_id) {
        await this.ensureClient(s.branch_id, s.device_id);
      }
    }
  }

  async drainOnce() {
    let batch = [];
    try {
      batch = (await this.api.claim(10)) || [];
    } catch (err) {
      this.log('[wa] claim failed: ' + err.message);
      return 0;
    }
    for (const row of batch) {
      let ok = false;
      let error = null;
      try {
        const entry = row.branch_id ? await this.ensureClient(row.branch_id, '') : null;
        if (!entry || !entry.client) {
          error = 'No WhatsApp client for this branch';
        } else if (entry.status !== 'connected') {
          error = 'WhatsApp is not linked (' + entry.status + ')';
        } else {
          await entry.client.sendMessage(row.phone, row.message);
          ok = true;
        }
      } catch (err) {
        error = err.message;
      }
      try {
        /* Every claimed row gets a verdict - the outbox decides retry or
           death; a connector that re-queued on its own would double-send. */
        await this.api.report(row.id, ok, error);
      } catch (err) {
        this.log('[wa] report failed for ' + row.id + ': ' + err.message);
      }
    }
    return batch.length;
  }

  async runForever() {
    this.running = true;
    this.log('[wa] connector loop starting');
    while (this.running) {
      try {
        await this.handleInitRequests();
        const n = await this.drainOnce();
        /* A full batch means more is probably waiting - go straight back. */
        if (n < 10) await this.sleep(POLL_MS);
      } catch (err) {
        this.log('[wa] loop error (contained): ' + err.message);
        await this.sleep(POLL_MS);
      }
    }
  }

  async stop() {
    this.running = false;
    for (const [branchId, entry] of this.clients) {
      try {
        if (entry.client && entry.client.destroy) await entry.client.destroy();
      } catch (e) { /* going down anyway */ }
      this.clients.delete(branchId);
    }
  }
}

module.exports = { ConnectorCore, POLL_MS };
