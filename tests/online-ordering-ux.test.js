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
function page(html, { cart = [], branch = {}, products = {} } = {}) {
  const dom = new JSDOM(read(html), { url: 'https://shop.example/order/' + html, runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(read('assets/jquery-3.7.1.min.js'));

  const src = read('indexedDB.js');
  const code = [
    'const BRANCH_STORE = "branch";',
    lift(src, 'escapeHtml'),
    lift(src, 'getSafeImageUrl'),
    'const shop = { name: "", currency: "", currencyCode: "", kind: "restaurant", notes: false, fulfilment: [], payment: {} };',
    lift(src, 'rememberShop'),
    lift(src, 'money'),
    lift(src, 'words'),
    'const STORE_ADDRESS_KEY = "posnic_store";',
    lift(src, 'storeAddressFromRow'),
    lift(src, 'rememberStoreAddress'),
    lift(src, 'knownBranchId'),
    lift(src, 'recoverDefaultStore'),
    lift(src, 'placeLabel'),
    lift(src, 'paintShop'),
    lift(src, 'chargeFor'),
    lift(src, 'markCategories'),
    lift(src, 'setCartItemNote'),
    liftConst(src, 'DIET_WORDS'),
    lift(src, 'dietMarkHtml'),
    lift(src, 'pop'),
    lift(src, 'renderOrderPanel'),
    lift(src, 'updateCart'),
    lift(src, 'renderProductCards'),
    /* var, not let: a let in a vm context is a lexical binding the test
       cannot reach, and this one has to be settable from outside. */
    'var orderJustPlaced = false;',
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
    saveCartData: async () => {},
    products,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    t: (key, vars) => String(key).replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] != null ? String(vars[name]) : m)),
    getData: async (store) => (store === 'branch' ? [{ id: 'b1', ...branch }] : []),
    getKioskImages: async () => null,
    allProducts: () => Object.values(products).flat(),
    CONFIG: { API_BASE_URL: '' },
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

test('a long dish name cannot push a column under the order panel', () => {
  /*
   * Seen on a laptop with "White Envelopes 25 envelope pack": a bare 1fr
   * track is minmax(auto, 1fr) and cannot shrink below a one-line name, so
   * the two tracks grew past the column and the second card slid under the
   * panel. Every dish track has a floor of zero, on both pages.
   */
  const css = read('assets/order.css');
  assert.ok(!/grid-template-columns:\s*1fr 1fr/.test(css), 'a bare 1fr track is back in order.css');
  assert.match(css, /\.product-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.product-name\s*\{[^}]*min-width:\s*0/, 'the name has no floor of its own');
  const menu = fs.readFileSync(path.join(__dirname, '..', 'menu', 'index.html'), 'utf8');
  assert.ok(!/grid-template-columns:\s*1fr 1fr/.test(menu), 'a bare 1fr track is back in the menu');
  assert.match(menu, /\.dish-name\s*\{[^}]*min-width:\s*0/);
});

test('the shop name arrives on a browser that already had the menu', () => {
  /* The header read the stored branch row, which on an older row had no
     name, and said "Menu" until the next visit. */
  const js = read('indexedDB.js');
  const fetchFn = js.slice(js.indexOf('async function fetchAndStoreBranch('));
  assert.match(fetchFn.slice(0, fetchFn.indexOf('validateCartWithProducts')), /paintShop\(\)/, 'the header is not repainted after a refresh');
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
  assert.match(js, /t\("Pay \{amount\}", \{ amount: money\(payState\.total\) \}\)/, 'the button no longer says the amount');
  assert.match(js, /"Place order"/, 'a cash order is still told to "proceed to payment"');
  /*
   * With no number wanted, the page went straight to the payment - fine while
   * the door asked dine-in-or-take-away, and a kitchen ticket with no answer
   * once it did not. The auto path now waits for the answer.
   */
  assert.match(js, /const settled = choices\.length === 1/, 'the auto path no longer asks whether anything is left to ask');
  assert.match(js, /if \(!showPhoneInput && !needsType && oneWayToPay && settled\)/, 'the auto path skips a question');
  /* The number is shown, not masked into "98XX56XXX1". */
  assert.ok(!js.includes('maskMobileNumber'), 'the number is masked again');
  assert.match(js, /function formatMobileNumber/);
  /* And it is asked for only when the shop wants it. */
  assert.match(js, /phoneWanted\(\) && !numberIsValid\(\)/);
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
  /* Comments stripped: the pages explain what the old words were. Stripped
     until nothing changes, so a comment left behind by the first pass
     cannot hide a word from the check. */
  const stripComments = (html) => {
    let out = html;
    let before;
    do {
      before = out;
      out = out.replace(/<!--[\s\S]*?-->/g, '');
    } while (out !== before);
    return out;
  };
  const read = (f) => stripComments(fs.readFileSync(path.join(BUNDLE, f), 'utf8'));
  assert.ok(!read('products.html').includes('Self-Ordering'), 'the page names the software again');
  assert.match(read('products.html'), /id="shop-name"/, 'the shop has nowhere to put its name');
  assert.ok(!read('cart.html').includes('Shopping Cart'));
  assert.match(read('cart.html'), /<h1>Your order<\/h1>/);
  assert.ok(!read('payment.html').includes('PROCEED TO PAYMENT'));
  assert.ok(!read('thankyou.html').includes('Payment Successful'));
  assert.match(read('thankyou.html'), /Order placed/);
  assert.match(read('thankyou.html'), /Show this at the counter/);
});

/* --------------------------------------------- a restaurant, or a shop */

test('a restaurant line takes a note for the kitchen; a shop line does not', async () => {
  /* Owner: "no way to add customization ... that will be printed in kot". */
  const { document, box } = page('cart.html', {
    cart: [{ id: 'p1', name: 'Paneer Tikka', price: 280, tax_price: 0, quantity: 1, note: 'less spicy' }],
    branch: { kind: 'restaurant', notes: true },
  });
  await box.rememberShop();
  await box.renderCart();
  const row = document.querySelector('.cart-item');
  assert.strictEqual(row.querySelector('.item-note').textContent, 'less spicy');
  assert.strictEqual(row.querySelector('.line-note-btn').textContent, 'Edit request');
  assert.strictEqual(document.getElementById('order-note-label').textContent, 'A note for the kitchen');

  const shopPage = page('cart.html', {
    cart: [{ id: 'p1', name: 'Ball Pen', price: 80, tax_price: 0, quantity: 1 }],
    branch: { kind: 'retail', notes: false },
  });
  await shopPage.box.rememberShop();
  await shopPage.box.renderCart();
  assert.ok(!shopPage.document.querySelector('.line-note-btn'), 'a stationer was offered a kitchen note');
  assert.strictEqual(shopPage.document.getElementById('order-note-label').textContent, 'A note for the shop');
});

test('a category with something in the order carries the count', async () => {
  /* Owner: "keep that category with little highlight that some items we
     added from that category." */
  const { document, box } = page('products.html', {
    products: { starters: [{ id: 'p1' }, { id: 'p3' }], breads: [{ id: 'p2' }] },
  });
  document.getElementById('category-list').innerHTML =
    '<button class="category-item" data-category="starters">Starters</button>' +
    '<button class="category-item" data-category="breads">Breads</button>';
  document.getElementById('category-rail').innerHTML =
    '<button class="category-item" data-category="starters">Starters</button>';

  await box.updateCart([
    { id: 'p1', name: 'Paneer Tikka', price: 280, quantity: 2 },
    { id: 'p3', name: 'Chicken 65', price: 290, quantity: 1 },
  ]);
  const chips = document.querySelectorAll('.category-item[data-category="starters"]');
  assert.strictEqual(chips.length, 2, 'the strip and the rail both carry the chip');
  chips.forEach((chip) => {
    assert.strictEqual(chip.getAttribute('data-count'), '3');
    assert.ok(chip.classList.contains('has-items'));
  });
  const breads = document.querySelector('.category-item[data-category="breads"]');
  assert.strictEqual(breads.getAttribute('data-count'), '0');
  assert.ok(!breads.classList.contains('has-items'));

  await box.updateCart([]);
  assert.ok(!document.querySelector('.category-item.has-items'), 'an emptied order left a count behind');
});

test('the words follow the kind of shop', async () => {
  const kitchen = page('products.html', { branch: { kind: 'restaurant' } });
  await kitchen.box.rememberShop();
  assert.deepStrictEqual(kitchen.box.words().many, 'dishes');
  const shop = page('products.html', { branch: { kind: 'retail' } });
  await shop.box.rememberShop();
  assert.deepStrictEqual(shop.box.words().many, 'items');
  assert.strictEqual(shop.box.words().menu, 'Products');
});

/* ------------------------------------------------- how the food travels */

function payBox() {
  const js = read('assets/payment/script.js');
  const code = [
    'const money = (n) => "₹" + n;',
    /* var, not const: a const in a vm script is not a property of its
       global, and the tests reach in through the global. */
    liftConst(js, 'payState').replace('const payState', 'var payState'),
    lift(js, 'fulfilmentChoices'),
    lift(js, 'fulfilmentLabel'),
    lift(js, 'orderTypeFor'),
    lift(js, 'offlineLabel'),
  ].join('\n');
  const sandbox = {
    Set,
    String,
    Array,
    Number,
    t: (key, vars) => String(key).replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] != null ? String(vars[name]) : m)),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

test('a restaurant offers the table, the counter and delivery, in its own words', () => {
  const box = payBox();
  box.payState.kind = 'restaurant';
  box.payState.fulfilment = ['dine_in', 'takeaway', 'delivery'];
  assert.deepStrictEqual(Array.from(box.fulfilmentChoices()), ['dine_in', 'takeaway', 'delivery']);
  box.payState.tableFromCode = '5';
  assert.strictEqual(box.fulfilmentLabel('dine_in'), 'Bring it to table 5');
  box.payState.tableFromCode = '';
  assert.strictEqual(box.fulfilmentLabel('dine_in'), 'Bring it to my table');
  assert.strictEqual(box.fulfilmentLabel('takeaway'), "I'll collect it at the counter");
  assert.strictEqual(box.orderTypeFor('dine_in'), 'DINE IN');
  assert.strictEqual(box.orderTypeFor('takeaway'), 'PARCEL');
});

test('a shop offers collection and delivery, and is never asked about a table', () => {
  const box = payBox();
  box.payState.kind = 'retail';
  box.payState.fulfilment = ['dine_in', 'takeaway', 'delivery'];
  /* The shop's own switches say dine-in and takeaway, as the defaults do;
     for a shop that means collect or deliver. */
  assert.deepStrictEqual(Array.from(box.fulfilmentChoices()), ['pickup', 'delivery']);
  assert.strictEqual(box.fulfilmentLabel('pickup'), "I'll collect it from the shop");
  box.payState.chosen = 'delivery';
  assert.strictEqual(box.offlineLabel(), 'Pay on delivery');
  box.payState.chosen = 'pickup';
  assert.strictEqual(box.offlineLabel(), 'Pay when collecting');
});

test('a shop that never set the ways gets the sensible default for its kind', () => {
  const box = payBox();
  box.payState.kind = 'retail';
  box.payState.fulfilment = [];
  assert.deepStrictEqual(Array.from(box.fulfilmentChoices()), ['pickup']);
  box.payState.kind = 'restaurant';
  assert.deepStrictEqual(Array.from(box.fulfilmentChoices()), ['dine_in', 'takeaway']);
});

test('paying offline finishes an order, and the table on the code reaches it', () => {
  const js = read('assets/payment/script.js');
  assert.ok(!js.includes('has not set up a way to pay online yet'), 'a shop with no gateway is still turned away');
  assert.match(js, /offline: razorpay \? cod : true|kioskPayment\.offline/, 'the page does not read the offline flag');
  assert.match(js, /payingOnline\(\)/, 'the button does not follow the chosen way to pay');
  assert.match(js, /if \(!ensureDetails\(\)\) return;/, 'a delivery can go without an address');

  const db = read('indexedDB.js');
  assert.match(db, /item_note: String\(item\.note/, 'the note on a line is not sent');
  assert.match(db, /fulfilment: fulfilment,\s*table: table,/, 'how the food travels and the table are not sent');
  assert.match(db, /customer_name: customerName/, 'a delivery goes without a name');
  assert.match(read('assets/service-point.js'), /table: point\.table \|\| '',/, 'the table on the printed code is not carried into the order');
  assert.match(read('assets/index/script.js'), /if \(note\) localStorage\.setItem\('note', note\);/, 'a plain link stores the word "null" as the note');

  const html = read('payment.html');
  for (const id of ['table-field', 'table-number', 'delivery-form', 'customer-name', 'customer-address', 'pay-method', 'pay-offline-btn']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'payment.html has no #' + id);
  }
  assert.match(read('products.html'), /id="dish-note"/, 'the dish sheet has nowhere for a note');
  assert.match(read('products.html'), /id="shop-place"/, 'the page has nowhere to say which table');
  assert.match(read('cart.html'), /id="order-note"/, 'the order page has nowhere for a note');
});

/* ------------------------------------------- the fee, before the button */

test('the fee and the minimum are computed the way the server computes them', async () => {
  /* Owner's gap: the shop can set a fee, a free-above and a minimum per way
     of travelling, and the page never said so until the token page or a
     refusal. Same arithmetic as utils/sales-channels.chargesFor. */
  const { box } = page('products.html', {
    branch: { charges: { delivery: { fee: 30, free_above: 500, min_order: 200 }, takeaway: { fee: 10, free_above: 0, min_order: 0 } } },
  });
  await box.rememberShop();

  const short = box.chargeFor('delivery', 150);
  assert.strictEqual(short.allowed, false);
  assert.strictEqual(short.short, 50);
  assert.strictEqual(short.minimum, 200);

  const charged = box.chargeFor('delivery', 300);
  assert.strictEqual(charged.allowed, true);
  assert.strictEqual(charged.fee, 30);
  assert.strictEqual(charged.toFree, 200);

  const free = box.chargeFor('delivery', 500);
  assert.strictEqual(free.fee, 0);
  assert.strictEqual(free.waived, true);

  assert.strictEqual(box.chargeFor('takeaway', 50).fee, 10);
  assert.strictEqual(box.chargeFor('dine_in', 50).fee, 0);
  assert.strictEqual(box.chargeFor('', 50).allowed, true);
});

test('the payment page has somewhere to say the fee, and the receipt names it', () => {
  const html = read('payment.html');
  for (const id of ['pay-charges', 'pay-subtotal', 'pay-fee-label', 'pay-fee', 'pay-charge-note']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'payment.html has no #' + id);
  }
  const js = read('assets/payment/script.js');
  assert.match(js, /function paintCharges/, 'the fee is not drawn');
  assert.match(js, /payState\.allowed === false/, 'the button does not wait for the minimum');
  assert.match(js, /t\("Add \{amount\} more", \{ amount: money\(charge\.short\) \}\)/, 'the button does not say how much more');
  assert.match(js, /createRazorPayMobile\(payState\.total \|\| totalAmount/, 'the gateway is asked for the food without the fee');
  assert.match(read('thankyou.html'), /id="fee-row"/, 'the receipt has no line for the fee');
  assert.match(read('assets/thankyou/script.js'), /receiptData\.delivery_fee/, 'the receipt does not read the fee');
});

