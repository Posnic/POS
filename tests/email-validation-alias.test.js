const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/static/script/js/core/PosnicPro.js', 'utf8');
const start = source.indexOf('validateEmail: function');
const end = source.indexOf('\n    },', start);
const validate = vm.runInNewContext('({' + source.slice(start, end) + '\n}}).validateEmail');
test('email validator accepts plus aliases and long domain suffixes', () => {
  for (const email of ['sridharkalaibala+123@gmail.com', 'support@example.technology', 'first.last@example.co.uk']) assert.equal(validate(email), true, email);
});
test('email validator rejects empty, malformed and multiple recipients', () => {
  for (const email of ['', 'a b@example.com', 'a@@example.com', 'a@example', 'a@example..com', 'a@example.com,b@example.com', '<a@example.com>', '.a@example.com', 'a..b@example.com', 'a.@example.com', 'a@-example.com', 'a@exam_ple.com', 'a@example.123', 'a'.repeat(65)+'@example.com']) assert.equal(validate(email), false, email);
});
test('optional contact forms allow an absent email without weakening required email validation', () => {
  for (const [file,id] of [['customers','customer_email'],['suppliers','supplier_email']]) {
    const code=fs.readFileSync('frontend/static/script/js/modules/js/'+file+'.js','utf8');
    assert.ok(code.includes("(!$('#"+id+"').val() || PosnicPro.validateEmail($('#"+id+"').val()))"));
  }
});
