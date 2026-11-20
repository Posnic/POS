const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function load(relative, processState, overrides = {}) {
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    module, exports:module.exports, process:processState, console,
    __dirname:path.join(__dirname, '../scripts'),
    require:name => overrides[name] || require(name), setTimeout, clearTimeout,
  });
  return module.exports;
}
test('Snap mongod uses its private libraries without changing parent or normal desktop environment', () => {
  for (const [platform, snap] of [['linux','/snap/posnic/x1'], ['linux',null], ['win32',null]]) {
    const env = {LD_LIBRARY_PATH:'/desktop/runtime'};
    if(snap) env.SNAP=snap;
    let spawned;
    const Manager=load('src/mongodb-manager.js',{platform,env}, {
      child_process:{spawn:(exe,args,opts)=>{spawned=opts;return {}; }},
      fs:{existsSync:()=>false}, path:path.posix,
    });
    Manager.prototype._spawnMongod.call({mongoPath:'/snap/posnic/x1/resources/mongodb/bin/mongod',credentialsPath:'/fixture/creds',dataPath:'/fixture/data',logPath:'/fixture/log'});
    assert.equal(spawned.env.LD_LIBRARY_PATH, snap ? '/snap/posnic/x1/resources/mongodb/lib:/desktop/runtime' : '/desktop/runtime');
    assert.equal(env.LD_LIBRARY_PATH,'/desktop/runtime');
  }
});
test('Snap staging fails closed if its container did not supply required libraries', () => {
  const created=[];let args;
  const {stageSnapMongoRuntime}=load('scripts/stage-snap-mongodb-runtime.cjs',{platform:'linux'}, {
    'node:fs':{existsSync:file=>file.endsWith('mongod'),mkdirSync:file=>created.push(file)},
  });
  assert.throws(()=>stageSnapMongoRuntime({electronPlatformName:'linux',targets:[{name:'snap'}],appOutDir:'/fixture/app'},(exe,argv)=>{assert.equal(exe,'docker');args=argv;}),/missing libcurl/);
  assert.ok(args.includes('ubuntu:22.04'));
  assert.ok(args.some(a=>a.includes('target=/input/mongod,readonly')));
  assert.equal(created.length,1);
});
test('non-Snap builds do not require Docker or change runtime files', () => {
  const {stageSnapMongoRuntime}=require('../scripts/stage-snap-mongodb-runtime.cjs');
  for(const context of [{electronPlatformName:'win32',targets:[{name:'nsis'}]}, {electronPlatformName:'linux',targets:[{name:'deb'}]}])
    stageSnapMongoRuntime(context,()=>{throw new Error('unexpected Docker invocation');});
});
