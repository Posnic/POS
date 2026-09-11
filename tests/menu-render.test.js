'use strict';

/*
 * The menu page, actually rendered.
 *
 * WHY, when the bundle test already checks the file.
 *
 * Static checks on this bundle have missed three real bugs: categories came out
 * alphabetical (Breads before Starters), the logo drew as an empty grey circle
 * because `display:block` beat the `hidden` attribute, and the search icon was
 * U+26B2 - a lantern. Each one passed every assertion in the repository and was
 * obvious the moment a person looked at the page.
 *
 * So this one builds the page, hands it a reply, and reads what came out.
 *
 * The venue case is the one that costs money: a menu printed for a hotel room
 * has to show the price that room will be charged. Showing the house price and
 * adding the markup at checkout is how a guest finds out about it at the worst
 * possible moment, and a guest who feels overcharged complains to the hotel -
 * which is the relationship the whole feature exists to protect.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'menu');

const REPLY = {
  store: { store_id: 'AZ100', name: 'Azure Kitchen', currency: 'Rs' },
  channel: { state: 'open', accepting: true, message: '' },
  service_point: { label: '', venue: null },
  categories: [
    {
      id: 'starters',
      name: 'Starters',
      items: [
        {
          id: 'i1',
          name: 'Paneer Tikka',
          description: 'Charred, on skewers',
          price: 280,
          diet: 'veg',
          available: true,
          served_in: [],
          prep_minutes: 15,
        },
      ],
    },
    {
      id: 'breads',
      name: 'Breads',
      items: [
        {
          id: 'i2',
          name: 'Butter Naan',
          description: '',
          price: 60,
          diet: 'veg',
          available: true,
          served_in: [],
          prep_minutes: 0,
        },
      ],
    },
  ],
  item_count: 2,
};

/** The page at `url`, with the server answering `reply`. */
async function render(url, reply) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://shop.example' + url, runScripts: 'outside-only' });
  const { window } = dom;

  /* The one thing the page reaches for that a test has to answer. */
  let asked = '';
  window.fetch = (target) => {
    asked = String(target);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ type: 'success', data: reply }),
    });
  };
  window.IntersectionObserver = function () {
    return { observe() {}, disconnect() {} };
  };

  /* Both files in one eval, in the order the page loads them. config.js
     declares CONFIG with const, which lives in the eval's own scope and not on
     window - two evals and menu.js cannot see it, exactly as a page that
     loaded the scripts out of order would fail. */
  window.eval(
    [
      fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'menu.js'), 'utf8'),
    ].join('\n')
  );

  /* The fetch resolves on a microtask; let it land before reading the page. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { window, document: window.document, asked: () => asked };
}

test('a plain /menu/AZ100 asks for that branch and draws its dishes', async () => {
  const { document, asked } = await render('/menu/AZ100', REPLY);

  assert.match(asked(), /\/online-ordering\/AZ100\/menu$/, 'the menu asked the wrong URL');
  assert.strictEqual(document.getElementById('shop-name').textContent, 'Azure Kitchen');
  assert.strictEqual(document.querySelectorAll('.dish').length, 2);
  assert.match(document.getElementById('menu').textContent, /Paneer Tikka/);
});

/*
 * THE ONE THE PATH SHAPE EXISTS FOR.
 *
 * The first version of this read the LAST path segment as the store address,
 * which is right for /menu/AZ100 and asks the server for a shop called "123"
 * on /menu/AZ100/venue/RC/123. The page would have shown "This menu is not
 * available" in a hotel room with a code on the wall.
 */
test('a hotel room asks for that branch, and says which room it is asking for', async () => {
  const { asked } = await render('/menu/AZ100/venue/RC/123', REPLY);
  const url = asked();
  assert.match(url, /\/online-ordering\/AZ100\/menu\?/, 'the branch was read out of the wrong segment');
  assert.match(url, /venue=RC/);
  assert.match(url, /unit=123/);
});

test('a table code asks for the table, not for a shop called "5"', async () => {
  const { asked } = await render('/menu/AZ100/table/5', REPLY);
  assert.match(asked(), /\/online-ordering\/AZ100\/menu\?table=5$/);
});

