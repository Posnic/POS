'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const yaml=require('js-yaml');
const workflow=yaml.load(fs.readFileSync(path.join(__dirname,'../.github/workflows/release.yml'),'utf8'));
const steps=workflow.jobs.build.steps;
const step=steps.find(s=>s.name==='Prepare both Mac extractor architectures');

test('cross-architecture extractor permissions are prepared before packaging and signing',()=>{
  assert.equal(step.if,"matrix.name == 'macOS'");
  assert.ok(steps.indexOf(step)<steps.findIndex(s=>s.name==='Build'));
  const verify=steps.find(s=>s.name==='Verify macOS signature and notarization').run;
  assert.match(verify,/for APP in dist\/mac\*\/\*\.app/);
  assert.match(verify,/test -x "\$APP\/Contents\/Resources\/tools\/7za"/);
});

function fixture(t,architectures){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'posnic-extractor-mode-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const arch of architectures){
    const file=path.join(root,'node_modules/7zip-bin/mac',arch,'7za');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,'#!/bin/sh\nexit 0\n');fs.chmodSync(file,0o644);
  }
  return root;
}

test('a non-executable foreign-architecture extractor becomes runnable before packaging',{skip:process.platform==='win32'},t=>{
  const root=fixture(t,['x64','arm64']);
  const run=spawnSync('bash',['-c',step.run],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  for(const arch of ['x64','arm64']){
    const file=path.join(root,'node_modules/7zip-bin/mac',arch,'7za');
    assert.equal(fs.statSync(file).mode&0o777,0o755);
    assert.equal(spawnSync(file,[],{encoding:'utf8'}).status,0);
  }
});

test('a missing foreign-architecture extractor aborts before the build',{skip:process.platform==='win32'},t=>{
  const root=fixture(t,['arm64']);
  const run=spawnSync('bash',['-c',step.run],{cwd:root,encoding:'utf8'});
  assert.notEqual(run.status,0);
});
