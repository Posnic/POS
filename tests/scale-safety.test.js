const test=require('node:test'),assert=require('node:assert/strict');
const {parseFrame}=require('../src/scale-parser');
test('unsupported units and unconfigured decimal commas cannot be billed',()=>{
 for(const frame of ['0,375 kg','1 mg','15 pcs','20 %','3 ozt']) assert.equal(parseFrame(frame),null,frame);
 assert.equal(parseFrame('0,375 kg',{decimalSeparator:','}).kg,0.375);
});
test('Essae unchanged frames still refresh the sale reader',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),sent=[];
 const sandbox={module:{exports:{}},require:id=>id==='electron'?{BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(_,v)=>sent.push(v)}}]}}:require(id),Buffer,console,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/essae-weight-reader.js'),'utf8'),sandbox);
 const reader=new sandbox.module.exports.EssaeWeightReader();reader._processWeight(.375);reader._processWeight(.375);
 assert.equal(sent.length,2);assert.equal(sent[1].weight,.375);
});
