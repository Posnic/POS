const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { DEFAULT_ROLES } = require('../api/src/constants/roles.constants');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const source = read('frontend/static/script/js/modules/js/users.js');
function method(w, name, next) {
  const start = source.indexOf('    ' + name + ': function');
  return w.eval('({' + source.slice(start, source.indexOf('    ' + next + ': function', start)) + '})')[name];
}
function fixture() {
  const dom = new JSDOM(read('frontend/modals/user.html'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('frontend/static/script/js/jquery.min.js'));
  w.eval(read('frontend/static/script/js/jquery.validate.min.js'));
  w.eval(read('frontend/static/script/js/validpassword-showhidepassword.js'));
  w.HTMLElement.prototype.scrollIntoView = function () {};
  const $ = w.jQuery;
  $.fn.select2 = function(action) {
    return action === 'data' ? Array.from(this[0].selectedOptions).map(element => ({ element, id: element.value, text: element.textContent })) : this;
  };
  const requests = [];
  w.PosnicPro = { i18n: { t: (key, text) => text }, users: {},
    getFormData: form => Object.fromEntries(form.serializeArray().map(x => [x.name, x.value])),
    request: params => requests.push(params)
  };
  const u = w.PosnicPro.users;
  for (const [name,next] of [['setPasswordEditing','roleLabel'],['showPermissionError','clickNormalForm'],['clickNormalForm','clickApiForm'],['userForm','insertLocalStorage'],['user','viewUser'],['fillPosForm','collectPosForm'],['collectPosForm','updatePinRowVisibility'],['applyRoleToForm','setManagerPin']]) u[name] = method(w,name,next);
  u.POS_ACTION_KEYS = ['discount_apply', 'refund', 'register_open']; u.updatePinRowVisibility = () => {};
  w.eval(read('frontend/static/script/js/core/record-workspace.js')); u.rolesCache = [];
  w.PosnicPro.recordWorkspace.init();
  w.eval(source.slice(source.indexOf('$("#clicksubmit").click('), source.indexOf("$('#click_collapse').click(")));
  $('#user_form_upload input[type=checkbox]').prop('checked',false);
  for (const [id,value] of Object.entries({users_firstname:'Test',users_lastname:'Person',users_name:'test22',users_email:'test22@gmail.com',users_password:'Test@12345',users_retype_password:'Test@12345',logo_user:'user.svg'})) $('#' + id).val(value);
  $('#normalUser,#defaultMethod').prop('checked',true);
  $('#branchtype').empty().append(new w.Option('Shop', 'branch-id',true,true));
  return { dom, w, $, u, requests };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
test('Save reports profile and permission errors together, then sends exactly one request after correction', async () => {
  const {dom,$,requests} = fixture();
  $('#users_retype_password').val('Mismatch@1');
  $('#clicksubmit')[0].click(); await tick(); 
  assert.equal(requests.length,0);
  assert.match($('#user_save_errors').text(),/Passwords do not match/);
  assert.match($('#user_save_errors').text(),/Permission is required/);
  assert.equal($('#user_form_upload-section-0')[0].hidden,false);
  $('#users_retype_password').val('Test@12345');
  $('#clicksubmit')[0].click(); await tick(); 
  assert.equal($('#user_form_upload-section-1')[0].hidden,false);
  assert.match($('#checkbox_error').text(),/Permission/);
  $('#sales_read').prop('checked',true);
  $('#clicksubmit')[0].click(); await tick(); 
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'users'); assert.equal(requests[0].method,'POST');
  const payload=JSON.parse(requests[0].data);
  assert.equal(payload.branch_data[0].branch_id,'branch-id');
  assert.equal(payload.branch_data[0].branch_image,'store.png');
  assert.equal(payload.name,'test22');
  assert.equal($('#user_save_errors').length,0);
  dom.window.close();
});
test('Accountant role reaches the users endpoint even though its checked permissions are disabled', async () => {
  const {dom,w,$,u,requests} = fixture();
  const accountant = {...DEFAULT_ROLES.find(role=>role.key==='accountant'),_id:'accountant-role'};
  u.rolesCache=[accountant];
  $('#user_role_id').append(new w.Option('Accountant','accountant-role')).val('accountant-role');
  u.applyRoleToForm('accountant-role');
  $('#clicksubmit')[0].click(); await tick(); 
  assert.equal(requests.length,1);
  assert.equal(JSON.parse(requests[0].data).role_id,'accountant-role');
  dom.window.close();
});
test('missing Select2 branch selection has a visible error and never sends the request', async () => {
  const {dom,$,requests} = fixture();
  $('#sales_read').prop('checked',true); $('#branchtype').val([]).hide();
  $('#clicksubmit')[0].click(); await tick(); 
  assert.equal(requests.length,0); assert.match($('#user_save_errors').text(),/Choose a shop/);
  assert.equal($('#user_form_upload-section-1')[0].hidden,false);
  dom.window.close();
});

 test('editing keeps the password unless an explicit reset is selected and validated', async () => {
  const {dom,$,u,requests} = fixture();
  $('#users_id').val('existing-user');
  $('#sales_read').prop('checked',true);
  u.setPasswordEditing(false);
  assert.equal($('#users_password').val(),'');
  assert.equal($('#users_password').prop('disabled'),true);
  assert.equal($('#check_password').val(),'no');
  u.setPasswordEditing(true);
  $('#clicksubmit')[0].click(); await tick();
  assert.equal(requests.length,0);
  $('#users_password,#users_retype_password').val('New@12345');
  $('#clicksubmit')[0].click(); await tick();
  assert.equal(requests.length,1);
  const payload=JSON.parse(requests[0].data);
  assert.equal(payload.password,'New@12345');
  assert.equal(payload.check_password,'yes');
  u.setPasswordEditing(false);
  assert.equal($('#users_retype_password').val(),'');
  assert.equal($('#check_password').val(),'no');
  dom.window.close();
});
