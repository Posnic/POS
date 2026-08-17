const { searchPattern } = require('../utils/safe-search');
const { Schema, Types } = require('mongoose');
/*
 * Registered through defineModel rather than mongoose.model, so the model
 * resolves against the shop in context.
 *
 * A model compiled with mongoose.model is bound to the default connection. In a
 * process serving one shop that is the shop; in a shard it is whatever database
 * the URI happened to name - `test`, in practice. Branch.findOne then searched
 * an empty database, found nothing, and every item list answered "Item Details
 * Not Found": a missing-data error for what was really a wrong-database one.
 */
const { defineModel } = require('../db/model-registry');
const BaseModel = require('./base.model');
const User = require('./user.model');
const CustomerModel = require('./customer.model');
const SupplierModel = require('./supplier-legacy.model');
const fs = require('fs');
const path = require('path');

const branchSchema = new Schema(
  {
    branch_id: { type: Schema.Types.ObjectId, ref: 'Branch' },
    branch_name: { type: String, required: true },
    store_email: { type: String },
    store_telephone: { type: String },
    store_alternativephone: { type: String },
    store_address: { type: String },
    address: { type: String },
    place: { type: String },
    logo: { type: String, default: 'store.png' },
    languge: { type: String },
    register: { type: Array, default: [] },
    currency_type: { type: Array, default: [] },
    country: { type: String },
    state: { type: String },
    cashdenom_fields: { type: Array, default: [] },
    default_supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    default_customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    website: { type: String },
    city: { type: String },
    pincode: { type: String },
    currency_text: { type: String },
    currency_value: { type: Array, default: [] },
    currency: { type: String },
    time_zone: { type: String, default: 'Asia/Calcutta' },
    branch_gstin_number: { type: String },
    from_mail: { type: String },
    to_mail: { type: String },
    indian_gst: { type: String },
    notification_range: { type: String },
    theme: { type: String },
    print_type: { type: String },
    printing_address: { type: String },
    time_format: { type: String, default: 'enable' },
    dateformat_text: { type: String },
    created_by_id: { type: Schema.Types.ObjectId, ref: 'User' },
    created_by: { type: String },
    updated_by_id: { type: Schema.Types.ObjectId, ref: 'User' },
    updated_by: { type: String },
    license: { type: Schema.Types.ObjectId, ref: 'License' },
    created_date: { type: Date, default: Date.now },
    updated_date: { type: Date, default: Date.now },

    // Additional fields from PHP model
    email_fields: { type: Array, default: [] },
    kiosk: { type: Array, default: [] },
    sortname: { type: String },
    default_tax: { type: Schema.Types.ObjectId },

    // Settings fields
    auto_sms: { type: Boolean, default: false },
    sales_sms: { type: Boolean, default: false },
    whatsapp_receipt: { type: Boolean, default: false },
    whatsapp_device_id: { type: String, default: '' },
    stock_management: { type: Boolean, default: false },
    stock_management_log: { type: Boolean, default: false },
    sale_inline_editor: { type: Boolean, default: false },
    printall: { type: Boolean, default: false },
    enable_notification_reminders: { type: Boolean, default: false },
    enable_email_reminders: { type: Boolean, default: false },
    enable_sms_reminders: { type: Boolean, default: false },
    enable_sms_auto_send: { type: Boolean, default: false },
    sms_auto_send_time: { type: String },
    sms_retry_period: { type: String },
    sms_max_retries: { type: String },
    roundOff: { type: Boolean, default: false },
    sales_mail: { type: Boolean, default: false },
    customer_print: { type: Boolean, default: false },
    print_logoimg: { type: Boolean, default: false },
    print_sale_notes: { type: Boolean, default: false },
    receipt_barcode: { type: Boolean, default: false },
    keyboard_view: { type: Boolean, default: false },
    balance_view: { type: Boolean, default: true },
    customer_checkbox: { type: Boolean, default: false },
    supplier_checkbox: { type: Boolean, default: false },
    tax_checkbox: { type: Boolean, default: false },
    table_options: { type: Boolean, default: false },

    printing_size: { type: String, default: 'receipt_medium' },
    // Paper width in millimetres: '58', '80' or 'a4'. Separate from
    // printing_size, which is the font size. Receipts were laid out with
    // @page size:auto, so the width came from whatever the Windows driver
    // said, and a 58mm printer set to 80mm cut every line off on the right.
    // Deliberately no default: unset falls back to what print_type implies,
    // so a shop that has never touched it keeps printing as it does today.
    print_width: { type: String },
    print_character: { type: String, default: 'default' },
    header_print: { type: String, default: 'default' },
    footer_print: { type: String },
    regular_body_print: { type: String },
    thermal_body_print: { type: String },
    print_controls: { type: Object },

    client_dateformat: { type: String, default: 'dd/mm/yyyy' },
    server_dateformat: { type: String, default: 'd/m/Y' },
    payment_gateway: { type: Array, default: [] },
    phonepe_payment_gateway: { type: Object, default: null },

    discount: { type: String },
    discount_amount: { type: Number },
    discount_percentage: { type: Number },
    sales_prefix: { type: String, default: 'S' },
    receiving_prefix: { type: String, default: 'RID' },

    smstype: { type: String },
    way2sms_api: { type: String },
    way2sms_userid: { type: String },
    way2sms_password: { type: String },
    textlocal_sender: { type: String },
    textlocal_api: { type: String },

    // SMTP fields
    smtp_username: { type: String },
    smtp_hostname: { type: String },
    smtp_password: { type: String },
    smtp_port: { type: String },

    // Additional fields
    tax_percentage: { type: String },
    print_size: { type: String },
    // print_character is declared above with default: 'default'. It was
    // declared a second time here without one, and the later declaration wins -
    // so the default was silently discarded and every branch created since was
    // saved with no print_character at all.
  },
  {
    timestamps: { createdAt: 'created_date', updatedAt: 'updated_date' },
    versionKey: false,
  }
);

const Branch = defineModel('Branch', branchSchema);

