const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
function setup(branches = [{id:'a',name:'Main'},{id:'b',name:'City'}]) {
  const dom = new JSDOM('<div id="wording-editor"></div>', {runScripts:'outside-only'});
  const state = {revision:1,profiles:[{id:'p',draft:{name:'Shop',locale:'en',rules:[{from:'Item',to:'Product'}],overrides:{'posnic.a':'Special'}},revisions:[]}],assignments:{a:{en:{profileId:'p'}},b:{en:{profileId:'p'}}}};
  const requests=[];
  dom.window.confirm=()=>true;
  dom.window.PosnicPro={local:{get:()=> 'super_admin'},i18n:{t:(_,v)=>v},get:(url,cb)=>{
    requests.push(url);
    cb({type:'success',data:url.endsWith('/labels')?[{id:'posnic.a',english:'A',module:'Core'}]:{state,writable:true,locales:['en','ta'],branches}});
  },put:(req,cb)=>{
    const body=JSON.parse(req.data);requests.push(body);
    let p=state.profiles.find(p=>p.id===body.id);if(!p){p={id:'copy',revisions:[]};state.profiles.push(p);}p.draft=body;state.revision++;cb({type:'success',data:state});
  },post:(req,cb)=>{const body=JSON.parse(req.data);requests.push({url:req.url,...body});state.revision++;if(req.url.endsWith('/remove')){state.profiles.find(p=>p.id===body.id).deletedAt='today';state.assignments={};}cb({type:'success',data:state});}};
  dom.window.eval(fs.readFileSync('frontend/static/script/js/modules/js/wording-editor.js','utf8'));dom.window.PosnicPro.wordingEditor.open();
  const q=s=>dom.window.document.querySelector(s), event=(s,type)=>q(s).dispatchEvent(new dom.window.Event(type,{bubbles:true}));
  return {dom,q,event,requests};
}
test('catalog loads only on Advanced, added wording stays first, and branch selection is independent',()=>{
  const {dom,q,event,requests}=setup();
  assert.deepEqual(requests,['settings/wording?catalog=0']);assert.equal(q('#wording-search'),null);
  assert.equal(dom.window.document.querySelectorAll('[data-branch]:checked').length,2);
  q('[data-branch="b"]').checked=false;event('[data-branch="b"]','change');
  q('#wording-tab-advanced').click();q('#wording-tab-words').click();q('#wording-tab-advanced').click();
  assert.equal(requests.filter(x=>x==='settings/wording/labels').length,1);
  assert.match(q('#wording-added').textContent,/Item → Product/);assert.equal(q('[data-added-word]').value,'Special');
  q('#wording-publish').click();assert.deepEqual(requests.at(-1).branches,['a']);dom.window.close();
});
test('duplicate starts unassigned, rename saves and delete explains persisted assignments',()=>{
  const {dom,q,event,requests}=setup();q('#wording-rename').click();
  q('#wording-name').value='Renamed';q('#wording-profile-save').click();assert.equal(requests.at(-1).name,'Renamed');
  q('#wording-duplicate').click();q('#wording-profile-save').click();assert.equal(dom.window.document.querySelectorAll('[data-branch]:checked').length,0);
  q('#wording-publish').click();assert.equal(requests.at(-2).name,'Renamed copy');assert.deepEqual(requests.at(-1).branches,[]);
  q('#wording-profile').value='p';event('#wording-profile','change');q('#wording-delete').click();assert.match(q('#wording-delete-impact').textContent,/Main, City/);
  q('#wording-delete-no').click();assert.equal(requests.some(x=>x.url?.endsWith('/remove')),false);
  q('#wording-delete').click();q('#wording-delete-yes').click();assert.equal(requests.at(-1).url,'settings/wording/remove');assert.match(q('#wording-notice').textContent,/deleted/);dom.window.close();
});


test('single accessible branch is implicit when saving, while multiple branches show the selector',()=>{
  const single=setup([{id:'a',name:'Main'}]);
  assert.equal(single.q('#wording-branch-picker').hidden,true);
  single.q('#wording-new').click();
  single.q('#wording-name').value='New shop';single.q('#wording-profile-save').click();
  single.q('#wording-publish').click();
  assert.deepEqual(single.requests.at(-1).branches,['a']);
  single.dom.window.close();
  const multiple=setup();assert.equal(multiple.q('#wording-branch-picker').hidden,false);multiple.dom.window.close();
});


test('deleting the last profile returns to create-only state and cancel does not recreate it',()=>{
 const {dom,q,requests}=setup();q('#wording-delete').click();q('#wording-delete-yes').click();
 assert.ok(q('#wording-create'));assert.equal(q('#wording-publish'),null);assert.equal(q('#wording-tab-advanced'),null);assert.equal(q('#wording-profile-title'),null);
 const count=requests.length;q('#wording-create').click();q('#wording-profile-save').click();assert.equal(requests.length,count);assert.match(q('#wording-notice').textContent,/name/);
 q('#wording-profile-cancel').click();assert.ok(q('#wording-create'));assert.equal(requests.length,count);dom.window.close();
});

test('renaming preserves pending branch selection',()=>{
 const {dom,q,event}=setup();q('[data-branch="b"]').checked=false;event('[data-branch="b"]','change');
 q('#wording-rename').click();q('#wording-name').value='Renamed';q('#wording-profile-save').click();
 assert.equal(q('[data-branch="b"]').checked,false);assert.match(q('#wording-notice').textContent,/Unsaved/);dom.window.close();
});