test('a room is told plainly that these are its prices', async () => {
  const { document } = await render('/menu/AZ100/venue/RC/123', {
    ...REPLY,
    service_point: {
      label: 'Royal Club Hotel - 123',
      venue: { code: 'rc', name: 'Royal Club Hotel', unit_label: 'Room', unit: '123' },
    },
    categories: [
      {
        ...REPLY.categories[0],
        items: [{ ...REPLY.categories[0].items[0], price: 308 }],
      },
    ],
  });

  const note = document.getElementById('venue-note');
  assert.strictEqual(note.hidden, false, 'the room was never told whose prices these are');
  assert.strictEqual(note.textContent, 'Prices shown for Royal Club Hotel, Room 123');
  /* And the price on the card is the one the room actually pays. */
  assert.match(document.getElementById('menu').textContent, /308/);
});

test('the shop own floor is told nothing extra, because there is nothing to say', async () => {
  const { document } = await render('/menu/AZ100', REPLY);
  assert.strictEqual(document.getElementById('venue-note').hidden, true);
});

/*
 * The bug a static check cannot see: categories came out alphabetical, which
 * put Breads before Starters. Stable, and wrong in a way any restaurant would
 * notice immediately. The server decides the order now, and the page must
 * render what it was given rather than sorting it again.
 */
test('the sections come out in the order the server sent them', async () => {
  const { document } = await render('/menu/AZ100', REPLY);
  const headings = [...document.querySelectorAll('.section h2')].map((h) => h.textContent);
  assert.deepStrictEqual(headings, ['Starters', 'Breads']);
});

