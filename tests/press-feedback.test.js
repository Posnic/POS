const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source=fs.readFileSync('frontend/static/script/js/core/PosnicPro.js','utf8').split('// Immediate acknowledgement of a press, independent of later server success.')[1];
test('press feedback acknowledges pointer and keyboard actions without submitting or cancelling the click',()=>{
 const dom=new JSDOM('<button><span>Serve</span></button><input><button disabled>Disabled</button><a href="#">Action</a>',{runScripts:'outside-only'}),w=dom.window;
 try {
 let calls=0,cancels=0,clicks=0,reduced=false;
 w.matchMedia=()=>({matches:reduced});w.Element.prototype.animate=function(){calls++;return{cancel(){cancels++;}};};w.eval(source);
 const b=w.document.querySelector('button');b.onclick=()=>clicks++;
 b.firstChild.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0}));assert.equal(calls,1);assert.equal(clicks,0);
 b.click();assert.equal(clicks,1);
 b.dispatchEvent(new w.KeyboardEvent('keydown',{bubbles:true,key:'Enter'}));assert.equal(calls,2);assert.equal(cancels,1);
 b.dispatchEvent(new w.KeyboardEvent('keydown',{bubbles:true,key:'Enter',repeat:true}));assert.equal(calls,2);
 w.document.querySelector('button:disabled').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true}));assert.equal(calls,2);
 w.document.querySelector('input').dispatchEvent(new w.KeyboardEvent('keydown',{bubbles:true,key:' '}));assert.equal(calls,2);
 w.document.querySelector('a').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:2}));assert.equal(calls,2);
 reduced=true;b.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true}));assert.equal(calls,2);
 } finally {w.close();}
});
