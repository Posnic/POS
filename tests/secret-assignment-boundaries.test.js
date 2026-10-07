'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RULES } = require('../scripts/scan-git-history');
const rule = RULES.find((entry) => entry.name === 'secret-shaped assignment');

test('translated sentences ending with credential words are not assignments', () => {
  for (const line of [
    '"An error occurred while verifying the token": "トークンの検証中にエラーが発生しました。"',
    '"You tried to sign in too many times with an incorrect account or password": "您尝试使用错误的帐户或密码登录的次数过多"',
  ]) assert.equal(rule.re.test(line), false);
});

test('actual credential keys remain detectable in every file including translations', () => {
  for (const key of ['password', 'token', 'api_key', 'client-secret', 'encryption_key']) {
    for (const quote of ['', '"', "'"]) {
      for (const separator of [':', '=']) {
        const value = 'synthetic-only-credential';
        const match = `${quote}${key}${quote} ${separator} "${value}"`.match(rule.re);
        assert.equal(match?.[rule.valueGroup], value, `${key} with ${quote} ${separator}`);
      }
    }
  }
});
