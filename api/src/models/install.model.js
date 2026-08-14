// src/models/install_model.js
const { ObjectId } = require('mongodb');
const BaseModel = require('./base.model');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

class InstallModel extends BaseModel {
  constructor() {
    super();
    this.collectionName = 'branches';
  }

  async installInsertDocument(data) {
    try {
      const licenseId = new ObjectId(data.register_license);

      // Check if user already exists
      const userCollection = await this.getCollection('users');
      const existingUser = await userCollection.findOne({
        $or: [
          { username: data.register_username },
          { email: data.register_useremail },
          { license: licenseId },
        ],
      });

      // If user exists, return error
      if (existingUser) {
        let duplicateField = '';
        if (existingUser.username === data.register_username) {
          duplicateField = 'username';
        } else if (existingUser.email === data.register_useremail) {
          duplicateField = 'email';
        } else if (existingUser.license.toString() === licenseId.toString()) {
          duplicateField = 'license';
        }
        return {
          status: false,
          data: '',
          message: `This ${duplicateField} already exists in our system`,
        };
      }

      // Create access permissions
      const access = {
        dashboard: { read: true },
        sales: { read: true, write: true, delete: true },
        receiving: { read: true, write: true, delete: true },
        customer: { read: true, write: true, delete: true },
        supplier: { read: true, write: true, delete: true },
        category: { read: true, write: true, delete: true },
        item: { read: true, write: true, delete: true },
        user: { read: true, write: true, delete: true },
        expense: { read: true, write: true, delete: true },
        branch: { read: true, write: true, delete: true },
        report: { read: true, write: true, delete: true },
        plan: { read: false },
      };

      // Generate user secret key
      const random =
        new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 10000);
      const usersecretkey = await bcrypt.hash(random, 10);

      // Create timestamps
      const now = new Date();
      const oneYearLater = new Date(now);
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

      // Insert user
      const userInsertResult = await userCollection.insertOne({
        branch_access: '',
        plan: {
          name: 'premium',
          max_sales: 'unlimited',
          plan_expire: oneYearLater,
        },
        userkey: usersecretkey.trim(),
        firstname: (data.register_firstname || '').trim(),
        lastname: (data.register_lastname || '').trim(),
        username: data.register_username.trim(),
        password: data.register_userpassword.trim(),
        usertype: 'super_admin',
        email: data.register_useremail.trim(),
        apikey: '',
        access: access,
        image: 'user.svg',
        activate: true,
        printing_design: '',
        register_status: 'Closed',
        created_date: now,
        updated_date: now,
        expired_date: oneYearLater,
        created_by: data.register_username,
        created_by_id: '',
        updated_by: data.register_username,
        updated_by_id: '',
        license: licenseId,
        plan_access: [],
      });

      const userId = userInsertResult.insertedId;

      // Load print templates
      const regularBodyPrint = fs.readFileSync(
        path.join(__dirname, '../json/print_a4html.txt'),
        'utf8'
      );
      const thermalBodyPrint = fs.readFileSync(
        path.join(__dirname, '../json/print_standard_html.txt'),
        'utf8'
      );

      // Create branch
      const branchCollection = await this.getCollection(this.collectionName);
      const branchInsertResult = await branchCollection.insertOne({
        theme: 'blue',
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
        logo: 'store.png',
        languge: '',
        indian_gst: 'gst_off',
        branch_gstin_number: '',
        currency: '₹',
        currency_text: 'India Rupee / INR or ₹',
        currency_type: '₹',
        currency_value: [{ currency_text: 'INR', currency_sign: '₹' }],
        time_zone: (data.register_timezone || '').trim(),
        printing_address: (data.register_address || '').trim(),
        smstype: 'way2sms',
        way2sms_api: '',
        way2sms_userid: '',
        way2sms_password: '',
        textlocal_sender: '',
        textlocal_api: '',
        notification_range: '10',
        discount: '',
        discount_amount: '0',
        discount_percentage: '0.00',
        sales_prefix: 'S',
        receiving_prefix: 'RID',
        sales_sms: false,
        enable_notification_reminders: false,
        enable_email_reminders: false,
        enable_sms_reminders: false,
        enable_sms_auto_send: false,
        sms_auto_send_time: '10:00 am',
        sms_retry_period: '24',
        sms_max_retries: '2',
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
        sale_inline_editor: false,
        client_dateformat: 'dd/mm/yyyy',
        time_format: 'enable',
        server_dateformat: 'd/m/Y',
        dateformat_text: '01/01/2018 -- dd/mm/yyyy',
        default_customer: '',
        default_supplier: '',
        default_tax: '',
        created_date: now,
        updated_date: now,
        created_by: '',
        created_by_id: '',
        updated_by: '',
        updated_by_id: '',
        register: [],
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
      });

      const branchId = branchInsertResult.insertedId;

      // Update user with branch access
      const userBranch = [
        {
          branch_id: branchId,
          branch_name: data.register_companyname,
          branch_image: 'store.png',
        },
      ];
      const printBranch = [
        {
          branch_id: branchId,
          printing_design: 'standard',
          printing_max_char: 'default',
          printing_size: 'receipt_medium',
        },
      ];

      await userCollection.updateOne(
        { _id: userId, license: licenseId },
        {
          $set: {
            branch_access: userBranch,
            printing_design: printBranch,
            created_by_id: userId,
            updated_by_id: userId,
          },
        }
      );

      // Create taxes from countries.json
      const countriesData = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../json/countries.json'), 'utf8')
      );
      let sortname = '';
      let insertTaxResult = null;
      let insertTaxData = null;

