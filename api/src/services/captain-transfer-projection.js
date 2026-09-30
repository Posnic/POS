'use strict';
const kitchen=require('./captain-transfer-kitchen');
const Money=require('../utils/currency');
const allocation=require('../utils/transfer-allocation');
const orderLine=require('../utils/order-line');
// Pure projection only; the durable writer must fence both sales before using
// these fields and must never run ordinary stock/KOT add-order side effects.
function project(sale,branch,requested,at) {
  const result=kitchen.project(sale,branch,requested,at),policy=Money.policy(branch);
  for(const name of ['source','destination']) {
    const view=result[name],side=result.preview[name],components=side.components;
    const amount=minor=>Money.fromMinor(minor||0,policy);
    const tax=Object.entries(components).filter(([key])=>key.startsWith('tax:')).reduce((sum,[,minor])=>sum+minor,0);
    Object.assign(view,{sales_sub_total:amount(components.base),discount:amount(-components.discount),
      tax:amount(tax),round_off:amount(components.adjustment),sales_total:amount(side.totalMinor)});
    for (const item of view.items) {
      if(item.return||item.cancelled||['cancelled','canceled'].includes(String(item.status||'').toLowerCase()))continue;
      const line=side.lines.find(row=>row.lineKey===orderLine.key(item));
      if(!line)continue;
      const taxes=line.components.filter(row=>row.key.startsWith('tax:'));
      item.item_tax=amount(taxes.reduce((sum,row)=>sum+row.minor,0));
      if('tax_amount' in item)item.tax_amount=item.item_tax;
      item.tax_components=taxes.map(row=>({name:row.key.slice(4),amount:amount(row.minor)}));
    }
    view.captain_transfer_allocation=allocation.seal({...sale,...view},branch,side);
  }
  return result;
}
module.exports={project};
