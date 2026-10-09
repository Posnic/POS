'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('cart row opens editor once and leaves embedded actions alone', () => {
 const w = new JSDOM('<table><tr data-sale-edit="item1" tabindex="0"><td>Tea</td><td><button>+</button><input value="1"><a class="sale-line-edit" data-id="item1"><i>Edit</i></a><a class="sale-line-del"><i>Delete</i></a><span onclick="void(0)">Note</span></td></tr></table>', {runScripts:'outside-only'}).window;
 try {
 w.$ = require('jquery')(w); const opened=[]; let disabled=false;
 w.PosnicPro={local:{get:()=>disabled?'disable':'enable'},sales:{lineEdit:{open:id=>opened.push(id)}}};
 const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
 const start=source.indexOf("$(document).on('click', '.sale-line-edit'");
 const end=source.indexOf('\n/*',start);
 w.eval(source.slice(start,end));
 w.$('td').first().trigger('click'); assert.deepEqual(opened,['item1']);
 w.$('.sale-line-edit i').trigger('click'); assert.equal(opened.length,2);
 for(const selector of ['button','input','.sale-line-del i','[onclick]'])w.$(selector).trigger('click');
 assert.equal(opened.length,2);
 w.$('tr').trigger(w.$.Event('keydown',{key:'Enter'})); assert.equal(opened.length,3);
 w.$('input').trigger(w.$.Event('keydown',{key:'Enter'})); assert.equal(opened.length,3);
 disabled=true;w.$('td').first().trigger('click');assert.equal(opened.length,3);
 } finally {w.close();}
});
