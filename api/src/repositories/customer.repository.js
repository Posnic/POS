// src/repositories/customer.repository.js
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

/**
 * Customer Repository
 * Handles all database operations for customers
 * Separates data access logic from business logic
 */
class CustomerRepository extends BaseModel {
  constructor() {
    super('customers');
  }

  /**
   * Find all customers with pagination and filters
   */
  async findAll(filters = {}, options = {}) {
    const { page = 1, limit = 10, sort = { created_date: -1 } } = options;

    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);

    const [customers, total] = await Promise.all([
      collection
        .find(query)
        .sort(sort)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: customers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find customer by ID
   */
  async findById(id) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
      ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
      is_deleted: { $ne: true },
    });
  }

  /**
   * Find customer by email
   */
  async findByEmail(email) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      email,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });
  }

  /**
   * Find customer by phone
   */
  async findByPhone(phone) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      phone,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });
  }

  /**
   * Find customer by name and phone (for duplicate checking during import)
   */
  async findByNameAndPhone(name, phone, branchId) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      name,
      phone,
      branch_id: new ObjectId(branchId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });
  }

  /**
   * Search customers by query
   */
  async search(searchTerm, options = {}) {
    const { page = 1, limit = 10, branchId = null } = options;

    const query = {
      license: BaseModel.license,
      is_deleted: { $ne: true },
      $or: [
        { name: new RegExp(searchTerm, 'i') },
        { email: new RegExp(searchTerm, 'i') },
        { phone: new RegExp(searchTerm, 'i') },
      ],
    };

    if (branchId) {
      query.branch_id = new ObjectId(branchId);
    }

    const collection = await this.getCollection(this.collectionName);

    const [customers, total] = await Promise.all([
      collection
        .find(query)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return { data: customers, total };
  }

  /**
   * Create new customer
   */
  async create(customerData) {
    const collection = await this.getCollection(this.collectionName);
    const normalizedData = { ...customerData };
    if (typeof normalizedData.email !== 'string' || !normalizedData.email.trim()) {
      delete normalizedData.email;
    }
    const document = {
      ...normalizedData,
      license: BaseModel.license,
      created_date: new Date(),
      updated_date: new Date(),
      is_deleted: false,
    };

    /*
     * S7 step one (D5). Customers are branch-scoped here while every
     * comparable product keeps them account-level: a customer who buys at one
     * shop is the same person at the next, and today their loyalty, credit and
     * consent fragment across branches.
     *
     * This writes the relation ITEMS already use - branch_access[] - alongside
     * the existing branch_id, seeded with the branch that owns the record.
     * Nothing moves and nothing reads it yet: with access listing only the
     * owning branch, every customer stays exactly as visible as before.
     * Sharing one is then a deliberate grant, not a migration side effect.
     *
     * The rule that matters for the phase after this: LINK, never merge. Two
     * shops may hold same-name customers with different balances, and deciding
     * they are one person is the owner's call, not a script's.
     */
    if (!Array.isArray(document.branch_access)) {
      const owning = document.branch_id || BaseModel.currentBranch || null;
      document.branch_access = owning
        ? [{ branch_id: owning, branch_name: document.branch_name || '' }]
        : [];
    }

    const result = await collection.insertOne(document);
    return await this.findById(result.insertedId);
  }

  /**
   * Update customer
   */
  async update(id, updateData) {
    const collection = await this.getCollection(this.collectionName);
    const normalizedData = { ...updateData };
    const unsetEmail =
      Object.prototype.hasOwnProperty.call(normalizedData, 'email') &&
      (typeof normalizedData.email !== 'string' || !normalizedData.email.trim());
    if (unsetEmail) delete normalizedData.email;
    const updateOperation = {
      $set: { ...normalizedData, updated_date: new Date() },
    };
    if (unsetEmail) updateOperation.$unset = { email: '' };

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        license: BaseModel.license,
        is_deleted: { $ne: true },
      },
      updateOperation,
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Hard delete customer with backup (matching PHP implementation)
   */
  async softDelete(id) {
    const collection = await this.getCollection(this.collectionName);

    // Find the customer document first
    const customer = await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    // Backup to recycle bin collection
    const recycleCollection = await this.getCollection(this.collectionName + '_recycle_bin');
    await recycleCollection.insertOne({
      ...customer,
      deleted_date: new Date(),
      deleted_by: BaseModel.loggedUser || 'system',
    });

    // Hard delete from main collection
    const result = await collection.deleteOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    return customer;
  }

  /**
   * Bulk hard delete customers with backup (matching PHP implementation)
   */
  async bulkSoftDelete(ids) {
    const collection = await this.getCollection(this.collectionName);
    const objectIds = ids.map((id) => new ObjectId(id));

    // Find all customers to be deleted
    const customers = await collection
      .find({
        _id: { $in: objectIds },
        license: BaseModel.license,
      })
      .toArray();

    if (customers.length === 0) {
      return { deletedCount: 0 };
    }

    // Backup to recycle bin collection
    const recycleCollection = await this.getCollection(this.collectionName + '_recycle_bin');
    const backupDocs = customers.map((customer) => ({
      ...customer,
      deleted_date: new Date(),
      deleted_by: BaseModel.loggedUser || 'system',
    }));
    await recycleCollection.insertMany(backupDocs);

    // Hard delete from main collection
    const result = await collection.deleteMany({
      _id: { $in: objectIds },
      license: BaseModel.license,
    });

    return { deletedCount: result.deletedCount, modifiedCount: result.deletedCount };
  }

  /**
   * Get customer summary/statistics
   */
  async getSummary(customerId) {
    const collection = await this.getCollection(this.collectionName);

    const customer = await collection.findOne({
      _id: new ObjectId(customerId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });

    if (!customer) {
      return null;
    }

    // Get sales collection for transaction summary
    const salesCollection = await this.getCollection('sales');

    const salesSummary = await salesCollection
      .aggregate([
        {
          $match: {
            customer_id: new ObjectId(customerId),
            license: BaseModel.license,
            is_deleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: 1 },
            totalAmount: { $sum: '$grand_total' },
            totalPaid: { $sum: '$paid_amount' },
            totalDue: { $sum: '$due_amount' },
          },
        },
      ])
      .toArray();

    const summary = salesSummary[0] || {
      totalSales: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalDue: 0,
    };

    return {
      customer,
      ...summary,
    };
  }

  async updateTotalsAfterSale({ customerId, saleTotal, lastPurchaseDate } = {}) {
    if (!customerId) {
      return null;
    }

    const collection = await this.getCollection(this.collectionName);
    const id = new ObjectId(customerId);

    const update = {
      $inc: { total_purchases: saleTotal },
    };

    if (lastPurchaseDate) {
      update.$set = { last_purchase: lastPurchaseDate };
    }

    return collection.updateOne(
      {
        _id: id,
        ...(BaseModel.license ? { license: BaseModel.license } : {}),
        ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
      },
      update
    );
  }

  /**
   * Get customers by loyalty tier
   */
  async findByLoyaltyTier(tier, options = {}) {
    const { page = 1, limit = 10 } = options;

    const query = {
      'loyalty.tier': tier,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);

    const [customers, total] = await Promise.all([
      collection
        .find(query)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return { data: customers, total };
  }

  /**
   * Update loyalty points
   */
  async updateLoyaltyPoints(customerId, points, operation = 'add') {
    const collection = await this.getCollection(this.collectionName);

    const updateOperation =
      operation === 'add'
        ? { $inc: { 'loyalty.points': points } }
        : { $inc: { 'loyalty.points': -points } };

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(customerId),
        license: BaseModel.license,
        is_deleted: { $ne: true },
      },
      updateOperation,
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Get customer outstanding report
   */
  async getOutstandingReport(filters = {}, options = {}) {
    const { page = 1, limit = 10, branchIds = [] } = options;

    const salesCollection = await this.getCollection('sales');

    const matchStage = {
      license: BaseModel.license,
      is_deleted: { $ne: true },
      due_amount: { $gt: 0 },
    };

    if (branchIds.length > 0) {
      matchStage.branch_id = { $in: branchIds.map((id) => new ObjectId(id)) };
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: '$customer_id',
          totalDue: { $sum: '$due_amount' },
          totalSales: { $sum: 1 },
          customerName: { $first: '$customer_name' },
          customerPhone: { $first: '$customer_phone' },
        },
      },
      { $sort: { totalDue: -1 } },
      { $skip: Math.max(0, (page - 1) * limit) },
      { $limit: limit },
    ];

    const results = await salesCollection.aggregate(pipeline).toArray();

    return results;
  }

  /**
   * Get data changes for sync
   */
  async getDataChanges(fromDate) {
    const collection = await this.getCollection(this.collectionName);

    const query = {
      license: BaseModel.license,
      updated_date: { $gte: new Date(fromDate) },
    };

    return await collection.find(query).toArray();
  }

  /**
   * Bulk import customers
   */
  async bulkCreate(customersData) {
    const collection = await this.getCollection(this.collectionName);

    const documents = customersData.map((customer) => {
      const normalized = { ...customer };
      if (typeof normalized.email !== 'string' || !normalized.email.trim()) {
        delete normalized.email;
      }
      return {
        ...normalized,
        license: BaseModel.license,
        created_date: new Date(),
        updated_date: new Date(),
        is_deleted: false,
      };
    });

    const result = await collection.insertMany(documents);

    // Return the inserted documents for response formatting
    const insertedIds = Object.values(result.insertedIds);
    const insertedDocs = await collection
      .find({
        _id: { $in: insertedIds },
      })
      .toArray();

    return insertedDocs;
  }

  /**
   * Export customers data
   */
  async exportData(filters = {}) {
    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);
    return await collection
      .find(query, {
        projection: {
          name: 1,
          email: 1,
          phone: 1,
          address: 1,
        },
      })
      .toArray();
  }

  /**
   * Get customer payment details (wallet balance and sales)
   */
  async getPaymentDetails(customerId) {
    const collection = await this.getCollection(this.collectionName);

    // Get customer details to verify existence
    const customer = await collection.findOne({
      _id: new ObjectId(customerId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });

    if (!customer) {
      return { wallet: 0, sales: [] };
    }

    // Get wallet balance from customer record
    const walletBalance = customer.balance || customer.wallet_balance || 0;

    // Get partially paid sales for this customer
    const salesCollection = await this.getCollection('sales');

    const salesQuery = {
      customer_id: new ObjectId(customerId),
      payment_status: 'Partialy Paid',
      license: BaseModel.license,
    };

    const sales = await salesCollection.find(salesQuery).sort({ _id: 1 }).limit(50).toArray();

    // Format sales data
    const salesData = sales.map((sale) => {
      const date = sale.updated_date || sale.sale_date || new Date();
      const dateObj = date instanceof Date ? date : new Date(date);

      // Format as MM/DD/YYYY HH:mm am/pm
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const year = dateObj.getFullYear();
      let hours = dateObj.getHours();
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;

      const formattedDate = `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

      return {
        _id: sale._id.toString(),
        sales_id: sale.sales_id || '',
        date: formattedDate,
        payment_pending: sale.payment_pending || 0,
        partial_balance: sale.partial_balance || 0,
      };
    });

    return {
      wallet: walletBalance,
      sales: salesData,
    };
  }

  /**
   * Get customer transactions
   */
  async getTransactions(customerId, options = {}) {
    const { page = 1, limit = 10 } = options;

    const salesCollection = await this.getCollection('sales');

    const query = {
      customer_id: new ObjectId(customerId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const [transactions, total] = await Promise.all([
      salesCollection
        .find(query)
        .sort({ created_date: -1 })
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      salesCollection.countDocuments(query),
    ]);

    return { data: transactions, total };
  }

  /**
   * Get customer graphical reports (sales by day of week)
   * PHP: customer_model.php -> getCustomerGraphicalReports()
   */
  async getCustomerGraphicalReports(params) {
    try {
      const { branchIds, startingDate, endingDate, customerId } = params;

      const salesCollection = await this.getCollection('sales');

      // Parse dates using BaseModel helper methods
      const fromDate = BaseModel.startingDate(startingDate, BaseModel.currentTimeZone);
      const toDate = BaseModel.endingDate(endingDate, BaseModel.currentTimeZone);

      console.log('CustomerGraphicalReports Debug:', {
        branchIds,
        startingDate,
        endingDate,
        fromDate,
        toDate,
        license: BaseModel.license,
        timezone: BaseModel.currentTimeZone,
      });

      // Convert branch IDs to ObjectIds
      const branchObjectIds = branchIds.map((id) => new ObjectId(id));

      // Build condition - only add license if it's set
      const condition = {
        $and: [
          {
            branch_id: { $in: branchObjectIds },
            sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
          },
          {
            updated_date: { $gte: fromDate, $lte: toDate },
          },
        ],
      };

      // Only filter by license if it's available
      if (BaseModel.license) {
        condition.$and[1].license = BaseModel.license;
      }

      // Add customer filter if provided
      if (customerId && customerId !== '') {
        condition.customer_id = new ObjectId(customerId);
      }

      // Aggregate sales by day of week
      const timezone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const salesList = await salesCollection
        .aggregate([
          { $match: condition },
          {
            $project: {
              items_total: 1,
              h: {
                $dayOfWeek: {
                  date: '$updated_date',
                  timezone: timezone,
                },
              },
            },
          },
          {
            $group: {
              _id: '$h',
              totalValue: { $sum: '$items_total' },
            },
          },
        ])
        .toArray();

      // Initialize array for all 7 days
      const arrSales = [];
      const days = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

      // If no sales data, return empty array
      if (!salesList || salesList.length === 0) {
        return {
          status: true,
          data: arrSales,
          message: '',
        };
      }

      // Build sales data indexed by day of week
      const salesByDay = {};
      salesList.forEach((doc) => {
        salesByDay[doc._id] = doc.totalValue;
      });

      // Fill in all 7 days with sales data or 0
      for (let m = 0; m < 7; m++) {
        arrSales[m] = {
          week: days[m],
          sales: salesByDay[m] || 0,
        };
      }

      return {
        status: true,
        data: arrSales,
        message: 'Graphical report successfully',
      };
    } catch (error) {
      console.error('Error in CustomerRepository.getCustomerGraphicalReports:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer outstanding report
   * PHP: customer_model.php -> customerOutstandingReportPage()
   */
  async getCustomerOutstandingReport(params) {
    try {
      console.log('[CUSTOMER OUTSTANDING] ========== START ==========');
      console.log('[CUSTOMER OUTSTANDING] Params:', params);

      const { branchIds, customerId, page = 1, limit = 5 } = params;

      const transactionCollection = await this.getCollection('transaction');

      // Convert branch IDs to ObjectIds, but keep string values too
      const branchIdValues = [];
      branchIds
        .filter((id) => id)
        .forEach((id) => {
          branchIdValues.push(id);
          if (ObjectId.isValid(id)) {
            branchIdValues.push(new ObjectId(id));
          }
        });
      console.log('[CUSTOMER OUTSTANDING] Branch IDs:', branchIdValues);

      const licenseValues = [];
      if (BaseModel.license) {
        const licenseString = BaseModel.license.toString();
        licenseValues.push(BaseModel.license, licenseString);
        if (ObjectId.isValid(licenseString)) {
          licenseValues.push(new ObjectId(licenseString));
        }
      }

      // Build filters to match PHP customerOutstandingReportPage
      const filters = {
        $and: [{ branch_id: { $in: branchIdValues } }, { license: { $in: licenseValues } }],
      };

      // Add customer filter if provided
      if (customerId && customerId !== '') {
        filters.$and.push({ customer_id: new ObjectId(customerId) });
      }

      console.log('[CUSTOMER OUTSTANDING] Filters:', JSON.stringify(filters, null, 2));

      // Check total and matching transactions
      const totalTransactions = await transactionCollection.countDocuments({});
      const matchingTransactions = await transactionCollection.countDocuments(filters);
      console.log('[CUSTOMER OUTSTANDING] Total transactions:', totalTransactions);
      console.log('[CUSTOMER OUTSTANDING] Matching transactions:', matchingTransactions);

      // Calculate skip for pagination
      const skip = Math.max(0, (page - 1) * limit);

      // Aggregate transactions to get outstanding amounts
      const transactionList = await transactionCollection
        .aggregate([
          { $match: filters },
          {
            $group: {
              _id: { customer_id: '$customer_id', customer_name: '$customer_name' },
              totalInAmount: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] } },
              totalOutAmount: { $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] } },
              totalPendingAmount: { $sum: '$pending' },
            },
          },
          {
            $addFields: {
              totalAmountDue: { $subtract: ['$totalInAmount', '$totalOutAmount'] },
            },
          },
          {
            $addFields: {
              due: {
                $cond: [
                  {
                    $and: [{ $lt: ['$totalAmountDue', 0] }, { $gte: ['$totalPendingAmount', 0] }],
                  },
                  {
                    $round: [{ $add: ['$totalPendingAmount', { $abs: '$totalAmountDue' }] }, 2],
                  },
                  {
                    $round: ['$totalPendingAmount', 2],
                  },
                ],
              },
            },
          },
          {
            $match: {
              $or: [{ due: { $gt: 0 } }],
            },
          },
          { $sort: { updated_date: -1 } },
          { $skip: skip },
          { $limit: limit },
        ])
        .toArray();

      // Count total documents with same filters
      const transactionCountList = await transactionCollection
        .aggregate([
          { $match: filters },
          {
            $group: {
              _id: { customer_id: '$customer_id', customer_name: '$customer_name' },
              totalInAmount: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] } },
              totalOutAmount: { $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] } },
              totalPendingAmount: { $sum: '$pending' },
            },
          },
          {
            $addFields: {
              totalAmountDue: { $subtract: ['$totalInAmount', '$totalOutAmount'] },
            },
          },
          {
            $addFields: {
              due: {
                $cond: [
                  {
                    $and: [{ $lt: ['$totalAmountDue', 0] }, { $gte: ['$totalPendingAmount', 0] }],
                  },
                  {
                    $round: [{ $add: ['$totalPendingAmount', { $abs: '$totalAmountDue' }] }, 2],
                  },
                  {
                    $round: ['$totalPendingAmount', 2],
                  },
                ],
              },
            },
          },
          {
            $match: {
              $or: [{ due: { $gt: 0 } }],
            },
          },
        ])
        .toArray();

      const total = transactionCountList.length;

      console.log('[CUSTOMER OUTSTANDING] Results after aggregation:', transactionList.length);
      console.log('[CUSTOMER OUTSTANDING] Total count:', total);
      console.log(
        '[CUSTOMER OUTSTANDING] Sample result:',
        transactionList[0]
          ? {
              customer: transactionList[0]._id?.customer_name,
              totalInAmount: transactionList[0].totalInAmount,
              totalOutAmount: transactionList[0].totalOutAmount,
              totalPendingAmount: transactionList[0].totalPendingAmount,
              totalAmountDue: transactionList[0].totalAmountDue,
              due: transactionList[0].due,
            }
          : 'No results'
      );
      console.log('[CUSTOMER OUTSTANDING] ========== END ==========');

      // Format transaction data
      const transactionValues = transactionList.map((doc) => ({
        id: doc._id.customer_id?.toString() || '',
        name: doc._id.customer_name || '',
        credit: Math.round(doc.totalInAmount * 100) / 100,
        debit: Math.round(doc.totalOutAmount * 100) / 100,
        wallet: Math.round(doc.totalAmountDue * 100) / 100,
        pending: Math.round(doc.totalPendingAmount * 100) / 100,
        due: Math.round(doc.due * 100) / 100,
      }));

      return {
        status: true,
        data: {
          total,
          current_page: page,
          total_pages: Math.ceil(total / limit),
          per_page: limit,
          list: transactionValues,
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in CustomerRepository.getCustomerOutstandingReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = CustomerRepository;
