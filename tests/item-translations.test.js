'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const text = require('../api/src/utils/item-localization');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const item = { name: 'Coffee', description: 'Fresh roasted beans', default_language: 'en',
  translations: [{locale: 'nl', name: 'Koffie', description: 'Vers gebrande bonen'}, {locale: 'ar', name: 'قهوة'}] };

test('localized names use exact locale, parent locale, then original without changing identity', () => {
  const record = {...item, id: 'one', barcode: '123', price: 20, quantity: 4};
  assert.equal(text.name(record, 'nl-NL'), 'Koffie');
  assert.equal(text.name(record, 'fr'), 'Coffee');
  assert.equal(text.name(record, 'nl', true), 'Koffie / Coffee');
  assert.equal(text.name(record, 'en', true), 'Coffee');
  assert.equal(text.text(record, 'ar', 'description'), 'Fresh roasted beans');
  const view = text.display(record, 'nl');
  assert.equal(view.id, 'one'); assert.equal(view.barcode, '123'); assert.equal(view.price, 20); assert.equal(view.quantity, 4);
  assert.equal(text.display(view, 'ar').name, 'قهوة');
  assert.equal(text.display(view, 'fr').name, 'Coffee');
  assert.equal(record.name, 'Coffee');
});

test('invalid shapes, duplicate locales, overlong text and operator keys are rejected', () => {
  for (const value of [{nl: 'Coffee'}, [{locale: '$where'}], [{locale: '__proto__'}], [{locale: 'nl', name: {$ne:''}}],
    [{locale:'nl', name:'x'.repeat(201)}], [{locale:'en-us'}, {locale:'en-US'}], Array.from({length:61}, () => ({locale:'nl'}))]) {
    assert.throws(() => text.normalize(value));
  }
  assert.deepEqual(text.normalize([{locale:'NL',name:' Koffie ', description:' '}]), [{locale:'nl',name:'Koffie'}]);
  assert.deepEqual(text.normalize([{locale:'nl',name:' '}]), []);
});

test('sale snapshots preserve translated names without catalogue descriptions', () => {
  const snapshot = text.snapshot(item);
  assert.equal(snapshot.translations[0].name, 'Koffie');
  assert.ok(snapshot.translations.every(row => !('description' in row)));
  assert.equal(JSON.stringify(snapshot).includes('beans'), false);
  assert.deepEqual(text.snapshot({name:'old item'}), {});
  item.translations[0].name = 'Later correction';
  assert.equal(snapshot.translations[0].name, 'Koffie');
  item.translations[0].name = 'Koffie';
});

function editor(t) {
  const dom = new JSDOM(read('frontend/modules/items_write.html'), {runScripts:'outside-only', url:'http://localhost/'});
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = async () => { throw new Error('offline'); };
  w.confirm = () => true;
  w.PosnicPro = {i18n:{t:(_key,value)=>value,code:()=> 'en'}, alert:()=>{}};
  w.eval(read('api/src/utils/item-localization.js'));
  w.eval(read('frontend/static/script/js/modules/js/item-translations.js'));
  const field = id => w.document.getElementById(id);
  field('items_name').value = item.name; field('items_description').value = item.description;
  w.PosnicPro.itemTranslations.reset(item);
  function change(id, value) { field(id).value = value; field(id).dispatchEvent(new w.Event('change')); }
  return {w,field,change, api:w.PosnicPro.itemTranslations};
}

test('compact editor switches languages without losing unsaved text; saves and resets offline', t => {
  const e = editor(t);
  assert.equal(e.field('item_translation_panel').hidden, true);
  e.field('item_translation_toggle').click();
  assert.equal(e.field('item_translation_toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(e.field('item_translation_name').value, 'Koffie');
  e.field('item_translation_name').value = 'Koffie groot';
  e.field('item_translation_chips').children[1].click();
  assert.equal(e.field('item_translation_name').getAttribute('lang'), 'ar');
  assert.equal(e.field('item_translation_name').getAttribute('dir'), 'auto');
  e.field('item_translation_name').value = 'قهوة كبيرة';
  e.field('item_translation_chips').children[0].click();
  assert.equal(e.field('item_translation_name').value, 'Koffie groot');
  assert.equal(e.api.data().translations[1].name, 'قهوة كبيرة');
  assert.equal(e.field('items_name').value, 'Coffee');
  e.api.reset(); assert.equal(e.api.data().translations.length, 0);
  assert.equal(e.field('item_translation_panel').hidden, true);
});

test('add/remove languages is keyboard operable, empty fields fall back and text stays inert', t => {
  const e = editor(t);
  e.field('item_translation_toggle').click();
  e.change('item_translation_language', 'ja');
  assert.equal(e.field('item_translation_name'), e.w.document.activeElement);
  e.field('item_translation_name').value = '<img src=x onerror=alert(1)>';
  e.field('item_translation_chips').children[0].click();
  e.field('item_translation_chips').children[2].click();
  assert.equal(e.field('item_translation_panel').querySelectorAll('img').length, 0);
  assert.equal(e.api.data().translations[2].name, '<img src=x onerror=alert(1)>');
  e.field('item_translation_remove').click();
  assert.equal(e.api.data().translations.length, 2);
  e.change('item_original_language','nl');
  assert.equal(e.field('item_original_language').value, 'en');
});

test('deployed storefronts and Electron share identical resolver and packaged desktop copy', () => {
  const canonical = read('api/src/utils/item-localization.js');
  for (const copy of ['src/item-localization.js','menu/item-localization.js','order/assets/item-localization.js']) assert.equal(read(copy),canonical,copy);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('src/item-localization.js'));
});

test('customer menu offers available native-language options and resolves Dutch selection', t => {
  const dom = new JSDOM('<button data-lang-toggle></button>',{url:'http://localhost/menu/shop?lang=nl',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window;
  w.eval(read('menu/item-localization.js')); w.eval(read('menu/i18n.js'));
  w.i18n.registerItems([item]);
  const select=w.document.querySelector('[data-catalogue-language]');
  assert.ok(select); assert.equal(select.value,'nl');
  assert.equal(w.PosnicItemText.display(item,w.i18n.lang).name,'Koffie');
  assert.ok(select.textContent.includes('Nederlands'));
});


test('a translated description cannot become the original after switching languages', () => {
  const value = {name:'Coffee',description:'',translations:[{locale:'nl',description:'Menu text'}]};
  assert.equal(text.display(text.display(value,'nl'),'fr').description,'');
});
