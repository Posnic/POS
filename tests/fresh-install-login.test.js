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
    ['short77', false], ['Eight888', true], [12345678, false],
  ]) {
    const req = { body: { register_userpassword: password } };
    for (const chain of validateInstallation) await chain.run(req);
    const errors = validationResult(req).array().filter(error => error.path === 'register_userpassword');
    assert.equal(errors.length === 0, accepted);
    assert.equal(req.body.register_userpassword, password, 'validation must preserve the password');
  }
});

test('setup API enforces supplied confirmation and preserves older provisioning requests', async () => {
  const { validateInstallation } = apiRequire('./src/middleware/install.validation');
  const { validationResult } = apiRequire('express-validator');
  for (const [confirmation, accepted] of [[undefined,true],['',false],['different',false],[' ExactOwner! ',true]]) {
    const req = {body:{register_userpassword:' ExactOwner! '}};
    if (confirmation !== undefined) req.body.register_password_confirm = confirmation;
    for (const chain of validateInstallation) await chain.run(req);
    assert.equal(validationResult(req).array().some(e=>e.path==='register_password_confirm'),!accepted);
  }
});

test('existing-password entry points preserve long exact credentials and reject non-string login', async () => {
  const {validateLogin,validateUserVerify,validatePasswordUpdate,validateUser}=apiRequire('./src/middleware/users.validation');
  const {validateChangePassword}=apiRequire('./src/middleware/settings.validation');
  const {validationResult}=apiRequire('express-validator');
  const current=' ExactOwner!LongPassword ';
  for(const [chains,req,field] of [
    [validateLogin,{body:{username:'owner',password:current}},'password'],
    [validateUserVerify,{query:{password:current},body:{}},'password'],
    [validateChangePassword,{body:{old_password:current,new_password:' NewPass123! ',confirm_password:' NewPass123! '}},'old_password'],
  ]) {
    for(const chain of chains) await chain.run(req);
    assert.equal(validationResult(req).array().filter(e=>e.path===field).length,0);
    assert.equal((req.query||req.body)[field],current);
  }
  for(const [chains,body,field] of [
    [validateLogin,{username:'owner',password:12345678},'password'],
    [validateUser,{password:'tiny',usertype:'staff'},'password'],
    [validateUser,{usertype:'staff'},'password'],
    [validateUser,{password:'Owner123!',retype_password:'Wrong123!',usertype:'staff'},'retype_password'],
    [validatePasswordUpdate,{update_new_password:'seven77',retype_new_password:'seven77'},'update_new_password'],
    [validatePasswordUpdate,{update_new_password:'Owner123!',retype_new_password:'Wrong123!'},'retype_new_password'],
    [validateChangePassword,{old_password:current,new_password:'🙂'.repeat(18),confirm_password:'🙂'.repeat(18)},'new_password'],
    [validateChangePassword,{old_password:current,new_password:' NewPass123! ',confirm_password:'NewPass123!'},'confirm_password'],
  ]) {
    const req={body}; for(const chain of chains) await chain.run(req);
    assert.ok(validationResult(req).array().some(e=>e.path===field));
  }
});

test('fresh owner email follows the model lowercase contract', async () => {
  let stored;
  const service = Object.create(InstallService.prototype);
  service.repository = {insertUser:async user=>{stored=user;return 'owner';}};
  await service._createUser({register_username:'Owner@Example.invalid',register_useremail:' Owner@Example.invalid ',register_userpassword:'OwnerTest!123'},'license','secret',new Date(),new Date());
  assert.equal(stored.email,'owner@example.invalid');
});

test('mobile, kiosk and admin verification accept both stored formats without trimming or bypassing roles', async () => {
  const bcrypt = apiRequire('bcryptjs');
  const service = Object.create(apiRequire('./src/services/user.service'));
  const repository = Object.create(apiRequire('./src/repositories/user.repository'));
  const password = ' ExactOwner!LongPassword ';
  const id = '507f1f77bcf86cd799439011';
  for (const encoded of [false,true]) {
    const user={_id:id,username:'owner',activate:true,usertype:'super_admin',branch_access:[],password:await bcrypt.hash(encoded?Buffer.from(password).toString('base64'):password,4)};
    service.repository={findOne:async()=>user};
    repository.findOne=async()=>user;
    assert.equal((await service.mobileLogin('owner',password)).status,true);
    assert.equal((await service.kioskLogin('owner',password)).status,true);
    assert.equal((await repository.verifyUserPassword(id,password,id,id)).status,true);
    for (const wrong of [password.trim(),'WrongOwner!123']) {
      assert.equal((await service.mobileLogin('owner',wrong)).status,false);
      assert.equal((await repository.verifyUserPassword(id,wrong,id,id)).status,false);
    }
    user.usertype='staff';
    assert.equal((await repository.verifyUserPassword(id,password,id,id)).status,false);
    user.activate=false;
    assert.equal((await service.mobileLogin('owner',password)).status,false);
  }
});
