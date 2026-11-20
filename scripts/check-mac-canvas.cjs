'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// Run the installed package's Electron and archived API dependencies, rather
// than the runner's Node or npm-installed canvas. Merely opening the wizard
// does not load the native canvas used by PDF/report generation.
function checkMacCanvas(executable, scratch, run = execFileSync) {
  const archive = path.resolve(path.dirname(executable), '../Resources/api/node_modules.zip');
  if (!fs.existsSync(archive)) throw new Error('Packaged API archive missing for canvas verification');
  const modules = path.join(scratch, 'canvas-runtime');
  fs.mkdirSync(modules, {recursive: true});
  run('/usr/bin/ditto', ['-x', '-k', archive, modules], {stdio: 'pipe', timeout: 180000});
  const probe = `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const canvas = require(path.join(process.argv[1], '@napi-rs/canvas'));
    const image = canvas.createCanvas(2, 2);
    const context = image.getContext('2d');
    context.fillStyle = '#123456';
    context.fillRect(0, 0, 2, 2);
    assert.deepEqual(Array.from(context.getImageData(0, 0, 1, 1).data), [18, 52, 86, 255]);
    assert.equal(image.toBuffer('image/png').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    console.log(JSON.stringify({arch: process.arch, passed: true}));
  `;
  const output = run(executable, ['-e', probe, modules], {
    encoding: 'utf8', timeout: 180000,
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = JSON.parse(output.trim());
  if (result.arch !== process.arch || result.passed !== true) throw new Error('Packaged canvas architecture/render verification failed');
  return result;
}
module.exports = {checkMacCanvas};
