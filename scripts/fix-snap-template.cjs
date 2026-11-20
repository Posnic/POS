'use strict';
const fs=require('node:fs');
const path=require('node:path');
const marker='// Posnic: stage the launcher dependencies for template Snap builds.';
const unpackMarker='// Posnic: expand the nested runtime tar before packaging.';
const anchor='        await this.stageSnapFiles({ stageDir, appOutDir, hooksDir, extraAppArgs, isTemplate: true });';
const download='        const templateDir = await (0, electronGet_1.downloadBuilderToolset)({ releaseName, filenameWithExt, checksums, githubOrgRepo: "electron-userland/electron-builder-binaries" });';
function patch(source) {
  if(source.includes(unpackMarker)) return source;
  if(source.split(anchor).length!==2) throw new Error('Snap template implementation changed; review the workaround');
  if(!source.includes(marker)) source=source.replace(anchor,anchor+`\n        ${marker}
        for (const script of ["desktop-init.sh", "desktop-common.sh", "desktop-gnome-specific.sh"]) {
            await (0, promises_1.copyFile)(path.join((0, pathManager_1.getTemplatePath)("snap"), script), path.join(stageDir, script));
            await (0, promises_1.chmod)(path.join(stageDir, script), 0o755);
        }`);
  if(source.split(download).length!==2 || !source.includes('...(await readDirPaths(stageDir)),')) throw new Error('Snap runtime extraction implementation changed');
  source=source.replace(download,download.replace('const templateDir','const downloadedTemplateDir')+`
        ${unpackMarker}
        let templateDir = downloadedTemplateDir;
        const nestedArchive = path.join(downloadedTemplateDir, filenameWithExt.replace(/\\.7z$/, ""));
        if (await (0, fs_extra_1.pathExists)(nestedArchive)) {
            templateDir = path.join(stageDir, ".template-runtime");
            await (0, promises_1.mkdir)(templateDir, { recursive: true });
            await (0, builder_util_1.exec)("tar", ["-xf", nestedArchive, "-C", templateDir]);
        }`);
  return source.replace('...(await readDirPaths(stageDir)),','...(await readDirPaths(stageDir, name => name !== ".template-runtime")),');
}
function main(){
 const file=path.join(__dirname,'../node_modules/app-builder-lib/out/targets/snap/coreLegacy.js');
 const before=fs.readFileSync(file,'utf8'),after=patch(before);
 if(after!==before) fs.writeFileSync(file,after);
 console.log('Snap template runtime and launcher dependencies will be staged.');
}
if(require.main===module) main();
module.exports={patch,anchor,download};
