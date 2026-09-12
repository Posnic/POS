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
