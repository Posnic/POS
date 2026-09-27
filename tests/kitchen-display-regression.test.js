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
