'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyArchive, verifyPackagedRuntime } = require('../scripts/verify-packaged-runtime');
const pkg = require('../package.json');

test('shared modules are not excluded from ASAR by extraResources', () => {
  for (const name of ['asset-updater.js', 'handset-slots.js']) {
    assert.ok(pkg.build.files.includes('src/' + name));
    assert.ok(!pkg.build.extraResources.some(f => f.from === 'src/' + name));
  }
});
test('archive gate rejects missing runtime modules and accepts complete archive', async () => {
  const asar = await import('@electron/asar');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-archive-test-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(path.join(source, 'src'), {recursive:true});
    fs.writeFileSync(path.join(source,'src/main.js'), "require('./asset-updater');");
    const archive = path.join(root, 'broken.asar');
    await asar.createPackage(source, archive);
    await assert.rejects(verifyArchive(archive, ['src/main.js','src/asset-updater.js']), /asset-updater/);
    fs.writeFileSync(path.join(source,'src/asset-updater.js'), 'module.exports = {};');
    const good = path.join(root, 'good.asar');
    await asar.createPackage(source, good);
    await verifyArchive(good, ['src/main.js','src/asset-updater.js']);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('post-pack preserves archive modules and copies standalone server dependencies', async () => {
  const asar = await import('@electron/asar');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-afterpack-test-'));
  try {
    const source=path.join(root,'source'); fs.mkdirSync(path.join(source,'src'),{recursive:true});
    const files=pkg.build.files.filter(p=>typeof p==='string'&&p.startsWith('src/')&&p.endsWith('.js'));
    for(const file of files) { const out=path.join(source,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',file),out); }
    for (const platform of ['linux','win32','darwin']) {
      const out=path.join(root,platform);
      const resources=platform==='darwin'?path.join(out,'Posnic.app/Contents/Resources'):path.join(out,'resources');
      fs.mkdirSync(resources,{recursive:true});
      await asar.createPackage(source,path.join(resources,'app.asar'));
      await verifyPackagedRuntime({appOutDir:out,electronPlatformName:platform,packager:{appInfo:{productFilename:'Posnic'}}});
      for(const [src,dest] of [['src/asset-updater.js','src/asset-updater.js'],['src/handset-slots.js','handset-slots.js']])
        assert.deepEqual(fs.readFileSync(path.join(resources,dest)),fs.readFileSync(path.join(source,src)));
    }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
