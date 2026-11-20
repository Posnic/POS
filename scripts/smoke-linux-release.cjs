'use strict';
// Run the built AppImage, not the checkout. Never use a real shop profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

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

async function main() {
  if (process.platform !== 'linux') throw new Error('Run this gate on Linux under xvfb-run');
  const artifact = path.resolve(process.argv[2] || '');
  if (!artifact.endsWith('.AppImage') || !fs.statSync(artifact).isFile()) throw new Error('Pass the built AppImage');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-release-smoke-'));
  let child;
  let output = '';
  try {
    fs.chmodSync(artifact, 0o755);
    execFileSync(artifact, ['--appimage-extract'], {cwd: root, stdio: 'pipe', timeout: 120000});
    const resources = path.join(root, 'squashfs-root/resources');
    const pkg = require('../package.json');
    await require('./verify-packaged-runtime').verifyArchive(path.join(resources, 'app.asar'),
      pkg.build.files.filter(p => typeof p === 'string' && p.startsWith('src/') && p.endsWith('.js')));
    for (const file of ['mongodb/bin/mongod', 'api/node_modules.zip']) {
      // Resource paths must match the production packaging configuration.
      if (!fs.existsSync(path.join(resources, file))) throw new Error('Missing bundled runtime: ' + file);
    }
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const home = path.join(root, 'home'); fs.mkdirSync(home);
    const env = {...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_DATA_HOME: path.join(home, '.local/share'), POSNIC_USER_DATA: path.join(home, 'shop')};
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(path.join(root, 'squashfs-root/posnic'), ['--no-sandbox', '--remote-debugging-port=' + port],
      {cwd: path.join(root, 'squashfs-root'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
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
            console.log('PASS: downloaded-format AppImage reached the rendered first-run wizard and remained alive.');
            return;
          }
        } else readySince = 0;
      } else readySince = 0;
      await delay(500);
    }
    throw new Error('Packaged app did not reach the rendered first-run wizard within 180 seconds');
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await delay(1000); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    fs.rmSync(root, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
