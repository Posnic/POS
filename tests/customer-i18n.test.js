'use strict';

/*
 * Tamil on the customer pages.
 *
 * Every sentence a customer can read on /menu and /order has a Tamil
 * sentence beside it, the page swaps them as they appear, and a sentence
 * built around a number keeps its number. Two copies of one file, because
 * two bundles.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const RUNTIME = path.join(ROOT, 'order', 'assets', 'i18n.js');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** The dictionary, lifted out of the runtime without running it. */
function dictionary() {
  const src = read('order', 'assets', 'i18n.js');
  const at = src.indexOf('var DICT = {');
  const end = src.indexOf('\n  };', at);
  const box = {};
  vm.runInNewContext(src.slice(at, end + 5).replace('var DICT', 'DICT'), box);
  return box.DICT;
}

const PAGES = [
  ['order', 'products.html'],
  ['order', 'cart.html'],
  ['order', 'payment.html'],
  ['order', 'thankyou.html'],
  ['order', 'home.html'],
  ['order', 'access-denied.html'],
  ['order', 'phonepe_status.html'],
  ['menu', 'index.html'],
];

/* Words on the pages that are not English sentences: the brand line, the
   placeholders data replaces, the toggle's own label. */
const NOT_SENTENCES = new Set(['POS', 'DINE IN', 'Upi', 'Powered by Posnic · www.posnic.com', 'தமிழ்', '--', 'Order']);

/** Every sentence a customer can see in the markup of one page. */
function sentences(file) {
  const dom = new JSDOM(read(...file));
  const doc = dom.window.document;
  doc.querySelectorAll('style, script').forEach((n) => n.remove());
  const out = new Set();
  const add = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2 || /^[\d\s.,₹%×+\-–:;|/&#·]+$/.test(t)) return;
    out.add(t);
  };
  const walker = doc.createTreeWalker(doc.body, 4);
  let node;
  while ((node = walker.nextNode())) add(node.nodeValue);
  doc.querySelectorAll('[placeholder]').forEach((e) => add(e.getAttribute('placeholder')));
  doc.querySelectorAll('[aria-label]').forEach((e) => add(e.getAttribute('aria-label')));
  add(doc.title);
  return [...out];
}

test('the menu bundle carries the same runtime as the order bundle, byte for byte', () => {
  assert.strictEqual(read('menu', 'i18n.js'), read('order', 'assets', 'i18n.js'), 'menu/i18n.js has drifted from order/assets/i18n.js; copy it over');
});

test('every sentence on every customer page has its Tamil', () => {
  const ta = dictionary().ta;
  const missing = [];
  for (const file of PAGES) {
    for (const s of sentences(file)) {
      if (NOT_SENTENCES.has(s)) continue;
      if (!Object.prototype.hasOwnProperty.call(ta, s)) missing.push(file.join('/') + ': ' + JSON.stringify(s));
    }
  }
  assert.deepStrictEqual(missing, [], 'sentences with no Tamil');
});

