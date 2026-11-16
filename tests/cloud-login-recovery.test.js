const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreloginSync } = require('../api/src/services/prelogin-sync');
const { recoveryAddress } = require('../src/cloud-login-recovery');
const env = { POSNIC_DESKTOP: '1', POSNIC_SYNC_PAIRED: '1', SYNC_AGENT_PORT: '5055' };

test('community and cloud server logins never contact a local agent', async () => {
  for (const settings of [{}, { ...env, POSNIC_DESKTOP: '0' }, { ...env, POSNIC_SYNC_PAIRED: '0' }]) {
    assert.deepEqual(await createPreloginSync({ env: settings, request: () => { throw Error('unexpected'); } })(), { state: 'local' });
  }
});
test('login requests a users-only pull and requires its explicit completion', async () => {
  const refresh = createPreloginSync({ env, request: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:5055/sync-users');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => ({ state: 'updated' }) };
  } });
  assert.deepEqual(await refresh(), { state: 'updated' });
});
test('offline and older agents retain local login without claiming a refresh', async () => {
  for (const request of [async () => { throw Error('offline'); }, async () => ({ok:false,status:503}), async () => ({ok:true,json:async()=>({lastSuccessAt:new Date()})})]) {
    assert.deepEqual(await createPreloginSync({env,request})(),{state:'unavailable'});
  }
  assert.deepEqual(await createPreloginSync({env,request:async()=>({ok:false,status:404})})(),{state:'upgrade-required'});
});
test('concurrent login refreshes share one operation and timeout aborts the request', async () => {
  let calls=0;
  const refresh=createPreloginSync({env,timeoutMs:10,request:async (url,{signal})=>{
    calls++;
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,200);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('timeout'));});});
  }});
  assert.deepEqual(await Promise.all([refresh(),refresh()]),[{state:'unavailable'},{state:'unavailable'}]);
  assert.equal(calls,1);
});
const config = { gatewayUrl: 'https://gateway.posnic.com', deviceToken: 'test-token' };
const identity = { tenantDb: 'shop-a' };
test('cloud recovery uses only the authenticated linked shop, never a typed URL', async () => {
  const url = await recoveryAddress({ config, identity, fetch: async (url, opts) => {
    assert.equal(url, 'https://gateway.posnic.com/v1/device/identity');
    assert.equal(opts.redirect, 'error');
    assert.equal(opts.headers.authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ tenantDb: 'shop-a', connections: { cloud: 'https://shop-a.posnic.io' } }) };
  } });
  assert.equal(url, 'https://shop-a.posnic.io/login.html#recover');
});
test('unlinked, mismatched, unavailable and insecure recovery destinations are refused', async () => {
  assert.equal(await recoveryAddress({ config: null, identity }), null);
  for (const result of [
    { tenantDb: 'shop-b', connections: { cloud: 'https://shop-b.posnic.io' } },
    { tenantDb: 'shop-a', connections: { cloud: 'http://localhost' } },
    { tenantDb: 'shop-a', connections: { cloud: 'https://name:secret@shop-a.posnic.io' } },
    { tenantDb: 'shop-a', connections: {} },
  ]) await assert.rejects(recoveryAddress({ config, identity, fetch: async () => ({ ok: true, json: async () => result }) }));
});

test('startup refresh awaits cloud credentials before saved-session validation and tolerates offline failure', async () => {
  const { refreshUsersBeforeLogin } = require('../src/startup-auth');
  let completed = false;
  const state = await refreshUsersBeforeLogin('http://localhost:42590', async (url, options) => {
    assert.equal(url, 'http://localhost:42590/api/users/recovery/refresh-cloud');
    assert.equal(options.method, 'POST');
    await new Promise(resolve => setTimeout(resolve, 5));
    completed = true;
    return { ok: true, json: async () => ({ data: { state: 'updated' } }) };
  });
  assert.equal(state, 'updated');
  assert.equal(completed, true);
  assert.equal(await refreshUsersBeforeLogin('http://localhost:42590', async () => { throw Error('offline'); }), 'unavailable');
});
