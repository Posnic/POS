'use strict';
// Host-injected capability. Request bodies, app.locals and copied business data
// cannot supply the installation allowed to execute a payment.
const capabilities=new WeakMap();
function fail(code='books_authority_unavailable'){
 throw Object.assign(new Error(code),{code,status:503});
}
function attach(app,read){
 if(!app||!['function','object'].includes(typeof app)||typeof read!=='function'||capabilities.has(app))fail();
 capabilities.set(app,read);
}
async function authority(app){
 const read=app&&capabilities.get(app);if(!read)fail();
 let identity;
 try{identity=await read();}catch{fail();}
 if(!identity||identity.version!==1||typeof identity.requiresRestart!=='boolean'||
    typeof identity.authority!=='string'||!/^books-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(identity.authority))fail();
 if(identity.requiresRestart)fail('books_authority_restart_required');
 return identity.authority;
}
module.exports={attach,authority};
