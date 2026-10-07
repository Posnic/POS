/* Public interface translations only; never send order data to a translation service. */
(() => {
  'use strict';
  const base = new URL('locales/', document.currentScript.src);
  let language = 'en',
    pack = {},
    generation = 0;
  const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
  function t(source, values = {}) {
    const translated = Object.prototype.hasOwnProperty.call(pack, normalize(source))
      ? pack[normalize(source)]
      : source;
    return translated.replace(/\{(\w+)\}/g, (token, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token
    );
  }
  const entries = [];
  function bind(element, source) {
    const node = document.createTextNode(t(source));
    element.append(node);
    entries.push({ node, source, previous: node.nodeValue });
  }
  function load(url) {
    if (url.protocol !== 'file:')
      return fetch(url).then((response) => {
        if (!response.ok) throw Error('Translation unavailable');
        return response.json();
      });
    // Electron file windows cannot rely on the browser Fetch file-scheme support.
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url.href);
      request.onload = () => {
        try {
          resolve(JSON.parse(request.responseText));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = reject;
      request.send();
    });
  }
  function capture(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('script,style,textarea,[translate="no"]')) continue;
      const source = normalize(node.nodeValue);
      if (/[a-zA-Z]/.test(source)) entries.push({ node, source, previous: node.nodeValue });
    }
    for (const node of [root, ...root.querySelectorAll('[aria-label],[placeholder],[title]')]) {
      for (const attr of ['aria-label', 'placeholder', 'title']) {
        const source = node.getAttribute(attr);
        if (source) entries.push({ node, attr, source, previous: source });
      }
    }
  }
  function apply() {
    for (const entry of entries) {
      const { node, attr, source, previous } = entry;
      if (!node.isConnected) continue;
      const current = attr ? node.getAttribute(attr) : node.nodeValue;
      // Runtime content such as branch names, notes and messages belongs to its renderer.
      if (current !== previous) continue;
      const value = t(source);
      if (attr) node.setAttribute(attr, value);
      else node.nodeValue = previous.match(/^\s*/)[0] + value + previous.match(/\s*$/)[0];
      entry.previous = attr ? node.getAttribute(attr) : node.nodeValue;
    }
    document.documentElement.lang = language;
    document.documentElement.dir = /^(ar|he|fa|ur)$/.test(language) ? 'rtl' : 'ltr';
  }
  async function setLanguage(code) {
    const request = ++generation;
    code = String(code || 'en')
      .toLowerCase()
      .replace('_', '-');
    if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(code)) code = 'en';
    code = { 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', zh: 'zh-CN', no: 'nb' }[code] || code;
    let next = {};
    try {
      if (code !== 'en') {
        next = await load(new URL(code + '.json', base));
      }
    } catch (_) {
      /* Missing packs retain readable English. */
    }
    if (request !== generation) return;
    language = code;
    pack = next;
    apply();
    document.dispatchEvent(new CustomEvent('display-language-change'));
  }
  let stored = '';
  try {
    stored =
      localStorage.getItem('posnic.display.language') ||
      localStorage.getItem('language_code') ||
      (localStorage.getItem('language_herf') || '').split('_')[0];
  } catch (_) {}
  const code =
    new URLSearchParams(location.search).get('lang') ||
    stored ||
    (navigator.language || 'en').split('-')[0];
  const desktop = location.protocol === 'file:';
  if (desktop) {
    capture(document.getElementById('screenTab') || document.body);
  } else capture(document.body);
  if (document.querySelector('title')) capture(document.querySelector('title'));
  window.DisplayI18n = {
    t,
    bind,
    capture,
    setLanguage,
    get language() {
      return language;
    },
  };
  const picker = document.getElementById('display-language');
  if (picker) {
    load(new URL('index.json', base))
      .then((languages) => {
        for (const item of languages) {
          const option = document.createElement('option');
          option.value = item.code;
          option.textContent = item.name;
          picker.append(option);
        }
        picker.value =
          { 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', zh: 'zh-CN', no: 'nb' }[code.toLowerCase()] || code;
        if (!picker.value) picker.value = 'en';
      })
      .catch(() => {});
    picker.onchange = () => {
      try {
        localStorage.setItem('posnic.display.language', picker.value);
      } catch (_) {}
      void setLanguage(picker.value);
    };
  }
  window.addEventListener('storage', (event) => {
    if (event.key === 'posnic.display.language' || event.key === 'language_code')
      void setLanguage(event.newValue || 'en');
  });
  void setLanguage(code);
})();
