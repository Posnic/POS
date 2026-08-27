const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  hasUnexpiredAuthCookie,
  validateSavedLogin,
  clearStaleLogin
} = require('../src/startup-auth');

function startVerifyServer(statusCode, inspectRequest = () => {}) {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      inspectRequest(request);
      response.writeHead(statusCode, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: statusCode === 200 ? 'success' : 'error' }));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

test('recognizes only unexpired authentication cookies', () => {
  const now = Date.now();
  assert.equal(hasUnexpiredAuthCookie([{ name: 'loginuser', value: 'yes' }], now), false);
  assert.equal(hasUnexpiredAuthCookie([{ name: 'jwt', value: 'old', expirationDate: (now - 1000) / 1000 }], now), false);
  assert.equal(hasUnexpiredAuthCookie([{ name: 'jwt', value: 'valid', expirationDate: (now + 60000) / 1000 }], now), true);
});

test('validates a saved JWT before opening the dashboard', async t => {
  const { server, origin } = await startVerifyServer(200, request => {
    assert.equal(request.url, '/users/verify-token');
    assert.match(request.headers.cookie, /jwt=test-token/);
  });
  t.after(() => server.close());

  const valid = await validateSavedLogin(origin, [{ name: 'jwt', value: 'test-token' }]);
  assert.equal(valid, true);
});

test('rejects a stale saved JWT when the API returns 401', async t => {
  const { server, origin } = await startVerifyServer(401);
  t.after(() => server.close());

  const valid = await validateSavedLogin(origin, [{ name: 'jwt', value: 'stale-token' }]);
  assert.equal(valid, false);
});

test('clears every stale authentication cookie', async () => {
  const removed = [];
  const cookieStore = {
    remove: async (origin, name) => removed.push({ origin, name })
  };

  await clearStaleLogin(cookieStore, 'http://localhost:5555');
  assert.deepEqual(removed.map(item => item.name), ['jwt', 'connect.sid', 'loginuser']);
});