/* --------------------------------------------------- the machine's screen */

test('the kiosk machine rests on a screen in the same clothes', () => {
  const html = read('home.html');
  assert.match(html, /assets\/order\.css/, 'the resting screen does not use the shared stylesheet');
  assert.ok(!/bootstrap|gradient\(/.test(html), 'the resting screen still carries the old look');
  assert.match(html, /data-fulfilment="dine_in"/);
  assert.match(html, /data-fulfilment="takeaway"/);
  assert.match(html, /id="attract-name"/, 'the screen has nowhere for the shop\'s name');
  assert.match(html, /order_fulfilment/, 'the choice made here does not reach the payment page');
  const css = read('assets/order.css');
  assert.match(css, /\.attract-choice\s*\{[^}]*min-height:\s*220px/, 'the targets are not sized for a hand from a metre away');
  assert.ok(!/gradient\(/.test(read('assets/home/script.js')));
});

/* ------------------------------------------------------ the Kiosk column */

test('the Items list no longer carries the legacy Kiosk column', () => {
  const items = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'), 'utf8');
  assert.ok(!items.includes('kiosk-column'), 'the Kiosk column is back on the Items list');
  assert.ok(!items.includes('kiosk-toggle'), 'the per-item kiosk tick is back');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'controllers', 'items.controller.js'), 'utf8');
  assert.ok(!controller.includes('kiosk_configured'), 'the list still computes whether to draw the column');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'api', 'src', 'utils', 'kiosk.js')), 'utils/kiosk.js is back');
});

test('a shop is searched, not a menu, and is not asked about veg', async () => {
  const shop = page('products.html', {
    branch: { kind: 'retail', name: 'Kirana Corner' },
    products: { stationery: [{ id: 'p1', name: 'Ball Pen', price: 10, category_name: 'Stationery' }] },
  });
  await shop.box.paintShop();
  assert.strictEqual(shop.document.getElementById('product-search').placeholder, 'Search products');
  assert.strictEqual(shop.document.querySelector('#order-sort option[value="menu"]').textContent, 'Catalogue order');
  assert.strictEqual(shop.document.getElementById('order-filter-veg').hidden, true, 'a stationer is asked about veg');

  const kitchen = page('products.html', {
    branch: { kind: 'restaurant', name: 'Azure' },
    products: { mains: [{ id: 'p1', name: 'Dal Tadka', price: 220, diet: 'veg', category_name: 'Mains' }] },
  });
  await kitchen.box.paintShop();
  assert.strictEqual(kitchen.document.getElementById('product-search').placeholder, 'Search the menu');
  assert.strictEqual(kitchen.document.getElementById('order-filter-veg').hidden, false);
});

/* ------------------------------------------------- the photo is the top */

test('the photo is the top of the sheet, edge to edge, on both pages', () => {
  /* Owner, with a screenshot: the picture had been inset with white around
     it; "previously you made top corners with image. it was good in mobile.
     please change back." Both pages, or the two sheets drift apart. */
  const menuCss = fs.readFileSync(path.join(__dirname, '..', 'menu', 'index.html'), 'utf8');
  const orderCss = read('assets/order.css');
  for (const [name, css] of [['menu', menuCss], ['order', orderCss]]) {
    const img = css.match(/\.sheet-strip img\s*\{([^}]*)\}/);
    assert.ok(img, name + ': no rule for the photos in the strip');
    assert.match(img[1], /flex:\s*0 0 100%/, name + ': a photo no longer fills the sheet');
    assert.ok(!/border-radius/.test(img[1]), name + ': the photo has its own corners again instead of the sheet\'s');
    const strip = css.match(/\.sheet-strip\s*\{([^}]*)\}/);
    assert.ok(!/padding:\s*0 12px/.test(strip[1]), name + ': the strip is inset again');
    const handle = css.match(/\.sheet-handle\s*\{([^}]*)\}/);
    assert.match(handle[1], /position:\s*absolute/, name + ': the handle pushes the photo down from the top');
    const gallery = css.match(/\.sheet-gallery\s*\{([^}]*)\}/);
    assert.ok(gallery && !/-4px/.test(gallery[1]), name + ': the gallery still carries the old negative margin');
  }
  assert.match(read('products.html'), /id="dish-gallery" class="sheet-gallery"/, 'the order page gallery lost the class the shared rules key on');
});

/* ------------------------------------------------ the shop's address */

test('a browser with a stale branch row still knows which shop it is in', async () => {
  /* Owner, with a screenshot of the cart behind "Unable to reach the server,
     Product sync failed (404): No shop found at this address": the cart had
     asked for /online-ordering/undefined. His browser met the shop through
     an older bundle whose branch row had no id. */
  const stale = page('cart.html', { branch: { name: 'Azure', kind: 'restaurant' } });
  delete stale.box.getData;
  stale.box.getData = async (store) => (store === 'branch' ? [{ store_id: 'AZ100', name: 'Azure' }] : []);
  assert.strictEqual(await stale.box.knownBranchId(), 'AZ100', 'a legacy row key is not read');

  const kept = page('cart.html', {});
  kept.box.getData = async () => [];
  kept.box.localStorage = { getItem: (k) => (k === 'posnic_store' ? 'KC200' : null), setItem() {}, removeItem() {} };
  assert.strictEqual(await kept.box.knownBranchId(), 'KC200', 'the address kept from the last load is not read');

  const nothing = page('cart.html', {});
  nothing.box.getData = async () => [];
  assert.strictEqual(await nothing.box.knownBranchId(), '', 'an unknown shop should be empty, never "undefined"');
});

test('the cart and the payment page never refresh with an address they do not have', () => {
  const cart = read('assets/cart/script.js');
  assert.ok(!cart.includes('branches[0]?.id'), 'the cart still reads the row directly');
  assert.match(cart, /const branchId = await knownBranchId\(\);\s*if \(branchId\) await fetchAndStoreBranch/, 'the cart refreshes without an address');
  const pay = read('assets/payment/script.js');
  assert.ok(!pay.includes('branches[0]?.id'), 'the payment page still reads the row directly');
  const db = read('indexedDB.js');
  assert.match(db, /if \(!branchId\) \{[\s\S]{0,400}return false;/, 'fetchAndStoreBranch still asks the server for "undefined"');
  assert.ok(!/branches\[0\]\.id/.test(db), 'indexedDB.js still reads the row directly somewhere');
});

test('"null" left in the note box by an older build is read as nothing', async () => {
  const { document, box } = page('cart.html', { cart: [{ id: 'p1', name: 'Dal', price: 100, quantity: 1 }], branch: { kind: 'restaurant', notes: true } });
  box.localStorage = { getItem: (k) => (k === 'note' ? 'null' : null), setItem() {}, removeItem() {} };
  await box.renderCart(await box.getCartData());
  assert.strictEqual(document.getElementById('order-note').value, '', 'the word "null" is shown as the note');
});

test('a dish says in plain words that a request can be made on it', async () => {
  const { document, box } = page('cart.html', { cart: [{ id: 'p1', name: 'Dal', price: 100, quantity: 1 }], branch: { kind: 'restaurant', notes: true } });
  await box.rememberShop();
  await box.renderCart(await box.getCartData());
  assert.match(document.querySelector('.line-note-btn').textContent, /less spicy/i, 'the line does not invite a request');
  assert.match(read('products.html'), /Any request for this dish\?/);
  assert.match(read('cart.html'), /Any request for this dish\?/);
});

test('a shop address the server no longer knows is recovered from the origin default, not walled off', async () => {
  /* The sandbox was re-seeded overnight and came back as FJ5AF; the owner's
     browser still remembered ABC123. Every refresh was a 404 in a wall. */
  const { box } = page('cart.html', {});
  box.CONFIG = { API_BASE_URL: '' };
  const asked = [];
  box.fetch = async (url) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => ({ type: 'success', data: { store: { id: 'FJ5AF', name: 'Develop Sandbox Store' } } }) };
  };
  assert.strictEqual(await box.recoverDefaultStore('ABC123'), 'FJ5AF');
  assert.deepStrictEqual(asked, ['/online-ordering'], 'the origin default is asked for at its own address');
  assert.strictEqual(await box.recoverDefaultStore('FJ5AF'), '', 'the dead address itself is never offered back');
  box.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.strictEqual(await box.recoverDefaultStore('ABC123'), '', 'no default is no recovery, quietly');

  const db = read('indexedDB.js');
  assert.match(db, /response\.status === 404 && !options\?\.recovered/, 'a 404 for a remembered shop no longer tries the origin default');
  assert.match(db, /await forgetShop\(\);\s*return fetchAndStoreBranch\(next, redirect, \{ \.\.\.options, recovered: true \}\)/, 'the dead shop is not forgotten before the new one is loaded');
});

/* ------------------------------------------------------ the assistant */

/**
 * The products page with the assistant script running, a shop flag, and a
 * server that answers what the test says.
 */
function assistantPage({ assistant = true, reply } = {}) {
  const dom = new JSDOM(read('products.html'), { url: 'https://shop.example/order/products.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { fetch: [], updateQuantity: [], notes: [] };
  let cart = [{ id: 'd1', name: 'Fresh Lime Soda', price: 80, quantity: 1 }];
  window.shop = { assistant, name: 'Azure' };
  window.CONFIG = { API_BASE_URL: '' };
  window.knownBranchId = async () => 'AZ100';
  window.getCartData = async () => JSON.parse(JSON.stringify(cart));
  window.updateQuantity = async (id, change) => {
    calls.updateQuantity.push([id, change]);
    const line = cart.find((l) => String(l.id) === String(id));
    if (line) line.quantity += change;
    else cart.push({ id, name: id, price: 0, quantity: change });
    cart = cart.filter((l) => l.quantity > 0);
  };
  window.setCartItemNote = async (id, note) => { calls.notes.push([id, note]); };
  window.fetch = async (url, init) => {
    calls.fetch.push({ url, body: JSON.parse(init.body) });
    const answer = typeof reply === 'function' ? reply(calls.fetch.length) : reply;
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  };
  /* <dialog> is not fully implemented in jsdom; the open flag is enough. */
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.eval(read('assets/assistant/script.js'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document: window.document, calls, cart: () => cart };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('the spark is drawn only where the shop opened its assistant', () => {
  const off = assistantPage({ assistant: false, reply: { status: 200, body: {} } });
  assert.strictEqual(off.document.getElementById('ask-ai').hidden, true);
  const on = assistantPage({ assistant: true, reply: { status: 200, body: {} } });
  assert.strictEqual(on.document.getElementById('ask-ai').hidden, false);
  /* And follows the shop when it changes under the page. */
  on.window.shop.assistant = false;
  on.document.dispatchEvent(new on.window.Event('posnic:shop'));
  assert.strictEqual(on.document.getElementById('ask-ai').hidden, true);
});

test('a question goes to the shop with the conversation and the order, and the answer is applied through the same code as a tap', async () => {
  const { window, document, calls, cart } = assistantPage({
    reply: {
      status: 200,
      body: {
        type: 'success',
        data: {
          reply: 'Two Chicken Biryani, less spicy, coming up.',
          actions: [
            { verb: 'add', item_id: 'm1', name: 'Chicken Biryani', quantity: 2, note: 'less spicy' },
            { verb: 'remove', item_id: 'd1', name: 'Fresh Lime Soda', quantity: 0 },
          ],
        },
      },
    },
  });
  document.getElementById('ask-ai').click();
  assert.strictEqual(document.getElementById('assistant').open, true);
  assert.match(document.getElementById('assistant-log').textContent, /Tell me what you feel like/, 'no greeting');

  await window.OrderingAssistant.send('Two biryani, less spicy, and drop the soda');
  await settle();

  assert.strictEqual(calls.fetch.length, 1);
  assert.strictEqual(calls.fetch[0].url, '/online-ordering/AZ100/assistant');
  assert.deepStrictEqual(calls.fetch[0].body.messages, [{ role: 'user', text: 'Two biryani, less spicy, and drop the soda' }]);
  assert.deepStrictEqual(calls.fetch[0].body.cart, [{ id: 'd1', quantity: 1, note: '' }]);

  assert.deepStrictEqual(calls.updateQuantity, [['m1', 2], ['d1', -1]], 'the order was not changed through updateQuantity');
  assert.deepStrictEqual(calls.notes, [['m1', 'less spicy']]);
  assert.deepStrictEqual(cart().map((l) => [l.id, l.quantity]), [['m1', 2]]);

  const log = document.getElementById('assistant-log').textContent;
  assert.match(log, /Two Chicken Biryani, less spicy, coming up\./);
  assert.match(log, /Added 2 × Chicken Biryani/);
  assert.match(log, /Request noted: less spicy/);
  assert.match(log, /Removed Fresh Lime Soda/);
  assert.strictEqual(document.getElementById('assistant-chips').hidden, true, 'the starter chips stay after the first question');
  /* The next turn carries the whole conversation. */
  assert.deepStrictEqual([...window.OrderingAssistant.state.messages].map((m) => m.role), ['user', 'assistant']);
});

test('a shop that switched it off since the page loaded takes the spark away; a busy minute and a bad day keep the menu working', async () => {
  const off = assistantPage({ reply: { status: 403, body: { type: 'error', message: 'off' } } });
  await off.window.OrderingAssistant.send('hello');
  await settle();
  assert.strictEqual(off.document.getElementById('ask-ai').hidden, true);
  assert.match(off.document.getElementById('assistant-log').textContent, /not available at this shop/);

  const busy = assistantPage({ reply: { status: 429, body: { type: 'error', message: 'slow down' } } });
  await busy.window.OrderingAssistant.send('hello');
  await settle();
  assert.match(busy.document.getElementById('assistant-log').textContent, /lot of questions/);
  assert.strictEqual(busy.window.OrderingAssistant.state.messages.length, 0, 'a refused turn stays in the conversation');

  const down = assistantPage({ reply: { status: 503, body: { type: 'error', message: 'cap' } } });
  await down.window.OrderingAssistant.send('hello');
  await settle();
  assert.match(down.document.getElementById('assistant-log').textContent, /menu still works/);
  assert.deepStrictEqual(down.calls.updateQuantity, []);
});

test('the reply is written as text, never as markup', async () => {
  const { window, document } = assistantPage({
    reply: { status: 200, body: { type: 'success', data: { reply: '<img src=x onerror=alert(1)> Try the <b>biryani</b>', actions: [] } } },
  });
  await window.OrderingAssistant.send('hi');
  await settle();
  assert.strictEqual(document.querySelectorAll('#assistant-log img, #assistant-log b').length, 0);
  assert.match(document.getElementById('assistant-log').textContent, /<b>biryani<\/b>/);
});

test('the wiring behind the spark: the storefront flag, the route, the switch, the console', () => {
  const repo = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'repositories', 'item.repository.js'), 'utf8');
  assert.match(repo, /\.\.\.\(await orderingAssistant\.storefrontFeatures\(/, 'the storefront does not say whether the assistant is available');
  assert.match(repo, /async storefrontContext\(/, 'a store address cannot be turned into a settings context');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'routes', 'online-ordering.routes.js'), 'utf8');
  assert.match(routes, /router\.post\('\/:storeId\/assistant', assistantLimiter, bind\(controller\.assistant\)\)/, 'the turn endpoint is missing or unlimited');
  const groups = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'services', 'settings-groups.js'), 'utf8');
  assert.match(groups, /'ai_ordering_assistant'/, 'the shop has no switch for the ordering page');
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'settings_write.html'), 'utf8');
  assert.match(html, /id="ai_ordering_assistant"/, 'the console has no switch');
  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
  assert.match(js, /ai_ordering_assistant: \$\('#ai_ordering_assistant'\)\.is\(':checked'\) \? 'true' : 'false'/, 'the switch is not saved');
  assert.match(read('indexedDB.js'), /assistant: !!\(result\.data\.features && result\.data\.features\.assistant\)/, 'the page never stores the flag');
  assert.match(read('products.html'), /id="assistant"[^>]*class="sheet assistant"/, 'the sheet is missing');
});

