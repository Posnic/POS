const test = require('node:test');
const assert = require('node:assert');
const { ScaleReader, parseFrame } = require('../src/scale-parser');

test('reads the wire formats real scales send', () => {
  const cases = [
    ['ST,GS,+  0.545kg', 0.545],
    ['+000.545 kg', 0.545],
    ['0.545', 0.545],
    ['W+001.245', 1.245],
    ['\x02  0.545\x03', 0.545],
    ['00545', 0.545],          // integer grams
    ['545 g', 0.545],          // grams, must not be read as 545 kg
    ['12.50', 12.5],
    ['US,GS,+  2.000kg', 2.0], // unstable status token stripped
  ];
  for (const [frame, expected] of cases) {
    const got = parseFrame(frame);
    assert.ok(got, `no weight found in ${JSON.stringify(frame)}`);
    assert.strictEqual(got.kg, expected, `${JSON.stringify(frame)} -> ${got.kg}`);
  }
});

test('ignores frames with no weight in them', () => {
  for (const junk of ['', '   ', 'ST', 'ERROR', '---']) {
    assert.strictEqual(parseFrame(junk), null, junk);
  }
});

test('reports stable only once the reading settles', () => {
  const reader = new ScaleReader({ stableFrames: 3, toleranceKg: 0.005 });
  const stable = [];
  reader.on('stable', (e) => stable.push(e.kg));

  reader.push('1.000\r\n1.400\r\n');          // still moving
  assert.deepStrictEqual(stable, []);

  reader.push('2.000\r\n2.001\r\n2.000\r\n'); // three frames within tolerance
  assert.deepStrictEqual(stable, [2.0]);

  reader.push('2.000\r\n2.001\r\n');          // same load must not fire again
  assert.deepStrictEqual(stable, [2.0]);
});

test('handles a stream with no delimiters', () => {
  const reader = new ScaleReader();
  const seen = [];
  reader.on('weight', (e) => seen.push(e.kg));
  reader.push('ST,GS,+  0.545kg ST,GS,+  0.545kg ');
  assert.ok(seen.includes(0.545), `saw ${seen}`);
});

test('silence invalidates the reading instead of inventing an empty platter', async () => {
  const reader = new ScaleReader({ idleMs: 60 });
  let emptied = false;
  reader.on('invalid', () => { emptied = true; });
  reader.push('1.500\r\n');
  reader.startIdleWatch();
  await new Promise((r) => setTimeout(r, 200));
  reader.stopIdleWatch();
  assert.ok(emptied, 'expected stale reading after silence');
  assert.strictEqual(reader.weight, null);
});

test('rejects impossible readings', () => {
  const reader = new ScaleReader();
  const seen = [];
  reader.on('weight', (e) => seen.push(e.kg));
  reader.push('99999.000\r\n');   // above the ceiling
  assert.deepStrictEqual(seen, []);
});


test('tagged units, decimal comma and implied decimals convert to kilograms', () => {
  for (const [raw, opts, expected] of [['545.0 g', {}, .545], ['1 lb', {}, .45359237], ['10 oz', {}, .28349523125], ['0,375 kg', {decimalSeparator: ','}, .375], ['00375', {unit:'kg', integerDecimals:3}, .375], ['2', {unit:'kg'},2]]) {
    assert.ok(Math.abs(parseFrame(raw,opts).kg-expected)<1e-10,raw);
  }
});
test('ambiguous fields require explicit selection; overload and negative cannot be billed', () => {
  assert.equal(parseFrame('0.375 24.00 9.00'), null);
  assert.equal(parseFrame('0.375 24.00 9.00',{numberIndex:1}).kg,.375);
  assert.equal(parseFrame('OL 0.375 kg'),null);
  const r=new ScaleReader();r.push('-0.375 kg\r');assert.equal(r.weight,null);
});
test('unstable status never becomes stable from repeated frames; single stable transfer works',()=>{
  const r=new ScaleReader();for(let i=0;i<10;i++)r.push('US,GS,0.375kg\r');assert.equal(r.isStable,false);
  r.push('ST,GS,0.375kg\r');assert.equal(r.isStable,true);
});
test('partial and fixed-length frames wait for completion without dropping readings',()=>{
  const r=new ScaleReader();const seen=[];r.on('weight',e=>seen.push(e.kg));
  r.push('0.3');assert.equal(r.weight,null);r.push('75 kg\r0.5');r.push('00kg\r');assert.deepEqual(seen,[.375,.5]);
  const fixed=new ScaleReader({frameLength:5,unit:'kg',integerDecimals:3});const values=[];fixed.on('weight',e=>values.push(e.kg));
  fixed.push('003');assert.equal(fixed.weight,null);fixed.push('7500500');assert.deepEqual(values,[.375,.5]);
});


test('documented A&D and MT-SICS responses preserve their status and ignore nonweight replies',()=>{
 assert.equal(parseFrame('ST,+0000000.5__g',{protocol:'and'}).kg,.0005);
 assert.equal(parseFrame('S S     0.375 kg',{protocol:'sics'}).stable,true);
 assert.equal(parseFrame('S D     0.375 kg',{protocol:'sics'}).stable,false);
 assert.equal(parseFrame('I4 12345',{protocol:'sics'}),null);
 assert.equal(parseFrame('S +',{protocol:'sics'}),null);
 assert.equal(parseFrame('  375.0 g ?',{protocol:'ohaus'}).stable,false);
 assert.equal(parseFrame('Serial 12345',{protocol:'stream'}),null);
});
