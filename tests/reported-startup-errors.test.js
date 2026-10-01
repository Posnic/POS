const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const feed=require('../src/kitchen-screen-feed'),screens=require('../src/kitchen-screen');
const {ensureKioskKey}=require('../api/src/middleware/kiosk-key');
test('real HTTP kitchen requests authenticate, reject another key and recover without restarting',async t=>{
 const oldKey=process.env.KIOSK_API_KEY,oldPort=process.env.PORT,original=screens.setTickets;
 const key='isolated-test-installation-key';let expected=key;let shown=0;
 const server=http.createServer((req,res)=>{
   const supplied=req.headers.kioskkey;
   // Run the actual API guard against a separately configured API key.
   process.env.KIOSK_API_KEY=expected;
   const adapter={status(code){res.statusCode=code;return this;},json(body){res.end(JSON.stringify(body));}};
   ensureKioskKey(req,adapter,()=>res.end(JSON.stringify({data:[{id:'sample',items:[]}]})));
   process.env.KIOSK_API_KEY=supplied;
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 process.env.PORT=String(server.address().port);process.env.KIOSK_API_KEY=key;screens.setTickets=()=>{shown++;};
 t.after(async()=>{screens.setTickets=original;if(oldKey===undefined)delete process.env.KIOSK_API_KEY;else process.env.KIOSK_API_KEY=oldKey;if(oldPort===undefined)delete process.env.PORT;else process.env.PORT=oldPort;await new Promise(resolve=>server.close(resolve));});
 assert.equal((await feed.tick({branchId:'test'})).ok,true);
 expected='different-installation';assert.equal((await feed.tick({branchId:'test'})).why,'authentication');assert.equal(shown,1);
 expected=key;assert.equal((await feed.tick({branchId:'test'})).ok,true);assert.equal(shown,2);
});
test('event streams close cleanly without destroying normal requests',()=>{
 const bus=require('../api/src/realtime/event-bus');let ended=0;
 bus.subscribe('shop',{write(){},end(){ended++;}});bus.closeAll();assert.equal(ended,1);assert.equal(bus.subscriberCount('shop'),0);
});
test('infrastructure URLs resolve outside public under root and prefixed deployments',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 for(const name of ['desktop-nudge','analytics-inject','demo-mode','signup-link']){
  const source=fs.readFileSync('frontend/static/script/js/core/'+name+'.js','utf8');
  const expression=source.match(/\.open\('GET', (.+), true\)/)[1];
  for(const base of ['/','/shop/','/api/']){
   const url=vm.runInNewContext(expression,{API_URL:base});
   assert.equal(new URL(url,'https://example.test/public/dashboard.html').pathname,base+'runtime-info');
  }
 }
});
