const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(require.resolve('puppeteer', { paths: [path.join(root, 'api')] }));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
test('item editor follows the dashboard theme and toolbar stays at the viewport top', async () => {
 const browser = await puppeteer.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  for (const theme of ['default', 'dark']) {
   for (const notice of [false,true]) {
    await page.setContent(`<html data-theme="${theme}"><head><style>${read('frontend/static/style/css/style.css')}\n${read('frontend/static/style/css/theme-variables.css')}\n${read('frontend/static/style/css/modules/items-v2.css')}</style></head><body><div class="rightbar">${notice?'<div id="offline_recovery_notice">Recovery notice</div>':''}<div class="topbar">Toolbar</div>${read('frontend/modules/items_v2.html').replace('style="display:none"','style="display:block"')}</div></body></html>`);
    await page.evaluate(()=>scrollTo(0,0));
    const before = await page.evaluate(() => {
     const css = s => getComputedStyle(document.querySelector(s));
     return {surface:css('.iv2-form').backgroundColor, input:css('#iv2-name').backgroundColor, text:css('#iv2-name').color, title:document.querySelector('#iv2-title').getBoundingClientRect().top, bottom:document.querySelector('.topbar').getBoundingClientRect().bottom};
    });
    assert.equal(before.surface, theme==='dark'?'rgb(37, 37, 38)':'rgb(255, 255, 255)');
    assert.equal(before.input,before.surface);
    assert.notEqual(before.text,before.surface);
    assert.ok(before.title>=before.bottom, 'title clears toolbar, with and without notice');
    await page.evaluate(()=>scrollTo(0,400));
    assert.equal(await page.$eval('.topbar',e=>e.getBoundingClientRect().top),0,'toolbar cannot float below the top after scrolling');
   }
  }
 } finally { await browser.close(); }
});
