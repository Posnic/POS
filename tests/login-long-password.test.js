'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../frontend/login.html'),'utf8');
test('login accepts passwords longer than the former 20-character limit',()=>{
 const dom=new JSDOM(html);const field=dom.window.document.getElementById('password');
 field.value='a-valid-setup-password-longer-than-twenty-characters';
 assert.equal(field.maxLength,-1);assert.equal(field.checkValidity(),true);
 const start=html.indexOf('rules: {',html.indexOf('$("#login_form").validate'));
 assert.ok(start>=0);
 const end=html.indexOf('messages:',start);
 const rules=vm.runInNewContext('({'+html.slice(start,end).replace(/,\s*$/,'')+'})').rules;
 assert.equal(rules.password.required,true);
 assert.equal(rules.password.maxlength,undefined);
 dom.window.close();
});
