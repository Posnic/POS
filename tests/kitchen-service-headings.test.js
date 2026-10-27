const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('kitchen service headings distinguish room, parcel and table without changing orders', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../src/kitchen-screen.html'), 'utf8'), {runScripts:'dangerously'});
  try {
    const screen = dom.window.kitchenScreen;
    screen.setConfig({_fit:{fontPx:32,lineHeightPx:40,columns:2,cards:8},pulseAlerts:false});
    for (const [fields, label, kind, lineStyle] of [
      [{table:'10'}, 'Table 10', 'table', 'solid'],
      [{table:'SA - 56',roomReference:'56'}, 'Room 56', 'room', 'double'],
      [{table:'ROOM 109'}, 'Room 109', 'room', 'double'],
      [{table:'',roomReference:'205'}, 'Room 205', 'room', 'double'],
      [{table:'Take Away 3',takeaway:true,orderNumber:'SID-123'}, 'Parcel 3', 'parcel', 'dashed'],
      [{table:'',takeaway:true,orderNumber:'7'}, 'Parcel 7', 'parcel', 'dashed'],
    ]) {
      const ticket = {id:'sample',...fields,placedAt:new Date(Date.now()-7*60000).toISOString(),items:[{qty:2,name:'Rice'}]};
      const before = JSON.stringify(ticket);
      screen.setTickets([ticket]);
      const card = dom.window.document.querySelector('.ticket');
      assert.ok(card.classList.contains('service-'+kind));
      assert.ok(card.classList.contains('warm'), 'service type must preserve waiting-time status');
      assert.equal(card.querySelector('.service-label').textContent,label);
      assert.equal(dom.window.getComputedStyle(card.querySelector('.service-rule')).borderTopStyle,lineStyle);
      assert.equal(card.querySelectorAll('.service-icon').length,1);
      assert.equal(dom.window.getComputedStyle(card.querySelector('.table')).justifyContent,'flex-start');
      assert.ok(card.querySelector('.ticket-details .arrival'));
      assert.equal(card.querySelector('.qty').textContent,'2 - ');
      assert.equal(JSON.stringify(ticket),before);
    }
    screen.setTickets([{id:'cancelled',table:'10',cancelled:true,placedAt:new Date().toISOString(),items:[{qty:1,name:'Soup'}]}]);
    const cancelled = dom.window.document.querySelector('.ticket.cancelled');
    assert.ok(cancelled);
    assert.equal(cancelled.querySelector('.service-task'),null, 'cancelled tickets must not instruct preparation');
  } finally {
    dom.window.close();
  }
});
