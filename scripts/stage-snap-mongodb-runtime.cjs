'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

function stageSnapMongoRuntime(context, run = execFileSync) {
  if (context.electronPlatformName !== 'linux' || !(context.targets || []).some(t => t.name === 'snap')) return;
  if (process.platform !== 'linux') throw new Error('Snap runtime staging requires a Linux build host with Docker');
  const mongo = path.resolve(context.appOutDir, 'resources/mongodb/bin/mongod');
  const output = path.resolve(context.appOutDir, 'resources/mongodb/lib');
  if (!fs.existsSync(mongo)) throw new Error('Bundled mongod missing before Snap runtime staging');
  fs.mkdirSync(output, {recursive:true});
  // Resolve against core22's Ubuntu release, never copy the newer CI host's ABI.
  run('docker', ['run', '--rm', '--platform', 'linux/amd64',
    '--mount', `type=bind,source=${mongo},target=/input/mongod,readonly`,
    '--mount', `type=bind,source=${output},target=/output`,
    '--mount', `type=bind,source=${path.join(__dirname, 'stage-snap-mongodb-runtime.sh')},target=/stage.sh,readonly`,
    'ubuntu:22.04', 'bash', '/stage.sh'], {stdio:'inherit',timeout:600000});
  for (const library of ['libcurl.so.4', 'libssl.so.3', 'libcrypto.so.3']) {
    if (!fs.existsSync(path.join(output, library))) throw new Error('Snap MongoDB runtime missing ' + library);
  }
}
module.exports = {stageSnapMongoRuntime};
