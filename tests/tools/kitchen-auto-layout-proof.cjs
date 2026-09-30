const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(app.getPath('temp'),'posnic-kitchen-layout-proof'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 try{
 await win.loadFile(path.resolve('src/kitchen-screen.html'));
 for(const [width,height,count,dishes] of [[1280,800,1,8],[1920,1080,6,8],[1080,1920,4,12],[1280,800,1,12],[1280,800,18,3],[1080,1920,10,6]]){
 win.setContentSize(width,height);
 await new Promise(resolve=>setTimeout(resolve,150));
 const result=await win.webContents.executeJavaScript(`(async()=>{
 kitchenScreen.setConfig({pageDwellSeconds:120,fontSizePx:0,visibleDishesPerBox:0,showAge:true,showItems:true,_fit:{fontPx:130,columns:1},_feedStatus:''});
 kitchenScreen.setTickets(Array.from({length:${count}},(_,i)=>({id:'order-'+i,table:String(i+1),placedAt:new Date().toISOString(),items:Array.from({length:${dishes}},(_,j)=>({name:j%3===0?'Grilled fish with lemon butter sauce':'Dish '+j,qty:1,note:j===1?'No chilli':''}))})));
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 window.dispatchEvent(new Event('resize'));
 return {font:getComputedStyle(document.body).fontSize,pager:document.getElementById('pager').textContent,boardOverflow:document.getElementById('board').scrollHeight-document.getElementById('board').clientHeight, cards:[...document.querySelectorAll('.ticket')].map(c=>({items:c.querySelectorAll('.item').length,overflow:c.querySelector('.items').scrollHeight-c.querySelector('.items').clientHeight,height:c.getBoundingClientRect().height}))};
 })()`);
 console.log(JSON.stringify({width,height,count,dishes,...result}));
 assert.ok(parseInt(result.font)<=36);assert.ok(result.cards.length);assert.ok(result.boardOverflow<=1);
 for(const card of result.cards){assert.equal(card.items,dishes);assert.ok(card.overflow<=1,'Auto must show the whole order');}
 if(count===18)assert.match(result.pager,/of/);
 await new Promise(resolve=>setTimeout(resolve,100));
 if(width===1080 && count===10)fs.writeFileSync(path.join(app.getPath('temp'),'posnic-kitchen-auto.png'),(await win.webContents.capturePage()).toPNG());
 }
 }finally{win.destroy();app.quit();}
}).catch(e=>{console.error(e);app.exit(1);});
