// src/services/install.service.js
const InstallRepository = require('../repositories/install.repository');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  DEFAULTS,
  DEFAULT_ACCESS,
  USER_TYPES,
  REGISTER_STATUS,
} = require('../constants/install.constants');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

/**
 * Install Service
 * Contains business logic for installation operations
 * Acts as a bridge between controller and repository
 */
class InstallService {
  constructor() {
    this.repository = new InstallRepository();
  }

  /**
   * Process installation and create new Posnic account
   * @param {Object} data - Installation data from request
   * @returns {Promise<Object>}
   */
  async processInstallation(data) {
    try {
      console.log('📦 Installation data received:', {
        register_demo: data.register_demo,
        businessType: data.businessType,
        register_demo_type: typeof data.register_demo,
        has_db_username: !!data.db_username,
        has_db_password: !!data.db_password,
      });

      // Setup MongoDB authentication FIRST (before any DB operations)
      // This is needed when MongoDB is already running with --auth flag
      if (data.db_username && data.db_password) {
        console.log('🔐 Setting up MongoDB authentication first...');
        await this._setupMongoDBAuth(data.db_username, data.db_password);
        console.log('✅ MongoDB authentication configured, proceeding with installation');
      }

      const licenseId = new ObjectId(data.register_license);

      // Check if user already exists
      const existingUser = await this.repository.findExistingUser({
        username: data.register_username,
        email: data.register_useremail,
        licenseId,
      });

      if (existingUser) {
        // For fresh installation, cleanup existing data with same license
        console.log('🧹 Found existing data, cleaning up before fresh installation...');
        await this.repository.cleanupByLicense(licenseId);
        console.log('✅ Cleanup complete, proceeding with fresh installation');
      }

      // Generate user secret key
      const usersecretkey = await this._generateUserSecretKey();

      // Create timestamps
      const now = new Date();
      const oneYearLater = new Date(now);
      oneYearLater.setFullYear(oneYearLater.getFullYear() + DEFAULTS.PLAN_DURATION_YEARS);

      // Insert user
      const userId = await this._createUser(data, licenseId, usersecretkey, now, oneYearLater);

      // Load print templates
      const { regularBodyPrint, thermalBodyPrint } = this._loadPrintTemplates();

      // Create branch
      const branchId = await this._createBranch(
        data,
        licenseId,
        userId,
        now,
        regularBodyPrint,
        thermalBodyPrint
      );

      // Update user with branch access
      await this._updateUserBranchAccess(data, userId, licenseId, branchId);

      // Create taxes from countries.json
      const { taxId, taxData, sortname } = await this._createTaxes(
        data,
        branchId,
        userId,
        licenseId,
        now
      );

      // Create default customer and supplier (pass sortname to avoid re-creating taxes)
      const customerId = await this._createDefaultCustomer(
        data,
        branchId,
        userId,
        licenseId,
        now,
        sortname
      );
      const supplierId = await this._createDefaultSupplier(
        data,
        branchId,
        userId,
        licenseId,
        now,
        sortname
      );

      // Create default unit
      const unitId = await this._createDefaultUnit(data, branchId, userId, licenseId, now);

      // Update branch with default values
      await this._updateBranchDefaults(
        branchId,
        licenseId,
        userId,
        data,
        customerId,
        supplierId,
        taxId
      );

      // Add email fields to branch
      await this._addBranchEmailFields(branchId, licenseId, data);

      // Handle demo data or default data
      const userBranch = [
        {
          branch_id: branchId,
          branch_name: data.register_companyname,
          branch_image: DEFAULTS.LOGO,
        },
      ];

      console.log('🔍 Checking demo data condition:', {
        register_demo: data.register_demo,
        businessType: data.businessType,
        willLoadDemo: data.register_demo === true || data.register_demo === 'on',
      });

      if (data.register_demo === true || data.register_demo === 'on') {
        console.log('✅ Loading business-type specific demo data...');
        // Load business-type specific demo data
        await this._insertBusinessTypeDemoData({
          branchId,
          branchName: data.register_companyname.trim(),
          userId,
          username: data.register_username,
          licenseId,
          now,
          userBranch,
          supplierId,
          supplierName: 'General Supplier',
          taxId,
          taxData,
          unitId,
          businessType: data.businessType || 'supermarket', // Generic retail default
        });
      } else {
        console.log('⚠️ Loading default single product...');
        await this._insertDefaultCategoryAndItem({
          branchId,
          branchName: data.register_companyname.trim(),
          userId,
          username: data.register_username,
          licenseId,
          now,
          userBranch,
          supplierId,
          supplierName: 'General Supplier',
          taxId,
          taxData,
          unitId,
        });
      }

      return {
        status: true,
        data: '',
        message: SUCCESS_MESSAGES.ACCOUNT_CREATED,
      };
    } catch (error) {
      console.error('Error in InstallService.processInstallation:', error);

      // Handle MongoDB duplicate key errors
      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyPattern || {})[0] || 'field';
        const duplicateValue = error.keyValue ? error.keyValue[duplicateField] : 'unknown';
        const collectionMatch = error.message.match(/collection: [\w.]+\.(\w+)/);
        const collection = collectionMatch ? collectionMatch[1] : 'database';

        return {
          status: false,
          data: '',
          message: `Duplicate ${duplicateField} '${duplicateValue}' already exists in ${collection}. Please use a different value.`,
        };
      }

