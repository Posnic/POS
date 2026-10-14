const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/weight-bridge.js'), 'utf8');
function bridge() {
  let receive, expire, stopped = 0;
  const context = {
    window: { electronAPI: { hardware: { onUsbData(cb) { receive = cb; return () => stopped++; } } } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(cb) { expire = cb; return 1; }, clearTimeout() {}, Date,
  };
  vm.runInNewContext(source, context);
  return { read: options => context.window.WeightBridge.getCurrentWeight(options), send: data => receive(data), timeout: () => expire(), stopped: () => stopped };
}
test('automatic quantity waits for a fresh positive stable reading and releases listener', async () => {
  const scale = bridge(); let resolved = false;
  const pending = scale.read({stableOnly:true}).then(weight => { resolved = true; return weight; });
  scale.send({weight:0.3,stable:false}); scale.send(0.4); scale.send({weight:0,stable:true});
  await Promise.resolve(); assert.equal(resolved,false);
  scale.send({weight:0.375,stable:true}); assert.equal(await pending,0.375); assert.equal(scale.stopped(),1);
  scale.send({weight:0.9,stable:true}); assert.equal(scale.stopped(),1);
});
test('unsettled readings time out without automatic quantity', async () => {
  const scale = bridge(); const pending = scale.read({stableOnly:true});
  scale.send({weight:0.3,stable:false}); scale.timeout();
  assert.equal(await pending,null); assert.equal(scale.stopped(),1);
});
test('existing manual weight reads retain compatibility with older scale messages', async () => {
  const scale = bridge(); const pending = scale.read(); scale.send(0.5);
  assert.equal(await pending,0.5);
});