/* ------------------------------------------- the table the code named */

/** The payment page's "how would you like it" with the real painters. */
function payPage({ table = '', fulfilment = ['dine_in', 'takeaway', 'delivery'], kind = 'restaurant' } = {}) {
  const dom = new JSDOM(read('payment.html'), { url: 'https://shop.example/order/payment.html', runScripts: 'outside-only' });
  const { window } = dom;
  const js = read('assets/payment/script.js');
  const code = [
    /* var, not const: a const in a vm script never reaches the sandbox global. */
    liftConst(js, 'payState').replace('const payState', 'var payState'),
    lift(js, 'fulfilmentChoices'),
    lift(js, 'fulfilmentLabel'),
    lift(js, 'orderTypeFor'),
    lift(js, 'paintFulfilment'),
    lift(js, 'paintKnownPlace'),
    lift(js, 'askAgain'),
    lift(js, 'chooseFulfilment'),
    'function paintPayMethod() {} function paintProceed() {} function validateNumber() {}',
    'payState.kind = ' + JSON.stringify(kind) + '; payState.fulfilment = ' + JSON.stringify(fulfilment) + '; payState.tableFromCode = ' + JSON.stringify(table) + ';',
    'paintFulfilment();',
  ].join('\n');
  const sandbox = {
    window,
    document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    t: (key, vars) => String(key).replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] != null ? String(vars[name]) : m)),
    Set,
    String,
    Array,
    JSON,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { document: window.document, box: sandbox };
}

test('a table on the code is stated, not asked; Change brings the question back', () => {
  /* Owner: "if table number or venue already given via url (QR) then
     details prefilled and make sure its pre selected... do we need really
     ask first itself?" */
  const { document, box } = payPage({ table: '5' });
  const known = document.getElementById('eating-how-known');
  assert.strictEqual(known.hidden, false, 'the known table is not stated');
  assert.strictEqual(document.getElementById('eating-how-known-text').textContent, 'Bringing it to table 5');
  assert.strictEqual(document.getElementById('eating-how-choices').hidden, true, 'the question is still asked');
  assert.strictEqual(document.getElementById('eating-how-title').hidden, true);
  assert.strictEqual(box.payState.chosen, 'dine_in', 'the table is not preselected');

  /* The page wires the Change button to askAgain(); the harness lifts functions, not listeners. */
  assert.ok(read('assets/payment/script.js').includes('if (change) askAgain();'), 'the Change button is not wired');
  box.askAgain();
  assert.strictEqual(document.getElementById('eating-how-known').hidden, true, 'Change did not bring the question back');
  assert.strictEqual(document.getElementById('eating-how-choices').hidden, false);
  assert.strictEqual(document.querySelector('.eating-how-btn[aria-pressed="true"]').getAttribute('data-fulfilment'), 'dine_in', 'the table is no longer the pressed choice');

  box.chooseFulfilment('takeaway');
  assert.strictEqual(document.getElementById('eating-how-known').hidden, true);
  assert.strictEqual(document.querySelector('.eating-how-btn[aria-pressed="true"]').getAttribute('data-fulfilment'), 'takeaway');
});

test('with nothing known the question is asked, and a lone way is never a question', () => {
  const asked = payPage({ table: '' });
  assert.strictEqual(asked.document.getElementById('eating-how-known').hidden, true);
  assert.strictEqual(asked.document.getElementById('eating-how-choices').hidden, false);
  assert.strictEqual(asked.box.payState.chosen, '', 'a choice was made for a customer who said nothing');

  const lone = payPage({ table: '5', fulfilment: ['dine_in'] });
  assert.strictEqual(lone.document.getElementById('eating-how-known').hidden, true, 'one way needs no Change');
  assert.strictEqual(lone.box.payState.chosen, 'dine_in');
});

test('no customer page fetches a script from another host', () => {
  /* Owner, after an order on the sandbox: "cant find variable: html2pdf".
     The receipt page pulled its PDF library from a CDN; the page's own
     policy allows scripts from its own origin only, and a kiosk on the
     shop's wifi has no CDN anyway. Every library rides in assets/. */
  for (const page of ['products.html', 'cart.html', 'payment.html', 'thankyou.html', 'home.html', 'phonepe_status.html', 'access-denied.html']) {
    const html = read(page);
    assert.ok(!/<script[^>]+src=["']https?:/i.test(html), page + ' loads a script from another host');
  }
  assert.match(read('thankyou.html'), /assets\/html2pdf\.bundle\.min\.js/, 'the receipt page has no PDF library');
  assert.ok(fs.statSync(path.join(BUNDLE, 'assets', 'html2pdf.bundle.min.js')).size > 500000, 'the vendored PDF library is not the real one');
  assert.match(read('assets/thankyou/script.js'), /typeof html2pdf !== "function"/, 'the receipt button throws a bare ReferenceError when the library is missing');
});

test("on an iPhone the keyboard's microphone is the microphone, and listening never holds the screen", () => {
  /* Owner, iPhone 14 Pro: tapped the mic, allowed it, and a system sheet sat
     over the search box "for a long time". iOS is WebKit everywhere and its
     recogniser draws UI the page cannot dismiss; the keyboard already has a
     dictation key. */
  for (const [name, src] of [
    ['order', read('assets/products/script.js')],
    ['menu', fs.readFileSync(path.join(__dirname, '..', 'menu', 'menu.js'), 'utf8')],
  ]) {
    const guard = src.indexOf('if (isIOS()) return;');
    const show = src.indexOf('mic.hidden = false;');
    assert.ok(guard > 0 && show > 0 && guard < show, name + ': the mic is shown on iOS');
    assert.match(src, /function isIOS\(\)/, name + ': no iOS check');
    assert.match(src, /setTimeout\([\s\S]{0,200}rec\.stop\(\)[\s\S]{0,120}12000\)/, name + ': listening has no end of its own');
    assert.match(src, /visibilitychange/, name + ': a hidden page keeps listening');
  }
});

test("the shop's own greeting opens the conversation, and the console has somewhere to write it", () => {
  const { window, document } = assistantPage({ reply: { status: 200, body: {} } });
  window.shop.assistantGreeting = 'Vanakkam! What can I get you?';
  document.getElementById('ask-ai').click();
  assert.match(document.getElementById('assistant-log').textContent, /Vanakkam! What can I get you\?/);
  assert.ok(!/Tell me what you feel like/.test(document.getElementById('assistant-log').textContent), 'the standard greeting shows beside the shop\'s own');

  assert.match(read('indexedDB.js'), /assistant_greeting: String\(/, 'the page never stores the greeting');
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'settings_write.html'), 'utf8');
  for (const id of ['ai_assistant_greeting', 'ai_assistant_instructions', 'ai_assistant_config']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'the AI page has no #' + id);
  }
  assert.match(html, /lang_ai_assistant_how_5/, 'the AI page does not say how to try it');
  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
  assert.match(js, /ai_assistant_instructions: String\(\$\('#ai_assistant_instructions'\)\.val\(\)/, 'the house notes are not saved');
  assert.match(js, /ai_assistant_greeting: String\(\$\('#ai_assistant_greeting'\)\.val\(\)/, 'the greeting is not saved');
});

/* -------------------------------------------------------- talk to order */

/** The products page with both assistant scripts and a shop that allows voice. */
function voicePage({ voice = 'live', reply, table = '5', fulfilment = ['dine_in', 'takeaway'], payment = { offline: true }, cartLines = null, order = null } = {}) {
  const dom = new JSDOM(read('products.html'), { url: 'https://shop.example/order/products.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { fetch: [], applied: [], sent: [], spoken: [], recognitions: 0, checkout: [], left: [] };
  let cart = cartLines ? JSON.parse(JSON.stringify(cartLines)) : [{ id: 'd1', name: 'Fresh Lime Soda', price: 80, quantity: 1 }];
  const catalogue = { m1: { id: 'm1', name: 'Chicken Biryani', price: 320 }, b1: { id: 'b1', name: 'Masala Dosa', price: 120, available: false }, d1: { id: 'd1', name: 'Fresh Lime Soda', price: 80 } };
  window.shop = { assistant: true, voice, name: 'Azure', fulfilment, payment };
  window.CONFIG = { API_BASE_URL: '' };
  window.knownBranchId = async () => 'AZ100';
  window.getCartData = async () => JSON.parse(JSON.stringify(cart));
  /* The real page has allProducts() (global) and NOT findProduct() (inside
     the products script's closure); the harness mirrors that. */
  window.allProducts = () => Object.values(catalogue);
  /* The real updateQuantity moves the order, and the sheet draws from it, so
     the fake one has to move it too or the list on screen is a fiction. */
  window.updateQuantity = async (id, change) => {
    calls.applied.push([id, change]);
    const line = cart.find((l) => String(l.id) === String(id));
    if (line) {
      line.quantity += change;
      if (line.quantity <= 0) cart = cart.filter((l) => l !== line);
    } else if (change > 0) {
      const item = catalogue[id] || {};
      cart.push({ id, name: item.name || id, price: item.price || 0, quantity: change });
    }
  };
  window.setCartItemNote = async () => {};
  /* What the page has for placing an order: the code's table, the same
     checkout a tap uses (told to stay), the shop's words and money. */
  window.KioskServicePoint = { read: () => ({ table, venue: '', unit: '', destination: null }) };
  window.checkout = async (tx, status, options) => { calls.checkout.push([tx, status, options]); cart = []; return { placed: true, token: '042', saleId: 'o1' }; };
  window.words = () => ({ one: 'dish', many: 'dishes' });
  window.money = (n) => '₹' + n;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  /* A WebRTC that goes nowhere, with a data channel the test can drive. */
  class FakeChannel { constructor() { this.readyState = 'open'; } send(s) { calls.sent.push(JSON.parse(s)); } close() {} }
  class FakePC {
    constructor() { this.channel = new FakeChannel(); window.__pc = this; }
    addTrack() {}
    createDataChannel() { return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\noffer' }; }
    async setLocalDescription() {}
    async setRemoteDescription(d) { this.remote = d; }
    close() {}
  }
  window.RTCPeerConnection = FakePC;
  window.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
  window.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.fetch.push({ url, body, method: init.method || 'GET' });
    /*
     * The placed order answers for itself: read it back, change a quantity,
     * call it off. A shop that refuses says so the way the real one does -
     * a named reason, not a thrown error - so the screen can be checked for
     * what it does with one.
     */
    const at = String(url).match(/\/orders\/([^/?]+)(?:\/(items|cancel))?/);
    if (at && order) {
      if (at[2] === 'items') {
        const no = typeof order.refuse === 'function' ? order.refuse(body.items) : order.refuse;
        if (no) return { ok: false, status: 400, json: async () => ({ type: 'error', message: no, data: null }) };
        (body.items || []).forEach((asked) => {
          const line = order.items.find((l) => String(l.item_id) === String(asked.item_id));
          if (line) line.quantity = Number(asked.quantity) || 0;
          else order.items.push({ item_id: asked.item_id, name: (catalogue[asked.item_id] || {}).name || asked.item_id, quantity: Number(asked.quantity) || 0 });
          order.items = order.items.filter((l) => l.quantity > 0);
        });
      }
      if (at[2] === 'cancel') order.cancelled = true;
      return { ok: true, status: 200, json: async () => ({ type: 'success', data: order }) };
    }
    const answer = typeof reply === 'function' ? reply() : reply;
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  };
  window.speechSynthesis = { cancel() {}, getVoices: () => [], speak(u) { calls.spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); } };
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  /* The real page loads indexedDB.js before the assistant, and the chooser
     for the things that go with an order lives there, so the order history
     and the confirmation screen cannot drift apart. */
  window.eval(lift(read('indexedDB.js'), 'goesWithOrder'));
  window.eval(read('assets/assistant/kitchen-scene.js'));
  window.eval(read('assets/assistant/script.js'));
  window.eval(read('assets/assistant/voice.js'));
  window.OrderingVoice.leave = (url) => calls.left.push(url);
  window.OrderingAssistant.leave = (url) => calls.left.push(url);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document: window.document, calls };
}

test('talk to order: the microphone follows the shop, and a live line applies the model\'s tools through the page', async () => {
  const off = voicePage({ voice: '', reply: { status: 200, body: {} } });
  assert.strictEqual(off.document.getElementById('assistant-talk').hidden, true, 'a shop without voice shows a microphone');

  const { window, document, calls } = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } } });
  assert.strictEqual(document.getElementById('assistant-talk').hidden, false);
  await window.OrderingVoice.start();
  await settle();
  assert.strictEqual(calls.fetch[0].url, '/online-ordering/AZ100/voice');
  assert.strictEqual(calls.fetch[0].body.sdp, 'v=0\r\noffer');
  assert.strictEqual(window.__pc.remote.sdp, 'v=0\r\nanswer', 'the provider\'s answer was not applied to the line');
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'on');

  /* The model asks, in ONE response, for two biryani less spicy, for a dish
     that is off tonight, and for something that is not on the menu. The
     arguments events alone do nothing; the calls run together when the
     response is done, and the model is asked to speak ONCE. */
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'response.function_call_arguments.done', name: 'add_to_order', call_id: 'c1', arguments: '{"item_id":"m1","quantity":2,"note":"less spicy"}' }) });
  assert.deepStrictEqual(calls.sent, [], 'a tool ran before the response was done');
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'response.done', response: { status: 'completed', output: [
    { type: 'message', role: 'assistant' },
    { type: 'function_call', name: 'add_to_order', call_id: 'c1', arguments: '{"item_id":"m1","quantity":2,"note":"less spicy","asked":"chicken briyani"}' },
    { type: 'function_call', name: 'add_to_order', call_id: 'c2', arguments: '{"item_id":"b1","quantity":1,"asked":"masala dosa"}' },
    { type: 'function_call', name: 'add_to_order', call_id: 'c3', arguments: '{"item_id":"ghost","quantity":1,"asked":"chicken tikka"}' },
  ] } }) });
  await settle();
  assert.deepStrictEqual(calls.applied, [['m1', 2]], 'the order was changed for something not on the menu or off tonight');
  const outputs = calls.sent.filter((e) => e.type === 'conversation.item.create').map((e) => ({ call: e.item.call_id, out: JSON.parse(e.item.output) }));
  assert.deepStrictEqual(outputs.map((o) => [o.call, o.out.ok]), [['c1', true], ['c2', false], ['c3', false]]);
  assert.strictEqual(outputs[0].out.note, 'less spicy');
  assert.strictEqual(outputs[0].out.did, 'added');
  assert.ok(outputs[0].out.order && Array.isArray(outputs[0].out.order.lines), 'the tool did not hand back the order as it stands');
  assert.strictEqual(outputs[1].out.reason, 'not_available_today');
  assert.strictEqual(outputs[1].out.item, 'Masala Dosa');
  assert.strictEqual(outputs[2].out.reason, 'not_on_menu');
  assert.strictEqual(outputs[2].out.asked, 'chicken tikka');
  assert.deepStrictEqual(outputs[2].out.nearest.map((n) => n.name), ['Chicken Biryani'], 'the nearest dish was not offered back');
  assert.strictEqual(calls.sent.filter((e) => e.type === 'response.create').length, 1, 'the model must be asked to speak once, after all the tools');
  assert.strictEqual(calls.sent[calls.sent.length - 1].type, 'response.create', 'the outputs must all be in before the model is asked to speak');
  assert.match(document.getElementById('assistant-log').textContent, /Added 2 × Chicken Biryani/);

  /* A wrong id with the customer's own words still lands on the dish;
     "briyani" is one step from "biryani". An interrupted response runs
     nothing. */
  calls.sent.length = 0;
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'response.done', response: { status: 'completed', output: [
    { type: 'function_call', name: 'add_to_order', call_id: 'c4', arguments: '{"item_id":"chicken-biryani","quantity":1,"asked":"oru chicken briyani"}' },
  ] } }) });
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'response.done', response: { status: 'cancelled', output: [
    { type: 'function_call', name: 'add_to_order', call_id: 'c5', arguments: '{"item_id":"m1","quantity":9}' },
  ] } }) });
  await settle();
  assert.deepStrictEqual(calls.applied, [['m1', 2], ['m1', 1]]);
  assert.strictEqual(JSON.parse(calls.sent[0].item.output).item_id, 'm1');
  /*
   * A response the customer talked over is ANSWERED but not RUN.
   *
   * Not run, because adding the dish somebody interrupted to correct is how
   * the wrong food is cooked. Answered, because a call_id the model is
   * waiting on and never hears back about wedges the conversation - every
   * turn after it is an acknowledgement and nothing else, which is what the
   * owner heard: "keep saying ok ok but not able to continue".
   */
  const afterC5 = calls.sent.filter((e) => e.item && e.item.call_id === 'c5');
  assert.strictEqual(afterC5.length, 1, 'an interrupted call was left unanswered, which wedges the line');
  assert.deepStrictEqual(JSON.parse(afterC5[0].item.output), { ok: false, reason: 'interrupted' });
  /* And nothing new was asked to be said over the customer. */
  assert.strictEqual(calls.sent.filter((e) => e.type === 'response.create').length, 1, 'the assistant spoke over an interruption');

  /* A refused duplicate response is a warning, not the end of the call. */
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', code: 'conversation_already_has_active_response', message: 'busy' } }) });
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'on', 'a passing error ended the call');

  /* What was said is NOT written down. Owner: "no need to show conversation
     as text in the chat. just hide." A customer on a call is listening, not
     reading, and the order itself stands in the transcript's place. */
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'two biryani please' }) });
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Two Chicken Biryani, less spicy, added.' }) });
  const spokenLog = document.getElementById('assistant-log').textContent;
  assert.ok(!/two biryani please/.test(spokenLog), 'what the customer said was written into the chat');
  assert.ok(!/less spicy, added/.test(spokenLog), 'what the assistant said was written into the chat');
  assert.strictEqual(document.getElementById('assistant-order').hidden, false, 'the order does not stand in for the transcript');
  /* Two, then the one the misspelt id landed on. */
  assert.match(document.getElementById('assistant-order-list').textContent, /3×Chicken Biryani/);

  window.OrderingVoice.stop();
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'off');
});

