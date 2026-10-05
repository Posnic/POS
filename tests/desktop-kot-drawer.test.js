const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/modules/js/kot-workspace.js', 'utf8');
test('KOT layout does not open the legacy table drawer on unrelated pages', () => {
  const dom = new JSDOM('<style>.infobar-settings-sidebar{width:0;overflow:hidden}.infobar-settings-sidebar.sidebarview{width:97%}</style><div id="infobar-settings-sidebar-table-selection" class="infobar-settings-sidebar"></div>', {runScripts:'outside-only'});
  const w=dom.window;w.PosnicPro={};w.$=require('jquery')(w);w.eval(source);
  const drawer=w.document.getElementById('infobar-settings-sidebar-table-selection');
  assert.equal(w.getComputedStyle(drawer).width,'0px');
  assert.equal(drawer.classList.contains('sidebarview'),false);
  const styles=[...w.document.querySelectorAll('style')].map(s=>s.textContent).join('');
  assert.match(styles, /#infobar-settings-sidebar-table-selection\.sidebarview,#infobar-settings-sidebar-table-selection\.sidebarshow\{width:min/);
  dom.window.close();
});
