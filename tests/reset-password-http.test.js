const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const express = require('../api/node_modules/express');
function request(app) {
  return Object.fromEntries(['get', 'post', 'put'].map(method => [method, path => {
    const send = async body => {
      const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      try { const result = await fetch('http://127.0.0.1:' + server.address().port + path, { method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' }, ...(body ? {body: JSON.stringify(body)} : {}) }); return {status: result.status, body: await result.json()}; }
      finally { await new Promise(resolve => server.close(resolve)); }
    };
    return method === 'get' ? send() : { send };
  }]));
}
const bcrypt = require('../api/node_modules/bcryptjs');
const source = fs.readFileSync(require.resolve('../api/src/controllers/users.controller'), 'utf8');
const start = source.indexOf('  async updateNewPassword(req, res)');
const end = source.indexOf('\n  /**', start);
const method = vm.runInNewContext('({' + source.slice(start, end) + '}).updateNewPassword', { bcrypt, Buffer, Date, Math, console });
async function fixture(expired = false) {
  const record = { _id: 'test-only-user', userkey: 'test-only-reset-key', expire_date: new Date(Date.now() + (expired ? -1000 : 600000)), password: await bcrypt.hash(Buffer.from('Old@Password1').toString('base64'), 4), authVersion: 0 };
  const model = {
    findOne: query => ({ select: () => ({ lean: async () => query.userkey === record.userkey ? { ...record } : null }) }),
    updateOne: async (query, update) => {
      if (query.userkey !== record.userkey || !(record.expire_date > query.expire_date.$gt)) return { matchedCount: 0 };
      Object.assign(record, update.$set); record.authVersion++; delete record.expire_date; return { matchedCount: 1 };
    }
  };
  const controller = new Proxy({ userModel: model, updateNewPassword: method }, { get: (target, key) => target[key] || ((_req, res) => res.json({ ok: true })) });
  const validation = require('../api/src/middleware/users.validation');
  const pass = (_req, _res, next) => next();
  const context = { module: { exports: {} }, require: name => {
    if (name === 'express') return express;
    if (name.includes('controllers/users.controller')) return controller;
    if (name.includes('users.validation')) return validation;
    if (name.includes('auth-rate-limit')) return { loginLimiter: pass, registerLimiter: pass };
    if (name.includes('demo-mode')) return { demoGuard: pass };
    if (name === '../middleware/auth') return { protect: (_req, res) => res.status(401).json({ error: 'login required' }) };
    if (name.includes('upload')) return { single: () => pass };
    if (name === 'mongodb') return require('../api/node_modules/mongodb');
    throw Error('Unexpected dependency: ' + name);
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/src/routes/users.routes'), 'utf8'), context);
  const app = express(); app.use(express.json()); app.use('/users', context.module.exports);
  return { app, record };
}
for (const verb of ['post', 'put']) test('signed-out ' + verb + ' resets once and rejects replay', async () => {
  const { app, record } = await fixture();
  const body = { forgot_key_value: record.userkey, update_new_password: 'New@Password2', retype_new_password: 'New@Password2' };
  const response = await request(app)[verb]('/users/updateNewPassword').send(body);
  assert.equal(response.status, 200); assert.equal(response.body.type, 'success');
  assert.equal(await bcrypt.compare(Buffer.from('New@Password2').toString('base64'), record.password), true);
  assert.equal(await bcrypt.compare(Buffer.from('Old@Password1').toString('base64'), record.password), false);
  assert.equal(record.authVersion, 1);
  const replay = await request(app)[verb]('/users/updateNewPassword').send(body);
  assert.notEqual(replay.body.type, 'success');
  assert.equal((await request(app).get('/users/me')).status, 401);
});
test('expired and missing reset keys cannot change the password', async () => {
  const { app, record } = await fixture(true); const before = record.password;
  for (const key of ['', record.userkey, 'wrong-key']) {
    const r = await request(app).put('/users/updateNewPassword').send({ forgot_key_value: key, update_new_password: 'New@Password2', retype_new_password: 'New@Password2' });
    assert.notEqual(r.body.type, 'success'); assert.equal(record.password, before);
  }
});