test('talk to order: the line reports itself to the meter, and the monthly limit hangs it up', async () => {
  /*
   * The audio never passes our server, so the server cannot see how long a
   * call lasts. The page says "still talking" every half minute; past the
   * shop's monthly limit the server refuses, and the line must close with a
   * word to the customer, not run on unmetered.
   */
  const answers = [
    { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime', session: 's1', tick_seconds: 30 } } },
    { status: 200, body: { type: 'success', data: { seconds: 30, ended: false, next: 30 } } },
    { status: 403, body: { type: 'error', message: 'This shop has reached its monthly AI spending limit', data: { seconds: 60 } } },
  ];
  const { window, document, calls } = voicePage({ voice: 'live', reply: () => answers.shift() || { status: 200, body: { type: 'success', data: {} } } });
  await window.OrderingVoice.start();
  await settle();
  assert.strictEqual(window.OrderingVoice.live.session, 's1', 'the page did not keep the session the server opened');
  assert.ok(window.OrderingVoice.live.meter, 'no clock is running on an open line');

  assert.strictEqual(await window.OrderingVoice.tick(false), true);
  assert.strictEqual(calls.fetch[1].url, '/online-ordering/AZ100/voice/s1/tick');
  assert.deepStrictEqual(calls.fetch[1].body, { end: false });
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'on', 'a metered tick closed the line');

  assert.strictEqual(await window.OrderingVoice.tick(false), false);
  await settle();
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'off', 'past the limit the line stayed open');
  assert.match(document.getElementById('assistant-log').textContent, /reached its limit for the month/, 'the customer was not told why the line closed');
  assert.strictEqual(window.OrderingVoice.live.meter, null, 'the clock kept running after the line closed');
  assert.strictEqual(calls.fetch.length, 3, 'a line the server already ended was sent a hang-up report');
});

test('talk to order: hanging up reports once more, so the last half minute is counted', async () => {
  const answers = [
    { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime', session: 's2', tick_seconds: 30 } } },
  ];
  const { window, calls } = voicePage({ voice: 'live', reply: () => answers.shift() || { status: 200, body: { type: 'success', data: {} } } });
  await window.OrderingVoice.start();
  await settle();
  window.OrderingVoice.stop();
  await settle();
  assert.strictEqual(calls.fetch.length, 2, 'a hang-up sent no last report, or more than one');
  assert.strictEqual(calls.fetch[1].url, '/online-ordering/AZ100/voice/s2/tick');
  assert.deepStrictEqual(calls.fetch[1].body, { end: true });
  assert.strictEqual(window.OrderingVoice.live.session, '', 'the session outlived the line');
  assert.strictEqual(window.OrderingVoice.live.meter, null);
});

test('talk to order, turn by turn: the phone listens, the typed assistant answers, the phone speaks it', async () => {
  const { window, calls } = voicePage({
    voice: 'turns',
    reply: { status: 200, body: { type: 'success', data: { reply: 'The biryani is lovely tonight.', actions: [] } } },
  });
  let heard = ['what is good tonight', '', ''];
  window.SpeechRecognition = function () {
    calls.recognitions++;
    this.start = () => {
      const said = heard.shift() || '';
      setTimeout(() => {
        if (said) this.onresult({ resultIndex: 0, results: [[{ transcript: said }]] });
        this.onend();
      }, 0);
    };
    this.abort = () => {};
    this.stop = () => {};
  };
  window.OrderingVoice.paintTalk();
  await window.OrderingVoice.start();
  await settle();
  assert.strictEqual(calls.fetch[0].url, '/online-ordering/AZ100/assistant', 'turn by turn did not ask the typed assistant');
  assert.deepStrictEqual(calls.fetch[0].body.messages.slice(-1), [{ role: 'user', text: 'what is good tonight' }]);
  assert.deepStrictEqual(calls.spoken, ['The biryani is lovely tonight.'], 'the answer was not spoken');
  assert.ok(calls.recognitions >= 2, 'the page did not listen again after speaking');
});

test('the wiring behind the microphone: route, limiter, allowlist, switch, console', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'routes', 'online-ordering.routes.js'), 'utf8');
  assert.match(routes, /router\.post\('\/:storeId\/voice', voiceLimiter, bind\(controller\.voice\)\)/);
  assert.match(routes, /router\.post\('\/:storeId\/voice\/:session\/tick', voiceTickLimiter, bind\(controller\.voiceTick\)\)/, 'the meter has no door');
  const groups = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'services', 'settings-groups.js'), 'utf8');
  assert.match(groups, /'ai_live_voice'/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'settings_write.html'), 'utf8');
  assert.match(html, /id="ai_live_voice"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
  assert.match(js, /ai_live_voice: \$\('#ai_live_voice'\)\.is\(':checked'\)/);
  assert.match(read('indexedDB.js'), /voice: String\(\(result\.data\.features && result\.data\.features\.voice\) \|\| ""\)/);
  assert.match(read('products.html'), /id="assistant-talk"/);
  assert.match(read('products.html'), /id="voice-out"/);
  /* Beside the send arrow, not under the close button. */
  const dom = new JSDOM(read('products.html'));
  assert.ok(dom.window.document.querySelector('#assistant-form #assistant-talk'), 'the microphone is not in the composer row');
  assert.ok(!dom.window.document.querySelector('#assistant-title #assistant-talk'), 'the microphone is back under the close button');
});

test('turn by turn: a refused microphone is said, not swallowed', async () => {
  const { window, document, calls } = voicePage({ voice: 'turns', reply: { status: 200, body: {} } });
  window.SpeechRecognition = function () {
    this.start = () => setTimeout(() => { this.onerror({ error: 'not-allowed' }); this.onend(); }, 0);
    this.abort = () => {};
    this.stop = () => {};
  };
  window.OrderingVoice.paintTalk();
  await window.OrderingVoice.start();
  await settle();
  assert.match(document.getElementById('assistant-log').textContent, /microphone was not allowed/);
  assert.strictEqual(calls.fetch.length, 0, 'the assistant was asked with nothing heard');
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'off');
});

test('a refused live line says why and talks turn by turn; the tap unlocks speech for the iPhone', async () => {
  const { window, document, calls } = voicePage({
    voice: 'live',
    reply: () => (calls.fetch.length === 1
      ? { status: 403, body: { type: 'error', message: 'This shop has not switched on live voice' } }
      : { status: 200, body: { type: 'success', data: { reply: 'Try the biryani.', actions: [] } } }),
  });
  let heard = ['what is good', '', ''];
  window.SpeechRecognition = function () {
    this.start = () => { const said = heard.shift() || ''; setTimeout(() => { if (said) this.onresult({ resultIndex: 0, results: [[{ transcript: said }]] }); this.onend(); }, 0); };
    this.abort = () => {};
    this.stop = () => {};
  };
  const spokenInTap = [];
  const speak = window.speechSynthesis.speak;
  window.speechSynthesis.speak = function (u) { spokenInTap.push(u.text); return speak.call(this, u); };
  document.getElementById('assistant-talk').click();
  assert.deepStrictEqual(spokenInTap.slice(0, 1), [' '], 'nothing was spoken inside the tap to unlock the iPhone');
  await settle();
  await new Promise((r) => setTimeout(r, 40));
  const log = document.getElementById('assistant-log').textContent;
  assert.match(log, /Live voice is switched off for this shop/, 'the refusal was swallowed');
  assert.strictEqual(calls.fetch[0].url, '/online-ordering/AZ100/voice');
  assert.strictEqual(calls.fetch[1].url, '/online-ordering/AZ100/assistant', 'turn by turn did not follow');
  assert.ok(calls.spoken.includes('Try the biryani.'), 'the fallback answer was not spoken');
});

test('the live switch is the first thing under the assistant, and says what the microphone will do', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'settings_write.html'), 'utf8');
  const config = html.indexOf('id="ai_assistant_config"');
  const live = html.indexOf('id="ai_live_voice_row"');
  const greeting = html.indexOf('id="ai_assistant_greeting"');
  assert.ok(config > 0 && live > config && live < greeting, 'the live switch is buried below the writing boxes');
  assert.match(html, /id="ai_live_voice_state"/, 'no word on what the microphone will do');
  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
  assert.match(js, /lang_ai_live_voice_on/);
  assert.match(js, /\$\(document\)\.on\('change', '#ai_live_voice'/, 'flipping the switch does not update the word');
});

test('the page says once that you can ask or talk, and the greeting mentions the microphone where there is one', async () => {
  const first = voicePage({ voice: 'live', reply: { status: 200, body: {} } });
  const hint = first.document.getElementById('assistant-hint');
  assert.strictEqual(hint.hidden, false, 'a first visit gets no callout');
  assert.strictEqual(first.document.getElementById('assistant-hint-text').textContent, "Ask me what's good, or just talk");
  first.document.getElementById('assistant-hint-open').click();
  assert.strictEqual(hint.hidden, true, 'opening the sheet left the callout up');
  assert.strictEqual(first.window.localStorage.getItem('posnic_assistant_seen'), '1', 'the callout is not remembered as seen');
  assert.match(first.document.getElementById('assistant-log').textContent, /Or tap the microphone and just talk\./);

  const again = voicePage({ voice: 'live', reply: { status: 200, body: {} } });
  again.window.localStorage.setItem('posnic_assistant_seen', '1');
  again.window.OrderingAssistant.paintSpark();
  assert.strictEqual(again.document.getElementById('assistant-hint').hidden, true, 'a phone that has seen it is shown it again');

  const typed = voicePage({ voice: '', reply: { status: 200, body: {} } });
  assert.strictEqual(typed.document.getElementById('assistant-hint-text').textContent, "Ask me what's good");
  typed.document.getElementById('assistant-hint-close').click();
  assert.strictEqual(typed.document.getElementById('assistant-hint').hidden, true);
  typed.document.getElementById('ask-ai').click();
  assert.ok(!/microphone/.test(typed.document.getElementById('assistant-log').textContent), 'a shop with no voice is told about a microphone');
});

