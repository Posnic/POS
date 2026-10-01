'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const feed=require('../src/kitchen-screen-feed'),screens=require('../src/kitchen-screen');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('served notification immediately refreshes the wall and ignores another branch',async t=>{
 const original=screens.setTickets,received=[];screens.setTickets=tickets=>received.push(tickets);
 t.after(()=>{feed.stop();screens.setTickets=original;});
 let served=false,calls=0;
 feed.start({branchId:'kitchen',everyMs:60000,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({data:served?[]:[{table:'6'}]})};}});
 await flush();assert.equal(received.at(-1)[0].table,'6');
 process.emit('posnic:kitchen-served',{branchId:'other'});await flush();assert.equal(calls,1);
 served=true;process.emit('posnic:kitchen-served',{branchId:'kitchen'});await flush();
 assert.equal(calls,2);assert.deepEqual(received.at(-1),[]);
});
test('notification during a slow poll discards old results and coalesces a fresh read',async t=>{
 const original=screens.setTickets,received=[];screens.setTickets=tickets=>received.push(tickets);
 t.after(()=>{feed.stop();screens.setTickets=original;});
 let finish,calls=0;
 feed.start({branchId:'kitchen',everyMs:60000,fetchImpl:async()=>{
  calls++;if(calls===1)return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({data:[{table:'stale'}]})});});
  return {ok:true,json:async()=>({data:[]})};
 }});
 process.emit('posnic:kitchen-served',{branchId:'kitchen'});
 process.emit('posnic:kitchen-served',{branchId:'kitchen'});
 assert.equal(calls,1);finish();await flush();await flush();
 assert.equal(calls,2);assert.deepEqual(received,[[]]);
 const listeners=process.listenerCount('posnic:kitchen-served');feed.stop();assert.equal(process.listenerCount('posnic:kitchen-served'),listeners-1);
 process.emit('posnic:kitchen-served',{branchId:'kitchen'});await flush();assert.equal(calls,2);
});

test('manual refresh discards the old poll and completes only after the fresh orders arrive', async t => {
 const original=screens.setTickets, received=[]; screens.setTickets=tickets=>received.push(tickets);
 t.after(()=>{feed.stop();screens.setTickets=original;});
 let finish,calls=0;
 feed.start({branchId:'kitchen',everyMs:60000,fetchImpl:async()=>{
  calls++; if(calls===1) return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({data:[{table:'stale'}]})});});
  return {ok:true,json:async()=>({data:[]})};
 }});
 const first=feed.refresh(), second=feed.refresh();
 assert.equal(calls,1); finish();
 assert.equal((await first).ok,true); assert.equal((await second).ok,true);
 assert.equal(calls,2); assert.deepEqual(received,[[]]);
});
test('failed manual refresh preserves orders and reports failure', async t => {
 const original=screens.setTickets, received=[]; screens.setTickets=tickets=>received.push(tickets);
 t.after(()=>{feed.stop();screens.setTickets=original;});
 let fail=false;
 feed.start({branchId:'kitchen',everyMs:60000,fetchImpl:async()=>{
  if(fail) throw Error('offline'); return {ok:true,json:async()=>({data:[{table:'6'}]})};
 }});
 await flush(); fail=true;
 assert.equal((await feed.refresh()).ok,false);
 assert.equal(received.at(-1)[0].table,'6');
});
test('stopping the feed resolves a waiting manual refresh', async t => {
 let finish;
 feed.start({branchId:'kitchen',everyMs:60000,fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
 t.after(()=>feed.stop());
 const refreshed=feed.refresh(); feed.stop();
 assert.equal((await refreshed).ok,false);
 finish({ok:true,json:async()=>({data:[]})}); await flush();
 assert.equal((await feed.refresh()).ok,false);
});
