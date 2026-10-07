const test = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const {guard} = require('../src/ipc-guard');
const feed = require('../src/kitchen-screen-feed');
const screens = require('../src/kitchen-screen');

test('packaged kitchen ready handshake passes the real guard; remote and print pages fail', () => {
 let handler;
 guard({handle: (_, fn) => {handler = fn;}}).handle('kitchen-screen:ready', () => 'ready');
 const url = pathToFileURL(path.resolve(__dirname, '../src/kitchen-screen.html')).href + '?display=12';
 assert.equal(handler({senderFrame: {url}}), 'ready');
 for (const url of ['https://example.com/kitchen-screen.html', 'data:text/html,hello']) {
  assert.throws(() => handler({senderFrame: {url}}), /Refused/);
 }
});

test('screen-only setup discovers branch after startup, receives active orders, and recovers from API failure', async () => {
 const originals = {};
 for (const k of ['displays','configFor','setTickets','setFeedStatus']) originals[k] = screens[k];
 let config = {enabled: true, branchId: ''};
 const delivered = [], statuses = [];
 screens.displays = () => [{id:'wall',open:true,configured:true,config:{...config}}];
 screens.configFor = () => config;
 screens.setTickets = (tickets, id) => delivered.push({tickets,id});
 screens.setFeedStatus = (message,id) => statuses.push({message,id});
 try {
  let branch = '', fail = false, calls = 0;
  const options = {resolveBranch: async () => branch, fetchImpl: async (_, request) => {
   calls++;
   assert.equal(JSON.parse(request.body).branchId, branch);
   if (fail) return {ok:false};
   return {ok:true,json:async()=>({data:[{table:'6',items:[{name:'Soup',qty:2}]}]})};
  }};
  await feed.pollScreens(options);
  assert.equal(calls,0);
  assert.match(statuses.at(-1).message,/Choose an orders branch/);
  branch = 'single-local-branch';
  await feed.pollScreens(options);
  assert.equal(delivered.at(-1).tickets[0].table,'6');
  assert.equal(delivered.at(-1).id,'wall');
  assert.equal(statuses.at(-1).message,'');
  fail = true;
  await feed.pollScreens(options);
  assert.equal(delivered.at(-1).tickets[0].table,'6');
  assert.match(statuses.at(-1).message,/out of date/);
  fail = false;
  await feed.pollScreens(options);
  assert.equal(statuses.at(-1).message,'');
  config = {enabled:true,branchId:'other'};
  branch = 'other';
  await feed.pollScreens(options);
  assert.deepEqual(delivered.at(-2).tickets,[]);
 } finally { Object.assign(screens,originals); }
});

test('a late request cannot populate a screen after its branch changes', async () => {
 let current = true;
 const original = screens.setTickets;
 let sent = false;
 screens.setTickets = () => {sent = true;};
 try {
  const result = await feed.tick({branchId:'old',displayId:'wall',isCurrent:()=>current,
   fetchImpl:async()=>{ current=false;return {ok:true,json:async()=>({data:[{table:'old'}]})}; }});
  assert.equal(result.why,'superseded');
  assert.equal(sent,false);
 } finally {screens.setTickets=original;}
});

test('old active tickets keep full brightness and bold dish names', () => {
 const {JSDOM} = require('jsdom');
 const fs = require('node:fs');
 const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'), {runScripts:'dangerously'});
 try {
  dom.window.kitchenScreen.setConfig({greyAfterMin:45,_fit:{fontPx:40,lineHeightPx:50,columns:2,cards:4}});
  dom.window.kitchenScreen.setTickets([{table:'T1',placedAt:new Date(Date.now()-120*60000).toISOString(),items:[{qty:1,name:'Soup'}]}]);
  const ticket=dom.window.document.querySelector('.ticket.urgent');
  assert.ok(ticket);
  assert.notEqual(dom.window.getComputedStyle(ticket).opacity,'0.45');
  assert.equal(dom.window.getComputedStyle(ticket.querySelector('.name')).fontWeight,'700');
 } finally {dom.window.close();}
});