test('a code printed for the talk lands the customer in the conversation, ready to talk', async () => {
  /* Owner: "Order with AI required special QR. if user scan then directly
     land AI talk." */
  const talk = voicePage({ voice: 'live', reply: { status: 200, body: {} } });
  talk.window.sessionStorage.setItem('posnic_ai_first', 'talk');
  talk.window.OrderingAssistant.paintSpark();
  assert.strictEqual(talk.document.getElementById('assistant').open, true, 'the sheet did not open on landing');
  assert.strictEqual(talk.document.getElementById('voice').hidden, false, 'the voice panel is not up');
  assert.strictEqual(talk.document.getElementById('voice-start').hidden, false, 'no "Tap to talk"');
  assert.strictEqual(talk.document.getElementById('voice-status').textContent, 'Tap to talk');
  assert.strictEqual(talk.window.sessionStorage.getItem('posnic_ai_first'), null, 'the wish is not spent');
  assert.strictEqual(talk.document.getElementById('assistant-hint').hidden, true, 'the callout competes with the open sheet');

  const ask = voicePage({ voice: '', reply: { status: 200, body: {} } });
  ask.window.sessionStorage.setItem('posnic_ai_first', 'ask');
  ask.window.OrderingAssistant.paintSpark();
  assert.strictEqual(ask.document.getElementById('assistant').open, true);
  assert.strictEqual(ask.document.getElementById('voice').hidden, true, 'a shop with no voice was stood ready to talk');

  const plain = voicePage({ voice: 'live', reply: { status: 200, body: {} } });
  assert.strictEqual(plain.document.getElementById('assistant').open, false, 'a plain link opened the sheet');

  const arrival = read('assets/index/script.js');
  assert.match(arrival, /sessionStorage\.setItem\("posnic_ai_first"/, 'the arrival page drops ?ai= with its redirect');
  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
  assert.match(js, /storefront_talk_url'\)\.val\(base \+ '\/order\/' \+ id \+ '\?ai=talk'\)/, 'the console prints no talk address');
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'settings_write.html'), 'utf8');
  assert.match(html, /id="storefront_talk_url"/);
});

test('the microphone is asked for inside the tap, before anything else, on both buttons', async () => {
  /* Owner, on the ?ai=talk landing on his iPhone: "The microphone was not
     allowed." Safari grants a microphone only while the tap is fresh; the
     page had read the database first. */
  const { window, document, calls } = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } } });
  const order = [];
  window.navigator.mediaDevices.getUserMedia = async () => { order.push('microphone'); return { getTracks: () => [{ stop() {} }] }; };
  window.knownBranchId = async () => { order.push('database'); return 'AZ100'; };
  document.getElementById('assistant-talk').click();
  assert.deepStrictEqual(order.slice(0, 1), ['microphone'], 'the tap did not ask for the microphone at once');
  await settle();
  assert.deepStrictEqual(order, ['microphone', 'database']);
  assert.strictEqual(calls.fetch[0].url, '/online-ordering/AZ100/voice');
  window.OrderingVoice.stop();

  /* The landing button asks the same way. */
  order.length = 0;
  window.sessionStorage.setItem('posnic_ai_first', 'talk');
  window.OrderingAssistant.state.landed = false;
  window.OrderingAssistant.paintSpark();
  document.getElementById('voice-start').click();
  assert.deepStrictEqual(order.slice(0, 1), ['microphone']);
  await settle();
  window.OrderingVoice.stop();

  /* A phone with no microphone at all is told that. */
  window.navigator.mediaDevices.getUserMedia = async () => { const e = new Error('none'); e.name = 'NotFoundError'; throw e; };
  document.getElementById('assistant-talk').click();
  await settle();
  assert.match(document.getElementById('assistant-log').textContent, /No microphone was found on this device/);
});

test('the ears lock to Tamil the moment Tamil is heard, and a transcript in another Indian alphabet is Tamil misheard', async () => {
  /* Owner: "i keep talking in tamil only but i see text in different
     different languages." The transcriber guessed afresh each time. */
  const { window, document, calls } = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } } });
  await window.OrderingVoice.start();
  await settle();
  calls.sent.length = 0;

  /* Malayalam letters for a Tamil sentence: not shown, and the line is told to hear Tamil. */
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'ഒരു ചിക്കൻ ബിരിയാണി' }) });
  assert.ok(!/ചിക്കൻ/.test(document.getElementById('assistant-log').textContent), 'the misheard alphabet was shown to the customer');
  const updates = calls.sent.filter((e) => e.type === 'session.update');
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(updates[0].session.audio.input.transcription, { model: 'gpt-4o-mini-transcribe', language: 'ta' });

  /* Nothing is written down either way, and the lock is not sent twice. */
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'ஒரு சிக்கன் பிரியாணி' }) });
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'and one lime soda' }) });
  assert.ok(
    !/ஒரு சிக்கன் பிரியாணி|and one lime soda/.test(document.getElementById('assistant-log').textContent),
    'the call was written into the chat'
  );
  assert.strictEqual(calls.sent.filter((e) => e.type === 'session.update').length, 1, 'the lock was sent again');
  window.OrderingVoice.stop();

  /* On the older endpoint the same lock takes the older shape. */
  const beta = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-4o-realtime-preview' } } } });
  await beta.window.OrderingVoice.start();
  await settle();
  beta.calls.sent.length = 0;
  await beta.window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'வணக்கம்' }) });
  assert.deepStrictEqual(beta.calls.sent.filter((e) => e.type === 'session.update')[0].session, { input_audio_transcription: { model: 'whisper-1', language: 'ta' } });
  beta.window.OrderingVoice.stop();

  /* A Tamil page is locked before the first word: nothing to send later. */
  const tamil = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } } });
  tamil.window.i18n = { lang: 'ta' };
  await tamil.window.OrderingVoice.start();
  await settle();
  assert.strictEqual(tamil.calls.fetch[0].body.lang, 'ta');
  tamil.calls.sent.length = 0;
  await tamil.window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'ஒரு தோசை' }) });
  assert.strictEqual(tamil.calls.sent.filter((e) => e.type === 'session.update').length, 0);
  tamil.window.OrderingVoice.stop();
});

test('the assistant speaks first when the line opens, once per line', async () => {
  /* Owner: "when it starts with greeting? like welcome to shop name". */
  const { window, calls } = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } } });
  await window.OrderingVoice.start();
  await settle();
  calls.sent.length = 0;
  window.__pc.channel.onopen();
  assert.strictEqual(calls.sent.length, 2, 'opening the line did not ask the assistant to speak');
  assert.strictEqual(calls.sent[0].type, 'conversation.item.create');
  assert.strictEqual(calls.sent[0].item.role, 'system');
  assert.match(calls.sent[0].item.content[0].text, /OPENING LINE/);
  assert.strictEqual(calls.sent[1].type, 'response.create');
  window.__pc.channel.onopen();
  assert.strictEqual(calls.sent.length, 2, 'the greeting was asked for twice on one line');

  /* A new line greets again. */
  window.OrderingVoice.stop();
  await window.OrderingVoice.start();
  await settle();
  calls.sent.length = 0;
  window.__pc.channel.onopen();
  assert.strictEqual(calls.sent.filter((e) => e.type === 'response.create').length, 1);
  window.OrderingVoice.stop();
});

/** The arrival page's script in a vm, with a fake shop store and a fake window. */
function arrivalPage(url, { stored = [], defaultStore = 'ABC' } = {}) {
  const parsed = new URL(url, 'https://shop.example');
  const calls = { fetched: [], cleared: [], went: [], api: [] };
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; };
  const session = mem();
  const local = mem();
  const tx = { oncomplete: null, onerror: null, objectStore: (name) => ({ clear: () => calls.cleared.push(name) }) };
  const sandbox = {
    window: { location: { pathname: parsed.pathname, search: parsed.search, get href() { return parsed.href; }, set href(v) { calls.went.push(v); } } },
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams, String, JSON, Array, Object, Promise, setTimeout,
    sessionStorage: session,
    localStorage: local,
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} } },
    loadEnvConfig: async () => {},
    getData: async () => stored,
    getDB: async () => ({ transaction: () => { setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return tx; } }),
    KioskCore: { BRANCH_STORES: ['branch', 'products', 'cart'] },
    clearOrderAttemptId: () => {},
    fetchAndStoreBranch: async (id, redirect) => { calls.fetched.push([id, redirect]); return true; },
    fetch: async (u) => { calls.api.push(String(u)); return { ok: true, json: async () => ({ data: { store: { id: defaultStore } } }) }; },
    CONFIG: { API_BASE_URL: '' },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('assets/index/script.js'), sandbox);
  return { calls, session, local };
}

test('the arrival page reads the URL whenever it says anything, stored shop or not', async () => {
  /* Owner: "https://develop.posnic.io/order/ABC?ai=talk wont work in
     desktop?" A browser that had been to the shop went straight to the
     menu and never read the URL; a phone worked only because it was new. */
  const wait = () => new Promise((r) => setTimeout(r, 40));
  const held = [{ id: 'ABC', name: 'Azure' }];

  const again = arrivalPage('/order/ABC?ai=talk', { stored: held });
  await wait();
  assert.strictEqual(again.session.getItem('posnic_ai_first'), 'talk', 'a browser that held the shop dropped ?ai=talk');
  assert.deepStrictEqual(again.calls.fetched, [['ABC', false]], 'the held shop was not refreshed from its address');
  assert.deepStrictEqual(again.calls.went, ['products.html']);
  assert.deepStrictEqual(again.calls.cleared, [], 'the same shop was cleared as if it were new');

  const other = arrivalPage('/order/XYZ', { stored: held });
  await wait();
  assert.ok(other.calls.cleared.includes('branch'), 'a code for another shop kept the stored one');
  assert.deepStrictEqual(other.calls.fetched, [['XYZ', true]]);
  assert.strictEqual(other.session.getItem('posnic_ai_first'), null);

  const fresh = arrivalPage('/order/ABC?ai=talk', { stored: [] });
  await wait();
  assert.strictEqual(fresh.session.getItem('posnic_ai_first'), 'talk');
  assert.deepStrictEqual(fresh.calls.fetched, [['ABC', true]]);

  /* A bare address with a shop held is still the fast path to the menu. */
  const bare = arrivalPage('/order/', { stored: held });
  await wait();
  assert.deepStrictEqual(bare.calls.went, ['products.html']);
  assert.deepStrictEqual(bare.calls.fetched, []);

  /* No address but a wish: the default store, and the wish kept. */
  const wish = arrivalPage('/order/?ai=ask', { stored: held });
  await wait();
  assert.strictEqual(wish.session.getItem('posnic_ai_first'), 'ask');
  assert.deepStrictEqual(wish.calls.api, ['/online-ordering']);
  assert.deepStrictEqual(wish.calls.fetched, [['ABC', true]]);

  /* The older query form still arrives. */
  const query = arrivalPage('/order/?branch=XYZ', { stored: held });
  await wait();
  assert.deepStrictEqual(query.calls.fetched, [['XYZ', true]]);
});

const call = (name, args, id) => ({ type: 'function_call', name, call_id: id || 'k1', arguments: JSON.stringify(args) });
const done = (calls) => ({ data: JSON.stringify({ type: 'response.done', response: { status: 'completed', output: calls } }) });
const lastOutput = (calls) => JSON.parse(calls.sent.filter((e) => e.type === 'conversation.item.create').pop().item.output);

test('the assistant can send the order to the kitchen, only on a clear yes, through the same checkout a tap uses', async () => {
  /* Owner: "it cant make order or confirm. make that available. let ai
     confirm send to kitchen." */
  const { window, document, calls } = voicePage({ voice: 'live', reply: { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } } });
  await window.OrderingVoice.start();
  await settle();
  calls.sent.length = 0;

  await window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: false })]));
  await settle();
  assert.strictEqual(lastOutput(calls).reason, 'not_confirmed');
  assert.deepStrictEqual(calls.checkout, [], 'an order was placed without the customer\'s yes');

  /* A table from the code: dining in, paid at the counter, placed. */
  await window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true }, 'k2')]));
  await settle();
  const placed = lastOutput(calls);
  assert.strictEqual(placed.ok, true);
  assert.strictEqual(placed.token, '042');
  assert.strictEqual(placed.pay, 'at the counter');
  /* Through JSON: the options object is born in the page's realm. */
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.checkout)), [['', 'Cash', { stay: true }]], 'not the same checkout a tap uses, or it did not stay');
  assert.strictEqual(window.localStorage.getItem('orderType'), 'DINE IN');
  assert.strictEqual(window.localStorage.getItem('order_fulfilment'), 'dine_in');
  /* The confirmation lands in the sheet the customer was talking into: a
     tick under "Sent to the kitchen", which becomes a pan under "The chef is
     preparing your order", with the token. Owner: "as soon order over it cut
     suddenly ... i wanted to show some animation like sent kitchen and chef
     preparing." */
  assert.strictEqual(document.getElementById('assistant-placed').hidden, false, 'nothing told the customer the order had gone');
  assert.strictEqual(document.getElementById('placed-token').textContent, '042');
  assert.strictEqual(document.getElementById('placed-said').textContent, 'Sending your order to the kitchen');
  assert.strictEqual(document.getElementById('placed-art').getAttribute('data-stage'), 'sending');
  assert.strictEqual(calls.sent[calls.sent.length - 1].type, 'response.create', 'the model was not asked to say the token');
  assert.deepStrictEqual(calls.left, [], 'the page left before the token was said');

  /* NOTHING navigates on its own, and hanging up changes nothing on screen:
     a page that walked off the moment the line closed is what the owner saw
     as a sudden cut. The customer leaves when they tap Done. */
  await window.OrderingVoice.onEvent(done([]));
  await window.OrderingVoice.onEvent({ data: JSON.stringify({ type: 'output_audio_buffer.stopped' }) });
  assert.deepStrictEqual(calls.left, [], 'the page left in the middle of the call');
  window.OrderingVoice.stop();
  assert.deepStrictEqual(calls.left, [], 'hanging up walked the customer off the page');
  assert.strictEqual(document.getElementById('assistant-placed').hidden, false, 'the confirmation went with the call');
  document.getElementById('placed-done').click();
  assert.deepStrictEqual(calls.left, ['thankyou.html?token=042'], 'Done did not go to the token screen');
  assert.strictEqual(document.getElementById('assistant').getAttribute('data-voice'), 'off', 'the line stayed open after hanging up');
});

