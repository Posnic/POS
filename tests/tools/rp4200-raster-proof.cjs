const { app }=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const result=process.argv[2];app.disableHardwareAcceleration();
app.whenReady().then(async()=>{try{
 const html=fs.readFileSync(path.join(__dirname,'../../output/rp4200/receipt.html'),'utf8');
 const bytes=await require('../../src/escpos-unicode').renderDesignedReceipt(html,'112');
 const rows=require('../../src/escpos-preview').parse(bytes,69).rows.filter(r=>r.kind==='raster');
 assert.ok(rows.length);assert.ok(rows.every(r=>r.wBytes===104));assert.ok(rows.some(r=>Buffer.from(r.data,'base64').some(b=>b!==0)));
 fs.writeFileSync(result,JSON.stringify({passed:true,widthDots:832,strips:rows.length,bytes:bytes.length}));
}catch(e){fs.writeFileSync(result,JSON.stringify({error:e.stack}));process.exitCode=1;}finally{app.quit();}});
