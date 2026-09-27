(function (root) {
  'use strict';
  function fail(message) {
    throw new Error(message);
  }
  function allocate(amount, weights) {
    if (!Number.isSafeInteger(amount)) fail('Invalid amount');
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0) || weights.some((w) => !Number.isFinite(w) || w < 0))
      fail('Assign every item to a guest.');
    const parts = weights.map((w) => Math.floor((Math.abs(amount) * w) / total));
    const order = weights
      .map((w, i) => ({ i, r: (Math.abs(amount) * w) / total - parts[i] }))
      .sort((a, b) => b.r - a.r || a.i - b.i);
    for (let n = Math.abs(amount) - parts.reduce((a, b) => a + b, 0), i = 0; i < n; i++)
      parts[order[i].i]++;
    return parts.map((n) => (amount < 0 ? -n : n));
  }
  function split(snapshot, plan) {
    const names = plan.guests;
    if (
      !Array.isArray(names) ||
      names.length < 2 ||
      names.length > 20 ||
      names.some((n) => typeof n !== 'string' || !n.trim() || n.length > 60)
    )
      fail('Choose between 2 and 20 guests.');
    if (!['equal', 'items'].includes(plan.mode)) fail('Choose how to split the bill.');
    const guests = names.map((name, index) => ({
      name: name.trim(),
      index,
      lines: [],
      totalMinor: 0,
      components: {},
    }));
    let running = 0;
    for (const line of snapshot.lines) {
      const weights = plan.mode === 'equal' ? names.map(() => 1) : plan.allocations?.[line.id];
      if (
        !Array.isArray(weights) ||
        weights.length !== names.length ||
        weights.some((w) => !Number.isInteger(w) || w < 0 || w > 1000) ||
        !weights.some((w) => w > 0)
      )
        fail('Assign every item to a guest.');
      const amounts = weights.map(() => 0),
        components = weights.map(() => ({}));
      for (const component of line.components) {
        let shares;
        if (plan.mode === 'equal') {
          const end = running + component.minor;
          shares = names.map(
            (_, g) =>
              Math.floor((end + names.length - 1 - g) / names.length) -
              Math.floor((running + names.length - 1 - g) / names.length)
          );
          running = end;
        } else shares = allocate(component.minor, weights);
        shares.forEach((amount, g) => {
          amounts[g] += amount;
          components[g][component.key] = amount;
          guests[g].components[component.key] = (guests[g].components[component.key] || 0) + amount;
        });
      }
      weights.forEach((weight, g) => {
        if (!weight) return;
        guests[g].lines.push({
          id: line.id,
          name: line.name,
          quantity: line.quantity,
          weight,
          weightTotal: weights.reduce((a, b) => a + b, 0),
          components: components[g],
          amountMinor: amounts[g],
        });
        guests[g].totalMinor += amounts[g];
      });
    }
    if (guests.some((g) => !g.lines.length || g.totalMinor < 0))
      fail('Assign at least one item to each guest.');
    if (guests.reduce((n, g) => n + g.totalMinor, 0) !== snapshot.totalMinor)
      fail('The bill totals do not match. Refresh and try again.');
    return guests;
  }
  const api = { allocate, split };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GuestBillMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
