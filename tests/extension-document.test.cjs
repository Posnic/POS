const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
test('provider documents preserve printable tables and raster barcodes but remove active content',()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});
 dom.window.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/core/extension-frame.js'),'utf8'));
 const safe=dom.window.PosnicExtensionFrame.sanitizeDocument('<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><style>td{color:black}</style></head><body><script>alert(1)</script><iframe src="https://evil.example"></iframe><form><input></form><table><tr><td onclick="alert(1)">Original</td></tr></table><img src="data:image/png;base64,AAAA" onerror="alert(1)"><img src="https://evil.example/pixel"><img src="data:image/svg+xml;base64,AAAA"></body></html>');
 const fragment=JSDOM.fragment(safe);
 assert.equal(fragment.querySelector('td').textContent,'Original');assert.ok(fragment.querySelector('style'));
 assert.equal(fragment.querySelectorAll('script,iframe,form,meta,input').length,0);
 assert.equal(fragment.querySelectorAll('[onclick],[onerror]').length,0);
 assert.deepEqual([...fragment.querySelectorAll('img')].map(n=>n.getAttribute('src')),['data:image/png;base64,AAAA',null,null]);
 dom.window.close();
});
