'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LABELS = { waiting: 'Waiting', offline: 'Printer offline', queued: 'Queued', sent: 'Sent to printer', failed: 'Failed' };
const idFor = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readiness(health, binding = {}) {
  if (String(health.port).includes(',')) return 'Printer pooling is not supported; choose a single port';
  if (binding.port && binding.port.toLowerCase() !== String(health.port).toLowerCase()) return 'Printer port changed; check configuration';
  if (binding.pnpId && String(health.pnpId).toLowerCase() !== binding.pnpId.toLowerCase()) return 'Printer device changed; check configuration';
  if (health.discovery === 'port-mismatch') return 'Configured USB device belongs to a different port; check configuration';
  if (health.discovery === 'stale-binding') return 'Saved USB device is absent; a different device is on this port. Check the physical printer and binding';
  if (health.discovery === 'ambiguous') return 'Multiple connected USB printers match this port; check printer configuration';
  if (health.discovery === 'error') return 'USB discovery failed; waiting to check again';
  if (health.usb && health.present === false) return 'Printer disconnected';
  if (health.usb && health.present !== true) return 'USB device could not be identified; configure its PnP instance ID';
  if (health.workOffline || health.printerStatus === 7 || health.extendedStatus === 7) return 'Printer offline';
  if ([1, 2].includes(health.printerStatus) || !health.printerStatus) return 'Printer status unknown';
  if (health.printerStatus === 6 || health.detectedError > 2 || [8, 9, 11, 12, 13, 14, 16].includes(health.extendedStatus)) return 'Printer error; check paper and printer';
  if (health.jobs.some(job => job.error)) return 'Windows queue contains a failed job; check printer';
  return '';
}

class WindowsPrintQueue {
  constructor({ dir, transport, now = Date.now, wait = sleep, delays = [2000, 5000, 10000], onStatus = () => {}, configured = () => null }) {
    this.dir = dir;
    this.transport = transport;
    this.now = now;
    this.wait = wait;
    this.delays = delays;
    this.onStatus = onStatus;
    this.configured = configured;
    this.running = new Map();
    this.live = new Set();
    this.health = new Map();
    this.jobs = new Map();
    this.stopped = false;
    fs.mkdirSync(dir, { recursive: true });
    this.bindings = this.read('bindings.json', {});
    this.keepAlive = this.read('keep-alive.json', {});
    this.activity = new Map();
    // Corrupt state must fail closed. It must never turn into a new submission.
    for (const name of fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const job = this.read(name);
      if (!job || name !== job.id + '.json') throw new Error('Unreadable printer recovery state: ' + name);
      this.migrateIdentityFailure(job);
      this.jobs.set(job.id, job);
    }
  }

  migrateIdentityFailure(job) {
    // Only the exact old pre-submission failure is safe to recover. A spooler
    // job may have vanished before polling, so absence is NOT replay evidence.
    if (job.state !== 'failed' || job.submitted !== false || job.accepted || job.observed || job.spoolerId ||
        job.reason !== 'USB device could not be identified; configure its PnP instance ID' ||
        !fs.existsSync(path.join(this.dir, job.id + '.bin'))) return;
    job.reconnect = true; job.retries = 0; job.nextAt = 0;
    job.state = 'waiting'; job.reason = 'Checking USB printer identity again';
    this.write(job.id + '.json', job);
    this.log({ jobId: job.id, printer: job.printer, event: 'recover-legacy-identity-failure' });
  }

  canRecover(job) {
    return !!job && job.state === 'failed' && job.submitted === false &&
      !job.accepted && !job.observed && !job.spoolerId && !this.live.has(job.id) &&
      (job.nonSubmissionVerified === true ||
       job.reason === 'Printer initialization failed; check Windows queue' ||
       /^Print helper unavailable:/.test(job.reason || '')) &&
      fs.existsSync(path.join(this.dir, job.id + '.bin'));
  }

  async recoverUnsubmitted(id) {
    const job = this.jobs.get(id);
    if (!this.canRecover(job)) return { success: false, error: 'Recovery refused: non-submission is not verified' };
    // Retain identity and frozen destination. Never create a replacement copy.
    job.retries = 0; job.nextAt = 0; job.reconnect = false;
    job.nonSubmissionVerified = true;
    delete job.wakeDocument; delete job.wakeStartedAt;
    this.log({ event: 'operator-recover-unsubmitted', jobId: id, printer: job.printer });
    this.transition(job, 'waiting', 'Retry requested: receipt was not submitted');
    this.start();
    await this.run(job.printer);
    return this.result(job);
  }