test('sending to the kitchen asks for what the code did not say, and hands the rest to Review order', async () => {
  const live = { status: 200, body: { type: 'success', data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } } };

  /* No table and two ways offered: ask; told takeaway: placed as a parcel. */
  const open = voicePage({ voice: 'live', reply: live, table: '' });
  await open.window.OrderingVoice.start();
  await settle();
  await open.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true })]));
  await settle();
  let out = lastOutput(open.calls);
  assert.strictEqual(out.reason, 'need_fulfilment');
  assert.deepStrictEqual(out.options, ['dine_in', 'takeaway']);
  await open.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true, fulfilment: 'takeaway' }, 'k2')]));
  await settle();
  out = lastOutput(open.calls);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.pay, 'when collecting');
  assert.strictEqual(open.window.localStorage.getItem('orderType'), 'PARCEL');
  open.window.OrderingVoice.stop();

  /* Eating here with no table on the code: the table is asked for. */
  const seat = voicePage({ voice: 'live', reply: live, table: '' });
  await seat.window.OrderingVoice.start();
  await settle();
  await seat.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true, fulfilment: 'dine_in' })]));
  await settle();
  assert.strictEqual(lastOutput(seat.calls).reason, 'need_table');
  await seat.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true, fulfilment: 'dine_in', table: ' t-7 ' }, 'k2')]));
  await settle();
  assert.strictEqual(lastOutput(seat.calls).ok, true);
  assert.strictEqual(seat.window.localStorage.getItem('order_table'), 'T-7');
  seat.window.OrderingVoice.stop();

  /* Delivery needs an address, a shop that wants a phone number, and one
     that takes online payment only: the Review order button finishes it. */
  for (const [label, options, reason] of [
    ['delivery', { table: '', fulfilment: ['delivery'] }, 'needs_details'],
    ['phone', { payment: { offline: true, number: true } }, 'needs_phone'],
    ['online only', { payment: { offline: false, razorpay: true } }, 'pay_online'],
  ]) {
    const page = voicePage({ voice: 'live', reply: live, ...options });
    await page.window.OrderingVoice.start();
    await settle();
    await page.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true })]));
    await settle();
    const answer = lastOutput(page.calls);
    assert.strictEqual(answer.reason, reason, label);
    assert.strictEqual(answer.next, 'review', label);
    assert.deepStrictEqual(page.calls.checkout, [], label + ': placed anyway');
    page.window.OrderingVoice.stop();
  }

  /* An older payment answer without the offline flag: cash on means the counter is fine. */
  const older = voicePage({ voice: 'live', reply: live, payment: { cash: 'true', razorpay: true } });
  await older.window.OrderingVoice.start();
  await settle();
  await older.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true })]));
  await settle();
  assert.strictEqual(lastOutput(older.calls).ok, true);
  older.window.OrderingVoice.stop();

  /* Nothing in the order: nothing to send. */
  const empty = voicePage({ voice: 'live', reply: live, cartLines: [] });
  await empty.window.OrderingVoice.start();
  await settle();
  await empty.window.OrderingVoice.onEvent(done([call('send_to_kitchen', { confirmed: true })]));
  await settle();
  assert.strictEqual(lastOutput(empty.calls).reason, 'empty_order');
  assert.deepStrictEqual(empty.calls.checkout, []);
});

test('the sheet carries a Review order button with the count and the total, once there is something to review', async () => {
  /* Owner: "ai asking to click review and order. but there is no button." */
  const { window, document, calls } = voicePage({ voice: 'live', reply: { status: 200, body: {} } });
  const button = document.getElementById('assistant-review');
  assert.ok(button, 'no Review order button in the sheet');
  document.getElementById('ask-ai').click();
  await settle();
  assert.strictEqual(button.hidden, false, 'the button is hidden with an order to review');
  assert.strictEqual(document.getElementById('assistant-review-sum').textContent, '1 dish · ₹80');
  button.click();
  assert.deepStrictEqual(calls.left, ['cart.html']);

  const bare = voicePage({ voice: 'live', reply: { status: 200, body: {} }, cartLines: [] });
  bare.document.getElementById('ask-ai').click();
  await settle();
  assert.strictEqual(bare.document.getElementById('assistant-review').hidden, true, 'the button shows with nothing to review');

  /* checkout() can stay on the page and hand back the token. */
  const db = read('indexedDB.js');
  assert.match(db, /async function checkout\(transactionId, paymentStatus = "Upi", options = \{\}\)/);
  /* And the id with it: changing the order later needs the id as the proof
     that this phone placed it, and the token beside it. */
  assert.match(db, /if \(options && options\.stay\) \{/);
  assert.match(db, /placed: true,\s*\n\s*token: normalizedTokenId,/);
  assert.match(db, /saleId: String\(result\.data\.sale_id/);
  assert.ok(db.indexOf('options.stay') < db.indexOf('window.location.href = `thankyou.html?token='), 'the stay must be decided before the page leaves');
});

test('the order lands in the sheet, and nothing moves until Done', async () => {
  /* Owner: "as soon order over it cut suddenly ... i wanted to show some
     animation like sent kitchen and chef preparing." The beats themselves
     belong to the scene, and are tested against its own drawing below. */
  const { window, document, calls } = voicePage({ voice: 'live', reply: { status: 200, body: {} } });
  window.OrderingAssistant.placedPanel('042');

  const panel = document.getElementById('assistant-placed');
  const art = document.getElementById('placed-art');
  assert.strictEqual(panel.hidden, false);
  assert.strictEqual(document.getElementById('placed-token').textContent, '042');
  assert.strictEqual(art.getAttribute('data-stage'), 'sending', 'the first beat is not immediate');
  assert.strictEqual(
    document.getElementById('placed-said').textContent,
    'Sending your order to the kitchen'
  );
  assert.deepStrictEqual(calls.left, [], 'the panel walked the customer off by itself');

  document.getElementById('placed-done').click();
  assert.strictEqual(panel.hidden, true);
  assert.deepStrictEqual(calls.left, ['thankyou.html?token=042']);

  /* Leaving stops the scene: a second order must not run behind the first. */
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(
    document.getElementById('placed-said').textContent,
    'Sending your order to the kitchen',
    'a beat arrived after the panel was closed'
  );
});

/** A placed order the way the shop describes one. */
function placedOrder(extra) {
  return Object.assign(
    {
      order_id: 'o1',
      token: '042',
      placed_at: new Date().toISOString(),
      state: 'accepted',
      cancelled: false,
      paid: false,
      cancel_requested: false,
      can_change: true,
      change_seconds: 30,
      items: [{ item_id: 'm1', name: 'Chicken Biryani', quantity: 2, total: 640 }],
      total: 640,
    },
    extra || {}
  );
}

test('the confirmation opens into the order, and the order can still be changed', async () => {
  /*
   * Owner: "AI chat suddenly closed when start order send... its kind of some
   * one cut the call before finish ... after sending to kitchen show animation
   * kitchen received order and processing. and the show the order detail page.
   * cutomer should able to see proper nativigation add new item to the order.
   * modify existing."
   *
   * Nothing was closing the sheet. The confirmation REPLACED the conversation
   * and dead-ended at a token and a Done button, which from the customer's
   * side is being hung up on. The scene now settles into the order itself.
   */
  const order = placedOrder();
  const { window, document, calls } = voicePage({ order, reply: { status: 200, body: {} } });
  window.OrderingAssistant.placedPanel('042', { orderId: 'o1' });
  const box = document.getElementById('placed-order');
  assert.strictEqual(box.hidden, true, 'the order jumped the scene');

  await window.OrderingAssistant.showPlacedOrder();
  assert.strictEqual(box.hidden, false, 'the scene settled into nothing');

  /* Read from the SHOP, not from the basket the page just emptied. */
  const asked = calls.fetch.filter((c) => /\/orders\/o1\?token=042$/.test(c.url));
  assert.strictEqual(asked.length, 1, 'the screen drew from something other than the shop');

  const lines = [...document.querySelectorAll('#placed-lines li')];
  assert.deepStrictEqual(lines.map((li) => li.querySelector('.placed-line-qty').textContent + ' ' + li.querySelector('.placed-line-name').textContent), ['2\u00d7 Chicken Biryani']);
  assert.deepStrictEqual([...lines[0].querySelectorAll('.placed-step')].map((b) => b.getAttribute('data-quantity')), ['1', '3'], 'the steppers do not move the line by one');
  assert.match(document.getElementById('placed-clock').textContent, /^\d+s to change it$/, 'nothing says how long they have');

  /* One more, and the screen redraws from what the shop then says. */
  lines[0].querySelectorAll('.placed-step')[1].click();
  await settle();
  const sent = calls.fetch.filter((c) => c.method === 'POST' && /\/orders\/o1\/items$/.test(c.url));
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].body, { token: '042', items: [{ item_id: 'm1', quantity: 3 }] });
  assert.strictEqual(document.querySelector('#placed-lines .placed-line-qty').textContent, '3\u00d7');

  /* The countdown is a real timer; left running it holds the runner open. */
  window.OrderingAssistant.hidePlaced();
  window.close();
});

test('something to go with it, and a way to call the whole thing off', async () => {
  /* Owner: "also some cross selling suggession below to add into current
     order." From a category they have NOT ordered from, never anything
     already on the order, and never a dish the shop has switched off. */
  const order = placedOrder();
  const { window, document, calls } = voicePage({ order, reply: { status: 200, body: {} } });
  window.OrderingAssistant.placedPanel('042', { orderId: 'o1' });
  await window.OrderingAssistant.showPlacedOrder();

  const more = [...document.querySelectorAll('.placed-more-item')];
  assert.deepStrictEqual(more.map((b) => b.getAttribute('data-add')), ['d1'], 'the suggestions offered the order back to itself, or a dish that is off');
  assert.strictEqual(document.getElementById('placed-more').hidden, false);

  more[0].click();
  await settle();
  const added = calls.fetch.filter((c) => c.method === 'POST' && /\/orders\/o1\/items$/.test(c.url));
  assert.deepStrictEqual(added[0].body, { token: '042', items: [{ item_id: 'd1', quantity: 1 }] });
  assert.deepStrictEqual([...document.querySelectorAll('#placed-lines .placed-line-name')].map((n) => n.textContent), ['Chicken Biryani', 'Fresh Lime Soda']);

  /* And off. The shop says it is cancelled, so the screen stops offering to
     change something that is no longer there. */
  document.getElementById('placed-cancel').click();
  await settle();
  assert.ok(calls.fetch.some((c) => c.method === 'POST' && /\/orders\/o1\/cancel$/.test(c.url)));
  assert.strictEqual(document.getElementById('placed-order').hidden, true, 'a cancelled order still offers a plus button');
  window.close();
});

test('a shop that says no is quoted, not swallowed', async () => {
  /* The server names its reasons - too_late, already_billed - so the page can
     say which it is instead of a button that quietly did nothing. */
  const order = placedOrder({ refuse: 'too_late' });
  const { window, document } = voicePage({ order, reply: { status: 200, body: {} } });
  window.OrderingAssistant.placedPanel('042', { orderId: 'o1' });
  await window.OrderingAssistant.showPlacedOrder();

  document.querySelectorAll('.placed-step')[1].click();
  await settle();
  assert.match(
    document.getElementById('assistant-log').textContent,
    /The kitchen has started on it/,
    'the refusal never reached the customer'
  );
  assert.strictEqual(
    window.OrderingAssistant.refusal('not_a_reason_we_know'),
    'not_a_reason_we_know',
    'a sentence the server composed itself was thrown away'
  );
  window.OrderingAssistant.hidePlaced();
  window.close();
});

test('an order the shop has closed is a record, not a set of controls', async () => {
  const order = placedOrder({ can_change: false, why_not: 'too_late', paid: false });
  const { window, document } = voicePage({ order, reply: { status: 200, body: {} } });
  window.OrderingAssistant.placedPanel('042', { orderId: 'o1' });
  await window.OrderingAssistant.showPlacedOrder();

  assert.strictEqual(document.getElementById('placed-order').hidden, false, 'the order vanished the moment it could not be changed');
  assert.deepStrictEqual([...document.querySelectorAll('.placed-step')], [], 'a stepper that could only fail');
  assert.strictEqual(document.getElementById('placed-more').hidden, true, 'something was offered that could not be added');
  /* Asking is still allowed: the customer is never told to go and find a person. */
  assert.strictEqual(document.getElementById('placed-cancel').textContent, 'Ask the shop to cancel');
  assert.strictEqual(document.getElementById('placed-clock').textContent, '', 'a countdown on an order that cannot be changed');

  const paid = voicePage({ order: placedOrder({ can_change: false, paid: true }), reply: { status: 200, body: {} } });
  paid.window.OrderingAssistant.placedPanel('042', { orderId: 'o1' });
  await paid.window.OrderingAssistant.showPlacedOrder();
  assert.strictEqual(paid.document.getElementById('placed-cancel').hidden, true, 'a paid order offers to cancel itself');
  window.close();
  paid.window.close();
});

