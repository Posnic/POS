'use strict';
const router=require('../../../src/routes/captain-access.routes');
const handler=router.stack.find(l=>l.route?.path==='/discovery').route.stack.at(-1).handle;
async function discover(rows){const res={set:jest.fn(),json:jest.fn(),status:jest.fn().mockReturnThis()};await handler({db:{collection:()=>({find:(query,options)=>{expect(query.module_captain_enable.$nin).toEqual([false,0,'0','false']);expect(options.projection).toEqual({branch_name:1,captain_fallback_url:1,captain_cloud_url:1});return {toArray:async()=>rows}}})}},res);return res.json.mock.calls[0][0];}
test('legacy branches provide names and a shared Internet address without selecting a branch',async()=>{expect(await discover([{branch_name:'North shop',captain_cloud_url:'https://shop.example/api'},{branch_name:'South shop',captain_cloud_url:'https://shop.example/api'}])).toEqual({connections:{shopName:'North shop · South shop',cloud:'https://shop.example/api'}})});
test('different or missing Internet addresses are not guessed',async()=>{expect((await discover([{branch_name:'North',captain_cloud_url:'https://one.example/api'},{branch_name:'South'}])).connections.cloud).toBeNull()});
test('no enabled branches reveals no shop details',async()=>{expect(await discover([])).toEqual({connections:{}})});
