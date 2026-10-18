const {manifest,readManifest}=require('../../../src/services/extension-hktv-manifest');
const ExcelJS=require('exceljs');
function fixture(){const order={key:'a'.repeat(64),orderId:'H001-STORE',trackingId:'0012345',status:'CONFIRMED',reviewStatus:'packed',commercialHash:'hash',warehouseId:'W1',deliverToWarehouse:'Hub one',lines:[{sku:'S1',quantity:2}],packing:{deliveryDate:'2026-10-19',waybill:'0012345',commercialHash:'hash',warehouseId:'W1',cartons:[{id:'C1',orderId:'H001-STORE',waybill:'0012345',weightKg:1,lengthM:.2,widthM:.3,heightM:.4,declaredValueCents:1200,items:[{sku:'S1',quantity:2}]}]}};return {state:{storeCode:'STORE',settings:{company:'OBC MART',merchantId:'STORE',clientId:'CLIENT'},orders:[order]},input:{orderKeys:[order.key],deliveryDate:'2026-10-19',expectedRevision:3,format:'xlsx'}};}
test('daily collection groups multiple orders and numbers cartons across the batch',()=>{const x=fixture(),second=structuredClone(x.state.orders[0]);second.key='b'.repeat(64);second.orderId='H002-STORE';second.packing.cartons[0].orderId=second.orderId;x.state.orders.push(second);x.input.orderKeys.push(second.key);const m=manifest(x.state,x.input);expect(m.rows.map(r=>r[0])).toEqual(['1','2']);expect(m.orders).toBe(2);});
test('changed labels, mixed destinations and inconsistent quantities cannot enter the manifest',()=>{for(const mutate of [x=>x.state.orders[0].trackingId='NEW',x=>x.state.orders[0].lines[0].quantity=3,x=>x.state.orders[0].proposed={},x=>x.state.orders[0].status='CANCELLED']){const x=fixture();mutate(x);expect(()=>manifest(x.state,x.input)).toThrow();}const x=fixture(),second=structuredClone(x.state.orders[0]);second.key='b'.repeat(64);second.warehouseId='W2';second.packing.warehouseId='W2';x.state.orders.push(second);x.input.orderKeys.push(second.key);expect(()=>manifest(x.state,x.input)).toThrow('separate_destinations');});
test('Excel output preserves waybill leading zeros and uses numeric declared values',async()=>{const x=fixture();x.state.settings.company='=HYPERLINK("unsafe")';const r=await readManifest({db:{},scope:{},descriptor:{id:'posnic.hktvmall-gogox'},actor:{permissions:['read']},input:x.input,readState:async()=>({revision:3,state:x.state})});const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(r.base64,'base64'));const sheet=workbook.getWorksheet(1);expect(sheet.getCell('C9').value).toBe('0012345');expect(sheet.getCell('F9').value).toBe(12);expect(typeof sheet.getCell('B2').value).toBe('string');expect(sheet.pageSetup.fitToWidth).toBe(1);});
test('stale workspace revision and another extension cannot export a manifest',async()=>{const x=fixture(),args={db:{},scope:{},descriptor:{id:'posnic.hktvmall-gogox'},actor:{permissions:['read']},input:x.input,readState:async()=>({revision:4,state:x.state})};await expect(readManifest(args)).rejects.toThrow('changed_refresh');args.descriptor.id='other.extension';await expect(readManifest(args)).rejects.toThrow('forbidden');});

test.each(['html','xlsx'])('records manifest checks each selected revision for %s',async format=>{
 const x=fixture(),order=x.state.orders[0];x.state.orderStorage='records-v1';x.state.orders=[];x.input.format=format;
 const args={db:{},scope:{},descriptor:{id:'posnic.hktvmall-gogox'},actor:{permissions:['read']},input:x.input,readState:async()=>({revision:3,state:x.state}),getStore:async()=>({read:async()=>({data:order,revision:7})})};
 await expect(readManifest(args)).rejects.toThrow('changed_refresh');
 x.input.expectedOrderRevisions={[order.key]:7};
 const result=await readManifest(args);expect(format==='html'?result.html:result.base64).toBeTruthy();
 let reads=0;args.getStore=async()=>({read:async()=>({data:order,revision:++reads===1?7:8})});
 await expect(readManifest(args)).rejects.toThrow('changed_refresh');
});
test('storage cutover during a legacy manifest invalidates the document',async()=>{
 const x=fixture();x.input.format='html';let reads=0;
 await expect(readManifest({db:{},scope:{},descriptor:{id:'posnic.hktvmall-gogox'},actor:{permissions:['read']},input:x.input,readState:async()=>({revision:3,state:++reads===1?x.state:{...x.state,orderStorage:'records-v1'}}),getStore:async()=>({read:async()=>({data:x.state.orders[0],revision:1})})})).rejects.toThrow('changed_refresh');
});
test.each(['html','xlsx'])('old packing with oversized parcels is rejected by %s export',async format=>{
 for(const [measurements,error] of [[{weightKg:20.001},'over_20_kg'],[{lengthM:1.301},'side_over_130_cm'],[{lengthM:.601,widthM:.6,heightM:.6},'total_over_180_cm']]){
  const x=fixture();Object.assign(x.state.orders[0].packing.cartons[0],measurements);x.input.format=format;
  await expect(readManifest({db:{},scope:{},descriptor:{id:'posnic.hktvmall-gogox'},actor:{permissions:['read']},input:x.input,readState:async()=>({revision:3,state:x.state})})).rejects.toThrow(error);
 }
 const x=fixture();Object.assign(x.state.orders[0].packing.cartons[0],{weightKg:20,lengthM:1.3,widthM:.3,heightM:.2});x.input.format=format;
 const result=await readManifest({db:{},scope:{},descriptor:{id:'posnic.hktvmall-gogox'},actor:{permissions:['read']},input:x.input,readState:async()=>({revision:3,state:x.state})});expect(result.html||result.base64).toBeTruthy();
});
