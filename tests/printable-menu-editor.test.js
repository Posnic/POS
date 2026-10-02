'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/modules/settings_write.html'), 'utf8');
function editor() {
    const start = html.indexOf('<div class="tab-pane fade" id="restaurantprintmenu-line"');
    const end = html.indexOf('<div class="tab-pane fade" id="restaurantprinting-line"', start);
    const dom = new JSDOM('<body><select id="branch_name"><option>One</option><option>Two</option></select>' + html.slice(start, end) + '</body>', { runScripts: 'outside-only' });
    const w = dom.window, pending = [], writes = [];
    w.$ = w.jQuery = require('jquery')(w);
    w.PosnicPro = { i18n: { t: (_k, fallback) => fallback },
        get: (params, ok, fail) => pending.push({ params, ok, fail }),
        put: (params, ok) => { writes.push(params); ok({ type: 'success', data: {} }); }
    };
    w.eval(fs.readFileSync(path.join(root, 'api/src/helpers/printable-menu-design.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(root, 'frontend/static/script/js/core/printable-menu-renderer.js'), 'utf8'));
    const pattern = w.PosnicPrintableMenuRenderer.pattern;
    w.PosnicPrintableMenuRenderer = { pattern, render: (_host, _data, design) => ({ pages: [], count: 0, design }) };
    w.eval(fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/printable-menu.js'), 'utf8'));
    return { dom, w, pending, writes };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const data = name => ({ name, categories: [{ id: 'a', name: 'Food', items: [{ name: 'Rice', price: 50 }] }] });
function answer(pending, name) {
    pending[0].ok({ type: 'success', data: data(name) });
    pending[1].ok({ type: 'success', data: { values: {} } });
}
test('saving a design sends only that setting and preserves an empty category selection', async () => {
    const { dom, w, pending, writes } = editor();
    w.$('#pm-reload').trigger('click'); answer(pending, 'One'); await tick();
    w.$('#pm-none').trigger('click');
    w.$('#pm-title').val('Lunch menu');
    w.$('#pm-save').trigger('click'); await tick();
    assert.equal(writes[0].url, 'settings/group/documents');
    const payload = JSON.parse(writes[0].data);
    assert.deepEqual(Object.keys(payload), ['printable_menu_design']);
    assert.deepEqual(payload.printable_menu_design.categories, []);
    assert.equal(payload.printable_menu_design.title, 'Lunch menu');
    dom.window.close();
});
test('a slow response from the previous branch cannot populate or enable the editor', async () => {
    const { dom, w, pending } = editor();
    w.$('#pm-reload').trigger('click');
    w.$('#branch_name').trigger('change');
    answer(pending, 'Old branch'); await tick();
    assert.equal(w.$('#pm-save').prop('disabled'), true);
    assert.equal(w.$('#pm-download').prop('disabled'), true);
    assert.equal(w.$('#pm-categories').children().length, 0);
    w.$('#pm-reload').trigger('click'); answer(pending.slice(2), 'New branch'); await tick();
    assert.equal(w.$('#pm-title').attr('placeholder'), 'New branch');
    assert.equal(w.$('#pm-save').prop('disabled'), false);
    dom.window.close();
});
test('failed loads leave saving and exporting disabled with a retry action', async () => {
    const { dom, w, pending } = editor();
    w.$('#pm-reload').trigger('click');
    pending[0].fail({ responseText: '{"message":"Not allowed"}' });
    pending[1].ok({ type: 'success', data: { values: {} } }); await tick();
    assert.equal(w.$('#pm-status').text(), 'Not allowed');
    assert.equal(w.$('#pm-save').prop('disabled'), true);
    assert.equal(w.$('#pm-download').prop('disabled'), true);
    assert.equal(w.$('#pm-reload').prop('disabled'), false);
    dom.window.close();
});

test('pattern thumbnails replace uploaded images and persist the selected design', async () => {
    const { dom, w, pending, writes } = editor();
    w.$('#pm-reload').trigger('click'); answer(pending, 'One'); await tick();
    assert.equal(w.document.querySelectorAll('#pm-patterns button').length, 18);
    for (const img of w.document.querySelectorAll('#pm-patterns img')) assert.match(img.src, /^data:image\/svg\+xml/);
    w.$('#pm-patterns [data-pattern="petals"]').trigger('click');
    assert.equal(w.document.querySelector('[data-pattern="petals"]').getAttribute('aria-pressed'), 'true');
    w.$('#pm-save').trigger('click'); await tick();
    const saved = JSON.parse(writes[0].data).printable_menu_design;
    assert.equal(saved.pattern, 'petals'); assert.equal(saved.background, '');
    dom.window.close();
});

test('ten-page export captures only each menu page and encodes asynchronously without reducing quality', async () => {
    const { dom, w, pending } = editor();
    try {
        const canvases = [], images = [];
        let captures = 0, saved = 0, eventTurns = 0;
        w.PosnicPrintableMenuRenderer.render = (host, _data, design) => {
            host.replaceChildren();
            const pages = Array.from({ length: 10 }, () => {
                const page = w.document.createElement('section');
                page.style.width = '794px'; page.style.height = '1123px';
                page.appendChild(w.document.createElement('span'));
                host.appendChild(page); return page;
            });
            return { pages, count: 500, design };
        };
        w.PosnicPro.lazy = { load: async () => {} };
        w.jspdf = { jsPDF: function () {
            this.addPage = () => {};
            this.addImage = bytes => images.push(Array.from(bytes));
            this.setProperties = () => {};
            this.save = () => { saved++; };
        } };
        w.html2canvas = async (page, options) => {
            captures++;
            assert.equal(options.scale, 3);
            assert.equal(options.ignoreElements(page), false);
            assert.equal(options.ignoreElements(page.firstChild), false);
            assert.equal(options.ignoreElements(page.parentElement), false);
            assert.equal(options.ignoreElements(w.document.getElementById('pm-preview')), true);
            const other = page.nextElementSibling || page.previousElementSibling;
            assert.equal(options.ignoreElements(other), true);
            const canvas = { width: 2382, height: 3369,
                toDataURL() { assert.fail('Synchronous JPEG/base64 encoding must not run'); },
                toBlob(callback, mime, quality) {
                    assert.equal(mime, 'image/jpeg'); assert.equal(quality, 0.95);
                    w.setTimeout(() => { eventTurns++; callback({ arrayBuffer: async () => new Uint8Array([255,216,255]).buffer }); }, 0);
                }
            };
            canvases.push(canvas); return canvas;
        };
        w.$('#pm-reload').trigger('click'); answer(pending, 'Ten pages'); await tick();
        w.$('#pm-download').trigger('click');
        const deadline = Date.now() + 5000;
        while (!saved && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(saved, 1, w.$('#pm-status').text());
        assert.equal(captures, 10); assert.equal(eventTurns, 10); assert.equal(images.length, 10);
        assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    } finally { dom.window.close(); }
});
