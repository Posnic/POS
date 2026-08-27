/**
 * Essae weighing scale over TCP/IP.
 *
 * Ported from the implementation used on a real SI-810 (Posnic/desktop), kept
 * behaviour-for-behaviour because it is proven against the device: the polling
 * commands, the two frame shapes, the two-reading average and the reconnect
 * loop all match. What is new here is that every value is configurable rather
 * than baked in, with the previously hard-coded values as defaults.
 *
 * Frames the scale answers with:
 *   extended  0x22 0x03 <len16> ... <float32LE net weight kg>
 *   simple    0x66 <2 bytes> <uint16LE grams>
 *
 * Serial (RS-232) scales are handled separately by scale-parser.js.
 */
const net = require('net');
const { BrowserWindow } = require('electron');

const CMD_SIMPLE = Buffer.from([0x11, 0x01, 0x00, 0x00, 0xEE, 0xFF]);
const CMD_EXT = Buffer.from([0x33, 0x02, 0x01, 0x00, 0xCA, 0xFF, 0x25, 0xDB, 0xFF]);

const DEFAULTS = {
  ip: '192.168.0.103',
  port: 4321,
  debug: false,
  pollIntervalMs: 30,     // gap between poll cycles
  readTimeoutMs: 350,     // how long to wait for a frame
  reconnectDelayMs: 2000,
  historySize: 5,
  minChangeKg: 0.0001,    // ignore jitter smaller than this
};

class EssaeWeightReader {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.running = false;
    this.socket = null;
    this.weightHistory = [];
    this.lastReported = null;
    this.reconnectTimer = null;
    this.mainWindow = null;
    this.lastError = null;
  }

  /** Apply new settings; reconnects if running so changes take effect at once. */
  configure(options = {}) {
    const wasRunning = this.running;
    if (wasRunning) this.stop();
    this.config = { ...this.config, ...options };
    if (wasRunning) this.start();
    return this.config;
  }

  getConfig() { return { ...this.config }; }

  setMainWindow(window) { this.mainWindow = window; }

  isConnected() { return this.socket !== null && !this.socket.destroyed; }

  status() {
    return {
      running: this.running,
      connected: this.isConnected(),
      lastWeight: this.lastReported,
      lastError: this.lastError,
      config: this.getConfig(),
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastError = null;
    this._connect();
  }

  stop() {
    this.running = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    this.weightHistory = [];
  }

  _log(...args) { if (this.config.debug) console.log('[EssaeScale]', ...args); }

  _connect() {
    if (!this.running) return;
    this._log(`connecting to ${this.config.ip}:${this.config.port}`);

    this.socket = new net.Socket();
    this.socket.setNoDelay(true);

    this.socket.on('error', (err) => {
      this.lastError = err.message;
      this._log('socket error:', err.message);
    });

    this.socket.on('close', () => {
      if (!this.running) return;
      this._log('connection closed, retrying');
      this._scheduleReconnect();
    });

    this.socket.connect(this.config.port, this.config.ip, () => {
      this.lastError = null;
      this._log('connected');
      this._pollLoop();
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || !this.running) return;
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.config.reconnectDelayMs);
  }

  async _pollLoop() {
    while (this.running && this.isConnected()) {
      try {
        await this._pollWeight();
        await this._sleep(this.config.pollIntervalMs);
      } catch (err) {
        this.lastError = err.message;
        this._log('poll failed:', err.message);
        this._scheduleReconnect();
        return;
      }
    }
  }

  async _pollWeight() {
    if (!this.isConnected()) return;

    // Ask for both frame types; the scale answers with whichever it supports.
    this.socket.write(CMD_SIMPLE);
    await this._sleep(this.config.pollIntervalMs);
    let data = (await this._readWithTimeout(this.config.readTimeoutMs)) || Buffer.alloc(0);

    this.socket.write(CMD_EXT);
    await this._sleep(50);
    const extData = await this._readWithTimeout(this.config.readTimeoutMs);
    if (extData) data = Buffer.concat([data, extData]);

    if (!data.length) return;
    this._log('raw:', data.toString('hex').slice(0, 80));

    const extFrame = this._extendedFrame(data);
    if (extFrame && extFrame.length >= 4) {
      try {
        this._processWeight(Math.round(extFrame.readFloatLE(0) * 1000) / 1000);
        return;
      } catch (err) { this._log('extended parse failed:', err.message); }
    }

    const simple = this._parseSimple66(data);
    if (simple !== null) { this._processWeight(simple); return; }

    this._log('no known frame in:', data.slice(0, 40).toString('hex'));
  }

  _readWithTimeout(timeoutMs) {
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) return resolve(null);
      let data = Buffer.alloc(0);
      const onData = (chunk) => { data = Buffer.concat([data, chunk]); };
      this.socket.on('data', onData);
      setTimeout(() => {
        if (this.socket) this.socket.removeListener('data', onData);
        resolve(data.length ? data : null);
      }, timeoutMs);
    });
  }

  _extendedFrame(data) {
    const idx = data.indexOf(Buffer.from([0x22, 0x03]));
    if (idx < 0 || data.length < idx + 6) return null;
    const length = data[idx + 2] + (data[idx + 3] << 8);
    const end = idx + 6 + length + 2;
    return data.length >= end ? data.slice(idx + 6, end - 2) : null;
  }

  _parseSimple66(data) {
    const idx = data.indexOf(0x66);
    if (idx < 0 || data.length < idx + 6) return null;
    try {
      const grams = data.slice(idx, idx + 6).readUInt16LE(2);
      return Math.round((grams / 1000) * 1000) / 1000;
    } catch { return null; }
  }

  _processWeight(kg) {
    if (!Number.isFinite(kg)) return;
    this.weightHistory.push(kg);
    if (this.weightHistory.length > this.config.historySize) this.weightHistory.shift();

    // Average of the last two readings: the device jitters by a gram or two
    // and billing should not chase that.
    const n = this.weightHistory.length;
    const value = n >= 2
      ? Math.round(((this.weightHistory[n - 1] + this.weightHistory[n - 2]) / 2) * 1000) / 1000
      : Math.round(kg * 1000) / 1000;

    if (this.lastReported !== null && Math.abs(value - this.lastReported) < this.config.minChangeKg) return;
    this.lastReported = value;
    this._broadcast(value);
  }

  _broadcast(weight) {
    // Same channel and shape the serial scale uses, so the sales screen does
    // not care which kind of scale the shop has.
    const payload = {
      raw: `Essae ${weight} kg`,
      weight,
      stable: true,           // the device reports settled values
      source: 'essae-tcp',
      timestamp: new Date().toISOString(),
      isValid: true,
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try { win.webContents.send('usb-data', payload); }
      catch (err) { this._log('broadcast failed:', err.message); }
    }
  }

  _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
}

module.exports = { EssaeWeightReader, ESSAE_DEFAULTS: DEFAULTS };
