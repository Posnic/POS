const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('backup theme preserves navigation labels and renders offline vector icons', () => {
  const dom = new JSDOM(fs.readFileSync('src/backup-manager.html', 'utf8'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync('src/window-theme.js', 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const tabs = [...w.document.querySelectorAll('.tabs .tab')];
  assert.deepEqual(tabs.map(tab => tab.textContent.trim()), ['Overview', 'Backups', 'Settings', 'History']);
  for (const tab of tabs) assert.equal(tab.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(w.document.querySelectorAll('.stat-card .icon svg').length, 4);
  dom.window.close();
});
