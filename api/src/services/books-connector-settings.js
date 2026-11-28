'use strict';
// Authorization boundary only; settings storage and enablement are not mounted.
const {scoped}=require('./books-receipt-context');
async function context(req){
 const {user,tenant}=scoped(req);
 if(user.api_token===true||req.isScopedApiToken===true||user.access?.branch?.write!==true){
  throw Object.assign(new Error('books_connector_permission_required'),{code:'books_connector_permission_required',status:403});
 }
 return Object.freeze({license:tenant.licenseId,branchId:String(tenant.branchId)});
}
module.exports={context};
