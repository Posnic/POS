'use strict';
const zlib=require('node:zlib'),{SaxesParser}=require('saxes');
const fail=()=>{throw Object.assign(Error('Invalid product-link workbook. Use the review template and keep SKU and product IDs as text.'),{code:'hktv_mapping_workbook_invalid',status:422});};
// Bound actual decompression before handing the archive to the XLSX reader.
// XLSX is parsed as data only; formulas in decision fields are never evaluated.
function checkArchive(bytes){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))fail();
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 if(count<1||count>1000||offset+size!==end||bytes.readUInt16LE(end+8)!==count)fail();
 let cursor=offset,total=0;const names=new Set(),entries=new Map();
 for(let i=0;i<count;i++){
  if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)fail();
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),compressed=bytes.readUInt32LE(cursor+20),uncompressed=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
  if(flags&1||![0,8].includes(method)||uncompressed>8*1024*1024||(total+=uncompressed)>32*1024*1024||cursor+46+nameLength+extra+comment>end||local+30>offset)fail();
  const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');if(names.has(name)||name.includes('..')||name.startsWith('/'))fail();names.add(name);
  if(bytes.readUInt32LE(local)!==0x04034b50)fail();
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+compressed>offset)fail();
  const data=bytes.subarray(start,start+compressed),expanded=method===8?zlib.inflateRawSync(data,{maxOutputLength:Math.max(1,uncompressed+1)}):data;
  if(expanded.length!==uncompressed)fail();
  entries.set(name,expanded);
  cursor+=46+nameLength+extra+comment;
 }
 if(cursor!==end||!names.has('xl/workbook.xml'))fail();
 return entries;
}
function xml(bytes){
 if(!bytes)fail();const parser=new SaxesParser({xmlns:true}),stack=[];let root,nodes=0;
 parser.on('doctype',fail);parser.on('error',fail);
 parser.on('opentag',tag=>{if(++nodes>200000||stack.length>32)fail();const node={name:tag.local,attrs:Object.fromEntries(Object.values(tag.attributes).map(a=>[a.local,a.value])),children:[],text:''};if(stack.length)stack[stack.length-1].children.push(node);else root=node;stack.push(node);});
 parser.on('text',text=>{if(stack.length)stack[stack.length-1].text+=text;});parser.on('closetag',()=>stack.pop());parser.write(bytes.toString('utf8')).close();return root;
}
const child=(node,name)=>node?.children.find(c=>c.name===name);
const strings=node=>node?.name==='t'?node.text:(node?.children||[]).map(strings).join('');
async function readWorkbook(base64){
 if(typeof base64!=='string'||base64.length>720000||!base64.length||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail();
 const bytes=Buffer.from(base64,'base64');if(bytes.length>512*1024||bytes.toString('base64')!==base64)fail();
 try{
  const entries=checkArchive(bytes),workbook=xml(entries.get('xl/workbook.xml'));
  const sheets=child(workbook,'sheets')?.children.filter(s=>s.attrs.name==='Product links');if(sheets?.length!==1)fail();
  const relationships=xml(entries.get('xl/_rels/workbook.xml.rels')).children.filter(r=>r.attrs.Id===sheets[0].attrs.id);if(relationships.length!==1||relationships[0].attrs.TargetMode==='External')fail();
  const target=relationships[0].attrs.Target,member=target.startsWith('/')?target.slice(1):'xl/'+target;if(!member.startsWith('xl/worksheets/')||member.includes('..'))fail();
  const shared=entries.has('xl/sharedStrings.xml')?xml(entries.get('xl/sharedStrings.xml')).children.map(strings):[];
  const rows=child(xml(entries.get(member)),'sheetData')?.children;if(!rows||rows.length>10020)fail();
  function value(cell,editable=false){if(!cell)return '';if(child(cell,'f')){if(editable)fail();return '';}const type=cell.attrs.t,v=child(cell,'v')?.text||'';if(type==='inlineStr')return strings(child(cell,'is'));if(type==='s'){if(!/^\d+$/.test(v)||shared[Number(v)]===undefined)fail();return shared[Number(v)];}if(type==='str')return v;if(!v)return '';if(editable)fail();return v;}
  const cells=rows.map(row=>{const result={};for(const cell of row.children){if(cell.name!=='c')continue;const address=cell.attrs.r;if(!/^[A-Z]{1,2}\d{1,5}$/.test(address||''))fail();const col=address.match(/^[A-Z]+/)[0];if(result[col])fail();result[col]=cell;}return result;});
  const fields={'HKTVmall SKU':'sku','Decision':'decision','Chosen product ID':'productId','Reviewed by':'reviewer','Review notes':'notes'};
  let columns,header;for(let row=0;row<Math.min(20,cells.length);row++){
   const found={};for(const [col,cell] of Object.entries(cells[row])){const text=value(cell);if(fields[text]){if(found[fields[text]])fail();found[fields[text]]=col;}}
   if(Object.keys(found).length===5){columns=found;header=row;break;}
  }
  if(!columns)fail();const links=[],seen=new Set();let held=0,skipped=0;
  for(let row=header+1;row<cells.length;row++){
   const values={};for(const [field,col]of Object.entries(columns))values[field]=value(cells[row][col],true);
   if(Object.values(values).every(v=>v===''))continue;
   if(!values.sku.trim()||values.sku.length>300||seen.has(values.sku)||!['Link','Hold','Skip'].includes(values.decision))fail();seen.add(values.sku);
   if(values.decision==='Hold'){held++;continue;}if(values.decision==='Skip'){skipped++;continue;}
   if(!/^[a-f0-9]{24}$/.test(values.productId)||!values.reviewer.trim()||values.reviewer.length>120||values.notes.length>2000)fail();
   links.push({sku:values.sku,productId:values.productId,reviewer:values.reviewer.trim(),notes:values.notes});
  }
  if(!seen.size||seen.size>10000)fail();return {links,total:seen.size,held,skipped,applied:false};
 }catch(error){if(error.code==='hktv_mapping_workbook_invalid')throw error;fail();}
}
module.exports={readWorkbook,checkArchive};
