const BaseModel = require('./base.model');
const { ObjectId } = require('mongodb');
const path = require('path');

const quotesFile = path.join(__dirname, '..', '..', 'json', 'quotes.json');

const quotes = require(quotesFile).map((quote, index) => ({
  id: quote.id || String(index + 1).padStart(2, '0'),
  quote: quote.quote || quote.text || '',
  tamilquote: quote.tamilquote || quote.text || '',
}));

class DashboardModel extends BaseModel {
  constructor() {
    super('branches');
    this.branchId = null;
    this.licenseId = null;
    this.timeZone = 'Asia/Kolkata';
  }

  getContextMatch(baseMatch = {}) {
    let branchId = this.branchId;

    if (!branchId && BaseModel.currentBranch) {
      branchId = BaseModel.currentBranch;
    }

    const match = {
      ...baseMatch,
    };

    const buildIdMatch = (value) => {
      if (!value) return null;
      const values = [];
      if (value instanceof ObjectId) {
        values.push(value, value.toString());
      } else {
        values.push(value);
        if (ObjectId.isValid(String(value))) {
          values.push(new ObjectId(String(value)));
        }
      }
      return { $in: values };
    };

    if (branchId) {
      match.branch_id = buildIdMatch(branchId);
    } else {
      console.warn('DashboardModel: branch context missing, defaulting to license-level data.');
    }

    if (this.licenseId) {
      match.license = buildIdMatch(this.licenseId);
    }
    return match;
  }