const simplifyDocument = (document) => {
  if (Array.isArray(document)) {
    return document.map((item) => simplifyDocument(item));
  }

  if (document && typeof document === 'object') {
    const simplified = Object.entries(document).reduce((acc, [key, value]) => {
      if (value instanceof Types.ObjectId) {
        acc[key] = value.toString();
      } else if (value instanceof Date) {
        acc[key] = value.toISOString();
      } else if (typeof value === 'object' && value !== null) {
        acc[key] = simplifyDocument(value);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});

    if (simplified._id && typeof simplified._id === 'string' && !simplified.id) {
      simplified.id = simplified._id;
    }

    return simplified;
  }

  return document;
};

class BranchModel {
  constructor() {
    this.model = Branch;
    this.baseModel = new BaseModel('branches');
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      api: { type: 'String', select: true },
      balance_view: { type: 'String', select: true },
      branch_gstin_number: { type: 'String', select: true },
      branch_name: { type: 'String', select: true },
      branch_no: { type: 'String', select: true },
      branch_id: { type: 'ObjectId', select: true },
      cashdenom_fields: { type: 'Array', select: true },
      city: { type: 'String', select: true },
      client_dateformat: { type: 'String', select: true },
      country: { type: 'String', select: true },
      country_id: { type: 'String', select: true },
      created_by: { type: 'String', select: false },
      created_by_id: { type: 'ObjectId', select: false },
      created_date: { type: 'Date', select: true },
      currency: { type: 'String', select: true },
      currency_text: { type: 'String', select: true },
      currency_type: { type: 'Array', select: true },
      currency_value: { type: 'String', select: true },
      customer_access_type: { type: 'String', select: true },
      customer_checkbox: { type: 'String', select: true },
      customer_print: { type: 'String', select: true },
      dateformat_text: { type: 'String', select: true },
      default_customer: { type: 'ObjectId', select: true },
      default_supplier: { type: 'ObjectId', select: true },
      default_tax: { type: 'String', select: true },
      discount: { type: 'String', select: true },
      discount_amount: { type: 'String', select: true },
      discount_area: { type: 'String', select: true },
      discount_percentage: { type: 'String', select: true },
      email_fields: { type: 'String', select: true },
      from_mail: { type: 'String', select: true },
      indian_gst: { type: 'String', select: true },
      item_access_type: { type: 'String', select: true },
      keyboard_view: { type: 'String', select: true },
      languge: { type: 'String', select: true },
      license: { type: 'ObjectId', select: false },
      logo: { type: 'String', select: true },
      mailtype: { type: 'String', select: true },
      notification_range: { type: 'String', select: true },
      offlineprocess: { type: 'String', select: true },
      payment_gateway: { type: 'Array', select: true, defaultValue: [] },
      pincode: { type: 'String', select: true },
      place: { type: 'String', select: true },
      print_logo: { type: 'String', select: true },
      print_logoimg: { type: 'String', select: true },
      print_sale_notes: { type: 'String', select: true },
      receipt_barcode: { type: 'String', select: true },
      print_type: { type: 'String', select: true },
      printing_size: { type: 'String', select: true },
      print_width: { type: 'String', select: true },
      print_character: { type: 'String', select: true },
      printall: { type: 'String', select: true },
      printing_address: { type: 'String', select: true },
      receiving_prefix: { type: 'String', select: true },
      register: { type: 'Array', select: true },
      roundOff: { type: 'String', select: true },
      sales_mail: { type: 'String', select: true },
      sales_prefix: { type: 'String', select: true },
      sales_sms: { type: 'String', select: true },
      auto_sms: { type: 'String', select: true },
      server_dateformat: { type: 'String', select: true },
      settings: { type: 'String', select: true },
      smstype: { type: 'String', select: true },
      smtp_hostname: { type: 'String', select: true },
      smtp_password: { type: 'String', select: true },
      smtp_port: { type: 'String', select: true },
      smtp_username: { type: 'String', select: true },
      ssl_tls_type: { type: 'String', select: true },
      state: { type: 'String', select: true },
      sale_inline_editor: { type: 'String', select: true },
      stock_management: { type: 'String', select: true },
      stock_management_log: { type: 'String', select: true },
      store_address: { type: 'String', select: true },
      store_email: { type: 'String', select: true },
      store_owner: { type: 'String', select: true },
      store_telephone: { type: 'String', select: true },
      supplier_checkbox: { type: 'String', select: true },
      tax: { type: 'String', select: true },
      tax_checkbox: { type: 'String', select: true },
      tax_description: { type: 'String', select: true },
      tax_percentage: { type: 'String', select: true },
      tax_percentage_name: { type: 'String', select: true },
      test: { type: 'String', select: true },
      textlocal_api: { type: 'String', select: true },
      textlocal_sender: { type: 'String', select: true },
      theme: { type: 'String', select: true },
      time_format: { type: 'String', select: true, defaultValue: 'enable' },
      time_zone: { type: 'String', select: true, defaultValue: 'Asia/Calcutta' },
      timeIntervalSetting: { type: 'String', select: true },
      to_mail: { type: 'String', select: true },
      updated_by: { type: 'String', select: false },
      updated_by_id: { type: 'ObjectId', select: false },
      updated_date: { type: 'Date', select: true },
      updated_registerId: { type: 'String', select: true },
      user_access: { type: 'String', select: true },
      UTC_Time_diff: { type: 'String', select: true },
      way2sms_api: { type: 'String', select: true },
      way2sms_password: { type: 'String', select: true },
      way2sms_userid: { type: 'String', select: true },
      website: { type: 'String', select: true },
    };
  }

  static simplifyDocument(document) {
    return simplifyDocument(document);
  }

  /**
   * Fill default values for missing fields (matches PHP fillDefaultValue)
   * Ensures all fields with select:true are present in the response
   * @param {Object} document - The document to fill
   * @returns {Object} - Document with all select fields present
   */
  fillDefaultValue(document) {
    if (!document || typeof document !== 'object') {
      return document;
    }

    // Iterate through all fields defined in this.fields
    for (const [fieldName, fieldConfig] of Object.entries(this.fields)) {
      // Only add missing fields that are marked for selection
      if (fieldConfig.select && !(fieldName in document)) {
        // Use defaultValue if defined, otherwise null
        document[fieldName] = fieldConfig.defaultValue ?? null;
      }
    }

    return document;
  }

  // Matches PHP branchPage
  async branchPage(filters = {}, options = {}, context = {}) {
    try {
      // Check Plan
      const checkResponse = await this.baseModel.checkPlan('branches', 'getAll', context.user);
      const limitCheck = { limit: checkResponse };

      // Filter by User's Branch Access
      // PHP gets user details from DB, but we expect context.user to be populated
      const user = context.user || {};
      const branchAccess = user.branch_access || [];

      const branchIds = branchAccess
        .map((b) => {
          try {
            return new Types.ObjectId(b.branch_id);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      const extraFilter = {
        $and: [
          { _id: { $in: branchIds } },
          { license: context.license ? new Types.ObjectId(context.license) : null },
        ],
      };

      // Merge extraFilter into filters
      // If filters already has matching keys, we need to be careful.
      // PHP array_merge appends logic.
      // For MongoDB query, if filters has $and, we push to it.

      let finalFilters = { ...filters };

      // Use BaseModel assignFilterObjects logic if needed, but here we construct query.
      // The PHP model calls assignFilterObjects.
      finalFilters = this.baseModel.assignFilterObjects(finalFilters, this.fields);

      // Merge user access constraints
      if (finalFilters.$and) {
        finalFilters.$and = finalFilters.$and.concat(extraFilter.$and);
      } else {
        // If no $and, just merge. But wait, if keys collide?
        // _id collision: filters._id and extraFilter._id
        // Safe way is to put everything in $and
        finalFilters = {
          $and: [finalFilters, ...extraFilter.$and],
        };
      }

      // Execute Page
      // Adjust options.limit based on checkResponse (plan limit)
      let limit = options.limit || 10;
      if (checkResponse > 0) {
        if (limit > checkResponse) {
          limit = checkResponse;
        }
      }
      options.limit = limit;

      // PHP line 718: parent::page(self::$collectionName, $limitCheck, $filters, $options, $this->getSelectFields($this->fields))
      return await this.baseModel.page(
        'branches',
        limitCheck,
        finalFilters,
        options,
        this.baseModel.getSelectFields(this.fields)
      );
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  buildFilters(filters = {}) {
    const query = {};
    if (!filters || typeof filters !== 'object') {
      return query;
    }

    if (filters.branch_name) {
      query.branch_name = { $regex: searchPattern(filters.branch_name), $options: 'i' };
    }

    if (filters.country) {
      query.country = filters.country;
    }

    if (filters.state) {
      query.state = filters.state;
    }

    if (filters.city) {
      query.city = filters.city;
    }

    if (filters.license && Types.ObjectId.isValid(filters.license)) {
      query.license = filters.license;
    }

    if (filters.branch_id && Types.ObjectId.isValid(filters.branch_id)) {
      query.branch_id = filters.branch_id;
    }

    if (filters._id && Types.ObjectId.isValid(filters._id)) {
      query._id = filters._id;
    }

    return query;
  }

  /**
   * Get register data for a branch with open register check
   * Matches PHP userRegisterBranchSelectModel (lines 875-943)
   * @param {string} branchId
   * @param {Object} user - Current user object with _id and license
   * @returns {Promise<Object>} - { status, data, message }
   */
  async getRegisterList(branchId, user = null) {
    try {
      if (!branchId || !Types.ObjectId.isValid(branchId)) {
        return {
          status: false,
          data: null,
          message: 'Branch id is required',
        };
      }

      // PHP lines 878-885: Check for open register in cashregister collection
      let openRegister = null;
      if (user && user._id && user.license) {
        const db = this.model.db;
        const cashregisterCollection = db.collection('cashregister');

        const openRegDoc = await cashregisterCollection.findOne({
          current_user_id: new Types.ObjectId(user._id),
          branch_id: new Types.ObjectId(branchId),
          register_status: 'Opened',
          license: new Types.ObjectId(user.license),
        });

        // PHP lines 921-928: Include open register if found
        if (openRegDoc) {
          openRegister = {
            cash_register_id: openRegDoc._id.toString(),
            register_id: openRegDoc.register_id ? openRegDoc.register_id.toString() : '',
            register_name: openRegDoc.register_name || '',
            register_status: openRegDoc.register_status || '',
          };
        }
      }

      // PHP lines 887-913: Get register list from branch
      const branch = await this.model.findById(branchId).lean();
      if (!branch) {
        return {
          status: false,
          data: null,
          message: 'Branch not found',
        };
      }

      const registerData = Array.isArray(branch.register)
        ? branch.register.map((register) => ({
            register_id:
              register.register_id?.toString?.() ||
              register.id?.toString?.() ||
              register._id?.toString?.() ||
              '',
            register_name: register.register_name || '',
          }))
        : [];

      // A user with linked registers (user form -> Choose Register) is offered
      // only those; an empty link list means no restriction. Admin-type
      // accounts are never restricted, and any lookup problem - or links that
      // match nothing (e.g. stale ids) - falls back to the full list rather
      // than presenting a till with no registers at all.
      let offered = registerData;
      if (user && user._id) {
        try {
          const type = String(user.usertype || '').toLowerCase();
          const unrestricted = ['owner', 'admin', 'super_admin', 'manager', 'store_manager'];
          if (!unrestricted.includes(type)) {
            const userDoc = await this.model.db
              .collection('users')
              .findOne(
                { _id: new Types.ObjectId(user._id) },
                { projection: { registers: 1 } }
              );
            const links = Array.isArray(userDoc?.registers) ? userDoc.registers : [];
            if (links.length) {
              const allowed = new Set(
                links.map((r) => String(r.register_id?.$oid || r.register_id || r.id || r))
              );
              const filtered = registerData.filter((r) => allowed.has(String(r.register_id)));
              if (filtered.length) offered = filtered;
            }
          }
        } catch (filterErr) {
          console.error('register link filter skipped:', filterErr.message);
        }
      }

      // PHP lines 915-933: Return data with open_register
      return {
        status: true,
        data: {
          register_data: offered,
          open_register: openRegister,
        },
        message: 'register report successfully',
      };
    } catch (error) {
      console.error('Error fetching register list:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to load register data',
      };
    }
  }

  /**
   * Get branch details (legacy getOneStore)
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async getBranchDetails(id) {
    try {
      if (!id || !Types.ObjectId.isValid(id)) {
        return {
          status: false,
          data: null,
          message: 'Branch id is required',
        };
      }

      const branch = await this.model.findById(id).lean();

      if (!branch) {
        return {
          status: false,
          data: null,
          message: 'Branch not found',
        };
      }

      // Simplify ObjectIds and Dates
      const simplified = BranchModel.simplifyDocument(branch);

      // Fill missing fields with defaults (matches PHP fillDefaultValue behavior)
      const withDefaults = this.fillDefaultValue(simplified);

      // Add razorKey and razorUrl from user context (matches PHP session data)
      withDefaults.razorKey = this.user?.razor_key || null;
      withDefaults.razorUrl = this.user?.razor_url || null;

      // Set default values for fields that may not exist (PHP parity)
      withDefaults.enable_notification_reminders =
        withDefaults.enable_notification_reminders ?? false;
      withDefaults.enable_email_reminders = withDefaults.enable_email_reminders ?? false;
      withDefaults.enable_sms_reminders = withDefaults.enable_sms_reminders ?? false;
      withDefaults.enable_sms_auto_send = withDefaults.enable_sms_auto_send ?? false;
      withDefaults.sms_auto_send_time = withDefaults.sms_auto_send_time ?? '10:00 am';
      withDefaults.sms_retry_period = withDefaults.sms_retry_period ?? '24';
      withDefaults.sms_max_retries = withDefaults.sms_max_retries ?? '2';
      withDefaults.hardware_weight_machine_enable =
        withDefaults.hardware_weight_machine_enable ?? false;
      /*
       * The PIN lock is off until a shop asks for it. An existing shop taking
       * an update must never find its tills demanding a PIN that nobody has
       * been given.
       */
      withDefaults.till_lock_enable = withDefaults.till_lock_enable ?? false;
      withDefaults.till_lock_idle_minutes = withDefaults.till_lock_idle_minutes ?? 0;
      /*
       * Staff clock-in shipped live (no dark launch), so the default is ON:
       * a shop that never visited Settings keeps the clock button it already
       * uses. Only an explicit false hides it.
       */
      withDefaults.staff_shifts_enable = withDefaults.staff_shifts_enable ?? true;
      // Tips are hospitality-only: off until a shop asks. The roster follows
      // the shifts pattern: on unless the shop turned it off.
      withDefaults.staff_tips_enable = withDefaults.staff_tips_enable ?? false;
      withDefaults.staff_roster_enable = withDefaults.staff_roster_enable ?? true;

      // Ensure time_zone has a default value if not present (matches PHP BaseModel line 49)
      if (!withDefaults.time_zone) {
        withDefaults.time_zone = 'Asia/Calcutta';
      }

      // Ensure time_format always has a concrete value; legacy PHP stores
      // this as 'enable' and the frontend expects that string to decide
      // whether to show time together with date. If the field is missing
      // or empty (older data), normalise it to 'enable' for full parity.
      if (!withDefaults.time_format) {
        withDefaults.time_format = 'enable';
      }

      // PHP lines 228-244: Ensure currency_value exists for frontend currency dropdown
      if (!withDefaults.currency_value || withDefaults.currency_value.length === 0) {
        // Default to INR if not set (matches PHP default)
        withDefaults.currency_value = [
          {
            currency_text: 'INR',
            currency_sign: '₹',
          },
        ];
      }

      // Add legacy print templates (Parity with PHP getBranchDetailsById)
      try {
        const fs = require('fs');
        const path = require('path');
        withDefaults.print_a4html = fs.readFileSync(
          path.join(__dirname, '../json/print_a4html.txt'),
          'utf8'
        );
        withDefaults.print_standard_html = fs.readFileSync(
          path.join(__dirname, '../json/print_standard_html.txt'),
          'utf8'
        );
      } catch (e) {
        // Ignore if files missing
      }

      return {
        status: true,
        data: withDefaults,
        message: 'success',
      };
    } catch (error) {
      console.error('Error fetching branch details:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get all branches with pagination and filtering
   * @param {Object} filters - Filter criteria
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} - Paginated results
   */
  async getAllBranches(filters = {}, page = 1, limit = 10) {
    try {
      const query = this.buildFilters(filters);
      const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
      const limitNumber = Math.max(parseInt(limit, 10) || 10, 1);
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total] = await Promise.all([
        this.model.find(query).sort({ created_date: -1 }).skip(skip).limit(limitNumber).lean(),
        this.model.countDocuments(query),
      ]);

      return {
        status: true,
        data: items,
        pagination: {
          total,
          page: pageNumber,
          pages: Math.max(Math.ceil(total / limitNumber), 1),
          limit: limitNumber,
        },
      };
    } catch (error) {
      console.error('Error getting branches:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to retrieve branches',
      };
    }
  }

  /**
   * Get branch by ID with populated fields
   * @param {string} id - Branch ID
   * @returns {Promise<Object>} - Branch data
   */
  async getBranchById(id) {
    try {
      if (!id || !Types.ObjectId.isValid(id)) {
        return { status: false, message: 'Branch id is required' };
      }

      const branch = await this.model.findById(id).lean();
      if (!branch) {
        return { status: false, message: 'Branch not found' };
      }

      // Populate customer and supplier names manually
      // PHP line 580: $document['data']['customername'] = (new CustomerModel)->getCustomerDetails(...)['name'];
      // PHP line 581: $document['data']['suppliername'] = (new SupplierModel)->supplierDetails(...)['name'];
      if (branch.default_customer) {
        try {
          const customersCollection = BaseModel.database.collection('customers');
          const customer = await customersCollection.findOne(
            { _id: new Types.ObjectId(branch.default_customer) },
            { projection: { name: 1 } }
          );
          if (customer && customer.name) {
            branch.customername = customer.name;
          }
        } catch (e) {
          console.error('Error fetching customer name:', e);
        }
      }

      if (branch.default_supplier) {
        try {
          const suppliersCollection = BaseModel.database.collection('suppliers');
          const supplier = await suppliersCollection.findOne(
            { _id: new Types.ObjectId(branch.default_supplier) },
            { projection: { name: 1 } }
          );
          if (supplier && supplier.name) {
            branch.suppliername = supplier.name;
          }
        } catch (e) {
          console.error('Error fetching supplier name:', e);
        }
      }

      return { status: true, data: BranchModel.simplifyDocument(branch) };
    } catch (error) {
      console.error('Error getting branch by ID:', error);
      return { status: false, message: error.message };
    }
  }

  /**
   * Create a new branch with full logic (PHP parity)
   * @param {Object} data - Branch data
   * @param {Object} user - User creating the branch
   * @returns {Promise<Object>} - Created branch data
   */
  async createBranch(data, user = {}) {
    try {
      // 1. Check duplicate
      const duplicate = await this.model.findOne({
        branch_name: { $regex: new RegExp(`^${data.name}$`, 'i') },
        store_telephone: data.phone,
        license: user.license,
      });

      if (duplicate) {
        return {
          status: 'exist',
          message: 'This Branch details already exist in our system',
          data: null,
        };
      }

      // 2. Check plan limit
      if (user && user.plan_access && user.plan_access.branches && user.plan_access.branches.add) {
        const maxBranches = parseInt(user.plan_access.branches.add);
        if (maxBranches > 0) {
          const count = await this.model.countDocuments({ license: user.license });
          if (count >= maxBranches) {
            return {
              status: false,
              message: 'You have reached maximum Branches count, please contact support.',
              data: null,
            };
          }
        }
      }

      // 2b. Cloud plan limit. This is the number the customer actually pays
      // for, so it wins over plan_access, which is copied from the licence in
      // the old system and can be stale. Shops with no cloud account are
      // unaffected: branchLimit() is null for them.
      const cloudBranchLimit = await require('../helpers/limits').branchLimit();
      if (cloudBranchLimit) {
        const count = await this.model.countDocuments({ license: user.license });
        if (count >= cloudBranchLimit) {
          return {
            status: false,
            message:
              `Your Posnic plan covers ${cloudBranchLimit} outlet${cloudBranchLimit > 1 ? 's' : ''}. ` +
              'Add another from your account, or contact your provider.',
            data: null,
          };
        }
      }

      // 3. Prepare data
      const mongoDate = new Date();
      const fs = require('fs');
      const path = require('path');

      // Load templates
      let regularBodyPrint = '';
      let thermalBodyPrint = '';
      try {
        regularBodyPrint = fs.readFileSync(
          path.join(__dirname, '../json/print_a4html.txt'),
          'utf8'
        );
        thermalBodyPrint = fs.readFileSync(
          path.join(__dirname, '../json/print_standard_html.txt'),
          'utf8'
        );
      } catch (e) {
        console.warn('Print templates not found, using defaults');
      }

      // Process registers
      const registers = [];
      if (Array.isArray(data.register)) {
        data.register.forEach((regName) => {
          if (regName) {
            registers.push({
              register_id: new Types.ObjectId(),
              register_name: regName,
            });
          }
        });
      }

      const currencyType = [
        {
          currency_text: 'INR',
          currency_sign: '₹',
        },
      ];

      const branchData = {
        branch_name: data.name?.trim(),
        country: data.country,
        country_id: data.country_id,
        state: data.state,
        store_address: data.address?.trim(),
        store_email: data.email?.trim(),
        store_telephone: data.phone?.trim(),
        register: registers,

        // Defaults
        theme: 'blue',
        logo: 'store.png',
        indian_gst: 'gst_off', // Default to gst_off, can be overridden by settings
        currency: '₹',
        currency_text: 'India Rupee / INR or ₹',
        currency_type: '₹',
        currency_value: currencyType,
        time_zone: 'Asia/Kolkata', // Should come from settings or user
        printing_address: data.address?.trim(),
        smstype: 'way2sms',
        discount_amount: 0,
        discount_percentage: 0.0,
        sales_prefix: 'S',
        receiving_prefix: 'RID',
        auto_sms: false, // Default to false or from session settings
        sales_sms: false,
        whatsapp_receipt: false,
        roundOff: false,
        sales_mail: false,
        customer_print: false,
        print_logoimg: false,
        print_sale_notes: false,
        receipt_barcode: false,
        api: [],
        printall: false,
        keyboard_view: false,
        balance_view: true,
        customer_checkbox: false,
        supplier_checkbox: false,
        tax_checkbox: false,
        print_type: 'standard',
        printing_size: 'receipt_medium',
        print_character: 'default',
        header_print: 'default',
        footer_print: 'Thank you for shopping...!',
        regular_body_print: regularBodyPrint,
        thermal_body_print: thermalBodyPrint,
        print_controls: {
          receiving_title:
            '<span style="font-size: 14px !important;font-weight: 900;">PURCHASE INVOICE</span>',
          receiving_return_title:
            '<span style="font-size: 14px !important;font-weight: 900;">PURCHASE RETURN INVOICE</span>',
          sale_title:
            '<span style="font-size: 14px !important;font-weight: 900;">SALES RECEIPT</span>',
          sale_return_title:
            '<span style="font-size: 14px !important;font-weight: 900;">SALES RETURN RECEIPT</span>',
          a4: {
            lineitem_hsn: 'on',
            lineitem_price: 'on',
            lineitem_qty: 'on',
            lineitem_disc: 'on',
            lineitem_tax: 'on',
            lineitem_total: 'on',
            print_qty: 'on',
            print_roundoff: 'on',
          },
        },
        notification_range: '5',
        client_dateformat: 'dd/mm/yyyy',
        server_dateformat: 'd/m/Y',
        dateformat_text: '01/01/2018 -- dd/mm/yyyy',
        time_format: 'enable',
        payment_gateway: [],
        kiosk: [],

        /*
         * Written out, not left to the read-time default.
         *
         * Sync replaces whole documents: the winning side's copy is written
         * over the other in full, so a field the winner does not carry is not
         * merged, it is deleted. A branch created without these had no lock
         * fields at all, and the first time that branch was edited on the other
         * side the till's lock setting vanished with it - the shop switched the
         * lock on, enrolled a PIN, and found the setting off again with no
         * error anywhere. Absent and false read the same through the API, which
         * is why nothing complained.
         */
        till_lock_enable: false,
        till_lock_idle_minutes: 0,
        staff_shifts_enable: true,
        staff_tips_enable: false,
        staff_roster_enable: true,

        created_by_id: user._id,
        created_by: user.username,
        updated_by_id: user._id,
        updated_by: user.username,
        license: user.license,
        created_date: mongoDate,
        updated_date: mongoDate,
      };

      const branch = await this.model.create(branchData);
      const branchId = branch._id;

      // Get database reference for direct collection access
      const db = this.model.db;

      // 4. Create default customer
      const customerCollection = db.collection('customers');
      const indianGst = branchData.indian_gst || 'gst_off';
      const defaultCustomerData = {
        branch_id: branchId,
        branch_name: data.name?.trim(),
        name: 'Walk-in Customer',
        date: mongoDate,
        phone: '',
        /*
         * No email key at all, rather than an empty one.
         *
         * customers carries a unique sparse index on email. Sparse skips
         * documents where the field is absent - it does not skip an empty
         * string, which is a value like any other. So the first branch created
         * this way wrote email:"" quite happily and every branch after it died
         * with E11000, and the shop saw a branch that would not save with
         * nothing on screen explaining why.
         *
         * Leaving it out matches every Walk-In-Customer already in these
         * databases - all of them have no email field - so old and new records
         * are the same shape. The default supplier below solves the same
         * problem by inventing a unique address instead; that works too, but an
         * invented address is visible to the shop and an absent field is not.
         */
        address: '',
        sortname: '',
        country: data.country,
        state: data.state,
        city: '',
        gst: indianGst === 'gst_off' ? 'disable' : 'enable',
        gst_number: '',
        gst_type: 'consumer',
        license: user.license,
        created_by: user.username,
        created_by_id: user._id,
        updated_by: user.username,
        updated_by_id: user._id,
        created_date: mongoDate,
        updated_date: mongoDate,
      };
      const customerResult = await customerCollection.insertOne(defaultCustomerData);
      const customerId = customerResult.insertedId;

      // 5. Create default supplier
      const supplierCollection = db.collection('suppliers');
      const defaultSupplierData = {
        branch_id: branchId,
        branch_name: data.name?.trim(),
        name: 'General Supplier',
        // supplier.model.js enforces a unique index on email; a shared blank
        // string collides on every branch after the first, so give each
        // default supplier a placeholder that's unique per branch.
        email: `anonymous-supplier-${branchId}@posnic.local`,
        phone: '',
        address: '',
        sortname: '',
        country: data.country,
        state: data.state,
        city: '',
        gst: 'disable',
        gst_number: '',
        gst_type: 'consumer',
        license: user.license,
        created_by: user.username,
        created_by_id: user._id,
        updated_by: user.username,
        updated_by_id: user._id,
        created_date: mongoDate,
        updated_date: mongoDate,
      };
      const supplierResult = await supplierCollection.insertOne(defaultSupplierData);
      const supplierId = supplierResult.insertedId;

      // 5b. Create a default "General" customer category, so the customer form
      // has a ready group to pick and a new shop is not forced to create one
      // before it can save its first customer.
      const customerCategoryCollection = db.collection('customer_category');
      await customerCategoryCollection.insertOne({
        branch_id: branchId,
        branch_name: data.name?.trim(),
        name: 'General',
        description: 'Default customer group.',
        license: user.license,
        created_by: user.username,
        created_by_id: user._id,
        updated_by: user.username,
        updated_by_id: user._id,
        created_date: mongoDate,
        updated_date: mongoDate,
      });

      // 6. Setup Taxes
      let sortname = '';
      let defaultTaxId = null;
      try {
        const countriesJson = fs.readFileSync(
          path.join(__dirname, '../json/countries.json'),
          'utf8'
        );
        const taxValue = JSON.parse(countriesJson);
        const countryData = taxValue.countries.find((c) => c.value === data.country);

        if (countryData) {
          sortname = countryData.sortname;
          if (countryData.tax) {
            const grouptaxCollection = db.collection('grouptax');

            for (const tax of countryData.tax) {
              const taxResult = await grouptaxCollection.insertOne({
                branch_id: branchId,
                branch_name: data.name,
                name: tax.tax_name,
                rate: parseFloat(tax.tax_value),
                tax_fields: {
                  tax_id: new Types.ObjectId(),
                  tax_name: tax.tax_name,
                  tax_value: tax.tax_value,
                },
                tax_group: 'no',
                license: user.license,
                created_by: user.username,
                created_by_id: user._id,
                updated_by: user.username,
                updated_by_id: user._id,
                created_date: mongoDate,
                updated_date: mongoDate,
              });
              // Store first tax as default
              if (!defaultTaxId) {
                defaultTaxId = taxResult.insertedId;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to setup default taxes', e);
      }

      // 7. Update Branch with defaults
      // We need to fetch the inserted customer/supplier/tax IDs if we want to set defaults
      // For simplicity, update branch with references
      // Note: Tax default ID logic in PHP relies on the inserted tax. Skipping exact tax default for now.

      const kioskData = [
        {
          branch_id: branchId,
          user_id: user._id,
          user_name: user.username,
        },
      ];

      await this.model.updateOne(
        { _id: branchId },
        {
          $set: {
            sortname: sortname,
            default_customer: customerId,
            default_supplier: supplierId,
            default_tax: defaultTaxId,
            kiosk: kioskData,
          },
        }
      );

      // 8. Update User Access
      const userArrayData = {
        branch_id: branchId,
        branch_name: data.name,
        branch_image: 'store.png',
      };

      const printBranch = {
        branch_id: branchId,
        printing_design: 'standard',
      };

      /*
       * Stamp the user, or the new branch never reaches the tills.
       *
       * Sync copies a document only when the other side's updated_date is
       * strictly newer. Pushing into branch_access without touching it left
       * both copies of the user on the same timestamp with different contents -
       * so the till could never learn about a branch created on the web, and no
       * amount of resyncing would fix it. The branch itself arrived; the
       * permission to see it did not, and the branch list is filtered by that
       * permission. It looked exactly like a sync that had stopped working.
       */
      await User.updateMany(
        { _id: user._id, license: user.license },
        {
          $push: {
            branch_access: userArrayData,
            printing_design: printBranch,
          },
          $set: { updated_date: new Date() },
        }
      );

      // 9. Update Branch email fields
      const mailArrayData = {
        branch_id: branchId,
        email_address: [{ email: data.email }],
        report_type: 'daily',
        send_mail: 'mail_off',
      };

      await this.model.updateOne({ _id: branchId }, { $push: { email_fields: mailArrayData } });

      // 10. Create Unit (Quantity)
      const unitCollection = db.collection('unit');
      await unitCollection.insertOne({
        branch_id: branchId,
        branch_name: data.name,
        name: 'Quantity',
        value: 'qty',
        license: user.license,
        created_by: user.username,
        created_by_id: user._id,
        updated_by: user.username,
        updated_by_id: user._id,
        created_date: mongoDate,
        updated_date: mongoDate,
      });

      // 11. Change Log
      await this.baseModel.changeLog('branches', user._id, branchId, 'insert');

      // 12. Get updated branch list from user's branch_access (matches PHP getBranches)
      const updatedUser = await User.findOne({ _id: user._id, license: user.license }).lean();
      const branchList = (updatedUser?.branch_access || []).map((item) => ({
        id: item.branch_id.toString(),
        branch_name: item.branch_name,
        branch_image: item.branch_image,
      }));

      return {
        status: true,
        data: {
          insertId: branchId.toString(),
          branchList: branchList,
        },
        message: 'Branch added successfully',
      };
    } catch (error) {
      console.error('Error creating branch:', error);
      return { status: false, message: error.message };
    }
  }

  /**
   * Update a branch
   * @param {string} id - Branch ID
   * @param {Object} data - Updated branch data
   * @param {Object} user - User updating the branch
   * @returns {Promise<Object>} - Updated branch data
   */
  async updateBranch(id, data, user = {}) {
    try {
      if (!id || !Types.ObjectId.isValid(id)) {
        return { status: false, message: 'Branch id is required' };
      }

      // Process registers. A register that already exists on the branch KEEPS
      // its register_id (matched by name) - regenerating ids on every edit
      // would orphan user links and historical cashregister sessions that
      // reference them. Only genuinely new names get a new id. If the current
      // registers can't be read, fall back to minting ids (legacy behaviour)
      // rather than failing the update.
      let currentRegisters = [];
      try {
        const existing = await this.model.findById(id).select('register').lean();
        currentRegisters = (existing && existing.register) || [];
      } catch (lookupErr) {
        currentRegisters = [];
      }
      const existingByName = new Map(
        currentRegisters
          .filter((r) => r && r.register_name)
          .map((r) => [String(r.register_name).trim(), r.register_id])
      );
      const registers = [];
      if (Array.isArray(data.register)) {
        data.register.forEach((regName) => {
          if (regName) {
            const name = String(regName).trim();
            registers.push({
              register_id: existingByName.get(name) || new Types.ObjectId(),
              register_name: name,
            });
          }
        });
      }

      const updateData = {
        branch_name: data.name?.trim(),
        country: data.country,
        country_id: data.country_id,
        state: data.state,
        store_address: data.address?.trim(),
        store_email: data.email?.trim(),
        store_telephone: data.phone?.trim(),
        register: registers,

        // Settings that might be passed or preserved
        stock_management: data.stock_management || false,
        stock_management_log: data.stock_management_log || false,
        sale_inline_editor: data.sale_inline_editor || false,

        updated_by_id: user._id,
        updated_by: user.username,
        updated_date: new Date(),
      };

      const branch = await this.model
        .findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
        .lean();

      if (!branch) {
        return { status: false, message: 'Branch not found' };
      }

      // Log change
      await this.baseModel.changeLog('branches', user._id, id, 'update');

      // Update User Access
      // Pull old branch access
      await User.updateMany(
        { _id: user._id, license: user.license },
        {
          $pull: { branch_access: { branch_id: new Types.ObjectId(id) } },
          $set: { updated_date: new Date() },
        }
      );

      // Push new branch access
      const userArrayData = {
        branch_id: new Types.ObjectId(id),
        branch_name: data.name,
        branch_image: data.logo || 'store.png',
      };

      await User.updateMany(
        { _id: user._id, license: user.license },
        {
          $push: { branch_access: userArrayData },
          $set: { updated_date: new Date() },
        }
      );

      // PHP lines 533-554: Update branch name in all collections
      // This is critical for data consistency across the application
      const branchDetails = {
        id: id,
        branch_name: data.name?.trim(),
        store_address: data.address?.trim(),
        store_email: data.email?.trim(),
        store_telephone: data.phone?.trim(),
        branch_image: data.logo || 'store.png',
      };

      await this.updateBranchNameInCollections(branchDetails, user.license);

      return {
        status: true,
        data: BranchModel.simplifyDocument(branch),
        message: 'Branch updated successfully',
      };
    } catch (error) {
      console.error('Error updating branch:', error);
      return { status: false, message: error.message };
    }
  }

  /**
   * Get registers for one or more branches
   * Matches PHP getBranchRegisterListModel
   * @param {string|string[]} branchIds
   */
  async getBranchRegisterList(branchIds) {
    try {
      const ids = Array.isArray(branchIds) ? branchIds : [branchIds];
      const objectIds = ids
        .map((id) => {
          try {
            return new Types.ObjectId(id);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      if (objectIds.length === 0) {
        return { status: false, data: null, message: 'Invalid Branch IDs' };
      }

      // Aggregate registers
      const pipeline = [
        { $match: { _id: { $in: objectIds } } },
        { $unwind: '$register' },
        {
          $project: {
            register_id: '$register.register_id',
            register_name: '$register.register_name',
            branch_name: '$branch_name',
            branch_id: '$_id',
          },
        },
      ];

      const results = await this.model.aggregate(pipeline);

      const formatted = results.map((item) => ({
        register_id: item.register_id ? item.register_id.toString() : '',
        register_name: item.register_name || '',
        branch_name: item.branch_name || '',
        branch_id: item.branch_id ? item.branch_id.toString() : '',
      }));

      return {
        status: true,
        data: formatted,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getBranchRegisterList:', error);
      return { status: false, message: error.message };
    }
  }

  // Alias for userRegisterBranchSelectModel -> getRegisterList
  async userRegisterBranchSelect(branchId) {
    return this.getRegisterList(branchId);
  }

  /**
   * Get payment gateway settings
   * Matches PHP resetPaymentGatewayModel
   */
  async getPaymentGatewaySettings(branchId, licenseId) {
    try {
      if (!branchId) return { status: false, message: 'Branch ID required', data: null };
      if (!licenseId) return { status: false, message: 'License ID required', data: null };

      // Convert branchId to ObjectId if it's a string (same fix as paymentsKey)
      const branchObjectId = typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;

      // Match PHP filters: _id AND license
      const filters = {
        _id: branchObjectId,
        license: licenseId,
      };

      const branch = await this.model.collection.findOne(filters);

      if (!branch) return { status: false, message: 'Branch not found', data: null };

      return {
        status: true,
        data: branch.payment_gateway || null,
        message: 'register report successfully', // Keeping legacy message
      };
    } catch (error) {
      console.error('Error in getPaymentGatewaySettings:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  /**
   * Get PhonePe payment gateway settings
   * Matches PHP resetPhonepePaymentGatewayModel
   */
  async getPhonePePaymentGatewaySettings(branchId) {
    try {
      if (!branchId) return { status: false, message: 'Branch ID required' };

      // Note: Schema might not have phonepe_payment_gateway defined explicitly if it's dynamic
      // But we can select it. Mongoose might strip it if strict is true and not in schema.
      // Assuming strict: false or added to schema.
      // It was not in my schema update! I should add it or use strict: false.
      // Schema has `payment_gateway` but not `phonepe_payment_gateway`.
      // Let's assume it's in the document.

      const branch = await this.model.collection.findOne({ _id: new Types.ObjectId(branchId) });

      if (!branch) return { status: false, message: 'Branch not found' };

      return {
        status: true,
        data: branch.phonepe_payment_gateway || {
          merchantId: null,
          saltKey: null,
          name: 'phonepe',
          status: false,
        },
        message: 'register report successfully',
      };
    } catch (error) {
      return { status: false, message: error.message };
    }
  }

  /**
   * Get Email settings
   * Matches PHP resetEmailSettingModel
   */
  async getEmailSettings(branchId, licenseId) {
    try {
      if (!branchId) return { status: false, message: 'Branch ID required', data: null };
      if (!licenseId) return { status: false, message: 'License ID required', data: null };

      // Convert branchId to ObjectId if it's a string
      const branchObjectId = typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;

      // Match PHP filters: _id AND license
      const filters = {
        _id: branchObjectId,
        license: licenseId,
      };

      const branch = await this.model.collection.findOne(filters);

      if (!branch) return { status: false, message: 'Branch not found', data: null };

      return {
        status: true,
        data: branch.email_fields || [],
        message: 'register report successfully',
      };
    } catch (error) {
      console.error('Error in getEmailSettings:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  /**
   * Delete Branch Collection Data
   * Matches PHP branch_model.php deleteBranchCollectionData($id)
   * @param {Array} id - Array of branch IDs to delete
   * @param {Object} user - Current user object with branch_id and license
   * @returns {Promise<Object>} - Deletion status with branch list
   */
  async deleteBranchCollectionData(id, user) {
    try {
      // PHP line 619: $branchid = self::$currentBranch;
      const branchid = user.branch_id;
      const array_merge = [];

      // PHP lines 620-632: foreach ($id as $key => $data)
      for (const data of id) {
        // PHP line 621: if ((string) $branchid === $data)
        if (branchid && branchid.toString() === data.toString()) {
          // PHP lines 622-627: Cannot delete master branch
          return {
            status: false,
            data: null,
            message: 'You Can Not Be Delete Master Branch Setting',
          };
        }

        // PHP line 629: $array_merge[$key] = new MongoDB\BSON\ObjectID($data);
        array_merge.push(new Types.ObjectId(data));

        // PHP line 630: self::changeLog(self::$collectionName, self::$loggedUser, new MongoDB\BSON\ObjectID($data), 'delete');
        await this.baseModel.changeLog('branches', user._id, new Types.ObjectId(data), 'delete');

        // PHP line 631: (new UserModel)->updateUserBranchAccess(new MongoDB\BSON\ObjectID($data));
        // PHP user_model.php line 526: $this->collection->updateMany(['license' => self::$license], ['$pull' => ["branch_access" => ["branch_id" => $BranchId]]]);
        await User.updateMany(
          { license: user.license },
          {
            $pull: { branch_access: { branch_id: new Types.ObjectId(data) } },
            $set: { updated_date: new Date() },
          }
        );
      }

      // PHP lines 633-638: Build condition
      const condition = {
        _id: { $in: array_merge },
        license: user.license,
      };

      // PHP lines 640-645: Find branches to backup
      const branchdocument = await this.model.find(condition).lean();
      for (const value of branchdocument) {
        // PHP line 644: BaseModel::deletedDocumentBackup(self::$collectionName, $branchsdata);
        await this.baseModel.deletedDocumentBackup('branches', value);
      }

      // PHP line 646: $this->collection->deleteMany($condition);
      await this.model.deleteMany(condition);

      // PHP line 647: $branchList = $this->getBranches();
      const branchList = await this.getBranches(user);

      // PHP lines 648-652: Return success response
      return {
        status: true,
        data: branchList.data,
        message: 'Branch deleted successfully',
      };
    } catch (error) {
      // PHP lines 653-659: Catch exception
      console.error('Error deleting branch:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get Branches
   * Matches PHP branch_model.php getBranches()
   * @param {Object} user - Current user object
   * @returns {Promise<Object>} - Branch list from user's branch_access
   */
  async getBranches(user) {
    try {
      // PHP lines 671-673: Get user details
      const userDoc = await User.findOne({
        _id: user._id,
        license: user.license,
      })
        .select('+branch_access')
        .lean();

      if (!userDoc || !userDoc.branch_access) {
        return {
          status: true,
          data: [],
          message: 'success',
        };
      }

      // PHP lines 675-681: Build branch list
      const branchList = userDoc.branch_access.map((item) => ({
        id: item.branch_id.toString(),
        branch_name: item.branch_name,
        branch_image: item.branch_image,
      }));

      // PHP lines 683-687: Return response
      return {
        status: true,
        data: branchList,
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export Branch Order
   * Matches PHP branch_model.php exportBranchOrder()
   * Exports selected branches with specific fields
   * @param {Array} data - Array of branch IDs to export
   * @param {String} license - License ID for filtering
   * @returns {Promise<Object>} - Response with branch data
   */
  async exportBranchOrder(data, license) {
    try {
      // PHP lines 739-754: Convert IDs to ObjectIDs and handle plan limits
      const arrayMerge = [];

      // Check if data is an array or object
      const ids = Array.isArray(data) ? data : Object.values(data);

      for (let i = 0; i < ids.length; i++) {
        if (ids[i]) {
          arrayMerge.push(new Types.ObjectId(ids[i]));
        }
      }

      if (arrayMerge.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No branch IDs provided',
        };
      }

      // PHP lines 756-759: Find branches with specific fields
      // Export fields from PHP: branch_name, store_email, store_telephone, store_address, state, country
      const cursor = await this.model
        .find({
          _id: { $in: arrayMerge },
          license: new Types.ObjectId(license),
        })
        .select('branch_name store_email store_telephone store_address state country')
        .sort({ _id: -1 })
        .lean();

      // PHP lines 760-763: Return response
      return {
        status: true,
        data: cursor,
        message: 'Branch Data Exported',
      };
    } catch (error) {
      // PHP lines 765-771: Catch exception
      console.error('Error in exportBranchOrder:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update branch name across all collections
   * Matches PHP branchInsertUpdate lines 533-554
   * @param {Object} branchDetails - Branch details to update
   * @param {String} license - License ID
   */
  async updateBranchNameInCollections(branchDetails, license) {
    try {
      const db = this.model.db;
      const branchId = new Types.ObjectId(branchDetails.id);
      const updateData = {
        branch_name: branchDetails.branch_name,
        store_address: branchDetails.store_address,
        store_email: branchDetails.store_email,
        store_telephone: branchDetails.store_telephone,
      };

      // PHP line 542: SalesModel::updateSalesModel($branchDetails)
      const salesCollection = db.collection('sales');
      await salesCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: updateData }
      );

      // PHP line 543: ReceivingModel::updateReceivingModel($branchDetails)
      const receivingsCollection = db.collection('receivings');
      await receivingsCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: updateData }
      );

      // PHP line 544: ItemModel::updateBranchModel($branchDetails)
      const itemsCollection = db.collection('items');
      await itemsCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: { branch_name: branchDetails.branch_name } }
      );

      // PHP line 545: CustomerModel::updateCustomerModel($branchDetails)
      const customersCollection = db.collection('customers');
      await customersCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: { branch_name: branchDetails.branch_name } }
      );

      // PHP line 546: ExpensesModel::updateExpensesModel($branchDetails)
      const expensesCollection = db.collection('expenses');
      await expensesCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: { branch_name: branchDetails.branch_name } }
      );

      // PHP line 547: SupplierModel::updateSupplierModel($branchDetails)
      const suppliersCollection = db.collection('suppliers');
      await suppliersCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: { branch_name: branchDetails.branch_name } }
      );

      // PHP line 548: BaseModel::updateBackupModel($branchDetails)
      const recycleBinCollection = db.collection('recycle_bin');
      await recycleBinCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: { branch_name: branchDetails.branch_name } }
      );

      // PHP line 549: CategoryModel::updateCategoryModel($branchDetails)
      const categoriesCollection = db.collection('categories');
      await categoriesCollection.updateMany(
        { branch_id: branchId, license: new Types.ObjectId(license) },
        { $set: { branch_name: branchDetails.branch_name } }
      );

      console.log(`Updated branch name in all collections for branch ${branchId}`);
    } catch (error) {
      console.error('Error updating branch name in collections:', error);
      throw error;
    }
  }

  // Static method to get data changes (delegates to BaseModel)
  static async getDataChanges(module, from) {
    const baseModel = new BaseModel('branches');
    return await baseModel.getAllDataChanges(module, null, from);
  }
}

module.exports = Branch;
module.exports.Model = Branch;
module.exports.BranchModel = BranchModel;
