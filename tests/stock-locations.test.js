const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,read}=require('../api/src/helpers/stock-locations');
test('stock locations are bounded labels with explicit clearing',()=>{
 assert.deepEqual(normalize([' Rack 5 ','rack 5','Shelf 2']),['Rack 5','Shelf 2']);
 assert.deepEqual(normalize([]),[]);
 assert.deepEqual(read({}),[]);
 for(const value of [null,{},[''],['a'.repeat(121)],Array(13).fill('x'),['line\nline'],[3]]) assert.throws(()=>normalize(value));
});
