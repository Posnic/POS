const mongoose = require('mongoose');
const toJSON = require('./plugins/toJSON.plugin');
const paginate = require('./plugins/paginate.plugin');

// Register Item model before using it in references
require('./item.model');

// Stock Movement Types
const STOCK_MOVEMENT_TYPES = {
  PURCHASE: 'purchase',
  SALE: 'sale',
  ADJUSTMENT: 'adjustment',
  RETURN: 'return',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  DAMAGED: 'damaged',
  LOST: 'lost',
  FOUND: 'found',
  COUNT: 'count',
  OPENING_BALANCE: 'opening_balance',
};

const stockMovementSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
    },
    movementType: {
      type: String,
      enum: Object.values(STOCK_MOVEMENT_TYPES),
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    reference: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'referenceModel',
    },
    referenceModel: {
      type: String,
      enum: ['Sale', 'Receiving', 'InventoryAdjustment', 'StockTransfer', 'StockCount'],
    },
    notes: String,
    unitCost: Number,
    totalCost: Number,
    previousQuantity: Number,
    newQuantity: Number,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add plugins
stockMovementSchema.plugin(toJSON);
stockMovementSchema.plugin(paginate);

const StockMovement = mongoose.model('StockMovement', stockMovementSchema);

const inventoryItemSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    committed: {
      type: Number,
      default: 0,
      min: 0,
    },
    available: {
      type: Number,
      default: 0,
      min: 0,
    },
    reorderLevel: {
      type: Number,
      required: true,
      min: 0,
      default: 5,
    },
    reorderQuantity: {
      type: Number,
      min: 1,
      default: 10,
    },
    lastMovement: {
      type: Date,
      default: Date.now,
    },
    lastCost: Number,
    averageCost: Number,
    totalValue: Number,
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add compound index for item and branch to ensure uniqueness
inventoryItemSchema.index({ item: 1, branch: 1 }, { unique: true });

// Add virtual for available stock
inventoryItemSchema.virtual('availableQuantity').get(function () {
  return Math.max(0, this.quantity - this.committed);
});

// Update available quantity before saving
inventoryItemSchema.pre('save', function () {
  this.available = Math.max(0, this.quantity - this.committed);
});

// Add plugins
inventoryItemSchema.plugin(toJSON);
inventoryItemSchema.plugin(paginate);

// Static method to update inventory
inventoryItemSchema.statics.updateInventory = async function (
  itemId,
  branchId,
  quantity,
  movementType,
  reference,
  userId
) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find or create inventory item
    let inventoryItem = await this.findOne({
      item: itemId,
      branch: branchId,
    }).session(session);

    if (!inventoryItem) {
      inventoryItem = new this({
        item: itemId,
        branch: branchId,
        quantity: 0,
        committed: 0,
        reorderLevel: 5,
        reorderQuantity: 10,
      });
    }

    const previousQuantity = inventoryItem.quantity;
    let newQuantity = previousQuantity;

    // Update quantity based on movement type
    switch (movementType) {
      case STOCK_MOVEMENT_TYPES.PURCHASE:
      case STOCK_MOVEMENT_TYPES.RETURN:
      case STOCK_MOVEMENT_TYPES.TRANSFER_IN:
      case STOCK_MOVEMENT_TYPES.FOUND:
      case STOCK_MOVEMENT_TYPES.OPENING_BALANCE:
        newQuantity += quantity;
        break;

      case STOCK_MOVEMENT_TYPES.SALE:
      case STOCK_MOVEMENT_TYPES.TRANSFER_OUT:
      case STOCK_MOVEMENT_TYPES.DAMAGED:
      case STOCK_MOVEMENT_TYPES.LOST:
        newQuantity = Math.max(0, newQuantity - Math.abs(quantity));
        break;

      case STOCK_MOVEMENT_TYPES.ADJUSTMENT:
      case STOCK_MOVEMENT_TYPES.COUNT:
        newQuantity = quantity;
        break;
    }

    // Update inventory
    inventoryItem.quantity = newQuantity;
    inventoryItem.lastMovement = new Date();

    // Save inventory changes
    await inventoryItem.save({ session });

    // Create stock movement log
    const stockMovement = new StockMovement({
      item: itemId,
      branch: branchId,
      movementType,
      quantity: Math.abs(quantity),
      reference: reference?._id || null,
      referenceModel: reference ? reference.constructor.modelName : null,
      previousQuantity,
      newQuantity,
      createdBy: userId,
    });

    await stockMovement.save({ session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    return { inventoryItem, stockMovement };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// Method to check stock availability
inventoryItemSchema.statics.checkAvailability = async function (
  itemId,
  branchId,
  requiredQuantity
) {
  const inventoryItem = await this.findOne({ item: itemId, branch: branchId });

  if (!inventoryItem) {
    return {
      available: 0,
      isAvailable: false,
      needsReorder: false,
      message: 'Item not found in inventory',
    };
  }

  const available = inventoryItem.availableQuantity;
  const isAvailable = available >= requiredQuantity;
  const needsReorder = available <= inventoryItem.reorderLevel;

  return {
    available,
    isAvailable,
    needsReorder,
    reorderLevel: inventoryItem.reorderLevel,
    reorderQuantity: inventoryItem.reorderQuantity,
    message: isAvailable
      ? 'Sufficient stock available'
      : `Only ${available} units available, ${requiredQuantity - available} more needed`,
  };
};

// Method to get stock movements for an item
inventoryItemSchema.statics.getStockHistory = async function (itemId, branchId, options = {}) {
  const { page = 1, limit = 10, startDate, endDate, movementType } = options;

  const query = { item: itemId };

  if (branchId) {
    query.branch = branchId;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  if (movementType) {
    query.movementType = movementType;
  }

  const [results, total] = await Promise.all([
    StockMovement.find(query)
      .populate('createdBy', 'name email')
      .populate('reference')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    StockMovement.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    results,
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

// Method to get low stock items
inventoryItemSchema.statics.getLowStockItems = async function (branchId) {
  return this.find({
    branch: branchId,
    $expr: { $lte: ['$availableQuantity', '$reorderLevel'] },
    isActive: true,
  })
    .populate('item', 'name sku barcode')
    .sort({ availableQuantity: 1 });
};

const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema);

module.exports = {
  InventoryItem,
  StockMovement,
  STOCK_MOVEMENT_TYPES,
};
