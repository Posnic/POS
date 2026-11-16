const test=require('node:test');
const assert=require('node:assert/strict');
const {isSameOriginRequest}=require('../api/src/middleware/cors-origins');
test('DNS trailing root dot does not break the same shop origin behind a proxy',()=>{
 for(const [origin,host] of [['https://shop.posnic.io.','shop.posnic.io'],['https://shop.posnic.io','shop.posnic.io.'],['https://SHOP.posnic.io.:443','shop.posnic.io']]) assert.equal(isSameOriginRequest(origin,{headers:{host}}),true);
});
test('canonical DNS matching does not allow other shops, suffix attacks, ports or opaque origins',()=>{
 for(const origin of ['https://other.posnic.io.','https://shop.posnic.io.evil.test','https://shop.posnic.io.:444','null','file://shop.posnic.io','https://shop.posnic.io..']) assert.equal(isSameOriginRequest(origin,{headers:{host:'shop.posnic.io'}}),false,origin);
});
