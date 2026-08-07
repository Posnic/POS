#!/usr/bin/env node
/**
 * File Naming Refactor Script
 * Renames files to follow kebab-case naming conventions:
 * - Models: singular, kebab-case, .model.js
 * - Controllers: plural, kebab-case, .controller.js
 * - Routes: plural, kebab-case, .routes.js (already mostly correct)
 */

const fs = require('fs');
const path = require('path');

const renames = {
  // MODELS (singular, kebab-case)
  'src/models/BaseModel.js': 'src/models/base.model.js',
  'src/models/Category.js': 'src/models/category.model.js',
  'src/models/EasyTable.js': 'src/models/easy-table.model.js',
  'src/models/Item.js': 'src/models/item.model.js',
  'src/models/Supplier.js': 'src/models/supplier.model.js',
  'src/models/VariantModel.js': 'src/models/variant.model.js',
  'src/models/activityLog.model.js': 'src/models/activity-log.model.js',
  'src/models/base_model.js': 'src/models/base-legacy.model.js', // Keep legacy version separate
  'src/models/branchModel.js': 'src/models/branch.model.js',
  'src/models/customerCategory_model.js': 'src/models/customer-category.model.js',
  'src/models/customer_model.js': 'src/models/customer.model.js',
  'src/models/dashboard_model.js': 'src/models/dashboard.model.js',
  'src/models/expense_model.js': 'src/models/expense.model.js',
  'src/models/install_model.js': 'src/models/install.model.js',
  'src/models/inventory_model.js': 'src/models/inventory.model.js',
  'src/models/item_model.js': 'src/models/item-legacy.model.js', // Keep legacy version separate
  'src/models/receiving_model.js': 'src/models/receiving.model.js',
  'src/models/register_model.js': 'src/models/register.model.js',
  'src/models/sale_hold_model.js': 'src/models/sale-hold.model.js',
  'src/models/sales_model.js': 'src/models/sale.model.js',
  'src/models/setting_model.js': 'src/models/setting.model.js',
  'src/models/stock_log_model.js': 'src/models/stock-log.model.js',
  'src/models/supplier_model.js': 'src/models/supplier-legacy.model.js', // Keep legacy version separate
  'src/models/user_model.js': 'src/models/user.model.js',

  // CONTROLLERS (plural, kebab-case)
  'src/controllers/activityLogController.js': 'src/controllers/activity-logs.controller.js',
  'src/controllers/authController.js': 'src/controllers/auth.controller.js',
  'src/controllers/authUtils.js': 'src/controllers/auth-utils.controller.js',
  'src/controllers/base_controller.js': 'src/controllers/base.controller.js',
  'src/controllers/branches_controller.js': 'src/controllers/branches.controller.js',
  'src/controllers/categories_controller.js': 'src/controllers/categories.controller.js',
  'src/controllers/commonPdf_controller.js': 'src/controllers/common-pdf.controller.js',
  'src/controllers/crons_controller.js': 'src/controllers/crons.controller.js',
  'src/controllers/customerCategory_controller.js': 'src/controllers/customer-categories.controller.js',
  'src/controllers/customers_controller.js': 'src/controllers/customers.controller.js',
  'src/controllers/dashboard_controller.js': 'src/controllers/dashboard.controller.js',
  'src/controllers/easyTable_controller.js': 'src/controllers/easy-tables.controller.js',
  'src/controllers/expenses_controller.js': 'src/controllers/expenses.controller.js',
  'src/controllers/install_controller.js': 'src/controllers/install.controller.js',
  'src/controllers/items_controller.js': 'src/controllers/items.controller.js',
  'src/controllers/receivings_controller.js': 'src/controllers/receivings.controller.js',
  'src/controllers/registers_controller.js': 'src/controllers/registers.controller.js',
  'src/controllers/sales_controller.js': 'src/controllers/sales.controller.js',
  'src/controllers/setting_controller.js': 'src/controllers/settings.controller.js',
  'src/controllers/stock_log_controller.js': 'src/controllers/stock-logs.controller.js',
  'src/controllers/suppliers_controller.js': 'src/controllers/suppliers.controller.js',
  'src/controllers/users_controller.js': 'src/controllers/users.controller.js',
  'src/controllers/variants.js': 'src/controllers/variants.controller.js',
  'src/controllers/variants_v2.js': 'src/controllers/variants-v2.controller.js',

  // ROUTES (plural, kebab-case) - most already correct, just a few adjustments
  'src/routes/activityLog.routes.js': 'src/routes/activity-logs.routes.js',
  'src/routes/authUtils.routes.js': 'src/routes/auth-utils.routes.js',
  'src/routes/commonPdf.routes.js': 'src/routes/common-pdf.routes.js',
  'src/routes/customerCategory.routes.js': 'src/routes/customer-categories.routes.js',
  'src/routes/easyTable.routes.js': 'src/routes/easy-tables.routes.js',
  'src/routes/setting.routes.js': 'src/routes/settings.routes.js',
  'src/routes/stocklogs.routes.js': 'src/routes/stock-logs.routes.js',
};

console.log('📋 File Renaming Plan:\n');
Object.entries(renames).forEach(([oldPath, newPath]) => {
  console.log(`  ${oldPath}\n  → ${newPath}\n`);
});

console.log(`\nTotal files to rename: ${Object.keys(renames).length}`);
console.log('\nRun with --execute to perform the renames');

if (process.argv.includes('--execute')) {
  console.log('\n🚀 Executing renames...\n');
  
  let successCount = 0;
  let errorCount = 0;
  
  Object.entries(renames).forEach(([oldPath, newPath]) => {
    const fullOldPath = path.join(__dirname, oldPath);
    const fullNewPath = path.join(__dirname, newPath);
    
    try {
      if (fs.existsSync(fullOldPath)) {
        fs.renameSync(fullOldPath, fullNewPath);
        console.log(`✅ ${oldPath} → ${newPath}`);
        successCount++;
      } else {
        console.log(`⚠️  SKIP: ${oldPath} (not found)`);
      }
    } catch (error) {
      console.error(`❌ ERROR: ${oldPath} - ${error.message}`);
      errorCount++;
    }
  });
  
  console.log(`\n✨ Complete: ${successCount} renamed, ${errorCount} errors`);
}