test('the call is still up once the order is on screen', () => {
  /*
   * The thing that read as the line being cut: a stylesheet rule that hid the
   * transcript AND the box to talk into for as long as the confirmation was
   * up. They now stand aside only while the scene is playing.
   */
  const css = read('assets/order.css');
  const hide = css.match(/dialog\.sheet:has\(\.placed:not\(\[hidden\]\)\) \.assistant-[a-z]+/g) || [];
  assert.ok(!hide.some((s) => /assistant-ask$/.test(s)), 'the box to talk into is still hidden for the whole confirmation');
  assert.ok(!hide.some((s) => /assistant-log$/.test(s)), 'the transcript is still hidden for the whole confirmation');
  assert.match(
    css,
    /:not\(:has\(\.placed-order:not\(\[hidden\]\)\)\) \.assistant-ask/,
    'nothing brings the conversation back when the order opens'
  );
  /* And the order leads the sheet rather than sitting under the input box,
     which is where the markup alone would put it. */
  assert.match(css, /\.assistant-body:has\(\.placed-order:not\(\[hidden\]\)\) \.placed \{\s*\n\s*order: -1;/);

  /* The last beat of the scene is what opens it, and the voice hands the id
     over so there is an order to open. */
  const script = read('assets/assistant/script.js');
  assert.match(script, /if \(beat === "cooking"\) showPlacedOrder\(\);/, 'the order never opens on its own');
  assert.match(read('assets/assistant/voice.js'), /a\.placedPanel\(live\.placed, \{ orderId: live\.placedId \}\)/);
});

test('an order that has gone does not walk the customer back to the menu', async () => {
  /*
   * THE BUG THE OWNER HIT TWICE. "after sending to order ai voice suddenly
   * closing. no fucking animation is going order to kitchen."
   *
   * checkout() empties the basket and calls renderCart([]). renderCart's
   * empty-basket branch navigated to products.html after two seconds -
   * wherever it was called from. On products.html, with the assistant sheet
   * open, that reloaded the page: the dialog went, the voice line went with
   * it, and the kitchen scene died at 2s, before its last beat at 2.9s.
   *
   * Nothing caught it because the harness stubs setTimeout to a no-op. This
   * keeps what was scheduled.
   */
  const onMenu = page('products.html', { cart: [], products: {} });
  const scheduled = [];
  onMenu.box.setTimeout = (fn, ms) => { scheduled.push(ms); return 1; };
  await onMenu.box.renderCart([]);
  assert.deepStrictEqual(scheduled, [], 'the menu page still sends itself somewhere after an order');

  /* The basket page still does what it says on it: a customer who emptied
     their own basket is taken back to the menu. */
  const onBasket = page('cart.html', { cart: [], products: {} });
  const basketScheduled = [];
  onBasket.box.setTimeout = (fn, ms) => { basketScheduled.push(ms); return 1; };
  await onBasket.box.renderCart([]);
  assert.deepStrictEqual(basketScheduled, [2000], 'an emptied basket no longer goes back to the menu');

  /* But not when the basket is empty because it was SENT. */
  const afterSending = page('cart.html', { cart: [], products: {} });
  const sentScheduled = [];
  afterSending.box.setTimeout = (fn, ms) => { sentScheduled.push(ms); return 1; };
  afterSending.box.orderJustPlaced = true;
  await afterSending.box.renderCart([]);
  assert.deepStrictEqual(sentScheduled, [], 'a basket emptied by checkout was read as one the customer emptied');
});

test('checkout says the basket was sent, not emptied', () => {
  /* The flag has to be raised around the clear, or renderCart cannot tell
     the two apart and the test above proves nothing about the real page. */
  const db = read('indexedDB.js');
  const raise = db.indexOf('orderJustPlaced = true;');
  const clear = db.indexOf('await saveCartData([]);', raise);
  const drawn = db.indexOf('await renderCart([]);', raise);
  const lower = db.indexOf('orderJustPlaced = false;', raise);
  assert.ok(raise !== -1 && clear > raise, 'the basket is cleared before checkout says it was sent');
  assert.ok(drawn > clear, 'renderCart is not drawn inside the flag');
  assert.ok(lower > drawn, 'the flag is never lowered, so the basket page stops going back to the menu');
});

test('the token screen downloads nothing and shows no bill', () => {
  /* Owner: "after order no need to show bill or pdf not required. once
     payment done from desktop then make bill available to download." */
  const script = read('assets/thankyou/script.js');
  assert.ok(!/setTimeout\(async \(\) => \{[\s\S]{0,200}generatePdfFromHtmlFile\(\)/.test(script), 'the page still pushes a PDF at the phone');
  assert.match(script, /NOTHING IS DOWNLOADED HERE/);
  /* Kept, because the button the shop unlocks after payment calls it. */
  assert.match(script, /async function generatePdfFromHtmlFile\(\)/);
  const html = read('thankyou.html');
  assert.match(html, /<section class="receipt-section" aria-label="Receipt" hidden>/, 'the bill is shown before a rupee has been paid');
});

/** The history page in jsdom, with what a browser kept and what a shop says. */
function historyPage({ kept = [], says = {}, menu = [], reachable = true } = {}) {
  const dom = new JSDOM(read('history.html'), {
    url: 'https://shop.example/order/history.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const calls = { asked: [], forgotten: [], posted: [] };
  window.CONFIG = { API_BASE_URL: '' };
  window.loadEnvConfig = async () => {};
  window.rememberedOrders = () => JSON.parse(JSON.stringify(kept));
  window.forgetOrder = (id) => calls.forgotten.push(id);
  window.fetch = async (url, init) => {
    const at = String(url);
    /*
     * ONE lookup for the whole page. It used to be a GET per order, which
     * ran the page into the placed-order limiter and made every row after
     * the tenth say "Not checked" - see readMany.
     */
    if (/\/orders\/lookup$/.test(at)) {
      const body = JSON.parse(init.body);
      calls.asked.push({ url: at, body });
      if (!reachable) return { ok: false, status: 503, json: async () => ({}) };
      const orders = body.orders
        .map((one) => says[one.orderId])
        .filter(Boolean);
      return { ok: true, status: 200, json: async () => ({ type: 'success', data: { orders } }) };
    }
    if (/\/menu$/.test(at)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ type: 'success', data: { categories: menu } }),
      };
    }
    if (init && init.method === 'POST') {
      calls.posted.push({ url: at, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ type: 'success', data: { ok: true } }) };
    }
    calls.asked.push(at);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  /* The chooser lives in indexedDB.js, which this page loads for real. */
  window.eval(lift(read('indexedDB.js'), 'goesWithOrder'));
  window.eval(read('assets/history/script.js'));
  /* The countdown is a real interval; a test that opens a row must close
     the page or the runner never exits. */
  return { window, document: window.document, calls, dom };
}

test('what this phone ordered is kept on this phone, and the shop says where each one got to', async () => {
  /* Owner: "also order history page not exist ... keep the history in the
     browser." There is no account behind a QR code, so there is no other
     list there could be. */
  const kept = [
    { orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: '2026-09-12T10:00:00.000Z', items: [{ name: 'Chicken Biryani', quantity: 2 }] },
    { orderId: 'o2', token: '220', shop: 'ABC', shopName: 'Azure', at: '2026-09-12T09:00:00.000Z', items: [{ name: 'Masala Dosa', quantity: 1 }] },
    { orderId: 'gone', token: '221', shop: 'ABC', shopName: 'Azure', at: '2026-09-11T09:00:00.000Z', items: [] },
  ];
  const says = {
    o1: { order_id: 'o1', token: '219', shop: 'Azure', paid: true, bill_ready: true, cancelled: false, state: 'accepted', items: [{ name: 'Chicken Biryani', quantity: 2 }], total: 660 },
    o2: { order_id: 'o2', token: '220', shop: 'Azure', paid: false, bill_ready: false, cancelled: false, state: 'accepted', items: [{ name: 'Masala Dosa', quantity: 1 }], total: 120 },
  };
  const { window, document, calls } = historyPage({ kept, says });
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));

  const rows = [...document.querySelectorAll('.history-row')];
  assert.strictEqual(rows.length, 2, 'an order the shop has never heard of stayed on the list');
  assert.deepStrictEqual(calls.forgotten, ['gone'], 'the dead order was not forgotten');

  /* Paid carries a bill; with the kitchen does not. */
  assert.strictEqual(rows[0].querySelector('.history-state').textContent, 'Paid');
  assert.strictEqual(rows[0].querySelector('.history-state').getAttribute('data-state'), 'paid');
  assert.ok(rows[0].querySelector('.history-bill'), 'a paid order offers no bill');
  assert.match(rows[0].querySelector('.history-bill').getAttribute('href'), /thankyou\.html\?token=219&order=o1/);
  assert.strictEqual(rows[1].querySelector('.history-state').textContent, 'With the kitchen');
  assert.ok(!rows[1].querySelector('.history-bill'), 'an unpaid order offers a bill');
  assert.match(rows[1].querySelector('.history-what').textContent, /1× Masala Dosa/);

  /* Each row is asked with its OWN token, at its own shop, and nothing
     else is asked for. The count is not pinned: a page may paint more than
     once (a language switch, a restore), and the guard above makes that
     harmless rather than forbidden. */
  for (const id of ['o1', 'o2', 'gone']) {
    const token = kept.find((row) => row.orderId === id).token;
    assert.ok(
      calls.asked.some((call) => call.body && call.body.orders.some((one) => one.orderId === id && one.token === token)),
      id + ' was not asked for with its own token'
    );
  }
  /*
   * And each paint asks ONCE for the whole page rather than once per order.
   *
   * That is the bug the owner hit: a request per row against a limiter of
   * ten a minute, so most rows answered nothing and said "Not checked". The
   * count of paints is still not pinned, for the reason above.
   */
  assert.ok(calls.asked.length >= 1, 'the shop was never asked');
  assert.ok(
    calls.asked.every(
      (call) =>
        call.url === '/online-ordering/ABC/orders/lookup' &&
        call.body.orders.map((o) => o.orderId).join() === 'o1,o2,gone'
    ),
    'the page asks the shop once per order again'
  );
});

test('a phone that has ordered nothing is told so, and a shop that cannot be reached keeps the list', async () => {
  const bare = historyPage({ kept: [] });
  bare.document.dispatchEvent(new bare.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(bare.document.getElementById('history-empty').hidden, false);
  assert.strictEqual(bare.document.querySelectorAll('.history-row').length, 0);

  /* Offline: the browser's own record still shows, marked as unchecked
     rather than silently claimed to be current. */
  const offline = historyPage({
    kept: [{ orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: '2026-09-12T10:00:00.000Z', items: [{ name: 'Lime Soda', quantity: 1 }] }],
  });
  offline.window.fetch = async () => {
    throw new Error('offline');
  };
  offline.document.dispatchEvent(new offline.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 40));
  const row = offline.document.querySelector('.history-row');
  assert.ok(row, 'an offline phone lost its own record');
  /* Owner: "don show that not checked and all." A row nobody has answered
     carries no label; the page says once, at the top, that the shop could
     not be reached. */
  assert.strictEqual(row.querySelector('.history-state').hidden, true);
  assert.strictEqual(offline.document.getElementById('history-offline').hidden, false);
  assert.deepStrictEqual(offline.calls.forgotten, [], 'an unreachable shop made the page forget an order');
});

test('the order is written into this phone\'s list when it is placed, with what it is', () => {
  const db = read('indexedDB.js');
  assert.match(db, /const ORDER_HISTORY_KEY = "posnic_orders";/);
  assert.match(db, /rememberOrder\(\{[\s\S]*orderId: String\(result\.data\.sale_id/, 'a placed order is not written to the list');
  assert.ok(
    db.indexOf('rememberOrder({') > db.indexOf('sessionStorage.setItem("kioskReceipt"'),
    'the order is remembered before it is known to have been placed'
  );
  /* And what the device is rides with the order, for the shop's records. */
  assert.match(db, /client: typeof clientFacts === "function" \? clientFacts\(\) : undefined/);
  assert.match(db, /const DEVICE_KEY = "posnic_device";/);
});

test('the bill is offered only when the shop says the money is in', () => {
  /* Owner: "once payment done from desktop then make bill available to
     download." */
  const script = read('assets/thankyou/script.js');
  assert.match(script, /async function offerBillWhenPaid\(token\)/);
  /* One or the other, never both: an unpaid order is offered a way to pay,
     a paid one is offered its bill. */
  assert.match(script, /if \(!body\.data\.bill_ready\) \{/);
  assert.match(script, /offerUpi\(body\.data, payment, token, orderId\);/);
  assert.ok(
    script.indexOf('button.hidden = false') > script.indexOf('bill_ready'),
    'the button is shown before the shop has been asked'
  );
  const html = read('thankyou.html');
  assert.match(html, /id="done-bill" hidden/, 'the bill button starts visible');
  assert.match(html, /history\.html'">Your orders/, 'there is no way from the token screen to the list');
});

/** The thank-you script's UPI helpers, lifted and run with a fake page. */
function upiBox({ payment = {}, said = {}, token = '042', orderId = 'o1' } = {}) {
  const dom = new JSDOM(read('thankyou.html'), { url: 'https://shop.example/order/thankyou.html?token=042', runScripts: 'outside-only' });
  const { window } = dom;
  const src = read('assets/thankyou/script.js');
  const cut = (name) => {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at > -1, 'thankyou/script.js no longer defines ' + name);
    const end = src.indexOf('\n}\n', at) + 3;
    return src.slice(at, end);
  };
  const sandbox = {
    window,
    document: window.document,
    t: (key, vars) => String(key).replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] != null ? String(vars[name]) : m)),
    Number,
    String,
    Object,
    encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext([cut('upiLinks'), cut('offerUpi')].join('\n'), sandbox);
  sandbox.offerUpi(said, payment, token, orderId);
  return { window, document: window.document, box: sandbox };
}

test('the UPI link carries the right payee and the right amount, and encodes everything', () => {
  /* Owner: "just configured upi id and how much enough. let cashier verify
     manually and update as paid." Money, so: the payee, the amount, and no
     way for a shop name to end the amount early. */
  const { document, box } = upiBox({
    payment: { upi_id: 'azure@okaxis', upi_name: 'Azure Sea & Foods' },
    said: { total: 660, paid: false, cancelled: false, shop: 'Azure' },
  });
  assert.strictEqual(document.getElementById('pay-upi').hidden, false);
  const href = document.getElementById('pay-upi-any').getAttribute('href');
  assert.ok(href.startsWith('upi://pay?pa=azure%40okaxis'), 'the payee is wrong or unencoded: ' + href);
  assert.match(href, /&am=660\.00&cu=INR/);
  assert.match(href, /&pn=Azure%20Sea%20%26%20Foods/, 'an ampersand in the shop name would end the amount early');
  assert.match(href, /&tn=Order%20042/);
  assert.match(href, /&tr=o1$/);
  assert.strictEqual(document.getElementById('pay-upi-gpay').getAttribute('href').startsWith('tez://upi/pay?'), true);
  assert.strictEqual(document.getElementById('pay-upi-phonepe').getAttribute('href').startsWith('phonepe://pay?'), true);
  assert.strictEqual(document.getElementById('pay-upi-paytm').getAttribute('href').startsWith('paytmmp://pay?'), true);
  assert.match(document.getElementById('pay-upi-amount').textContent, /Pay ₹660 to Azure Sea & Foods/);

  /* And it says plainly that nobody here checks it. */
  assert.match(read('thankyou.html'), /Tell the counter once you have paid/);
  void box;
});

test('nothing to pay, nowhere to send it, or already paid: no button at all', () => {
  const none = upiBox({ payment: {}, said: { total: 660, paid: false } });
  assert.strictEqual(none.document.getElementById('pay-upi').hidden, true, 'a shop with no UPI id offered one');

  const paid = upiBox({ payment: { upi_id: 'azure@okaxis' }, said: { total: 660, paid: true } });
  assert.strictEqual(paid.document.getElementById('pay-upi').hidden, true, 'a paid order was asked for money again');

  const off = upiBox({ payment: { upi_id: 'azure@okaxis' }, said: { total: 660, cancelled: true } });
  assert.strictEqual(off.document.getElementById('pay-upi').hidden, true, 'a cancelled order was asked for money');

  const free = upiBox({ payment: { upi_id: 'azure@okaxis' }, said: { total: 0, paid: false } });
  assert.strictEqual(free.document.getElementById('pay-upi').hidden, true, 'an order costing nothing offered a payment');
});

test('a row opens into the order, and the window is a countdown on it', async () => {
  /* Owner: "order history should able to clickable expand details within 30
     seconds they can modify ... shop ower setting might be." */
  const kept = [{ orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: new Date().toISOString(), items: [{ name: 'Chicken Biryani', quantity: 2 }] }];
  const says = {
    o1: {
      order_id: 'o1',
      token: '219',
      shop: 'Azure',
      placed_at: new Date().toISOString(),
      paid: false,
      cancelled: false,
      bill_ready: false,
      state: 'accepted',
      can_change: true,
      change_seconds: 30,
      items: [{ item_id: 'm1', name: 'Chicken Biryani', quantity: 2, total: 660, note: 'less spicy' }],
      total: 660,
    },
  };
  const { window, document, calls } = historyPage({ kept, says });
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));

  /* Closed to begin with: a list of open orders is a list nobody reads. */
  const panel = document.getElementById('details-o1');
  assert.ok(panel, 'the row does not open into anything');
  assert.strictEqual(panel.hidden, true);

  document.querySelector('.history-open').click();
  assert.strictEqual(panel.hidden, false, 'tapping the row did not open it');
  assert.match(panel.textContent, /2×\s*Chicken Biryani/);
  assert.match(panel.textContent, /less spicy/);
  assert.match(panel.textContent, /Total ₹660/);
  assert.match(panel.querySelector('.history-clock').textContent, /\d+s to change it/);

  /* Inside the window: a minus, a plus, and a Cancel that cancels. */
  const steps = [...panel.querySelectorAll('.history-step')];
  assert.strictEqual(steps.length, 2, 'the line cannot be changed by hand');
  assert.strictEqual(steps[1].getAttribute('data-quantity'), '3', 'plus does not mean one more');
  assert.strictEqual(steps[0].getAttribute('data-quantity'), '1', 'minus does not mean one fewer');
  assert.strictEqual(panel.querySelector('.history-cancel').textContent, 'Cancel the order');

  steps[1].click();
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(calls.posted.length, 1);
  assert.match(calls.posted[0].url, /\/online-ordering\/ABC\/orders\/o1\/items$/);
  assert.deepStrictEqual(calls.posted[0].body, { token: '219', items: [{ item_id: 'm1', quantity: 3 }] });
  window.close();
});

