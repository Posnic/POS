'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dir = path.join(__dirname, '../api/src/kitchen-board');
function setup(
  demo = true,
  fetch = () => {
    throw Error('Demo must never fetch');
  },
) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), {
    url: 'http://localhost/kitchen/' + (demo ? '?demo=1' : ''),
    runScripts: 'outside-only',
  });
  dom.window.fetch = fetch;
  dom.window.setInterval = () => 0;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.eval(fs.readFileSync(path.join(dir, 'board.js'), 'utf8'));
  return dom;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('chef marks part of a dish ready, can undo it, and can ready the remaining round', async () => {
  const dom = setup();
  try {
    const d = dom.window.document;
    d.querySelector('#new button').click();
    await tick();
    let card = d.querySelector('[data-id="demo-1:c0"]');
    card.querySelector('.quantity-input').value = '1';
    card.querySelector('.item-ready').click();
    await tick();
    card = d.querySelector('[data-id="demo-1:c0"]');
    assert.match(card.textContent, /1 ready to collect/);
    assert.ok(d.querySelector('#preparing [data-id="demo-1:c0"]'));
    d.getElementById('undo').click();
    await tick();
    card = d.querySelector('[data-id="demo-1:c0"]');
    assert.match(card.textContent, /0 ready to collect/);
    card.querySelector('.advance').click();
    await tick();
    assert.ok(d.querySelector('#ready [data-id="demo-1:c0"]'));
  } finally {
    dom.window.close();
  }
});
const liveTicket = {
  id: 'sale:c0',
  saleId: 'sale',
  roundId: 'c0',
  table: '6',
  state: 'new',
  revision: 0,
  items: [{ qty: 1, name: 'Rice' }],
};
const response = (tickets) => ({ ok: true, json: async () => ({ branch: 'Test', tickets }) });
test('an old read cannot undo a confirmed action; duplicate clicks submit once', async () => {
  let calls = 0,
    posts = 0,
    finishRead,
    finishPost;
  const dom = setup(false, async (_url, options) => {
    if (options.method === 'POST') {
      posts++;
      return new Promise((resolve) => {
        finishPost = () =>
          resolve({
            ok: true,
            json: async () => ({ ticket: { ...liveTicket, state: 'preparing', revision: 1 } }),
          });
      });
    }
    calls++;
    if (calls === 1) return response([liveTicket]);
    return new Promise((resolve) => {
      finishRead = () => resolve(response([liveTicket]));
    });
  });
  try {
    await tick();
    const d = dom.window.document;
    d.getElementById('refresh').click();
    await tick();
    const button = d.querySelector('#new button');
    button.click();
    button.click();
    await tick();
    assert.equal(posts, 1);
    finishPost();
    await tick();
    finishRead();
    await tick();
    assert.equal(d.querySelectorAll('#preparing .ticket').length, 1);
    assert.equal(d.querySelectorAll('#new .ticket').length, 0);
  } finally {
    dom.window.close();
  }
});
test('lost pointer capture cancels rather than saving a stale gesture', async () => {
  const dom = setup();
  try {
    const w = dom.window,
      d = w.document,
      card = d.querySelector('#new .ticket');
    pointer(w, card, 'pointerdown', 10, 100);
    pointer(w, card, 'lostpointercapture', 10, 100);
    pointer(w, card, 'pointerup', 220, 100);
    await tick();
    assert.equal(d.querySelectorAll('#new .ticket').length, 2);
    d.querySelector('#new button').click();
    await tick();
    assert.equal(d.querySelectorAll('#new .ticket').length, 1);
  } finally {
    dom.window.close();
  }
});
test('demo buttons and Undo operate locally; stages keep order details', async () => {
  const dom = setup();
  try {
    const d = dom.window.document;
    assert.equal(d.querySelectorAll('.ticket').length, 4);
    assert.match(d.querySelector('#new').textContent, /Chicken biryani/);
    d.querySelector('#new button').click();
    await tick();
    assert.equal(d.querySelectorAll('#preparing .ticket').length, 2);
    d.getElementById('undo').click();
    await tick();
    assert.equal(d.querySelectorAll('#new .ticket').length, 2);
    assert.match(d.getElementById('connection').textContent, /DEMO/);
  } finally {
    dom.window.close();
  }
});
function pointer(w, card, type, x, y) {
  const e = new w.Event(type, { bubbles: true });
  Object.assign(e, { isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y });
  card.dispatchEvent(e);
}
test('vertical scrolling cancels a gesture; deliberate horizontal swipe advances once', async () => {
  const dom = setup();
  try {
    const w = dom.window,
      d = w.document;
    let card = d.querySelector('#new .ticket');
    card.getBoundingClientRect = () => ({ width: 400, top: 0, bottom: 400 });
    pointer(w, card, 'pointerdown', 10, 10);
    pointer(w, card, 'pointermove', 20, 150);
    pointer(w, card, 'pointerup', 220, 150);
    await tick();
    assert.equal(d.querySelectorAll('#new .ticket').length, 2);
    card = d.querySelector('#new .ticket');
    card.getBoundingClientRect = () => ({ width: 400, top: 0, bottom: 400 });
    pointer(w, card, 'pointerdown', 10, 100);
    pointer(w, card, 'pointermove', 180, 105);
    pointer(w, card, 'pointerup', 200, 105);
    pointer(w, card, 'pointerup', 200, 105);
    await tick();
    assert.equal(d.querySelectorAll('#new .ticket').length, 1);
  } finally {
    dom.window.close();
  }
});
test('live data is escaped, no table fallback leaks sale IDs, offline actions are disabled', async () => {
  const dom = setup(false, async () => ({
    ok: true,
    json: async () => ({
      branch: 'Test',
      tickets: [
        {
          id: 'secret-sale:c0',
          table: '',
          state: 'new',
          revision: 0,
          items: [{ qty: 1, name: '<img src=x onerror=alert(1)>', note: '<script>bad()</script>' }],
        },
      ],
    }),
  }));
  try {
    await tick();
    const d = dom.window.document;
    assert.equal(d.querySelectorAll('.ticket img,.ticket script').length, 0);
    assert.equal(d.querySelector('.table').textContent, '');
    assert.ok(!d.querySelector('.ticket').textContent.includes('secret-sale'));
    dom.window.dispatchEvent(new dom.window.Event('offline'));
    assert.equal(d.querySelector('.advance').disabled, true);
    assert.match(d.getElementById('connection').textContent, /Disconnected/);
  } finally {
    dom.window.close();
  }
});

test('device setup reports wake-lock support and releases it when staff switches it off', async () => {
  const dom = setup();
  let released = false;
  Object.defineProperty(dom.window.navigator, 'wakeLock', {
    value: {
      request: async () => ({
        addEventListener() {},
        release: async () => {
          released = true;
        },
      }),
    },
  });
  Object.defineProperty(dom.window.document, 'hidden', { value: false });
  dom.window.eval(fs.readFileSync(path.join(dir, 'device.js'), 'utf8'));
  const d = dom.window.document;
  d.getElementById('setup-toggle').click();
  assert.equal(d.getElementById('device-setup').hidden, false);
  d.getElementById('keep-awake').click();
  await tick();
  assert.match(d.getElementById('awake-status').textContent, /stays awake/);
  d.getElementById('keep-awake').click();
  await tick();
  assert.equal(released, true);
  dom.window.close();
});
