/** Serial scale text decoder. Tagged units take precedence over configured units. */
const FACTOR = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };
function parseFrame(frame, options = {}) {
  const raw = String(frame).replace(/[\x00-\x1f]/g, ' ').trim();
  if (!raw || /\b(?:OL|OVER|OVERLOAD|ERR|ERROR)\b/i.test(raw)) return null;
  // Never interpret a decimal comma as a thousands/unit suffix, or a count,
  // percentage or unsupported mass unit as the configured weight unit.
  if (/\d,\d/.test(raw) && options.decimalSeparator !== ',') return null;
  if (/%|\b(?:pcs|pieces|count|mg|ct|dwt|ozt)\b/i.test(raw)) return null;
  let status = /\bUS\b/i.test(raw) ? false : /\bST\b/i.test(raw) ? true : undefined;
  if (options.protocol === 'sics') {
    const header = raw.match(/^S\s+([SD])\s+/);
    if (!header) return null;
    status = header[1] === 'S';
  }
  if (options.protocol === 'and' && !/^(ST|US)[,\s]/.test(raw)) return null;
  let text = raw.replace(/_/g, ' ').replace(/\b(ST|US|GS|NT|TR|W)\b[,:]?/gi, ' ');
  if (options.decimalSeparator === ',') text = text.replace(/(\d),(?=\d)/g, '$1.');
  const number = '[+-]?\\s*\\d{1,9}(?:\\.\\d{1,6})?';
  const tagged = [...text.matchAll(new RegExp('(?<![\\d.])(' + number + ')\\s*(kg|g|lb|oz)\\b', 'gi'))];
  if (['stream', 'sics', 'and', 'ohaus'].includes(options.protocol) && !tagged.length) return null;
  if (options.protocol === 'ohaus' && /\?/.test(raw)) status = false;
  const matches = tagged.length ? tagged : [...text.matchAll(new RegExp('(?<![\\d.])(' + number + ')(?![\\d.])', 'g'))];
  const index = Number(options.numberIndex || 0);
  if (!matches.length || (!index && matches.length !== 1) || index > matches.length) return null;
  const match = matches[index ? index - 1 : 0];
  const token = match[1].replace(/\s/g, '');
  let value = Number(token), unit = tagged.length ? match[2].toLowerCase() : options.unit || 'auto';
  if (unit === 'auto') unit = token.includes('.') ? 'kg' : 'g';
  if (!FACTOR[unit]) return null;
  if (!tagged.length && !token.includes('.') && options.unit && options.unit !== 'auto') value /= 10 ** Number(options.integerDecimals || 0);
  return { kg: value * FACTOR[unit], stable: status, how: 'decoded ' + unit };
}

class ScaleReader {
  constructor(opts = {}) {
    this.options = opts;
    this.stableFrames = opts.stableFrames ?? 5;
    this.toleranceKg = opts.toleranceKg ?? 0.005;
    this.idleMs = opts.idleMs ?? 3000;
    this.maxKg = opts.maxKg ?? 9999;
    this.frameLength = opts.frameLength || 0;
    this.listeners = { weight: [], stable: [], empty: [], invalid: [] };
    this._idleTimer = null;
    this.reset();
  }
  on(event, fn) { if (this.listeners[event]) this.listeners[event].push(fn); return this; }
  _emit(event, payload) { for (const fn of this.listeners[event] || []) { try { fn(payload); } catch (_) {} } }
  push(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk);
    if (this.frameLength) {
      while (this.buffer.length >= this.frameLength) {
        const frame = this.buffer.slice(0, this.frameLength); this.buffer = this.buffer.slice(this.frameLength); this._frame(frame);
      }
    } else {
      const frames = this.buffer.split(/[\r\n\x02\x03;|]+/);
      this.buffer = frames.pop();
      frames.forEach(frame => this._frame(frame));
      // Unit-tagged continuous streams have an explicit end marker. Bare
      // numbers must wait for a delimiter or configured fixed frame length.
      let m;
      while ((m = this.buffer.match(/^.*?\d\s*(?:kg|g|lb|oz)(?=\s|$|ST[, :]|US[, :])/i))) {
        this._frame(m[0]); this.buffer = this.buffer.slice(m[0].length);
      }
    }
    if (this.buffer.length > 512) { this._invalid('No frame boundary. Set the fixed frame length.', this.buffer.slice(-80)); this.buffer = ''; }
  }
  _frame(frame) {
    if (!frame.trim()) return;
    const parsed = parseFrame(frame, this.options);
    if (!parsed) { this._invalid('Unrecognized or ambiguous reading', frame); return; }
    this._accept(parsed, frame.trim());
  }
  _invalid(reason, raw = '') {
    this.weight = null; this.stableWeight = null; this.isStable = false; this.recent = [];
    this._emit('invalid', { reason, raw });
  }
  _accept({ kg, how, stable }, frame) {
    if (!Number.isFinite(kg) || kg < 0 || kg > this.maxKg) { this._invalid('Reading outside the configured capacity', frame); return; }
    this.lastFrameAt = Date.now(); this.weight = kg;
    this.recent.push(kg); if (this.recent.length > this.stableFrames) this.recent.shift();
    const settled = stable !== false && (stable === true || (this.recent.length === this.stableFrames && Math.max(...this.recent) - Math.min(...this.recent) <= this.toleranceKg));
    const becameStable = settled && !this.isStable;
    this.isStable = settled; this.stableWeight = settled ? kg : null;
    this._emit('weight', { kg, stable: settled, raw: frame, how });
    if (becameStable && kg > this.toleranceKg) this._emit('stable', { kg, raw: frame, how });
  }
  startIdleWatch() {
    this.stopIdleWatch();
    this._idleTimer = setInterval(() => {
      if (this.lastFrameAt && this.weight !== null && Date.now() - this.lastFrameAt > this.idleMs) this._invalid('No recent reading. Check the scale or press its Send/Print button.');
    }, Math.max(50, Math.min(500, Math.floor(this.idleMs / 4))));
    this._idleTimer.unref?.();
  }
  stopIdleWatch() { if (this._idleTimer) clearInterval(this._idleTimer); this._idleTimer = null; }
  reset() { this.buffer = ''; this.recent = []; this.weight = null; this.stableWeight = null; this.isStable = false; this.lastFrameAt = 0; }
}
module.exports = { ScaleReader, parseFrame };
