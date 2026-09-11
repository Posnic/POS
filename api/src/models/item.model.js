const mongoose = require('mongoose');
const { defineModel } = require('../db/model-registry');
const { toJSON, paginate } = require('./plugins');

// Mongoose-based Item model used by new code (sales, inventory, categories)
const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    barcode_id: String,
    sku: String,
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    category_name: { type: String, trim: true },
    supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    supplier_name: { type: String, trim: true },
    branch_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    branch_name: { type: String, trim: true },
    quantity: { type: Number, default: 0 },
    available_quantity: { type: Number, default: 0 },
    cost_price: { type: Number, default: 0 },
    company_price: { type: Number, default: 0 },
    selling_price: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    discount_percentage: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    tax_type: { type: String, trim: true },
    tax_name: { type: String, trim: true },
    tax_fields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    hsncode: { type: String, trim: true },
    hsndescription: { type: String, trim: true },
    itemid: { type: String, trim: true },
    item_status: { type: String, trim: true },
    track_inventory: { type: Boolean, default: false },
    negative_stock: { type: Boolean, default: false },
    image: { type: String, trim: true },

    /*
     * Whether this appears on the shop's public menu.
     *
     * SEPARATE FROM `ecommerce`, which decides whether a thing can be ordered.
     * A restaurant's menu is not its ordering catalogue: a dish can be listed
     * and not sold - market price, or off tonight - and the menu should still
     * say what the kitchen cooks. So this defaults to true and a shop excludes
     * the few lines that are not dishes: packaging, staff meals, the "misc"
     * entry every till accumulates.
     */
    show_on_menu: { type: Boolean, default: true },

    /*
     * The channels this item is NOT sold on, and when it is limited.
     *
     * EXCEPTIONS, not memberships, and the direction matters. A list of the
     * channels an item IS on means six flags per item before a shop can sell
     * anything, and a channel added later sells nothing until somebody edits
     * two hundred items. Storing what is different means a new item sells
     * everywhere, a new channel sells everything, and a shop records only the
     * cigarettes it will not put on Swiggy.
     *
     * Entries are a channel id OR a partner id, because "not on Swiggy" is the
     * request shops actually make and swiggy is a partner on the marketplace
     * channel, not a channel. See utils/item-channels.js.
     */
    channel_off: { type: [String], default: [] },

    /*
     * Per-channel windows: { online: { from: '11:00', to: '15:00' } }.
     *
     * A different clock from the serving periods above. Breakfast is breakfast
     * on every channel; this is "we stop taking app orders for this at three
     * because it arrives cold". An item can carry both, and both must be true.
     */
    channel_hours: { type: mongoose.Schema.Types.Mixed, default: {} },

    /*
     * The dot. `veg`, `non_veg`, `egg`, `vegan`, or empty for "not said".
     *
     * Not decoration. Indian menus mark this by law and customers look for it
     * before they read the name; a menu without it is not one an Indian
     * restaurant can put on a table. Elsewhere it reads as the dietary marking
     * a good menu carries anyway. Empty is honest, and better than a wrong
     * mark on a dish somebody cannot eat.
     */
    diet: { type: String, trim: true, default: '' },

    /*
     * When this is served: breakfast, lunch, dinner. Empty means always, which
     * is most of a menu - the cost of this feature falls only on the dishes
     * that need it.
     *
     * Ids into the shop's own list of periods rather than hours per item: two
     * hundred dishes times seven days is data entry no shop will do, and the
     * first time breakfast moves half an hour they would edit it two hundred
     * times.
     */
    daypart_ids: { type: [String], default: [] },

    /*
     * A standing instruction to the kitchen, printed on every ticket for this
     * dish. "Serve with mint chutney." "Always ask how they want it cooked."
     *
     * Not the same as the note a customer types with an order - that is
     * sale.item_description and already exists. This one belongs to the dish
     * and nobody has to remember it.
     */
    prep_note: { type: String, trim: true, default: '' },

    /* Roughly how long it takes, in minutes, so an order can say when it will
       be ready. Zero means the shop has not said, and nothing guesses. */
    prep_minutes: { type: Number, default: 0 },

    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    is_active: { type: Boolean, default: true },
  },
  {
    collection: 'items',
    timestamps: { createdAt: 'created_date', updatedAt: 'updated_date' },
  }
);

itemSchema.plugin(toJSON);
itemSchema.plugin(paginate);

/*
 * The Item List's whitelisted sorts (price, cost, stock, recency, name) each
 * walk one of these; without them every re-sort scans the branch's whole
 * catalogue. Margin sort is computed per query and cannot use an index -
 * that one is documented as a scan in item.repository.findPage.
 */
itemSchema.index({ license: 1, branch_id: 1, selling_price: -1 });
itemSchema.index({ license: 1, branch_id: 1, company_price: -1 });
itemSchema.index({ license: 1, branch_id: 1, available_quantity: 1 });
itemSchema.index({ license: 1, branch_id: 1, updated_date: -1 });
itemSchema.index({ license: 1, branch_id: 1, name: 1 });

const Item = defineModel('Item', itemSchema);

