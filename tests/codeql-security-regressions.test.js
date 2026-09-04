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
});
