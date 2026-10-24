const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const core = read('frontend/static/script/js/core/PosnicPro.js');
const sales = read('frontend/static/script/js/modules/js/sales.js');
function fixture(brand, saved) {
  const dom = new JSDOM('<div id="newsalespage"><div class="sale-done-card"><button class="sale-done-primary">New sale</button></div></div>', { runScripts: 'outside-only', url: 'https://test.invalid' });
  const w = dom.window;
  w.eval(read('frontend/static/script/js/jquery.min.js'));
  w.$.expr.pseudos.visible = node => node.style.display !== 'none';
  w.POSNIC_BRAND_NAME = brand;
  w.currentHash = 'sales/new';
  w.PosnicPro = { local: { get: () => JSON.stringify(saved || {}) }, sales: {} };
  const a = core.indexOf('saleRedirectSeconds: function');
  const b = core.indexOf('}, 800);', a);
  Object.assign(w.PosnicPro, w.eval('({' + core.slice(a, b) + '}, 800); }})'));
  const t = sales.indexOf('PosnicPro.sales.saleDoneTimer = {');
  w.eval(sales.slice(t, sales.indexOf('\n};', t) + 3));
  const timers = new Map(); let seq = 0, clicked = 0;
  w.setTimeout = (fn, delay) => { timers.set(++seq, { fn, delay }); return seq; };
  w.clearTimeout = id => timers.delete(id);
  w.$('.sale-done-primary').on('click', () => { clicked++; w.$('#newsalespage').hide(); });
  return { dom, w, timers, clicks: () => clicked, fire: () => { const entries = [...timers.values()]; timers.clear(); entries.forEach(x => x.fn()); } };
}
for (const [brand, saved, delay] of [['GSHCL', {}, 0], ['Posnic', {}, 6000], ['GSHCL', { sale_redirect_seconds: 12 }, 12000], ['Posnic', { sale_redirect_seconds: '0' }, 0]]) {
  test('completion uses configured delay: ' + brand + JSON.stringify(saved), () => {
    const f = fixture(brand, saved);
    f.w.PosnicPro.sales.saleDoneTimer.start();
    assert.equal([...f.timers.values()][0].delay, delay);
    f.fire(); assert.equal(f.clicks(), 1); f.dom.window.close();
  });
}
test('print completion restarts configured countdown, late prints leave the next cart alone', () => {
  const f = fixture('GSHCL', { sale_redirect_seconds: 3 });
  f.w.PosnicPro.sales.saleDoneTimer.start(); f.w.PosnicPro.afterPrint();
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].delay, 3000);
  f.fire(); f.w.PosnicPro.afterPrint();
  assert.equal(f.timers.size, 0); assert.equal(f.clicks(), 1); f.dom.window.close();
});
test('a paused countdown and navigation cannot close another sale', () => {
  const f = fixture('GSHCL', { sale_redirect_seconds: 10 });
  f.w.PosnicPro.sales.saleDoneTimer.start(); f.w.PosnicPro.sales.saleDoneTimer.hold();
  assert.equal(f.timers.size, 0);
  f.w.PosnicPro.sales.saleDoneTimer.start(); f.w.$('#newsalespage').hide(); f.fire();
  assert.equal(f.clicks(), 0); f.dom.window.close();
});
for (const hash of ['kot/6', 'sales/0123456789abcdef01234567']) test('printing stays in ' + hash, () => {
  const f = fixture('GSHCL'); f.w.currentHash = hash;
  f.w.hasher = { setHash: () => assert.fail('unexpected navigation') };
  f.w.PosnicPro.afterPrint(); f.fire(); assert.equal(f.clicks(), 0); f.dom.window.close();
});
test('immediate GSHCL completion works with reduced motion, invalid settings use the default', () => {
  const f = fixture('GSHCL', { sale_redirect_seconds: -1 });
  f.w.matchMedia = () => ({ matches: true });
  f.w.PosnicPro.sales.saleDoneTimer.start(); f.fire(); assert.equal(f.clicks(), 1); f.dom.window.close();
});
