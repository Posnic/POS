const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(require.resolve('puppeteer', { paths: [path.join(root, 'api')] }));
const sass = require(require.resolve('sass', { paths: [path.join(root, 'frontend')] }));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('desktop toolbar clears titlebar and recovery codes remain readable in both themes', async () => {
 const css = read('frontend/static/style/css/bootstrap.min.css') + sass.renderSync({file:path.join(root,'frontend/static/style/scss/style.scss'), logger:{warn(){},debug(){}}}).css.toString();
 const browser = await puppeteer.launch({headless:true});
 try {
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  for (const theme of ['default','dark']) {
   await page.setContent(`<html class="is-electron" data-theme="${theme}"><head><style>${css}\n${read('frontend/static/style/css/theme-variables.css')}</style></head><body><div class="posnic-titlebar">GSHCL</div><div class="rightbar"><div class="topbar">Toolbar</div><div style="height:1800px">Items</div></div><section id="offline_recovery_settings"><span id="offline_recovery_status"></span><button id="offline_recovery_manage">Recovery</button></section></body></html>`);
   await page.evaluate(() => {
    window.jQuery = fn => fn();
    window.PosnicPro = {i18n:{t:(_,text)=>text,say:x=>x},get:(url,ok)=>ok({data:url.endsWith('/options')?{offline:true}:{eligible:true,remaining:0}}),post:(_,ok)=>ok({data:{recoveryAccount:'fixture@example.test',recoveryCodes:['TEST-ONLY-NOT-A-REAL-RECOVERY-CODE']}})};
   });
   await page.addScriptTag({content:read('frontend/static/script/js/core/offline-recovery.js')});
   await page.waitForSelector('#offline_recovery_notice button');
   for (const scroll of [0,400]) {
    await page.evaluate(y=>scrollTo(0,y),scroll);
    const rect = await page.evaluate(()=>({bar:document.querySelector('.topbar').getBoundingClientRect().top,title:document.querySelector('.posnic-titlebar').getBoundingClientRect().bottom}));
    assert.equal(rect.bar,rect.title,'toolbar must clear desktop chrome even after scrolling');
   }
   await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#offline_recovery_notice button').click();document.querySelector('dialog form').dispatchEvent(new Event('submit',{cancelable:true}));});
   await page.waitForSelector('dialog pre');
   const colors = await page.evaluate(()=>{const d=getComputedStyle(document.querySelector('dialog'));const p=getComputedStyle(document.querySelector('dialog pre'));return {text:d.color,bg:d.backgroundColor,codes:p.color};});
   assert.equal(colors.codes,colors.text);
   assert.notEqual(colors.codes,colors.bg);
   assert.equal(colors.text,theme==='dark'?'rgb(255, 255, 255)':'rgb(22, 32, 58)');
   fs.mkdirSync(path.join(root,'output'),{recursive:true});
   await page.screenshot({path:path.join(root,`output/recovery-${theme}-proof.png`)});
  }
 } finally { await browser.close(); }
});
