"use strict";
// Local execution evidence belongs to authenticated original-result workflows.
// This list is an API response boundary, not a cross-device ownership protocol.
const fields=Object.freeze([
 'books_receipt_lock','books_receipt_effect','books_receipt_effects','books_receipt_id',
 'legacy_invoice_payment_lock','legacy_invoice_payment_effects','legacy_invoice_payment_results',
 'legacy_invoice_payment_stops','legacy_invoice_payment_id',
 'invoice_issue_lock','invoice_payment_requests','invoice_payment_stops',
 'wallet_entry_lock','wallet_entry_requests',
]);
const projection=Object.freeze(Object.fromEntries(fields.map(field=>[field,0])));
// Follow API envelope containers only; do not rewrite arbitrary business text,
// custom fields, BSON identities or dates. Never use this to replace stored rows.
function publicResponse(value){
 if(Array.isArray(value))return value.map(publicResponse);
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)return value;
 const result={...value};for(const field of fields)delete result[field];
 for(const key of ['data','result','list'])if(Object.hasOwn(result,key))result[key]=publicResponse(result[key]);
 return result;
}
module.exports={fields,projection,publicResponse};
