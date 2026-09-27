/* global window */
/* Shared by the editor and settings validation. No HTML or remote image URLs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicPrintableMenuDesign = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const sizes = { a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4] };
  const patterns = ['plain', 'linen', 'coastal', 'botanical', 'deco'];
  function normalize(input) {
    const v = input || {};
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid menu design.');
    function text(key, max, fallback) {
      const s = v[key] == null ? fallback : String(v[key]);
      if (s.length > max) throw new Error('Menu ' + key + ' is too long.');
      return s;
    }
    const image = text('background', 1400000, '');
    if (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      throw new Error('Choose a PNG, JPEG or WebP background under 1 MB.');
    }
    const categories = v.categories == null ? null : v.categories;
    if (
      categories !== null &&
      (!Array.isArray(categories) ||
        categories.length > 500 ||
        categories.some(function (s) {
          return typeof s !== 'string' || s.length > 100;
        }))
    ) {
      throw new Error('Invalid menu categories.');
    }
    return {
      version: 1,
      title: text('title', 120, ''),
      subtitle: text('subtitle', 200, 'Our menu'),
      footer: text('footer', 300, ''),
      size: Object.prototype.hasOwnProperty.call(sizes, v.size) ? v.size : 'a4',
      columns: Number(v.columns) === 1 ? 1 : 2,
      fontSize: [14, 16, 18].indexOf(Number(v.fontSize)) !== -1 ? Number(v.fontSize) : 16,
      font: v.font === 'sans' ? 'sans' : 'serif',
      pattern: patterns.indexOf(v.pattern) !== -1 ? v.pattern : 'plain',
      accent: /^#[0-9a-f]{6}$/i.test(v.accent || '') ? v.accent : '#155e63',
      opacity:
        Number.isFinite(Number(v.opacity)) && v.opacity !== null
          ? Math.min(0.5, Math.max(0, Number(v.opacity)))
          : 0.16,
      descriptions: v.descriptions === true,
      diet: v.diet !== false,
      categories: categories === null ? null : Array.from(new Set(categories)),
      background: image,
    };
  }
  return { normalize: normalize, sizes: sizes, patterns: patterns };
});
