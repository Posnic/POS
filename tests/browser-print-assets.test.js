'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/core/PosnicPro.js'), 'utf8').replace(/\r\n/g, '\n');

function printer() {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://shop.example/dashboard.html', runScripts: 'outside-only' });
    const win = dom.window;
    win.$ = win.jQuery = require('jquery')(win);
    const errors = [];
    win.PosnicPro = {
        resolvePrintType: () => 'standard', local: { get: () => 'false' },
        paperCss: () => '', escapeHtml: value => value,
        alert: (_type, message) => errors.push(message), i18n: { t: (_key, fallback) => fallback }
    };
    win.currentHash = 'sales/507f1f77bcf86cd799439011';
    win.hasher = { setHash() {} };
    for (const key of ['waitForPrintAssets', 'printView']) {
        const start = core.indexOf('    ' + key + ': function');
        const end = core.indexOf('\n    },', start);
        win.eval('PosnicPro.' + key + ' = ' + core.slice(core.indexOf('function', start), end + 6) + ';');
    }
    return { dom, win, errors };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('each print waits for its stylesheet, remote logo and offscreen QR', async () => {
    const { dom, win, errors } = printer();
    for (let count = 0; count < 2; count++) {
        const doc = win.document;
        doc.body.innerHTML = '<link rel="stylesheet" href="/static/pages/print.css"><img src="/uploads/logo.png"><img loading="lazy" decoding="async" src="data:image/png;base64,QR">';
        let printed = 0;
        const ready = win.PosnicPro.waitForPrintAssets(doc).then(() => { printed++; });
        assert.equal(doc.images[1].loading, 'eager');
        doc.querySelector('link').dispatchEvent(new win.Event('load'));
        doc.images[0].dispatchEvent(new win.Event('load'));
        await flush();
        assert.equal(printed, 0, 'QR was not ready');
        doc.images[1].dispatchEvent(new win.Event('load'));
        await ready;
        assert.equal(printed, 1);
    }
    assert.deepEqual(errors, []);
    dom.window.close();
});

test('a failed logo rejects instead of allowing a silently incomplete receipt', async () => {
    const { dom, win } = printer();
    win.document.body.innerHTML = '<img src="/uploads/missing.png">';
    const ready = win.PosnicPro.waitForPrintAssets(win.document);
    win.document.images[0].dispatchEvent(new win.Event('error'));
    await assert.rejects(ready, /Could not load a print asset/);
    dom.window.close();
});

test('QR save response updates the thumbnail and print cache, then supports clearing', () => {
    const { dom, win } = printer();
    const $ = win.$;
    $('body').append('<input id="footer_qr_url"><input id="footer_image_caption"><input id="footer_image_value">' +
        '<img id="footer_image_thumb" style="display:none"><button id="footer_image_clear" style="display:none"></button>');
    const saved = {};
    win.PosnicPro.local.set = (key, value) => { saved[key] = value; };
    win.PosnicPro.settings = { _footerImagePicked: true };
    const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/settings.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf('    applyReceiptFooter: function');
    const end = source.indexOf('\n    },', start);
    win.eval('PosnicPro.settings.applyReceiptFooter = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
    const picture = 'data:image/png;base64,QR';
    win.PosnicPro.settings.applyReceiptFooter({ footer_image: picture, footer_qr_url: 'https://example.com', footer_image_caption: 'Our shop' });
    assert.equal($('#footer_image_thumb').attr('src'), picture);
    assert.notEqual($('#footer_image_thumb')[0].style.display, 'none');
    assert.equal($('#footer_image_value').val(), picture);
    assert.equal(saved.footer_image, picture);
    assert.equal(saved.footer_image_caption, 'Our shop');
    assert.equal(win.PosnicPro.settings._footerImagePicked, false);
    win.PosnicPro.settings.applyReceiptFooter({ footer_image: '', footer_qr_url: '', footer_image_caption: '' });
    assert.equal($('#footer_image_thumb')[0].style.display, 'none');
    assert.equal(saved.footer_image, '');
    dom.window.close();
});