test('the category chips stay on this branch rather than navigating away', async () => {
  /*
   * The page carries a <base href="/menu/"> so its assets resolve on a deep
   * URL. A base also makes the browser resolve "#cat-x" against IT, so a chip
   * would navigate to /menu/ and throw away both the branch and the room. The
   * chips are handled in JavaScript for exactly that reason.
   */
  const js = fs.readFileSync(path.join(ROOT, 'menu.js'), 'utf8');
  assert.match(js, /closest\(["']\.cat["']\)/, 'the category chips are no longer intercepted');
  assert.match(js, /preventDefault/, 'a chip click would navigate away from the branch');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<base\b[^>]*href="\/menu\/"/, 'the base tag this depends on is gone');
});

/* ------------------------------------------------- search, filters and sort */

const RICH = {
  ...REPLY,
  categories: [
    {
      id: 'starters',
      name: 'Starters',
      items: [
        {
          id: 'i1', name: 'Paneer Tikka', description: 'Charred, on skewers',
          price: 280, diet: 'veg', available: true, served_in: [],
          prep_minutes: 15, ordered_count: 12, goes_with: ['i4'],
        },
        {
          id: 'i2', name: 'Chicken 65', description: 'Chettinad style',
          price: 320, diet: 'non_veg', available: true, served_in: [],
          prep_minutes: 18, ordered_count: 40, goes_with: [],
        },
        {
          id: 'i3', name: 'Gobi Manchurian', description: 'Cauliflower, soy',
          price: 240, diet: 'veg', available: false, served_in: [],
          prep_minutes: 0, ordered_count: 3, goes_with: [],
        },
      ],
    },
    {
      id: 'breads',
      name: 'Breads',
      items: [
        {
          id: 'i4', name: 'Butter Naan', description: '',
          price: 60, diet: 'veg', available: true, served_in: [],
          prep_minutes: 8, ordered_count: 55, goes_with: ['i1'],
        },
      ],
    },
  ],
  item_count: 4,
};

const visible = (document) =>
  [...document.querySelectorAll('.dish')]
    .filter((d) => !d.hidden)
    .map((d) => d.querySelector('.dish-name').textContent);

test('a misspelling still finds the dish', async () => {
  /*
   * THE WHOLE POINT OF THE FUZZY ENGINE.
   *
   * A hungry person on a phone types "panner". A menu that answers "nothing
   * matches" reads as a restaurant that does not sell it, and every food app
   * in the country tolerates this - so a menu that does not feels broken
   * rather than strict.
   */
  const { window, document } = await render('/menu/AZ100', RICH);
  const box = document.getElementById('search');
  box.value = 'panner';
  box.dispatchEvent(new window.Event('input'));

  assert.deepStrictEqual(visible(document), ['Paneer Tikka']);
});

test('a word nobody resembles still finds nothing, and says so', async () => {
  const { window, document } = await render('/menu/AZ100', RICH);
  const box = document.getElementById('search');
  box.value = 'lasagne';
  box.dispatchEvent(new window.Event('input'));

  assert.deepStrictEqual(visible(document), []);
  assert.match(document.getElementById('result-count').textContent, /Nothing matches/);
});

test('veg only hides the non-veg, and never guesses at the unmarked', async () => {
  /* A shop that never filled the diet field has promised nothing. Assuming
     vegetarian on its behalf is the one mistake this filter must not make. */
  const { document } = await render('/menu/AZ100', RICH);
  document.getElementById('filter-veg').click();

  const shown = visible(document);
  assert.ok(!shown.includes('Chicken 65'), 'a non-veg dish survived the veg filter');
  assert.ok(shown.includes('Paneer Tikka'));
});

test('available now hides what is off tonight', async () => {
  const { document } = await render('/menu/AZ100', RICH);
  document.getElementById('filter-available').click();
  assert.ok(!visible(document).includes('Gobi Manchurian'));
});

test('filters and search narrow together rather than replacing each other', async () => {
  /*
   * They used to be one function reading a text box, so turning a filter on
   * silently threw away whatever had been typed.
   */
  const { window, document } = await render('/menu/AZ100', RICH);
  const box = document.getElementById('search');
  box.value = 'tikka';
  box.dispatchEvent(new window.Event('input'));
  document.getElementById('filter-veg').click();

  assert.deepStrictEqual(visible(document), ['Paneer Tikka']);
});

test('most ordered puts the best seller first', async () => {
  const { window, document } = await render('/menu/AZ100', RICH);
  const sort = document.getElementById('sort');
  sort.value = 'popular';
  sort.dispatchEvent(new window.Event('change'));

  /* Within each section: the sections themselves keep the shop's order. */
  const starters = [...document.querySelectorAll('.section')][0];
  const names = [...starters.querySelectorAll('.dish-name')].map((n) => n.textContent);
  assert.strictEqual(names[0], 'Chicken 65');
});

test('price low to high sorts on the price the reader is being shown', async () => {
  const { window, document } = await render('/menu/AZ100', RICH);
  const sort = document.getElementById('sort');
  sort.value = 'price_asc';
  sort.dispatchEvent(new window.Event('change'));

  const starters = [...document.querySelectorAll('.section')][0];
  const names = [...starters.querySelectorAll('.dish-name')].map((n) => n.textContent);
  assert.deepStrictEqual(names, ['Gobi Manchurian', 'Paneer Tikka', 'Chicken 65']);
});

test('a live search outranks the sort box, because it is a question', async () => {
  /* Somebody who just typed "naan" is asking something; answering in price
     order buries the answer. The box takes over again once it is cleared. */
  const { window, document } = await render('/menu/AZ100', RICH);
  const sort = document.getElementById('sort');
  sort.value = 'price_desc';
  sort.dispatchEvent(new window.Event('change'));

  const box = document.getElementById('search');
  box.value = 'paneer';
  box.dispatchEvent(new window.Event('input'));

  assert.deepStrictEqual(visible(document), ['Paneer Tikka']);
});

test('the categories step aside while anything is narrowing the list', async () => {
  const { document } = await render('/menu/AZ100', RICH);
  assert.strictEqual(document.getElementById('cats').hidden, false);
  document.getElementById('filter-veg').click();
  assert.strictEqual(document.getElementById('cats').hidden, true);
});

test('opening a dish offers what people order with it', async () => {
  const { document } = await render('/menu/AZ100', RICH);
  document.querySelector('.dish[data-id="i1"]').click();

  const box = document.getElementById('goes-with');
  assert.strictEqual(box.hidden, false, 'no suggestions were offered');
  assert.match(document.getElementById('goes-row').textContent, /Butter Naan/);
});

test('a dish with no history offers nothing rather than filling the space', async () => {
  /* Recommending at random is something a diner notices immediately, and then
     stops trusting the rest of the page. */
  const { document } = await render('/menu/AZ100', RICH);
  document.querySelector('.dish[data-id="i2"]').click();
  assert.strictEqual(document.getElementById('goes-with').hidden, true);
});

test('a suggestion opens that dish', async () => {
  /* It sits INSIDE the open sheet, so the handler has to run before the one
     for dish cards or tapping it would do nothing at all. */
  const { document } = await render('/menu/AZ100', RICH);
  document.querySelector('.dish[data-id="i1"]').click();
  document.querySelector('.goes').click();
  assert.strictEqual(document.getElementById('sheet-title').textContent, 'Butter Naan');
});

/* ----------------------------------------------------------- photo gallery */

const withPhotos = (photos, extra = {}) => ({
  ...REPLY,
  categories: [
    {
      id: 'starters',
      name: 'Starters',
      items: [{ ...REPLY.categories[0].items[0], photos, ...extra }],
    },
  ],
});

test('several photos become a strip you can push sideways', async () => {
  /*
   * Shops have uploaded more than one per dish for years - the item form has
   * taken a set all along - and the menu showed exactly one. The rest were
   * taken, stored, paid for, and never seen by a customer.
   */
  const { document } = await render('/menu/AZ100', withPhotos(['a.jpg', 'b.jpg', 'c.jpg']));
  document.querySelector('.dish').click();

  const strip = document.getElementById('sheet-strip');
  assert.strictEqual(document.getElementById('sheet-gallery').hidden, false);
  assert.strictEqual(strip.querySelectorAll('img').length, 3);
  assert.strictEqual(document.getElementById('sheet-dots').children.length, 3);
});

test('only the first photo loads eagerly', async () => {
  /* The rest are off-screen until somebody pushes the strip, and a phone on a
     bad connection should not pay for five photos of a dish nobody opened. */
  const { document } = await render('/menu/AZ100', withPhotos(['a.jpg', 'b.jpg']));
  document.querySelector('.dish').click();

  const imgs = [...document.querySelectorAll('#sheet-strip img')];
  assert.strictEqual(imgs[0].getAttribute('loading'), 'eager');
  assert.strictEqual(imgs[1].getAttribute('loading'), 'lazy');
});

test('one photo is not a gallery, so the dots go', async () => {
  const { document } = await render('/menu/AZ100', withPhotos(['only.jpg']));
  document.querySelector('.dish').click();

  assert.strictEqual(document.getElementById('sheet-gallery').hidden, false);
  assert.strictEqual(document.getElementById('sheet-dots').hidden, true);
  assert.strictEqual(document.getElementById('sheet-strip').getAttribute('data-count'), '1');
});

test('a dish with no photos shows no empty grey box', async () => {
  const { document } = await render(
    '/menu/AZ100',
    withPhotos([], { image: '' })
  );
  document.querySelector('.dish').click();

  assert.strictEqual(document.getElementById('sheet-gallery').hidden, true);
  assert.strictEqual(document.getElementById('sheet-img').hidden, true);
});

test('an older reply with only a cover image still shows it', async () => {
  /* photos is new. A cached page, or a shop whose menu has not been rebuilt,
     sends the single image and nothing else - and must not lose its photo
     because a newer field is absent. */
  const { document } = await render('/menu/AZ100', withPhotos(undefined, { image: 'cover.jpg' }));
  document.querySelector('.dish').click();

  const imgs = [...document.querySelectorAll('#sheet-strip img')];
  assert.strictEqual(imgs.length, 1);
  assert.match(imgs[0].getAttribute('src'), /cover\.jpg/);
});

test('every photo carries an alt a screen reader can use', async () => {
  const { document } = await render('/menu/AZ100', withPhotos(['a.jpg', 'b.jpg']));
  document.querySelector('.dish').click();

  const alts = [...document.querySelectorAll('#sheet-strip img')].map((i) => i.getAttribute('alt'));
  assert.match(alts[0], /Paneer Tikka, photo 1 of 2/);
  assert.match(alts[1], /photo 2 of 2/);
});

test('with no photo at all the generated icon still stands in', async () => {
  /*
   * Two features that landed the same afternoon and had to meet: the photo
   * strip, and the drawn icon for the shops - most of them - that upload
   * nothing. Photos win where they exist; the icon covers the rest; an empty
   * grey box is never the answer.
   */
  const { document } = await render(
    '/menu/AZ100',
    withPhotos([], { image: '', icon: '🍛' })
  );
  document.querySelector('.dish').click();

  assert.strictEqual(document.getElementById('sheet-gallery').hidden, true);
  assert.strictEqual(document.getElementById('sheet-icon').hidden, false);
  assert.strictEqual(document.getElementById('sheet-icon').textContent, '🍛');
});

test('a photo beats the icon rather than sitting beside it', async () => {
  const { document } = await render(
    '/menu/AZ100',
    withPhotos(['a.jpg'], { icon: '🍛' })
  );
  document.querySelector('.dish').click();

  assert.strictEqual(document.getElementById('sheet-gallery').hidden, false);
  assert.strictEqual(document.getElementById('sheet-icon').hidden, true);
});

test('a dish carries every photo, not the cover plus broken icons', () => {
  /*
   * THE BUG, AS THE OWNER SAW IT: "second images not loaded properly".
   *
   * `multi_image` is an array of OBJECTS - { name, cover } - and has been
   * since the item form learned to take a set. The first version of the menu's
   * photo list mapped it with String(src), which turns an object into the
   * literal text "[object Object]". The cover came through because that one IS
   * a string, so every dish showed its first photo and a broken icon for each
   * of the rest.
   *
   * Nothing failed. The API answered 200 with a list of valid-looking strings;
   * only a browser trying to fetch one could tell.
   */
  const { photoList } = require('../api/src/utils/online-ordering');

  assert.deepStrictEqual(
    photoList({ image: 'a.jpg', multi_image: [{ name: 'a.jpg', cover: 'yes' }, { name: 'b.jpg' }] }),
    ['a.jpg', 'b.jpg'],
    'the object shape multi_image actually has is not read'
  );

  /* Old rows carry bare strings; both shapes exist in the wild. */
  assert.deepStrictEqual(photoList({ image: 'a.jpg', multi_image: ['b.jpg'] }), ['a.jpg', 'b.jpg']);

  /* The cover is usually also the first of the set - one photo, not a
     two-photo carousel of the same picture. */
  assert.deepStrictEqual(photoList({ image: 'a.jpg', multi_image: [{ name: 'a.jpg' }] }), ['a.jpg']);

  assert.deepStrictEqual(photoList({}), [], 'a dish with no photo gets an empty list, not [""]');

  /* Nothing may come back that a browser cannot fetch. */
  const mixed = photoList({ image: 'a.jpg', multi_image: [{ cover: 'yes' }, null, { name: '  ' }, { name: 'c.png' }] });
  assert.ok(
    mixed.every((src) => typeof src === 'string' && src.trim() && !src.includes('[object')),
    `photoList produced something unfetchable: ${JSON.stringify(mixed)}`
  );
  assert.deepStrictEqual(mixed, ['a.jpg', 'c.png']);
});

test('the sheet can open a photo full size, and close it again', () => {
  /* Owner: "if i click alone image lets show original big image. and close
     button." The strip crops to one band so the sheet reads as a list; that
     is wrong for deciding, so the whole picture is a tap away. */
  const html = fs.readFileSync(path.join(__dirname, '..', 'menu', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'menu', 'menu.js'), 'utf8');

  assert.match(html, /id="viewer"/, 'there is nothing to show a photo full size in');
  assert.match(html, /id="viewer-close"/, 'the full size photo has no way out');
  assert.match(html, /object-fit: contain/, 'the opened photo is cropped like the strip it came from');

  assert.match(js, /function openViewer/, 'nothing opens the viewer');
  assert.match(js, /viewer-close.*addEventListener|addEventListener\("click", closeViewer\)/s,
    'the close button is not wired');
});

/* ------------------------------------------------ searching is a place you go */

/** Type into the search box the way a person does, and let the page settle. */
async function typeSearch(window, term) {
  const input = window.document.getElementById('search');
  input.value = term;
  input.dispatchEvent(new window.Event('focus'));
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  return input;
}

test('search answers with a dense list, where the eye already is', async () => {
  /*
   * Owner: "40 dishes found. i see that in big space. its not good."
   *
   * The counter sat alone over a screen of white while the matches waited
   * below the fold, because the results were the same tall browsing cards.
   * With a keyboard covering half a phone that is one or two dishes visible.
   */
  const { window, document } = await render('/menu/AZ100', REPLY);
  await typeSearch(window, 'paneer');

  const results = document.getElementById('results');
  assert.strictEqual(results.hidden, false, 'searching did not produce a result list');
  assert.strictEqual(document.getElementById('menu').hidden, true, 'the browsing cards are still on screen');

  const rows = results.querySelectorAll('.result');
  assert.strictEqual(rows.length, 1, `expected one match, drew ${rows.length}`);
  assert.match(rows[0].textContent, /Paneer Tikka/);
  /* Name, section and price on one line - what a list is for. */
  assert.match(rows[0].textContent, /Rs 280/);
});

test('leaving the search puts the menu back', async () => {
  const { window, document } = await render('/menu/AZ100', REPLY);
  await typeSearch(window, 'paneer');
  assert.strictEqual(document.getElementById('menu').hidden, true);

  document.getElementById('search-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(document.getElementById('menu').hidden, false, 'the menu did not come back');
  assert.strictEqual(document.getElementById('results').hidden, true, 'the results stayed up');
  assert.strictEqual(document.getElementById('search').value, '', 'the term was left behind');
  assert.ok(!document.body.classList.contains('searching'), 'the page is still in search mode');
});

test('the shop name and the section chips stand down while typing', async () => {
  /* They are for arriving, not for looking something up, and on a phone they
     are the difference between two results visible and eight. */
  const { window, document } = await render('/menu/AZ100', REPLY);
  await typeSearch(window, 'pan');
  assert.ok(document.body.classList.contains('searching'), 'the page never entered search mode');
});

test('a search result opens the same dish sheet a card does', async () => {
  const { window, document } = await render('/menu/AZ100', REPLY);
  await typeSearch(window, 'paneer');

  const row = document.querySelector('.result');
  row.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.match(document.getElementById('sheet-title').textContent, /Paneer Tikka/);
});

test('tapping outside the sheet closes it', async () => {
  /* Owner: "clicking on the outside area we can close the item deails page."
     A <dialog> fills the viewport, so the shade around the panel IS the
     dialog - a click landing on it and nothing inside means "away". */
  const { window, document } = await render('/menu/AZ100', REPLY);
  document.querySelector('.dish').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const sheet = document.getElementById('sheet');
  let closed = false;
  sheet.close = () => {
    closed = true;
  };
  sheet.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(closed, 'a tap on the shade around the sheet did not close it');
});

test('the sheet says when a dish is served and how long it takes', async () => {
  /* Somebody who has opened a dish is deciding, and these are what decide it. */
  const { window, document } = await render('/menu/AZ100', REPLY);
  document.querySelector('.dish').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const facts = document.getElementById('sheet-facts');
  assert.strictEqual(facts.hidden, false, 'the dish says nothing beyond its price');
  assert.match(facts.textContent, /Vegetarian/, 'the diet is not stated');
  assert.match(facts.textContent, /15 minutes/, 'how long the kitchen needs is not stated');
  assert.match(facts.textContent, /Available/, 'whether it can be had right now is not stated');
});

test('the microphone stays hidden where the browser has no recogniser', async () => {
  /* A button that does nothing is worse than no button. jsdom has no speech
     engine, which is exactly the case this must get right. */
  const { document } = await render('/menu/AZ100', REPLY);
  assert.strictEqual(
    document.getElementById('search-mic').hidden,
    true,
    'a microphone is offered that cannot listen'
  );
});

/* ------------------------------------------------------------ inch by inch
 *
 * The owner's brief for this pass: "consider ux improvement inch by inch
 * pixel by pixel". These pin the inches, so nobody puts them back.
 */

test('a symbol sits against the number; a code keeps its space', async () => {
  /* "₹280" is how every bill in the country writes it; "Rs 280" is how a
     word is written. The server sends the symbol, and the old page printed
     the whole stored label - "India Rupee / INR or ₹ 80" - beside a dish. */
  const rupee = { ...REPLY, store: { ...REPLY.store, currency: '₹' } };
  let { document } = await render('/menu/AZ100', rupee);
  assert.strictEqual(document.querySelector('.dish-price').textContent, '₹280');

  ({ document } = await render('/menu/AZ100', REPLY));
  assert.strictEqual(document.querySelector('.dish-price').textContent, 'Rs 280');
});

test('a shop that is taking orders offers the way in, from the same table', async () => {
  const open = { ...REPLY, channel: { state: 'open', accepting: true, mode: 'order', message: '' } };
  const { document } = await render('/menu/AZ100/table/5', open);
  const bar = document.getElementById('order-cta');
  assert.strictEqual(bar.hidden, false, 'a shop taking orders offered no way to order');
  assert.strictEqual(
    document.getElementById('order-link').getAttribute('href'),
    '/order/AZ100/table/5',
    'the customer would have to say which table they are at a second time'
  );
  assert.ok(document.body.classList.contains('can-order'), 'the page left no room for the bar');
});

test('a room keeps its room on the way in', async () => {
  const open = { ...REPLY, channel: { state: 'open', accepting: true, mode: 'order', message: '' } };
  const { document } = await render('/menu/AZ100/venue/RC/123', open);
  assert.strictEqual(
    document.getElementById('order-link').getAttribute('href'),
    '/order/AZ100/venue/RC/123'
  );
});

test('a menu-only shop, or a shut one, offers nothing to tap', async () => {
  for (const channel of [
    { state: 'menu_only', accepting: false, mode: 'menu', message: 'This menu is for viewing only.' },
    { state: 'closed', accepting: false, mode: 'order', message: 'Opens at 6' },
  ]) {
    const { document } = await render('/menu/AZ100', { ...REPLY, channel });
    assert.strictEqual(
      document.getElementById('order-cta').hidden,
      true,
      `${channel.state} still offered ordering`
    );
    assert.ok(!document.body.classList.contains('can-order'));
  }
});

test('a non-vegetarian dish says so in its facts', async () => {
  /* This read "nonveg" - a key nothing writes - so the one kind of dish where
     the answer matters most showed no Diet row at all. */
  const reply = JSON.parse(JSON.stringify(REPLY));
  reply.categories[0].items[0].diet = 'non_veg';
  const { window, document } = await render('/menu/AZ100', reply);
  document.querySelector('.dish').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(document.getElementById('sheet-facts').textContent, /Non-vegetarian/);
});

test('a shop that sells things rather than cooking them is not told it has dishes', async () => {
  const reply = JSON.parse(JSON.stringify(REPLY));
  reply.categories.forEach((c) =>
    c.items.forEach((i) => {
      i.diet = '';
      i.prep_minutes = 0;
      i.served_in = [];
    })
  );
  const { document } = await render('/menu/AZ100', reply);
  assert.strictEqual(document.getElementById('shop-sub').textContent, '2 items');

  const { document: kitchen } = await render('/menu/AZ100', REPLY);
  assert.strictEqual(kitchen.getElementById('shop-sub').textContent, '2 dishes');
});

test('the search row is a row, and its buttons are big enough for a thumb', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rule = (re) => {
    const m = html.match(re);
    return m ? m[1] : '';
  };
  /* The mic is a grid box; in a block it dropped onto a line of its own under
     the input on every browser that can listen. */
  assert.match(rule(/\.search-row\s*\{([^}]*)\}/), /display:\s*flex/);
  assert.match(rule(/\.search-back,\s*\.search-mic\s*\{([^}]*)\}/), /width:\s*40px/);
  /* The standalone rule, after a closing brace - not the shared position rule
     it also appears in. */
  assert.match(rule(/\}\s*\n\s*\.search-clear\s*\{([^}]*)\}/), /width:\s*40px/);
  assert.ok(!html.includes('var(--muted)'), 'a token that is never defined is used again');
  assert.match(html, /dialog\.sheet\s*\{[^}]*max-height/, 'a long sheet runs off the screen with no way to scroll');
  assert.match(html, /:focus-visible/, 'keyboard focus is invisible');
});

test('the mic gives way to the clear button once there is something to clear', async () => {
  const { window, document } = await render('/menu/AZ100', REPLY);
  const mic = document.getElementById('search-mic');
  mic.hidden = false;
  mic.setAttribute('data-supported', 'true');

  const box = document.getElementById('search');
  box.value = 'pan';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.strictEqual(mic.hidden, true, 'two buttons in one corner');
  assert.strictEqual(document.getElementById('search-clear').hidden, false);

  box.value = '';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.strictEqual(mic.hidden, false, 'the mic did not come back');
});
