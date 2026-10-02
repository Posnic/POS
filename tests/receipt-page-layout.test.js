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
        const printableWidth = format === '80' ? 72 : 48;
        assert.equal(fitted.width, printableWidth * 1000);
        assert.equal(fitted.height, 106100);
        assert.match(doc.querySelector('#rd-fitted-paper').textContent, new RegExp('@page\\{size:' + printableWidth + 'mm 106.1mm;margin:0;'));
        height = 200;
        assert.equal(fitDocument(doc).height, 53200);
        assert.equal(doc.querySelectorAll('#rd-fitted-paper').length, 1);
        dom.window.close();
    }
});

test('the serialized Electron fitter preserves content-sized paper', () => {
    const dom = new JSDOM('<article class="rd-document" data-receipt-design="80"></article>', { runScripts: 'outside-only' });
    dom.window.document.querySelector('article').getBoundingClientRect = () => ({ height: 760 });
    const direct = fitDocument(dom.window.document);
    const desktop = dom.window.eval('(' + fitDocument.toString() + ')(document)');
    assert.equal(JSON.stringify(desktop), JSON.stringify(direct));
    dom.window.close();
});

test('browser dialogs use the selected printer paper without centring a smaller CSS page', () => {
    for (const format of ['58', '80']) {
        const dom = new JSDOM('<article class="rd-document" data-receipt-design="' + format + '"></article>');
        const doc = dom.window.document;
        doc.querySelector('article').getBoundingClientRect = () => ({ height: 400 });
        fitDocument(doc);
        const result = fitDocument(doc, { usePrinterPaper: true });
        const css = doc.querySelector('#rd-fitted-paper').textContent;
        assert.match(css, /@page\{size:auto;margin:0;\}/);
        assert.doesNotMatch(css, /size:\d/);
        assert.match(css, new RegExp('width:' + (format === '80' ? 72 : 48) + 'mm!important'));
        assert.match(css, /\.rd-document\{margin:0!important;\}/);
        assert.equal(result.height, 106100, 'The measured content remains available to desktop callers');
        assert.equal(doc.querySelectorAll('#rd-fitted-paper').length, 1);
        dom.window.close();
    }
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
    assert.match(styles[styles.length - 1].textContent, /@page\{size:72mm 106\.1mm/);
    assert.equal(doc.querySelectorAll('#rd-fitted-paper').length, 1);
    dom.window.close();
});

test('sheet sizes stay unchanged and an unmeasurable thermal receipt fails clearly', () => {
    for (const format of ['a4', 'a5', 'letter', '80']) {
        const dom = new JSDOM('<article class="rd-document" data-receipt-design="' + format + '"></article>');
        if (format === '80') assert.throws(() => fitDocument(dom.window.document), /could not be measured/);
        else {
            assert.equal(fitDocument(dom.window.document), null);
            assert.equal(fitDocument(dom.window.document, { usePrinterPaper: true }), null);
        }
        assert.equal(dom.window.document.querySelector('#rd-fitted-paper'), null);
        dom.window.close();
    }
});


test('receipt readiness waits for CSS before checking fonts and rejects failed images', async () => {
    const { prepareDocument } = require('../src/receipt-page-layout');
    const dom = new JSDOM('<link rel="stylesheet" href="/receipt.css"><article class="rd-document" data-receipt-design="80">Total 840.00</article>');
    const doc = dom.window.document;
    doc.querySelector('article').getBoundingClientRect = () => ({ height: 80 });
    let fontReads = 0, releaseFonts, ready = false;
    Object.defineProperty(doc, 'fonts', { value: { get ready() { fontReads++; return new Promise(resolve => { releaseFonts = resolve; }); }, [Symbol.iterator]: function* () {} } });
    const pending = prepareDocument(doc, true).then(() => { ready = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fontReads, 0, 'fonts must not be checked before the stylesheet arrives');
    doc.querySelector('link').dispatchEvent(new dom.window.Event('load'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    releaseFonts(); await pending;
    assert.equal(ready, true);
    doc.querySelector('link').remove();
    doc.querySelector('article').innerHTML += '<img src="/broken.png">';
    Object.defineProperty(doc.images[0], 'complete', { value: true });
    await assert.rejects(prepareDocument(doc, true), /receipt image/);
    dom.window.close();
});

test('receipt readiness times out instead of printing unfinished assets', async () => {
    const { prepareDocument } = require('../src/receipt-page-layout');
    const dom = new JSDOM('<link rel="stylesheet" href="/slow.css"><p>Total 840.00</p>');
    await assert.rejects(prepareDocument(dom.window.document, false, { timeoutMs: 15 }), /Nothing was printed/);
    dom.window.close();
});

test('thermal capture waits for paint acknowledgement and cleans up on failure', async () => {
    const { EventEmitter } = require('node:events');
    const { waitForReceiptPaint } = require('../src/escpos-unicode');
    const contents = new EventEmitter();
    let invalidations = 0, ready = false;
    contents.invalidate = () => { invalidations++; };
    const pending = waitForReceiptPaint(contents).then(() => { ready = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(invalidations, 1); assert.equal(ready, false);
    contents.emit('paint'); await pending;
    assert.equal(contents.listenerCount('paint'), 0);
    await assert.rejects(waitForReceiptPaint(contents, 15), /Nothing was printed/);
    assert.equal(contents.listenerCount('paint'), 0);
    assert.equal(contents.listenerCount('destroyed'), 0);
});
