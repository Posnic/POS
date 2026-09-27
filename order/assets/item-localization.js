/* One item identity, optional localized catalogue text. Also bundled in the UI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicItemText = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function locale(value) {
    if (
      typeof value !== 'string' ||
      value.length > 35 ||
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value)
    )
      return '';
    try {
      return Intl.getCanonicalLocales(value)[0];
    } catch (_) {
      return '';
    }
  }
  function normalize(value) {
    if (!Array.isArray(value) || value.length > 60)
      throw new Error('Use up to 60 item translations.');
    const seen = new Set();
    return value
      .map(function (entry) {
        const code = locale(entry && entry.locale);
        if (!code || seen.has(code))
          throw new Error('Choose a different valid language for each translation.');
        seen.add(code);
        const out = { locale: code };
        ['name', 'description'].forEach(function (key) {
          if (entry[key] !== undefined && typeof entry[key] !== 'string')
            throw new Error('Translated text must be plain text.');
          const text = String(entry[key] || '').trim();
          if (text.length > (key === 'name' ? 200 : 2000))
            throw new Error('Translated ' + key + ' is too long.');
          if (text) out[key] = text;
        });
        return out;
      })
      .filter(function (entry) {
        return entry.name || entry.description;
      });
  }
  function text(item, language, field) {
    item = item || {};
    field = field || 'name';
    const original = String(
      (Object.prototype.hasOwnProperty.call(item, 'original_' + field)
        ? item['original_' + field]
        : item[field] || (field === 'name' ? item.item_name : '')) || ''
    );
    const code = locale(language),
      base = locale(item.default_language);
    if (!code || code === base) return original;
    const entries = Array.isArray(item.translations) ? item.translations : [];
    const parts = code.split('-');
    while (parts.length) {
      const candidate = parts.join('-');
      if (candidate === base) return original;
      const match = entries.find((row) => row && locale(row.locale) === candidate);
      if (match && match[field]) return String(match[field]);
      parts.pop();
    }
    return original;
  }
  function name(item, language, bilingual) {
    const value = text(item, language, 'name');
    const original = String((item && (item.original_name || item.name || item.item_name)) || '');
    return bilingual && original && value !== original ? value + ' / ' + original : value;
  }
  function snapshot(item) {
    if (!item || (!item.default_language && !item.translations?.length)) return {};
    return {
      default_language: locale(item && item.default_language),
      translations: normalize((item && item.translations) || [])
        .map(function (row) {
          return { locale: row.locale, name: row.name || '' }; // Menu descriptions never enter sale/KOT lines.
        })
        .filter(function (row) {
          return row.name;
        }),
    };
  }
  function catalog(item) {
    if (!item || (!item.default_language && !item.translations?.length)) return {};
    return {
      default_language: locale(item.default_language),
      translations: normalize(item.translations || []),
    };
  }
  const languages =
    'en en-GB nl de fr fr-CA es es-MX it pt pt-BR ca eu gl fy fo rm gd br se el da sv nb nn fi is ga cy mt lb pl cs sk hu ro bg hr sl et lv lt sq bs mk sr uk ru be tr ar he fa ur hi bn pa gu mr ta te kn ml si ne th vi id ms fil zh zh-CN zh-TW zh-Hans zh-Hant ja ko sw am ha yo zu af km lo my ka hy az kk uz mn'.split(
      ' '
    );
  function display(item, code) {
    return Object.assign({}, item, {
      original_name: item.original_name || item.name || item.item_name || '',
      original_description: Object.prototype.hasOwnProperty.call(item, 'original_description')
        ? item.original_description
        : item.description || '',
      name: text(item, code),
      description: text(item, code, 'description'),
    });
  }
  return {
    locale: locale,
    normalize: normalize,
    text: text,
    name: name,
    snapshot: snapshot,
    catalog: catalog,
    languages: languages,
    display: display,
  };
});