test('delay thresholds escalate permanently and empty-state CSS stays hidden with orders', () => {
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try {
  dom.window.kitchenScreen.setConfig({_fit:{fontPx:40,columns:2,cards:6},pulseAlerts:false});
  for(const [mins,state] of [[0,'calm'],[5,'warm'],[10,'late'],[15,'urgent'],[1500,'urgent']]){
   dom.window.kitchenScreen.setTickets([{table:'T1',placedAt:new Date(Date.now()-mins*60000).toISOString(),items:[{name:'Soup',qty:1}]}]);
   assert.ok(dom.window.document.querySelector('.ticket.'+state));
   assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById('empty')).display,'none');
   assert.equal(dom.window.document.querySelector('.delay-label.pulse'),null);
  }
  dom.window.kitchenScreen.setTickets([]);
  assert.equal(dom.window.document.getElementById('empty').hidden,false);
  assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById('board')).display,'none');
 }finally{dom.window.close();}
});

test('table-only board groups tables by oldest order and never renders dishes or order numbers',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{
  dom.window.kitchenScreen.setConfig({tableOnly:true,_fit:{fontPx:40,columns:4,cards:8}});
  dom.window.kitchenScreen.setTickets([{table:'T1',placedAt:new Date(Date.now()-20*60000).toISOString(),items:[{name:'Secret dish'}]}, {table:'T1',placedAt:new Date().toISOString(),items:[]},{table:'T2',placedAt:new Date().toISOString(),items:[]}]);
  assert.equal(dom.window.document.querySelectorAll('.table-only').length,2);
  assert.equal(dom.window.document.querySelectorAll('.table-icon').length,2);
  assert.ok(dom.window.document.querySelector('.table-only.urgent'));
  assert.ok(dom.window.document.querySelector('.table-only.calm'));
  assert.equal(dom.window.document.querySelector('.items'),null);
  assert.equal(dom.window.document.querySelector('.age'),null);
  assert.equal(dom.window.document.querySelector('#board').textContent,'T1T2');
 }finally{dom.window.close();}
});

test('table grid uses both dimensions for landscape and portrait without shrinking to fit every table',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{
  const board=dom.window.document.getElementById('board');let width=1400,height=650;
  Object.defineProperty(board,'clientWidth',{get:()=>width});Object.defineProperty(board,'clientHeight',{get:()=>height});
  dom.window.kitchenScreen.setConfig({tableOnly:true,_fit:{fontPx:40,columns:2,cards:4}});
  dom.window.kitchenScreen.setTickets(Array.from({length:6},(_,i)=>({table:'T'+i,placedAt:new Date().toISOString(),items:[]})));
  assert.equal(board.style.getPropertyValue('--columns'),'3');
  assert.equal(board.querySelectorAll('.table-only').length,6);
  width=650;height=1400;dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(board.style.getPropertyValue('--columns'),'2');
  assert.equal(board.querySelectorAll('.table-only').length,6);
  dom.window.kitchenScreen.setTickets(Array.from({length:40},(_,i)=>({table:'T'+i,placedAt:new Date().toISOString(),items:[]})));
  assert.ok(board.querySelectorAll('.table-only').length<40);
  assert.match(dom.window.document.getElementById('pager').textContent,/of/);
 }finally{dom.window.close();}
});

test('tall detailed board uses available rows instead of a fixed four-card limit',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{
  const board=dom.window.document.getElementById('board');
  Object.defineProperty(board,'clientWidth',{value:1000});Object.defineProperty(board,'clientHeight',{value:1600});
  dom.window.kitchenScreen.setConfig({tableOnly:false,_fit:{fontPx:40,columns:2,cards:4}});
  dom.window.kitchenScreen.setTickets(Array.from({length:5},(_,i)=>({table:'T'+i,placedAt:new Date().toISOString(),items:[{name:'Soup',qty:1}]})));
  assert.equal(board.querySelectorAll('.ticket').length,5);
  assert.equal(dom.window.document.getElementById('pager').textContent,'');
 }finally{dom.window.close();}
});

