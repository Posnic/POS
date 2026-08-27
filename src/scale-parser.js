/**
 * Weighing scale reader for RS-232 platform scales (Essae SI-810PR and the
 * many devices that speak the same dialects).
 *
 * Scales do not agree on a wire format, so this accepts all the shapes seen
 * in the field rather than one:
 *
 *   ST,GS,+  0.545kg      status,mode,weight
 *   +000.545 kg / 0.545   plain, zero padded
 *   W+001.245             prefixed
 *   <STX>  0.545<ETX>     STX/ETX framed
 *   00545                 integer grams (no decimal point)
 *   continuous stream     no delimiters at all
 *
 * It also answers the two questions billing actually cares about:
 *   - is the reading STABLE (settled), so it is safe to charge for?
 *   - has the platter been CLEARED, so the next item starts clean?
 *
 * Scales configured for "stable weight transfer" stop transmitting when the
 * platter is empty or the load is moving, so silence is meaningful: after
 * idleMs with no frame we report zero rather than holding the last number.
 */

// Boundaries matter: without them "99999.000" quietly matches its last four
// digits and a nonsense reading looks valid.
const DECIMAL_RE = /(?<![\d.])([+-]?\s*\d{1,4}\.\d{1,3})(?![\d.])/;  // 0.545  + 1.245  12.50
const KG_TAGGED_RE = /(?<![\d.])([+-]?\s*[\d.]+)\s*k?g/i;            // "0.545kg" / "545 g"
const INT_RE = /(?<![\d.])([+-]?\d{3,6})(?![\d.])/;                  // "00545" -> grams
const STATUS_TOKENS_RE = /\b(ST|US|OL|GS|NT|TR|W)\b[,:]?/gi;

/**
 * Pull a weight in kilograms out of one frame.
 * @returns {{ kg: number, how: string } | null}
 */
function parseFrame(frame) {
  const cleaned = String(frame).replace(STATUS_TOKENS_RE, ' ').trim();
  if (!cleaned) return null;

  let m = cleaned.match(DECIMAL_RE);
  if (m) return { kg: parseFloat(m[1].replace(/\s+/g, '')), how: `decimal "${m[1].trim()}"` };

  m = cleaned.match(KG_TAGGED_RE);
  if (m) {
    let value = parseFloat(m[1].replace(/\s+/g, ''));
    // "545 g" is grams; "0.545 kg" is not. Only divide when the unit is bare g.
    if (/(^|\d)\s*g\b/i.test(cleaned) && !/kg/i.test(cleaned)) value /= 1000;
    return { kg: value, how: `unit-tagged "${m[0].trim()}"` };
  }

  m = cleaned.match(INT_RE);
  if (m) return { kg: parseInt(m[1], 10) / 1000, how: `integer-grams "${m[1]}"` };

  return null;
}

class ScaleReader {
  /**
   * @param {object} [opts]
   * @param {number} [opts.stableFrames=5]  frames that must agree
   * @param {number} [opts.toleranceKg=0.005] spread allowed across them
   * @param {number} [opts.idleMs=600]      silence that means "platter empty"
   * @param {number} [opts.maxKg=9999]      sanity ceiling
   */
  constructor(opts = {}) {
    this.stableFrames = opts.stableFrames ?? 5;
    this.toleranceKg = opts.toleranceKg ?? 0.005;
    this.idleMs = opts.idleMs ?? 600;
    this.maxKg = opts.maxKg ?? 9999;

    this.buffer = '';
    this.recent = [];
    this.weight = null;        // latest reading
    this.stableWeight = null;  // latest settled reading
    this.isStable = false;
    this.lastFrameAt = 0;
    this.listeners = { weight: [], stable: [], empty: [] };
    this._idleTimer = null;
  }

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
    return this;
  }

  _emit(event, payload) {
    for (const fn of this.listeners[event] || []) {
      try { fn(payload); } catch (e) { /* a listener must not break the reader */ }
    }
  }

  /** Feed raw bytes or text straight from the serial port. */
  push(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk);

    // CR, LF, STX, ETX, semicolon and pipe all appear as frame separators.
    const frames = this.buffer.split(/[\r\n\x02\x03;|]+/);
    this.buffer = frames.pop();

    let matched = false;
    for (const frame of frames) {
      const parsed = parseFrame(frame);
      if (parsed) { this._accept(parsed, frame.trim()); matched = true; }
    }

    // Some scales stream continuously with no delimiter at all. Once enough
    // characters have accumulated, read the buffer itself.
    if (!matched && this.buffer.length >= 24) {
      const parsed = parseFrame(this.buffer);
      if (parsed) {
        this._accept(parsed, this.buffer.slice(0, 24) + ' (no-delimiter stream)');
        this.buffer = this.buffer.slice(-8);
      }
    }
    if (this.buffer.length > 256) this.buffer = this.buffer.slice(-64);
  }

  _accept({ kg, how }, frame) {
    if (!Number.isFinite(kg) || kg < 0 || kg > this.maxKg) return;
    this.lastFrameAt = Date.now();
    this.weight = kg;

    this.recent.push(kg);
    if (this.recent.length > this.stableFrames) this.recent.shift();
    const settled = this.recent.length === this.stableFrames &&
      Math.max(...this.recent) - Math.min(...this.recent) <= this.toleranceKg;

    const becameStable = settled && !this.isStable;
    this.isStable = settled;
    if (settled) this.stableWeight = kg;

    this._emit('weight', { kg, stable: settled, raw: frame, how });
    // Fire once per settle, and only for a real load, so an operator does not
    // get the same weight applied twice.
    if (becameStable && kg > this.toleranceKg) {
      this._emit('stable', { kg, raw: frame, how });
    }
  }

  /** Call once after opening the port. */
  startIdleWatch() {
    this.stopIdleWatch();
    this._idleTimer = setInterval(() => {
      if (!this.lastFrameAt) return;
      if (Date.now() - this.lastFrameAt <= this.idleMs) return;
      if (this.weight === 0) return;               // already reported empty
      this.weight = 0;
      this.stableWeight = 0;
      this.isStable = true;
      this.recent = [];
      this._emit('empty', { kg: 0 });
      this._emit('weight', { kg: 0, stable: true, raw: '(no data)', how: 'idle: platter empty' });
    }, Math.max(100, Math.floor(this.idleMs / 4)));
  }

  stopIdleWatch() {
    if (this._idleTimer) clearInterval(this._idleTimer);
    this._idleTimer = null;
  }

  reset() {
    this.buffer = '';
    this.recent = [];
    this.weight = null;
    this.stableWeight = null;
    this.isStable = false;
    this.lastFrameAt = 0;
  }
}

module.exports = { ScaleReader, parseFrame };
