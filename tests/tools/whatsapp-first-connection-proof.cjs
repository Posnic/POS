// Explicit manual smoke test: loads WhatsApp Web but never links a phone or sends.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const service=require('../../api/src/services/whatsapp.service');
const qrcode=require('../../api/node_modules/qrcode');
const root=path.resolve(__dirname,'../..');
service.sessionPath=path.join(root,'output/whatsapp-first-connection');
const dom=new JSDOM('<input id="messaging_wa_device"><span id="whatsapp_status_badge">Loading...</span><button id="whatsapp_connect_btn"></button><div id="whatsapp_qr_container"><div id="whatsapp_qr_code"></div></div>',{runScripts:'outside-only'});
const w=dom.window,branch='local-first-setup-proof';
w.eval(fs.readFileSync(path.join(root,'frontend/static/script/js/jquery.min.js'),'utf8'));
const errors=[];
w.PosnicPro={local:{get:()=>branch},i18n:{t:(k,v)=>v},alert:(type,msg)=>{if(type==='error')errors.push(msg);},post:(p,ok)=>{service.initializeClient(p.data.device_id,branch).then(r=>ok({type:r.status?'success':'error',message:r.message}));},get:async(p,ok,fail)=>{try{const id=p.data.device_id;const status=service.getConnectionStatus(id,branch);const raw=service.getQRCode(id,branch);ok({type:'success',data:{status,connected:status==='connected',qr_code:raw?await qrcode.toDataURL(raw):null}});}catch(e){errors.push(e.message);fail?.();}}};
w.eval(fs.readFileSync(path.join(root,'frontend/static/script/js/modules/js/whatsapp.js'),'utf8'));
(async()=>{try{w.PosnicPro.whatsapp.checkStatus();assert.equal(w.PosnicPro.whatsapp.deviceId,'posnic');w.PosnicPro.whatsapp.connect();const until=Date.now()+95000;while(Date.now()<until&&!w.document.querySelector('#whatsapp_qr_code img')){await new Promise(r=>setTimeout(r,500));}assert.ok(w.document.querySelector('#whatsapp_qr_code img'),'QR should reach the settings UI');assert.deepEqual(errors,[]);console.log('PASS: blank first-time settings → Refresh → Connect → actual WhatsApp QR displayed; no Device ID error, no message sent.');}finally{dom.window.close();for(const timer of service.connectionTimers.values())clearTimeout(timer);for(const client of service.clients.values())await client.destroy().catch(()=>{});}})().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
