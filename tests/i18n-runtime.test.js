'use strict';

/*
 * The runtime half of L3: pages ship once, in English, and the words are
 * swapped in.
 *
 * These run against a real DOM rather than string matching, because the whole
 * change is about what the page LOOKS LIKE after load. The three shapes that
 * matter are all here:
 *
 *   <lang class="key">English</lang>      ordinary content, tag stays
 *   <title data-t="key">English</title>   the parser builds no element inside
 *   <option data-t="key">English</option> a select shows text, not markup
 *
 * See Intranet docs/MULTI_LANGUAGE_ARCHITECTURE.md.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CORE = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js');

/*
 * The i18n object, lifted out of PosnicPro.js and evaluated on its own.
 *
 * Loading the whole 200KB file would drag in jQuery, the router and a dozen
 * globals that have nothing to do with translation. Slicing keeps the test
 * about i18n while still running the SHIPPING source rather than a copy.
 */
function loadI18n(dom, dict, stored) {
  const core = fs.readFileSync(CORE, 'utf8');
  const start = core.indexOf('PosnicPro.i18n = {');
  const end = core.indexOf('\nPosnicPro.i18n.load()', start);
  assert.ok(start > 0 && end > start, 'PosnicPro.i18n could not be found');

  const store = Object.assign({}, stored);
  const PosnicPro = {
    local: {
      get: (k) => (k in store ? store[k] : null),
      set: (k, v) => { store[k] = String(v); },
      remove: (k) => { delete store[k]; },
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('PosnicPro', 'document', 'fetch', core.slice(start, end))(
    PosnicPro, dom.window.document,
    () => Promise.resolve({ ok: true, json: () => Promise.resolve(dict) }),
  );
  PosnicPro.i18n._dict = dict;
  return { PosnicPro, store };
}

const page = (body) => new JSDOM(
  '<!doctype html><html><head><title data-t="lang_title">Posnic</title></head>'
  + '<body>' + body + '</body></html>');

const TA = {
  lang_title: 'பொஸ்னிக்',
  lang_item_name: 'பொருளின் பெயர்',
  lang_new_search: 'புதியது',
  lang_blank: '   ',
};

/* --------------------------------------------------------------- applying --- */

test('a <lang> tag is translated in place', () => {
  const dom = page('<h5><lang class="lang_item_name">Item name</lang></h5>');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.querySelector('lang').textContent, 'பொருளின் பெயர்');
});

test('a <title> carries its key as data-t and is translated', () => {
  /* Inside <title> the parser treats markup as text, so a tag left there
     would print angle brackets in the browser tab. */
  const dom = page('');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.title, 'பொஸ்னிக்');
});

test('an <option> shows the translation, not markup', () => {
  const dom = page('<select><option value="new" data-t="lang_new_search">Newest</option></select>');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply();
  const opt = dom.window.document.querySelector('option');
  assert.equal(opt.textContent, 'புதியது');
  assert.equal(opt.value, 'new', 'the value must not be disturbed');
});

/* -------------------------------------------------- English is never lost --- */

test('a key the language does not have keeps its English', () => {
  const dom = page('<span><lang class="lang_not_translated">Untranslated</lang></span>');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.querySelector('lang').textContent, 'Untranslated');
});

test('a blank translation keeps its English', () => {
  /* A generated skeleton full of empty strings must not blank the interface. */
  const dom = page('<span><lang class="lang_blank">Something</lang></span>');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.querySelector('lang').textContent, 'Something');
});

test('with no dictionary at all the page is untouched English', () => {
  /* First run, offline, or a pack that 404s. */
  const dom = page('<span><lang class="lang_item_name">Item name</lang></span>');
  const { PosnicPro } = loadI18n(dom, null);
  PosnicPro.i18n._dict = null;
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.querySelector('lang').textContent, 'Item name');
});

test('applying twice changes nothing the second time', () => {
  /* apply() runs on load and again on DOMContentLoaded, and translates fresh
     markup on demand. It reads the key, never the current text, so it cannot
     translate its own output. */
  const dom = page('<span><lang class="lang_item_name">Item name</lang></span>');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply();
  const once = dom.window.document.body.innerHTML;
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.body.innerHTML, once);
});

test('a root can be given, so markup rendered later is translated too', () => {
  const dom = page('<div id="a"><lang class="lang_item_name">Item name</lang></div>'
    + '<div id="b"><lang class="lang_item_name">Item name</lang></div>');
  const { PosnicPro } = loadI18n(dom, TA);
  PosnicPro.i18n.apply(dom.window.document.getElementById('a'));
  assert.equal(dom.window.document.querySelector('#a lang').textContent, 'பொருளின் பெயர்');
  assert.equal(dom.window.document.querySelector('#b lang').textContent, 'Item name',
    'only the given root should have been touched');
});

/* ---------------------------------------------------------- the language --- */

test('an existing Tamil install is migrated from the old filename', () => {
  const dom = page('');
  const { PosnicPro, store } = loadI18n(dom, TA, { language_herf: 'ta_dashboard.html' });
  assert.equal(PosnicPro.i18n.code(), 'ta');
  assert.equal(store.language_code, 'ta', 'the code should be written back');
});

