'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {exportSale}=require('../src/v1/accounting-source');
const oid=value=>({_bsontype:'ObjectId',toHexString:()=>value});
test('stored sale values retain type and amount without defaults or source mutation',()=>{
 const sale={_id:'abc',license:'shop',sales_total:'105.00',paid_amount:105,tax:'5.00',items:[{quantity:1,total:'105.00',tax_amount:'5.00',pricing:{version:1,currency:{currencyCode:'AED',currencyDigits:2}}}]};
 const before=structuredClone(sale),first=exportSale(sale,'shop');assert.deepEqual(sale,before);
 const data=JSON.parse(first.sourceJson);assert.equal(data.values.sales_total,'105.00');assert.equal(data.values.paid_amount,105);assert.equal(Object.hasOwn(data.values,'currencyCode'),false);
 assert.deepEqual(exportSale(Object.fromEntries(Object.entries(sale).reverse()),'shop'),first);
 assert.notEqual(exportSale({...sale,paid_amount:100},'shop').revision,first.revision);
});
test('ObjectId and same-looking string remain different source/customer identities',()=>{
 const id='a'.repeat(24),one=exportSale({_id:oid(id),license:'shop',customer_id:oid(id),customer:id},'shop'),two=exportSale({_id:id,license:'shop'},'shop');
 assert.notEqual(one.revision,two.revision);assert.equal(one.sourceId.kind,'objectId');assert.equal(two.sourceId.kind,'string');
 const refs=JSON.parse(one.sourceJson).customerReferences;assert.equal(refs.customerId.kind,'objectId');assert.equal(refs.legacyCustomer.kind,'string');
});
test('unknown private fields never leave the field allowlist, including nested data',()=>{
 const output=exportSale({_id:'a',license:'shop',password:'SECRET',_syncMeta:{token:'SECRET'},items:[{name:'Item',password:'SECRET',pricing:{version:1,secret:'SECRET',currency:{currencyCode:'AED',currencyDigits:2,private:'SECRET'}}}],payments:[{amount:10,token:'SECRET',tenders:[{method:'cash',amount:10,secret:'SECRET'}]}]},'shop');
 assert.equal(output.sourceJson.includes('SECRET'),false);assert.equal(Object.hasOwn(JSON.parse(output.sourceJson).values.payments[0],'id'),false);
});
test('tenant mismatch, invalid identities, unsafe numbers and unsupported shapes refuse export',()=>{
 for(const patch of [{license:'other'},{_id:5},{_id:''},{_id:'bad\nvalue'},{sales_total:Infinity},{paid_amount:Number.MAX_SAFE_INTEGER+1},{items:{}},{items:[null]},{items:Array(1001).fill({})},{customer_id:{name:'Unknown'}},{payments:[{amount:{secret:1}}]}])assert.throws(()=>exportSale({_id:'a',license:'shop',...patch},'shop'),{code:'accounting_source_unsupported'});
});
