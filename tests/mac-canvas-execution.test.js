'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {checkMacCanvas} = require('../scripts/check-mac-canvas.cjs');

function fixture(t, pixel = [18,52,86,255]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-probe-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const executable = path.join(root, 'Posnic.app/Contents/MacOS/Posnic');
  const archive = path.join(root, 'Posnic.app/Contents/Resources/api/node_modules.zip');
  fs.mkdirSync(path.dirname(archive), {recursive:true});
  fs.writeFileSync(archive, 'archive fixture');
  const run = (command, args, options) => {
    if (command === '/usr/bin/ditto') {
      assert.equal(args[2], archive);
      const target = path.join(args[3], '@napi-rs/canvas');
      fs.mkdirSync(target, {recursive:true});
      const binding = path.join(args[3], '@napi-rs/canvas-test-binding');
      fs.mkdirSync(binding, {recursive:true});
      fs.writeFileSync(path.join(target, 'index.js'), "module.exports = require('@napi-rs/canvas-test-binding');");
      fs.writeFileSync(path.join(binding, 'index.js'), `exports.createCanvas = () => ({
        getContext: () => ({fillRect(){}, getImageData:()=>({data:${JSON.stringify(pixel)}})}),
        toBuffer: () => Buffer.from('89504e470d0a1a0a','hex')
      });`);
      return;
    }
    assert.equal(command, executable, 'must use packaged Electron, not runner Node');
    assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
    return execFileSync(process.execPath, args, {...options,env:{...process.env}});
  };
  return {root, executable, archive, run};
}
test('packaged canvas probe extracts the actual API archive and renders through packaged Electron', t => {
  const f = fixture(t);
  assert.deepEqual(checkMacCanvas(f.executable, f.root, f.run), {arch:process.arch, passed:true});
});
test('a canvas that loads but renders incorrect pixels fails the native package gate', t => {
  const f = fixture(t, [0,0,0,0]);
  assert.throws(() => checkMacCanvas(f.executable, f.root, f.run));
});
test('missing packaged API archive fails before launching a probe', t => {
  const f = fixture(t);
  fs.unlinkSync(f.archive);
  assert.throws(() => checkMacCanvas(f.executable, f.root, ()=>assert.fail('must not launch')), /archive missing/);
});
test('wrong-architecture execution evidence is rejected', t => {
  const f = fixture(t);
  const run = (command,args,options) => command === f.executable
    ? JSON.stringify({arch:process.arch === 'x64' ? 'arm64' : 'x64',passed:true})
    : f.run(command,args,options);
  assert.throws(() => checkMacCanvas(f.executable,f.root,run), /architecture/);
});
