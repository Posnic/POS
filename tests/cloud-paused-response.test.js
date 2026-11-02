const test = require('node:test');
const assert = require('node:assert/strict');
const { sendCloudPaused } = require('../api/src/utils/cloud-paused-response');

function response({ method = 'GET', url = '/', accept = 'text/html', reason = 'Free trial ended' } = {}) {
  const result = {};
  sendCloudPaused({ method, url, headers: { accept } }, {
    writeHead(status, headers) { Object.assign(result, { status, headers }); },
    end(body) { result.body = body; },
  }, { suspendedReason: reason });
  return result;
}
test('expired browser session offers existing desktop, new install and renewal paths', () => {
  const r = response();
  assert.equal(r.status, 403);
  assert.match(r.body, /Your cloud trial has ended/);
  assert.match(r.body, /posnic:\/\/open/);
  assert.match(r.body, /Installing Posnic alone will not recover your cloud shop/);
  assert.match(r.body, /after payment is verified/);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.match(r.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
});
test('API remains blocked with JSON even when requesting HTML', () => {
  for (const url of ['/api/sales', '/users/login', '/API/items']) {
    const r = response({ url });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.body), { error: 'account_suspended', reason: 'trial_ended' });
  }
});
test('non-browser and mutation requests never receive the recovery document', () => {
  for (const options of [{ accept: 'application/json' }, { method: 'POST' }, { accept: '' }]) {
    assert.equal(JSON.parse(response(options).body).error, 'account_suspended');
  }
});
test('manual suspension neither claims trial expiry nor implies payment unlocks it', () => {
  const r = response({ reason: '<script>alert(1)</script>' });
  assert.match(r.body, /Cloud access is paused/);
  assert.doesNotMatch(r.body, /<script>|Your cloud trial has ended|View cloud plans/);
});
test('HEAD sends denial headers without a response body', () => {
  assert.equal(response({ method: 'HEAD' }).body, undefined);
  assert.equal(response({ method: 'HEAD', url: '/api/items' }).body, undefined);
});
