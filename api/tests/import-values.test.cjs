const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importNumber, contactRows, importFailure } = require('../src/helpers/import-values');

test('numeric imports preserve full grouped values and decimals, not numeric prefixes', () => {
  for (const [input, expected] of [['1,200.50',1200.5], ['1,23,456.70',123456.7], ['0',0], ['.25',.25], ['-3',-3]])
    assert.equal(importNumber(input),expected);
  for (const invalid of ['oops','12oops','1,2,3','Infinity',Infinity,NaN,true,{},'Rs 100']) assert.ok(Number.isNaN(importNumber(invalid)));
});
test('international decimals and grouping have the same numeric value', () => {
  for (const input of ['1234.56','1234,56','1,234.56','1.234,56','1 234,56','1\u00a0234,56','1\u202f234,56',"1'234.56",'1’234,56']) {
    assert.equal(importNumber(input),1234.56,input);
  }
  for (const [input, value] of [['1,2',1.2],['0,125',0.125],['0.125',0.125],['12,3456',12.3456],['1.234.567,89',1234567.89],['1,23,456.78',123456.78],['-12,50',-12.5]]) assert.equal(importNumber(input),value,input);
});
test('ambiguous and malformed grouping never silently changes magnitude', () => {
  for (const input of ['1,234','1.234','12,345','12.345','1 23,45','1.23.456,78','1,234,56','1.234.56','1,23.45','1 234\'567,89']) assert.ok(Number.isNaN(importNumber(input)),input);
});
test('contacts allow blank emails and preserve leading zero phone numbers', () => {
  const result = contactRows([{name:' A ',phone:'00123',email:' '},{name:'B',phone:'00456'}],true);
  assert.equal(result.errors.length,0);
  assert.equal(result.rows[0].phone,'00123');
  assert.equal(result.rows[0].name,'A');
  assert.equal(result.rows[0].email,'');
  assert.equal(contactRows([{name:'European supplier',balance:'1.234,56'}]).rows[0].balance,1234.56);
});
test('contacts reject conflicting duplicates, invalid balances and repeated real emails', () => {
  for (const rows of [
    [{name:'A',email:'x@example.com'},{name:'B',email:' X@example.com '}],
    [{name:'A',phone:'1',address:'One'},{name:'A',phone:'1',address:'Two'}],
    [{name:'A',email:'broken'}], [{name:'A',balance:'not money'}], [{name:' '}],
  ]) assert.ok(contactRows(rows).errors.length);
  assert.equal(contactRows([{name:'A'},{name:'A'}]).rows.length,1);
  assert.equal(contactRows([{name:'A-B',phone:'C'},{name:'A',phone:'B-C'}]).rows.length,2);
});
test('bulk-write failures report records already saved without exposing raw Mongo errors', () => {
  assert.match(importFailure({code:11000,result:{insertedCount:2},message:'E11000 internal'}),/2 records were imported/);
  assert.doesNotMatch(importFailure({code:11000,message:'E11000 internal'}),/E11000/);
});
