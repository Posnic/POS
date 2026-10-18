'use strict';
const namespace=require('./extension-namespace');
const ExcelJS=require('exceljs');
const fail=code=>{throw Object.assign(new Error(code),{code,status:422});};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function manifest(state,input){
 if(!Array.isArray(input.orderKeys)||!input.orderKeys.length||input.orderKeys.length>100||new Set(input.orderKeys).size!==input.orderKeys.length||input.orderKeys.some(k=>!/^[a-f0-9]{64}$/.test(k)))fail('manifest_orders_invalid');
 const date=new Date(input.deliveryDate+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate||'')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.deliveryDate)fail('manifest_date_invalid');
 const settings=state.settings;if(!settings||['company','merchantId','clientId'].some(k=>typeof settings[k]!=='string'||!settings[k].trim())||settings.merchantId!==state.storeCode)fail('manifest_settings_required');
 const orders=input.orderKeys.map(key=>(state.orders||[]).find(o=>o.key===key));let warehouse,destination;const rows=[];
 for(const order of orders){
  const p=order?.packing;
  if(!p||order.proposed||!['packed','handed-over'].includes(order.reviewStatus)||!['CONFIRMED','ACKNOWLEDGED','PICKED'].includes(order.status)||p.deliveryDate!==input.deliveryDate||p.waybill!==order.trackingId||p.commercialHash!==order.commercialHash||p.warehouseId!==order.warehouseId||!order.deliverToWarehouse)fail('manifest_order_not_ready');
  if(warehouse&&(warehouse!==order.warehouseId||destination!==order.deliverToWarehouse))fail('manifest_separate_destinations_required');warehouse=order.warehouseId;destination=order.deliverToWarehouse;
  if(!Array.isArray(p.cartons)||!p.cartons.length)fail('manifest_cartons_required');
  const expected=new Map(),packed=new Map();for(const line of order.lines)expected.set(line.sku,(expected.get(line.sku)||0)+line.quantity);
  for(const c of p.cartons){
   if(![c.weightKg,c.lengthM,c.widthM,c.heightM].every(n=>Number.isFinite(n)&&n>0)||!Number.isSafeInteger(c.declaredValueCents)||c.declaredValueCents<0||c.waybill!==order.trackingId||c.orderId!==order.orderId||!Array.isArray(c.items))fail('manifest_carton_invalid');
   for(const item of c.items){if(!expected.has(item.sku)||!Number.isSafeInteger(item.quantity)||item.quantity<1)fail('manifest_quantity_mismatch');packed.set(item.sku,(packed.get(item.sku)||0)+item.quantity);}
   rows.push([String(rows.length+1),order.orderId,order.trackingId,c.weightKg,`${c.lengthM} × ${c.widthM} × ${c.heightM}`,c.declaredValueCents/100]);
  }
  for(const [sku,quantity]of expected)if(packed.get(sku)!==quantity)fail('manifest_quantity_mismatch');
 }
 if(rows.length>500)fail('manifest_carton_limit');
 return {settings,date:input.deliveryDate,destination,rows,orders:orders.length};
}
async function readManifest({db,scope,descriptor,actor,input,readState=namespace.readNamespace}){
 if(descriptor.id!=='posnic.hktvmall-gogox'||!actor.permissions.includes('read'))fail('manifest_forbidden');
 if(!input||Object.keys(input).some(k=>!['orderKeys','deliveryDate','expectedRevision','format'].includes(k))||!Number.isSafeInteger(input.expectedRevision)||!['html','xlsx'].includes(input.format))fail('manifest_request_invalid');
 const current=await readState(db,scope,descriptor,actor);if(current.busy||current.revision!==input.expectedRevision)fail('manifest_changed_refresh_required');
 const m=manifest(current.state,input),head=['Carton','HKTVmall order','Waybill','Weight (kg)','Dimensions L × W × H (m)','Declared value (HKD)'];
 const metadata=[['Merchant',m.settings.company],['Merchant ID',m.settings.merchantId],['GOGOX client ID',m.settings.clientId],['Collection date',m.date],['HKTVmall hub',m.destination],['Total cartons',String(m.rows.length)]];
 if(input.format==='html')return {title:'GOGOX daily collection',orderId:m.date,html:'<html><head><style>body{font:14px Arial;color:#173047;margin:25px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:8px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:24px}</style></head><body><h1>GOGOX delivery note · HKTVmall hub</h1>'+metadata.map(r=>'<p>'+r.map(escape).join(': ')+'</p>').join('')+'<table><thead><tr>'+head.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+m.rows.map(r=>'<tr>'+r.map((x,i)=>'<td>'+escape(i===5?x.toFixed(2):x)+'</td>').join('')+'</tr>').join('')+'</tbody></table><p>Prepared by: ____________________ &nbsp; Collected by: ____________________</p><p>Existing daily collection · '+m.orders+' orders · Physical handover is recorded separately in POSNIC.</p></body></html>'};
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('GOGOX handover');sheet.columns=[{width:10},{width:34},{width:23},{width:16},{width:35},{width:25}];sheet.addRow(['GOGOX delivery note · HKTVmall hub']);sheet.mergeCells('A1:F1');sheet.getRow(1).font={bold:true,size:18,color:{argb:'FF173047'}};
 metadata.forEach(r=>sheet.addRow(r));const heading=sheet.addRow(head);heading.font={bold:true,color:{argb:'FFFFFFFF'}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173047'}};heading.height=30;
 for(const r of m.rows){const row=sheet.addRow(r);row.getCell(3).numFmt='@';row.getCell(6).numFmt='#,##0.00';row.eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};c.border={bottom:{style:'thin',color:{argb:'FFD9E2EC'}}};});}
 sheet.addRow([]);sheet.addRow(['Prepared by: ____________________','','Collected by: ____________________']);sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:8'};sheet.views=[{state:'frozen',ySplit:8}];
 const bytes=await workbook.xlsx.writeBuffer(),latest=await readState(db,scope,descriptor,actor);if(latest.busy||latest.revision!==current.revision)fail('manifest_changed_refresh_required');
 return {format:'xlsx',filename:'GOGOX-handover-'+m.date+'.xlsx',base64:Buffer.from(bytes).toString('base64'),cartons:m.rows.length,orders:m.orders};
}
module.exports={manifest,readManifest};