test('arrival is AM/PM time only, unassigned table is blank, and lateness has no text badge',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{
  dom.window.kitchenScreen.setConfig({tableOnly:false,_fit:{fontPx:40,columns:2,cards:4}});
  dom.window.kitchenScreen.setTickets([{orderNumber:'SALE-123',placedAt:new Date(Date.now()-86400000).toISOString(),items:[{name:'Soup',qty:1}]}]);
  const card=dom.window.document.querySelector('.ticket');
  assert.match(card.querySelector('.arrival').textContent,/^\d{1,2}:\d{2} (AM|PM)$/);
  assert.equal(card.querySelector('.table'),null);
  assert.equal(card.querySelector('.delay-label'),null);
  assert.ok(!card.textContent.includes('No table'));
  assert.ok(!card.textContent.includes('SALE-123'));
  assert.ok(card.classList.contains('urgent'));
 }finally{dom.window.close();}
});

test('portrait column and font choices survive resize while dishes remain visible', () => {
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try {
  const w=dom.window, board=w.document.getElementById('board');
  w.innerWidth=1080; w.innerHeight=1920;
  Object.defineProperty(board,'clientWidth',{get:()=>w.innerWidth-64});
  Object.defineProperty(board,'clientHeight',{get:()=>w.innerHeight-180});
  const cfg={portraitColumns:2,fontSizePx:52,textGlow:true,_fit:{fontPx:40,columns:4,cards:8}};
  w.kitchenScreen.setConfig(cfg);
  w.kitchenScreen.setTickets([{table:'12',placedAt:new Date().toISOString(),items:[{name:'Grilled fish with lemon butter sauce',qty:2}]}]);
  assert.equal(board.style.getPropertyValue('--columns'),'2');
  assert.equal(w.document.documentElement.style.getPropertyValue('--font'),'52px');
  assert.equal(w.document.documentElement.getAttribute('data-glow'),'true');
  assert.equal(board.querySelector('.name').textContent,'Grilled fish with lemon butter sauce');
  w.kitchenScreen.setConfig({...cfg,portraitColumns:1});
  assert.equal(board.style.getPropertyValue('--columns'),'1');
  w.innerWidth=1920; w.innerHeight=1080; w.dispatchEvent(new w.Event('resize'));
  assert.equal(board.style.getPropertyValue('--columns'),'1', 'a single order uses the available width');
  w.kitchenScreen.setConfig({...cfg,fontSizePx:1000,textGlow:false});
  assert.equal(w.document.documentElement.style.getPropertyValue('--font'),'96px');
  assert.equal(w.document.documentElement.getAttribute('data-glow'),'false');
 } finally {dom.window.close();}
});

test('page rotation applies saved timing, replaces old timers and survives repeated config delivery', () => {
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const intervals=new Map(); let nextId=0;
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{
  runScripts:'dangerously',beforeParse(w){
   w.setInterval=(fn,ms)=>{const id=++nextId;intervals.set(id,{fn,ms});return id;};
   w.clearInterval=id=>intervals.delete(id);
  }
 });
 try {
  const w=dom.window, board=w.document.getElementById('board');
  Object.defineProperty(board,'clientWidth',{value:450});
  Object.defineProperty(board,'clientHeight',{value:400});
  const cfg={pageDwellSeconds:3,_fit:{fontPx:40,columns:1,cards:1}};
  w.kitchenScreen.setConfig(cfg);
  w.kitchenScreen.setTickets([{table:'1',items:[{name:'Soup'}]},{table:'2',items:[{name:'Rice'}]}]);
  assert.equal(w.document.getElementById('pager').textContent,'1 of 2');
  const first=[...intervals].find(([,v])=>v.ms===3000);
  assert.ok(first);
  first[1].fn();
  assert.equal(w.document.getElementById('pager').textContent,'2 of 2');
  w.kitchenScreen.setConfig(cfg);
  assert.ok(intervals.has(first[0]),'unchanged config must not delay rotation');
  w.kitchenScreen.setConfig({...cfg,pageDwellSeconds:20});
  assert.equal(intervals.has(first[0]),false);
  const second=[...intervals.values()].find(v=>v.ms===20000);
  assert.ok(second);
  second.fn();
  assert.equal(w.document.getElementById('pager').textContent,'1 of 2');
 } finally {dom.window.close();}
});

