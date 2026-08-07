const test = require('node:test');
const assert = require('node:assert');
const { ScaleReader, parseFrame } = require('../scale-parser');

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

test('silence means the platter was cleared', async () => {
  const reader = new ScaleReader({ idleMs: 60 });
  let emptied = false;
  reader.on('empty', () => { emptied = true; });
  reader.push('1.500\r\n');
  reader.startIdleWatch();
  await new Promise((r) => setTimeout(r, 200));
  reader.stopIdleWatch();
  assert.ok(emptied, 'expected an empty event after silence');
  assert.strictEqual(reader.weight, 0);
});

test('rejects impossible readings', () => {
  const reader = new ScaleReader();
  const seen = [];
  reader.on('weight', (e) => seen.push(e.kg));
  reader.push('99999.000\r\n');   // above the ceiling
  assert.deepStrictEqual(seen, []);
});
