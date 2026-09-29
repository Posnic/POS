const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/core/PosnicPro.js'), 'utf8');
const start = source.indexOf('parseImportCsv: function (input)');
const method = source.slice(start, source.indexOf('    importTableFile:', start)).trim().replace(/,$/, '');
const parse = Function('return ({' + method + '}).parseImportCsv')();

test('CSV preserves quoted multiline descriptions, commas, quotes and leading zero identifiers', () => {
  assert.deepEqual(parse('\uFEFFname,phone,description\r\n"Tea, large",0012,"First line\nSecond ""quoted"" line"\r\n'),
    [['name','phone','description'],['Tea, large','0012','First line\nSecond "quoted" line']]);
});
test('malformed CSV is rejected before any upload', () => {
  for (const text of ['name,name\nA,B','name,\nA,B','name,phone\nA','name\n"unfinished','name\n"closed"oops','name\nA"B']) {
    assert.throws(() => parse(text));
  }
});
test('semicolon, tab and Excel separator declarations preserve decimal commas', () => {
  for (const delimiter of [';', '\t', ',']) {
    const text = 'sep=' + delimiter + '\r\nname' + delimiter + 'price\r\nCoffee' + delimiter + '"1.234,56"';
    assert.deepEqual(parse(text), [['name','price'],['Coffee','1.234,56']]);
  }
  assert.deepEqual(parse('name;price;description\nCoffee;12,50;"a;b, c"'), [['name','price','description'],['Coffee','12,50','a;b, c']]);
  assert.deepEqual(parse('name\tprice\nCoffee\t12,50'), [['name','price'],['Coffee','12,50']]);
  assert.throws(() => parse('name,price;description\nCoffee,12,50;test'));
  assert.throws(() => parse('name,price\nCoffee,12,50'));
});
test('all shipped import samples parse with consistent columns', () => {
  const dir = path.join(__dirname, '../frontend/static/Import_sample_files');
  for (const file of fs.readdirSync(dir).filter(f => /\.csv$/i.test(f))) {
    assert.ok(parse(fs.readFileSync(path.join(dir,file),'utf8')).length, file);
  }
});