test('every sentence the scripts compose around a number has its Tamil, with the number still in it', () => {
  const ta = dictionary().ta;
  const scripts = [
    ['order', 'indexedDB.js'],
    ['order', 'assets', 'products', 'script.js'],
    ['order', 'assets', 'cart', 'script.js'],
    ['order', 'assets', 'payment', 'script.js'],
    ['order', 'assets', 'thankyou', 'script.js'],
    ['menu', 'menu.js'],
  ];
  const missing = [];
  for (const file of scripts) {
    const src = read(...file);
    const re = /\bt\(\s*(["'])((?:(?!\1).)+)\1/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[2].replace(/\\(["'])/g, '$1');
      if (!/\{\w+\}/.test(key)) continue;
      /* t("{n} " + word) composes its key; the whole keys are pinned by the page test above. */
      if (/\s$/.test(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(ta, key)) missing.push(file.join('/') + ': ' + JSON.stringify(key));
    }
  }
  assert.deepStrictEqual(missing, [], 'composed sentences with no Tamil');

  const dropped = [];
  for (const [key, value] of Object.entries(ta)) {
    for (const name of key.match(/\{\w+\}/g) || []) {
      if (!value.includes(name)) dropped.push(key + ' -> ' + value + ' lost ' + name);
    }
  }
  assert.deepStrictEqual(dropped, [], 'a Tamil sentence dropped the number');
});

/** The products page with the runtime running, arriving by `url`. */
function open(url, { languages = ['en-IN'], stored = {} } = {}) {
  const dom = new JSDOM(read('order', 'products.html'), { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: languages[0], configurable: true });
  for (const [k, v] of Object.entries(stored)) window.localStorage.setItem(k, v);
  window.eval(read('order', 'assets', 'i18n.js'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('?lang=ta on the link turns the page Tamil and remembers it', async () => {
  const window = open('https://shop.example/order/products.html?lang=ta');
  const { document } = window;
  assert.strictEqual(document.documentElement.lang, 'ta');
  assert.strictEqual(document.getElementById('shop-name').textContent, 'மெனு');
  assert.strictEqual(document.getElementById('product-search').placeholder, 'மெனுவில் தேடுங்கள்');
  assert.strictEqual(document.getElementById('top-cart').getAttribute('aria-label'), 'உங்கள் ஆர்டர்');
  assert.strictEqual(window.localStorage.getItem('posnic_lang'), 'ta');

  /* What a script draws later is translated as it lands. */
  const p = document.createElement('p');
  p.textContent = 'Not available right now';
  document.body.appendChild(p);
  await tick();
  assert.strictEqual(p.textContent, 'இப்போது கிடைக்காது');

  /* A sentence around a number keeps the number. */
  assert.strictEqual(window.t('Bring it to table {table}', { table: 'A4' }), 'மேசை A4 க்குக் கொண்டு வாருங்கள்');
  assert.strictEqual(window.t('{n} dishes found', { n: 3 }), '3 உணவுகள் கிடைத்தன');

  /* The toggle offers the way back, in English. */
  const toggle = document.querySelector('[data-lang-toggle]');
  assert.strictEqual(toggle.hidden, false);
  assert.strictEqual(toggle.textContent, 'English');
});

test('a remembered choice wins over the phone, and the phone over nothing', () => {
  const remembered = open('https://shop.example/order/products.html', { languages: ['en-IN'], stored: { posnic_lang: 'ta' } });
  assert.strictEqual(remembered.document.documentElement.lang, 'ta');

  const phone = open('https://shop.example/order/products.html', { languages: ['ta-IN', 'en'] });
  assert.strictEqual(phone.document.documentElement.lang, 'ta');

  const english = open('https://shop.example/order/products.html', { languages: ['en-IN'] });
  assert.strictEqual(english.document.documentElement.lang, 'en');
  assert.strictEqual(english.document.getElementById('shop-name').textContent, 'Menu');
  assert.strictEqual(english.document.querySelector('[data-lang-toggle]').textContent, 'தமிழ்');
  assert.strictEqual(english.t('Pay {amount}', { amount: '₹340' }), 'Pay ₹340');
});

test('names the shop typed are left alone, and so is what the customer types', async () => {
  const window = open('https://shop.example/order/products.html?lang=ta');
  const { document } = window;
  const name = document.createElement('h3');
  name.textContent = 'Chicken Biryani';
  document.body.appendChild(name);
  const note = document.createElement('textarea');
  note.textContent = 'Retry';
  document.body.appendChild(note);
  await tick();
  assert.strictEqual(name.textContent, 'Chicken Biryani');
  assert.strictEqual(note.textContent, 'Retry');
});

test('every customer page loads the runtime, and the entry pages carry the toggle', () => {
  for (const file of PAGES) {
    assert.match(read(...file), /<script src="(assets\/)?i18n\.js/, file.join('/') + ' does not load i18n.js');
  }
  for (const file of [['order', 'products.html'], ['order', 'home.html'], ['menu', 'index.html']]) {
    assert.match(read(...file), /data-lang-toggle/, file.join('/') + ' has no language toggle');
  }
});

test('voice search listens in the language the menu is written in, not the language of the page', () => {
  for (const file of [['menu', 'menu.js'], ['order', 'assets', 'products', 'script.js']]) {
    const src = read(...file);
    assert.ok(!src.includes('rec.lang = document.documentElement.lang'), file.join('/') + ' follows the page language into the microphone');
    assert.match(src, /rec\.lang = document\.documentElement\.getAttribute\("data-speech-lang"\) \|\| "en-IN"/);
  }
});
