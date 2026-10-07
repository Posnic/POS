const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('frontend/static/script/js/modules/js/restaurant-feedback.js','utf8');
function setup(){const dom=new JSDOM('<div id="kot_v2"><div class="kv2-order"></div></div>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;w.$=require('jquery')(w);let saved,restaurant='enable',reduced=false;w.matchMedia=()=>({matches:reduced,addEventListener(){}});const panel=w.document.querySelector('.kv2-order');panel.getClientRects=()=>[{}];panel.getBoundingClientRect=()=>({top:80,right:900});w.PosnicPro={local:{get:k=>k==='table_options'?restaurant:'branch'},get:(_,done)=>done({type:'success',data:{values:{restaurant_playful_feedback:saved}}})};w.eval(source);return{w,app:w.PosnicPro.restaurantFeedback,config:(s,r='enable',m=false)=>{saved=s;restaurant=r;reduced=m;},close:()=>w.close()};}
test('feedback is off when unset and only enabled for an opted-in restaurant',async()=>{const h=setup();await h.app.load();h.app.play('sent');assert.equal(h.w.document.querySelector('.restaurant-feedback'),null);h.config(true);await h.app.load();h.app.play('sent');assert.ok(h.w.document.querySelector('.kitchen-flight-plane'));assert.ok(h.w.document.querySelector('.kitchen-flight-dish'));const effect=h.w.document.querySelector('.captain-kitchen');assert.equal(parseFloat(effect.style.left)+180,h.w.innerWidth/2);assert.equal(effect.style.top,'auto');assert.ok(effect.style.bottom);h.app.play('payment');assert.equal(h.w.document.querySelectorAll('.restaurant-feedback').length,1);assert.ok(h.w.document.querySelector('.tick-mark'));assert.equal(h.w.document.querySelectorAll('.free-coin').length,0);h.app.clear();h.config(true,'disable');await h.app.load();h.app.play('payment');assert.equal(h.w.document.querySelector('.restaurant-feedback'),null);h.close();});
test('reduced motion suppresses all decorative effects',async()=>{const h=setup();h.config(true,'enable',true);await h.app.load();for(const kind of ['first','add','reduce','sent','payment','cancelled','served'])h.app.play(kind);assert.equal(h.w.document.querySelector('.restaurant-feedback'),null);h.close();});

test('cancelled chef effect is gated and replaced without stacking',async()=>{const h=setup();await h.app.load();h.app.play('cancelled');assert.equal(h.w.document.querySelector('.captain-chef-dismiss'),null);h.config(true);await h.app.load();h.app.play('cancelled');const chef=h.w.document.querySelector('.captain-chef-dismiss');assert.ok(chef.querySelector('.kitchen-chef-person'));assert.equal(chef.getAttribute('aria-hidden'),'true');assert.equal(parseFloat(chef.style.left)+48,h.w.innerWidth/2);h.app.play('cancelled');assert.equal(h.w.document.querySelectorAll('.captain-chef-dismiss').length,1);h.close();});

test('served feedback is a Captain bottom-centre tick and never stacks',async()=>{const h=setup();h.config(true);await h.app.load();h.app.play('served');const smile=h.w.document.querySelector('.captain-confirmation');assert.ok(smile.querySelector('.tick-mark'));assert.equal(parseFloat(smile.style.left)+48,h.w.innerWidth/2);assert.equal(smile.style.top,'auto');h.app.play('served');assert.equal(h.w.document.querySelectorAll('.restaurant-feedback').length,1);h.close();});

test('add and reduce nudge the local total without floating icons', async () => {
 const h=setup();h.config(true);await h.app.load();
 const total=h.w.document.createElement('div');total.className='kv2-round-total';total.innerHTML='<strong>100</strong>';h.w.document.querySelector('.kv2-order').append(total);
 let nudges=0;total.firstChild.animate=()=>nudges++;
 for(const kind of ['first','add','reduce']){h.app.play(kind);assert.equal(h.w.document.querySelector('.restaurant-feedback'),null);}
 assert.equal(nudges,3);h.close();
});
test('Captain busy-floor chef replaces the plane only at 70 percent occupancy',async()=>{
 const h=setup();h.config(true);await h.app.load();
 h.w.PosnicPro.kot_v2={state:{floor:Array.from({length:10},(_,i)=>({tableorder_value:String(i),status:i<7?'occupied':'available'}))}};
 h.app.play('sent');assert.ok(h.w.document.querySelector('.kitchen-chef-runner'));assert.equal(h.w.document.querySelector('.kitchen-flight-plane'),null);
 assert.equal(h.w.document.querySelector('.kitchen-chef-person').textContent,'👨‍🍳');
 h.w.PosnicPro.kot_v2.state.floor[6].status='available';h.app.play('sent');assert.ok(h.w.document.querySelector('.kitchen-flight-plane'));assert.equal(h.w.document.querySelector('.kitchen-chef-runner'),null);h.close();
});
