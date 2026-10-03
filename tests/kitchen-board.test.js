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
    assert.equal(card.querySelector('.name .progress-ready').getAttribute('aria-label'), '1 Ready to collect');
    assert.equal(card.querySelector('li > .item-progress'), null);
    assert.ok(d.querySelector('#preparing [data-id="demo-1:c0"]'));
    d.getElementById('undo').click();
    await tick();
    card = d.querySelector('[data-id="demo-1:c0"]');
    assert.equal(card.querySelector('.progress-ready'), null);
    assert.equal(card.querySelector('.name .progress-cooking').getAttribute('aria-label'), '2 Cooking');
    card.querySelector('.advance').click();
    await tick();
    assert.equal(d.querySelector('[data-id="demo-1:c0"]'), null);
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

test('paid takeaway shows full numbered bag heading and only quantities still cooking', async () => {
  const dom = setup(false, async () => response([{
    id:'paid:c0',saleId:'paid',roundId:'c0',table:'',takeaway:true,orderNumber:'104',
    state:'preparing',revision:1,items:[
      {id:'a',name:'Fish',qty:3,total:3,ready:2,served:0},
      {id:'b',name:'Rice',qty:1,total:1,ready:1,served:0},
    ],
  }]));
  try {
    await tick();
    const d=dom.window.document;
    assert.equal(d.querySelector('.table').textContent,'Take Away 104');
    assert.ok(d.querySelector('.table svg'));
    assert.equal(d.querySelectorAll('.items li').length,1);
    assert.equal(d.querySelector('.quantity').textContent,'1×');
    assert.equal(d.querySelector('#ready').closest('section').hidden,true);
  } finally {dom.window.close();}
});
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
    assert.equal(d.querySelectorAll('.ticket').length, 3);
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

test('touch board fetches recordings only on request and closing cancels a late playback', async () => {
 let reads=0,resolveAudio,plays=0,pauses=0;
 const dom=setup(false,async(url)=>{
  if(url.includes('/voice/')){reads++;return new Promise(resolve=>{resolveAudio=()=>resolve({ok:true,json:async()=>({data:'data:audio/webm;base64,YQ=='})});});}
  return response([{...liveTicket,voiceNotes:[{id:'recording-1',created:new Date().toISOString()}]}]);
 });
 try {
  dom.window.HTMLMediaElement.prototype.pause=function(){pauses++;};
  dom.window.HTMLMediaElement.prototype.play=async function(){plays++;};
  await tick();const d=dom.window.document;assert.equal(reads,0);
  d.querySelector('.order-voice-play').click();await tick();assert.equal(reads,1);
  assert.ok(d.querySelector('.order-voice-dialog'));d.querySelector('.order-voice-dialog button').click();
  resolveAudio();await tick();assert.equal(plays,0);assert.ok(pauses);assert.equal(d.querySelector('.order-voice-dialog'),null);
  d.querySelector('.order-voice-play').click();await tick();resolveAudio();await tick();assert.equal(plays,1);
  assert.equal(d.querySelector('.order-voice-dialog audio').getAttribute('controls'),'');
 }finally{dom.window.close();}
});


test('compact badges distinguish ready, collected and served quantities', async () => {
  const ticket = {...liveTicket, state:'preparing', items:[{id:'rice',name:'Rice',qty:3,total:4,ready:3,collected:2,served:1}]};
  const dom=setup(false,async()=>response([ticket]));
  try {
    await tick();
    const d=dom.window.document, name=d.querySelector('.items .name');
    assert.equal(name.querySelector('.progress-cooking').getAttribute('aria-label'),'1 Cooking');
    assert.equal(name.querySelector('.progress-ready').getAttribute('aria-label'),'1 Ready to collect');
    assert.equal(name.querySelector('.progress-picked').getAttribute('aria-label'),'1 Collected, not yet served');
    assert.equal(name.querySelector('.progress-served').getAttribute('aria-label'),'1 Served');
    assert.equal(name.querySelectorAll('button').length,0,'Status badges are not accidental touch actions');
  } finally {dom.window.close();}
});
