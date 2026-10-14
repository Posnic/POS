const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { blockAt } = require('./helpers/source-lookup');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js', 'utf8');
function setup(role, enabled) {
    const dom = new JSDOM('<div id="sales_doc"></div><div class="removeText"></div>', {runScripts:'outside-only'});
    const w = dom.window, $ = w.$ = w.jQuery = require('jquery')(w);
    const calls = [];
    w.PosnicPro = {i18n:{t:(_k,v)=>v},local:{get:k=>k==='usertype'?role:k==='allow_sale_hard_delete'?enabled:''},
        restaurantSaleDetails:{render:()=>''},sales:{buildSaleSheet:()=>''},
        alert:()=>{},deleteTableRowData:(id,type)=>calls.push({id,type}),deleteConfirmation:false};
    for (const method of ['renderSaleDoc','showDelete']) {
        const fn = blockAt(source, '    '+method+': function (');
        w.eval('PosnicPro.sales.'+method+' = '+fn.slice(fn.indexOf('function')));
    }
    return {dom,w,$,calls};
}
test('super admin sees Delete sale below Return items and gets the stock warning before confirmation',()=>{
    const h=setup('super_admin','true');
    try {
        h.w.PosnicPro.sales.renderSaleDoc({_id:'bill',sales_id:'S-1',payment_status:'Paid'});
        const actions=h.$('#sales_doc .dropdown-item').map((_,e)=>h.$(e).text()).get();
        assert.equal(actions[actions.indexOf('Return items')+1],'Delete sale');
        h.w.PosnicPro.sales.showDelete('bill');
        assert.deepEqual(h.calls,[{id:'bill',type:'sales'}]);
        assert.match(h.$('.removeText').text(),/Recycle Bin.*Stock will be added back.*Untracked items are not changed/);
        assert.equal(h.w.PosnicPro.deleteConfirmation,false);
    } finally {h.dom.window.close();}
});
test('disabled deletion and non-super-admin roles expose no delete action',()=>{
    for (const [role,enabled] of [['super_admin','false'],['admin','true'],['normal','true']]) {
        const h=setup(role,enabled);
        try {
            h.w.PosnicPro.sales.renderSaleDoc({_id:'bill',sales_id:'S-1',payment_status:'Paid'});
            assert.doesNotMatch(h.$('#sales_doc').text(),/Delete sale/);
            h.w.PosnicPro.sales.showDelete('bill');
            assert.equal(h.calls.length,0);
        } finally {h.dom.window.close();}
    }
});
