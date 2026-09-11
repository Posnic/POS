'use strict';

/*
 * The ordering pages, actually drawn.
 *
 * Owner, with a screenshot of the old page on a laptop: "self ordering page
 * very bad in desktop... current one like school student design and
 * execution. make proper responsive... very satisfaction animation required
 * for each actions."
 *
 * Two kinds of check. The rendering ones lift the real functions out of the
 * real bundle, hand them real jQuery inside jsdom, and read what came out - a
 * card template that is never executed passes every static check in this
 * repository. The static ones pin the things a person looking at the page
 * noticed: no gradient anywhere, no framework fetched for one glyph, a wide
 * screen getting a wide layout, every action answered with motion that a
 * phone can switch off.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const BUNDLE = path.join(__dirname, '..', 'order');
const read = (f) => fs.readFileSync(path.join(BUNDLE, f), 'utf8');

const CUSTOMER_PAGES = ['products.html', 'cart.html', 'payment.html', 'thankyou.html', 'index.html'];

/* ------------------------------------------------------------ the harness */

/**
 * One function, cut out of indexedDB.js by name.
 *
 * Brace-matched from the declaration rather than sliced by line number, so
 * an edit above it cannot silently hand the test the wrong code.
 */
function lift(src, name) {
  const m = src.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(m, `indexedDB.js no longer defines ${name}`);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(m.index, i + 1);
}

/** A const object, by name: `const NAME = { ... };` */
function liftConst(src, name) {
  const at = src.indexOf(`const ${name} = {`);
  assert.ok(at !== -1, `indexedDB.js no longer defines ${name}`);
  const end = src.indexOf('};', at);
  return src.slice(at, end + 2);
}

/**
 * The products page in jsdom, with real jQuery and the real render functions,
 * and a fake catalogue and order behind them.
 */
