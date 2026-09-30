const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('frontend/static/script/js/modules/js/customers.js','utf8');
test('customer phone keeps the dial code separate through edit, validation and save',()=>{
 const dom=new JSDOM('<input id="customer_phone">',{runScripts:'outside-only',url:'https://example.test'});
 try {
  const w=dom.window;w.$=require('jquery')(w);
  w.eval(fs.readFileSync('frontend/static/script/js/intlTelInput.min.js','utf8'));
  w.eval(fs.readFileSync('frontend/static/script/js/utils.js','utf8'));
  const input=w.document.getElementById('customer_phone');
  const phone=w.intlTelInput(input,{initialCountry:'in',separateDialCode:true});
  w.PosnicPro={customers:{customer_phone:phone}};
  const start=source.indexOf('    setPhone: function (number) {');
  w.eval('PosnicPro.customers.setPhone = '+source.slice(start+'    setPhone: '.length,source.indexOf('\n    showAdd:',start)).replace(/,\s*$/,''));
  const a=source.indexOf('function (phone_number, element) {',source.indexOf('addMethod("customer_phone_number"'));
  const b=source.indexOf(', "Enter a valid phone number");',a);
  const validate=w.eval('('+source.slice(a,b)+')');
  for(const value of ['9000000121','+919000000121','+91 90000 00121']) {
   w.PosnicPro.customers.setPhone(value);
   assert.equal(input.value.includes('+91'),false);
   const before=input.value;
   assert.equal(validate(input.value,input),true);
   assert.equal(input.value,before);
   assert.equal(phone.getNumber(),'+919000000121');
   w.formData={full:'stale'};
   const save=source.indexOf('            var phoneInput = PosnicPro.customers.customer_phone;');
   w.eval(source.slice(save,source.indexOf('            var categoryDetail',save)));
   assert.equal(w.formData.phone,'+919000000121');
   assert.equal(w.formData.full,undefined);
  }
  w.PosnicPro.customers.setPhone('+91 90000 121');
  assert.equal(validate(input.value,input),false);
  w.PosnicPro.customers.setPhone('');
  assert.equal(validate(input.value,input),true);
 }finally{dom.window.close();}
});
