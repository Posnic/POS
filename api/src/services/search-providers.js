'use strict';

const providers = [
  {
    route: 'customers',
    acl: 'customer',
    group: 'Customers',
    title: 'name',
    names: ['name'],
    keys: ['phone', 'alternatePhone'],
    contact: true,
  },
  {
    route: 'suppliers',
    acl: 'supplier',
    group: 'Purchases',
    title: 'name',
    names: ['name', 'company_name'],
    keys: ['phone'],
    contact: true,
  },
  {
    route: 'items',
    acl: 'item',
    group: 'Inventory',
    title: 'name',
    names: ['name'],
    keys: ['itemid', 'barcode_id', 'barcodes', 'sku', 'short_code', 'plu_code'],
  },
  {
    route: 'sales',
    acl: 'sales',
    group: 'Sales',
    title: 'sales_id',
    keys: ['sales_id', 'sale_no', 'invoice_number'],
  },
  {
    route: 'receivings',
    acl: 'receiving',
    group: 'Purchases',
    title: 'receiving_id',
    keys: ['receiving_id'],
  },
  {
    route: 'purchaseorders',
    collection: 'purchase_orders',
    acl: 'receiving',
    group: 'Purchases',
    title: 'po_id',
    keys: ['po_id'],
  },
  {
    route: 'invoices',
    acl: 'sales',
    group: 'Sales',
    title: 'invoice_id',
    keys: ['invoice_id'],
    feature: 'invoices_enable',
  },
  {
    route: 'quotes',
    acl: 'sales',
    group: 'Sales',
    title: 'quote_id',
    keys: ['quote_id'],
    feature: 'quotes_enable',
  },
];

// Shift punctuation for stored phone formats such as "(98765) 00142".
const phoneCollation = { locale: 'en', strength: 2, alternate: 'shifted', maxVariable: 'punct' };
module.exports = { providers, phoneCollation };