      return {
        status: false,
        data: '',
        message: error.message || ERROR_MESSAGES.INSTALLATION_FAILED,
      };
    }
  }

  /**
   * Cleanup all data by license ID
   * @param {string} licenseId - License ID to cleanup
   * @returns {Promise<Object>}
   */
  async cleanupByLicense(licenseId) {
    try {
      const license = new ObjectId(licenseId);
      const result = await this.repository.cleanupByLicense(license);

      return {
        status: true,
        data: {
          license: licenseId,
          totalDeleted: result.totalDeleted,
          details: result.details,
        },
        message: `${SUCCESS_MESSAGES.CLEANUP_SUCCESS} for license ${licenseId}`,
      };
    } catch (error) {
      console.error('Error in InstallService.cleanupByLicense:', error);
      return {
        status: false,
        data: '',
        message: error.message || ERROR_MESSAGES.CLEANUP_FAILED,
      };
    }
  }

  // Private helper methods

  _getDuplicateField(existingUser, data, licenseId) {
    if (existingUser.username === data.register_username) {
      return 'username';
    } else if (existingUser.email === data.register_useremail) {
      return 'email';
    } else if (existingUser.license.toString() === licenseId.toString()) {
      return 'license';
    }
    return 'field';
  }

  async _generateUserSecretKey() {
    const random =
      new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 10000);
    return await bcrypt.hash(random, 10);
  }

  async _createUser(data, licenseId, usersecretkey, now, oneYearLater) {
    // A cloud signup already hashed this password for the website account, and
    // the plaintext is deliberately not kept anywhere. Accepting the hash lets
    // one password work for the website, the shop's cloud site and the till,
    // without ever storing it in the clear or asking the customer twice.
    const hashedPassword = data.register_userpasswordhash
      ? String(data.register_userpasswordhash)
      : await bcrypt.hash(data.register_userpassword.trim(), 10);

    const userData = {
      branch_access: '',
      plan: {
        name: DEFAULTS.PLAN_NAME,
        read: true,
        max_sales: DEFAULTS.MAX_SALES,
        plan_expire: oneYearLater,
      },
      userkey: usersecretkey.trim(),
      firstname: (data.register_firstname || '').trim(),
      lastname: (data.register_lastname || '').trim(),
      username: data.register_username.trim(),
      password: hashedPassword,
      usertype: USER_TYPES.SUPER_ADMIN,
      email: data.register_useremail.trim(),
      apikey: '',
      access: DEFAULT_ACCESS,
      image: DEFAULTS.IMAGE,
      activate: true,
      printing_design: '',
      register_status: REGISTER_STATUS.CLOSED,
      created_date: now,
      updated_date: now,
      expired_date: oneYearLater,
      created_by: data.register_username,
      created_by_id: '',
      updated_by: data.register_username,
      updated_by_id: '',
      license: licenseId,
      plan_access: [],
    };

    return await this.repository.insertUser(userData);
  }

  _loadPrintTemplates() {
    const regularBodyPrint = fs.readFileSync(
      path.join(__dirname, '../json/print_a4html.txt'),
      'utf8'
    );
    const thermalBodyPrint = fs.readFileSync(
      path.join(__dirname, '../json/print_standard_html.txt'),
      'utf8'
    );
    return { regularBodyPrint, thermalBodyPrint };
  }

  async _createBranch(data, licenseId, userId, now, regularBodyPrint, thermalBodyPrint) {
    const branchData = {
      theme: DEFAULTS.THEME,
      branch_name: data.register_companyname.trim(),
      store_address: (data.register_address || '').trim(),
      store_email: data.register_useremail.trim(),
      store_telephone: (data.register_fullnumber || '').trim(),
      country: (data.register_country || '').trim(),
      country_id: data.register_countryid || '',
      state: (data.register_state || '').trim(),
      city: '',
      pincode: '',
      website: '',
      logo: DEFAULTS.LOGO,
      languge: '',
      indian_gst: DEFAULTS.INDIAN_GST,
      branch_gstin_number: '',
      currency: DEFAULTS.CURRENCY,
      currency_text: DEFAULTS.CURRENCY_TEXT,
      currency_type: DEFAULTS.CURRENCY_TYPE,
      currency_value: [{ currency_text: 'INR', currency_sign: '₹' }],
      time_zone: (data.register_timezone || '').trim() || 'Asia/Calcutta',
      register: [],
      cashdenom_fields: [],
      printing_address: (data.register_address || '').trim(),
      smstype: DEFAULTS.SMS_TYPE,
      way2sms_api: '',
      way2sms_userid: '',
      way2sms_password: '',
      textlocal_sender: '',
      textlocal_api: '',
      notification_range: DEFAULTS.NOTIFICATION_RANGE,
      discount: '',
      discount_amount: '0',
      discount_percentage: '0.00',
      sales_prefix: DEFAULTS.SALES_PREFIX,
      receiving_prefix: DEFAULTS.RECEIVING_PREFIX,
      sales_sms: false,
      enable_notification_reminders: false,
      enable_email_reminders: false,
      enable_sms_reminders: false,
      enable_sms_auto_send: false,
      sms_auto_send_time: DEFAULTS.SMS_AUTO_SEND_TIME,
      sms_retry_period: DEFAULTS.SMS_RETRY_PERIOD,
      sms_max_retries: DEFAULTS.SMS_MAX_RETRIES,
      auto_sms: false,
      whatsapp_receipt: false,
      roundOff: false,
      stock_management: true,
      stock_management_log: true,
      printall: false,
      keyboard_view: false,
      balance_view: true,
      offlineprocess: true,
      sales_mail: false,
      customer_print: false,
      print_logoimg: false,
      print_sale_notes: false,
      tax_checkbox: false,
      customer_checkbox: true,
      supplier_checkbox: true,
      print_type: DEFAULTS.PRINT_TYPE,
      printing_size: DEFAULTS.PRINTING_SIZE,
      print_character: DEFAULTS.PRINT_CHARACTER,
      header_print: DEFAULTS.HEADER_PRINT,
      footer_print: DEFAULTS.FOOTER_PRINT,
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
      sale_inline_editor: false,
      client_dateformat: DEFAULTS.CLIENT_DATEFORMAT,
      time_format: 'enable',
      server_dateformat: DEFAULTS.SERVER_DATEFORMAT,
      dateformat_text: DEFAULTS.DATEFORMAT_TEXT,
      default_customer: '',
      default_supplier: '',
      default_tax: '',
      created_date: now,
      updated_date: now,
      created_by: '',
      created_by_id: '',
      updated_by: '',
      updated_by_id: '',
      // register is set above, identically; the duplicate is removed.
      payment_gateway: [],
      settings: {
        offline: {
          sales_action: true,
          receivings_action: true,
          items_action: true,
          suppliers_action: true,
          customers_action: true,
          users_action: true,
          branches_action: true,
          expenses_action: true,
          settings_action: true,
          sales_cache: true,
          receivings_cache: true,
          items_cache: true,
          suppliers_cache: true,
          customers_cache: true,
          users_cache: true,
          branches_cache: true,
          expenses_cache: true,
          setting_cache: true,
        },
      },
      license: licenseId,
    };

    return await this.repository.insertBranch(branchData);
  }

  async _updateUserBranchAccess(data, userId, licenseId, branchId) {
    const userBranch = [
      {
        branch_id: branchId,
        branch_name: data.register_companyname,
        branch_image: DEFAULTS.LOGO,
      },
    ];

    const printBranch = [
      {
        branch_id: branchId,
        printing_design: DEFAULTS.PRINT_TYPE,
        printing_max_char: DEFAULTS.PRINT_CHARACTER,
        printing_size: DEFAULTS.PRINTING_SIZE,
      },
    ];

    await this.repository.updateUserBranchAccess(userId, licenseId, {
      branch_access: userBranch,
      printing_design: printBranch,
      created_by_id: userId,
      updated_by_id: userId,
    });
  }

  async _createTaxes(data, branchId, userId, licenseId, now) {
    const countriesData = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../json/countries.json'), 'utf8')
    );

    let sortname = '';
    let taxId = null;
    let taxData = null;

    for (const countryData of countriesData.countries) {
      if (countryData.value === data.register_country) {
        sortname = countryData.sortname;

        for (const taxitem of countryData.tax) {
          const taxFields = [
            {
              tax_id: new ObjectId(),
              tax_name: taxitem.tax_name,
              tax_value: taxitem.tax_value,
            },
          ];

          taxData = {
            branch_id: branchId,
            branch_name: data.register_companyname.trim(),
            name: taxitem.tax_name,
            rate: parseFloat(taxitem.tax_value),
            tax_fields: taxFields,
            tax_group: 'no',
            created_date: now,
            created_by: data.register_username,
            created_by_id: userId,
            updated_date: now,
            updated_by: data.register_username,
            updated_by_id: userId,
            license: licenseId,
          };

          taxId = await this.repository.insertTax(taxData);
        }
        break;
      }
    }

    return { taxId, taxData, sortname };
  }

  async _createDefaultCustomer(data, branchId, userId, licenseId, now, sortname) {
    // sortname is now passed as parameter to avoid duplicate tax creation

    const customerData = {
      branch_id: branchId,
      branch_name: data.register_companyname.trim(),
      name: 'Walk-in Customer',
      email: '',
      phone: '',
      address: '',
      sortname: sortname,
      country: data.register_country.trim(),
      country_id: data.register_countryid,
      state: data.register_state.trim(),
      city: '',
      gst: 'disable',
      gst_number: '',
      gst_type: 'consumer',
      date: now,
      partial_balance: false,
      balance: 0.0,
      created_date: now,
      updated_date: now,
      created_by: data.register_username,
      created_by_id: userId,
      updated_by: data.register_username,
      updated_by_id: userId,
      license: licenseId,
    };

    return await this.repository.insertCustomer(customerData);
  }

  async _createDefaultSupplier(data, branchId, userId, licenseId, now, sortname) {
    // sortname is now passed as parameter to avoid duplicate tax creation

    const supplierData = {
      branch_id: branchId,
      branch_name: data.register_companyname.trim(),
      name: 'General Supplier',
      email: '',
      phone: '',
      address: '',
      sortname: sortname,
      country: data.register_country.trim(),
      country_id: data.register_countryid,
      state: data.register_state.trim(),
      city: '',
      gst: 'disable',
      gst_number: '',
      gst_type: 'consumer',
      created_date: now,
      updated_date: now,
      created_by: data.register_username,
      created_by_id: userId,
      updated_by: data.register_username,
      updated_by_id: userId,
      license: licenseId,
    };

    return await this.repository.insertSupplier(supplierData);
  }

  async _createDefaultUnit(data, branchId, userId, licenseId, now) {
    const unitData = {
      branch_id: branchId,
      branch_name: data.register_companyname.trim(),
      name: 'Quantity',
      value: 'qty',
      created_date: now,
      created_by: data.register_username,
      created_by_id: userId,
      updated_date: now,
      updated_by: data.register_username,
      updated_by_id: userId,
      license: licenseId,
    };

    return await this.repository.insertUnit(unitData);
  }

  async _updateBranchDefaults(branchId, licenseId, userId, data, customerId, supplierId, taxId) {
    await this.repository.updateBranch(branchId, licenseId, {
      default_customer: customerId,
      default_supplier: supplierId,
      default_tax: taxId || '',
      created_by: data.register_username,
      created_by_id: userId,
      updated_by: data.register_username,
      updated_by_id: userId,
    });
  }

  async _addBranchEmailFields(branchId, licenseId, data) {
    const emailData = {
      branch_id: branchId,
      email_address: [{ email: data.register_useremail }],
      report_type: 'daily',
      send_mail: 'mail_off',
    };

    await this.repository.addBranchEmailFields(branchId, licenseId, emailData);
  }

  async _insertBusinessTypeDemoData(params) {
    try {
      const {
        branchId,
        branchName,
        userId,
        username,
        licenseId,
        now,
        userBranch,
        supplierId,
        supplierName,
        taxId,
        taxData,
        unitId,
        businessType,
      } = params;

      // Load demo data based on business type
      const { getDemoDataByType } = require('../../utils/demoData');
      const demoData = getDemoDataByType(businessType);

      if (!demoData) {
        console.error('❌ Invalid business type:', businessType);
        // Fall back to default data
        return await this._insertDefaultCategoryAndItem(params);
      }

      console.log(`✅ Loading ${businessType} demo data with ${demoData.products.length} products`);
      console.log(
        `📂 Categories to insert:`,
        demoData.categories.map((c) => c.name)
      );

      // Insert categories
      const categoryMultiData = demoData.categories.map((cat) => ({
        name: cat.name,
        discount_percentage: 0.0,
        discount_amount: 0,
        description: cat.description || '',
        branch_id: branchId,
        branch_name: branchName,
        created_date: now,
        created_by: username,
        created_by_id: userId,
        updated_date: now,
        updated_by: username,
        updated_by_id: username,
        license: licenseId,
      }));

      const insertedCategoryIds = await this.repository.insertCategories(categoryMultiData);
      console.log(`📝 Inserted ${insertedCategoryIds.length} category IDs:`, insertedCategoryIds);

      // Get inserted categories
      const categories = await this.repository.findCategoriesByIds(insertedCategoryIds, licenseId);
      console.log(`📋 Retrieved ${categories.length} categories from DB`);

      const categoryMap = {};
      categories.forEach((cat) => {
        categoryMap[cat.name] = { id: cat._id, name: cat.name };
      });

      // Insert items/products
      const itemMultiData = [];

      for (const product of demoData.products) {
        const category = categoryMap[product.category];
        if (category) {
          const price = parseFloat(product.price);
          itemMultiData.push({
            name: product.name,
            category_id: category.id,
            category_name: category.name,
            branch_id: branchId,
            branch_name: branchName,
            license: licenseId,
            date: now,
            item_status: 'regular',
            itemid: '',
            barcode_id: '',
            created_date: now,
            created_by: username,
            created_by_id: userId,
            branch_access: userBranch,
            supplier_id: supplierId,
            supplier_name: supplierName,
            discount_percentage: 0.0,
            discount_amount: 0,
            hsncode: '0',
            hsndescription: '',
            tax_method: 'default',
            tax_name: taxData ? taxData.name : '',
            tax_id: taxId,
            tax: taxData ? taxData.rate : 0,
            tax_type: 'inclusive',
            tax_fields: taxId
              ? [
                  {
                    tax_id: taxId,
                    tax_name: taxData.name,
                    tax_value: taxData.rate,
                  },
                ]
              : [],
            mrp_price: price,
            company_price: price * 0.7, // 30% margin
            selling_price: price,
            items_mfg_date: null,
            items_expiry_date: null,
            available_quantity: parseInt(product.stock),
            image: 'item.svg',
            multi_image: [],
            sort_order: 1,
            description: `${product.name} - ${product.unit}`,
            track_inventory: true,
            sales_channel: true,
            ecommerce: false,
            updated_date: now,
            updated_by: username,
            updated_by_id: username,
            unit: product.unit || 'qty',
            unit_id: unitId,
          });
        }
      }

      console.log(`🔄 Attempting to insert ${itemMultiData.length} products...`);
      await this.repository.insertItems(itemMultiData);
      console.log(
        `✅ Successfully inserted ${itemMultiData.length} demo products for ${businessType} business`
      );
    } catch (error) {
      console.error('Error in _insertBusinessTypeDemoData:', error);
      // Don't throw error, just log it - installation can continue without demo data
    }
  }

  async _insertDemoData(params) {
    try {
      const {
        branchId,
        branchName,
        userId,
        username,
        licenseId,
        now,
        userBranch,
        supplierId,
        supplierName,
        taxId,
        taxData,
        unitId,
      } = params;

      // Load demo data
      const installDocuments = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../json/install_documents.json'), 'utf8')
      );

      // Insert categories
      const categoryMultiData = installDocuments.documents[0].categories.map((cat) => ({
        name: cat.name,
        discount_percentage: 0.0,
        discount_amount: 0,
        description: cat.description,
        image: cat.image,
        branch_id: branchId,
        branch_name: branchName,
        created_date: now,
        created_by: username,
        created_by_id: userId,
        updated_date: now,
        updated_by: username,
        updated_by_id: username,
        license: licenseId,
      }));

      const insertedCategoryIds = await this.repository.insertCategories(categoryMultiData);

      // Get inserted categories
      const categories = await this.repository.findCategoriesByIds(insertedCategoryIds, licenseId);

      const categoryMap = {};
      categories.forEach((cat) => {
        categoryMap[cat.name] = { id: cat._id, name: cat.name };
      });

      // Insert items
      const itemMultiData = [];

      for (const itemValue of installDocuments.documents[0].items) {
        const category = categoryMap[itemValue.category_name];
        if (category) {
          itemMultiData.push({
            name: itemValue.name,
            category_id: category.id,
            category_name: category.name,
            branch_id: branchId,
            branch_name: branchName,
            license: licenseId,
            date: now,
            item_status: 'regular',
            itemid: '',
            barcode_id: '',
            created_date: now,
            created_by: username,
            created_by_id: userId,
            branch_access: userBranch,
            supplier_id: supplierId,
            supplier_name: supplierName,
            discount_percentage: 0.0,
            discount_amount: 0,
            hsncode: '0',
            hsndescription: '',
            tax_method: 'default',
            tax_name: taxData ? taxData.name : '',
            tax_id: taxId,
            tax: taxData ? taxData.rate : 0,
            tax_type: 'inclusive',
            tax_fields: taxId
              ? [
                  {
                    tax_id: taxId,
                    tax_name: taxData.name,
                    tax_value: taxData.rate,
                  },
                ]
              : [],
            mrp_price: parseFloat(itemValue.mrp_price),
            company_price: parseFloat(itemValue.company_price),
            selling_price: parseFloat(itemValue.selling_price),
            items_mfg_date: null,
            items_expiry_date: null,
            available_quantity: parseInt(itemValue.available_quantity),
            image: itemValue.image,
            multi_image: [],
            sort_order: parseInt(itemValue.sort_order),
            description: itemValue.description,
            track_inventory: true,
            sales_channel: true,
            ecommerce: false,
            updated_date: now,
            updated_by: username,
            updated_by_id: username,
            unit: 'qty',
            unit_id: unitId,
          });
        }
      }

      await this.repository.insertItems(itemMultiData);
    } catch (error) {
      console.error('Error in _insertDemoData:', error);
      // Don't throw error, just log it - installation can continue without demo data
    }
  }

  async _insertDefaultCategoryAndItem(params) {
    try {
      const {
        branchId,
        branchName,
        userId,
        username,
        licenseId,
        now,
        userBranch,
        supplierId,
        supplierName,
        taxId,
        taxData,
        unitId,
      } = params;

      // Insert default category
      const categoryData = {
        name: 'Supermarkets',
        discount_percentage: 0.0,
        discount_amount: 0,
        description:
          'A supermarket is a self-service shop offering a wide variety of food, beverages and household products, organized into sections. This kind of store is larger and has a wider selection than earlier grocery stores, but is smaller and more limited in the range of merchandise than a hypermarket or big-box market',
        branch_id: branchId,
        branch_name: branchName,
        image:
          'https://prod-upload-pro.s3.ap-south-1.amazonaws.com/2024-05-30-07-54-46-posnic_category-665830c6dbbdd9.83743128.png',
        created_date: now,
        created_by: username,
        created_by_id: userId,
        updated_date: now,
        updated_by: username,
        updated_by_id: username,
        license: licenseId,
      };

      const categoryId = await this.repository.insertCategory(categoryData);

      // Insert default item
      const itemData = {
        branch_id: branchId,
        branch_name: branchName,
        category_id: categoryId,
        license: licenseId,
        date: now,
        item_status: 'regular',
        itemid: '',
        barcode_id: '',
        created_date: now,
        created_by: username,
        created_by_id: userId,
        branch_access: userBranch,
        category_name: 'Supermarkets',
        supplier_id: supplierId,
        supplier_name: supplierName,
        discount_percentage: 0.0,
        discount_amount: 0,
        hsncode: '0',
        hsndescription: '',
        tax_method: 'default',
        tax_name: taxData ? taxData.name : '',
        tax_id: taxId,
        tax: taxData ? taxData.rate : 0,
        tax_type: 'inclusive',
        tax_fields: taxId
          ? [
              {
                tax_id: taxId,
                tax_name: taxData.name,
                tax_value: taxData.rate,
              },
            ]
          : [],
        mrp_price: 190.0,
        company_price: 130.0,
        selling_price: 138.0,
        items_mfg_date: null,
        items_expiry_date: null,
        available_quantity: 100,
        image:
          'https://prod-upload-pro.s3.ap-south-1.amazonaws.com/2024-05-28-14-14-19-posnic_item_image-6655e6bb4a8f63.57072679.jpg',
        multi_image: [],
        sort_order: 1,
        description:
          'Fortune Sunlite Oil is refined sunflower oil that is healthy and tasty. Its high boiling point implies that sunflower oil holds onto its nutritional content even at higher temperatures, making it an excellent choice for the Indian cooking style.',
        track_inventory: true,
        sales_channel: true,
        ecommerce: false,
        name: 'Fortune Sunlite Refined Sunflower Oil 1L',
        updated_date: now,
        updated_by: username,
        updated_by_id: username,
        unit: 'qty',
        unit_id: unitId,
      };

      await this.repository.insertItem(itemData);
    } catch (error) {
      console.error('Error in _insertDefaultCategoryAndItem:', error);
      // Don't throw error, just log it - installation can continue without default data
    }
  }

  /**
   * Setup MongoDB authentication and secure the database
   * @param {string} dbUsername - MongoDB admin username
   * @param {string} dbPassword - MongoDB admin password
   * @returns {Promise<boolean>}
   */
  async _setupMongoDBAuth(dbUsername, dbPassword) {
    try {
      console.log('🔐 Starting MongoDB authentication setup...');

      const { MongoClient } = require('mongodb');
      const path = require('path');
      const fs = require('fs');

      const dbName = process.env.DB_NAME || 'PosnicPro';
      let client;
      let adminDb;
      let connected = false;

      // Strategy 1: Try to connect WITH the provided credentials (user already exists)
      const authUri = `mongodb://${dbUsername}:${encodeURIComponent(dbPassword)}@localhost:${process.env.POSNIC_MONGO_PORT || 47017}/admin?authSource=admin`;

      try {
        console.log('📡 Strategy 1: Connect with provided credentials...');
        client = new MongoClient(authUri, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        adminDb = client.db('admin');
        console.log('✅ Connected with provided credentials');
        connected = true;
      } catch (authError) {
        console.log('⚠️ Strategy 1 failed:', authError.message);
      }

      // Strategy 2: If not connected, try unauthenticated (MongoDB without auth)
      if (!connected) {
        try {
          console.log('📡 Strategy 2: Connect without authentication...');
          const unauthUri = `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}`;
          client = new MongoClient(unauthUri, { serverSelectionTimeoutMS: 5000 });
          await client.connect();
          adminDb = client.db('admin');
          // Verify by listing collections (auth check)
          await adminDb.listCollections().toArray();
          console.log('✅ Connected without authentication');
          connected = true;
        } catch (unauthError) {
          console.log('⚠️ Strategy 2 failed:', unauthError.message);
          if (client) {
            try {
              await client.close();
            } catch (e) {}
          }
        }
      }

      // Strategy 3: If still not connected, try existing credentials from file
      if (!connected) {
        const fs = require('fs');
        const path = require('path');
        const possibleCredFiles = [];

        // Try userData path (for packaged Electron app)
        try {
          const electron = require('electron');
          const electronApp = electron.app || (electron.remote && electron.remote.app);
          if (electronApp) {
            possibleCredFiles.push(
              path.join(electronApp.getPath('userData'), '.mongodb-credentials.json')
            );
          }
        } catch (e) {}

        // Add common locations
        possibleCredFiles.push(path.join(process.cwd(), '.mongodb-credentials.json'));
        possibleCredFiles.push(path.join(process.cwd(), '..', '.mongodb-credentials.json'));

        for (const credFile of possibleCredFiles) {
          if (!fs.existsSync(credFile)) continue;

          try {
            const existingCreds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
            if (!existingCreds.uri) continue;

            console.log('📡 Strategy 3: Connect with existing credentials from:', credFile);
            client = new MongoClient(existingCreds.uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            adminDb = client.db('admin');
            await adminDb.listCollections().toArray();
            console.log('✅ Connected with existing credentials');
            connected = true;
            break;
          } catch (e) {
            console.log('⚠️ Failed with credentials from', credFile, ':', e.message);
            if (client) {
              try {
                await client.close();
              } catch (closeErr) {}
            }
          }
        }
      }

      if (!connected) {
        throw new Error(
          'Cannot connect to MongoDB with any credentials. Please reset MongoDB or delete credentials file.'
        );
      }

      // Now create or update the admin user
      try {
        await adminDb.command({
          createUser: dbUsername,
          pwd: dbPassword,
          roles: [
            { role: 'root', db: 'admin' },
            { role: 'dbOwner', db: dbName },
          ],
        });
        console.log(`✅ Created MongoDB admin user: ${dbUsername}`);
      } catch (userError) {
        if (userError.message.includes('already exists') || userError.code === 51003) {
          // Update existing user password
          await adminDb.command({
            updateUser: dbUsername,
            pwd: dbPassword,
            roles: [
              { role: 'root', db: 'admin' },
              { role: 'dbOwner', db: dbName },
            ],
          });
          console.log(`📝 Updated MongoDB admin user password: ${dbUsername}`);
        } else {
          throw userError;
        }
      }

      await client.close();

      // Save credentials to .env file
      await this._saveDBCredentialsToEnv(dbUsername, dbPassword);

      // Enable authentication in mongod.cfg (if exists)
      await this._enableMongoDBAuth();

      // Reconnect mongoose with authenticated URI for subsequent operations
      const mongoose = require('mongoose');
      const newUri = `mongodb://${dbUsername}:${encodeURIComponent(dbPassword)}@localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro?authSource=admin`;

      if (mongoose.connection.readyState !== 0) {
        console.log('🔄 Reconnecting mongoose with authenticated connection...');
        await mongoose.connection.close();
        await mongoose.connect(newUri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 30000,
          connectTimeoutMS: 10000,
        });
        console.log('✅ Mongoose reconnected with authentication');
      }

      // Also update BaseModel connection (native MongoDB driver)
      const BaseModel = require('../models/base.model');
      if (BaseModel.mongoClient) {
        console.log('🔄 Reconnecting BaseModel with authenticated connection...');
        await BaseModel.mongoClient.close();
        const { MongoClient } = require('mongodb');
        BaseModel.mongoClient = await MongoClient.connect(newUri);
        BaseModel.database = BaseModel.mongoClient.db('PosnicPro');
        console.log('✅ BaseModel reconnected with authentication');
      }

      console.log('✅ MongoDB authentication setup complete');
      return true;
    } catch (error) {
      console.error('❌ Error setting up MongoDB authentication:', error.message);
      // Re-throw error so installation can handle it properly
      throw new Error(`MongoDB authentication setup failed: ${error.message}`, {
        cause: error,
      });
    }
  }

  /**
   * Save database credentials to .env file
   * @param {string} dbUsername - MongoDB admin username
   * @param {string} dbPassword - MongoDB admin password
   * @returns {Promise<boolean>}
   */
  async _saveDBCredentialsToEnv(dbUsername, dbPassword) {
    try {
      const path = require('path');
      const fs = require('fs');

      /*
       * Where the database credentials go, and where they must never go.
       *
       * This searched a list of candidates that began with process.cwd(), and
       * accepted the first whose directory existed - which the current
       * directory always does. So the credentials landed wherever the
       * application happened to be launched from. On Windows that is usually
       * the install folder and nobody noticed; on Linux a shop starting it
       * from a terminal got
       *
       *   /home/sridhar/Downloads/.env
       *   /home/sridhar/Downloads/.mongodb-credentials.json
       *
       * next to the installer they had just downloaded. A folder people share,
       * sync and hand around, holding the credentials to their own database.
       *
       * The user data directory is the only correct answer: it is per-user,
       * outside anything synced by accident, and it is already where the
       * database, the backups and the update config live. The old candidates
       * are kept only as a fallback for running outside Electron - the API
       * suite does that - and cwd is no longer among them.
       */
      let envPath = null;
      try {
        const electron = require('electron');
        const electronApp = electron.app || (electron.remote && electron.remote.app);
        if (electronApp) envPath = path.join(electronApp.getPath('userData'), '.env');
      } catch (e) {
        /* Not running inside Electron - fall through. */
      }

      if (!envPath) {
        /* Beside the API itself, which is inside the installation rather than
           wherever a terminal happened to be pointing. */
        envPath = path.join(__dirname, '../../.env');
      }

      console.log('📝 Saving credentials to:', envPath);

      let envContent = '';

      // Read existing .env if it exists
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        // Remove old DB credentials
        envContent = envContent
          .split('\n')
          .filter((line) => !line.startsWith('MONGODB_URI=') && !line.startsWith('MONGODB_USER='))
          .join('\n');
      }

      /*
       * The password does not go in here.
       *
       * This used to write the whole connection string, password included, into
       * a plain .env alongside the encrypted credentials file - which would have
       * made encrypting the other copy pointless. A secret written twice is only
       * as protected as its weakest copy.
       *
       * What stays is the username and a credential-free URI, so anything
       * reading .env still learns the host, port and database. The password
       * comes from .mongodb-credentials.json through credentials-store, and
       * server.js assigns the real URI to process.env.MONGODB_URI at startup -
       * after dotenv has run, so the assignment wins.
       */
      const host = `localhost:${process.env.POSNIC_MONGO_PORT || 47017}`;

      /* The real one. Needed in memory - the running session connects with it,
         and credentials-store keeps its host, port and database while dropping
         the password - but never written to .env. */
      const newUri = `mongodb://${dbUsername}:${encodeURIComponent(dbPassword)}@${host}/PosnicPro?authSource=admin`;

      /* What .env gets: everything except the credentials. */
      const publicUri = `mongodb://${host}/PosnicPro?authSource=admin`;

      envContent += `\n# MongoDB connection (auto-generated during installation)\n`;
      envContent += `# The password is NOT stored here. It lives encrypted in\n`;
      envContent += `# .mongodb-credentials.json and is read at startup.\n`;
      envContent += `MONGODB_URI=${publicUri}\n`;
      envContent += `MONGODB_USER=${dbUsername}\n`;

      fs.writeFileSync(envPath, envContent.trim());
      console.log('✅ Database connection saved to .env (without the password)');

      // Also save to a credentials file for the Electron app to read
      // In packaged Electron app, save to userData folder (writable)
      const credentials = {
        username: dbUsername,
        password: dbPassword,
        uri: newUri,
        created: new Date().toISOString(),
      };

      const savePaths = [];

      // Try to get Electron userData path (preferred for packaged builds)
      try {
        const electron = require('electron');
        const electronApp = electron.app || (electron.remote && electron.remote.app);
        if (electronApp) {
          const userDataPath = electronApp.getPath('userData');
          savePaths.push(path.join(userDataPath, '.mongodb-credentials.json'));
        }
      } catch (e) {
        // Electron not available - running standalone
      }

      // Fallback to envPath directory
      savePaths.push(path.join(path.dirname(envPath), '.mongodb-credentials.json'));

      /*
       * Written through credentials-store, which encrypts the password with a
       * per-install key and leaves the username readable. This used to write
       * the password, and a connection string containing it, as plain text -
       * so `type` showed it and any copy of the folder carried it.
       *
       * The store is at the repository root because setup-mongodb.js and
       * main.js read it too, and nine call sites each doing their own
       * JSON.parse is how a migration goes wrong in one of them.
       */
      try {
        const store = require(path.join(__dirname, '..', '..', '..', 'credentials-store'));
        const keyDir = path.dirname(savePaths[0]);
        const written = store.write(savePaths, credentials, keyDir);
        for (const file of written) console.log('✅ Credentials saved (encrypted) to:', file);
        if (written.length === 0) {
          throw new Error('no credential path was writable');
        }
      } catch (storeErr) {
        /*
         * Falling back to plain text is the wrong trade only if it is silent.
         * A till that cannot save its database password cannot start next
         * time, which is worse than a password on disk that this build already
         * wrote in the clear yesterday. It is loud, and the next successful
         * save encrypts it.
         */
        console.warn('⚠️ Could not save encrypted credentials:', storeErr.message);
        console.warn('⚠️ Falling back to plain text - this will be re-encrypted on the next save');
        for (const credPath of savePaths) {
          try {
            const credDir = path.dirname(credPath);
            if (!fs.existsSync(credDir)) {
              fs.mkdirSync(credDir, { recursive: true });
            }
            fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2));
            console.log('✅ Credentials saved to:', credPath);
          } catch (writeErr) {
            console.warn('⚠️ Could not write to:', credPath, writeErr.message);
          }
        }
      }

      // Update process.env for current session
      process.env.MONGODB_URI = newUri;
      process.env.MONGODB_USER = dbUsername;

      return true;
    } catch (error) {
      console.error('❌ Error saving credentials:', error.message);
      return false;
    }
  }

  /**
   * Enable authentication in MongoDB config file
   * @returns {Promise<boolean>}
   */
  async _enableMongoDBAuth() {
    try {
      const fs = require('fs');
      const path = require('path');

      // Common MongoDB config file locations
      const possibleConfigPaths = [
        'D:\\installer\\mongodb\\mongod.cfg',
        'C:\\Program Files\\MongoDB\\Server\\mongod.cfg',
        path.join(process.cwd(), 'mongodb', 'mongod.cfg'),
        '/etc/mongod.conf',
        '/usr/local/etc/mongod.conf',
      ];

      let configPath = null;
      for (const p of possibleConfigPaths) {
        if (fs.existsSync(p)) {
          configPath = p;
          break;
        }
      }

      if (!configPath) {
        console.log('⚠️ MongoDB config file not found. Skipping config update.');
        return false;
      }

      console.log('📝 Updating MongoDB config:', configPath);

      let config = fs.readFileSync(configPath, 'utf8');

      // Check if authorization is already enabled
      if (config.includes('authorization: enabled')) {
        console.log('✅ MongoDB authentication already enabled in config');
        return true;
      }

      // Add authorization section
      if (config.includes('security:')) {
        // Update existing security section
        config = config.replace(/security:\s*\n/, 'security:\n  authorization: enabled\n');
      } else {
        // Add new security section
        config += '\n# Security settings - Added by Posnic installation\n';
        config += 'security:\n';
        config += '  authorization: enabled\n';
      }

      fs.writeFileSync(configPath, config);
      console.log('✅ MongoDB authentication enabled in config file');

      return true;
    } catch (error) {
      console.error('❌ Error enabling MongoDB auth in config:', error.message);
      return false;
    }
  }
}

module.exports = InstallService;