test('an install that never chose a language is English', () => {
  const dom = page('');
  const { PosnicPro } = loadI18n(dom, TA, {});
  assert.equal(PosnicPro.i18n.code(), 'en');
});

test('changing language does not navigate', () => {
  /* Switching used to load a different HTML file and lose the screen. */
  const core = fs.readFileSync(CORE, 'utf8');
  const start = core.indexOf('change: function');
  const changeFn = core.slice(start, core.indexOf('\n    }', start));
  assert.ok(!/location\s*\./.test(changeFn), 'change() still navigates');
  assert.match(changeFn, /apply\(\)/, 'change() does not redraw');
});

/* ------------------------------------------------- markup in the words --- */

test('a text-only translation keeps the icon the page carries', () => {
  /*
   * "Download" sits after a feather icon inside its <lang>. Tamil translated
   * the word alone, and textContent threw the icon away with the English.
   */
  const dom = page('<button><lang class="lang_download_title"><i class="feather icon-download mr-2"></i>Download </lang></button>');
  const { PosnicPro } = loadI18n(dom, { lang_download_title: 'பதிவிறக்க' });
  PosnicPro.i18n.apply();
  const el = dom.window.document.querySelector('lang');
  assert.ok(el.querySelector('i.feather'), 'the icon was lost');
  assert.equal(el.textContent, 'பதிவிறக்க');
});

test('a translation that carries the same markup is used as markup', () => {
  /* The code later rewrites #resetHeading to "Sale" or "Receiving"; the span
     has to survive translation or that write lands nowhere. */
  const dom = page('<p><lang class="lang_reset_want">Do you want to reset cart and proceed to New <span id="resetHeading">Sale</span> ?</lang></p>');
  const { PosnicPro } = loadI18n(dom, {
    lang_reset_want: 'Réinitialiser le panier et passer à une nouvelle <span id="resetHeading">Vente</span> ?',
  });
  PosnicPro.i18n.apply();
  const span = dom.window.document.getElementById('resetHeading');
  assert.ok(span, 'the span the code rewrites later is gone');
  assert.equal(span.textContent, 'Vente');
});

test('switching back to English restores what the page shipped with', () => {
  const dom = page('<h5><lang class="lang_item_name">Item name</lang></h5>');
  const { PosnicPro } = loadI18n(dom, TA, { language_code: 'ta' });
  PosnicPro.i18n.apply();
  assert.equal(dom.window.document.querySelector('lang').textContent, 'பொருளின் பெயர்');
  return PosnicPro.i18n.change('en').then(() => {
    assert.equal(dom.window.document.querySelector('lang').textContent, 'Item name');
    assert.equal(dom.window.document.documentElement.getAttribute('lang'), 'en');
    assert.equal(dom.window.document.documentElement.getAttribute('dir'), 'ltr');
  });
});

test('switching back to English ignores mutable DOM attributes', () => {
  const dom = page('<h5><lang class="lang_item_name">Item name</lang></h5>');
  const { PosnicPro } = loadI18n(dom, TA, { language_code: 'ta' });
  PosnicPro.i18n.apply();
  const label = dom.window.document.querySelector('lang');
  label.setAttribute('data-en', '<img src=x onerror=alert(1)>');
  return PosnicPro.i18n.change('en').then(() => {
    assert.equal(label.textContent, 'Item name');
    assert.equal(label.querySelector('img'), null);
  });
});

/* ---------------------------------------------- the document's language --- */

test('the document takes the language and its direction', () => {
  const dom = page('');
  const { PosnicPro } = loadI18n(dom, {}, { language_code: 'ar' });
  PosnicPro.i18n.mark();
  assert.equal(dom.window.document.documentElement.getAttribute('lang'), 'ar');
  assert.equal(dom.window.document.documentElement.getAttribute('dir'), 'rtl');
  return PosnicPro.i18n.change('ta').then(() => {
    assert.equal(dom.window.document.documentElement.getAttribute('lang'), 'ta');
    assert.equal(dom.window.document.documentElement.getAttribute('dir'), 'ltr');
  });
});

test('a first run starts in the browser language the build ships', () => {
  const dom = page('');
  const { PosnicPro } = loadI18n(dom, {});
  const offered = [{ code: 'en' }, { code: 'ta' }, { code: 'pt' }, { code: 'pt-BR' }];
  assert.equal(PosnicPro.i18n.detect(offered, ['pt-BR', 'en-US']), 'pt-BR', 'an exact tag should win');
  assert.equal(PosnicPro.i18n.detect(offered, ['pt-PT', 'en-US']), 'pt', 'the primary subtag is tried next');
  assert.equal(PosnicPro.i18n.detect(offered, ['ta-IN']), 'ta');
  assert.equal(PosnicPro.i18n.detect(offered, ['de-DE', 'fr']), 'en', 'nothing shipped means English');
  assert.equal(PosnicPro.i18n.chosen(), false, 'a fresh machine has chosen nothing');
  assert.equal(PosnicPro.i18n.code(), 'en');
  assert.equal(PosnicPro.i18n.chosen(), false, 'asking for the code must not count as choosing');
});
