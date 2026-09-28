const test = require('node:test');
const assert = require('node:assert/strict');
const {rounds,tickets} = require('../api/src/helpers/kitchen-rounds');
const line = (qty,process='add') => ({item_id:'rice',item_name:'Rice',item_quantity:qty,process});
const sale = () => ({_id:'s1',table_number:'6',created_date:'2026-09-27T08:00:00Z',items:[line(3)],changes:[{timestamp:'2026-09-27T08:00:00Z',items:[line(2)]},{timestamp:'2026-09-27T08:25:00Z',items:[line(1)]}]});
test('later additions retain their own kitchen clock and service identity',()=>{
 const order=sale();order.kitchen_service={c0i0:{quantity:2,at:'2026-09-27T08:20:00Z'}};
 assert.equal(rounds(order).length,2);assert.equal(tickets(order).length,1);
 assert.equal(tickets(order)[0].placedAt,'2026-09-27T08:25:00.000Z');
 assert.equal(tickets(order)[0].items[0].qty,1);
});
test('partial service removes only that quantity; fully served clears display',()=>{
 const order=sale();order.kitchen_service={c0i0:{quantity:1}};
 assert.equal(tickets(order)[0].items[0].qty,1);
 order.kitchen_service={c0i0:{quantity:2},c1i0:{quantity:1}};assert.deepEqual(tickets(order),[]);
});
test('bill request clears existing rounds but later additions return',()=>{
 const order=sale();order.bill_requested_at='2026-09-27T08:20:00Z';
 assert.equal(tickets(order).length,1);order.bill_requested_at='2026-09-27T08:30:00Z';assert.deepEqual(tickets(order),[]);
});
test('cancelled additions are not displayed and legacy tickets still appear',()=>{
 const order=sale();order.items=[line(2)];order.changes.push({timestamp:'2026-09-27T08:30:00Z',items:[line(1,'cancel')]});
 assert.equal(tickets(order).length,1);assert.equal(tickets(order)[0].items[0].qty,2);
 order.changes=[];assert.equal(tickets(order)[0].items[0].qty,2);
});
test('missing timestamps never become epoch service dates',()=>{assert.equal(rounds(sale())[0].items[0].served_at,null);});
const vm=require('node:vm');
const fs=require('node:fs');
test('every dish on long kitchen tickets rotates into view, including a busy kitchen',()=>{
 const source=fs.readFileSync('src/kitchen-screen.html','utf8').split('<script>')[1].split('</script>')[0];
 const nodes={},timers=[];
 const node=()=>({children:[],style:{setProperty(){}},setAttribute(){},appendChild(child){this.children.push(child);},set textContent(value){this.text=value;this.children=[];},get textContent(){return this.text;}});
 const document={createElement:node,documentElement:node(),getElementById:id=>nodes[id]||(nodes[id]=node())};
 const context={document,window:{},location:{search:''},URLSearchParams,Date,setInterval:fn=>timers.push(fn)};
 vm.runInNewContext(source,context);
 context.window.kitchenScreen.setConfig({_fit:{cards:1,columns:1},maxItemsPerCard:3,compactAfter:1});
 context.window.kitchenScreen.setTickets([{table:'6',placedAt:new Date().toISOString(),items:Array.from({length:10},(_,i)=>({qty:1,name:`Dish ${i}`}))}]);
 const seen=new Set();const collect=n=>{if(n.className==='name')seen.add(n.textContent);n.children.forEach(collect);};
 for(let i=0;i<4;i++){collect(nodes.board);timers[1]();}
 assert.equal(seen.size,10);assert.equal(nodes.count.textContent,1);
});


test('cancelling one preparation never removes another guest preparation of the same product',()=>{
 const dry={...line(1),line_id:'dry',item_description:'No chilli'};
 const gravy={...line(2),line_id:'gravy',item_description:'Extra sauce'};
 const order=sale();order.items=[dry,{...gravy,item_quantity:1}];
 order.changes=[{timestamp:order.created_date,items:[dry,gravy]},
 {timestamp:'2026-09-27T08:30:00Z',items:[{...gravy,item_quantity:1,process:'cancel'}]}];
 order.kitchen_service={c0i0:{quantity:1}};
 const remaining=tickets(order).flatMap(ticket=>ticket.items);
 assert.equal(remaining.length,1);assert.equal(remaining[0].note,'Extra sauce');assert.equal(remaining[0].qty,1);
});


test('held courses do not cook until fired and firing never adds chargeable quantity',()=>{
 const held={...line(2),line_id:'dessert',held:true,seat:2,course:'Dessert',allergies:['milk']};
 const order=sale();order.items=[held];order.changes=[{timestamp:order.created_date,items:[held]}];
 assert.deepEqual(tickets(order),[]);assert.equal(rounds(order)[0].items[0].held,true);
 order.items=[{...held,held:false}];
 order.changes.push({timestamp:'2026-09-27T09:00:00Z',items:[{...held,held:false,process:'fire',source_round_line:'c0i0'}]});
 const rows=rounds(order).flatMap(round=>round.items);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'c0i0');assert.equal(rows[0].quantity,2);
 assert.equal(tickets(order)[0].placedAt,'2026-09-27T09:00:00.000Z');
 assert.deepEqual(tickets(order)[0].items[0].allergies,['milk']);
});