test('arrival sorting defaults to oldest, applies before pagination and keeps unknown times last', () => {
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try {
  const w=dom.window, board=w.document.getElementById('board');
  Object.defineProperty(board,'clientWidth',{value:450});
  Object.defineProperty(board,'clientHeight',{value:400});
  const cfg={_fit:{fontPx:40,columns:1,cards:1}};
  w.kitchenScreen.setConfig(cfg);
  w.kitchenScreen.setTickets([
   {table:'Unknown',items:[]},
   {table:'New',placedAt:'2026-09-30T10:00:00Z',items:[]},
   {table:'Old',placedAt:'2026-09-30T09:00:00Z',items:[]}
  ]);
  assert.equal(board.querySelector('.table').textContent,'Old');
  assert.equal(w.document.getElementById('pager').textContent,'1 of 3');
  w.kitchenScreen.setConfig({...cfg,orderSort:'newest'});
  assert.equal(board.querySelector('.table').textContent,'New');
  w.kitchenScreen.setConfig({...cfg,orderSort:'oldest'});
  assert.equal(board.querySelector('.table').textContent,'Old');
 } finally {dom.window.close();}
});

test('cancellation expires on schedule, does not restart on polls, and keeps active quantities', () => {
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 let now=Date.now();const timers=[];
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{
  runScripts:'dangerously',beforeParse(w){w.Date.now=()=>now;w.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length;};w.clearInterval=()=>{};}
 });
 try {
  const w=dom.window,board=w.document.getElementById('board');
  Object.defineProperty(board,'clientWidth',{value:1200});Object.defineProperty(board,'clientHeight',{value:1600});
  const cfg={cancelledDisplaySeconds:3,cancelledPulse:true,_fit:{fontPx:40,columns:2}};
  w.kitchenScreen.setConfig(cfg);
  const list=[{id:'active',table:'T1',items:[{qty:1,name:'Fish'}]}, {id:'cancel',cancelled:true,table:'T1',items:[{qty:2,name:'Fish'}]}];
  w.kitchenScreen.setTickets(list);
  assert.match(board.querySelector('.cancelled-section').textContent,/CANCELLED.*2 - Fish/);
  assert.equal(board.querySelectorAll('.ticket').length,1);
  assert.ok(board.querySelector('.cancel-pulse'));
  assert.match(board.querySelector('.ticket:not(.cancelled)').textContent,/1 - Fish/);
  assert.equal(w.document.getElementById('count').textContent,'1');
  now+=2000;w.kitchenScreen.setTickets(list);
  now+=1100;timers.find(t=>t.ms===250).fn();
  assert.equal(board.querySelector('.cancelled-section'),null);
  w.kitchenScreen.setTickets(list);
  assert.equal(board.querySelector('.cancelled'),null);
  w.kitchenScreen.setTickets([]);
  assert.equal(board.querySelector('.cancelled'),null,'served/removed is not a cancellation');
  w.kitchenScreen.setConfig({...cfg,cancelledPulse:false});
  w.kitchenScreen.setTickets([{...list[1],id:'another-cancel'}]);
  assert.ok(board.querySelector('.cancelled'));
  assert.equal(board.querySelector('.cancel-pulse'),null);
 } finally {dom.window.close();}
});

test('ready and picked-up food use explicit labels without cancellation strike-through or overdue pulses', () => {
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try {
  const w=dom.window,board=w.document.getElementById('board');
  w.kitchenScreen.setConfig({_fit:{fontPx:40,columns:2},pulseAlerts:true});
  const ticket={id:'one',table:'4',placedAt:new Date(Date.now()-3600000).toISOString(),items:[
   {name:'Fish',qty:3,preparing:1,readyToCollect:1,pickedUp:1,started:true}
  ]};
  w.kitchenScreen.setTickets([ticket]);
  assert.equal(board.querySelector('.name .progress-cooking').getAttribute('aria-label'),'1 Cooking');
  assert.equal(board.querySelector('.name .progress-ready').getAttribute('aria-label'),'1 Ready to collect');
  assert.equal(board.querySelector('.name .progress-picked').getAttribute('aria-label'),'1 Collected, not yet served');
  assert.equal(board.querySelector('.items > .item-progress'),null);
  assert.equal(w.document.getElementById('status-key').hidden,false);
  assert.equal(board.querySelector('.cancelled'),null);
  w.kitchenScreen.setTickets([{...ticket,items:[{name:'Fish',qty:1,preparing:0,readyToCollect:1,pickedUp:0}]}]);
  assert.ok(board.querySelector('.ready-state .line-ready'));
  assert.equal(board.querySelector('.urgent'),null);
  w.kitchenScreen.setTickets([]);
  assert.equal(board.querySelector('.ticket'),null);
 } finally {dom.window.close();}
});