// Attach the legacy BaseModel-based implementation so callers can import
// both the Mongoose model and the legacy class from a single module
// (item.model.js).
// NOTE: ItemModel now primarily exists for backward compatibility. The
// authoritative implementations for all item DB operations live in
// ItemRepository. Most instance methods below are legacy-only and should
// not be used by new code.
//
// Usage examples (legacy only - new code should NOT use these directly):
//   const Item = require("../models/item.model");          // Mongoose
//   const LegacyItem = Item.LegacyItemModel;               // Legacy class alias
//   const { LegacyItemModel } = require("../models/item.model");

class ItemModel {
  static collectionName = 'items';

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    name: { type: 'String', select: true },
    itemid: { type: 'String', select: true },
    barcode_id: { type: 'String', select: true },
    /*
     * The GLOBAL identifier, kept apart from barcode_id on purpose.
     *
     * barcode_id is whatever this shop prints or scans - it may be a GTIN, an
     * in-store code, or a supplier reference somebody typed. gtin is only ever
     * set when it validates (see utils/gtin.js), because a wrong GTIN is worse
     * than a missing one: it claims to be a product it is not, and anyone
     * matching against it inherits the error.
     *
     * gtin14 is the zero-padded comparison form. A UPC-A and the EAN-13 of the
     * same product differ only by a leading zero, so matching on the raw string
     * is how one product becomes two rows.
     */
    gtin: { type: 'String', select: true },
    gtin14: { type: 'String', select: true },
    image: { type: 'String', select: true },
    multi_image: { type: 'Array', select: true },
    category_id: { type: 'ObjectId', select: true },
    category_name: { type: 'String', select: true },
    supplier_id: { type: 'ObjectId', select: true },
    supplier_name: { type: 'String', select: true },
    mrp_price: { type: 'Number', select: true },
    company_price: { type: 'Number', select: true },
    selling_price: { type: 'Number', select: true },
    available_quantity: { type: 'Number', select: true },
    item_status: { type: 'String', select: true },
    description: { type: 'String', select: true },
    tax: { type: 'Number', select: true },
    tax_id: { type: 'ObjectId', select: true },
    tax_name: { type: 'String', select: true },
    tax_type: { type: 'String', select: true },
    tax_method: { type: 'String', select: true },
    tax_fields: { type: 'Array', select: true },
    hsncode: { type: 'String', select: true },
    hsndescription: { type: 'String', select: true },
    discount_amount: { type: 'Number', select: true },
    discount_percentage: { type: 'Number', select: true },
    unit: { type: 'String', select: true },
    unit_id: { type: 'String', select: true },
    track_inventory: { type: 'Boolean', select: true },
    ecommerce: { type: 'Boolean', select: true },
    show_on_menu: { type: 'Boolean', select: true },
    channel_off: { type: 'Array', select: true },
    channel_hours: { type: 'Object', select: true },
    diet: { type: 'String', select: true },
    daypart_ids: { type: 'Array', select: true },
    prep_note: { type: 'String', select: true },
    prep_minutes: { type: 'Number', select: true },
    isAvailable: { type: 'Boolean', select: true },
    negative_stock: { type: 'Boolean', select: true },
    sort_order: { type: 'Number', select: true },
    // Alternate barcodes (V3) - lookup matches these beside barcode_id.
    barcodes: { type: 'Array', select: true },
    // Unit conversion (V3) - receiving entry assist; stock stays base units.
    purchase_unit: { type: 'String', select: true },
    conversion_factor: { type: 'Number', select: true },
    // Variant family link (V1) - the edit page's family strip reads these.
    variant_group_id: { type: 'ObjectId', select: true },
    variant_axis: { type: 'String', select: true },
    variant_value: { type: 'String', select: true },
    variant_parent_name: { type: 'String', select: true },
    /* IC0: the form wrote these long before the map knew them - any read
       projecting through this map silently dropped them. */
    items_mfg_date: { type: 'String', select: true },
    items_expiry_date: { type: 'String', select: true },
    item_weight_machine_based: { type: 'Boolean', select: true },
    modifier_group_ids: { type: 'Array', select: true },
    // IC1: deliberate ask-at-the-till pricing, set from the item form.
    open_price: { type: 'Boolean', select: true },
    // Loyverse study L2: the no-image sale-grid tile's colour and shape.
    tile_color: { type: 'String', select: true },
    tile_shape: { type: 'String', select: true },
    // Quick code (owner ask): "22 is hamam soap" - typed + Enter carts it.
    plu_code: { type: 'String', select: true },
    // Square study Q3: services - a second sellable kind, no stock.
    item_kind: { type: 'String', select: true },
    service_unit: { type: 'String', select: true },
    // Lightspeed study LS1: brand, tags, per-item reorder point.
    brand: { type: 'String', select: true },
    tags: { type: 'Array', select: true },
    reorder_point: { type: 'Number', select: true },
    branch_access: { type: 'Array', select: false },
    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    created_by_id: { type: 'ObjectId', select: false },
    updated_by: { type: 'String', select: false },
    updated_by_id: { type: 'ObjectId', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

Item.LegacyItemModel = ItemModel;

module.exports = Item;
