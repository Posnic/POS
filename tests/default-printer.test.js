'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { defaultPrinterName } = require('../src/windows-spooler');
const source = fs.readFileSync(require.resolve('../src/hardware-manager'), 'utf8');
const start = source.indexOf('  async getDefaultPrinter()');
const end = source.indexOf('\n  // ', start);
function resolveDefault(platform, lookup) {
  return vm.runInNewContext('({' + source.slice(start, end) + '}).getDefaultPrinter', {
    process: { platform }, spooler: { defaultPrinterName: lookup }, console,
  });
}
test('Windows default is used when Electron omits its default flag and lists an offline printer first', async () => {
  const printers = [{ name: 'Offline Xprinter' }, { name: 'Reception' }];
  assert.equal((await resolveDefault('win32', async () => 'Reception').call({ listPrinters: async () => printers })).name, 'Reception');
});
test('missing or unreadable Windows default never sends a receipt to the first enumerated printer', async () => {
  for (const lookup of [async () => null, async () => { throw Error('Unavailable'); }]) {
    assert.equal(await resolveDefault('win32', lookup).call({ listPrinters: async () => [{ name: 'Kitchen' }] }), null);
  }
});
test('non-Windows defaults remain explicit and never depend on enumeration order', async () => {
  for (const platform of ['darwin', 'linux']) {
    const method = resolveDefault(platform, () => { throw Error('Windows must not be queried'); });
    assert.equal((await method.call({ listPrinters: async () => [{ name: 'Other' }, { name: 'Counter', isDefault: true }] })).name, 'Counter');
    assert.equal(await method.call({ listPrinters: async () => [{ name: 'Other' }] }), null);
  }
});
test('Windows default query is bounded, hidden, Unicode-safe and handles no default', async () => {
  for (const [output, expected] of [['"Réception தமிழ்"', 'Réception தமிழ்'], ['', null], ['[]', null], ['["One","Two"]', null]]) {
    assert.equal(await defaultPrinterName((file, args, options, done) => {
      assert.equal(file, 'powershell.exe'); assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 5000);
      assert.match(Buffer.from(args.at(-1), 'base64').toString('utf16le'), /Win32_Printer/);
      done(null, output);
    }), expected);
  }
});
