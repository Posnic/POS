'use strict';
// Two real browser windows talking to the real service with an isolated temporary database.
// Authentication is replaced by fixed test identities. This never reads shop data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const captainRoot = process.argv[2];
let memory, server, mongoose, service, output;
function dependencies() {
  const { createRequire } = require('node:module');
  const candidates = [path.join(root, 'api')];
  if (process.argv[3]) candidates.splice(0, candidates.length, path.resolve(process.argv[3]));
  else {
    // A worktree may share the primary checkout's development dependencies.
    try {
      const common = require('node:child_process')
        .execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: root,
          encoding: 'utf8',
          windowsHide: true,
        })
        .trim();
      candidates.push(path.join(path.dirname(path.resolve(root, common)), 'api'));
    } catch {
      /* A standalone checkout can use the explicit dependency argument. */
    }
  }
  for (const directory of [...new Set(candidates)]) {
    const req = createRequire(path.join(directory, 'package.json'));
    try {
      req.resolve('mongoose');
      req.resolve('mongodb-memory-server');
    } catch {
      continue;
    }
    return {
      mongoose: req('mongoose'),
      MongoMemoryServer: req('mongodb-memory-server').MongoMemoryServer,
    };
  }
  throw Error(
    'Kitchen test dependencies are unavailable. Install API dev dependencies or pass an API dependency directory as the third argument. No POS data was accessed.',
  );
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(win, condition) {
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript(condition)) return;
    await pause(50);
  }
  throw Error('Timed out: ' + condition);
}
app
  .whenReady()
  .then(async () => {
    if (!captainRoot || !fs.existsSync(path.join(captainRoot, 'kitchen-ready.html')))
      throw Error('Pass the Captain source directory containing kitchen-ready.html.');
    const loaded = dependencies();
    mongoose = loaded.mongoose;
    service = require('../../api/src/services/kitchen-board');
    output = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-coordination-'));
    app.setPath('userData', path.join(output, 'profile'));
    process.env.MONGOMS_SYSTEM_BINARY = path.join(root, 'mongodb/bin/mongod.exe');
    process.env.MONGOMS_VERSION = '7.0.14';
    const { MongoMemoryServer } = loaded;
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    const db = mongoose.connection.db,
      id = () => new mongoose.Types.ObjectId(),
      branch = id(),
      license = id(),
      captain = id(),
      chef = id(),
      sale = id();
    await db
      .collection('branches')
      .insertOne({ _id: branch, license, branch_name: 'Test kitchen' });
    await db
      .collection('sales')
      .insertOne({
        _id: sale,
        branch_id: branch,
        license,
        sale_process: 'KOT',
        payment_status: 'Unpaid',
        created_date: new Date(),
        table_number: '6',
        items: [{ item_id: 'rice', item_name: 'Chicken biryani', item_quantity: 2 }],
        changes: [
          {
            timestamp: new Date(),
            kitchen_actor: { id: String(captain), name: 'Captain Arun' },
            items: [
              { item_id: 'rice', item_name: 'Chicken biryani', item_quantity: 2, process: 'add' },
            ],
          },
        ],
      });
    server = http.createServer(async (req, res) => {
      try {
        const url = req.url.split('?')[0];
        if (url === '/proof-config.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(
            `localStorage.setItem('kitchen.alert.mode','"silent"');window.POSNIC={session:{active:true,token:'test-only',shopKey:'isolated-proof'},server:{baseUrl:location.origin},api:{get:async p=>(await fetch(p)).json(),post:async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw Error(d.message);return d;}}};`,
          );
          return;
        }
        const routes = {
          '/api/kitchen': service.list,
          '/api/kitchen/transition': service.transition,
          '/captain/v1/kitchen-ready':
            req.method === 'POST' ? service.captainAction : service.captainList,
        };
        if (routes[url]) {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          const request = {
            db,
            body: raw ? JSON.parse(raw) : {},
            tenantContext: { branchId: String(branch), licenseId: String(license) },
            user: {
              _id: url.startsWith('/captain') ? captain : chef,
              role: 'manager',
              name: 'Captain Arun',
            },
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(await routes[url](request)));
          return;
        }
        const files = {
          '/kitchen/': ['api/src/kitchen-board/index.html', 'text/html'],
          '/kitchen/board.js': ['api/src/kitchen-board/board.js', 'text/javascript'],
          '/kitchen/board.css': ['api/src/kitchen-board/board.css', 'text/css'],
          '/kitchen/device.js': ['api/src/kitchen-board/device.js', 'text/javascript'],
        };
        if (files[url]) {
          res.setHeader('Content-Type', files[url][1]);
          res.end(fs.readFileSync(path.join(root, files[url][0])));
          return;
        }
        if (url === '/kitchen-ready.html') {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            fs
              .readFileSync(path.join(captainRoot, 'kitchen-ready.html'), 'utf8')
              .replace('src="config.js"', 'src="proof-config.js"'),
          );
          return;
        }
        if (url === '/assets/common/kitchen-ready.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(fs.readFileSync(path.join(captainRoot, url.slice(1))));
          return;
        }
        res.statusCode = 404;
        res.end();
      } catch (e) {
        res.statusCode = e.status || 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: e.message }));
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const kitchen = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true },
    });
    const phone = new BrowserWindow({
      show: false,
      width: 430,
      height: 900,
      webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true },
    });
    await kitchen.loadURL(base + '/kitchen/');
    await phone.loadURL(base + '/kitchen-ready.html');
    await until(kitchen, "!!document.querySelector('#new .advance')");
    await kitchen.webContents.executeJavaScript("document.querySelector('#new .advance').click()");
    await until(kitchen, "!!document.querySelector('#preparing .item-ready')");
    await kitchen.webContents.executeJavaScript(
      "document.querySelector('.quantity-input').value='1';document.querySelector('.item-ready').click()",
    );
    await until(
      kitchen,
      "document.querySelector('#preparing').textContent.includes('1 ready to collect')",
    );
    await phone.webContents.executeJavaScript('KitchenReady.refresh()');
    await until(phone, "!!document.querySelector('.collect')");
    await pause(250);
    fs.writeFileSync(
      path.join(output, 'captain-ready.png'),
      (await phone.webContents.capturePage()).toPNG(),
    );
    await phone.webContents.executeJavaScript("document.querySelector('.collect').click()");
    await until(phone, "!!document.querySelector('.serve')");
    await kitchen.webContents.executeJavaScript("document.getElementById('refresh').click()");
    await until(
      kitchen,
      "document.querySelector('#preparing').textContent.includes('1 collected')",
    );
    await pause(250);
    fs.writeFileSync(
      path.join(output, 'kitchen-collected.png'),
      (await kitchen.webContents.capturePage()).toPNG(),
    );
    await phone.webContents.executeJavaScript("document.querySelector('.serve').click()");
    await until(
      phone,
      "document.querySelector('#ready-tickets').textContent.includes('Nothing waiting')",
    );
    const saved = await db.collection('sales').findOne({ _id: sale });
    assert.equal(saved.kitchen_service.c0i0.quantity, 1);
    await kitchen.webContents.executeJavaScript("document.getElementById('refresh').click()");
    await until(kitchen, "document.querySelector('.quantity').textContent==='1×'");
    console.log(
      'PASS: chef readies 1 of 2, Captain collects and serves it, kitchen retains remaining 1. Screenshots:',
      output,
    );
    kitchen.destroy();
    phone.destroy();
  })
  .catch((e) => {
    console.error('[kitchen proof] ' + e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    server?.close();
    const cleanup = await Promise.allSettled([mongoose?.disconnect(), memory?.stop()]);
    if (cleanup.some((r) => r.status === 'rejected')) process.exitCode = 1;
    app.exit(process.exitCode || 0);
  });
