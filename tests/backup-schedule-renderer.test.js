const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

test('backup schedule button invokes the actual preload bridge and shows the command', async () => {
  const bridges = {};
  const calls = [];
  vm.runInNewContext(fs.readFileSync('src/preload.js', 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (key, value) => { bridges[key] = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return { success: true, text: 'scheduled command' }; } } }),
    window: { addEventListener() {} }, process: { platform: 'win32' },
  });
  const html = fs.readFileSync('src/backup-manager.html', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const w = dom.window;
  w.electron = bridges.electron;
  w.electronAPI = bridges.electronAPI;
  const start = html.indexOf("        let _scheduleText = '';");
  const end = html.indexOf("        document.getElementById('btnCopySchedule')", start);
  w.eval('const api = window.electron;\n' + html.slice(start, end));
  w.document.getElementById('btnShowSchedule').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0][0], 'backup:schedule-instructions');
  assert.equal(w.document.getElementById('scheduleOutput').textContent, 'scheduled command');
  dom.window.close();
});
