jest.mock('../../../src/models/base.model', () => ({ getDb: jest.fn() }));
const BaseModel = require('../../../src/models/base.model');
const { ObjectId } = require('mongodb');
const { defaultTax, applyDefaultTax } = require('../../../src/services/quick-sale-tax');
const context={branchId:new ObjectId(),licenseId:new ObjectId()};
const id=new ObjectId();
let branch, tax, findBranch, findTax;
beforeEach(()=>{
  branch={default_tax:id};tax={_id:id,name:'GST',rate:5};
  findBranch=jest.fn(async()=>branch);findTax=jest.fn(async()=>tax);
  BaseModel.getDb.mockResolvedValue({collection:name=>({findOne:name==='branches'?findBranch:findTax})});
});
test('tax quote and stored quick sale use the scoped server default, overriding client zero tax',async()=>{
  const quote=await defaultTax(context);
  const data=await applyDefaultTax({items_selling_price:100,items_tax:0,items_tax_type:'inclusive',quick_sale_tax:quote},context);
  expect(data).toMatchObject({items_selling_price:100,items_tax:5,items_tax_type:'exclusive',items_tax_id:String(id),items_tax_name:'GST'});
  expect(findBranch.mock.calls[0][0]).toEqual({_id:context.branchId,license:context.licenseId});
  expect(findTax.mock.calls[0][0]).toEqual({_id:id,branch_id:context.branchId,license:context.licenseId});
});
test('missing or inaccessible default never silently becomes zero tax',async()=>{
  branch={};await expect(defaultTax(context)).rejects.toThrow(/Configure/);
  branch={default_tax:id};tax=null;await expect(defaultTax(context)).rejects.toThrow(/unavailable/);
});
test('explicit configured zero rate is valid, but stale quotes are rejected',async()=>{
  tax.rate=0;expect((await defaultTax(context)).rate).toBe(0);
  await expect(applyDefaultTax({items_selling_price:100,quick_sale_tax:{id:String(id),rate:5}},context)).rejects.toThrow(/changed/);
});
test.each([0,-1,Infinity,'bad',1000001])('rejects invalid entered amount %s',async amount=>{
  await expect(applyDefaultTax({items_selling_price:amount},context)).rejects.toThrow(/valid/);
});
