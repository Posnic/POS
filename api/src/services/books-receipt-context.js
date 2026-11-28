'use strict';
const runtime=require('./books-receipt-runtime');
function fail(code='books_receipt_context_invalid'){
 throw Object.assign(new Error(code),{code,status:403});
}
function text(value){return typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value);}
function identity(value){
 if(text(value))return ['string',value];
 if(value?._bsontype==='ObjectId'&&typeof value.toHexString==='function'&&/^[a-f0-9]{24}$/.test(value.toHexString()))return ['objectId',value.toHexString()];
 fail();
}
function same(a,b){return JSON.stringify(identity(a))===JSON.stringify(identity(b));}
function scoped(req){
 const user=req?.user,tenant=req?.tenantContext;
 if(!req?.db||!user||!tenant||!same(user.license,tenant.licenseId)||!Array.isArray(user.branch_access))fail();
 identity(tenant.branchId);
 if(user.branch_access.length&&!user.branch_access.some(row=>row?.branch_id!=null&&same(row.branch_id,tenant.branchId)))fail();
 return {user,tenant};
}
async function resolve(req,action){
 if(!['read','write'].includes(action))fail('books_receipt_permission_required');
 const {user,tenant}=scoped(req);
 const token=user.api_token===true||req.isScopedApiToken===true;
 if(token&&action==='write')fail('books_receipt_cashier_required');
 if((token?user.access?.sales?.read:user.access?.sale?.[action])!==true)fail('books_receipt_permission_required');
 const actor=identity(user._id)[1];
 if(!token&&!text(user.username))fail();
 const authority=await runtime.authority(req.app);
 return Object.freeze({license:tenant.licenseId,branchId:identity(tenant.branchId)[1],actorId:actor,
  actorName:token?'Integration':user.username,authority});
}
module.exports={resolve,scoped};
