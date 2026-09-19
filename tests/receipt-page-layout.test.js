'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { fitDocument } = require('../src/receipt-page-layout');

test('thermal paper follows receipt content, never the enclosing window height', () => {
    for (const format of ['58', '80']) {
        const dom = new JSDOM('<article class="rd-document" data-receipt-design="' + format + '"></article>');
        const doc = dom.window.document;
        let height = 400;
        doc.querySelector('article').getBoundingClientRect = () => ({ height });
        Object.defineProperty(doc.body, 'scrollHeight', { value: 3000 });
        const fitted = fitDocument(doc);
        assert.equal(fitted.width, Number(format) * 1000);
        assert.equal(fitted.height, 106100);
        assert.match(doc.querySelector('#rd-fitted-paper').textContent, new RegExp('@page\\{size:' + format + 'mm 106.1mm;margin:0;'));
        height = 200;
        assert.equal(fitDocument(doc).height, 53200);
        assert.equal(doc.querySelectorAll('#rd-fitted-paper').length, 1);
        dom.window.close();
    }
});

test('the serialized Electron fitter matches the browser result', () => {
    const dom = new JSDOM('<article class="rd-document" data-receipt-design="80"></article>', { runScripts: 'outside-only' });
    dom.window.document.querySelector('article').getBoundingClientRect = () => ({ height: 760 });
    const browser = fitDocument(dom.window.document);
    const desktop = dom.window.eval('(' + fitDocument.toString() + ')(document)');
    assert.equal(JSON.stringify(desktop), JSON.stringify(browser));
    dom.window.close();
});

test('fitted paper overrides receipt styles in the body, including after refitting', () => {
    const dom = new JSDOM('<style>@page{size:auto}</style><article class="rd-document" data-receipt-design="80"></article>');
    const doc = dom.window.document;
    doc.querySelector('article').getBoundingClientRect = () => ({ height: 400 });
    fitDocument(doc);
    const laterStyle = doc.createElement('style');
    laterStyle.textContent = '@page{size:auto}';
    doc.body.appendChild(laterStyle);
    fitDocument(doc);
    assert.equal(doc.body.lastElementChild.id, 'rd-fitted-paper');
    const styles = Array.from(doc.querySelectorAll('style'));
    assert.match(styles[styles.length - 1].textContent, /@page\{size:80mm 106\.1mm/);
    assert.equal(doc.querySelectorAll('#rd-fitted-paper').length, 1);
    dom.window.close();
});

test('sheet sizes stay unchanged and an unmeasurable thermal receipt fails clearly', () => {
    for (const format of ['a4', 'a5', 'letter', '80']) {
        const dom = new JSDOM('<article class="rd-document" data-receipt-design="' + format + '"></article>');
        if (format === '80') assert.throws(() => fitDocument(dom.window.document), /could not be measured/);
        else assert.equal(fitDocument(dom.window.document), null);
        assert.equal(dom.window.document.querySelector('#rd-fitted-paper'), null);
        dom.window.close();
    }
});
