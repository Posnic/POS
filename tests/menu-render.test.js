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
