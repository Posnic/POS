const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {blockAt}=require('./helpers/source-lookup');
const source=fs.readFileSync('frontend/static/script/js/modules/js/stocklog.js','utf8');
const fn=blockAt(source,'viewLowStockDashboard: function ()').replace('viewLowStockDashboard: ','');
for(const loaded of [false,true])test('restricted login does not request inventory-only bell data; ACL loaded='+loaded,()=>{
 let requests=0,hidden=0,bell;
 const context={PosnicPro:{aclLoaded:()=>loaded,checkAccess:()=>false,get:()=>requests++,post:()=>requests++,bellFeed:{setLowStock:n=>bell=n}},$:()=>({hide:()=>hidden++})};
 vm.runInNewContext('('+fn+')()',context);
 assert.equal(requests,0);assert.equal(hidden,1);assert.equal(bell,0);
});
