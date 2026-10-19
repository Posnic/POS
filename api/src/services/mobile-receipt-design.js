'use strict';
const mobile = require('./mobile-pos');
const design = require('../helpers/receipt-design');
const fields = [
  'branch_name',
  'printing_address',
  'store_telephone',
  'store_email',
  'branch_gstin_number',
  'branch_fssai_number',
  'country',
  'table_options',
  'website',
  'invoice_terms',
  'quote_default_signature',
];
async function profile(branch) {
  if (!branch.receipt_designs) return null;
  let receiptDesign;
  try {
    receiptDesign = design.normalize(branch.receipt_designs);
  } catch {
    return null;
  }
  const data = {};
  for (const key of fields)
    if (typeof branch[key] === 'string' || typeof branch[key] === 'boolean')
      data[key] = branch[key];
  let assetsComplete = true;
  if (branch.logo && branch.logo !== 'store.png') {
    if (design.image(branch.logo)) data.logo = branch.logo;
    else {
      const store = require('../utils/image-store');
      const resolved = store.resolve(branch.logo);
      const key = resolved?.startsWith('/uploads/') ? resolved.slice(9) : '';
      const path =
        store.localPathFor(key) ||
        (store.isLegacyFile(key) ? require('path').join(store.UPLOAD_DIR, key) : null);
      if (path) {
        try {
          const bytes = await require('fs/promises').readFile(path);
          if (bytes.length > 300000) throw Error('logo too large');
          const type = /\.png$/.test(key) ? 'png' : /\.webp$/.test(key) ? 'webp' : 'jpeg';
          data.logo = 'data:image/' + type + ';base64,' + bytes.toString('base64');
        } catch {
          assetsComplete = false;
        }
      } else assetsComplete = false;
    }
  }
  data.receipt_designs = receiptDesign;
  return { version: mobile.hash(mobile.canonical(data)), data, assetsComplete };
}
module.exports = { profile };
