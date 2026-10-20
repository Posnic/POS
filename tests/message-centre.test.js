const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function setup() {
  const dom = new JSDOM(read('frontend/modules/settings_write.html'), { runScripts: 'outside-only', url: 'https://pos.test/' });
  const w = dom.window;
  w.eval(read('frontend/static/script/js/jquery.min.js'));
  const $ = w.$, requests = [], writes = [];
  $.fn.tab = function () { return this; };
  w.confirm = () => true;
  w.PosnicPro = { local: { get: () => 'super_admin' }, i18n: { t: (k, t) => t }, alert() {},
    get(url, cb, failure) { requests.push({url, cb, failure}); },
    put(payload, cb, failure) { writes.push({payload, cb, failure}); },
    post(payload, cb, failure) { writes.push({payload, cb, failure}); },
    whatsapp: { init() {}, loadWhatsAppReceipt() {} }, credit:{load(){}},cashback:{load(){}} };
  for (const p of ['campaigns', 'messaging', 'message-centre']) w.eval(read('frontend/static/script/js/modules/js/' + p + '.js'));
  return {dom,w,$,requests,writes};
}
test('one centre, accessible receipt switch, API/scan buttons and existing campaign form', () => {
  const {dom,w,$}=setup();
  w.PosnicPro.messageCentre.mount(); w.PosnicPro.messageCentre.mount();
  assert.equal($('#message_centre').length,1);
  assert.equal($('#message_connection [data-wa-mode]').length,2);
  assert.equal($('#message_campaigns #campaign_name').length,1);
  assert.equal($('#message_automatic #whatsapp_receipt').length,1);
  assert.match($('#message_receipt_option label').text(),/Offer WhatsApp/);
  $('[data-wa-mode=cloud]').trigger('click');
  assert.equal($('#messaging_wa_mode').val(),'cloud');
  assert.equal($('[data-wa-mode=cloud]').attr('aria-pressed'),'true');
  dom.window.close();
});
test('customer selections survive searches, can be removed, and serialize as IDs', () => {
  const {dom,w,$,requests}=setup(); const c=w.PosnicPro.campaigns;
  c.fill({segment:{type:'customers'}});
  const id='64c111111111111111111111';
  requests.at(-1).cb({type:'success',data:[{_id:id,name:'<img src=x onerror=alert(1)>',phone:'1234'}]});
  assert.equal($('#campaign_matches img').length,0);
  $('[data-recipient]').prop('checked',true).trigger('change');
  $('#campaign_search').val('other'); c.searchAudience();
  requests.at(-1).cb({type:'success',data:[]});
  assert.deepEqual(Array.from(c.collectSegment().customer_ids),[id]);
  assert.equal($('#campaign_selected button').length,1);
  $('[data-remove-recipient]').trigger('click');
  assert.equal(c.collectSegment().customer_ids.length,0);
  dom.window.close();
});
test('late search results do not overwrite current category search', () => {
  const {dom,w,$,requests}=setup(); const c=w.PosnicPro.campaigns;
  c.fill({segment:{type:'customers'}}); const old=requests.at(-1);
  $('#campaign_seg_type').val('category').trigger('change');
  requests.at(-1).cb({type:'success',data:[{_id:'64c111111111111111111111',name:'Trade'}]});
  old.cb({type:'success',data:[{_id:'64c222222222222222222222',name:'Stale customer'}]});
  assert.match($('#campaign_matches').text(),/Trade/);
  assert.doesNotMatch($('#campaign_matches').text(),/Stale/);
  dom.window.close();
});
test('failed settings save never sends a test', () => {
  const {dom,w,$,writes}=setup(); $('#messaging_wa_test_phone').val('+919999999999'); $('#messaging_wa_enabled').prop('checked',true); w.PosnicPro.messaging.waConnected=true;
  w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone');
  assert.equal(writes.length,1); writes[0].cb({type:'error',message:'Save failed'});
  assert.equal(writes.length,1);
  dom.window.close();
});
test('saving WhatsApp excludes stale SMS values and saving SMS excludes WhatsApp', () => {
  const {dom,w,$,writes}=setup();
  $('#messaging_sms_enabled').prop('checked',false);
  $('#messaging_wa_enabled').prop('checked',true);
  w.PosnicPro.messaging.save('whatsapp');
  const wa = JSON.parse(writes[0].payload.data);
  assert.equal(wa.whatsapp_enabled,true);
  assert.equal(Object.keys(wa).some(k=>k.startsWith('sms_')),false);
  w.PosnicPro.messaging.save('sms');
  const sms = JSON.parse(writes[1].payload.data);
  assert.equal(sms.sms_enabled,false);
  assert.equal(Object.keys(sms).some(k=>k.startsWith('whatsapp_')),false);
  dom.window.close();
});
test('provider setup help follows selection and offers safe official links', () => {
  const {dom,w,$}=setup();
  const providers = require('../api/src/services/sms-providers').listProviders();
  w.PosnicPro.messaging.providers = providers;
  for (const p of providers) {
    w.PosnicPro.messaging.renderFields(p.id,{}, {});
    assert.match($('#messaging_provider_note summary').text(), /How to set up/);
    if (p.id !== 'custom') assert.ok($('#messaging_provider_note a').length);
    $('#messaging_provider_note a').each(function () {
      assert.match($(this).attr('href'), /^https:\/\//);
      assert.equal($(this).attr('rel'),'noopener noreferrer');
    });
  }
  w.PosnicPro.messaging.renderFields('msg91',{}, {});
  assert.match($('#messaging_provider_note').text(), /name and url/);
  w.PosnicPro.messaging.renderFields('brevo',{}, {});
  assert.doesNotMatch($('#messaging_provider_note').text(), /MSG91/);
  assert.match($('#messaging_provider_note').text(), /SMTP key is for email/);
  w.PosnicPro.messaging.renderFields('',{}, {});
  assert.equal($('#messaging_provider_note').text(),'');
  assert.ok($('#messaging_wa_cloud a[href*="developers.facebook.com"]').length);
  assert.ok($('#messaging_email_help a[href*="help.brevo.com"]').length);
  dom.window.close();
});
test('failed automatic preference save reverts switch and preserves other settings', () => {
  const {dom,w,$,requests,writes}=setup();w.PosnicPro.messageCentre.mount();w.PosnicPro.messageCentre.show('automatic');
  requests.find(r=>r.url==='credit/settings').cb({type:'success',data:{default_credit_limit:500,reminder_enabled:false,reminder_template:'Keep this',reminder_channel:'sms'}});
  $('#message_toggle_credit').prop('checked',true).trigger('change');
  const payload=JSON.parse(writes[0].payload.data);
  assert.equal(payload.default_credit_limit,500);assert.equal(payload.reminder_channel,'whatsapp');
  writes[0].cb({type:'error'});assert.equal($('#message_toggle_credit').is(':checked'),false);
  dom.window.close();
});

test('review checks audience without sending and invalidates when content changes', () => {
  const {dom,w,$,writes}=setup(); const c=w.PosnicPro.campaigns;
  c.fill({name:'Greeting',message:'Hello {name}',segment:{type:'all'}});
  assert.equal($('#campaign_audience_buttons').length,0);
  assert.equal($('#campaign_review').prop('hidden'),true);
  c.preview();
  assert.equal(writes.length,1);
  assert.equal(writes[0].payload.url,'campaigns/preview');
  writes[0].cb({type:'success',data:{reachable:2,total:3,sample:[]}});
  assert.equal($('#campaign_review').prop('hidden'),false);
  assert.equal($('#campaign_send_btn').prop('disabled'),false);
  assert.equal($('.campaign-compose-grid').prop('hidden'),true);
  assert.equal($('.campaign-footer').prop('hidden'),true);
  $('#campaign_edit_again').trigger('click');
  assert.equal($('.campaign-compose-grid').prop('hidden'),false);
  assert.equal($('#campaign_message').val(),'Hello {name}');
  assert.equal(w.document.activeElement.id,'campaign_message');
  $('#campaign_message').val('Updated').trigger('input');
  assert.equal($('#campaign_review').prop('hidden'),true);
  c.preview();
  $('#campaign_seg_type').val('customers').trigger('change');
  writes[1].cb({type:'success',data:{reachable:2,total:3,sample:[]}});
  assert.equal($('#campaign_review').prop('hidden'),true);
  dom.window.close();
});

test('review with no reachable customers cannot send or schedule', () => {
  const {dom,w,$,writes}=setup(); const c=w.PosnicPro.campaigns;
  c.fill({name:'Greeting',message:'Hello',segment:{type:'all'}});
  c.preview();
  writes[0].cb({type:'success',data:{reachable:0,total:2,sample:[]}});
  assert.equal($('#campaign_send_btn').prop('disabled'),true);
  assert.equal($('#campaign_schedule_btn').prop('disabled'),true);
  dom.window.close();
});
test('service settings stay together while report delivery has its own tab', () => {
 const {dom,w,$,writes}=setup(); w.PosnicPro.messageCentre.mount();
 assert.equal($('#message_email #email_smtp_host').length,1);
 assert.equal($('#message_previous_reports #email_add').length,1);
 $('[data-message-channel=email]').trigger('click');
 assert.equal($('#message_email').prop('hidden'),false);
 assert.equal($('#message_whatsapp').prop('hidden'),true);
 w.PosnicPro.messageCentre.show('reports');
 assert.equal($('#message_reports').prop('hidden'),false);
 assert.equal($('#message_connection').prop('hidden'),true);
 w.PosnicPro.messageCentre.editReport();
 assert.equal($('#message_report_form [name=enabled]').prop('checked'),false);
 $('#message_report_form [name=destination]').val('owner@example.com');
 $('#message_report_form [name=frequency]').val('monthly').trigger('change');
 assert.equal($('#message_report_weekday').prop('hidden'),true);
 $('#message_report_form').trigger('submit');
 assert.equal(JSON.parse(writes[0].payload.data).enabled,false);
 assert.equal(JSON.parse(writes[0].payload.data).frequency,'monthly');
 dom.window.close();
});
test('linked phone with sending disabled cannot send or save a test', () => {
 const {dom,w,$,writes}=setup(); w.PosnicPro.messageCentre.mount();
 w.PosnicPro.messaging.waConnected=true; w.PosnicPro.messaging.render({whatsapp_enabled:false});
 assert.equal($('#messaging_wa_test_btn').prop('disabled'),true);
 assert.match($('#messaging_wa_readiness').text(),/Sending is off/);
 $('#messaging_wa_test_phone').val('+919008427482'); w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone');
 assert.equal(writes.length,0); dom.window.close();
});
test('invalid number and disconnected scan session are blocked before save', () => {
 const {dom,w,$,writes}=setup(); w.PosnicPro.messaging.render({whatsapp_enabled:true});
 $('#messaging_wa_test_phone').val('9008427482'); w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone');
 assert.equal(writes.length,0);
 $('#messaging_wa_test_phone').val('+919008427482'); w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone');
 assert.equal(writes.length,0); dom.window.close();
});
test('test sends once, uses country code, and unlocks after provider failure', () => {
 const {dom,w,$,writes}=setup(); w.PosnicPro.messageCentre.mount();
 w.PosnicPro.messaging.waConnected=true; w.PosnicPro.messaging.render({whatsapp_enabled:true});
 $('#messaging_wa_test_phone').val('+91 90084 27482');
 w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone');
 w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone'); assert.equal(writes.length,1);
 writes[0].cb({type:'success'}); assert.equal(writes.length,2);
 assert.equal(JSON.parse(writes[1].payload.data).phone,'+919008427482');
 writes[1].cb({type:'error',message:'Sender offline'});
 assert.equal(w.PosnicPro.messaging.testPending,false); assert.match($('#messaging_test_result').text(),/Sender offline/);
 assert.equal($('#messaging_wa_test_btn').prop('disabled'),false); dom.window.close();
});
test('HTTP errors release the test button and preserve the server explanation', () => {
 const {dom,w,$,writes}=setup(); w.PosnicPro.messageCentre.mount();
 w.PosnicPro.messaging.waConnected=true; w.PosnicPro.messaging.render({whatsapp_enabled:true});
 $('#messaging_wa_test_phone').val('+919008427482'); w.PosnicPro.messaging.test('whatsapp','#messaging_wa_test_phone');
 writes[0].cb({type:'success'}); writes[1].failure({status:400,responseJSON:{message:'Phone disconnected'}});
 assert.equal(w.PosnicPro.messaging.testPending,false);
 assert.match($('#messaging_test_result').text(),/Phone disconnected/); dom.window.close();
});

test('history HTTP failures stop loading and allow a successful retry', () => {
 const {dom,w,$,requests}=setup(); w.PosnicPro.messageCentre.mount();
 w.PosnicPro.messageCentre.show('history');
 requests.find(r=>r.url==='messaging/history').failure({status:404});
 assert.doesNotMatch($('#message_history').text(),/Loading/);
 assert.match($('#message_history').text(),/Refresh the page/);
 $('[data-message-history-retry]').trigger('click');
 const calls=requests.filter(r=>r.url==='messaging/history'); assert.equal(calls.length,2);
 calls[1].cb({type:'success',data:[]});
 assert.match($('#message_history').text(),/No messages yet/);
 dom.window.close();
});
test('WhatsApp providers show only their fields, setup guide and isolated credentials',()=>{
 const {dom,w,$}=setup();w.PosnicPro.messageCentre.mount();
 const providers=require('../api/src/services/whatsapp-providers').list();
 const settings={whatsapp_enabled:true,whatsapp_mode:'cloud',whatsapp_providers:providers,whatsapp_cloud:{provider:'brevo',sender_number:'919008427482'},whatsapp_secrets_set:{api_key:true}};
 w.PosnicPro.messaging.render(settings);
 assert.equal($('#messaging_wa_provider option').length,7);
 assert.equal($('#messaging_wa_meta_fields').css('display'),'none');
 assert.match($('#messaging_wa_provider_fields').text(),/Set up Brevo/);
 assert.match($('#messaging_wa_field_api_key').attr('placeholder'),/Saved/);
 $('#messaging_wa_field_api_key').val('unsaved-brevo-secret');
 $('#messaging_wa_provider').val('twilio').trigger('change');
 assert.equal($('#messaging_wa_field_api_key').length,0);
 assert.equal($('#messaging_wa_field_auth_token').val(),'');
 const data=w.PosnicPro.messaging.collect('whatsapp');
 assert.equal(data.whatsapp_cloud.provider,'twilio');assert.equal(data.whatsapp_cloud.api_key,undefined);assert.equal(data.sms_config,undefined);
 assert.match($('#messaging_wa_provider_fields a').attr('href'),/^https:\/\/www.twilio.com/);
 $('#messaging_wa_provider').val('meta').trigger('change');
 assert.notEqual($('#messaging_wa_meta_fields').css('display'),'none');
 dom.window.close();
});

test('review is the send confirmation, double clicks send once and network failure requires review again',()=>{
 const {dom,w,$,writes}=setup(); const c=w.PosnicPro.campaigns;
 w.confirm=()=>{throw Error('Native dialog must not open');};
 c.fill({name:'Test',message:'Hello',segment:{type:'all'}});
 c.sendNow(false); assert.equal(writes.length,0);
 c.preview(); writes[0].cb({type:'success',data:{reachable:1,total:1,sample:[]}});
 c.sendNow(false); c.sendNow(false); assert.equal(writes.length,2);
 writes[1].cb({type:'success',data:{_id:'campaign-id'}});
 assert.equal(writes.length,3); assert.equal(writes[2].payload.url,'campaigns/campaign-id/send');
 assert.equal(JSON.parse(writes[2].payload.data).dryRun,false);
 writes[2].failure({status:503}); assert.equal(c._sending,false);
 assert.equal($('#campaign_review').prop('hidden'),true);
 c.sendNow(false); assert.equal(writes.length,3);
 dom.window.close();
});