      for (const countryData of countriesData.countries) {
        if (countryData.value === data.register_country) {
          sortname = countryData.sortname;

          for (const taxdata of countryData.tax) {
            const taxFields = [
              {
                tax_id: new ObjectId(),
                tax_name: taxdata.tax_name,
                tax_value: taxdata.tax_value,
              },
            ];

            insertTaxData = {
              branch_id: branchId,
              branch_name: data.register_companyname.trim(),
              name: taxdata.tax_name,
              rate: parseFloat(taxdata.tax_value),
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

            const taxCollection = await this.getCollection('grouptax');
            insertTaxResult = await taxCollection.insertOne(insertTaxData);
          }
          break;
        }
      }

      // Create default customer
      const customerCollection = await this.getCollection('customers');
      const customerInsertResult = await customerCollection.insertOne({
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
      });

      // Create default supplier
      const supplierCollection = await this.getCollection('suppliers');
      const supplierInsertResult = await supplierCollection.insertOne({
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
      });

      // Update branch with default values
      await branchCollection.updateOne(
        { _id: branchId, license: licenseId },
        {
          $set: {
            default_customer: customerInsertResult.insertedId,
            default_supplier: supplierInsertResult.insertedId,
            default_tax: insertTaxResult ? insertTaxResult.insertedId : '',
            created_by: data.register_username,
            created_by_id: userId,
            updated_by: data.register_username,
            updated_by_id: userId,
          },
        }
      );

      // Add email fields
      await branchCollection.updateOne(
        { _id: branchId, license: licenseId },
        {
          $push: {
            email_fields: {
              branch_id: branchId,
              email_address: [{ email: data.register_useremail }],
              report_type: 'daily',
              send_mail: 'mail_off',
            },
          },
        }
      );

      // Create default unit
      const unitCollection = await this.getCollection('unit');
      const unitInsertResult = await unitCollection.insertOne({
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
      });

      // Handle demo data if requested
      if (data.register_demo === 'on') {
        await this.insertDemoData({
          branchId,
          branchName: data.register_companyname.trim(),
          userId,
          username: data.register_username,
          licenseId,
          now,
          userBranch,
          supplierId: supplierInsertResult.insertedId,
          supplierName: 'General Supplier',
          taxId: insertTaxResult ? insertTaxResult.insertedId : null,
          taxData: insertTaxData,
          unitId: unitInsertResult.insertedId,
        });
      } else {
        // Insert single category and item
        await this.insertDefaultCategoryAndItem({
          branchId,
          branchName: data.register_companyname.trim(),
          userId,
          username: data.register_username,
          licenseId,
          now,
          userBranch,
          supplierId: supplierInsertResult.insertedId,
          supplierName: 'General Supplier',
          taxId: insertTaxResult ? insertTaxResult.insertedId : null,
          taxData: insertTaxData,
          unitId: unitInsertResult.insertedId,
        });
      }

      return {
        status: true,
        data: '',
        message: 'Account created successfully',
      };
    } catch (error) {
      console.error('Error in installInsertDocument:', error);

      // Handle MongoDB duplicate key errors (E11000)
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

      // Handle other errors
      return {
        status: false,
        data: '',
        message: error.message || 'An error occurred during installation',
      };
    }
  }

  async insertDemoData(params) {
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
      const categoryCollection = await this.getCollection('categories');
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

      const categoryInsertResult = await categoryCollection.insertMany(categoryMultiData);
      const insertedCategoryIds = Object.values(categoryInsertResult.insertedIds);

      // Get inserted categories
      const categories = await categoryCollection
        .find({
          _id: { $in: insertedCategoryIds },
          license: licenseId,
        })
        .toArray();

      const categoryMap = {};
      categories.forEach((cat) => {
        categoryMap[cat.name] = { id: cat._id, name: cat.name };
      });

      // Insert items
      const itemCollection = await this.getCollection('items');
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
            // parseFloat: a starting stock level can be 2.5kg, and parseInt would
            // silently seed 2.
            available_quantity: parseFloat(itemValue.available_quantity) || 0,
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

      if (itemMultiData.length > 0) {
        await itemCollection.insertMany(itemMultiData);
      }
    } catch (error) {
      console.error('Error in insertDemoData:', error);
      // Don't throw error, just log it - installation can continue without demo data
    }
  }

  async insertDefaultCategoryAndItem(params) {
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
      const categoryCollection = await this.getCollection('categories');
      const categoryInsertResult = await categoryCollection.insertOne({
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
      });

      // Insert default item
      const itemCollection = await this.getCollection('items');
      await itemCollection.insertOne({
        branch_id: branchId,
        branch_name: branchName,
        category_id: categoryInsertResult.insertedId,
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
      });
    } catch (error) {
      console.error('Error in insertDefaultCategoryAndItem:', error);
      // Don't throw error, just log it - installation can continue without default data
    }
  }

  /**
   * Cleanup all data by license ID
   * Removes all records from all collections that have the specified license
   */
  async cleanupByLicense(licenseId) {
    try {
      const license = new ObjectId(licenseId);

      // Define all collections that have license field
      const collections = [
        'users',
        'branches',
        'customers',
        'suppliers',
        'categories',
        'items',
        'grouptax',
        'unit',
        'sales',
        'receiving',
        'expenses',
        'stocklogs',
        'payments',
        'reports',
        'notifications',
        'settings',
      ];

      const deletionResults = {};
      let totalDeleted = 0;

      // Delete from each collection
      for (const collectionName of collections) {
        try {
          const collection = await this.getCollection(collectionName);
          const result = await collection.deleteMany({ license: license });
          deletionResults[collectionName] = result.deletedCount;
          totalDeleted += result.deletedCount;
        } catch (error) {
          console.error(`Error deleting from ${collectionName}:`, error.message);
          deletionResults[collectionName] = `Error: ${error.message}`;
        }
      }

      return {
        status: true,
        data: {
          license: licenseId,
          totalDeleted: totalDeleted,
          details: deletionResults,
        },
        message: `Successfully deleted ${totalDeleted} records across all collections for license ${licenseId}`,
      };
    } catch (error) {
      console.error('Error in cleanupByLicense:', error);
      return {
        status: false,
        data: '',
        message: error.message || 'An error occurred during cleanup',
      };
    }
  }
}

module.exports = new InstallModel();
