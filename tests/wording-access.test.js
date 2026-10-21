const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const file = require.resolve('../api/src/routes/wording.routes');
const realRequire = createRequire(file);
function fixture(env = {}) {
  const routes = {}, middleware = [];
  const router = { use(fn) { middleware.push(fn); }, get(path, fn) { routes['GET ' + path] = fn; }, put(path, fn) { routes['PUT ' + path] = fn; }, post(path, fn) { routes['POST ' + path] = fn; } };
  const protect = () => {};
  class BaseModel { async getCollection() { throw Error('Unauthorized request reached storage'); } }
  const context = { module: { exports: {} }, process: { env }, require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../middleware/auth') return { protect };
    if (name === '../models/base.model') return BaseModel;
    return realRequire(name);
  } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  assert.equal(middleware[0], protect);
  return async (method, req) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes[method](req, response); return response;
  };
}
test('staff and API keys cannot manage wording profiles', async () => {
  const call = fixture();
  for (const method of ['GET /', 'GET /labels', 'PUT /draft', 'POST /publish', 'POST /remove']) {
    assert.equal((await call(method, { user: { usertype: 'staff' } })).statusCode, 403);
    assert.equal((await call(method, { isApiKey: true, user: { usertype: 'super_admin' } })).statusCode, 403);
  }
});
test('paired desktop refuses profile writes before touching storage', async () => {
  const call = fixture({ POSNIC_DESKTOP: '1', POSNIC_SYNC_PAIRED: '1' });
  for (const method of ['PUT /draft', 'POST /publish', 'POST /remove']) {
    assert.equal((await call(method, { user: { usertype: 'super_admin' } })).statusCode, 409);
  }
});
