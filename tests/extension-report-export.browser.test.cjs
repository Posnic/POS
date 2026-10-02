'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('report bridge permits only bounded text and cleans up after exports and failures',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.route('https://report.test/',route=>route.fulfill({body:'<!doctype html><body></body>',contentType:'text/html'}));await page.goto('https://report.test/');
 const source=fs.readFileSync('frontend/static/script/js/modules/js/extensions.js','utf8');
 const helper=source.slice(source.indexOf('  async function exportReport('),source.indexOf('  function close()'));
 await page.evaluate(helper=>{
 window.exportReport=eval('('+helper.trim()+')');
 window.output=[];
 window.PosnicPro={reportExport:{csv:(id,meta)=>{output.push({text:document.getElementById(id).textContent,html:document.getElementById(id).innerHTML,meta})},xls:()=>{throw Error('export failed')}},lazy:{load:async()=>{throw Error('PDF unavailable')}}};
 },helper);
 const result=await page.evaluate(async()=>{
 const data={format:'csv',range:'2026-10-01 to 2026-10-31',rows:[['<img src=x onerror=alert(1)>','GBP','=1+1']]};
 await exportReport(data);let failures=0;
 for(const bad of [{...data,format:'email'},{...data,rows:Array(31).fill(['a','b','c'])},{...data,rows:[['a','b',1]]},{...data,format:'xls'},{...data,format:'pdf'}]){try{await exportReport(bad)}catch{failures++}}
 return {output,failures,left:document.querySelectorAll('[id^="extension-report-"]').length,images:document.querySelectorAll('img').length};
 });assert.equal(result.failures,5);assert.equal(result.left,0);assert.equal(result.images,0);assert.match(result.output[0].text,/'=1\+1/);assert.match(result.output[0].html,/&lt;img/);
 }finally{await browser.close()}
});
