'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test.each(['server.js', 'shard.js'])(
  '%s loads API settings when PM2 starts in another directory',
  (file) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-api-env-'));
    try {
      const api = path.join(root, 'api');
      const launcher = path.join(root, 'provisioner');
      fs.mkdirSync(api);
      fs.mkdirSync(launcher);
      fs.writeFileSync(
        path.join(api, '.env'),
        'POSNIC_TEST_STORAGE=s3\nPOSNIC_TEST_DATABASE=shared\n'
      );
      fs.writeFileSync(path.join(launcher, '.env'), 'POSNIC_TEST_LAUNCHER=yes\n');
      const source = fs.readFileSync(path.join(__dirname, '../../../', file), 'utf8');
      const start = source.indexOf("const dotenv = require('dotenv');");
      const end = source.indexOf(
        file === 'server.js' ? 'const mongoose = require' : 'const http = require',
        start
      );
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const program =
        'const load = new Function("require", "__dirname", ' +
        JSON.stringify(source.slice(start, end)) +
        ');' +
        'load(n => n === "dotenv" ? require(' +
        JSON.stringify(require.resolve('dotenv')) +
        ') : require(n), ' +
        JSON.stringify(api) +
        ');' +
        'console.log(JSON.stringify([process.env.POSNIC_TEST_STORAGE,process.env.POSNIC_TEST_DATABASE,process.env.POSNIC_TEST_LAUNCHER]));';
      const env = { ...process.env, POSNIC_TEST_DATABASE: 'this-tenant' };
      delete env.POSNIC_TEST_STORAGE;
      delete env.POSNIC_TEST_LAUNCHER;
      const result = spawnSync(process.execPath, ['-e', program], {
        cwd: launcher,
        env,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(['s3', 'this-tenant', 'yes']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
