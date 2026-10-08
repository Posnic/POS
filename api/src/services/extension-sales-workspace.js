'use strict';
// Declarative UI contract for any signed extension. No client action names or code.
function salesWorkspace(value, commands = {}) {
  if (value === undefined || value === false || value === true) return null;
  const fail = () => {
    throw new Error('extension_sales_workspace_invalid');
  };
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const token = (v) => typeof v === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(v);
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.controls) ||
    value.controls.length > 24
  )
    fail();
  const ids = new Set();
  const controls = value.controls.map((c) => {
    if (
      !object(c) ||
      !token(c.id) ||
      ids.has(c.id) ||
      typeof c.label !== 'string' ||
      !c.label.trim() ||
      c.label.length > 80 ||
      !Array.isArray(c.placements) ||
      !c.placements.length ||
      c.placements.some((p) => !['sale', 'payment', 'header'].includes(p)) ||
      (c.action !== undefined) === (c.page !== undefined) ||
      !token(c.action || c.page) ||
      (c.tone !== undefined && !['primary', 'secondary', 'danger'].includes(c.tone))
    )
      fail();
    if (c.page && c.placements.some((p) => p !== 'header')) fail();
    if (c.action && c.placements.includes('header')) fail();
    ids.add(c.id);
    return Object.freeze({
      id: c.id,
      label: c.label.trim(),
      placements: Object.freeze([...new Set(c.placements)]),
      tone: c.tone || 'primary',
      ...(c.action ? { action: c.action } : { page: c.page }),
    });
  });
  const clearCartOn = value.clearCartOn || [];
  if (
    !Array.isArray(clearCartOn) ||
    clearCartOn.length > 12 ||
    clearCartOn.some((c) => !token(c) || !Object.hasOwn(commands, c))
  )
    fail();
  const events = {};
  if (value.events !== undefined) {
    if (
      !object(value.events) ||
      Object.keys(value.events).some((k) => !['submit', 'hold', 'checkout'].includes(k))
    )
      fail();
    for (const [key, action] of Object.entries(value.events)) {
      if (!token(action) || !controls.some((c) => c.action === action)) fail();
      events[key] = action;
    }
  }
  const policies = {};
  if (value.policies !== undefined) {
    if (
      !object(value.policies) ||
      Object.keys(value.policies).some(
        (k) => !['useDefaultOpenPrice', 'compactCheckout'].includes(k)
      ) ||
      (value.policies.compactCheckout !== undefined &&
        typeof value.policies.compactCheckout !== 'boolean') ||
      (value.policies.useDefaultOpenPrice !== undefined &&
        typeof value.policies.useDefaultOpenPrice !== 'boolean')
    )
      fail();
    policies.compactCheckout = value.policies.compactCheckout === true;
    policies.useDefaultOpenPrice = value.policies.useDefaultOpenPrice === true;
  }
  return Object.freeze({
    version: 1,
    controls: Object.freeze(controls),
    clearCartOn: Object.freeze([...new Set(clearCartOn)]),
    events: Object.freeze(events),
    policies: Object.freeze(policies),
  });
}
module.exports = { salesWorkspace };
