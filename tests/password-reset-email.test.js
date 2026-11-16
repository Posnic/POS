const test = require('node:test');
const assert = require('node:assert/strict');
const render = require('../api/src/utils/password-reset-email');

test('reset mail includes an actionable button, plain text and the same fallback URL', () => {
  const url = 'https://shop.posnic.io/public/forgotpassword.html?forgotpassword_Id=test&source=mail';
  const mail = render({ name: 'Sridhar', url });
  assert.match(mail.subject, /^Reset your .+ password$/);
  assert.equal(mail.htmlContent.split(url.replaceAll('&', '&amp;')).length - 1, 3);
  assert.ok(mail.textContent.includes(url));
  assert.match(mail.htmlContent, /Reset password/);
  assert.match(mail.htmlContent, /10 minutes/);
  assert.match(mail.htmlContent, /password will stay unchanged/);
  assert.doesNotMatch(mail.htmlContent, /Please Verify|View in browser|Forgot Mail/);
});

test('reset mail escapes names and rejects executable URLs', () => {
  const mail = render({ name: '<img src=x onerror=alert(1)>', url: 'https://shop.posnic.io/reset' });
  assert.doesNotMatch(mail.htmlContent, /<img src=x/);
  assert.match(mail.htmlContent, /&lt;img/);
  assert.throws(() => render({ url: 'javascript:alert(1)' }), /Invalid reset URL/);
});
