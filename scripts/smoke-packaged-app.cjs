'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {fileURLToPath} = require('node:url');
const {spawn, execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
async function evaluate(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('Renderer inspection timed out')); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {
      expression: "JSON.stringify({ready:document.readyState, text:document.body?.innerText.length || 0, controls:document.querySelectorAll('input,button,select').length})", returnByValue: true
    }}));
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id !== 1) return;
      clearTimeout(timer); ws.close();
      if (data.error || data.result?.exceptionDetails) return reject(new Error('Renderer evaluation failed'));
      try { resolve(JSON.parse(data.result.result.value)); } catch (error) { reject(error); }
    };
    ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error('Renderer debugger connection failed')); };
  });
}


async function inspectResources(url) {
  const file = fileURLToPath(url);
  const marker = file.indexOf('app.asar');
  if (marker < 0) throw new Error('Wizard did not load from packaged ASAR');
  const resources = path.dirname(file.slice(0, marker + 'app.asar'.length));
  const pkg = require('../package.json');
  await require('./verify-packaged-runtime').verifyArchive(path.join(resources, 'app.asar'),
    pkg.build.files.filter(p => typeof p === 'string' && p.startsWith('src/') && p.endsWith('.js')));
  const asar = await import('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  const embedded = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const expectedVersion = process.env.RELEASE_TAG ? process.env.RELEASE_TAG.replace(/^v/, '') : pkg.version;
  if (embedded.version !== expectedVersion) throw new Error('Packaged version does not match the release');
  // Bind desktop code to the checkout used to verify this release, not just
  // to a filename or a manifest that could describe a renamed old build.
  for (const name of pkg.build.files.filter(p => typeof p === 'string' && p.startsWith('src/') && p.endsWith('.js'))) {
    if (asar.extractFile(archive, name).toString('utf8').replace(/\r\n/g, '\n') !== fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n')) {
      throw new Error('Packaged source differs from the verification checkout: ' + name);
    }
  }
  for (const name of ['api/node_modules.zip', 'mongodb/bin/mongod' + (process.platform === 'win32' ? '.exe' : '')]) {
    if (!fs.existsSync(path.join(resources, name))) throw new Error('Missing packaged resource: ' + name);
  }
}
async function smokeExecutable(executable, root, args = []) {
  let child, output = '';
  try {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const home = path.join(root, 'home'); fs.mkdirSync(home, {recursive: true});
    const env = {...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_DATA_HOME: path.join(home, '.local/share'), POSNIC_USER_DATA: path.join(home, 'shop')};
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [...args, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--remote-debugging-port=' + port],
      {cwd: path.dirname(executable), env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let launchError;
    child.on('error', error => { launchError = error; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-200000); });
    const deadline = Date.now() + 180000;
    let readySince = 0;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Packaged app exited before verification');
      if (/Cannot find module|Uncaught Exception|main-uncaught-exception|main-unhandled-rejection/i.test(output)) throw new Error('Packaged startup exception');
      let targets = [];
      try { targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', {signal: AbortSignal.timeout(2000)})).json(); } catch {}
      const target = targets.find(t => t.type === 'page' && /\/install-wizard\.html(?:[?#]|$)/.test(t.url));
      if (target) {
        const page = await evaluate(target.webSocketDebuggerUrl);
        if (page.ready === 'complete' && page.text > 40 && page.controls > 0) {
          readySince ||= Date.now();
          if (Date.now() - readySince >= 5000) {
            await inspectResources(target.url);
            console.log('PASS: packaged executable reached the rendered first-run wizard and remained alive.');
            return;
          }
        } else readySince = 0;
      } else readySince = 0;
      await delay(500);
    }
    throw new Error('Packaged app did not reach the rendered first-run wizard within 180 seconds');
  } catch (error) { console.error(output); throw error; }
  finally {
    if (child?.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio:'ignore', windowsHide:true}); } catch {}
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        await delay(1000);
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
    }
  }
}
module.exports = {smokeExecutable, inspectResources};
