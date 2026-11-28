'use strict';
// Explicit adapter; do not register in the live router until UI, all-writer and
// installation-authority acceptance is complete.
const express=require('express');
const {ObjectId}=require('mongodb');
const {resolveAccess}=require('../utils/access-resolver');
const engine=require('../services/customer-wallet-settlement');
function can(user,permission){
 if(!user)return false;
 if(['owner','admin','super_admin'].includes(String(user.usertype||user.role||'').toLowerCase()))return true;
 return resolveAccess(user).customer?.[permission]===true;
}
function createRouter({protect}){
 if(typeof protect!=='function')throw Error('Settlement routes require authentication middleware');
 const router=express.Router();router.use(protect);router.use(express.json({limit:'32kb'}));
 const deny=(res,message,status=403)=>res.status(status).json({type:'error',message,data:null});
 async function handle(req,res,action){
  if(!req.user?._id)return deny(res,'Sign in to continue',401);
  if(!can(req.user,'read'))return deny(res,'Customer read permission is required');
  if(action!=='status'&&!can(req.user,'write'))return deny(res,'Customer write permission is required');
  const license=String(req.tenantContext?.licenseId||req.user.license||''),branch=String(req.tenantContext?.branchId||req.user.branch_id||'');
  if(![license,branch,req.params.customerId,String(req.user._id)].every(value=>typeof value==='string'&&ObjectId.isValid(value)))return deny(res,'A valid business, branch, cashier and customer are required',400);
  if(req.user.license&&String(req.user.license)!==license)return deny(res,'Business access differs');
  const branches=[req.user.branch_id,...(Array.isArray(req.user.branch_access)?req.user.branch_access.map(value=>value.branch_id):[])].filter(Boolean).map(String);
  if(!branches.includes(branch))return deny(res,'Branch access is required');
  if(!req.db||typeof req.db.collection!=='function')return deny(res,'The authenticated business database is unavailable',503);
  const context={license,branchId:branch,customerId:req.params.customerId,actorId:String(req.user._id)},id=req.params.commandId;
  try{
   const service=engine.create({db:req.db});let result;
   if(action==='status')result=await service.status(context,id);
   else{
    const allowed=['confirmed',...(action==='submit'?['request']:[])];
    if(req.body?.confirmed!==true||Object.keys(req.body||{}).some(key=>!allowed.includes(key)))return deny(res,'Confirm the original settlement request',400);
    if(action==='submit')result=await service.submit(context,id,req.body.request);
    else if(action==='recover')result=await service.resume(context,id);
    else result=await service.stop(context,id);
   }
   return res.json({type:'success',message:'Settlement request checked',data:result});
  }catch(error){
   if(error.code==='wallet_settlement_conflict')return deny(res,error.message,409);
   return deny(res,'The settlement result could not be confirmed. Keep the original request and check again.',503);
  }
 }
 const base='/:customerId/wallet-settlements/:commandId';
 router.get(base,(req,res)=>handle(req,res,'status'));
 router.post(base,(req,res)=>handle(req,res,'submit'));
 router.post(base+'/recover',(req,res)=>handle(req,res,'recover'));
 router.post(base+'/stop',(req,res)=>handle(req,res,'stop'));
 return router;
}
module.exports={createRouter};
