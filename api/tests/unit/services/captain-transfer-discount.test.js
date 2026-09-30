'use strict';
const {plan}=require('../../../src/services/captain-transfer-discount');
const fixture=()=>({lines:[
  {lineKey:'corn',quantity:1,amountMinor:103,components:[{key:'base',minor:100},{key:'discount',minor:-2},{key:'tax:Tax',minor:5}]},
  {lineKey:'soup',quantity:1,amountMinor:104,components:[{key:'base',minor:100},{key:'discount',minor:0},{key:'tax:Tax',minor:4}]}
],totalMinor:207,components:{base:200,discount:-2,'tax:Tax':9}});

test('allocates every penny while retaining prior item discounts and taxes',()=>{
  const side=fixture(),result=plan(side,11);
  expect(result.totalMinor).toBe(196);
  expect(result.components).toEqual({base:200,discount:-13,'tax:Tax':9});
  expect(result.lines.map(line=>line.billDiscountMinor)).toEqual([5,6]);
  expect(side).toEqual(fixture());
});
test('retry, replacement and clearing affect only the tracked bill discount',()=>{
  const first=plan(fixture(),11);
  expect(plan(first,11)).toEqual(first);
  expect(plan(first,19)).toEqual(plan(fixture(),19));
  const cleared=plan(first,0);
  expect(cleared.totalMinor).toBe(207);
  expect(cleared.components.discount).toBe(-2);
  expect(cleared.lines.every(line=>line.billDiscountMinor===0)).toBe(true);
});
test('full discount cannot make a dish negative and zero total remains repeatable',()=>{
  const result=plan(fixture(),207);
  expect(result.totalMinor).toBe(0);
  expect(result.lines.map(line=>line.amountMinor)).toEqual([0,0]);
  expect(plan(result,207)).toEqual(result);
  expect(plan(result,0).totalMinor).toBe(207);
});
test('large monetary products retain integer precision',()=>{
  const side=fixture();
  for(const line of side.lines){line.components=[{key:'base',minor:999999999999}];line.amountMinor=999999999999;}
  side.totalMinor=1999999999998;side.components={base:1999999999998};
  const result=plan(side,999999999999);
  expect(result.lines.map(line=>line.billDiscountMinor)).toEqual([500000000000,499999999999]);
  expect(result.totalMinor).toBe(999999999999);
});
test.each([-1,208,NaN,Infinity,0.5])('rejects invalid amount %s',amount=>{
  expect(()=>plan(fixture(),amount)).toThrow('Invalid bill discount');
});
test('rejects stale line amounts and invalid tracked discount before projection',()=>{
  const side=fixture();side.lines[0].amountMinor++;
  expect(()=>plan(side,1)).toThrow('Invalid bill discount');
  const stale=fixture();stale.lines[0].billDiscountMinor=3;
  expect(()=>plan(stale,1)).toThrow('Invalid bill discount');
});

test('every allowed amount conserves the bill and can be replaced without compounding',()=>{
  for(let amount=0;amount<=207;amount++){
    const result=plan(fixture(),amount);
    expect(result.totalMinor).toBe(207-amount);
    expect(result.lines.reduce((sum,line)=>sum+line.billDiscountMinor,0)).toBe(amount);
    expect(result.lines.every(line=>line.amountMinor>=0)).toBe(true);
    expect(plan(result,207-amount)).toEqual(plan(fixture(),207-amount));
  }
});
test('rejects a stale aggregate bill total',()=>{
  const side=fixture();side.totalMinor++;
  expect(()=>plan(side,1)).toThrow('Invalid bill discount');
});


describe('legacy discount formats',()=>{
  const {legacy}=require('../../../src/services/captain-transfer-discount');
  const bill=()=>({sales_sub_total:100,discount:5,extra_discount:10,extra_discount_type:'amount',sale_extra_discount:10,
    items:[{item_name:'Corn',item_quantity:2,item_discount:5}]});
  test.each(['JPY','INR','KWD'])('separate and combined formats normalize identically in %s',currencyCode=>{
    const policy=require('../../../src/utils/currency').policy({currencyCode}),factor=policy.factor;
    const original=bill(),separate=legacy(original,{currencyCode}),combined=legacy({...original,discount:15},{currencyCode});
    expect(separate).toEqual({storage:'separate',itemDiscountMinor:5*factor,billDiscountMinor:10*factor,totalDiscountMinor:15*factor});
    expect({...combined,storage:'separate'}).toEqual(separate);
    expect(original).toEqual(bill());
  });
  test('legacy percentage input uses the discounted subtotal rather than treating the rate as money',()=>{
    const original=bill();delete original.sale_extra_discount;original.extra_discount_type='percentage';
    expect(legacy(original,{currencyCode:'INR'}).billDiscountMinor).toBe(950);
  });
  test('stored final discount amount takes precedence over percentage input',()=>{
    const original=bill();original.extra_discount_type='percent';original.extra_discount=10;original.sale_extra_discount=8;
    expect(legacy(original,{currencyCode:'INR'}).billDiscountMinor).toBe(800);
  });
  test('inactive lines do not change the inferred storage convention',()=>{
    const original=bill();original.items.push({item_quantity:1,item_discount:999,cancelled:true});
    expect(legacy(original,{currencyCode:'INR'}).storage).toBe('separate');
  });
  test.each([{discount:7},{extra_discount:-1},{sale_extra_discount:NaN},{sale_extra_discount:-1}])('ambiguous or invalid stored data fails closed: %j',change=>{
    expect(()=>legacy({...bill(),...change},{currencyCode:'INR'})).toThrow('needs reconciliation');
  });
});
