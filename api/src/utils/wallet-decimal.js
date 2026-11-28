"use strict";
// Exact arithmetic over the decimal values of persisted JavaScript numbers.
// No currency inference, rounding, or rewrite of existing ledger evidence.
function parts(text){
 const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(text));
 if(!match||String(text).length>400)throw Error('Invalid wallet decimal');
 let scale=(match[3]||'').length-Number(match[4]||0),value=BigInt(match[2]+(match[3]||''))*(match[1]==='-'?-1n:1n);
 if(Math.abs(scale)>324)throw Error('Wallet decimal scale is unsupported');
 if(scale<0){value*=10n**BigInt(-scale);scale=0;}
 while(scale>0&&value%10n===0n){value/=10n;scale--;}
 return {value,scale};
}
function numberParts(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('Invalid wallet amount');return parts(String(value));}
function numberOf(value,scale){
 const sign=value<0n?'-':'';let digits=String(value<0n?-value:value);digits=digits.padStart(scale+1,'0');
 const text=sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits),result=Number(text),actual=numberParts(result),expected=parts(text);
 if(actual.value!==expected.value||actual.scale!==expected.scale)throw Error('Wallet total cannot be stored exactly');return result;
}
function amount(value){const parsed=numberParts(value);if(parsed.value<0n)throw Error('Wallet amount must not be negative');return parsed;}
function balance(rows){
 let total=0n,scale=0;
 for(const row of rows){if(!['in','out'].includes(row.type))throw Error('Unsupported ledger entry');const next=amount(row.amount),target=Math.max(scale,next.scale);total*=10n**BigInt(target-scale);total+=(row.type==='in'?1n:-1n)*next.value*10n**BigInt(target-next.scale);scale=target;}
 return numberOf(total,scale);
}
module.exports={amount,balance};
