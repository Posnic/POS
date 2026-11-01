'use strict';
function normalizeScaleOptions(input = {}) {
  const o = input && typeof input === 'object' ? input : { isMock: input === true };
  const pick = (key, fallback, choices) => { const value = o[key] ?? fallback; if (!choices.includes(value)) throw Error('Invalid scale setting: ' + key); return value; };
  const integer = (key, fallback, min, max) => { const value = Number(o[key] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw Error('Invalid scale setting: ' + key); return value; };
  const result = {
    protocol: pick('protocol', 'generic', require('./scale-profiles').map(p => p.id)),
    transport: pick('transport', 'serial', ['serial', 'tcp']),
    host: String(o.host || '').trim(), tcpPort: integer('tcpPort', 4001, 1, 65535),
    isMock: o.isMock === true,
    baudRate: integer('baudRate', 9600, 300, 115200),
    dataBits: integer('dataBits', 8, 5, 8),
    stopBits: pick('stopBits', 1, [1, 1.5, 2]), parity: pick('parity', 'none', ['none','even','odd','mark','space']),
    rtscts: o.rtscts === true,
    unit: pick('unit', 'auto', ['auto','kg','g','lb','oz']),
    decimalSeparator: pick('decimalSeparator', '.', ['.', ',']),
    integerDecimals: integer('integerDecimals', 0, 0, 6),
    numberIndex: integer('numberIndex', 0, 0, 20), frameLength: integer('frameLength', 0, 0, 256),
    stableFrames: integer('stableFrames', 5, 1, 20), idleMs: integer('idleMs', 3000, 500, 60000),
    maxKg: Number(o.maxKg ?? 9999),
    pollHex: String(o.pollHex || '').replace(/\s/g, ''), pollIntervalMs: integer('pollIntervalMs', 1000, 100, 60000),
  };
  if (!Number.isFinite(result.maxKg) || result.maxKg <= 0 || result.maxKg > 999999) throw Error('Capacity must be between 0 and 999999 kg');
  if (result.transport === 'tcp' && (!/^[a-zA-Z0-9.-]{1,253}$/.test(result.host))) throw Error('Enter the scale IP address or host name');
  if (!/^(?:[0-9a-fA-F]{2}){0,64}$/.test(result.pollHex)) throw Error('Read command must contain hexadecimal byte pairs, e.g. 57 0D');
  return result;
}
module.exports = { normalizeScaleOptions };
