'use strict';

const gtin = require('./gtin');

/*
 * Turn items into schema.org Product / ProductGroup JSON-LD.
 *
 * WHY THIS FORMAT
 *
 * It is the vocabulary Google, Bing and most tooling already read, it costs no
 * membership, and its ProductGroup/hasVariant shape matches how a variant
 * family actually is - one thing a customer browses, several things a shop
 * counts. See PRODUCT_EXPORT_FORMATS.md for the alternatives and why they lost.
 *
 * THE TWO RULES THAT MATTER MORE THAN COMPLETENESS
 *
 * 1. NEVER invent a gtin. barcode_id is not one - it may be an in-store code, a
 *    supplier reference, or free text. A wrong GTIN is worse than a missing
 *    one: it silently claims to be a product it is not, and everybody who
 *    matches against it inherits the error.
 *
 * 2. OMIT rather than guess. No weight: 0, no defaulted currency, no
 *    availability for an item that does not track stock. An absent field is
 *    honest; a defaulted one is a lie a machine will believe and act on.
 *
 * Both are cheap now and very expensive to unpick once anyone has consumed the
 * output.
 */

const SCHEMA = 'https://schema.org';

/* Drop keys that are null, undefined or empty - rule 2, applied once. */
function compact(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v) && !v.length) return;
    out[k] = v;
  });
  return out;
}

/*
 * schema.org's gtin properties are length-specific: gtin8, gtin12, gtin13,
 * gtin14. The generic `gtin` is also valid and is what newer consumers prefer,
 * so both are emitted - the specific one for older readers, the generic one
 * because it is where the vocabulary is going.
 */
function gtinProps(raw) {
  const parsed = gtin.parse(raw);
  if (!parsed) return {};
  const out = { gtin: parsed.gtin };
  out['gtin' + parsed.gtin.length] = parsed.gtin;
  return out;
}

/*
 * Availability is only meaningful when the shop counts this item.
 *
 * An item with track_inventory off has no stock figure worth stating - saying
 * OutOfStock because a field nobody maintains reads 0 would take a product off
 * the shelf in somebody else's system.
 */
function availability(item) {
  if (!item.track_inventory) return null;
  const qty = Number(item.available_quantity);
  if (!Number.isFinite(qty)) return null;
  return qty > 0 ? SCHEMA + '/InStock' : SCHEMA + '/OutOfStock';
}

function images(item) {
  const list = []
    .concat(Array.isArray(item.multi_image) ? item.multi_image : [])
    .concat(item.image ? [item.image] : [])
    .map((i) => (typeof i === 'string' ? i : i && (i.url || i.path || i.image)))
    .filter(Boolean);
  return [...new Set(list)];
}

/*
 * Extra facts that have no schema.org property of their own.
 *
 * HSN codes and PLU numbers are real, useful and entirely outside the
 * vocabulary. additionalProperty is where the spec says such things go, and it
 * keeps them machine-readable instead of glued into the description.
 */
function additionalProperties(item) {
  const props = [];
  const add = (name, value) => {
    if (value === null || value === undefined || value === '') return;
    props.push({ '@type': 'PropertyValue', name, value: String(value) });
  };
  add('hsnCode', item.hsncode);
  add('pluCode', item.plu_code);
  add('unit', item.unit);
  if (Array.isArray(item.tags) && item.tags.length) add('tags', item.tags.join(', '));
  return props;
}

function offer(item, currency) {
  return compact({
    '@type': 'Offer',
    price: Number.isFinite(Number(item.selling_price)) ? String(item.selling_price) : null,
    priceCurrency: currency || null,
    availability: availability(item),
  });
}

/*
 * One variant.
 *
 * `variant_value` is emitted as-is under additionalProperty rather than being
 * split into color/size. For one axis that split would be a guess at which
 * schema.org property the shop's axis name maps to; for two it is not possible
 * at all, because the separator is a legal character inside a value. Stating
 * the axis and its value honestly beats inventing structure that is wrong.
 */
function product(item, opts = {}) {
  const currency = opts.currency;
  const extra = additionalProperties(item);
  if (item.variant_axis && item.variant_value) {
    extra.push({
      '@type': 'PropertyValue',
      name: String(item.variant_axis),
      value: String(item.variant_value),
    });
  }

  return compact({
    '@type': 'Product',
    '@id': item._id ? String(item._id) : null,
    name: item.name,
    description: item.description,
    sku: item.itemid,
    ...gtinProps(item.gtin),
    brand: item.brand ? { '@type': 'Brand', name: item.brand } : null,
    category: item.category_name,
    image: images(item),
    additionalProperty: extra,
    offers: offer(item, currency),
  });
}

/*
 * A family, grouped by variant_group_id - never by name, because two products
 * can share one.
 *
 * The group carries no gtin, and that is correct per the spec: a GTIN
 * identifies a trade item, and "T-Shirt" in the abstract is not one.
 */
function productGroup(items, opts = {}) {
  const first = items[0] || {};
  const axes = [...new Set(items.map((i) => i.variant_axis).filter(Boolean))];

  return compact({
    '@type': 'ProductGroup',
    productGroupID: first.variant_group_id ? String(first.variant_group_id) : null,
    name: first.variant_parent_name || first.name,
    description: first.description,
    brand: first.brand ? { '@type': 'Brand', name: first.brand } : null,
    category: first.category_name,
    variesBy: axes,
    hasVariant: items.map((i) => product(i, opts)),
  });
}

/*
 * The whole catalogue.
 *
 * Items with a variant_group_id become groups; everything else stays a plain
 * Product. Grouping happens on the id alone - a family whose members somehow
 * disagree about their parent name still groups correctly, because the id is
 * the fact and the name is a label.
 */
function serialize(items, opts = {}) {
  const groups = new Map();
  const singles = [];

  (items || []).forEach((item) => {
    const gid = item.variant_group_id ? String(item.variant_group_id) : '';
    if (!gid) {
      singles.push(item);
      return;
    }
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(item);
  });

  const graph = [];
  groups.forEach((members) => {
    /* A "family" of one is not a family - a group with a single variant tells
       a consumer there are choices when there are none. */
    if (members.length === 1) { singles.push(members[0]); return; }
    graph.push(productGroup(members, opts));
  });
  singles.forEach((i) => graph.push(product(i, opts)));

  return { '@context': SCHEMA, '@graph': graph };
}

module.exports = { serialize, product, productGroup, gtinProps, availability, compact };
