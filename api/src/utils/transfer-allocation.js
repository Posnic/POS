'use strict';
const {createHash}=require('node:crypto');
const Money=require('./currency');
const orderLine=require('./order-line');
const active=items=>(items||[]).filter(line=>line&&!line.return&&!line.cancelled&&
  !['cancelled','canceled'].includes(String(line.status||'').toLowerCase())&&
  Number(line.quantity??line.item_quantity??line.qty)>0&&String(line.name||line.item_name||'').trim());
const fail=()=>{throw Object.assign(new Error('The bill changed. Refresh before continuing.'),{status:409});};
const fields=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
function fingerprint(sale,policy,allocation) {
  return createHash('sha256').update(JSON.stringify({currency:policy.currencyCode,digits:policy.currencyDigits,
    lines:active(sale.items).map(line=>({key:orderLine.key(line),product:orderLine.product(line),name:String(line.name||line.item_name||'').trim(),quantity:Number(line.quantity??line.item_quantity??line.qty),
      rate:line.unit_price??line.item_base_price??line.item_price,tax:line.item_tax??line.tax_amount,
      // Desktop readers use different aliases from the Captain bill reader.
      // Bind every stored amount/quantity alias, not just the first one found.
      financial:fields(line,['quantity','item_quantity','qty','unit_price','item_base_price','item_price',
        'item_total','total','total_amount','item_discount','item_tax','tax_amount','tax','tax_type',
        'cgst_tax','sgst_tax','igst_tax','tax_components'])})),
    subtotal:sale.sales_sub_total,discount:sale.discount,tax:sale.tax,round:sale.round_off,total:sale.sales_total,
    financial:fields(sale,['subtotal','total','items_subtotal','items_total','sales_tax','sales_round_off']),
    allocation:{lines:allocation.lines,components:allocation.components,totalMinor:allocation.totalMinor},
  })).digest('hex');
}
function seal(sale,branch,side) {
  const policy=Money.policy(branch);
  const allocation={version:1,currencyCode:policy.currencyCode,currencyDigits:policy.currencyDigits,
    lines:structuredClone(side.lines),components:structuredClone(side.components),totalMinor:side.totalMinor};
  allocation.fingerprint=fingerprint(sale,policy,allocation);
  read({...sale,captain_transfer_allocation:allocation},branch);
  return allocation;
}
function read(sale,branch) {
  const value=sale.captain_transfer_allocation;
  if(!value)return null;
  const policy=Money.policy(branch),items=active(sale.items);
  if(value.version!==1||value.currencyCode!==policy.currencyCode||value.currencyDigits!==policy.currencyDigits||
      value.fingerprint!==fingerprint(sale,policy,value)||!Array.isArray(value.lines)||value.lines.length!==items.length)fail();
  const totals=Object.create(null);let total=0;
  for(const [index,line] of value.lines.entries()) {
    if(line.lineKey!==orderLine.key(items[index])||line.quantity!==Number(items[index].quantity??items[index].item_quantity??items[index].qty)||!Array.isArray(line.components))fail();
    const keys=new Set();let amount=0;
    for(const component of line.components) {
      if(typeof component.key!=='string'||keys.has(component.key)||!Number.isSafeInteger(component.minor)||Math.abs(component.minor)>1e12)fail();
      keys.add(component.key);amount+=component.minor;
      totals[component.key]=(totals[component.key]||0)+component.minor;
    }
    if(line.billDiscountMinor!==undefined && (!Number.isSafeInteger(line.billDiscountMinor) ||
        line.billDiscountMinor<0 || line.billDiscountMinor>1e12 ||
        line.billDiscountMinor>-(line.components.find(row=>row.key==='discount')?.minor||0)))fail();
    if(amount!==line.amountMinor)fail();total+=amount;
  }
  if(total!==value.totalMinor||total!==Money.toMinor(sale.sales_total,policy)||
      Object.keys(totals).length!==Object.keys(value.components||{}).length||
      Object.entries(totals).some(([key,amount])=>value.components[key]!==amount))fail();
  const tax=Object.entries(totals).filter(([key])=>key.startsWith('tax:')).reduce((sum,[,amount])=>sum+amount,0);
  if((totals.base||0)!==Money.toMinor(sale.sales_sub_total,policy)||
      -(totals.discount||0)!==Money.toMinor(sale.discount,policy)||tax!==Money.toMinor(sale.tax,policy)||
      (totals.adjustment||0)!==Money.toMinor(sale.round_off,policy))fail();
  return value;
}
module.exports={seal,read};
