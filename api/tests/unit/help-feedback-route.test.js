const express = require('express');
let server;
let origin;
// Exercise real HTTP without adding another test-only dependency.
function request() {
  function call(method, url) {
    const headers = { 'Content-Type': 'application/json' };
    let body;
    const result = {
      set(key, value) {
        headers[key] = value;
        return result;
      },
      send(data) {
        body = JSON.stringify(data);
        return result;
      },
      async then(resolve, reject) {
        try {
          const response = await fetch(origin + url, { method, headers, body });
          const text = await response.text();
          resolve({ status: response.status, body: text ? JSON.parse(text) : null });
        } catch (error) {
          reject(error);
        }
      },
    };
    return result;
  }
  return { get: (url) => call('GET', url), post: (url) => call('POST', url) };
}
jest.mock(
  '../../src/controllers/base.controller',
  () =>
    class {
      success(res, data) {
        return res.json({ type: 'success', data });
      }
      autoSuggestionTableField() {}
      autoSuggestionReportTableField() {}
      getDefaultSuggest() {}
    }
);
jest.mock('../../src/middleware/auth', () => ({
  protect(req, res, next) {
    if (!req.headers.authorization) return res.status(401).end();
    req.user = { id: req.headers.authorization, email: 'owner@example.com' };
    req.tenantContext = { branchName: 'Test branch', licenseId: 'test-account' };
    next();
  },
  optionalProtect: (_req, _res, next) => next(),
}));
const service = require('../../src/services/help-feedback.service');
const app = express();
app.use(express.json());
app.use('/base', require('../../src/routes/base.routes'));
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
afterEach(() => jest.restoreAllMocks());
test('both support routes require sign-in', async () => {
  expect((await request(app).get('/base/help-feedback')).status).toBe(401);
  expect((await request(app).post('/base/help-feedback').send({})).status).toBe(401);
});
test('context includes signed-in defaults without unrelated user fields', async () => {
  const res = await request(app).get('/base/help-feedback').set('Authorization', 'context-user');
  expect(res.status).toBe(200);
  expect(res.body.data.email).toBe('owner@example.com');
  expect(res.body.data.branch).toBe('Test branch');
  expect(res.body.data.password).toBeUndefined();
});
const valid = { email: 'reply@example.com', category: 'complaint', comment: 'Please help.' };
test('invalid requests never leave the API', async () => {
  const submit = jest.spyOn(service, 'submit');
  const res = await request(app)
    .post('/base/help-feedback')
    .set('Authorization', 'invalid-user')
    .send({ ...valid, comment: '' });
  expect(res.status).toBe(400);
  expect(submit).not.toHaveBeenCalled();
});
test.each([429, 502])('provider refusal %s is visible', async (code) => {
  jest.spyOn(service, 'submit').mockResolvedValue({ status: code, message: 'Please retry.' });
  const res = await request(app)
    .post('/base/help-feedback')
    .set('Authorization', `refusal-${code}`)
    .send(valid);
  expect(res.status).toBe(code);
  expect(res.body.message).toBe('Please retry.');
});
test('network failure is a recoverable 503', async () => {
  jest.spyOn(service, 'submit').mockRejectedValue(new Error('timeout'));
  const res = await request(app)
    .post('/base/help-feedback')
    .set('Authorization', 'offline-user')
    .send(valid);
  expect(res.status).toBe(503);
  expect(res.body.message).toMatch(/comment is kept/);
});
test('public demo refuses authenticated submissions without contacting support', async () => {
  jest.spyOn(require('../../src/config/demo-mode'), 'isDemoMode').mockReturnValue(true);
  const originalFetch = global.fetch;
  const outbound = jest.spyOn(global, 'fetch').mockImplementation((url, options) => {
    if (String(url).startsWith(origin + '/')) return originalFetch(url, options);
    throw new Error('Unexpected outbound request from public demo');
  });
  const res = await request(app)
    .post('/base/help-feedback')
    .set('Authorization', 'demo-user')
    .send(valid);
  expect(res.status).toBe(403);
  expect(res.body.message).toMatch(/public demo/);
  expect(outbound).toHaveBeenCalledTimes(1);
});
test('a successful response includes the central receipt', async () => {
  jest.spyOn(service, 'submit').mockResolvedValue({ status: 200, reference: 'ABC123' });
  const res = await request(app)
    .post('/base/help-feedback')
    .set('Authorization', 'success-user')
    .send(valid);
  expect(res.status).toBe(200);
  expect(res.body.data.reference).toBe('ABC123');
});
test('repeated requests are limited per user without blocking another user', async () => {
  jest.spyOn(service, 'submit').mockResolvedValue({ status: 200, reference: 'ABC123' });
  for (let n = 0; n < 3; n++) {
    expect(
      (
        await request(app)
          .post('/base/help-feedback')
          .set('Authorization', 'limited-user')
          .send(valid)
      ).status
    ).toBe(200);
  }
  expect(
    (
      await request(app)
        .post('/base/help-feedback')
        .set('Authorization', 'limited-user')
        .send(valid)
    ).status
  ).toBe(429);
  expect(
    (
      await request(app)
        .post('/base/help-feedback')
        .set('Authorization', 'another-user')
        .send(valid)
    ).status
  ).toBe(200);
});
