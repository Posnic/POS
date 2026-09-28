'use strict';
const {getRequestContext}=require('../utils/request-context');
// Read only this authenticated request, never process-wide fallback state or client fields.
module.exports=function kitchenActor(){
  const context=getRequestContext();
  const id=String(context?.loggedUser || '');
  return /^[a-f0-9]{24}$/i.test(id) ? {id,name:String(context.loggedUserName || '').slice(0,80)} : {id:'',name:''};
};
