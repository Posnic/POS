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
      /*
       * Speak the provisioner's language before anything reads this.
       *
       * Gateway sends `register_demo: 'yes'` and `business: 'retail'`
       * (apps/provisioner/provision.js). This service tested for `'on'` and
       * read `businessType`, so BOTH missed: every cloud shop was created
       * with no demo data at all and, had it run, always the supermarket pack
       * regardless of trade.
       *
       * It failed silently because each miss has a plausible-looking result.
       * No demo data reads as a shop that asked for none; a supermarket pack
       * reads as a default somebody chose. What it actually meant was a new
       * customer opening their till and finding one product in it.
       *
       * Normalised here, at the entry point, so every path below sees one
       * shape - sanitizeInstallData in the helpers looks like the place for
       * this but nothing calls it, and adding a second reader would be one
       * more thing to keep in step. Fixed on the reading side rather than in
       * Gateway, which is mid-flight for live signups.
       */
      data = {
        ...data,
        register_demo: ['yes', 'on', 'true', '1', 'y', 'true'].includes(
          String(data.register_demo == null ? '' : data.register_demo)
            .trim()
            .toLowerCase()
        ),
        businessType: String(data.businessType || data.business || '').trim(),
      };
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

      if (data.register_demo === true || data.register_demo === 'on') {
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
          currencyCode: (
            this._currencyForCountry(data.register_country, data.register_currency)
              .currency_value[0] || {}
          ).currency_text,
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

  /*
   * Day-first or month-first, from the shop's country. Only a handful of
   * places read dates month-first (the US and the territories that follow
   * it); everywhere else on the till's map reads day-first, which is also
   * the long-standing default. register_dateformat ('mdy'/'dmy') is the
   * onboarding override and wins when present.
   */
  _dateFormatForCountry(countryName, explicit) {
    const MDY = {
      client: 'mm/dd/yyyy',
      server: 'm/d/Y',
      text: '01/31/2018 -- mm/dd/yyyy',
    };
    const DMY = {
      client: DEFAULTS.CLIENT_DATEFORMAT,
      server: DEFAULTS.SERVER_DATEFORMAT,
      text: DEFAULTS.DATEFORMAT_TEXT,
    };
    const choice = String(explicit || '')
      .trim()
      .toLowerCase();
    if (choice === 'mdy') return MDY;
    if (choice === 'dmy') return DMY;
    const MDY_COUNTRIES = ['US', 'PH', 'FM', 'MH', 'PW', 'GU', 'AS', 'VI', 'PR', 'UM'];
    try {
      const name = String(countryName || '')
        .trim()
        .toLowerCase();
      if (!name) return DMY;
      const countries =
        JSON.parse(fs.readFileSync(path.join(__dirname, '../json/countries.json'), 'utf8'))
          .countries || [];
      const country = countries.find(
        (c) =>
          String(c.value || '')
            .trim()
            .toLowerCase() === name
      );
      if (country && MDY_COUNTRIES.includes(String(country.sortname).toUpperCase())) return MDY;
    } catch (e) {
      /* unknown stays day-first */
    }
    return DMY;
  }

  /*
   * The shop's own money, not ours: currency used to be hardcoded to INR
   * whatever country was chosen at install (a US shop opened priced in ₹).
   *
   * Resolution is by ISO CODE, not by name. The first fix here matched
   * currency.json entries by country-name prefix, and an audit against the
   * full country list showed 73 of 246 countries fell straight through to
   * the INR fallback - "United Arab Emirates" had no matching entry at all,
   * so a Dubai signup opened priced in ₹. Now: the country's ISO code
   * (countries.json sortname) looks up its ISO-4217 code in
   * country_currency.json, and currency.json supplies that code's symbol.
   * The old name-prefix match stays as the second attempt so any country
   * missing from the ISO table behaves exactly as before, and no match at
   * all still keeps the INR default.
   *
   * explicitCode (register_currency) wins over everything: it is the shop
   * owner's own onboarding choice, e.g. a USD-priced shop in the Emirates.
   */
  _currencyForCountry(countryName, explicitCode) {
    const fallback = {
      currency: DEFAULTS.CURRENCY,
      currency_text: DEFAULTS.CURRENCY_TEXT,
      currency_type: DEFAULTS.CURRENCY_TYPE,
      currency_value: [{ currency_text: 'INR', currency_sign: '₹' }],
    };
    const name = String(countryName || '')
      .trim()
      .toLowerCase();
    try {
      const raw = fs.readFileSync(path.join(__dirname, '../json/currency.json'), 'utf8');
      const list = (JSON.parse(raw).currency || []).filter((c) => c && c.value);
      const asResult = (hit) => ({
        currency: hit.symbol,
        currency_text: hit.value.trim(),
        currency_type: hit.symbol,
        currency_value: [{ currency_text: hit.text, currency_sign: hit.symbol }],
      });

      const wanted = String(explicitCode || '')
        .trim()
        .toUpperCase();
      if (wanted) {
        const chosen = list.find((c) => c.text === wanted && c.symbol);
        if (chosen) return asResult(chosen);
      }
      if (!name) return fallback;

      const countries =
        JSON.parse(fs.readFileSync(path.join(__dirname, '../json/countries.json'), 'utf8'))
          .countries || [];
      const country = countries.find(
        (c) =>
          String(c.value || '')
            .trim()
            .toLowerCase() === name
      );
      if (country && country.sortname) {
        const codes = JSON.parse(
          fs.readFileSync(path.join(__dirname, '../json/country_currency.json'), 'utf8')
        );
        const code = codes[String(country.sortname).toUpperCase()];
        const hit = code && list.find((c) => c.text === code && c.symbol);
        if (hit) return asResult(hit);
      }

      const prefixHit = list.find((c) =>
        c.value
          .trim()
          .toLowerCase()
          .startsWith(name + ' ')
      );
      if (!prefixHit || !prefixHit.symbol || !prefixHit.text) return fallback;
      return asResult(prefixHit);
    } catch (e) {
      return fallback;
    }
  }

  async _createBranch(data, licenseId, userId, now, regularBodyPrint, thermalBodyPrint) {
    const money = this._currencyForCountry(data.register_country, data.register_currency);
    const dateFmt = this._dateFormatForCountry(data.register_country, data.register_dateformat);
    const branchData = {
      theme: DEFAULTS.THEME,
      branch_name: data.register_companyname.trim(),
      store_address: (data.register_address || '').trim(),
      store_email: data.register_useremail.trim(),
      store_telephone: (data.register_fullnumber || '').trim(),
      country: (data.register_country || '').trim(),
      country_id: data.register_countryid || '',
      state: (data.register_state || '').trim(),
      city: (data.register_city || '').trim(),
      pincode: '',
      website: '',
      logo: DEFAULTS.LOGO,
      languge: '',
      indian_gst: DEFAULTS.INDIAN_GST,
      branch_gstin_number: '',
      currency: money.currency,
      currency_text: money.currency_text,
      currency_type: money.currency_type,
      currency_value: money.currency_value,
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
      client_dateformat: dateFmt.client,
      time_format: 'enable',
      server_dateformat: dateFmt.server,
      dateformat_text: dateFmt.text,
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

  /*
   * The features a new shop starts with, written down rather than inferred.
   *
   * Owner ask, repeated: "for new customer sign up i see so many features
   * enabled... by default enable only Recycle bin, Themes, Tax only."
   *
   * WHY IT LOOKED LIKE EVERYTHING WAS ON. Nothing was ever switched on. The
   * client reads `settings[key] !== false` (PosnicPro.js), so a key that was
   * never saved reads as enabled - and a brand-new shop has none of them
   * saved. Ten features appeared switched on because ten features were
   * absent, which is not a decision anybody made.
   *
   * WHY THE RULE ITSELF IS NOT CHANGED. Every shop already running relies on
   * absent-meaning-on. Flipping that reading would switch features off in
   * every existing shop on the next deploy - silently, and with no way for
   * them to know what they had lost. So the fix is to WRITE the values for
   * new shops, and leave the reading alone.
   *
   * The three that are on are the three that cost nothing to have and are
   * awkward to discover you needed: a delete you can undo, a look you can
   * change, and tax - which a shop either needs from its first sale or does
   * not need at all. Everything else is switched on by the shop when it wants
   * it, which is also when the menu entry will mean something to them.
   */
  static newShopModuleDefaults({ demoData = false } = {}) {
    return {
      /* The four a shop needs before it has decided anything.
         Owner's list: Themes, Demo Data, Tax, Quick Sale. */
      module_themes_enable: true,
      module_tax_enable: true,
      quick_sale_enable: true,
      /*
       * Only if they actually asked for sample data during setup. Switching it
       * on for a shop that chose an empty catalogue would be a switch that
       * hides nothing, sitting in the menu inviting a question.
       */
      module_demo_data_enable: demoData === true,

      module_recyclebin_enable: false,
      module_credit_enable: false,
      module_marketing_enable: false,
      module_messaging_enable: false,
      module_channels_enable: false,
      module_channels_kiosk_enable: false,
      module_cashbook_enable: false,

      /*
       * These four were missed the first time round, and the miss was silent.
       *
       * "Remaining keep switched off" means every module, and each of these is
       * a module with a menu entry. But absent reads as ON, so leaving them out
       * of this list is not "not deciding" - it is deciding ON, in exactly the
       * way that produced the complaint this function exists to answer. A new
       * shop was still opening with Quotes, Cash register, Shifts and Roster
       * in its menu.
       *
       * Found by a test that compares this list against the backfill's, which
       * is the only thing connecting the two. Neither list looked wrong on its
       * own.
       */
      quotes_enable: false,
      cash_register_enable: false,
      staff_shifts_enable: false,
      staff_roster_enable: false,
    };
  }

  async _updateBranchDefaults(branchId, licenseId, userId, data, customerId, supplierId, taxId) {
    /* register_demo was normalised to a boolean at the entry point. */
    const demoData = data.register_demo === true;
    await this.repository.updateBranch(branchId, licenseId, {
      default_customer: customerId,
      default_supplier: supplierId,
      default_tax: taxId || '',
      ...InstallService.newShopModuleDefaults({ demoData }),
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

  /*
   * Put the demo data back.
   *
   * Owner ask: "when demo data enabled again. we can do insert data by
   * progress bar."
   *
   * Switching Demo Data off only hides, so most of the time turning it back on
   * needs nothing at all - the rows are still there and the filter simply stops
   * applying. This is for the other case: a shop that removed the samples for
   * good and later wants them back, which otherwise leaves the switch looking
   * broken because turning it on brings nothing.
   *
   * Everything the installer needs is read back off the branch rather than
   * passed in. The caller is a shopkeeper pressing a switch months later; they
   * have no idea what tax id or unit their shop was built with, and asking the
   * browser to supply them would be inviting it to make them up.
   *
   * Refuses when demo data is already present. Seeding twice would give a shop
   * two of every sample with no way to tell which pair to delete.
   */
  async reseedDemoData({ branchId, licenseId, user, businessType: wanted } = {}) {
    try {
      if (!branchId || !licenseId) {
        return { status: false, data: null, message: 'Branch and licence are required.' };
      }

      /*
       * An explicit choice is CHECKED, not coerced.
       *
       * getDemoDataByType falls back to the supermarket set for anything it
       * does not recognise, which is the right answer for a trade somebody
       * typed into a signup form. It is the wrong answer here: this argument
       * comes from a list the shop was shown, so a key that is not on that
       * list is a bug on our side, and quietly installing groceries into a
       * bakery would be a wrong answer delivered confidently.
       */
      const { isDemoPack } = require('../../utils/demoData');
      const asked = String(wanted == null ? '' : wanted).trim();
      if (asked && !isDemoPack(asked)) {
        return { status: false, data: null, message: 'That is not a sample data pack.' };
      }

      const BaseModel = require('../models/base.model');
      const db = await BaseModel.getDb();
      const branchOid = new ObjectId(String(branchId));
      const licenseOid = new ObjectId(String(licenseId));

      const branch = await db
        .collection('branches')
        .findOne({ _id: branchOid, license: licenseOid });
      if (!branch) {
        return { status: false, data: null, message: 'Branch not found.' };
      }

      /*
       * An EXPLICIT trade choice replaces; only the bare toggle-on refuses.
       *
       * The chooser's flow is purge-then-seed, but the purge KEEPS samples
       * the shop has sold or edited - as promised. The old guard then saw
       * those survivors, said "the sample data is already here", and no shop
       * that had ever rung up a sample could swap trades or Reset again. The
       * owner hit exactly this and then read a refusal that told him to
       * flip a switch that was already on.
       *
       * So when a trade was ASKED FOR, the purge runs HERE, server-side -
       * idempotent, with every protection it always had - and the seed
       * proceeds regardless of protected survivors, which now simply belong
       * to the shop. The refusal remains only for the un-asked path (the
       * Demo Data toggle), whose job is to unhide, never to duplicate.
       */
      let keptNote = '';
      if (asked) {
        /* item.service exports the CLASS - a lesson this repo has already
           paid for once. */
        const ItemService = require('./item.service');
        const purge = await new ItemService().purgeDemoData({ branchId, licenseId, user });
        const kept = (purge && purge.data && purge.data.kept) || (purge && purge.kept) || [];
        if (kept.length) {
          keptNote =
            ' Kept ' +
            kept.length +
            ' record' +
            (kept.length === 1 ? '' : 's') +
            ' you have sold or edited.';
        }
      } else {
        const already = await db.collection('items').countDocuments(
          {
            demo_pack: { $exists: true },
            'branch_access.branch_id': branchOid,
            license: licenseOid,
            del_status: { $nin: [1, '1', true] },
          },
          { limit: 1 }
        );
        if (already) {
          return {
            status: false,
            data: null,
            message: 'The sample data is already here - switch Demo Data on to see it.',
          };
        }
      }

      /*
       * What was asked for; failing that, the trade this shop was set up as,
       * or what it was seeded with before. A shop that removed one pack should
       * get that pack back, not whatever the default happens to be today - but
       * a shop that has just PICKED a different trade must get the one it
       * picked, which is the whole point of the chooser.
       */
      const previous = await db
        .collection('items')
        .findOne(
          { demo_pack: { $exists: true }, license: licenseOid },
          { projection: { demo_pack: 1 } }
        );
      const businessType =
        asked ||
        (previous && previous.demo_pack) ||
        branch.business_type ||
        branch.businessType ||
        'supermarket';

      /* Whatever the shop already uses, so the samples join the shop rather
         than arriving with a second set of everything. */
      const supplier = await db
        .collection('suppliers')
        .findOne({ branch_id: branchOid, license: licenseOid });
      const unit = await db
        .collection('unit')
        .findOne({ branch_id: branchOid, license: licenseOid });
      const tax = await db
        .collection('grouptax')
        .findOne({ branch_id: branchOid, license: licenseOid });

      const now = new Date();
      /* The branch already knows its money; the dataset URL needs the code. */
      const currencyCode =
        (Array.isArray(branch.currency_value) && branch.currency_value[0]
          ? branch.currency_value[0].currency_text
          : null) ||
        (this._currencyForCountry(branch.country).currency_value[0] || {}).currency_text;
      await this._insertBusinessTypeDemoData({
        branchId: branchOid,
        branchName: String(branch.branch_name || '').trim(),
        userId: (user && (user._id || user.userId)) || null,
        username: (user && (user.name || user.username)) || 'System',
        licenseId: licenseOid,
        now,
        userBranch: [
          {
            branch_id: branchOid,
            branch_name: branch.branch_name,
            branch_image: DEFAULTS.LOGO,
          },
        ],
        supplierId: supplier ? supplier._id : null,
        supplierName: supplier ? supplier.name : 'General Supplier',
        taxId: tax ? tax._id : null,
        taxData: tax ? { name: tax.name, rate: tax.rate } : null,
        unitId: unit ? unit._id : null,
        businessType,
        currencyCode,
      });

      const counts = await Promise.all([
        db.collection('items').countDocuments({
          demo_pack: { $exists: true },
          'branch_access.branch_id': branchOid,
          license: licenseOid,
        }),
        db.collection('sales').countDocuments({
          demo_pack: { $exists: true },
          branch_id: branchOid,
          license: licenseOid,
        }),
        db.collection('quotes').countDocuments({
          demo_pack: { $exists: true },
          branch_id: branchOid,
          license: licenseOid,
        }),
        db.collection('receivings').countDocuments({
          demo_pack: { $exists: true },
          branch_id: branchOid,
          license: licenseOid,
        }),
      ]);

      /*
       * Turn the switch the CATALOGUE reads.
       *
       * Sample products are hidden from the item list whenever the Demo Data
       * feature is off, and that flag lives in the branch_features group -
       * not on the branch document. Seeding without setting it produced the
       * exact report this fixes: "item available but item list not showing.
       * when i do purchase with supplier all item its coming" - the products
       * were there, the list was told to hide them, and the purchase picker
       * (which never applied the rule) showed them anyway. Restoring sample
       * data plainly means the shop wants to see it.
       */
      try {
        const demo = require('./demo-data');
        await demo
          ._repo()
          .saveGroup('features', { module_demo_data_enable: true }, { licenseId, branchId });
        demo.invalidate(licenseId);
      } catch (e) {
        console.error('reseedDemoData: could not enable the Demo Data switch:', e.message);
      }

      return {
        status: true,
        data: {
          pack: businessType,
          items: counts[0],
          sales: counts[1],
          quotes: counts[2],
          purchases: counts[3],
        },
        message:
          `Sample data restored: ${counts[0]} products, ${counts[1]} sales, ` +
          `${counts[2]} quotes, ${counts[3]} purchases.` +
          keptNote,
      };
    } catch (error) {
      console.error('Error in InstallService.reseedDemoData:', error);
      return { status: false, data: null, message: error.message };
    }
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

      /*
       * The website's dataset first, the built-in packs as the floor.
       *
       * The zips carry what the built-ins never had - real cost prices, MRP,
       * opening stock, a photograph per product, per-currency pricing - and
       * the owner's instruction is that this one source feeds every door:
       * provisioning, the Demo Data page, and the features toggle. The floor
       * is load-bearing: provisioning a shop must never wait on posnic.com,
       * so every dataset failure quietly resolves to the packs that have
       * always shipped.
       */
      const demoDatasetSvc = require('./demo-dataset');
      let demoData = null;
      let packTag = businessType;
      const datasetPack = await demoDatasetSvc.loadDatasetPack({
        currency: params.currencyCode,
        businessType,
        uploadsRoot: path.join(__dirname, '../../uploads'),
      });
      if (datasetPack) {
        demoData = datasetPack;
        /* Tag rows with the CANONICAL trade key, not the typed-in vocabulary:
           the purge and the chooser's "current pack" both read this tag back. */
        packTag = demoDatasetSvc.datasetKeyFor(businessType) || businessType;
        console.log(
          `📦 Demo data from dataset ${datasetPack.datasetId} (${demoData.products.length} products)`
        );
      } else {
        const { getDemoDataByType } = require('../../utils/demoData');
        demoData = getDemoDataByType(businessType);
      }

      if (!demoData) {
        console.error('❌ Invalid business type:', businessType);
        // Fall back to default data
        return await this._insertDefaultCategoryAndItem(params);
      }

      console.log(
        `📂 Categories to insert:`,
        demoData.categories.map((c) => c.name)
      );

      // Insert categories
      const categoryMultiData = demoData.categories.map((cat) => ({
        /* Tagged like the items, or switching Demo Data off would leave a
           shop with empty categories it never made and cannot explain. */
        demo_pack: packTag,
        demo_seeded_at: now,
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

      /*
       * The units the samples actually SELL IN, in the shop's own master.
       *
       * Owner: "i see different unit products are created. but unit section
       * not created. when demo product created handle other master records
       * also properly created." The items carried the dataset's unit as a
       * bare string ('pcs', 'litre', 'set') while unit_id pointed every one
       * of them at the single default Quantity unit - so the Units screen
       * knew nothing about the units the catalogue was visibly using, and an
       * edited item's unit picker could not offer the unit it already had.
       *
       * Units the shop already owns are joined, never duplicated (matched by
       * value, which is the field the picker keys on); only the missing ones
       * are created, tagged demo like the categories so the purge can take
       * them away when nothing is measured in them any more.
       */
      const unitMap = {};
      try {
        const UNIT_LABELS = {
          qty: 'Quantity',
          pcs: 'Pieces',
          pc: 'Piece',
          kg: 'Kilogram',
          g: 'Gram',
          l: 'Litre',
          litre: 'Litre',
          ltr: 'Litre',
          ml: 'Millilitre',
          m: 'Metre',
          box: 'Box',
          pair: 'Pair',
          set: 'Set',
          pack: 'Pack',
          dozen: 'Dozen',
          roll: 'Roll',
          bag: 'Bag',
          bottle: 'Bottle',
          can: 'Can',
          tube: 'Tube',
          sheet: 'Sheet',
          plate: 'Plate',
          cup: 'Cup',
        };
        const existingUnits = await this.repository.findUnitsByBranch(branchId, licenseId);
        for (const u of existingUnits || []) {
          const v = String(u.value == null ? '' : u.value)
            .trim()
            .toLowerCase();
          if (v && !unitMap[v]) unitMap[v] = u._id;
        }
        const wantedUnits = new Set(
          demoData.products
            .map((p) =>
              String(p.unit == null || p.unit === '' ? 'qty' : p.unit)
                .trim()
                .toLowerCase()
            )
            .filter(Boolean)
        );
        for (const value of wantedUnits) {
          if (unitMap[value]) continue;
          const label = UNIT_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1);
          // eslint-disable-next-line no-await-in-loop
          unitMap[value] = await this.repository.insertUnit({
            demo_pack: packTag,
            demo_seeded_at: now,
            branch_id: branchId,
            branch_name: branchName,
            name: label,
            value,
            created_date: now,
            created_by: username,
            created_by_id: userId,
            updated_date: now,
            updated_by: username,
            updated_by_id: username,
            license: licenseId,
          });
        }
      } catch (e) {
        /* A shop with samples measured in Quantity is a working shop; the
           install must not fail over a nicety of the units master. */
        console.error('Demo units skipped:', e.message);
      }

      // Insert items/products
      const itemMultiData = [];

      for (const product of demoData.products) {
        const category = categoryMap[product.category];
        if (category) {
          const price = parseFloat(product.price);
          itemMultiData.push({
            /*
             * Tagged as demo, so the Demo Data switch can hide it later. The
             * tag travels with the record because a list of what was seeded
             * drifts the moment a shop edits or deletes one row.
             */
            demo_pack: packTag,
            demo_seeded_at: now,
            /*
             * The photograph, where there is one. Fifty-five of these products
             * have none - the search returned somebody's brand or the wrong
             * object entirely and those were turned down - and that is a
             * finished state: autoTile gives the item a coloured tile from its
             * own name, which reads better than a picture of the wrong thing.
             */
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
            mrp_price: Number(product.mrp) > 0 ? Number(product.mrp) : price,
            /* The dataset's real cost when it has one; the old invented 30%
               margin only for packs that carry no cost at all. */
            company_price:
              Number(product.cost_price) > 0 ? Number(product.cost_price) : price * 0.7,
            selling_price: price,
            items_mfg_date: null,
            items_expiry_date: null,
            available_quantity: parseInt(product.stock),
            /*
             * The photograph, or the placeholder that makes the till draw a
             * coloured tile instead.
             *
             * Set HERE rather than spread in above, because this key used to
             * sit below that spread and simply overwrote it - every demo item
             * went in with 'item.svg' whatever picture it had, and the sale
             * grid drew tiles for all of them. A later key in the same object
             * literal always wins, and nothing says so at the point it does.
             */
            image: product.image || 'item.svg',
            cover_image: product.image || '',
            multi_image: product.image ? [{ name: product.image, cover: 'yes' }] : [],
            sort_order: 1,
            description: product.description || `${product.name} - ${product.unit}`,
            track_inventory: product.track_inventory !== false,
            sales_channel: true,
            ecommerce: false,
            updated_date: now,
            updated_by: username,
            updated_by_id: username,
            /* The item's unit and unit_id AGREE now: both name the unit the
               dataset gave the product, freshly present in the units master.
               The passed-in default remains the floor if the master write
               above was skipped. */
            unit: String(product.unit == null || product.unit === '' ? 'qty' : product.unit)
              .trim()
              .toLowerCase(),
            unit_id:
              unitMap[
                String(product.unit == null || product.unit === '' ? 'qty' : product.unit)
                  .trim()
                  .toLowerCase()
              ] || unitId,
          });
        }
      }

      console.log(`🔄 Attempting to insert ${itemMultiData.length} products...`);
      await this.repository.insertItems(itemMultiData);

      /*
       * A catalogue on its own demonstrates nothing.
       *
       * Every report opens empty, the dashboard shows zero and the quote list
       * says there is nothing here - so the parts of the product somebody is
       * deciding about are exactly the parts they cannot see. A handful of
       * past sales and a few quotations fix that.
       *
       * Its own try/catch: a shop with products and no sample sales is a
       * working shop, and failing the install over demonstration data would
       * be the wrong trade.
       */
      try {
        await this._insertDemoActivity({
          branchId,
          branchName,
          licenseId,
          now,
          pack: businessType,
          items: itemMultiData,
          userName: username,
        });
      } catch (e) {
        console.error('Demo sales and quotes skipped:', e.message);
      }
    } catch (error) {
      console.error('Error in _insertBusinessTypeDemoData:', error);
      // Don't throw error, just log it - installation can continue without demo data
    }
  }

  /*
   * Sample sales and quotations, dated into the past.
   *
   * The shapes come from services/demo-seed.js, which explains why they are
   * dated before today: the shop's own takings must be the shop's own from the
   * first sale they ring up, or every figure they read in week one is wrong
   * with no way to tell which part is theirs.
   *
   * Written straight to the collections rather than through the sale service:
   * that path decrements stock, prints, syncs and posts to registers, none of
   * which should happen for a demonstration - a demo sale that moved stock
   * would leave a shop whose counts are wrong before they have sold anything.
   */
  async _insertDemoActivity({ branchId, branchName, licenseId, now, pack, items, userName }) {
    const demoSeed = require('./demo-seed');
    const BaseModel = require('../models/base.model');

    /* insertItems does not hand back ids, so the rows are read again - the
       sale lines need a real item_id or every report that joins back to the
       catalogue drops them. */
    const db = await BaseModel.getDb();
    const stored = await db
      .collection('items')
      .find(
        { demo_pack: pack, 'branch_access.branch_id': branchId, license: licenseId },
        { projection: { _id: 1, name: 1, selling_price: 1, unit: 1 } }
      )
      .limit(60)
      .toArray();

    if (!stored.length) return;

    const branch = { branch_id: branchId, branch_name: branchName, license: licenseId };
    const customer = await db
      .collection('customers')
      .findOne({ branch_id: branchId, license: licenseId }, { projection: { _id: 1, name: 1 } });

    /*
     * The people, before the sales - so the sales can belong to them.
     *
     * A new shop had one customer and one supplier, so two of the six things
     * in the main menu opened looking broken, and every sample sale belonged
     * to the same walk-in.
     */
    const people = demoSeed.buildPeople({
      branch,
      pack,
      now,
      base: {
        country: branch.country || '',
        country_id: branch.country_id || '',
        state: branch.state || '',
        sortname: branch.sortname || '',
      },
    });
    let seededCustomers = [];
    if (people.customers.length) {
      const r = await db.collection('customers').insertMany(people.customers);
      seededCustomers = people.customers.map((c, i) => ({
        _id: Object.values(r.insertedIds)[i],
        name: c.name,
      }));
    }
    let seededSuppliers = [];
    if (people.suppliers.length) {
      const rs = await db.collection('suppliers').insertMany(people.suppliers);
      seededSuppliers = people.suppliers.map((sup, i) => ({
        _id: Object.values(rs.insertedIds)[i],
        name: sup.name,
        /* The purchases print this; dropped here, every demo purchase's
           Phone column went blank however carefully the seed carried it. */
        phone: sup.phone || '',
      }));
    }

    /* Spread across the sample customers, with the walk-in kept in the mix -
       a shop that never takes a counter sale is not a shop. */
    const buyers = customer ? [customer].concat(seededCustomers) : seededCustomers;
    const sales = demoSeed.buildSales({
      items: stored,
      customers: buyers,
      customer,
      branch,
      pack,
      now,
      userName: userName,
    });
    const quotes = demoSeed.buildQuotes({ items: stored, branch, pack, now });
    /* Both sides of the counter: a Purchase History that opens empty says
       the product does not do purchasing. From the sample suppliers, over
       the same week, no stock movement - same rules as the sales. */
    const purchases = demoSeed.buildPurchases({
      items: stored,
      suppliers: seededSuppliers,
      branch,
      pack,
      now,
    });

    if (sales.length) await db.collection('sales').insertMany(sales);
    if (quotes.length) await db.collection('quotes').insertMany(quotes);
    if (purchases.length) await db.collection('receivings').insertMany(purchases);
    console.log(
      `📈 Demo activity: ${sales.length} sales, ${quotes.length} quotes, ${purchases.length} purchases`
    );
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
      const authUri = `mongodb://${dbUsername}:${encodeURIComponent(dbPassword)}@127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}/admin?authSource=admin`;

      try {
        console.log('📡 Strategy 1: Connect with provided credentials...');
        client = new MongoClient(authUri, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        adminDb = client.db('admin');
        connected = true;
      } catch (authError) {
        console.log('⚠️ Strategy 1 failed:', authError.message);
      }

      // Strategy 2: If not connected, try unauthenticated (MongoDB without auth)
      if (!connected) {
        try {
          console.log('📡 Strategy 2: Connect without authentication...');
          const unauthUri = `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}`;
          client = new MongoClient(unauthUri, { serverSelectionTimeoutMS: 5000 });
          await client.connect();
          adminDb = client.db('admin');
          // Verify by listing collections (auth check)
          await adminDb.listCollections().toArray();
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
      const newUri = `mongodb://${dbUsername}:${encodeURIComponent(dbPassword)}@127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro?authSource=admin`;

      if (mongoose.connection.readyState !== 0) {
        console.log('🔄 Reconnecting mongoose with authenticated connection...');
        await mongoose.connection.close();
        await mongoose.connect(newUri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 30000,
          connectTimeoutMS: 10000,
        });
      }

      // Also update BaseModel connection (native MongoDB driver)
      const BaseModel = require('../models/base.model');
      if (BaseModel.mongoClient) {
        console.log('🔄 Reconnecting BaseModel with authenticated connection...');
        await BaseModel.mongoClient.close();
        const { MongoClient } = require('mongodb');
        BaseModel.mongoClient = await MongoClient.connect(newUri);
        BaseModel.database = BaseModel.mongoClient.db('PosnicPro');
      }

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
      const host = `127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}`;

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

      return true;
    } catch (error) {
      console.error('❌ Error enabling MongoDB auth in config:', error.message);
      return false;
    }
  }
}

module.exports = InstallService;
