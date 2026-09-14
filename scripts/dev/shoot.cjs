#!/usr/bin/env node
'use strict';
/*
 * The ordering journey, photographed, on a phone-shaped screen.
 *
 * Owner: "first study the flow and take screenshot of how you done. i am not
 * satisfied with use jouerny form start to end of order."
 *
 * Every judgement about this bundle so far has been made by reading code and
 * asking him what he saw. That is the wrong way round for a question about a
 * JOURNEY: the thing being judged is what a person meets, in order, on a
 * phone, and none of that is legible in a diff.
 *
 * HEADLESS CHROME OVER THE DEVTOOLS PROTOCOL, with nothing installed. Node
 * has had a WebSocket of its own since 22, and Chrome is already on this
 * machine, so this needs no browser download and no dependency - which is the
 * difference between a tool that runs today and one that waits on a 300MB
 * fetch through a corporate network.
 *
 *   node scripts/dev/shoot.cjs                     the sandbox, every step
 *   node scripts/dev/shoot.cjs --at https://...    somewhere else
 *   node scripts/dev/shoot.cjs --out docs/journey  where the frames go
 *
 * IT DRIVES THE PAGE, IT DOES NOT POSE IT. Every frame is reached by tapping
 * what a customer taps, so a step that is broken photographs as broken rather
 * than being quietly skipped. A tap that finds nothing says MISS and the run
 * carries on, because a missing control is itself the finding.
 *
 * This is a development tool. It drives a real browser against a real shop.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};

const AT = String(flag('at', 'https://develop.posnic.io')).replace(/\/+$/, '');
const SHOP = flag('shop', 'ABC');
const OUT = path.resolve(flag('out', path.join('docs', 'journey')));
const PORT = Number(flag('port', 9333));

/* A phone, not a desktop window squeezed. iPhone 14 metrics: this is the
   screen the bundle is actually used on. */
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

const CHROME = [
  flag('chrome', ''),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));

if (!CHROME) {
  console.error('No Chrome or Edge found. Pass --chrome <path>.');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function browser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-shoot-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      /* The page asks for a microphone. Granted silently, or every voice
         frame is a permission prompt nobody can click. */
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await wait(250);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) {
      /* not up yet */
    }
  }
  if (!target) throw new Error('Chrome never answered on port ' + PORT);
  return { child, target };
}

