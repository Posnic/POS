'use strict';
// Provider endpoints are fixed (Infobip permits only its own account subdomain).
// No retries: a timeout can follow provider acceptance.
const axios = require('axios');
const field = (key, label, required = false, secret = false) => ({ key, label, required, secret });
const key = field('api_key', 'API key', true, true);
const sender = field('sender_number', 'WhatsApp sender number (with country code)', true);
const template = field('template_name', 'Approved template name');
const language = field('template_lang', 'Template language (for example en)');
const registry = [
  { id: 'meta', name: 'Meta (direct)', help: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started', fields: [field('access_token', 'Access token', true, true), field('phone_number_id', 'Phone number ID', true), field('api_version', 'API version'), template, language] },
  { id: 'brevo', name: 'Brevo', help: 'https://developers.brevo.com/docs/whatsapp-messages', fields: [key, sender, field('template_id', 'Brevo approved template ID'), field('message_variable', 'Template variable for the message (for example MESSAGE)')] },
  { id: 'twilio', name: 'Twilio', help: 'https://www.twilio.com/docs/whatsapp/api', fields: [field('account_sid', 'Account SID', true), field('auth_token', 'Auth token', true, true), sender, field('template_id', 'Approved Content SID (HX…)'), field('message_variable', 'Template variable for the message (usually 1)')] },
  { id: 'msg91', name: 'MSG91', help: 'https://docs.msg91.com/whatsapp', fields: [field('api_key', 'WhatsApp AuthKey', true, true), sender, {...template, required:true}, language, field('namespace', 'Template namespace', true)] },
  { id: '360dialog', name: '360dialog', help: 'https://docs.360dialog.com/docs/messaging-api/api-reference/messages', fields: [key, template, language] },
  { id: 'gupshup', name: 'Gupshup', help: 'https://docs.gupshup.io/docs/template-messages', fields: [key, sender, field('app_name', 'App name', true), field('template_id', 'Approved template ID')] },
  { id: 'infobip', name: 'Infobip', help: 'https://www.infobip.com/docs/whatsapp/whatsapp-over-api', fields: [key, field('account_host', 'API hostname (example.api.infobip.com)', true), sender, template, language] },
];
const get = id => registry.find(p => p.id === id);
const secrets = ['access_token', 'api_key', 'auth_token'];
const number = value => {
  const text = String(value || '').replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(text)) throw new Error('Use a full phone number including country code.');
  return text;
};
function merge(input = {}, previous = {}) {
  const provider = input.provider === undefined ? previous.provider || 'meta' : String(input.provider);
  const p = get(provider);
  if (!p) throw new Error('Choose a supported WhatsApp provider.');
  const prior = (previous.provider || 'meta') === provider ? previous : {};
  const result = {provider};
  for (const f of p.fields) {
    const value = input[f.key];
    result[f.key] = value === undefined || value === null || (f.secret && value === '') ? prior[f.key] || '' : String(value).trim();
  }
  return result;
}
function publicConfig(config = {}) {
  const safe = {}, set = {};
  const p = get(config.provider || 'meta');
  if (!p) return {config:{provider:''}, secrets:{}};
  safe.provider = p.id;
  for (const f of p.fields) {
    if (f.secret) set[f.key] = !!config[f.key]; else safe[f.key] = config[f.key] || '';
  }
  return {config:safe, secrets:set};
}
function build(c, phone, message) {
  const p = get(c.provider || 'meta');
  if (!p) throw new Error('Choose a supported WhatsApp provider.');
  for (const f of p.fields) if (f.required && !c[f.key]) throw new Error('Enter ' + f.label + ' for ' + p.name + '.');
  if (!String(message || '').trim()) throw new Error('Enter a message.');
  const to = number(phone), from = c.sender_number ? number(c.sender_number) : '';
  const req = {method:'POST', headers:{'Content-Type':'application/json'}, timeout:30000, maxRedirects:0, validateStatus:()=>true};
  const metaBody = {messaging_product:'whatsapp', recipient_type:'individual', to, ...(c.template_name ? {type:'template',template:{name:c.template_name,language:{code:c.template_lang||'en_US'},components:[{type:'body',parameters:[{type:'text',text:message}]}]}} : {type:'text',text:{body:message,preview_url:false}})};
  switch(p.id) {
    case 'meta':
      if (!/^v\d+\.\d+$/.test(c.api_version || 'v20.0') || !/^\d+$/.test(c.phone_number_id)) throw new Error('Check the Meta API version and phone number ID.');
      req.url=`https://graph.facebook.com/${c.api_version||'v20.0'}/${c.phone_number_id}/messages`;
      req.headers.Authorization=`Bearer ${c.access_token}`; req.data=metaBody; break;
    case '360dialog':
      req.url='https://waba-v2.360dialog.io/messages';req.headers['D360-API-KEY']=c.api_key;req.data=metaBody;break;
    case 'brevo':
      req.url='https://api.brevo.com/v3/whatsapp/sendMessage';req.headers['api-key']=c.api_key;
      req.data={senderNumber:from,contactNumbers:[to]};
      if(c.template_id){
        if(!/^\d+$/.test(c.template_id)||!Number.isSafeInteger(Number(c.template_id))) throw new Error('Enter a valid Brevo template ID.');
        if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.message_variable||'')) throw new Error('Enter the approved template variable that contains the message.');
        req.data.templateId=Number(c.template_id);req.data.params={[c.message_variable]:message};
      } else req.data.text=message;
      break;
    case 'twilio': {
      if(!/^AC[a-f0-9]{32}$/i.test(c.account_sid)) throw new Error('Enter a valid Twilio Account SID.');
      req.url=`https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Messages.json`;
      req.auth={username:c.account_sid,password:c.auth_token};req.headers['Content-Type']='application/x-www-form-urlencoded';
      const form={From:'whatsapp:+'+from,To:'whatsapp:+'+to};
      if(c.template_id){
        if(!/^HX[a-f0-9]{32}$/i.test(c.template_id)) throw new Error('Enter a valid Twilio Content SID.');
        form.ContentSid=c.template_id;form.ContentVariables=JSON.stringify({[c.message_variable||'1']:message});
      } else form.Body=message;
      req.data=new URLSearchParams(form).toString();break;
    }
    case 'msg91':
      req.url='https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';req.headers.authkey=c.api_key;
      req.data={integrated_number:from,content_type:'template',payload:{messaging_product:'whatsapp',type:'template',template:{name:c.template_name,namespace:c.namespace,language:{code:c.template_lang||'en',policy:'deterministic'},to_and_components:[{to:[to],components:{body_1:{type:'text',value:message}}}]}}};break;
    case 'gupshup': {
      req.url='https://api.gupshup.io/wa/api/v1/'+(c.template_id?'template/msg':'msg');req.headers.apikey=c.api_key;req.headers['Content-Type']='application/x-www-form-urlencoded';
      const form={channel:'whatsapp',source:from,destination:to,'src.name':c.app_name};
      if(c.template_id)form.template=JSON.stringify({id:c.template_id,params:[message]});else form.message=JSON.stringify({type:'text',text:message});
      req.data=new URLSearchParams(form).toString();break;
    }
    case 'infobip':
      if(!/^[a-z0-9-]+\.api\.infobip\.com$/i.test(c.account_host||'')) throw new Error('Enter your Infobip API hostname, without a URL path.');
      req.url=`https://${c.account_host}/whatsapp/1/message/${c.template_name?'template':'text'}`;req.headers.Authorization='App '+c.api_key;
      req.data=c.template_name?{messages:[{from,to,content:{templateName:c.template_name,language:c.template_lang||'en',templateData:{body:{placeholders:[message]}}}}]}:{from,to,content:{text:message}};break;
  }
  return req;
}
function acknowledgement(id, response) {
  const d=response.data||{};
  if(response.status<200||response.status>=300||d.error||d.errors) return null;
  if(['meta','360dialog'].includes(id)) return d.messages?.[0]?.id;
  if(id==='brevo') return d.messageId;
  if(id==='twilio') return !d.error_code && !['failed','undelivered','canceled'].includes(d.status) ? d.sid : null;
  if(id==='gupshup') return d.status==='submitted' ? d.messageId : null;
  if(id==='msg91') return d.type==='success' ? d.request_id : null;
  if(id==='infobip') { const m=d.messages?.[0]||d; return [1,3].includes(m.status?.groupId)?m.messageId:null; }
  return null;
}
async function send(config, phone, message) {
  const id=config.provider||'meta', provider=id==='meta'?'whatsapp_cloud':'whatsapp_'+id;
  let request;
  try {request=build(config,phone,message);} catch(e){return {ok:false,provider,error:e.message};}
  try {
    const response=await axios(request), messageId=acknowledgement(id,response);
    if(typeof messageId==='string'&&messageId.trim()) return {ok:true,provider,messageId,error:null};
    return {ok:false,provider,error:`${get(id).name} did not confirm acceptance (HTTP ${response.status}). Check its message logs before retrying.`};
  } catch { return {ok:false,provider,error:'Could not confirm sending. Check the provider message logs before trying again.'}; }
}
module.exports={list:()=>registry,get,merge,publicConfig,build,acknowledgement,send,secrets};