function page(html, { cart = [], branch = {} } = {}) {
  const dom = new JSDOM(read(html), { url: 'https://shop.example/order/' + html, runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(read('assets/jquery-3.7.1.min.js'));

  const src = read('indexedDB.js');
  const code = [
    'const BRANCH_STORE = "branch";',
    lift(src, 'escapeHtml'),
    lift(src, 'getSafeImageUrl'),
    'const shop = { name: "", currency: "", currencyCode: "" };',
    lift(src, 'rememberShop'),
    lift(src, 'money'),
    liftConst(src, 'DIET_WORDS'),
    lift(src, 'dietMarkHtml'),
    lift(src, 'pop'),
    lift(src, 'renderOrderPanel'),
    lift(src, 'updateCart'),
    lift(src, 'renderProductCards'),
    lift(src, 'renderCart'),
  ].join('\n');

  const sandbox = {
    window,
    document: window.document,
    $: window.$,
    jQuery: window.jQuery,
    console,
    setTimeout: () => 0,
    getCartData: async () => JSON.parse(JSON.stringify(cart)),
    getData: async (store) => (store === 'branch' ? [{ id: 'b1', ...branch }] : []),
    CustomEvent: window.CustomEvent,
    Number,
    String,
    Array,
    Map,
    Object,
    JSON,
    Boolean,
    Math,
    URL: window.URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { window, document: window.document, box: sandbox };
}

const CATALOGUE = [
  {
    id: 'p1',
    name: 'Paneer Tikka',
    description: 'Charred on skewers, with mint chutney',
    price: 280,
    diet: 'veg',
    img: '/uploads/paneer.jpg',
    photos: ['/uploads/paneer.jpg', '/uploads/paneer-2.jpg'],
    icon: '',
    available: true,
    served_in: [],
    prep_minutes: 15,
    category_name: 'Starters',
  },
  {
    id: 'p2',
    name: 'Masala Dosa',
    description: '',
    price: 120,
    diet: 'veg',
    img: '',
    photos: [],
    icon: '🥞',
    available: false,
    served_in: ['Breakfast'],
    prep_minutes: 0,
    category_name: 'Breakfast',
  },
];

/* --------------------------------------------------------------- the card */

test('a dish is a row: mark, name, description, price in the shop money, and Add', async () => {
  const { document, box } = page('products.html', { branch: { currency: '₹' } });
  await box.rememberShop();
  await box.renderProductCards(CATALOGUE);

  const card = document.querySelector('.product-card[data-id="p1"]');
  assert.ok(card, 'no card was drawn');
  assert.strictEqual(card.getAttribute('data-qty'), '0');
  assert.strictEqual(card.getAttribute('data-available'), 'true');
  assert.ok(card.querySelector('.product-diet.diet-veg'), 'the veg mark is missing');
  assert.strictEqual(card.querySelector('.product-name').textContent, 'Paneer Tikka');
  assert.match(card.querySelector('.product-desc').textContent, /skewers/);
  assert.strictEqual(card.querySelector('.product-price').textContent, '₹280');
  assert.match(card.querySelector('.product-meta').textContent, /15 min/);
  assert.ok(card.querySelector('.product-media img'), 'the photo is missing');
  assert.strictEqual(card.querySelector('.btn-increase .add-word').textContent, 'Add');
  assert.strictEqual(card.querySelector('.btn-decrease').disabled, true);
});

test('a dish already in the order shows the stepper at its count', async () => {
  const { document, box } = page('products.html', {
    cart: [{ id: 'p1', name: 'Paneer Tikka', price: 280, quantity: 2 }],
  });
  await box.renderProductCards(CATALOGUE);
  const card = document.querySelector('.product-card[data-id="p1"]');
  assert.strictEqual(card.getAttribute('data-qty'), '2');
  assert.ok(card.classList.contains('active'));
  assert.strictEqual(card.querySelector('.product-qty').textContent, '2');
  assert.strictEqual(card.querySelector('.btn-decrease').disabled, false);
});

test('a dish outside its hours is shown, greyed, and says when - with no Add', async () => {
  const { document, box } = page('products.html');
  await box.renderProductCards(CATALOGUE);
  const card = document.querySelector('.product-card[data-id="p2"]');
  assert.strictEqual(card.getAttribute('data-available'), 'false');
  assert.match(card.querySelector('.product-meta').textContent, /Breakfast only/);
  /* No photo: the drawn icon, not a grey placeholder. */
  assert.strictEqual(card.querySelector('.product-icon').textContent, '🥞');
  assert.ok(!card.querySelector('.product-media img'), 'a placeholder image was drawn over the icon');
  /* The pill is removed by CSS, and that rule must exist. */
  assert.match(read('assets/order.css'), /\.product-card\[data-available="false"\]\s+\.cart-controls\s*\{[^}]*display:\s*none/);
});

test('a symbol sits against the number; a code keeps its space; nothing stored means rupees', async () => {
  const { box } = page('products.html', { branch: { currency: 'Rs' } });
  await box.rememberShop();
  assert.strictEqual(box.money(120), 'Rs 120');
  assert.strictEqual(box.money(120.5), 'Rs 120.50');

  const { box: bare } = page('products.html');
  await bare.rememberShop();
  assert.strictEqual(bare.money(120), '₹120');
});

/* ------------------------------------------------------------- the bar */

test('the bar is gone while the order is empty and back the moment it is not', async () => {
  const { document, box } = page('products.html');
  await box.updateCart([]);
  assert.ok(document.getElementById('bill-bar').classList.contains('is-empty'));
  assert.strictEqual(document.getElementById('mobile-cart-count').getAttribute('data-zero'), 'true');
  assert.strictEqual(document.getElementById('next-btn').disabled, true);

  await box.updateCart([{ id: 'p1', name: 'Paneer Tikka', price: 280, quantity: 2 }]);
  assert.ok(!document.getElementById('bill-bar').classList.contains('is-empty'));
  assert.strictEqual(document.getElementById('cart-qty').textContent, '2');
  assert.strictEqual(document.getElementById('cart-qty-word').textContent, 'items');
  assert.strictEqual(document.getElementById('cart-total').textContent, '₹560');
  assert.strictEqual(document.getElementById('next-btn').disabled, false);
});

test('on a wide screen the order builds in a panel beside the menu', async () => {
  const { document, box } = page('products.html');
  await box.updateCart([
    { id: 'p1', name: 'Paneer Tikka', price: 280, quantity: 2 },
    { id: 'p2', name: 'Masala Dosa', price: 120, quantity: 1 },
  ]);
  const lines = document.querySelectorAll('#order-panel-lines .panel-line');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0].textContent, /2×\s*Paneer Tikka\s*₹560/);
  assert.strictEqual(document.getElementById('order-panel-total').textContent, '₹680');
  assert.strictEqual(document.getElementById('order-panel-next').disabled, false);

  await box.updateCart([]);
  assert.match(document.getElementById('order-panel-lines').textContent, /Nothing yet/);
  assert.strictEqual(document.getElementById('order-panel-next').disabled, true);
});

/* ------------------------------------------------------------ the order */

test('the order page draws each line and the sums, hiding a tax row of nothing', async () => {
  const { document, box } = page('cart.html', {
    cart: [
      { id: 'p1', name: 'Paneer Tikka', price: 280, tax_price: 0, quantity: 2, img: '/uploads/paneer.jpg', diet: 'veg' },
      { id: 'p2', name: 'Masala Dosa', price: 120, tax_price: 0, quantity: 1, icon: '🥞' },
    ],
  });
  await box.renderCart();

  const rows = document.querySelectorAll('#cart-summary .cart-item');
  assert.strictEqual(rows.length, 2);
  assert.match(rows[0].querySelector('.item-name').textContent, /Paneer Tikka/);
  assert.ok(rows[0].querySelector('.item-name .product-diet'), 'the veg mark left the order page');
  assert.strictEqual(rows[0].querySelector('.unit-price').textContent, '₹280 each');
  assert.strictEqual(rows[0].querySelector('.total-price').textContent, '₹560');
  assert.strictEqual(rows[1].querySelector('.item-icon').textContent, '🥞');

  assert.strictEqual(document.getElementById('bill').hidden, false);
  assert.strictEqual(document.getElementById('bill-tax-row').hidden, true, 'a row reading "Taxes ₹0"');
  assert.ok(document.getElementById('bill').classList.contains('bill-plain'), 'a divider hangs above a total with nothing over it');
  assert.strictEqual(document.getElementById('bill-total').textContent, '₹680');
  assert.strictEqual(document.getElementById('summary-display').textContent, '3 items · ₹680');
});

test('tax that is added on top is shown as its own row', async () => {
  const { document, box } = page('cart.html', {
    cart: [{ id: 'p1', name: 'Paneer Tikka', price: 294, tax_price: 14, quantity: 1 }],
  });
  await box.renderCart();
  assert.strictEqual(document.getElementById('bill-tax-row').hidden, false);
  assert.ok(!document.getElementById('bill').classList.contains('bill-plain'));
  assert.strictEqual(document.getElementById('bill-items').textContent, '₹280');
  assert.strictEqual(document.getElementById('bill-tax').textContent, '₹14');
  assert.strictEqual(document.getElementById('bill-total').textContent, '₹294');
});

test('an empty order says so rather than showing a blank page', async () => {
  const { document, box } = page('cart.html', { cart: [] });
  await box.renderCart();
  assert.match(document.getElementById('cart-summary').textContent, /Your order is empty/);
  assert.strictEqual(document.getElementById('bill').hidden, true);
  assert.strictEqual(document.getElementById('next-btn').disabled, true);
});

/* ------------------------------------------------------------- the look */

test('no gradient anywhere, and no framework fetched to draw one glyph', () => {
  const css = [
    read('assets/order.css'),
    read('assets/channel-state.css'),
    read('indexedDB.js'),
    ...CUSTOMER_PAGES.map(read),
  ].join('\n');
  assert.ok(!/gradient\(/.test(css), 'a gradient is back');

  for (const p of CUSTOMER_PAGES) {
    const html = read(p);
    assert.ok(!/bootstrap/.test(html), `${p} loads Bootstrap again`);
    assert.ok(!/font-awesome|fontawesome/i.test(html), `${p} fetches Font Awesome again`);
    assert.match(html, /assets\/order\.css/, `${p} does not load the shared stylesheet`);
    assert.match(html, /viewport-fit=cover/, `${p} will not clear the notch`);
  }
});

test('the pages run the current jQuery, not the one from 2021', () => {
  assert.ok(fs.existsSync(path.join(BUNDLE, 'assets', 'jquery-3.7.1.min.js')));
  assert.ok(!fs.existsSync(path.join(BUNDLE, 'assets', 'jquery-3.6.0.min.js')), 'the old jQuery is still shipped');
  for (const p of fs.readdirSync(BUNDLE).filter((f) => f.endsWith('.html'))) {
    const html = read(p);
    if (html.includes('jquery-')) assert.match(html, /jquery-3\.7\.1\.min\.js/, `${p} loads an old jQuery`);
  }
});

test('a wide screen gets a wide layout: a rail, a grid and the order beside it', () => {
  const css = read('assets/order.css');
  const wide = css.slice(css.indexOf('@media (min-width: 1024px)'));
  assert.ok(wide.length > 0, 'no desktop layout');
  assert.match(wide, /grid-template-columns:\s*220px minmax\(0, 1fr\) 340px/, 'the three columns are gone');
  assert.match(wide, /\.category-rail\s*\{[^}]*position:\s*sticky/, 'the rail does not stay put');
  assert.match(wide, /\.order-panel\s*\{[^}]*position:\s*sticky/, 'the order panel does not stay put');
  assert.match(wide, /\.cart-footer\s*\{\s*display:\s*none/, 'the phone bar is still there on a laptop');
  /* The grid is the ordering page's alone. On the order page it scattered
     the lines, the bill and the clear button across three columns. */
  assert.match(wide, /\.order-layout\s*\{[^}]*display:\s*grid/, 'the three columns are not scoped to the ordering page');
  assert.ok(!/\.content-wrapper\s*\{[^}]*display:\s*grid/.test(wide), 'every page with a content-wrapper gets the three columns');
  assert.match(read('products.html'), /class="content-wrapper order-layout"/);
  assert.ok(!read('cart.html').includes('order-layout'), 'the order page took the three-column grid');

  const html = read('products.html');
  for (const id of ['category-rail', 'order-panel', 'order-panel-lines', 'order-panel-total', 'order-panel-next']) {
    assert.match(html, new RegExp(`id="${id}"`), `products.html has no #${id}`);
  }
});

test('every action answers, and a phone that asked for less motion gets less', () => {
  const css = read('assets/order.css');
  for (const name of ['qty-pop', 'sheet-up', 'line-in', 'order-bump', 'draw', 'fade-up', 'sk-pulse']) {
    assert.match(css, new RegExp(`@keyframes ${name}\\b`), `the ${name} animation is gone`);
  }
  assert.match(css, /:active[^{]*\{[^}]*transform:\s*scale/, 'a press no longer answers');
  assert.match(css, /@media \(hover: hover\)/, 'hover states leak onto touch screens');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration:\s*0\.01ms/, 'reduced motion is not honoured');
  /* The skeleton while loading, in place of a wheel. */
  assert.match(read('products.html'), /class="skeleton-card"/, 'the loading state is a spinner again');
  /* And the number pops when it changes. */
  assert.match(read('indexedDB.js'), /pop\(\$qty\)/, 'a changed count no longer pops');
});

test('every control is sized for a thumb, and focus is visible', () => {
  const css = read('assets/order.css');
  assert.match(css, /--tap:\s*44px/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.cart-controls button\s*\{[^}]*width:\s*40px/);
  assert.match(css, /\.keypad button\s*\{[^}]*min-height:\s*56px/);
});

/* ------------------------------------------------------------ paying */

test('the button says what happens, and the question cannot be skipped', () => {
  const js = read('assets/payment/script.js');
  assert.match(js, /`Pay \$\{money\(payState\.total\)\}`/, 'the button no longer says the amount');
  assert.match(js, /"Place order"/, 'a cash order is still told to "proceed to payment"');
  /*
   * With no number wanted, the page went straight to the payment - fine while
   * the door asked dine-in-or-take-away, and a kitchen ticket with no answer
   * once it did not. The auto path now waits for the answer.
   */
  assert.match(js, /const needsType = !localStorage\.getItem\("orderType"\)/);
  assert.match(js, /if \(!showPhoneInput && !needsType\)/, 'the auto path skips the dine-in question');
  /* The number is shown, not masked into "98XX56XXX1". */
  assert.ok(!js.includes('maskMobileNumber'), 'the number is masked again');
  assert.match(js, /function formatMobileNumber/);
  /* And it is asked for only when the shop wants it. */
  assert.match(js, /payState\.phoneRequired && !numberIsValid\(\)/);
});

test('the number is grouped the way it is printed', () => {
  const js = read('assets/payment/script.js');
  const fn = new Function(`${lift(js, 'formatMobileNumber')}; return formatMobileNumber;`)();
  assert.strictEqual(fn('9876543210'), '98765 43210');
  assert.strictEqual(fn('98765'), '98765');
  assert.strictEqual(fn(''), '');
});

/* --------------------------------------------------------- the words */

test('the pages speak to a person at a table, not to a shopping website', () => {
  /* Comments stripped: the pages explain what the old words were. */
  const read = (f) => fs.readFileSync(path.join(BUNDLE, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!read('products.html').includes('Self-Ordering'), 'the page names the software again');
  assert.match(read('products.html'), /id="shop-name"/, 'the shop has nowhere to put its name');
  assert.ok(!read('cart.html').includes('Shopping Cart'));
  assert.match(read('cart.html'), /<h1>Your order<\/h1>/);
  assert.ok(!read('payment.html').includes('PROCEED TO PAYMENT'));
  assert.ok(!read('thankyou.html').includes('Payment Successful'));
  assert.match(read('thankyou.html'), /Order placed/);
  assert.match(read('thankyou.html'), /Show this at the counter/);
});
