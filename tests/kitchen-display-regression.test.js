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
