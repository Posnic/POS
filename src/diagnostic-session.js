'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const EVENTS = new Set(['session', 'ipc', 'renderer', 'print.request', 'print.document', 'print.rendered', 'print.submit', 'print.result', 'raw.request', 'raw.result', 'snapshot', 'remote']);
const FIELDS = new Set(['trace', 'channel', 'stage', 'status', 'code', 'message', 'durationMs', 'bytes', 'rows', 'width', 'items', 'format', 'copies', 'printer', 'jobId', 'submitted', 'retryable', 'success', 'diagnosticOnly', 'hash']);
function redact(value) {
  return String(value ?? '').slice(0, 2000)
    .replace(/(?:https?|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, '[address removed]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential removed]')
    .replace(/((?:password|passwd|token|secret|authorization|cookie|api[_-]?key|pairingCode)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[removed]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token removed]')
    .replace(/(?:[A-Z]:\\|\/Users\/|\/home\/)[^\r\n"<>]*/gi, '[local path removed]')
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '[number removed]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
function sanitize(value, depth = 0) {
  if (depth > 7) return '[depth limit]';
  if (typeof value === 'string') return redact(value);
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitize(v, depth + 1));
  if (typeof value !== 'object') return undefined;
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/password|token|secret|cookie|authorization|credential|connectionstring|uri|html|customer|sale_data|payload|audiodata|receiptcontent|pairingcode/i.test(key)) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    out[key] = sanitize(item, depth + 1);
  }
  return out;
}
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
class DiagnosticSession {
  constructor({ directory, providers = {}, build = {}, now = Date.now, request = global.fetch, baseUrl = '', snapshotTimeout = 15000 } = {}) {
    this.directory = directory; this.providers = providers; this.build = sanitize(build);
    this.now = now; this.request = request; this.baseUrl = baseUrl; this.events = []; this.snapshots = [];
    this.active = false; this.captureOnly = false; this.dropped = 0; this.remote = null; this.sequence = 0;
    this.snapshotTimeout = snapshotTimeout;
  }
  start() {
    if (this.active) return this.state();
    this.id = crypto.randomUUID(); this.startedAt = this.now(); this.expiresAt = this.startedAt + 30 * 60 * 1000;
    this.active = true; this.events = []; this.snapshots = []; this.dropped = 0; this.sequence = 0;
    this.checks = {}; this.snapshotPending = null; this.captureOnly = false; this.lastError = '';
    this.record('session', { stage: 'started' });
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => this.stop('expired'), 30 * 60 * 1000); this.expiryTimer.unref?.();
    clearInterval(this.persistTimer);
    this.persistTimer = setInterval(() => this.persist(), 5000); this.persistTimer.unref?.();
    return this.state();
  }
  record(type, data = {}) {
    if (!this.active || this.now() >= this.expiresAt || !EVENTS.has(type)) return;
    if (type === 'ipc' && data.success === true && data.channel === 'kitchen-audio:next') return;
    const fields = {};
    for (const [key, value] of Object.entries(data || {})) if (FIELDS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) {
      fields[key] = typeof value === 'string' ? redact(value).slice(0, 500) : value;
    }
    this.events.push({ sequence: ++this.sequence, at: new Date(this.now()).toISOString(), type, ...fields });
    if (this.events.length > 1000) { this.events.shift(); this.dropped++; }
  }
  state() {
    return { active: this.active, id: this.id, startedAt: this.startedAt, expiresAt: this.expiresAt,
      captureOnly: this.active && this.captureOnly, events: this.events.length, dropped: this.dropped,
      remote: this.remote ? { id: this.remote.id, connected: true, lastUpload: this.remote.lastUpload, error: this.remote.error || '', endpoint: this.baseUrl } : null,
      checking: !!this.snapshotPending, health: require('./diagnostic-health').summarize(this.checks || {}, this.events),
      uploadAvailable: !!this.baseUrl, endpoint: this.baseUrl, lastError: this.lastError || '' };
  }
  setCapture(value) {
    if (!this.active) throw Error('Start a diagnostic session first');
    this.captureOnly = value === true; this.record('session', { stage: this.captureOnly ? 'capture-only-on' : 'capture-only-off' });
    return this.state();
  }
  holdPrint() { return this.active && this.now() < this.expiresAt && this.captureOnly; }
  async snapshot() {
    if (!this.active) throw Error('Start a diagnostic session first');
    if (this.snapshotPending) return this.snapshotPending;
    const sessionId = this.id;
    this.checks = {};
    const pending = (async () => {
      const parts = {};
      await Promise.all(Object.entries(this.providers).map(async ([name, read]) => {
        let timer;
        const started = this.now();
        try {
          const data = await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Snapshot timed out')), this.snapshotTimeout); })]);
          parts[name] = { status: 'ok', durationMs: this.now() - started, data: sanitize(data) };
          if (Buffer.byteLength(JSON.stringify(parts[name])) > 30000) parts[name] = { status: 'truncated', message: 'Provider exceeded 30 KB report budget' };
        } catch (error) { parts[name] = { status: 'error', durationMs: this.now() - started, message: redact(error.message) }; }
        finally { clearTimeout(timer); if (this.id === sessionId && this.active) this.checks[name] = parts[name]; }
      }));
      if (this.id === sessionId && this.active) {
        this.snapshots.push({ at: new Date(this.now()).toISOString(), parts });
        this.snapshots = this.snapshots.slice(-5); this.record('snapshot', { status: 'complete' }); this.persist();
      }
      return parts;
    })().finally(() => { if (this.snapshotPending === pending) this.snapshotPending = null; });
    this.snapshotPending = pending;
    return this.snapshotPending;
  }
  report() {
    const failures = this.events.filter(e => e.success === false || e.status === 'error');
    const report = { schemaVersion: 1, sessionId: this.id, generatedAt: new Date(this.now()).toISOString(),
      startedAt: this.startedAt, expiresAt: this.expiresAt, build: this.build, active: this.active,
      privacy: 'Structured events only; no raw log files, database records, receipt content, audio or screenshots.',
      summary: { eventCount: this.events.length, droppedEvents: this.dropped, failureCount: failures.length,
        lastFailure: failures.at(-1) || null, health: require('./diagnostic-health').summarize(this.checks || {}, this.events), physicalPrinting: 'not verified' },
      snapshots: [...this.snapshots], events: [...this.events] };
    let reportBytes = Buffer.byteLength(JSON.stringify(report));
    while (reportBytes > 890000) {
      if (report.snapshots.length) reportBytes -= Buffer.byteLength(JSON.stringify(report.snapshots.shift()));
      else if (report.events.length) reportBytes -= Buffer.byteLength(JSON.stringify(report.events.shift()));
      else break;
    }
    report.summary.omittedForSize = this.events.length - report.events.length + this.snapshots.length - report.snapshots.length;
    return report;
  }
  persist() {
    if (!this.directory || !this.id) return;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const file = path.join(this.directory, 'last-report.json');
      fs.writeFileSync(file + '.next', JSON.stringify(this.report(), null, 2), { mode: 0o600 });
      fs.renameSync(file + '.next', file);
    } catch (error) { this.lastError = 'Could not save local report: ' + redact(error.message); }
  }
  export(file) {
    const report = this.id ? this.report() : this.previous();
    if (!report) throw Error('No diagnostic report yet');
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(report, null, 2))), { mode: 0o600 });
  }
  previous() {
    try {
      const file = path.join(this.directory, 'last-report.json');
      if (fs.statSync(file).size > 2 * 1024 * 1024) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { return null; }
  }
  async call(route, body, token) {
    const url = new URL(this.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Support endpoint must be an HTTPS origin');
    const response = await this.request(new URL(route, url), { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body || {}), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { const error = Error('Support server returned HTTP ' + response.status); error.status = response.status; throw error; }
    let text = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
          if (size > 100000) { await reader.cancel(); throw Error('Support response is too large'); } chunks.push(Buffer.from(value)); }
        text = Buffer.concat(chunks).toString('utf8');
      } finally { reader.releaseLock(); }
    } else text = await response.text();
    if (text.length > 100000) throw Error('Support response is too large');
    return JSON.parse(text);
  }
  async connect(pairingCode, consent) {
    if (!this.active || consent !== true) throw Error('Start recording and approve remote diagnostics first');
    if (this.remote || this.connectPending) throw Error('Already connected or connecting');
    pairingCode = typeof pairingCode === 'string' ? pairingCode.trim() : '';
    if (!/^[a-f0-9]{64}$/.test(pairingCode) && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/.test(pairingCode))
      throw Error('The support code is incomplete or incorrectly copied. In Intranet Support diagnostics, create a new pairing code and use Copy full code. Paste the entire code.');
    this.connectPending = true;
    const localId = this.id;
    try {
      let response;
      try { response = await this.call('/api/diagnostics/connect', { localSessionId: localId, build: this.build }, pairingCode); }
      catch (error) {
        if (error.status === 401) throw Error('This support code has expired, was already used, or is not valid. Create a new pairing code in Intranet Support diagnostics. Codes expire after 15 minutes and can be used once.');
        throw error;
      }
      if (!/^[a-f0-9-]{36}$/.test(response.id) || !/^[a-f0-9]{64}$/.test(response.token)) throw Error('Invalid support session');
      if (!this.active || this.id !== localId) { await this.call('/api/diagnostics/' + response.id + '/close', {}, response.token).catch(() => {}); return; }
      this.remote = { id: response.id, token: response.token, generation: crypto.randomUUID() };
      this.record('remote', { stage: 'connected' });
      try { await this.upload(); }
      catch (error) { if (this.remote) this.remote.error = redact(error.message); throw error; }
      finally { this.schedule(10000); }
      return this.state();
    } finally { this.connectPending = false; }
  }
  async upload() {
    if (!this.active || !this.remote) throw Error('No approved remote session');
    const remote = this.remote;
    await this.call('/api/diagnostics/' + remote.id + '/report', { report: this.report() }, remote.token);
    if (this.remote === remote) { remote.lastUpload = new Date(this.now()).toISOString(); remote.error = ''; }
  }
  schedule(delay) {
    clearTimeout(this.pollTimer);
    if (!this.active || !this.remote) return;
    this.pollTimer = setTimeout(() => this.poll(), delay); this.pollTimer.unref?.();
  }
  async poll() {
    if (!this.active || !this.remote) return;
    const remote = this.remote;
    let delay = 10000;
    try {
      const response = await this.call('/api/diagnostics/' + remote.id + '/poll', { ack: remote.ack || null }, remote.token);
      if (this.remote !== remote || !this.active) return;
      if (response.closed) { this.stop('support-ended'); return; }
      const command = response.command;
      if (command && command.id !== remote.ack) {
        if (command.type === 'stop') { this.stop('support-ended'); return; }
        if (command.type === 'snapshot') await this.snapshot();
        if (['snapshot', 'upload'].includes(command.type) && this.remote === remote && this.active) await this.upload();
        remote.ack = command.id;
        this.record('remote', { stage: 'command', status: ['snapshot', 'upload'].includes(command.type) ? 'complete' : 'rejected' });
      }
      if (this.remote === remote && this.active && (!remote.lastUpload || this.now() - Date.parse(remote.lastUpload) >= 60000)) {
        await this.snapshot();
        if (this.remote === remote && this.active) await this.upload();
      }
      remote.error = '';
    } catch (error) {
      if (this.remote === remote && error.status === 401) { this.stop('support-revoked'); return; }
      if (this.remote === remote) remote.error = redact(error.message); delay = 60000;
    }
    if (this.remote === remote) this.schedule(delay);
  }
  stop(reason = 'customer-stopped') {
    this.record('session', { stage: reason }); this.active = false; this.captureOnly = false;
    clearTimeout(this.expiryTimer); clearTimeout(this.pollTimer); clearInterval(this.persistTimer);
    const remote = this.remote; this.remote = null;
    if (remote) this.call('/api/diagnostics/' + remote.id + '/close', {}, remote.token).catch(() => {});
    this.persist(); return this.state();
  }
}
let current;
module.exports = { DiagnosticSession, redact, sanitize, hash, EVENTS, set: value => { current = value; },
  record: (type, data) => { try { current?.record(type, data); } catch (_) {} },
  holdPrint: () => current?.holdPrint() === true, get: () => current };
