'use strict';
// Locked electron-builder template Snap builds generate a launcher referring
// to three scripts, but only non-template builds stage those scripts.
const fs=require('node:fs');
const path=require('node:path');
const marker='// Posnic: stage the launcher dependencies for template Snap builds.';
const anchor='        await this.stageSnapFiles({ stageDir, appOutDir, hooksDir, extraAppArgs, isTemplate: true });';
function patch(source) {
  if(source.includes(marker)) return source;
  if(source.split(anchor).length!==2) throw new Error('Snap template implementation changed; review the launcher workaround');
  return source.replace(anchor,anchor+`\n        ${marker}
        for (const script of ["desktop-init.sh", "desktop-common.sh", "desktop-gnome-specific.sh"]) {
            await (0, promises_1.copyFile)(path.join((0, pathManager_1.getTemplatePath)("snap"), script), path.join(stageDir, script));
            await (0, promises_1.chmod)(path.join(stageDir, script), 0o755);
        }`);
}
function main(){
 const file=path.join(__dirname,'../node_modules/app-builder-lib/out/targets/snap/coreLegacy.js');
 const before=fs.readFileSync(file,'utf8'),after=patch(before);
 if(after!==before) fs.writeFileSync(file,after);
 console.log('Snap template launcher dependencies will be staged.');
}
if(require.main===module) main();
module.exports={patch};