test('once the window has closed, cancelling asks the shop instead of doing it', async () => {
  /* Owner: "may be approval from desktop. user can submit the request
     however." */
  const kept = [{ orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: '2026-09-12T09:00:00.000Z', items: [] }];
  const says = {
    o1: {
      order_id: 'o1',
      token: '219',
      shop: 'Azure',
      placed_at: '2026-09-12T09:00:00.000Z',
      paid: false,
      cancelled: false,
      state: 'accepted',
      can_change: false,
      why_not: 'too_late',
      change_seconds: 30,
      items: [{ item_id: 'm1', name: 'Chicken Biryani', quantity: 2, total: 660 }],
      total: 660,
    },
  };
  const { window, document, calls } = historyPage({ kept, says });
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));
  document.querySelector('.history-open').click();
  const panel = document.getElementById('details-o1');

  assert.strictEqual(panel.querySelectorAll('.history-step').length, 0, 'a closed window still offers to change the order');
  assert.strictEqual(panel.querySelector('.history-clock'), null, 'a closed window is still counting down');
  const off = panel.querySelector('.history-cancel');
  assert.strictEqual(off.textContent, 'Ask the shop to cancel', 'the button still claims to cancel it outright');

  off.click();
  await new Promise((r) => setTimeout(r, 60));
  assert.match(calls.posted[0].url, /\/orders\/o1\/cancel$/);
  assert.deepStrictEqual(calls.posted[0].body, { token: '219' });
  window.close();
});

test('an order already asked about says so, and a paid one is not asked about at all', async () => {
  const asked = historyPage({
    kept: [{ orderId: 'o1', token: '219', shop: 'ABC', at: '2026-09-12T09:00:00.000Z', items: [] }],
    says: { o1: { order_id: 'o1', token: '219', placed_at: '2026-09-12T09:00:00.000Z', can_change: false, cancel_requested: true, paid: false, cancelled: false, items: [], total: 120 } },
  });
  asked.document.dispatchEvent(new asked.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));
  asked.document.querySelector('.history-open').click();
  const panel = asked.document.getElementById('details-o1');
  assert.match(panel.textContent, /The shop has your cancellation request/);
  assert.strictEqual(panel.querySelector('.history-cancel').disabled, true, 'the same request can be sent twice');

  const paid = historyPage({
    kept: [{ orderId: 'o2', token: '220', shop: 'ABC', at: '2026-09-12T09:00:00.000Z', items: [] }],
    says: { o2: { order_id: 'o2', token: '220', placed_at: '2026-09-12T09:00:00.000Z', can_change: false, paid: true, bill_ready: true, cancelled: false, items: [], total: 120 } },
  });
  paid.document.dispatchEvent(new paid.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));
  paid.document.querySelector('.history-open').click();
  assert.strictEqual(paid.document.getElementById('details-o2').querySelector('.history-cancel'), null, 'a paid order can still be cancelled from the phone');
  asked.window.close();
  paid.window.close();
});

/** A 2d context that records what was asked of it, and a canvas holding it. */
function recordingCanvas(window) {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(target, name) {
        if (name === 'canvas') return canvas;
        if (name === 'setTransform') return () => calls.push(['setTransform']);
        return (...args) => calls.push([String(name), ...args]);
      },
      set(target, name, value) {
        calls.push(['set:' + String(name), value]);
        return true;
      },
    }
  );
  const canvas = {
    width: 280,
    height: 170,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 280, height: 170 }),
    setAttribute: () => {},
  };
  void window;
  return { canvas, calls };
}

test('a row nobody has answered carries no label, and an unreachable shop says so once', async () => {
  /*
   * Owner: "i requested one order both order status saying as not checked.
   * don show that not checked and all." A row that has not been answered
   * carries no label at all; the shop being unreachable is said ONCE, at the
   * top, because that is a fact about the page and not about twelve orders.
   */
  const kept = [
    { orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: '2026-09-12T10:00:00.000Z', items: [{ name: 'Chicken Biryani', quantity: 2 }] },
    { orderId: 'o2', token: '220', shop: 'ABC', shopName: 'Azure', at: '2026-09-12T09:00:00.000Z', items: [{ name: 'Masala Dosa', quantity: 1 }] },
  ];
  const page = historyPage({ kept, says: {}, reachable: false });
  page.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(page.document.getElementById('history-offline').hidden, false, 'nothing said the shop could not be reached');
  const labels = [...page.document.querySelectorAll('.history-state')];
  assert.ok(labels.every((one) => one.hidden), 'a row is still labelled "Not checked"');
  assert.ok(!page.document.body.textContent.includes('Not checked'), '"Not checked" is still on the page');
  /* And nothing was forgotten: a shop that cannot be reached has not said
     it never heard of these orders. */
  assert.deepStrictEqual(page.calls.forgotten, []);
  page.window.close();
});

test('a row opens into the order, and a dish that was never on it can be added', async () => {
  /*
   * Owner: "when i click order history full details needs to be open. and add
   * new item, existing item change etc, need to be there." The details were
   * built; a row with no answer got no panel, and the rate limiter meant most
   * rows had no answer. The suggestions are new.
   */
  const kept = [{ orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: new Date().toISOString(), items: [{ name: 'Chicken Biryani', quantity: 2 }] }];
  const says = {
    o1: {
      order_id: 'o1', token: '219', shop: 'Azure', paid: false, cancelled: false, state: 'accepted',
      placed_at: new Date().toISOString(), can_change: true, change_seconds: 30, cancel_requested: false,
      items: [{ item_id: 'm1', name: 'Chicken Biryani', quantity: 2, total: 640 }], total: 640,
    },
  };
  const menu = [
    { name: 'Mains', items: [{ id: 'm1', name: 'Chicken Biryani', price: 320, available: true }] },
    { name: 'Drinks', items: [{ id: 'd1', name: 'Fresh Lime Soda', price: 80, available: true }, { id: 'd2', name: 'Cold Coffee', price: 140, available: true }] },
  ];
  const page = historyPage({ kept, says, menu });
  page.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));

  const open = page.document.querySelector('.history-open');
  assert.ok(open, 'there is no row to open');
  open.click();
  const panel = page.document.getElementById('details-o1');
  assert.ok(panel && !panel.hidden, 'the row did not open');

  /* Every line, with a minus and a plus. */
  assert.deepStrictEqual(
    [...panel.querySelectorAll('.history-step')].map((b) => b.getAttribute('data-quantity')),
    ['1', '3']
  );

  /* And something that was never on it - from a category they have not
     ordered from, cheapest first, never the biryani they already have. */
  await new Promise((r) => setTimeout(r, 20));
  const offered = [...panel.querySelectorAll('.history-more-item')];
  assert.deepStrictEqual(offered.map((b) => b.getAttribute('data-add')), ['d1', 'd2']);

  offered[0].click();
  await new Promise((r) => setTimeout(r, 40));
  const added = page.calls.posted.filter((c) => /\/orders\/o1\/items$/.test(c.url));
  assert.strictEqual(added.length, 1, 'the add button did nothing');
  assert.deepStrictEqual(added[0].body, { token: '219', items: [{ item_id: 'd1', quantity: 1 }] });
  page.window.close();
});

test('an order the shop has closed offers nothing to change', async () => {
  const kept = [{ orderId: 'o1', token: '219', shop: 'ABC', shopName: 'Azure', at: new Date().toISOString(), items: [] }];
  const says = {
    o1: {
      order_id: 'o1', token: '219', shop: 'Azure', paid: false, cancelled: false, state: 'accepted',
      placed_at: new Date().toISOString(), can_change: false, why_not: 'too_late', change_seconds: 0,
      cancel_requested: false, items: [{ item_id: 'm1', name: 'Chicken Biryani', quantity: 2 }], total: 640,
    },
  };
  const page = historyPage({ kept, says, menu: [{ name: 'Drinks', items: [{ id: 'd1', name: 'Fresh Lime Soda', price: 80 }] }] });
  page.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 60));
  page.document.querySelector('.history-open').click();
  await new Promise((r) => setTimeout(r, 30));

  const panel = page.document.getElementById('details-o1');
  assert.deepStrictEqual([...panel.querySelectorAll('.history-step')], [], 'a stepper that could only fail');
  assert.strictEqual(panel.querySelector('.history-more'), null, 'something was offered that could not be added');
  /* Asking is still allowed: cancelling is a different flow and every shop
     has it. */
  assert.strictEqual(panel.querySelector('.history-cancel').textContent, 'Ask the shop to cancel');
  page.window.close();
});

test('the order rings a bell when the kitchen takes it, on both ways of ordering', () => {
  /*
   * Owner: "give ting sound to confirm. both customer side."
   *
   * Synthesised rather than a file: nothing to fetch, nothing for the page's
   * CSP to allow, and no moment where the picture has arrived and the sound
   * has not. The real assets/ting.js is evaluated here, so a change that
   * stops it sounding fails.
   */
  const dom = new JSDOM('<body></body>', { url: 'https://shop.example/order/', runScripts: 'outside-only' });
  const { window } = dom;
  const struck = [];
  window.AudioContext = function () {
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = {};
    this.resume = () => { this.state = 'running'; };
    this.createOscillator = () => {
      const osc = { frequency: {}, connect() {}, start() {}, stop() {} };
      struck.push(osc);
      return osc;
    };
    this.createGain = () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    });
  };
  window.eval(read('assets/ting.js'));

  assert.strictEqual(window.Ting.play(), true, 'the bell made no sound');
  /* Two strikes, each a fundamental and a partial above it - a bell, not a
     test tone. */
  assert.strictEqual(struck.length, 4);
  assert.deepStrictEqual(
    struck.map((o) => Math.round(o.frequency.value)),
    [1047, 2888, 1397, 3855]
  );

  /* One context, reused: a new one per order leaks a hardware handle, and
     browsers cap how many a page may hold - the twentieth order of the
     evening would fall silent. */
  const first = window.AudioContext;
  window.AudioContext = function () { throw new Error('a second context was made'); };
  assert.strictEqual(window.Ting.play(), true, 'the bell built a second audio context');
  window.AudioContext = first;
  window.close();

  /* And both ways of placing an order ring it: the assistant on the beat its
     drawn bell is struck, and the token screen for a basket tapped through. */
  const assistant = read('assets/assistant/script.js');
  assert.match(assistant, /if \(beat === "landed"\) ting\(\);/, 'the assistant never rings the bell');
  assert.match(assistant, /window\.Ting && typeof window\.Ting\.play === "function"/);
  const token = read('assets/thankyou/script.js');
  assert.match(token, /window\.Ting\.play\(\)/, 'a basket tapped through confirms itself in silence');
  assert.match(token, /rung_\$\{token\}/, 'a refresh of the token screen rings the bell again');
  for (const page of ['products.html', 'thankyou.html']) {
    assert.match(read(page), /assets\/ting\.js/, page + ' never loads the bell');
  }
});

test('the kitchen scene draws the docket first, then the pan, and says which beat it is on', () => {
  /* Owner: "i want very cool animation ... sending order to kitchen. and
     they got it preparing." Three beats, and the drawing changes with them. */
  const dom = new JSDOM(read('products.html'), { url: 'https://shop.example/order/products.html', runScripts: 'outside-only' });
  const { window } = dom;
  /* The real page loads indexedDB.js before the assistant, and the chooser
     for the things that go with an order lives there, so the order history
     and the confirmation screen cannot drift apart. */
  window.eval(lift(read('indexedDB.js'), 'goesWithOrder'));
  window.eval(read('assets/assistant/kitchen-scene.js'));
  const scene = window.KitchenScene;
  /* Spread: an array from the page's realm is not reference-equal to one
     of ours, however alike they look. */
  assert.deepStrictEqual([...scene.BEATS].map((b) => b.name), ['sending', 'landed', 'cooking']);
  assert.ok(scene.BEATS[1].at > scene.BEATS[0].at && scene.BEATS[2].at > scene.BEATS[1].at, 'the beats are out of order');

  const colours = { ink: '#111', soft: '#666', line: '#ddd', surface: '#fff', accent: '#111' };
  const early = recordingCanvas(window);
  scene.frame(early.canvas.getContext(), colours, 280, 170, 200, false);
  const earlyNames = early.calls.map((c) => c[0]);
  assert.ok(earlyNames.includes('clearRect'), 'the scene does not clear between frames');
  assert.ok(earlyNames.filter((n) => n === 'rotate').length > 0, 'the docket is not in flight');

  /* Late on, it is a pan with steam and no docket flying. */
  const late = recordingCanvas(window);
  scene.frame(late.canvas.getContext(), colours, 280, 170, scene.BEATS[2].at + 900, false);
  const lateSets = late.calls.filter((c) => c[0] === 'set:globalAlpha').map((c) => c[1]);
  assert.ok(lateSets.some((a) => a > 0 && a <= 1), 'nothing was faded in for the cooking beat');
  assert.ok(late.calls.some((c) => c[0] === 'quadraticCurveTo'), 'the pan and steam are not drawn');

  /* Asked for less motion, it draws the settled kitchen once. */
  const still = recordingCanvas(window);
  scene.frame(still.canvas.getContext(), colours, 280, 170, 0, true);
  assert.ok(still.calls.some((c) => c[0] === 'quadraticCurveTo'), 'the still frame draws nothing');
});

test('the scene tells the caption which beat it is on, and stops when it is told to', async () => {
  const dom = new JSDOM(read('products.html'), { url: 'https://shop.example/order/products.html', runScripts: 'outside-only' });
  const { window } = dom;
  /* The real page loads indexedDB.js before the assistant, and the chooser
     for the things that go with an order lives there, so the order history
     and the confirmation screen cannot drift apart. */
  window.eval(lift(read('indexedDB.js'), 'goesWithOrder'));
  window.eval(read('assets/assistant/kitchen-scene.js'));

  /* A canvas that hands back no context - an old browser, a hardened one -
     still gets every caption, on the same clock. */
  const beats = [];
  const stop = window.KitchenScene.play({ getContext: () => null, getBoundingClientRect: () => ({ width: 280, height: 170 }) }, {
    onBeat: (name) => beats.push(name),
  });
  assert.deepStrictEqual(beats, ['sending'], 'the first beat is not immediate');
  stop();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(beats, ['sending'], 'a stopped scene went on calling back');

  /* And with no canvas at all. */
  const more = [];
  window.KitchenScene.play(null, { onBeat: (name) => more.push(name) })();
  assert.deepStrictEqual(more, ['sending']);
});
