'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
const InstallService = apiRequire('./src/services/install.service');
const { passwordMatches } = apiRequire('./src/utils/password-match');

// Exercise production hashing and verification together; only persistence is
// replaced. This is not a substitute for the packaged desktop acceptance run.
for (const password of ['Fresh194!Test', 'Fresh194!LongPasswordForOwner', ' Fresh194!Test ', 'A'.repeat(71) + '!']) {
  test(`fresh owner password round trip (${password.length} characters)`, async () => {
    let stored;
    const service = Object.create(InstallService.prototype);
    service.repository = { insertUser: async user => { stored = user; return 'test-owner'; } };
    await service._createUser({
      register_username: 'owner@example.invalid',
      register_useremail: 'owner@example.invalid',
      register_userpassword: password,
    }, 'test-license', 'test-secret', new Date(), new Date());
    assert.equal(await passwordMatches(password, stored.password), true,
      'the exact password accepted at setup must authenticate');
    assert.equal(await passwordMatches('Wrong194!Test', stored.password), false);

    const html = fs.readFileSync(path.join(__dirname, '../frontend/login.html'), 'utf8');
    const input = html.match(/<input\b[^>]*id="password"[^>]*>/)[0];
    const max = input.match(/maxlength="(\d+)"/);
    assert.ok(!max || Number(max[1]) >= password.length,
      'login input truncates a password accepted at setup');
    const start = html.indexOf('$("#login_form").validate(');
    const end = html.indexOf('\n        });', start) + '\n        });'.length;
    let rules;
    vm.runInNewContext(html.slice(start, end), {
      $: () => ({ validate: options => { rules = options.rules; } }),
    });
    assert.ok(!rules.password.maxlength || rules.password.maxlength >= password.length,
      'login validation rejects a password accepted at setup');
  });
}

test('setup rejects passwords bcrypt would silently truncate, including multi-byte characters', async () => {
  const { validateInstallation } = apiRequire('./src/middleware/install.validation');
  const { validationResult } = apiRequire('express-validator');
  for (const [password, accepted] of [
    ['A'.repeat(72), true], ['A'.repeat(73), false],
    ['é'.repeat(36), true], ['é'.repeat(37), false],
    [' Fresh194!Test ', true],
  ]) {
    const req = { body: { register_userpassword: password } };
    for (const chain of validateInstallation) await chain.run(req);
    const errors = validationResult(req).array().filter(error => error.path === 'register_userpassword');
    assert.equal(errors.length === 0, accepted);
    assert.equal(req.body.register_userpassword, password, 'validation must preserve the password');
  }
});
