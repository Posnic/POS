'use strict';
const {createHash}=require('node:crypto');
const Money=require('./currency');
const orderLine=require('./order-line');
const active=items=>(items||[]).filter(line=>line&&!line.return&&!line.cancelled&&
  !['cancelled','canceled'].includes(String(line.status||'').toLowerCase())&&
  Number(line.quantity??line.item_quantity??line.qty)>0&&String(line.name||line.item_name||'').trim());
const fail=()=>{throw Object.assign(new Error('The bill changed. Refresh before continuing.'),{status:409});};
function fingerprint(sale,policy,allocation) {
  return createHash('sha256').update(JSON.stringify({currency:policy.currencyCode,digits:policy.currencyDigits,
    lines:active(sale.items).map(line=>({key:orderLine.key(line),name:String(line.name||line.item_name||'').trim(),quantity:Number(line.quantity??line.item_quantity??line.qty),
      rate:line.unit_price??line.item_base_price??line.item_price,tax:line.item_tax??line.tax_amount})),
    subtotal:sale.sales_sub_total,discount:sale.discount,tax:sale.tax,round:sale.round_off,total:sale.sales_total,
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
