'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {expectedNames}=require('./check-distribution-packages.cjs');
const platforms=[['win32','x64'],['darwin','x64'],['darwin','arm64'],['linux','x64']];
function validateEvidence(reports, assets, version, commit) {
  const allowed = new Set(platforms.flatMap(([platform,arch])=>expectedNames(platform,arch,version)));
  for (const asset of assets) {
    if (/\.(exe|dmg|zip|AppImage|deb|snap)$/.test(asset.name) && asset.name !== 'posnic-assets.zip') {
      assert.ok(allowed.has(asset.name), 'Unverified extra release package: ' + asset.name);
    }
  }
  for (const [platform,arch] of platforms) {
    const report=reports.find(r=>r.platform===platform && r.arch===arch);
    assert.ok(report, `Missing startup evidence for ${platform}/${arch}`);
    assert.equal(report.schema,1);
    assert.equal(report.version,version,'Evidence version differs');
    assert.equal(report.commit,commit,'Evidence source differs');
    assert.match(report.runId||'',/^\d+$/,'Evidence must identify its CI run');
    for(const name of expectedNames(platform,arch,version)) {
      const result=report.results.find(r=>r.name===name);
      assert.equal(result?.passed,true,`Package did not pass native startup: ${name}`);
      if(platform==='darwin') {
        assert.equal(result.canvas?.passed,true,`Packaged canvas did not render: ${name}`);
        assert.equal(result.canvas.arch,arch,`Packaged canvas architecture differs: ${name}`);
      }
      const asset=assets.find(a=>a.name===name);
      assert.ok(asset,`Missing release package: ${name}`);
      assert.match(result.sha256||'',/^[a-f0-9]{64}$/);
      assert.equal(asset.digest,'sha256:'+result.sha256,`Package changed after native verification: ${name}`);
    }
  }
}
function main() {
  const tag=process.argv[2];assert.match(tag||'',/^v\d+\.\d+\.\d+$/);
  const gh=args=>execFileSync('gh',args,{encoding:'utf8',windowsHide:true});
  const release=JSON.parse(gh(['api',`repos/Posnic/POS/releases/tags/${tag}`]));
  const commit=JSON.parse(gh(['api',`repos/Posnic/POS/commits/${tag}`])).sha;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'posnic-release-evidence-'));
  try {
    const reports=[];
    for(const [platform,arch] of platforms) {
      const name=`PACKAGE-CHECK-${platform}-${arch}.json`;
      gh(['release','download',tag,'--repo','Posnic/POS','--pattern',name,'--dir',root]);
      const report=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
      assert.match(report.runId||'',/^\d+$/);
      const run=JSON.parse(gh(['api',`repos/Posnic/POS/actions/runs/${report.runId}`]));
      assert.equal(run.conclusion,'success','Native verification workflow must succeed');
      assert.ok(['.github/workflows/release.yml','.github/workflows/windows-release-verify.yml'].includes(run.path),'Evidence must come from release verification, not unsigned PR packages');
      reports.push(report);
    }
    validateEvidence(reports,release.assets,tag.slice(1),commit);
    console.log('All nine distribution packages have successful native startup evidence matching their exact release bytes and source.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module)main();
module.exports={validateEvidence,platforms};
