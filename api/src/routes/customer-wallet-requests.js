"use strict";
// Adapter is not registered in the live customer router yet. Mount only with
// tenant-aware authentication after legacy writer/UI acceptance is complete.
const express=require('express');
const {ObjectId}=require('mongodb');
const {resolveAccess}=require('../utils/access-resolver');
function can(user,permission){
 if(!user)return false;
 if(['owner','admin','super_admin'].includes(String(user.usertype||user.role||'').toLowerCase()))return true;
 return resolveAccess(user).customer?.[permission]===true;
}
const engine=require('../services/customer-wallet-request');
function createRouter({protect}){
 if(typeof protect!=='function')throw new Error('Wallet routes require authentication middleware');
 const router=express.Router();router.use(protect);router.use(express.json({limit:'8kb'}));
 function deny(res,message,status=403){return res.status(status).json({type:'error',message,data:null});}
 function allowed(req,kind){return can(req.user,kind==='remove'?'delete':'write');}
 async function handle(req,res,action){
  if(!req.user?._id)return deny(res,'Sign in to continue',401);
  if(!can(req.user,'read'))return deny(res,'Customer read permission is required');
  const license=String(req.tenantContext?.licenseId||req.user.license||'');
  const branch=String(req.tenantContext?.branchId||req.user.branch_id||'');
  if(![license,branch,req.params.customerId].every(value=>typeof value==='string'&&ObjectId.isValid(value)))return deny(res,'A valid business, branch and customer are required',400);
  if(req.user.license&&String(req.user.license)!==String(license))return deny(res,'Business access differs');
  const branches=[req.user.branch_id,...(Array.isArray(req.user.branch_access)?req.user.branch_access.map(value=>value.branch_id):[])].filter(Boolean).map(String);
  if(!branches.includes(String(branch)))return deny(res,'Branch access is required');
  if(!req.db||typeof req.db.collection!=='function')return deny(res,'The authenticated business database is unavailable',503);
  const context={license,branchId:branch,customerId:req.params.customerId,actorId:String(req.user._id)};
  const service=engine.create({db:req.db}),id=req.params.commandId;
  try{
   let result;
   if(action==='status')result=await service.status(context,id);
   else{
    const keys=Object.keys(req.body||{});
    if(req.body?.confirmed!==true||keys.some(key=>!['confirmed',...(action==='submit'?['request']:[])].includes(key)))return deny(res,'Confirm the original wallet request',400);
    if(action==='submit'){
     if(!['add','remove'].includes(req.body.request?.kind))return deny(res,'Choose a wallet action',400);
     if(!allowed(req,req.body.request.kind))return deny(res,'Permission for this wallet action is required');
     result=await service.submit(context,id,req.body.request);
    }else{
     const original=await service.status(context,id);
     const kind=original.request?.kind||original.kind;
     if(!['add','remove'].includes(kind))return deny(res,'No original wallet request is available to recover',409);
     if(!allowed(req,kind))return deny(res,'Permission for this wallet action is required');
     result=await service.resume(context,id);
    }
   }
   return res.json({type:'success',message:'Wallet request checked',data:result});
  }catch(error){
   if(error.code==='wallet_request_conflict')return deny(res,error.message,409);
   return deny(res,'The wallet result could not be confirmed. Keep the original request and check again.',503);
  }
 }
 router.get('/:customerId/wallet-requests/:commandId',(req,res)=>handle(req,res,'status'));
 router.post('/:customerId/wallet-requests/:commandId',(req,res)=>handle(req,res,'submit'));
 router.post('/:customerId/wallet-requests/:commandId/recover',(req,res)=>handle(req,res,'recover'));
 return router;
}
module.exports={createRouter};
