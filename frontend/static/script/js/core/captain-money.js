/* Currency metadata and decimal/minor-unit conversion shared by Captain and POS. */
(function (host) {
  'use strict';
  function policy(value = {}) {
    if (typeof value === 'string') value = { currency: value };
    const text = [
      value.currencyCode,
      value.currency_code,
      value.currency_text,
      value.currency_type,
      value.currency,
    ]
      .filter(Boolean)
      .join(' ');
    const supported = new Set(
      Intl.supportedValuesOf ? [...Intl.supportedValuesOf('currency'), 'CLF', 'UYW'] : []
    );
    const code =
      (text.match(/\b[A-Z]{3}\b/g) || []).find((part) => !supported.size || supported.has(part)) ||
      '';
    const explicit = value.currencyDigits ?? value.currency_digits;
    const digits =
      Number.isInteger(explicit) && explicit >= 0 && explicit <= 4
        ? explicit
        : code
          ? new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
              .maximumFractionDigits
          : 2;
    const symbol = String(
      value.currencySymbol ??
        value.currency_symbol ??
        value.currency ??
        value.currency_type ??
        (code || '')
    )
      .split('')
      .filter((character) => character.charCodeAt(0) >= 32 && !'<>&"\''.includes(character))
      .join('')
      .slice(0, 32);
    return {
      currencyCode: code,
      currencyDigits: digits,
      currencySymbol: symbol,
      currency: symbol,
      factor: 10 ** digits,
    };
  }
  // Existing persisted bills used hundredths. Never reinterpret old journals
  // using today's branch settings or a newly inferred currency precision.
  function snapshot(value = {}) {
    return policy({ ...value, currencyDigits: value.currencyDigits ?? 2 });
  }
  function toMinor(value, setting = {}) {
    const digits = policy(setting).currencyDigits;
    const text = String(value ?? 0).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || text.length > 128) throw new Error('Invalid amount');
    const fraction = match[3] || '',
      exponent = Number(match[4] || 0);
    if (Math.abs(exponent) > 100) throw new Error('Invalid amount');
    let amount = BigInt(match[2] + fraction);
    const scale = digits + exponent - fraction.length;
    if (scale >= 0) amount *= 10n ** BigInt(scale);
    else {
      const divisor = 10n ** BigInt(-scale);
      amount = (amount + divisor / 2n) / divisor;
    }
    const result = Number(amount) * (match[1] === '-' ? -1 : 1);
    if (!Number.isSafeInteger(result)) throw new Error('Invalid amount');
    return result;
  }
  function fromMinor(value, setting = {}) {
    if (!Number.isSafeInteger(value)) throw new Error('Invalid amount');
    return value / policy(setting).factor;
  }
  function format(value, setting = {}, locale) {
    const p = policy(setting),
      amount = Number(value) || 0;
    const options = {
      minimumFractionDigits: p.currencyDigits,
      maximumFractionDigits: p.currencyDigits,
    };
    if (p.currencyCode)
      return new Intl.NumberFormat(locale, {
        ...options,
        style: 'currency',
        currency: p.currencyCode,
      }).format(amount);
    return p.currencySymbol + new Intl.NumberFormat(locale, options).format(amount);
  }
  const api = { policy, snapshot, toMinor, fromMinor, format };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (host && host.localStorage) {
    api.current = () => {
      try {
        return policy(
          JSON.parse(
            host.localStorage.getItem(
              'posnic.money.' + (host.localStorage.getItem('branch_id') || '')
            ) || '{"currency":"₹","currencyCode":"INR"}'
          )
        );
      } catch {
        return policy();
      }
    };
    api.remember = (value, branchId) =>
      host.localStorage.setItem(
        'posnic.money.' + (branchId || host.localStorage.getItem('branch_id') || ''),
        JSON.stringify(policy(value))
      );
    api.display = (value) =>
      format(value, api.current(), host.document?.documentElement.lang || undefined);
    api.html = (value) =>
      api
        .display(value)
        .replace(
          /[&<>"']/g,
          (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
        );
    host.CaptainMoney = api;
  }
})(globalThis.window || globalThis);
