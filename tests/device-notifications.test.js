const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(options={}) {
 const elements={},calls=[],alerts=[];const $=selector=>elements[selector] ||= {length:1,values:{},show(){return this;},prop(k,v){this.values[k]=v;return this;},text(v){this.value=v;return this;},data(k,v){if(arguments.length===1)return this.values[k];this.values[k]=v;return this;}};
 const subscription={endpoint:'https://push.example/device',toJSON(){return {endpoint:this.endpoint};}};
 const reg={active:{},pushManager:{getSubscription:async()=>options.existing?subscription:null,subscribe:async()=>{if(options.subscribeError)throw Error('browser');return subscription;}}};
 const Notification={permission:options.permission||'granted',requestPermission:async()=>options.grant||'granted'};
 const PosnicPro={i18n:{t:(k,f)=>f},alert:(type,text)=>alerts.push({type,text}),get:(p,done)=>{calls.push(p.url);done({type:'success',data:{key:'AQID'}});},post:(p,done)=>{calls.push(p.url);done(p.url===options.fail?{type:'error'}:{type:'success',data:{sent:options.sent??1}});}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/device-notifications.js'),'utf8'),{PosnicPro,$,window:{isSecureContext:true,Notification,PushManager:{}},Notification,navigator:{serviceWorker:{getRegistration:async()=>options.noWorker?null:reg}},setTimeout,clearTimeout,Uint8Array,atob:s=>Buffer.from(s,'base64').toString('binary')});
 return {api:PosnicPro.deviceNotifications,calls,alerts,elements,$};
}
test('notification setup persists before reporting success',async()=>{const f=fixture();await f.api.click();assert.deepEqual(f.calls,['push/key','push/subscribe']);assert.equal(f.alerts.at(-1).type,'success');});
test('notification registration and browser failures are visible, never false successes',async()=>{for(const options of [{fail:'push/subscribe'},{subscribeError:true},{noWorker:true}]){const f=fixture(options);await f.api.click();assert.equal(f.alerts.at(-1).type,'error');assert.equal(f.$('#bell_feed_push').values.disabled,false);}});
test('blocked permission explains how to recover without a server request',async()=>{const f=fixture({permission:'denied'});await f.api.click();assert.equal(f.calls.length,0);assert.match(f.$('#bell_push_status').value,/blocked/);assert.equal(f.$('#bell_feed_push').values.disabled,true);});
test('existing browser subscription repairs server registration before testing delivery',async()=>{const f=fixture({existing:true,sent:0});f.$('#bell_feed_push').data('subscribed',true);await f.api.click();assert.deepEqual(f.calls,['push/key','push/subscribe','push/test']);assert.equal(f.alerts.at(-1).type,'error');});
