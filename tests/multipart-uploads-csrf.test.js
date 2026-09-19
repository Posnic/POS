'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { JSDOM } = require('jsdom');
const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
const express = apiRequire('express');
const multer = apiRequire('multer');
const jwt = apiRequire('jsonwebtoken');

// Only local fixture credentials; no application server or database is used.
process.env.JWT_SECRET = 'multipart-upload-test-secret';
process.env.CSRF_SECRET = 'multipart-upload-csrf-test-secret';
const csrf = require('../api/src/middleware/csrf');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const core = read('frontend/static/script/js/core/PosnicPro.js');
const start = core.indexOf('    requestImage: function');
const end = core.indexOf('\n    },', start);
const imageRequest = core.slice(core.indexOf('function', start), end + 6);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6sAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
    const app = express();
    let uploads = 0;
    const seen = [];
    app.use(apiRequire('cookie-parser')());
    app.use((req, _res, next) => {
        seen.push({ method: req.method, path: req.path });
        next();
    });
    app.use(csrf.protect);
    app.get('/setting/getSettings', (_req, res) => res.json({ status: true }));
    app.post('/setting/updateBranchLogo', multer().single('file'), (req, res) => {
        uploads++;
        res.json({ status: true, file: req.file && req.file.buffer.toString('hex'),
            filename: req.file && req.file.originalname, fields: req.body,
            contentType: req.get('Content-Type'), token: req.get(csrf.HEADER),
            authorization: req.get('Authorization') });
    });
    app.post('/setting/save', express.json(), (req, res) => res.json({
        body: req.body, contentType: req.get('Content-Type'), token: req.get(csrf.HEADER)
    }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    const dom = new JSDOM('<div class="loadingSpinner"></div>', {
        url: base + 'dashboard.html', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const win = dom.window;
    const $ = require('jquery')(win);
    win.$ = win.jQuery = $;
    win.API_URL = base;
    const alerts = [];
    const p = win.PosnicPro = {
        alert: (type, message) => alerts.push({ type, message }),
        local: { get: () => 'fixture-user' },
        users: { createCookie: () => {} },
        i18n: { t: (_key, fallback) => fallback }
    };
    win.eval('PosnicPro.requestImage = ' + imageRequest + ';');
    win.eval(read('frontend/static/script/js/core/ajax.js'));
    const credential = jwt.sign({ id: 'upload-test-user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    dom.cookieJar.setCookieSync('jwt=' + credential + '; HttpOnly; Path=/', base);
    const expected = csrf.tokenFor('jwt:' + credential);
    function form() {
        const data = new win.FormData();
        data.append('file', new win.Blob([png], { type: 'image/png' }), 'shop-logo.png');
        data.append('setting_image_value', 'shop-logo.png');
        data.append('setting_logo_value', 'store.png');
        data.append('target_branch_id', 'branch-fixture');
        return data;
    }
    function request(invoke) {
        return new Promise((resolve, reject) => {
            let callbacks = 0;
            const timer = setTimeout(() => reject(new Error('Upload request did not finish')), 5000);
            $(win.document).one('ajaxComplete', (_event, xhr) => {
                clearTimeout(timer);
                resolve({ status: xhr.status, body: xhr.responseJSON, callbacks });
            });
            invoke(() => { callbacks++; });
        });
    }
    return { p, win, $, alerts, expected, seen, request,
        uploads: () => uploads,
        read: () => request((done) => p.get('setting/getSettings', done)),
        upload: () => request((done) => p.requestImage('POST', 'setting/updateBranchLogo', form(), false, done)) };
}

test('a settings read authorizes the logo upload and preserves its multipart bytes and fields', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.read()).status, 200);
    assert.equal(f.p.csrfToken, f.expected);
    const result = await f.upload();
    assert.equal(result.status, 200);
    assert.equal(result.callbacks, 1);
    assert.equal(result.body.token, f.expected);
    assert.match(result.body.contentType, /^multipart\/form-data; boundary=/);
    assert.equal(result.body.file, png.toString('hex'));
    assert.equal(result.body.filename, 'shop-logo.png');
    assert.deepEqual(result.body.fields, { setting_image_value: 'shop-logo.png',
        setting_logo_value: 'store.png', target_branch_id: 'branch-fixture' });
    assert.equal(f.uploads(), 1);
    assert.deepEqual(f.alerts, []);
});

for (const token of [undefined, 'stale-token']) {
    test('an upload with a ' + (token ? 'stale' : 'missing') + ' token reports the refusal and learns a fresh token', async (t) => {
        const f = await fixture(t);
        f.p.csrfToken = token;
        const refused = await f.upload();
        assert.equal(refused.status, 403);
        assert.equal(refused.callbacks, 0);
        assert.equal(f.uploads(), 0);
        assert.equal(f.seen.length, 1, 'a refused write must not be automatically replayed');
        assert.equal(f.alerts.length, 1);
        assert.match(f.alerts[0].message, /session security token is missing or expired/);
        assert.equal(f.$('.loadingSpinner').length, 0);
        assert.equal(f.p.csrfToken, f.expected);
        assert.equal((await f.upload()).status, 200, 'the next explicit attempt uses the refreshed token');
        assert.equal(f.uploads(), 1);
    });
}

test('ordinary JSON saves keep their content type, payload and security token', async (t) => {
    const f = await fixture(t);
    await f.read();
    const result = await f.request((done) => f.p.post({ url: 'setting/save',
        data: JSON.stringify({ print_logoimg: true }) }, done));
    assert.equal(result.status, 200);
    assert.equal(result.callbacks, 1);
    assert.match(result.body.contentType, /^application\/json/);
    assert.deepEqual(result.body.body, { print_logoimg: true });
    assert.equal(result.body.token, f.expected);
});

test('Electron uploads keep the explicit bearer credential and learn response tokens', async (t) => {
    const f = await fixture(t);
    Object.defineProperty(f.win.navigator, 'userAgent', { value: 'Posnic Electron/40.0.0' });
    f.win.localStorage.setItem('posnic_jwt_token', 'fixture-desktop-token');
    const result = await f.upload();
    assert.equal(result.status, 200);
    assert.equal(result.body.authorization, 'Bearer fixture-desktop-token');
    assert.equal(result.body.file, png.toString('hex'));
    assert.equal(f.p.csrfToken, f.expected);
});