  /**
   * Get dashboard payment mode data
   * @param {Object} data - Filter data with start and end dates
   * @returns {Promise<Object>} - Payment mode statistics
   */
  async getDashboardPaymentModeDataModel(data) {
    try {
      const salesCollection = await this.getCollection('sales');

      const fromTimestamp = BaseModel.startingDate(data.starting_date, this.timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, this.timeZone);

      const condition = this.getContextMatch({
        date: {
          $gte: new Date(fromTimestamp || 0),
          $lte: new Date(toTimestamp || Date.now()),
        },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      });

      const paymentModes = await salesCollection
        .aggregate([
          { $match: condition },
          {
            $project: {
              items_total: 1,
              multi_payment: 1,
              payment_mode: 1,
              // Convert multi_payment object to array of key-value pairs.
              // Guard against non-object types (arrays, strings, null), which
              // would cause $objectToArray to throw.
              payment_entries: {
                $cond: [
                  { $eq: [{ $type: '$multi_payment' }, 'object'] },
                  { $objectToArray: '$multi_payment' },
                  [],
                ],
              },
            },
          },
          {
            $addFields: {
              has_split: { $gt: [{ $size: '$payment_entries' }, 0] },
            },
          },
          {
            $facet: {
              // For sales with multi_payment (split payments)
              split_payments: [
                { $match: { has_split: true } },
                { $unwind: '$payment_entries' },
                {
                  $group: {
                    _id: '$payment_entries.k',
                    count: { $sum: 1 },
                    total_amount: { $sum: { $toDouble: '$payment_entries.v' } },
                  },
                },
              ],
              // For sales without split payments (use payment_mode string)
              single_payments: [
                { $match: { has_split: false } },
                {
                  $group: {
                    _id: '$payment_mode',
                    count: { $sum: 1 },
                    total_amount: { $sum: '$items_total' },
                  },
                },
              ],
            },
          },
          {
            $project: {
              combined: { $concatArrays: ['$split_payments', '$single_payments'] },
            },
          },
          { $unwind: '$combined' },
          { $replaceRoot: { newRoot: '$combined' } },
          {
            $group: {
              _id: '$_id',
              count: { $sum: '$count' },
              total_amount: { $sum: '$total_amount' },
            },
          },
        ])
        .toArray();
      const paymodeData = [];
      let totalAmount = 0;

      // Calculate total amount
      paymentModes.forEach((mode) => {
        totalAmount += mode.total_amount || 0;
      });

      // Prepare data for each payment mode found in database
      paymentModes.forEach((mode) => {
        const paymentMode = mode._id || 'Others';
        const amount = mode.total_amount || 0;
        const count = mode.count || 0;
        const percentage = totalAmount > 0 ? (amount * 100) / totalAmount : 0;

        paymodeData.push({
          payment_mode: paymentMode,
          sales_count: count,
          amount: parseFloat(amount.toFixed(2)), // Frontend expects 'amount' field
          total_amount: parseFloat(amount.toFixed(2)),
          percentage: parseFloat(percentage.toFixed(2)),
        });
      });

      // Prepare series data for charts
      const percentageSeries = paymodeData.map((item) => item.percentage);
      const payModeSeries = paymodeData.map((item) => item.payment_mode);

      return {
        status: true,
        data: {
          paymode_data: paymodeData,
          percentage_series: percentageSeries,
          pay_mode_series: payModeSeries,
          total_amount: parseFloat(totalAmount.toFixed(2)), // Frontend expects total_amount at root level
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getDashboardPaymentModeDataModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get pending activities (unpaid sales)
   * @param {Object} data - Filter data with start and end dates
   * @returns {Promise<Object>} - List of pending activities
   */
  async getPendingActivitiesModel(data) {
    try {
      console.log('[PENDING ACTIVITIES] ========== START ==========');
      console.log('[PENDING ACTIVITIES] Input data:', data);
      console.log('[PENDING ACTIVITIES] Context:', {
        branchId: this.branchId,
        licenseId: this.licenseId,
      });

      const transactionCollection = await this.getCollection('transaction');

      // Check total transaction count
      const totalCount = await transactionCollection.countDocuments({});
      console.log('[PENDING ACTIVITIES] Total transactions in collection:', totalCount);

      // Sample a transaction to see the actual data structure
      const sampleTransaction = await transactionCollection.findOne({});
      if (sampleTransaction) {
        console.log('[PENDING ACTIVITIES] Sample transaction:', {
          _id: sampleTransaction._id,
          branch_id: sampleTransaction.branch_id,
          branch_id_type: typeof sampleTransaction.branch_id,
          license: sampleTransaction.license,
          license_type: typeof sampleTransaction.license,
          customer_id: sampleTransaction.customer_id,
          customer_name: sampleTransaction.customer_name,
          pending: sampleTransaction.pending,
        });
      }

      const condition = this.getContextMatch({});
      // Match PHP: use branch_id + license without null/exists fallbacks
      const finalCondition = condition;

      console.log(
        '[PENDING ACTIVITIES] Final query condition:',
        JSON.stringify(finalCondition, null, 2)
      );

      // Check matching count with final condition
      const matchingCount = await transactionCollection.countDocuments(finalCondition);
      console.log('[PENDING ACTIVITIES] Matching transactions:', matchingCount);

      const pipeline = [
        { $match: finalCondition },
        {
          $group: {
            _id: {
              customer_id: '$customer_id',
              customer_name: '$customer_name',
            },
            totalInAmount: {
              $sum: {
                $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0],
              },
            },
            totalOutAmount: {
              $sum: {
                $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0],
              },
            },
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
                { $round: ['$totalPendingAmount', 2] },
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
        { $limit: 4 },
      ];

      // Run aggregation without the due > 0 filter to see all results
      const pipelineWithoutDueFilter = pipeline.slice(0, -3); // Remove match, sort, limit
      const beforeFilter = await transactionCollection
        .aggregate(pipelineWithoutDueFilter)
        .toArray();

      console.log(
        '[PENDING ACTIVITIES] Results BEFORE due > 0 filter:',
        JSON.stringify(
          beforeFilter.map((doc) => ({
            customer: doc._id?.customer_name,
            totalInAmount: doc.totalInAmount,
            totalOutAmount: doc.totalOutAmount,
            totalPendingAmount: doc.totalPendingAmount,
            totalAmountDue: doc.totalAmountDue,
            due: doc.due,
          })),
          null,
          2
        )
      );

      const aggregateAmount = await transactionCollection.aggregate(pipeline).toArray();

      console.log(
        '[PENDING ACTIVITIES] Aggregation result count AFTER filter:',
        aggregateAmount.length
      );
      console.log('[PENDING ACTIVITIES] Raw results:', JSON.stringify(aggregateAmount, null, 2));

      const transactionData = aggregateAmount
        .map((doc) => BaseModel.simplifyFields(doc))
        .map((doc) => ({
          id: doc._id?.customer_id || '',
          name: doc._id?.customer_name || '',
          wallet: Number(
            (typeof doc.totalAmountDue === 'number' ? doc.totalAmountDue : 0).toFixed(2)
          ),
          pending: Number(
            (typeof doc.totalPendingAmount === 'number' ? doc.totalPendingAmount : 0).toFixed(2)
          ),
          due: Number((typeof doc.due === 'number' ? doc.due : 0).toFixed(2)),
          // PHP sets this from session and then flips it to true; here we always
          // default to false so the modal can be shown by the frontend logic.
          outstandingCustomersModal: false,
        }));

      console.log('[PENDING ACTIVITIES] Final transaction data:', transactionData);
      console.log('[PENDING ACTIVITIES] ========== END ==========');

      return {
        status: true,
        data: transactionData,
        message: 'Success',
      };
    } catch (error) {
      console.error('Error in getPendingActivitiesModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get top performers (users with highest sales)
   * @param {Object} data - Filter data with start and end dates
   * @returns {Promise<Object>} - Top performer details
   */
  async getDashboardTopPerformersModel(data) {
    try {
      const salesCollection = await this.getCollection('sales');
      const usersCollection = await this.getCollection('users');

      const fromTimestamp = BaseModel.startingDate(data.starting_date, this.timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, this.timeZone);

      const dateRange = {
        $gte: new Date(fromTimestamp || 0),
        $lte: new Date(toTimestamp || Date.now()),
      };

      // Primary path: legacy PHP-style sales documents
      const legacyCondition = this.getContextMatch({
        date: dateRange,
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      });

      let topPerformer = await salesCollection
        .aggregate([
          { $match: legacyCondition },
          {
            $group: {
              _id: { user_id: '$user_id' },
              sales_amount: { $sum: '$items_total' },
              sales_count: { $sum: 1 },
            },
          },
          { $sort: { sales_amount: -1 } },
          { $limit: 1 },
        ])
        .toArray();

      // Fallback path: Node-style sales documents (branch/total/created_by)
      if (topPerformer.length === 0) {
        const normalizeId = (value) => {
          if (!value) return value;
          if (value instanceof ObjectId) return value;
          try {
            return new ObjectId(String(value));
          } catch (err) {
            return value;
          }
        };

        const altMatch = {
          date: dateRange,
        };

        const branchId = this.branchId || BaseModel.currentBranch;
        if (branchId) {
          altMatch.branch = normalizeId(branchId);
        }

        const altTopPerformer = await salesCollection
          .aggregate([
            { $match: altMatch },
            {
              $group: {
                _id: { user_id: '$created_by' },
                sales_amount: { $sum: '$total' },
                sales_count: { $sum: 1 },
              },
            },
            { $sort: { sales_amount: -1 } },
            { $limit: 1 },
          ])
          .toArray();

        if (altTopPerformer.length) {
          topPerformer = altTopPerformer;
        }
      }

      if (topPerformer.length === 0) {
        return {
          status: true,
          data: {},
          message: 'No sales data found for the period',
        };
      }

      const rawUserId = topPerformer[0]._id.user_id;
      const normalizeId = (value) => {
        if (!value) return value;
        if (value instanceof ObjectId) return value;
        try {
          return new ObjectId(String(value));
        } catch (err) {
          return value;
        }
      };

      const userFilter = {};
      if (rawUserId) {
        userFilter._id = normalizeId(rawUserId);
      }
      if (this.licenseId) {
        userFilter.license = normalizeId(this.licenseId);
      }

      const userData = await usersCollection.findOne(userFilter);

      const result = {
        user_name: userData?.username || 'Unknown',
        user_type: userData?.usertype || 'Staff',
        email: userData?.email || '',
        sales_count: topPerformer[0].sales_count,
        sales_amount: topPerformer[0].sales_amount,
      };

      return {
        status: true,
        data: result,
        message: 'Top performer data retrieved successfully',
      };
    } catch (error) {
      console.error('Error in getDashboardTopPerformersModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async sumCollectionField(collectionName, match, field) {
    try {
      const collection = await this.getCollection(collectionName);
      const pipeline = [
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: `$${field}` },
          },
        },
      ];
      const [result] = await collection.aggregate(pipeline).toArray();
      return result?.total || 0;
    } catch (error) {
      console.error(`Error in sumCollectionField for ${collectionName}.${field}:`, error);
      return 0;
    }
  }

  async getDashboardBestSellingProductsModel(data) {
    try {
      const salesCollection = await this.getCollection('sales');
      const fromTimestamp = BaseModel.startingDate(data.starting_date, this.timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, this.timeZone);
      const match = this.getContextMatch({
        date: {
          $gte: new Date(fromTimestamp || 0),
          $lte: new Date(toTimestamp || Date.now()),
        },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      });

      const pipeline = [
        { $match: match },
        { $unwind: '$items' },
        {
          $group: {
            // Match legacy PHP aggregation: group by items.item_name and
            // sum items.item_quantity and items.total_amount
            _id: '$items.item_name',
            total_qty: { $sum: '$items.item_quantity' },
            total_amount: { $sum: '$items.total_amount' },
          },
        },
        { $sort: { total_qty: -1 } },
        { $limit: 5 },
      ];

      const result = await salesCollection.aggregate(pipeline).toArray();
      const bestSellingProducts = result.map((item) => ({
        item_name: item._id,
        total_qty: item.total_qty || 0,
        total_amount: parseFloat((item.total_amount || 0).toFixed(2)),
      }));

      return {
        status: true,
        data: { best_selling_products: bestSellingProducts },
        message: 'dashboard report successfully',
      };
    } catch (error) {
      console.error('Error in getDashboardBestSellingProductsModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getDashboardSalesPurchaseModel(data) {
    try {
      const salesCollection = await this.getCollection('sales');
      const purchaseCollection = await this.getCollection('receivings');
      const fromTimestamp = BaseModel.startingDate(data.starting_date, this.timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, this.timeZone);

      const salesMatch = this.getContextMatch({
        date: {
          $gte: new Date(fromTimestamp || 0),
          $lte: new Date(toTimestamp || Date.now()),
        },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      });
      const purchaseMatch = this.getContextMatch({
        date: {
          $gte: new Date(fromTimestamp || 0),
          $lte: new Date(toTimestamp || Date.now()),
        },
        receiving_status: { $in: ['Received', 'PartialReturn'] },
      });

      const [salesTotal, purchaseTotal] = await Promise.all([
        this.sumCollectionField('sales', salesMatch, 'items_total'),
        this.sumCollectionField('receivings', purchaseMatch, 'items_total'),
      ]);

      const dataSet = [
        { month: data.filter || 'total', sales: salesTotal, purchase: purchaseTotal },
      ];

      return {
        status: true,
        data: dataSet,
        message: 'dashboard report successfully',
      };
    } catch (error) {
      console.error('Error in getDashboardSalesPurchaseModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /*
   * A period's profit, the way a shop owner asks it: what came in, what the
   * goods actually cost, what else was spent, and what is left.
   *
   * Cost of goods sold is total_companyprice - the cost captured on each sale
   * as it happened - so this is real historical margin, not today's cost
   * applied to last month's sales. Net profit is the accounting figure,
   * revenue - COGS - expenses. Purchases (stock bought this period) is reported
   * alongside as cash out, and a cash-flow line (sales - purchases - expenses)
   * too, because the two answer different questions and an owner wants both.
   */
  async getProfitSummaryModel(data) {
    try {
      const from = new Date(BaseModel.startingDate(data.starting_date, this.timeZone) || 0);
      const to = new Date(BaseModel.endingDate(data.ending_date, this.timeZone) || Date.now());
      const inRange = { date: { $gte: from, $lte: to } };

      const salesMatch = this.getContextMatch({
        ...inRange,
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      });
      const purchaseMatch = this.getContextMatch({
        ...inRange,
        receiving_status: { $in: ['Received', 'PartialReturn'] },
      });
      const expenseMatch = this.getContextMatch({ ...inRange });

      const salesCol = await this.getCollection('sales');
      const [revenue, cogs, returns, purchases, expenses] = await Promise.all([
        this.sumCollectionField('sales', salesMatch, 'items_total'),
        this.sumCollectionField('sales', salesMatch, 'total_companyprice'),
        this.sumCollectionField('sales', salesMatch, 'items_return_total'),
        this.sumCollectionField('receivings', purchaseMatch, 'items_total'),
        this.sumCollectionField('expenses', expenseMatch, 'amount'),
      ]);
      const salesCount = await salesCol.countDocuments(salesMatch);

      const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
      const grossProfit = revenue - cogs;
      const netProfit = grossProfit - expenses;

      return {
        status: true,
        data: {
          filter: data.filter || 'month',
          revenue: round(revenue),
          cogs: round(cogs),
          gross_profit: round(grossProfit),
          returns: round(returns),
          expenses: round(expenses),
          net_profit: round(netProfit),
          purchases: round(purchases),
          cash_flow: round(revenue - purchases - expenses),
          margin_percent: revenue ? round((netProfit / revenue) * 100) : 0,
          sales_count: salesCount || 0,
        },
        message: 'profit summary',
      };
    } catch (error) {
      console.error('Error in getProfitSummaryModel:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * A light low-stock glance for the dashboard: how many items are at or below
   * a threshold, and the few lowest. The full, branch-threshold-aware list
   * lives on its own page; this is just the number a shop should see at a
   * glance without another round trip.
   */
  async getLowStockSummary(data) {
    try {
      const items = await this.getCollection('items');
      const threshold =
        Number(data && data.low_stock_threshold) > 0 ? Number(data.low_stock_threshold) : 10;
      const match = this.getContextMatch({
        available_quantity: { $lte: threshold },
        item_status: { $ne: 'instant' },
      });
      const [count, list] = await Promise.all([
        items.countDocuments(match),
        items
          .find(match, { projection: { name: 1, available_quantity: 1, unit: 1 } })
          .sort({ available_quantity: 1 })
          .limit(5)
          .toArray(),
      ]);
      return {
        count,
        items: list.map((i) => ({ name: i.name, qty: i.available_quantity, unit: i.unit || '' })),
      };
    } catch (error) {
      console.error('Error in getLowStockSummary:', error);
      return { count: 0, items: [] };
    }
  }

  /*
   * One call for the whole dashboard.
   *
   * The dashboard is every user's first screen, so it used to fire eight
   * separate requests the instant it opened - a real cost on a phone. This runs
   * the same work in parallel on the server and returns it in a single, small
   * payload: the period's sales trend and count, the payment mix, top items,
   * and a low-stock glance. Money-health (profit, and the rupee amounts behind
   * the payment mix) is included ONLY when the caller is allowed it - the
   * controller decides via canSeeFinancials and passes it in here.
   */
  async getOverviewModel(data, options = {}) {
    const financials = !!(options && options.financials);
    const [totalsR, paymentR, topR, lowStock, profitR] = await Promise.all([
      this.getDashboardTotalAmountsModel(data),
      this.getDashboardPaymentModeDataModel(data),
      this.getDashboardBestSellingProductsModel(data),
      this.getLowStockSummary(data),
      financials ? this.getProfitSummaryModel(data) : Promise.resolve(null),
    ]);

    const totals = (totalsR && totalsR.data) || {};
    const payment = (paymentR && paymentR.data) || {};
    const top = (topR && topR.data && topR.data.best_selling_products) || [];
    const list = totals.list_data || {};
    const totalData = totals.total_data || {};
    const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

    // Payment mix: percentages for everyone; rupee amounts only for financials.
    const paymentMix = (payment.pay_mode_series || []).map((mode, i) => {
      const row = { mode, pct: round((payment.percentage_series || [])[i] || 0) };
      if (financials) {
        row.amount = round(((payment.paymode_data || [])[i] || {}).amount || 0);
      }
      return row;
    });

    const salesAmounts = (list.sales_y_axis || []).map((v) => round(v));

    return {
      status: true,
      data: {
        filter: (data && data.filter) || 'month',
        financials,
        totals: {
          sales_days: list.sales_x_axis || [],
          sales_amounts: salesAmounts,
          sales_count: totalData.Total_Sales_Amount || 0,
          sales_amount: round(salesAmounts.reduce((a, b) => a + b, 0)),
        },
        paymentMix,
        topItems: top,
        lowStock,
        profit: financials ? (profitR && profitR.data) || null : null,
      },
      message: 'overview',
    };
  }

  /**
   * Get expired products for dashboard
   * Mirrors PHP getDashboardExpiredProductsModel()
   * @param {{ start_date: Date, end_date: Date }} data
   * @returns {Promise<{status: boolean, data: any, message: string}>}
   */
  async getDashboardExpiredProducts(data) {
    try {
      const itemsCollection = await this.getCollection('items');

      // Use current date directly for expired products comparison
      const normalizeId = (value) => {
        if (!value) return value;
        if (value instanceof ObjectId) return value;
        try {
          return new ObjectId(String(value));
        } catch (err) {
          return value;
        }
      };

      const match = {
        items_expiry_date: {
          $exists: true,
          $lte: new Date().toISOString().slice(0, 10), // Compare with string format YYYY-MM-DD
        },
        available_quantity: { $gt: 0 },
      };

      const branchId = this.branchId || BaseModel.currentBranch;
      if (branchId) {
        const branchObjectId = normalizeId(branchId);
        match.$or = [{ 'branch_access.branch_id': branchObjectId }, { branch_id: branchObjectId }];
      }

      const cursor = await itemsCollection.find(match, {
        projection: {
          name: 1,
          available_quantity: 1,
          items_expiry_date: 1,
        },
      });

      const items = await cursor.toArray();

      const expiredItems = items.map((item) => {
        let expiryDate = '';
        if (item.items_expiry_date) {
          // items_expiry_date may be stored as Date or as a numeric timestamp
          const dateValue =
            item.items_expiry_date instanceof Date
              ? item.items_expiry_date
              : new Date(item.items_expiry_date);
          if (!isNaN(dateValue.getTime())) {
            expiryDate = dateValue.toISOString().slice(0, 10);
          }
        }

        return {
          item_name: item.name || '',
          quantity: item.available_quantity || 0,
          expiry_date: expiryDate,
        };
      });

      return {
        status: true,
        data: { expired_stock_items: expiredItems },
        message: 'Expired stock items retrieved successfully',
      };
    } catch (error) {
      console.error('Error in getDashboardExpiredProducts:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getDashboardTotalAmountsModel(data) {
    try {
      const salesCollection = await this.getCollection('sales');
      const purchaseCollection = await this.getCollection('receivings');

      const fromTimestamp = BaseModel.startingDate(data.starting_date, this.timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, this.timeZone);

      const dateRange = {
        $gte: new Date(fromTimestamp || 0),
        $lte: new Date(toTimestamp || Date.now()),
      };

      // Conditions matching PHP
      const condition = this.getContextMatch({
        date: dateRange,
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      });

      const purchasecondition = this.getContextMatch({
        date: dateRange,
        receiving_status: { $in: ['Received', 'PartialReturn'] },
      });

      const return_condition = this.getContextMatch({
        $and: [
          { $or: [{ sale_process: 'FullReturn' }, { sale_process: 'PartialReturn' }] },
          { date: dateRange },
        ],
      });

      // Fix: $and structure in PHP was slightly redundant but logic is:
      // (FullReturn OR PartialReturn) AND DateRange AND Branch/License
      // In JS simplifyFields logic we need to be careful.
      // PHP return_condition: ['$and' => [['$or' => [["sale_process" => 'FullReturn'], ["sale_process" => 'PartialReturn']]], ['date' => ['$gte' => $FromDate, '$lte' => $ToDate], 'branch_id' => self::$currentBranch], ['license' => self::$license]]];

      const returnpurchase_condition = this.getContextMatch({
        $and: [
          { $or: [{ receiving_status: 'FullReturn' }, { receiving_status: 'PartialReturn' }] },
          { date: dateRange },
        ],
      });

      // Grouping Logic
      let groupDate;
      const filter = data.filter || 'month';
      if (filter === 'year') {
        groupDate = { $month: { date: '$updated_date', timezone: this.timeZone } };
      } else {
        groupDate = {
          $dateToString: { format: '%Y-%m-%d', date: '$updated_date', timezone: this.timeZone },
        };
      }

      const salesList = await salesCollection
        .aggregate([
          { $match: condition },
          {
            $group: {
              _id: {
                datetime: groupDate,
                sales_id: '$sales_id',
                sale_amount: { $sum: '$items_total' },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const purchaseList = await purchaseCollection
        .aggregate([
          { $match: purchasecondition },
          {
            $group: {
              _id: {
                datetime: groupDate,
                receiving_id: '$receiving_id',
                purchase_amount: { $sum: '$items_total' },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const returnList = await salesCollection
        .aggregate([
          { $match: return_condition },
          {
            $group: {
              _id: {
                datetime: groupDate,
                sales_id: '$sales_id',
                return_amount: { $sum: '$items_return_total' },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const returnPurchaseList = await purchaseCollection
        .aggregate([
          { $match: returnpurchase_condition },
          {
            $group: {
              _id: {
                datetime: groupDate,
                receiving_id: 'receiving_id',
                return_amount: { $sum: '$items_return_total' },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const processGraphData = (list, amountField, xAxisFormatter) => {
        const x_axis = [];
        const y_axis = [];
        list.forEach((item) => {
          const datetime = item._id.datetime;
          const amount = item._id[amountField] || 0;

          let label;

          if (filter === 'year') {
            const currentYear = new Date().getFullYear();
            const d = new Date(currentYear, datetime - 1, 1);
            label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
          } else {
            const d = new Date(datetime);
            if (filter === 'day') {
              label = new Date()
                .toLocaleDateString('en-US', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  weekday: 'short',
                })
                .replace(/,/g, '');
            } else if (filter === 'week') {
              label = d.toLocaleDateString('en-US', { weekday: 'long' });
            } else {
              const month = d.toLocaleDateString('en-US', { month: 'short' });
              const day = d.getDate().toString().padStart(2, '0');
              const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
              label = `${month}-${day} ${weekday}`;
            }
          }

          x_axis.push(label);
          y_axis.push(parseFloat(amount.toFixed(2)));
        });
        return { x_axis, y_axis };
      };

      const salesGraph = processGraphData(salesList, 'sale_amount');
      const purchaseGraph = processGraphData(purchaseList, 'purchase_amount');
      const returnGraph = processGraphData(returnList, 'return_amount');
      const returnPurchaseListGraph = processGraphData(returnPurchaseList, 'return_amount');

      const arrGraphData = {
        sales_x_axis: salesGraph.x_axis,
        sales_y_axis: salesGraph.y_axis,

        purchase_x_axis: purchaseGraph.x_axis,
        purchase_y_axis: purchaseGraph.y_axis,

        return_x_axis: returnGraph.x_axis,
        return_y_axis: returnGraph.y_axis,

        purchasereturn_x_axis: returnPurchaseListGraph.x_axis,
        purchasereturn_y_axis: returnPurchaseListGraph.y_axis,
      };

      const total_sales_amount = await salesCollection.countDocuments(condition);
      const total_purchase_amount = await purchaseCollection.countDocuments(purchasecondition);
      const total_return_amount = await salesCollection.countDocuments(return_condition);
      const total_return_purchase =
        await purchaseCollection.countDocuments(returnpurchase_condition);

      const total_data = {
        Total_Sales_Amount: total_sales_amount,
        Total_Purchase_Amount: total_purchase_amount,
        Total_Return_Amount: total_return_amount,
        Total_returnpurchase_Amount: total_return_purchase,
      };

      return {
        status: true,
        data: {
          total_data: total_data,
          list_data: arrGraphData,
        },
        message: 'dashboard report successfully',
      };
    } catch (error) {
      console.error('Error in getDashboardTotalAmountsModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get current wish based on time of day
   * @returns {Object} - Wish message and quotes
   */
  getDashboardCurrentWish() {
    const now = new Date();
    const hours = now.getHours();

    let wish;
    if (hours >= 6 && hours < 12) {
      wish = 'Good Morning';
    } else if (hours >= 12 && hours < 17) {
      wish = 'Good Noon';
    } else if (hours >= 17 && hours < 20) {
      wish = 'Good Evening';
    } else {
      wish = 'Good Night';
    }

    return {
      status: true,
      data: {
        current_wish: wish,
        current_date: now.getDate(),
        quotes: quotes,
      },
      message: 'Wish and quotes retrieved successfully',
    };
  }
}

module.exports = DashboardModel;
