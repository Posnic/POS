'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateEvidence,platforms}=require('../scripts/check-release-package-evidence.cjs');
const {expectedNames}=require('../scripts/check-distribution-packages.cjs');
function fixture(){
 const version='1.9.3',commit='a'.repeat(40),assets=[];
 const reports=platforms.map(([platform,arch])=>({schema:1,platform,arch,version,commit,runId:'123',results:expectedNames(platform,arch,version).map(name=>{
  assets.push({name,digest:'sha256:'+'b'.repeat(64)});
  return {name,sha256:'b'.repeat(64),passed:true};
 })}));return {reports,assets,version,commit};
}
const check=f=>validateEvidence(f.reports,f.assets,f.version,f.commit);
test('all nine formats across four native platform/architecture pairs are required',()=>{const f=fixture();assert.equal(f.assets.length,9);check(f);});
for(const [label,mutate] of [
 ['absent platform',f=>f.reports.pop()],
 ['missing portable EXE',f=>f.reports[0].results.pop()],
 ['different source',f=>f.reports[0].commit='c'.repeat(40)],
 ['different version',f=>f.reports[0].version='1.9.2'],
 ['failed startup',f=>f.reports[0].results[0].passed=false],
 ['changed signed bytes',f=>f.assets[0].digest='sha256:'+'d'.repeat(64)],
 ['missing release asset',f=>f.assets.pop()],
 ['missing digest',f=>delete f.assets[0].digest],
 ['missing CI provenance',f=>delete f.reports[0].runId]
])test('publication rejects '+label,()=>{const f=fixture();mutate(f);assert.throws(()=>check(f));});
