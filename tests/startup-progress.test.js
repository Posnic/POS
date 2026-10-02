const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createStartupProgress}=require('../src/startup-progress');
test('the desktop package includes its startup progress helper',()=>{
 assert.ok(require('../package.json').build.files.includes('src/startup-progress.js'));
});
test('loading progress coalesces to one listener and the latest message',()=>{
 const contents=new EventEmitter(),calls=[];
 contents.isDestroyed=()=>false;contents.isLoadingMainFrame=()=>true;
 contents.executeJavaScript=code=>{calls.push(code);return Promise.resolve();};
 const update=createStartupProgress();
 for(let i=0;i<100;i++)update(contents,['api','Loading','',i]);
 assert.equal(contents.listenerCount('did-stop-loading'),1);
 assert.equal(calls.length,0);
 contents.emit('did-stop-loading');
 assert.equal(calls.length,1);assert.match(calls[0],/,99\)/);
 assert.equal(contents.listenerCount('destroyed'),0);
});
test('destroyed windows release queued progress without running scripts',()=>{
 const contents=new EventEmitter();contents.isDestroyed=()=>false;contents.isLoadingMainFrame=()=>true;
 contents.executeJavaScript=()=>{throw Error('Destroyed window executed script');};
 createStartupProgress()(contents,['api','Loading','',1]);contents.emit('destroyed');
 assert.equal(contents.listenerCount('did-stop-loading'),0);
});
