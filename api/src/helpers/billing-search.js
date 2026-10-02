/* global window */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicBillingSearch = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  function normalize(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let previous = Array.from({ length: b.length + 1 }, function (_, i) {
      return i;
    });
    let beforePrevious;
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(
          row[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
        }
      }
      beforePrevious = previous;
      previous = row;
    }
    return previous[b.length];
  }
  function score(query, item) {
    const q = normalize(query);
    if (!q) return 0;
    const codes = [
      item.plu_code,
      item.itemid,
      item.item_code,
      item.sku,
      item.short_code,
      item.barcode_id,
    ]
      .concat(item.barcodes || [])
      .filter(Boolean)
      .map(normalize);
    if (codes.includes(q)) return 1000;
    const names = [item.item_name || item.name]
      .concat(
        (item.translations || []).map(function (t) {
          return t.name;
        })
      )
      .filter(Boolean)
      .map(normalize);
    if (names.includes(q)) return 950;
    if (
      names.some(function (n) {
        return n.startsWith(q);
      })
    )
      return 900;
    if (
      q.length >= 2 &&
      names.some(function (n) {
        return (
          n
            .split(' ')
            .map(function (word) {
              return word[0];
            })
            .join('') === q
        );
      })
    )
      return 850;
    if (
      codes.some(function (c) {
        return c.startsWith(q);
      })
    )
      return 800;
    const words = names.join(' ').split(' ');
    const tokens = q.split(' ');
    if (
      tokens.every(function (token) {
        return words.some(function (word) {
          return word.startsWith(token);
        });
      })
    )
      return 750;
    if (
      names.some(function (n) {
        return n.includes(q);
      })
    )
      return 700;
    if (
      tokens.every(function (token) {
        return words.some(function (word) {
          return (
            word === token ||
            (token.length >= 5 && distance(token, word) <= (token.length >= 8 ? 2 : 1))
          );
        });
      })
    )
      return 400;
    if (normalize(item.category_name).includes(q)) return 200;
    return 0;
  }
  function search(query, items, limit) {
    return items
      .map(function (item, index) {
        return { item: item, index: index, rank: score(query, item) };
      })
      .filter(function (row) {
        return row.rank > 0;
      })
      .sort(function (a, b) {
        return b.rank - a.rank || a.index - b.index;
      })
      .slice(0, limit || 20)
      .map(function (row) {
        return row.item;
      });
  }
  function price(item, taxEnabled) {
    const value = Number(item.selling_price) || 0;
    const rate = taxEnabled === false ? 0 : Math.max(0, Number(item.tax) || 0);
    const inclusive = item.tax_type === 'inclusive';
    const original = inclusive ? value : value * (1 + rate / 100);
    const base = inclusive && rate ? value / (1 + rate / 100) : value;
    const discount =
      Number(item.discount_amount) > 0
        ? Number(item.discount_amount)
        : (base * Math.max(0, Number(item.discount_percentage) || 0)) / 100;
    const total = Math.max(0, base - discount) * (1 + rate / 100);
    return {
      price: Math.round(total * 100) / 100,
      was: discount > 0 ? Math.round(original * 100) / 100 : null,
      tax: rate,
    };
  }
  function expired(value, now) {
    if (value == null || value === '') return false;
    const date = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
    return Number.isFinite(date) && date < (now || Date.now());
  }
  return { normalize: normalize, search: search, score: score, price: price, expired: expired };
});
