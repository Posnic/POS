#!/usr/bin/env node
'use strict';

/*
 * CAN THIS INSTALLED APP ACTUALLY MAKE A SOUND?
 *
 * Written the evening a shop's kitchen stayed silent with a correct build
 * installed on the machine. Every part was present and one of them was older
 * than the code that needed it, which is a state no test in the repository can
 * see: the repository was green the whole time.
 *
 * The chain has five links and breaking any one of them is silence, with no
 * error anywhere:
 *
 *   1. the main process can compose and synthesise      (src/*.js in the asar)
 *   2. the bridge exists to carry it to a page          (src/preload.js)
 *   3. a page is listening                              (the built dashboard bundle)
 *   4. the browser is allowed to play a data: sound     (the CSP the API sends)
 *   5. somebody turned it on                            (kitchen-announce.json)
 *
 * The one that broke was 3, and it is the only one invisible from the source
 * tree: frontend/public/ is gitignored build output, so an installer can carry
 * a bundle built before the code it is supposed to contain.
 *
 *     node scripts/check-installed-app.js
 *     node scripts/check-installed-app.js "C:/Users/x/AppData/Local/Programs/Posnic"
 *
 * Read-only. It opens files and asks the running app for one page.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const WHERE = [
  process.argv[2],
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Posnic'),
  path.join(process.env.PROGRAMFILES || '', 'Posnic Desktop'),
].filter(Boolean);

const found = [];
const missing = [];
const say = (ok, what, detail) => {
  (ok ? found : missing).push(what);
  console.log(`  ${ok ? 'OK  ' : 'MISS'}  ${what}${detail ? '   ' + detail : ''}`);
};

/** The asar index: an 8 byte pickle, then a JSON header of the stated length. */
function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const size = head.readUInt32LE(12);
  const json = Buffer.alloc(size);
  fs.readSync(fd, json, 0, size, 16);
  const index = JSON.parse(json.toString('utf8'));
  const base = 16 + size;

  return (entry) => {
    let node = index;
    for (const part of entry.split('/')) {
      node = node && node.files ? node.files[part] : null;
      if (!node) return null;
    }
    if (!node.size) return '';
    const body = Buffer.alloc(Number(node.size));
    fs.readSync(fd, body, 0, Number(node.size), base + Number(node.offset));
    return body.toString('utf8');
  };
}

function get(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 4000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ headers: response.headers, body }));
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

async function main() {
  const root = WHERE.find((dir) => fs.existsSync(path.join(dir, 'resources', 'app.asar')));
  if (!root) {
    console.log('No installed app found. Pass its folder as an argument.');
    process.exit(2);
  }

  console.log(`\nChecking ${root}\n`);

  /* 1 and 2: the main process and the bridge. */
  const read = openAsar(path.join(root, 'resources', 'app.asar'));
  const call = read('src/kitchen-call.js');
  const announce = read('src/kitchen-announce.js');
  const alert = read('src/order-alert.js');
  const preload = read('src/preload.js');
  const main = read('src/main.js');

  say(!!call, 'the announcement is composed', call ? '' : 'src/kitchen-call.js is not packaged');
  say(!!announce, 'the switches are readable');
  say(!!alert && /struck/.test(alert), 'the bells are struck notes, not a beep');
  say(!!preload && /posnic:kitchen-call/.test(preload), 'the bridge carries it to a page');
  say(
    !!main && /autoplay-policy/.test(main),
    'audio is allowed without a user gesture',
    'a kitchen machine is one nobody has touched'
  );

  /*
   * 3: A PAGE IS LISTENING. The link that broke, and the only one that cannot
   * be seen from the source tree.
   */
  const page = await get('http://localhost:5555/dashboard.html');
  if (!page) {
    console.log('  ----  the app is not running, so the page and the CSP were not checked');
  } else {
    const bundle = (page.body.match(/src="(script\/dashboard\.[0-9a-f]+\.js)"/) || [])[1];
    const served = bundle ? await get(`http://localhost:5555/${bundle}`) : null;
    const listening = !!served && /kitchenCall/.test(served.body);

    say(
      listening,
      'a page is listening for the announcement',
      listening ? bundle : `${bundle || 'no bundle'} was built before the player existed`
    );
    say(
      !!served && /speechSynthesis/.test(served.body),
      'that page can speak'
    );

    /* 4: the browser is allowed to play a generated sound. */
    const csp = page.headers['content-security-policy'] || '';
    say(
      /media-src[^;]*data:/.test(csp),
      'the browser may play a generated sound',
      /media-src/.test(csp) ? '' : 'no media-src, so it falls back to default-src and is blocked'
    );
  }

  /* 5: somebody turned it on. Not a fault, but the commonest reason for silence. */
  const settings = path.join(process.env.APPDATA || '', 'posnic', 'kitchen-announce.json');
  if (fs.existsSync(settings)) {
    try {
      const said = JSON.parse(fs.readFileSync(settings, 'utf8'));
      say(said.ting === true || said.speak === true, 'this machine is set to make a sound',
        `ting=${said.ting === true} speak=${said.speak === true}`);
    } catch (e) {
      say(false, 'this machine is set to make a sound', 'the settings file will not parse');
    }
  } else {
    console.log('  ----  this machine has not been switched on yet (Core Settings, then Test)');
  }

  console.log(
    `\n${missing.length ? 'NOT READY: ' + missing.length + ' of ' + (found.length + missing.length) + ' checks failed' : 'Ready: every link in the chain is present'}\n`
  );
  process.exit(missing.length ? 1 : 0);
}

main();
