const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/branches.js'), 'utf8');
function fixture() {
  const dom = new JSDOM('<span class="branch-name">Current shop</span><span id="header_current_branch">Current shop</span>', {runScripts:'outside-only'});
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/jquery.min.js'), 'utf8'));
  const saved = {branch_id_set:'current',branchname:'Current shop',branchemail:'current@example.test'};
  const display = [];
  w.PosnicPro = {local:{get:key=>saved[key],set:(key,value)=>saved[key]=value,setVolatile:(key,value)=>saved[key]=value}};
  w.db = {customerDisplay:{put:row=>display.push(row)}};
  const start=source.indexOf('applyCurrentBranchIdentity: function');
  const method=w.eval('({' + source.slice(start,source.indexOf('showAdd: function',start)) + '})').applyCurrentBranchIdentity;
  return {dom,w,saved,display,method};
}
test('editing a different branch does not replace the active shop identity or receipt contacts',()=>{
  const f=fixture();
  assert.equal(f.method({id:'other',branch_name:'Other shop',store_email:'other@example.test'}),false);
  assert.equal(f.saved.branchname,'Current shop');
  assert.equal(f.saved.branchemail,'current@example.test');
  assert.equal(f.display.length,0);
  assert.equal(f.w.document.querySelector('.branch-name').textContent,'Current shop');
  f.dom.window.close();
});
test('editing the active branch refreshes its identity and customer display as text',()=>{
  const f=fixture();
  assert.equal(f.method({id:'current',branch_name:'Shop <new>',store_email:'new@example.test',store_telephone:'123',store_address:'New address'}),true);
  assert.equal(f.saved.branchname,'Shop <new>');
  assert.equal(f.saved.branchemail,'new@example.test');
  assert.equal(f.saved.branchaddress,'New address');
  assert.equal(f.w.document.querySelector('#header_current_branch').textContent,'Shop <new>');
  assert.equal(f.w.document.querySelector('new'),null);
  assert.equal(f.display[0].branch[0].name,'Shop <new>');
  f.dom.window.close();
});