  helperFailure(job, result) {
    job.submitted = false;
    job.nonSubmissionVerified = true;
    const error = result.error || 'Print helper startup failed';
    return this.defer(job, error, job.retries < this.delays.length);
  }

  read(file, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
  }

  write(file, value) {
    const target = path.join(this.dir, file);
    const temporary = target + '.tmp';
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  }

  log(event) {
    // Bounded diagnostic metadata only: never receipt contents/customer data.
    try {
      const file = path.join(this.dir, 'health.log');
      let size = 0;
      try { size = fs.statSync(file).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (size > 1024 * 1024) {
        for (let i = 2; i >= 1; i--) {
          const older = file + '.' + i;
          try { fs.renameSync(older, file + '.' + (i + 1)); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, JSON.stringify({ at: new Date(this.now()).toISOString(), ...event }) + '\n');
    } catch (_) { /* Diagnostic failure must not resubmit a receipt. */ }
  }

  result(job) {
    return { success: job.state === 'sent', pending: ['waiting', 'offline', 'queued'].includes(job.state),
      jobId: job.id, spoolerJobId: job.spoolerId, status: LABELS[job.state],
      error: job.state === 'sent' ? undefined : job.reason || LABELS[job.state], printer: job.printer };
  }

  transition(job, state, reason = '') {
    const changed = job.state !== state || job.reason !== reason;
    job.state = state; job.reason = reason; job.updatedAt = this.now();
    this.write(job.id + '.json', job);
    if (changed) {
      this.log({ jobId: job.id, printer: job.printer, port: job.binding.port, pnpId: job.binding.pnpId,
        spoolerJobId: job.spoolerId, retry: job.retries, state, reason });
      try { this.onStatus(this.result(job)); } catch (_) { /* UI can close at any time. */ }
    }
    if (state === 'sent') {
      this.activity.set(job.printer.toLowerCase(), this.now());
      try { fs.unlinkSync(path.join(this.dir, job.id + '.bin')); } catch (_) { /* no payload required after completion */ }
    }
    return this.result(job);
  }

  configure(printer, binding) {
    if (typeof printer !== 'string' || !printer.trim() || printer.length > 256) throw new Error('Choose a printer queue');
    const port = String(binding.port || '').trim();
    const pnpId = String(binding.pnpId || '').trim();
    if (port.length > 128 || pnpId.length > 512 || /[\r\n\0]/.test(port + pnpId + printer)) throw new Error('Invalid printer binding');
    if (pnpId && !/^USB(?:PRINT)?\\/i.test(pnpId)) throw new Error('Use the physical USB or USBPRINT instance ID');
    this.bindings[printer.toLowerCase()] = { port, pnpId, initialize: binding.initialize !== false,
      keepAlive: binding.keepAlive !== false };
    this.write('bindings.json', this.bindings);
    // Existing jobs retain their frozen destinations; configuration only
    // affects new requests. There is no automatic port reassignment.
  }

  async snapshot(printer, binding) {
    const health = await this.transport.inspect(printer, binding);
    const key = printer.toLowerCase();
    const serial = JSON.stringify(health);
    if (this.health.get(key)?.serial !== serial) this.log({ printer, port: health.port,
      pnpId: health.pnpId, present: health.present, discovery: health.discovery, candidateCount: health.candidateCount,
      discoveryError: health.discoveryError, workOffline: health.workOffline,
      printerStatus: health.printerStatus, extendedStatus: health.extendedStatus,
      jobs: health.jobs.map(item => ({ id: item.id, status: item.status })) });
    this.health.set(key, { serial, value: health });
    return health;
  }

  enqueue({ printer, bytes, jobId, binding }) {
    if (jobId !== undefined && (typeof jobId !== 'string' || !jobId || jobId.length > 1024)) return Promise.resolve({ success: false, status: 'Failed', error: 'Invalid print job ID' });
    if (!printer || !Buffer.isBuffer(bytes) || !bytes.length) return Promise.resolve({ success: false, status: 'Failed', error: 'Choose a printer and a non-empty receipt' });
    const id = idFor(jobId || crypto.randomUUID());
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid job storage ID');
    const existing = this.jobs.get(id);
    if (existing) {
      if (existing.printer.toLowerCase() !== printer.toLowerCase()) return Promise.resolve({ success: false, status: 'Failed', error: 'Job ID belongs to another printer' });
      this.migrateIdentityFailure(existing);
      this.start();
      return this.run(printer).then(() => this.result(existing));
    }
    const frozen = { ...(this.bindings[printer.toLowerCase()] || {}), ...binding };
    const payload = frozen.initialize === false ? bytes : Buffer.concat([Buffer.from([0x1b, 0x40]), bytes]);
    // ESC @ has no feed or cut. It is part of the SAME spool job, never a
    // separate blank-page job. Existing formatting/cut bytes are untouched.
    const fd = fs.openSync(path.join(this.dir, id + '.bin'), 'wx', 0o600);
    try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const job = { id, printer, document: 'Posnic-' + id, binding: frozen, state: 'waiting',
      retries: 0, createdAt: this.now(), submitted: false, nextAt: 0 };
    this.write(id + '.json', job);
    this.jobs.set(id, job);
    this.start();
    return this.run(printer).then(() => this.result(job));
  }

  defer(job, reason, transient = true) {
    if (!transient || job.retries >= this.delays.length) {
      job.reconnect = transient;
      return this.transition(job, 'failed', reason + (transient ? '; retry limit reached, waiting for reconnect' : ''));
    }
    job.nextAt = this.now() + this.delays[job.retries++];
    return this.transition(job, 'offline', reason);
  }

  async step(job) {
    if (job.state === 'sent') return;
    if (!job.submitted && job.state !== 'failed' && job.nextAt > this.now()) return;
    if (job.state === 'failed' && !job.reconnect && !job.submitted) return;
    let health;
    try { health = await this.snapshot(job.printer, job.binding); }
    catch (error) {
      if (job.submitted) return this.transition(job, 'queued', 'Cannot read Windows queue: ' + error.message);
      return this.defer(job, 'Cannot read Windows queue: ' + error.message);
    }
    let reason = readiness(health, job.binding);
    if (!job.binding.port && health.port) {
      job.binding.port = health.port;
      job.binding.pnpId = health.pnpId || '';
      this.write(job.id + '.json', job);
      if (!this.bindings[job.printer.toLowerCase()]) {
        this.bindings[job.printer.toLowerCase()] = { ...job.binding };
        this.write('bindings.json', this.bindings);
      }
    }
    if (!reason && health.present === true && !job.binding.pnpId && health.pnpId) {
      job.binding.pnpId = health.pnpId;
      this.write(job.id + '.json', job);
      const saved = this.bindings[job.printer.toLowerCase()];
      if (saved && !saved.pnpId && saved.port === job.binding.port) {
        saved.pnpId = health.pnpId; this.write('bindings.json', this.bindings);
      }
    }
    if (health.present === true && health.workOffline && !/changed/.test(reason) && job.nextAt <= this.now()) {
      try {
        await this.transport.recover(job.printer, job.binding);
        await this.wait(300);
        health = await this.snapshot(job.printer, job.binding);
        reason = readiness(health, job.binding);
      } catch (error) {
        if (job.submitted) return this.transition(job, 'offline', 'Cannot bring printer online: ' + error.message);
        return this.defer(job, 'Cannot bring printer online: ' + error.message, false);
      }
    }
    // Resolve original submissions BEFORE considering a retry. Document names
    // and numeric IDs must both match: Windows can recycle its numeric IDs.
    if (job.submitted) {
      const original = health.jobs.find(item => item.document === job.document && (!job.spoolerId || item.id === job.spoolerId));
      if (original) {
        job.spoolerId = original.id;
        job.lastJobError = !!original.error;
        job.observed = true;
        this.live.add(job.id);
        return this.transition(job, original.error || reason ? 'offline' : 'queued', original.error ? 'Windows job: ' + original.status : reason);
      }
      if (job.accepted && this.live.has(job.id) && !job.lastJobError && !reason) return this.transition(job, 'sent');
      return this.transition(job, 'failed', 'Print outcome unknown; check the printer before requesting a duplicate');
    }
    // An idle initialization must finish before a receipt is submitted.
    const pulse = this.keepAlive[job.printer.toLowerCase()];
    if (pulse?.pending && this.pulsePending(pulse, health)) {
      if (this.now() - pulse.at < 30000) return this.transition(job, 'waiting', pulse.status);
      // Do not bypass an actual failed Windows job: readiness still applies.
      // Optional ESC @ traffic alone cannot permanently starve real receipts.
      pulse.pending = false; pulse.suppressed = true;
      this.write('keep-alive.json', this.keepAlive);
    }
    if (job.state === 'failed') {
      if (!job.reconnect || reason) return;
      job.reconnect = false; job.retries = 0; job.nextAt = 0;
    }
    if (job.nextAt > this.now()) return;
    const canWake = !reason || (health.present === true && reason === 'Printer offline');
    if (canWake && job.binding.initialize !== false && this.transport.initialize) {
      if (!job.wakeDocument) {
        job.wakeDocument = 'Posnic-initialize-' + job.id;
        job.wakeStartedAt = this.now();
        this.write(job.id + '.json', job);
        let wake;
        try { wake = await this.transport.initialize({ printer: job.printer,
          file: path.join(this.dir, 'initialize-' + job.id + '.bin'), document: job.wakeDocument }); }
        catch (error) { wake = { success: false, error: error.message }; }
        if (!wake.success) {
          // Only initialization bytes were attempted; receipt payload never crossed stdin.
          job.nonSubmissionVerified = true;
          if (wake.submission === 'not-submitted' || wake.unavailable) {
            delete job.wakeDocument; delete job.wakeStartedAt;
            return this.helperFailure(job, wake);
          }
          return this.defer(job, 'Optional printer initialization outcome uncertain: ' + (wake.error || 'No answer'), false);
        }
        await this.wait(300);
        health = await this.snapshot(job.printer, job.binding);
        reason = readiness(health, job.binding);
        if (reason) return this.defer(job, reason);
      }
      if (health.jobs.some(item => item.document === job.wakeDocument)) {
        if (job.wakeStartedAt == null) { job.wakeStartedAt = this.now(); this.write(job.id + '.json', job); }
        if (this.now() - job.wakeStartedAt < 30000) return this.transition(job, 'waiting', 'Waiting for printer initialization');
        // Receipt already contains ESC @ in the same job; no new wake is sent.
      }
    }
    if (reason) return this.defer(job, reason, /offline|disconnected|Printer error|failed job|USB discovery failed|could not be identified|Multiple connected USB|Saved USB device is absent|Printer status unknown/i.test(reason));
    // Persist BEFORE crossing the spooler boundary. A crash in the following
    // call is ambiguous, not permission to submit a second copy.
    job.nonSubmissionVerified = false;
    job.submitted = true;
    this.activity.set(job.printer.toLowerCase(), this.now());
    this.transition(job, 'queued');
    let result;
    try { result = await this.transport.submit({ printer: job.printer, document: job.document, file: path.join(this.dir, job.id + '.bin') }); }
    catch (error) { result = { success: false, error: error.message }; }
    if ((result.submission === 'not-submitted' || result.unavailable) && !result.spoolerJobId) {
      // The resident helper guarantees unavailable only BEFORE writing stdin.
      return this.helperFailure(job, result);
    }
    job.spoolerId = result.spoolerJobId || null;
    job.accepted = !!result.success;
    this.live.add(job.id);
    this.transition(job, 'queued', result.success ? '' : 'Submission outcome uncertain: ' + (result.error || 'No answer'));
    await this.wait(300);
    return this.step(job);
  }

  run(printer, idle = false) {
    const key = printer.toLowerCase();
    // Chain callers rather than sharing a promise: a receipt arriving during
    // an idle probe must run after it, not be left waiting for another tick.
    const previous = this.running.get(key) || Promise.resolve();
    const promise = previous.catch(() => {}).then(async () => {
      if (this.stopped) return;
      for (const job of this.jobs.values()) {
        if (this.stopped || job.printer.toLowerCase() !== key || job.state === 'sent') continue;
        await this.step(job);
        if (['waiting', 'offline', 'queued'].includes(job.state)) return;
      }
      if (idle && ![...this.jobs.values()].some(job => job.printer.toLowerCase() === key && job.state !== 'sent')) {
        await this.idle(printer, this.bindings[key]);
      }
    }).finally(() => { if (this.running.get(key) === promise) this.running.delete(key); });
    this.running.set(key, promise);
    return promise;
  }

  pulsePending(pulse, health) {
    const original = health.jobs.find(job => job.document === pulse.document);
    if (original) {
      pulse.observed = true;
      pulse.spoolerId = original.id;
      pulse.status = 'Waiting for idle keep-alive: Windows ' + original.status;
    } else if (pulse.accepted || pulse.observed) {
      pulse.pending = false;
      pulse.status = 'Idle keep-alive left Windows queue';
    } else {
      pulse.status = 'Idle keep-alive outcome unknown; check Windows queue before printing';
    }
    this.write('keep-alive.json', this.keepAlive);
    return pulse.pending;
  }

  async idle(printer, binding = {}) {
    const key = printer.toLowerCase();
    let health = await this.snapshot(printer, binding);
    if (!this.activity.has(key) || health.jobs.length || health.printerStatus !== 3) this.activity.set(key, this.now());
    if (!binding.port && health.port) {
      Object.assign(binding, { port: health.port, pnpId: health.pnpId || '' });
      this.write('bindings.json', this.bindings);
    }
    let reason = readiness(health, binding);
    if (health.usb && health.present === true && health.workOffline && reason === 'Printer offline') {
      await this.transport.recover(printer, binding);
      await this.wait(300);
      health = await this.snapshot(printer, binding);
      reason = readiness(health, binding);
    }
    const prior = this.keepAlive[key];
    if (prior?.suppressed) return;
    if (prior?.pending && this.pulsePending(prior, health)) return;
    // ESC @ resets the print buffer. Only send after a quiet period, an empty
    // spooler and explicitly Idle status, never between queued receipt jobs.
    if (binding.keepAlive === false || binding.initialize === false || !this.transport.initialize ||
        !health.usb || health.present !== true || reason || health.jobs.length ||
        health.printerStatus !== 3 || ![2, 3].includes(health.extendedStatus)) return;
    // Never add an app idle writer alongside the diagnostic helper. Failure
    // to audit suppresses optional idle traffic, not actual receipt delivery.
    if (this.transport.systemSettings) {
      try { if ((await this.transport.systemSettings()).externalKeepAlive !== false) return; }
      catch (_) { return; }
    }
    const last = Math.max(prior?.at || 0, this.activity.get(key) || 0);
    if (this.now() - last < 30000) return;
    const pulse = this.keepAlive[key] = { printer, at: this.now(), pending: true,
      document: 'Posnic-idle-' + crypto.randomUUID(), status: 'Idle keep-alive queued' };
    // Persist before submitting. Unknown outcomes block subsequent pulses,
    // including after restart; never accumulate wake jobs behind an outage.
    this.write('keep-alive.json', this.keepAlive);
    let result;
    try {
      result = await this.transport.initialize({ printer, document: pulse.document,
        file: path.join(this.dir, 'idle-' + idFor(key) + '.bin') });
    } catch (error) { result = { success: false, error: error.message }; }
    pulse.accepted = !!result.success;
    pulse.spoolerId = result.spoolerJobId || null;
    if (result.unavailable) pulse.pending = false; // helper never received it
    pulse.status = result.success ? 'Idle keep-alive accepted by Windows' : 'Idle keep-alive failed: ' + (result.error || 'No answer');
    this.write('keep-alive.json', this.keepAlive);
    this.log({ printer, port: health.port, pnpId: health.pnpId, present: health.present,
      event: 'idle-keep-alive', spoolerJobId: pulse.spoolerId, status: pulse.status });
    await this.wait(300);
    health = await this.snapshot(printer, binding);
    if (pulse.pending) this.pulsePending(pulse, health);
  }

  async tick() {
    const configured = this.configured();
    const idleNames = configured && new Set(configured.map(value => String(value).toLowerCase()));
    for (const printer of configured || []) {
      const key = String(printer).toLowerCase();
      if (key && key !== 'default' && !this.bindings[key]) this.bindings[key] = {};
    }
    for (const job of this.jobs.values()) this.migrateIdentityFailure(job);
    const names = new Set([...this.jobs.values()].filter(job => job.state !== 'sent' &&
      (job.state !== 'failed' || job.reconnect || job.submitted)).map(job => job.printer));
    for (const name of names) await this.run(name);
    // Idle traffic uses the same per-printer lock as receipts and KOTs.
    for (const name of Object.keys(this.bindings)) {
      if ([...names].some(value => value.toLowerCase() === name)) continue;
      if (idleNames && !idleNames.has(name)) continue;
      try {
        await this.run(name, true);
      } catch (error) { this.log({ printer: name, error: error.message }); }
    }
  }

  start() {
    if (this.timer || this.stopped) return;
    const poll = async () => {
      try { await this.tick(); } catch (error) { this.log({ error: error.message }); }
      const active = [...this.jobs.values()].some(job => ['waiting', 'offline', 'queued'].includes(job.state));
      if (!this.stopped) { this.timer = setTimeout(poll, active ? 2000 : 15000); this.timer.unref?.(); }
    };
    this.timer = setTimeout(poll, 2000); this.timer.unref?.();
  }

  stop() { this.stopped = true; clearTimeout(this.timer); this.timer = null; }
  list() { return [...this.jobs.values()].slice(-200).map(job => ({ ...this.result(job), port: job.binding.port, retries: job.retries, canRecover: this.canRecover(job) })); }
}

module.exports = { WindowsPrintQueue, readiness, idFor };