test('one table has one box across rounds, all dishes and cancellations; untabled orders remain separate',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{
  const w=dom.window,board=w.document.getElementById('board');
  Object.defineProperty(board,'clientWidth',{value:2400});Object.defineProperty(board,'clientHeight',{value:4000});
  w.kitchenScreen.setConfig({maxItemsPerCard:3,_fit:{fontPx:32,columns:4}});
  w.kitchenScreen.setTickets([
   {id:'sale1:c0',table:'7',items:Array.from({length:8},(_,i)=>({name:'Dish '+i,qty:1}))},
   {id:'sale1:c1',table:'7',items:[{name:'Added fish',qty:2,note:'No salt',priced_at_table:500}]},
   {id:'sale1:cancel2',table:'7',cancelled:true,items:[{name:'Cancelled tea',qty:1}]},
   {id:'takeaway1:c0',table:'',items:[{name:'Parcel one',qty:1}]},
   {id:'takeaway1:c1',table:'',items:[{name:'Parcel extra',qty:1}]},
   {id:'takeaway2:c0',table:'',items:[{name:'Parcel two',qty:1}]}
  ]);
  assert.equal(board.querySelectorAll('.ticket').length,3);
  const table=board.querySelector('.table').closest('.ticket');
  assert.equal(table.querySelectorAll('.name').length,10);
  assert.equal(table.querySelector('.table').textContent,'T - 7');
  assert.match(table.querySelector('.ticket-body').textContent,/2 - Added fish \(500 each\)/);
  assert.ok(table.querySelector('.ticket-meta > .top .table'),'table heading belongs above the dishes');
  assert.ok(table.querySelector('.ticket-body > .items'),'full dish list follows the heading');
  assert.equal(table.querySelector('.ticket-meta .items'),null);
  assert.match(table.textContent,/Dish 7/);
  assert.match(table.textContent,/Added fish/);
  assert.match(table.textContent,/No salt/);
  assert.match(table.querySelector('.cancelled-section').textContent,/Cancelled tea/);
  assert.equal(board.querySelectorAll('.table').length,1);
 }finally{dom.window.close();}
});


test('visible dish setting limits the list height without splitting or dropping items',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{
  const w=dom.window,board=w.document.getElementById('board');
  w.kitchenScreen.setConfig({visibleDishesPerBox:3,fontSizePx:32});
  w.kitchenScreen.setTickets([{id:'large:c0',table:'9',items:Array.from({length:12},(_,i)=>({name:'Dish '+i,qty:1}))}]);
  assert.equal(board.querySelectorAll('.ticket').length,1);
  assert.equal(board.querySelectorAll('.name').length,12);
  assert.equal(board.querySelector('.items').style.maxHeight,'192px');
  w.kitchenScreen.setConfig({visibleDishesPerBox:6,fontSizePx:32});
  assert.equal(board.querySelector('.items').style.maxHeight,'384px');
  assert.equal(board.querySelectorAll('.name').length,12);
  w.kitchenScreen.setConfig({visibleDishesPerBox:0,fontSizePx:32});
  assert.equal(board.querySelector('.items').style.maxHeight,'');
 }finally{dom.window.close();}
});

test('view-only display shows the staff who ordered each grouped table without interpreting names as HTML',()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/kitchen-screen.html'),'utf8'),{runScripts:'dangerously'});
 try{dom.window.kitchenScreen.setTickets([{id:'a:c0',table:'12',ownerName:'Arun <img>',placedAt:new Date().toISOString(),items:[{name:'Rice',qty:1}]},{id:'a:c1',table:'12',ownerName:'Priya',placedAt:new Date().toISOString(),items:[{name:'Tea',qty:1}]}]);assert.match(dom.window.document.querySelector('.ordered-by').textContent,/Arun <img> · Priya/);assert.equal(dom.window.document.querySelector('.ordered-by img'),null);}finally{dom.window.close();}
});
