'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

describe('whatsapp-web.js and Puppeteer compatibility', () => {
  test('the real CommonJS package loads and constructs a client', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        "const w = require('whatsapp-web.js'); " +
          'const c = new w.Client({ puppeteer: { headless: true } }); ' +
          'process.stdout.write(JSON.stringify([typeof w.Client, typeof w.LocalAuth, c.constructor.name]));',
      ],
      {
        cwd: path.join(__dirname, '..', '..', '..'),
        encoding: 'utf8',
      }
    );

    expect(JSON.parse(output)).toEqual(['function', 'function', 'Client']);
  });
});
