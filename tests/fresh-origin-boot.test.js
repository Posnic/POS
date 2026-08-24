/*
 * A brand-new browser must be able to boot the dashboard.
 *
 * Owner: "what you u have done? now page completely broken. after login." -
 * a pure white page, every request 200, console clean of everything except:
 *
 *   jQuery.Deferred exception: Cannot read properties of undefined
 *   (reading 'format')  at Object.commonDate
 *
 * localStorage carries no 'timezone' until the first settings read lands, so
 * on a FRESH ORIGIN - every new shop's first visitor - local.get returned
 * null, moment().tz(null) hit moment-timezone's GETTER form and returned
 * undefined, and .format() threw inside the ready handlers that reveal the
 * page. It never reproduced on a browser that had ever loaded the shop
 * before, which is why it survived until the owner opened a brand-new shop:
 * the people it hits are EXACTLY the people nobody retests as.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const core = strip(fs.readFileSync(
  path.join(ROOT, 'frontend/static/script/js/core/PosnicPro.js'), 'utf8'));

test('the timezone accessor can never return null', () => {
  const at = core.indexOf('timeZone: function ()');
  assert.ok(at > -1, 'the safe accessor is gone');
  const fn = core.slice(at, core.indexOf('commonDate: function', at));
  assert.match(fn, /t !== 'null' && t !== 'undefined'/);
  // the browser's own zone, not a fixed country's
  assert.match(fn, /moment\.tz\.guess\(\)/);
  // and a last-resort literal if even guess() is unavailable
  assert.match(fn, /catch \(e\) \{ return '[^']+'; \}/);
});

test('no direct timezone read feeds moment anywhere', () => {
  /*
   * The sweep. 24 read sites existed across 15 files; any ONE of them
   * reachable at boot whites the page for a fresh origin. Only the accessor
   * itself may read the raw key.
   */
  const dir = path.join(ROOT, 'frontend/static/script/js');
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js') || e.name.includes('.min.')) continue;
      const src = strip(fs.readFileSync(p, 'utf8'));
      const hits = (src.match(/PosnicPro\.local\.get\('timezone'\)/g) || []).length;
      const isCore = p.endsWith('PosnicPro.js');
      // the core file holds exactly ONE read: inside the accessor
      if (hits > (isCore ? 1 : 0)) offenders.push(`${e.name}: ${hits}`);
    }
  };
  walk(dir);
  assert.deepStrictEqual(offenders, [],
    'raw timezone reads outside the accessor: ' + offenders.join(', '));
});

test('commonDate itself goes through the accessor', () => {
  const at = core.indexOf('commonDate: function ()');
  const fn = core.slice(at, at + 400);
  assert.match(fn, /PosnicPro\.timeZone\(\)/);
});
