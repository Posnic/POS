'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {smokeExecutable} = require('./smoke-packaged-app.cjs');
const run = (exe,args,options={}) => execFileSync(exe,args,{stdio:'pipe',timeout:180000,windowsHide:true,...options});
function expectedNames(platform, arch, version) {
  if (platform === 'win32') return ['installer','portable'].map(kind=>`Posnic-${version}-windows-x64-${kind}.exe`);
  if (platform === 'darwin') return ['dmg','zip'].map(ext=>`Posnic-${version}-macos-${arch}.${ext}`);
  if (platform === 'linux') return [`Posnic-${version}-linux-x86_64.AppImage`,`posnic_${version}_amd64.deb`,`posnic_${version}_amd64.snap`];
  throw new Error('Unsupported native platform');
}
function findApp(root) {
  const apps=fs.readdirSync(root).filter(n=>n.endsWith('.app'));
  if (apps.length!==1) throw new Error('Expected exactly one app bundle');
  return path.join(root,apps[0]);
}
function stopInstallerAutoLaunch(executable) {
  const target=fs.realpathSync.native(executable).toLowerCase();
  const raw=run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "@(Get-CimInstance Win32_Process -Filter \"Name = 'Posnic.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress"],{encoding:'utf8'});
  const processes=raw.trim()?JSON.parse(raw):[];
  for(const item of Array.isArray(processes)?processes:[processes]) {
    if(!item.ExecutablePath) continue;
    let candidate;try {candidate=fs.realpathSync.native(item.ExecutablePath).toLowerCase();}catch{continue;}
    if(candidate===target) {try {run('taskkill',['/pid',String(item.ProcessId),'/T','/F']);}catch{}}
  }
}
async function checkArtifact(artifact) {
  // Installers may register file associations and services. Only disposable
  // hosted CI runners are allowed; never install over a developer's shop.
  if (process.env.GITHUB_ACTIONS!=='true' || process.env.RUNNER_ENVIRONMENT!=='github-hosted') throw new Error('Package installation checks require a disposable GitHub-hosted runner');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'posnic-native-package-'));
  let mount, snapInstalled=false, snapProfile;
  try {
    let executable, args=[];
    if (artifact.endsWith('-installer.exe')) {
      const destination=path.join(root,'installed');
      run(artifact,['/S','/D='+destination],{stdio:'ignore',env:{...process.env,POSNIC_USER_DATA:path.join(root,'installer-startup')}});
      executable=path.join(destination,'Posnic.exe');
      if (!fs.existsSync(executable)) throw new Error('Installer did not create Posnic.exe');
      // The production silent-update installer deliberately auto-launches.
      // Stop that exact disposable installation before the instrumented launch.
      stopInstallerAutoLaunch(executable);
    } else if (artifact.endsWith('-portable.exe')) {
      executable=artifact;
    } else if (artifact.endsWith('.dmg')) {
      mount=path.join(root,'mount');fs.mkdirSync(mount);
      run('hdiutil',['attach',artifact,'-nobrowse','-readonly','-mountpoint',mount]);
      const bundle=findApp(mount);
      const dest=path.join(root,path.basename(bundle));run('ditto',[bundle,dest]);
      executable=path.join(dest,'Contents/MacOS/Posnic');
    } else if (artifact.endsWith('.zip')) {
      run('ditto',['-x','-k',artifact,root]);
      executable=path.join(findApp(root),'Contents/MacOS/Posnic');
    } else if (artifact.endsWith('.AppImage')) {
      fs.chmodSync(artifact,0o755);run(artifact,['--appimage-extract'],{cwd:root});
      executable=path.join(root,'squashfs-root/posnic');
    } else if (artifact.endsWith('.deb')) {
      run('sudo',['apt-get','install','-y',artifact]);
      const files=run('dpkg',['-L','posnic'],{encoding:'utf8'}).split(/\r?\n/);
      executable=files.find(f=>/\/posnic$/.test(f)&&f.startsWith('/opt/'));
      if (!executable) throw new Error('Installed DEB executable not found');
    } else if (artifact.endsWith('.snap')) {
      run('sudo',['snap','install','--dangerous',artifact]);snapInstalled=true;
      // Strict confinement cannot access /tmp profiles. Keep this disposable
      // profile inside the installed snap's permitted common directory.
      const common=path.join(os.homedir(),'snap/posnic/common');fs.mkdirSync(common,{recursive:true});
      snapProfile=fs.mkdtempSync(path.join(common,'package-test-'));
      executable='/usr/bin/snap';args=['run','posnic'];
    } else throw new Error('Unsupported artifact '+artifact);
    await smokeExecutable(executable,snapProfile||root,args);
    return {name:path.basename(artifact),sha256:crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),passed:true};
  } finally {
    if (mount) { try {run('hdiutil',['detach',mount]);}catch{} }
    if (snapInstalled) {try {run('sudo',['snap','remove','--purge','posnic']);}catch{}}
    if (snapProfile) fs.rmSync(snapProfile,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:1000});
  }
}
async function main() {
  const directory=path.resolve(process.argv[2]||'dist');
  const version=process.env.RELEASE_TAG ? process.env.RELEASE_TAG.replace(/^v/,'') : require('../package.json').version;
  const artifacts=expectedNames(process.platform,process.arch,version);
  // Fail before running anything when a required format is absent.
  for(const name of artifacts) if(!fs.existsSync(path.join(directory,name))) throw new Error('Missing required package: '+name);
  const results=[];
  for(const name of artifacts) results.push(await checkArtifact(path.join(directory,name)));
  const report={schema:1,runId:process.env.GITHUB_RUN_ID,platform:process.platform,arch:process.arch,version,commit:process.env.RELEASE_COMMIT||process.env.GITHUB_SHA,results};
  fs.writeFileSync(path.join(directory,`PACKAGE-CHECK-${process.platform}-${process.arch}.json`),JSON.stringify(report,null,2)+'\n');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={expectedNames};
