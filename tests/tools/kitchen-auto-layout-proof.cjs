const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(app.getPath('temp'),'posnic-kitchen-layout-proof'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 try{
 await win.loadFile(path.resolve('src/kitchen-screen.html'));
 for(const [width,height,count,dishes] of [[1280,800,1,8],[1920,1080,6,8],[1080,1920,4,12],[1280,800,1,12],[1280,800,18,3],[1080,1920,10,6],[1080,1920,8,0],[1080,1920,3,-1]]){
 win.setContentSize(width,height);
 await new Promise(resolve=>setTimeout(resolve,150));
 const result=await win.webContents.executeJavaScript(`(async()=>{
 kitchenScreen.setConfig({pageDwellSeconds:120,fontSizePx:0,visibleDishesPerBox:0,showAge:true,showItems:true,_fit:{fontPx:130,columns:1},_feedStatus:''});
 kitchenScreen.setTickets(Array.from({length:${count}},(_,i)=>({id:'order-'+i,table:String(i+1),placedAt:new Date().toISOString(),items:Array.from({length:${dishes} === -1 ? (i===0 ? 10 : 2) : (${dishes} || (i%2 ? 9 : 3))},(_,j)=>({name:j%3===0?'Grilled fish with lemon butter sauce':'Dish '+j,qty:1,note:j===1?'No chilli':''}))})));
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 window.dispatchEvent(new Event('resize'));
 return {font:getComputedStyle(document.body).fontSize,pager:document.getElementById('pager').textContent,boardOverflow:document.getElementById('board').scrollHeight-document.getElementById('board').clientHeight, cards:[...document.querySelectorAll('.ticket')].map(c=>({left:c.getBoundingClientRect().left,top:c.getBoundingClientRect().top,right:c.getBoundingClientRect().right,bottom:c.getBoundingClientRect().bottom,table:Number(c.querySelector('.table').textContent.trim()),items:c.querySelectorAll('.item').length,overflow:c.querySelector('.items').scrollHeight-c.querySelector('.items').clientHeight,height:c.getBoundingClientRect().height}))};
 })()`);
 console.log(JSON.stringify({width,height,count,dishes,...result}));
 assert.ok(parseInt(result.font)<=36);assert.ok(result.cards.length);assert.ok(result.boardOverflow<=1);
 for(const card of result.cards){assert.equal(card.items,dishes === -1 ? (card.table===1 ? 10 : 2) : (dishes || ((card.table-1)%2 ? 9 : 3)));assert.ok(card.overflow<=1,'Auto must show the whole order');}
 for(let i=0;i<result.cards.length;i++)for(let j=i+1;j<result.cards.length;j++){
 const a=result.cards[i],b=result.cards[j];
 assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top,'Orders must never overlap');
 }
 if(dishes===-1){
 const [first,second,third]=result.cards;
 assert.equal(result.cards.length,3);assert.equal(result.pager,'');
 assert.equal(third.left,second.left,'Third order uses the space below the short second order');
 assert.ok(third.top>=second.bottom && third.top<first.bottom);
 }
 if(count===18)assert.match(result.pager,/of/);
 await new Promise(resolve=>setTimeout(resolve,100));
 if(dishes===-1)fs.writeFileSync(path.join(app.getPath('temp'),'posnic-kitchen-smart-columns.png'),(await win.webContents.capturePage()).toPNG());
 if(width===1080 && count===10)fs.writeFileSync(path.join(app.getPath('temp'),'posnic-kitchen-auto.png'),(await win.webContents.capturePage()).toPNG());
 }
 }finally{win.destroy();app.quit();}
}).catch(e=>{console.error(e);app.exit(1);});
