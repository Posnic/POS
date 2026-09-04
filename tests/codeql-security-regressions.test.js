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
});