function talk(url) {
  const socket = new WebSocket(url);
  let next = 1;
  const waiting = new Map();
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('CDP socket refused')));
  });
  socket.addEventListener('message', (event) => {
    let msg = null;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    const pending = waiting.get(msg.id);
    if (!pending) return;
    waiting.delete(msg.id);
    if (msg.error) pending.no(new Error(msg.error.message));
    else pending.ok(msg.result);
  });
  return {
    ready,
    send(method, params) {
      const id = next++;
      socket.send(JSON.stringify({ id, method, params: params || {} }));
      return new Promise((ok, no) => {
        waiting.set(id, { ok, no });
        setTimeout(() => {
          if (waiting.has(id)) {
            waiting.delete(id);
            no(new Error(method + ' timed out'));
          }
        }, 30000);
      });
    },
    close() {
      try {
        socket.close();
      } catch (e) {
        /* already gone */
      }
    },
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { child, target } = await browser();
  const cdp = talk(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', PHONE);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await cdp.send('Browser.grantPermissions', { origin: AT, permissions: ['audioCapture'] });
  } catch (e) {
    /* the fake-ui flag covers it */
  }

  const shots = [];
  const notes = [];

  const run = async (js) => {
    const out = await cdp.send('Runtime.evaluate', {
      expression: '(function(){' + js + '})()',
      awaitPromise: true,
      returnByValue: true,
    });
    if (out.exceptionDetails) {
      const why = out.exceptionDetails.exception && out.exceptionDetails.exception.description;
      notes.push('SCRIPT FAILED: ' + String(why || '').split('\n')[0]);
      return null;
    }
    return out.result && out.result.value;
  };

  /*
   * THE SANDBOX'S OWN WARNING IS NOT THE PRODUCT.
   *
   * develop injects a fixed red panel over the page - it is not in the
   * bundle and never reaches a real shop - and because it is fixed and on
   * top, it swallows every tap aimed at the card underneath. Clicking its
   * "Got it" was not enough: a navigation brings it back before the next
   * tap lands. So it is REMOVED, on every page, and so is the assistant's
   * first-run callout, which is real but is a first-run state rather than
   * the screen being judged. Both are photographed on frame 02, before
   * anything is cleared, because how a screen arrives is part of the
   * journey.
   */
  const clearTheDecks = async () =>
    run(
      'var went = [];' +
        'try { sessionStorage.setItem("pz-sb", "1"); } catch (e) {}' +
        '["pz-sb", "pz-sb-msg"].forEach(function (id) {' +
        '  var e = document.getElementById(id);' +
        '  if (e && e.parentNode) { e.parentNode.removeChild(e); went.push(id); }' +
        '});' +
        'var h = document.getElementById("assistant-hint-close");' +
        'if (h) { h.click(); went.push("assistant callout"); }' +
        'var hint = document.getElementById("assistant-hint");' +
        'if (hint) hint.hidden = true;' +
        'return went.join(", ");'
    );

  const go = async (url, settle) => {
    await cdp.send('Page.navigate', { url });
    await wait(settle || 3200);
    /* Every page, because the panel is injected into every page. */
    await clearTheDecks();
    await wait(250);
  };

  const shoot = async (name, note) => {
    const out = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(out.data, 'base64'));
    shots.push({ name, note });
    console.log('  shot  ' + name + '  ' + (note || ''));
  };

  const tap = async (selector, label) => {
    const where = await run(
      'var el = document.querySelector(' + JSON.stringify(selector) + ');' +
        'if (!el) return null;' +
        'el.scrollIntoView({ block: "center" });' +
        'var r = el.getBoundingClientRect();' +
        'if (r.width === 0 || r.height === 0) return null;' +
        'return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };'
    );
    if (!where) {
      const miss = 'MISS: ' + (label || selector) + ' was not on the page';
      notes.push(miss);
      console.log('  ' + miss);
      return false;
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: where.x,
        y: where.y,
        button: 'left',
        clickCount: 1,
        pointerType: 'touch',
      });
    }
    await wait(1100);
    return true;
  };

  /* The list scrolls inside MAIN.scrollable-products, not the window, so a
     window scroll moves nothing. That is worth knowing on its own. */
  const scrollList = async (by) =>
    run(
      'var box = document.querySelector(".scrollable-products") || document.scrollingElement;' +
        'box.scrollTop = ' + by + ';' +
        'return box.className + " -> " + box.scrollTop + "/" + box.scrollHeight;'
    );

  try {
    console.log('\nTHE JOURNEY, on a ' + PHONE.width + 'x' + PHONE.height + ' phone\n');

    /* ---------------------------------------- 1. the sticker on the table */
    await cdp.send('Page.navigate', { url: AT + '/order/' + SHOP + '/table/34' });
    await wait(1400);
    await shoot('01-arrival', 'the moment the code is scanned');
    await wait(3400);
    /* UNCLEARED ON PURPOSE: how the screen arrives, overlays and all, is
       part of what is being judged. */
    await shoot('02-menu-as-it-lands', 'what a customer meets first, untouched');

    const cleared = await clearTheDecks();
    if (cleared) console.log('  (removed: ' + cleared + ')');
    await wait(500);
    await shoot('03-menu-clean', 'the same screen with the overlays gone');

    console.log('  list: ' + (await scrollList(600)));
    await wait(600);
    await shoot('04-menu-scrolled', 'a screen further down');

    /* ---------------------------------------- 2. a dish */
    await tap('.product-card', 'a product card');
    await shoot('05-dish', 'one item, opened');

    /* ---------------------------------------- 3. adding */
    await run('var d = document.getElementById("dish"); if (d && d.open) d.close(); return true;');
    await scrollList(0);
    await wait(400);
    await tap('.btn-increase', 'the Add button on a card');
    await shoot('06-added-one', 'after adding one, and the bar that appears');
    await tap('.btn-increase', 'Add again');
    await wait(500);
    await shoot('07-added-more', 'the stepper a card turns into');
    console.log('  basket now holds: ' + (await run(
      'var c = await getCartData(); return c.map(function (l) { return l.quantity + " x " + l.name; }).join(", ") || "nothing";'
    )));

    /* ---------------------------------------- 4. the basket */
    const wentToCart = await tap('.cart-footer a, .cart-footer button, .cart-footer-inner', 'the basket bar');
    if (!wentToCart) await go(AT + '/order/' + SHOP + '/cart.html', 2600);
    await wait(1400);
    await shoot('08-basket', 'the basket');

    /* ---------------------------------------- 5. paying */
    await run(
      'var b = [...document.querySelectorAll("a,button")].find(function (e) {' +
        ' return /checkout|place|pay|continue|next/i.test(e.textContent || ""); });' +
        'if (b) b.click(); return b ? b.textContent.trim() : null;'
    );
    await wait(2800);
    await shoot('09-payment', 'the last screen before the order goes');

    /* ---------------------------------------- 6. the assistant */
    await go(AT + '/order/' + SHOP + '/table/34', 3600);
    await clearTheDecks();
    await tap('#ask-ai', 'the assistant spark');
    await shoot('10-assistant-choice', 'the assistant: talk or type');
    await tap('#assistant-choose-type', 'Type instead');
    await shoot('11-assistant-typing', 'the typing side');

    /* ---------------------------------------- 7. arriving to talk */
    await go(AT + '/order/' + SHOP + '/table/34?ai=talk', 4200);
    await shoot('12-talk-code', 'arriving on a code that says talk');
    await tap('#voice-start', 'Tap to talk');
    await wait(2600);
    await shoot('13-on-the-line', 'the line open, waiting to be held');

    /* ---------------------------------------- 8. the history */
    await go(AT + '/order/' + SHOP + '/history.html', 3000);
    await shoot('14-history', 'what this phone has ordered');

    fs.writeFileSync(
      path.join(OUT, 'shots.json'),
      JSON.stringify({ at: AT, shop: SHOP, phone: PHONE, taken: new Date().toISOString(), shots, notes }, null, 2) + '\n'
    );
    console.log('\n' + shots.length + ' frames in ' + OUT);
    if (notes.length) {
      console.log('\nwhat the run noticed:');
      notes.forEach((n) => console.log('  - ' + n));
    }
    console.log('');
  } finally {
    cdp.close();
    child.kill();
  }
})().catch((e) => {
  console.error('shoot failed:', e.message);
  process.exit(1);
});
