const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('the installer never logs its credential-bearing form payload', () => {
  const wizard = source('src/install-wizard.html');

  assert.doesNotMatch(wizard, /console\.log\([^\n]*Full formData/);
  assert.match(wizard, /body:\s*JSON\.stringify\(formData\)/);
});

test('user API keys come from browser cryptographic randomness', () => {
  const users = source('frontend/static/script/js/modules/js/users.js');
  const generator = users.slice(
    users.indexOf('generateApiKey: function'),
    users.indexOf('clickNormalForm: function')
  );

  assert.match(generator, /crypto\.getRandomValues/);
  assert.doesNotMatch(generator, /Math\.random/);
});

test('URL parameters are accumulated without dynamic object writes', () => {
  const core = source('frontend/static/script/js/core/PosnicPro.js');
  const parser = core.slice(
    core.indexOf('getAllUrlParams: function'),
    core.indexOf('removeDuplicates: function')
  );

  assert.match(parser, /new Map\(\)/);
  assert.match(parser, /Object\.fromEntries\(params\)/);
  assert.doesNotMatch(parser, /obj\[[^\]]+\]\s*=/);
  assert.doesNotMatch(parser, /values\[[^\]]+\]\s*=/);
});

test('dynamic empty-state messages are inserted as text', () => {
  const core = source('frontend/static/script/js/core/PosnicPro.js');
  const renderer = core.slice(
    core.indexOf('PosnicPro.renderNoRecords ='),
    core.indexOf('PosnicPro.lazyPhoneInput =')
  );

  assert.match(renderer, /\.text\(message\)/);
  assert.doesNotMatch(renderer, /\.html\(message\)/);
});

test('customer and branch identity fields are rendered as text', () => {
  const customerView = source('frontend/static/script/js/modules/js/customer_view.js');

  assert.doesNotMatch(customerView, /\.(?:customer|branch)-(?:name|phone|email|address)"\)\.html\(/);
  assert.doesNotMatch(customerView, /innerHTML\s*\+=/);
});

test('plain report and settings values do not pass through html sinks', () => {
  const settings = source('frontend/static/script/js/modules/js/settings.js');
  const reports = [
    'report_customers.js', 'report_dailysales.js', 'report_gstrone.js',
    'report_kiosk.js', 'report_kot.js', 'report_payment.js',
    'report_pending.js', 'report_receivings.js', 'report_sales.js'
  ].map((file) => source('frontend/static/script/js/modules/js/' + file)).join('\n');

  assert.doesNotMatch(settings, /\.html\((?:response\.data\[['"](?:printing_address|store_telephone|store_email|branch_name)['"]\]|htmlHeaderView|htmlView)\)/);
  assert.doesNotMatch(reports, /append\(['"][^\n]*No (?:Records|Cancellations|Open Items|Discounts)[^\n]*\+/);
});

test('collections and media previews do not reinterpret strings as markup', () => {
  const core = source('frontend/static/script/js/core/PosnicPro.js');
  const items = source('frontend/static/script/js/modules/js/items.js');
  const receiving = source('frontend/static/script/js/modules/js/receiving_add.js');
  const deleteSelection = core.slice(
    core.indexOf('deleteTableSelectedRowData: function'),
    core.indexOf('deleteSelectedRow: function')
  );
  assert.doesNotMatch(deleteSelection, /\$\(e\)\.each/);
  assert.ok((items.match(/Array\.from\(variant_value \|\| \[\]\)\.forEach/g) || []).length >= 2);
  assert.match(items, /\.modal-title'\)\.text\('Add ' \+ fam\.axis\)/);
  assert.doesNotMatch(receiving, /onclick="PosnicPro\.receivings\.image_edit_remove_selected/);
  assert.match(receiving, /new URL\(image_path, window\.location\.href\)/);
  assert.match(receiving, /\$wrapper\.append\(/);
});

test('desktop logs redact credential fields and neutralize injected lines', () => {
  const main = source('src/main.js');
  const redaction = main.slice(
    main.indexOf('function redactSecrets'),
    main.indexOf('function ensureDailyLog')
  );

  assert.match(redaction, /register_userpassword\|db_password\|dbPassword\|password/);
  assert.match(redaction, /access_token\|refresh_token\|api\[_-\]\?key/);
  assert.match(redaction, /\.replace\(\/\\r\/g, '\\\\r'\)/);
  assert.match(redaction, /\.replace\(\/\\n\/g, '\\\\n'\)/);
});

test('desktop log and connector files stay on one descriptor while in use', () => {
  const main = source('src/main.js');
  const logRead = main.slice(
    main.indexOf("ipcMain.handle('logs:read'"),
    main.indexOf("ipcMain.handle('logs:open-folder'")
  );
  const tail = main.slice(main.indexOf('function tailLog'), main.indexOf('function diagnosticsMarkdown'));
  const disconnect = main.slice(
    main.indexOf("ipcMain.handle('connectors:disable'"),
    main.indexOf("ipcMain.handle('cloud:disconnect'")
  );

  assert.match(logRead, /fstatSync\(fd\)/);
  assert.doesNotMatch(logRead, /statSync\(LOG_FILE\)|readFileSync\(LOG_FILE/);
  assert.match(tail, /fstatSync\(fd\)/);
  assert.doesNotMatch(tail, /statSync\(LOG_FILE\)/);
  assert.match(disconnect, /openSync\(file, 'r\+'\)/);
  assert.match(disconnect, /ftruncateSync\(fd, 0\)/);
});
