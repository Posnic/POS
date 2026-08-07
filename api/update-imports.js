#!/usr/bin/env node
/**
 * Import Path Update Script
 * Updates all require/import statements to use new kebab-case file names
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Map of old paths to new paths (relative to project root)
const pathMappings = {
  // Models
  './BaseModel': './base.model',
  '../models/BaseModel': '../models/base.model',
  './Category': './category.model',
  '../models/Category': '../models/category.model',
  './EasyTable': './easy-table.model',
  '../models/EasyTable': '../models/easy-table.model',
  './Item': './item.model',
  '../models/Item': '../models/item.model',
  './Supplier': './supplier.model',
  '../models/Supplier': '../models/supplier.model',
  './VariantModel': './variant.model',
  '../models/VariantModel': '../models/variant.model',
  './activityLog.model': './activity-log.model',
  '../models/activityLog.model': '../models/activity-log.model',
  './base_model': './base-legacy.model',
  '../models/base_model': '../models/base-legacy.model',
  './branchModel': './branch.model',
  '../models/branchModel': '../models/branch.model',
  './customerCategory_model': './customer-category.model',
  '../models/customerCategory_model': '../models/customer-category.model',
  './customer_model': './customer.model',
  '../models/customer_model': '../models/customer.model',
  './dashboard_model': './dashboard.model',
  '../models/dashboard_model': '../models/dashboard.model',
  './expense_model': './expense.model',
  '../models/expense_model': '../models/expense.model',
  './install_model': './install.model',
  '../models/install_model': '../models/install.model',
  './inventory_model': './inventory.model',
  '../models/inventory_model': '../models/inventory.model',
  './item_model': './item-legacy.model',
  '../models/item_model': '../models/item-legacy.model',
  './receiving_model': './receiving.model',
  '../models/receiving_model': '../models/receiving.model',
  './register_model': './register.model',
  '../models/register_model': '../models/register.model',
  './sale_hold_model': './sale-hold.model',
  '../models/sale_hold_model': '../models/sale-hold.model',
  './sales_model': './sale.model',
  '../models/sales_model': '../models/sale.model',
  './setting_model': './setting.model',
  '../models/setting_model': '../models/setting.model',
  './stock_log_model': './stock-log.model',
  '../models/stock_log_model': '../models/stock-log.model',
  './supplier_model': './supplier-legacy.model',
  '../models/supplier_model': '../models/supplier-legacy.model',
  './user_model': './user.model',
  '../models/user_model': '../models/user.model',

  // Controllers
  './activityLogController': './activity-logs.controller',
  '../controllers/activityLogController': '../controllers/activity-logs.controller',
  './authController': './auth.controller',
  '../controllers/authController': '../controllers/auth.controller',
  './authUtils': './auth-utils.controller',
  '../controllers/authUtils': '../controllers/auth-utils.controller',
  './base_controller': './base.controller',
  '../controllers/base_controller': '../controllers/base.controller',
  './branches_controller': './branches.controller',
  '../controllers/branches_controller': '../controllers/branches.controller',
  './categories_controller': './categories.controller',
  '../controllers/categories_controller': '../controllers/categories.controller',
  './commonPdf_controller': './common-pdf.controller',
  '../controllers/commonPdf_controller': '../controllers/common-pdf.controller',
  './crons_controller': './crons.controller',
  '../controllers/crons_controller': '../controllers/crons.controller',
  './customerCategory_controller': './customer-categories.controller',
  '../controllers/customerCategory_controller': '../controllers/customer-categories.controller',
  './customers_controller': './customers.controller',
  '../controllers/customers_controller': '../controllers/customers.controller',
  './dashboard_controller': './dashboard.controller',
  '../controllers/dashboard_controller': '../controllers/dashboard.controller',
  './easyTable_controller': './easy-tables.controller',
  '../controllers/easyTable_controller': '../controllers/easy-tables.controller',
  './expenses_controller': './expenses.controller',
  '../controllers/expenses_controller': '../controllers/expenses.controller',
  './install_controller': './install.controller',
  '../controllers/install_controller': '../controllers/install.controller',
  './items_controller': './items.controller',
  '../controllers/items_controller': '../controllers/items.controller',
  './receivings_controller': './receivings.controller',
  '../controllers/receivings_controller': '../controllers/receivings.controller',
  './registers_controller': './registers.controller',
  '../controllers/registers_controller': '../controllers/registers.controller',
  './sales_controller': './sales.controller',
  '../controllers/sales_controller': '../controllers/sales.controller',
  './setting_controller': './settings.controller',
  '../controllers/setting_controller': '../controllers/settings.controller',
  './stock_log_controller': './stock-logs.controller',
  '../controllers/stock_log_controller': '../controllers/stock-logs.controller',
  './suppliers_controller': './suppliers.controller',
  '../controllers/suppliers_controller': '../controllers/suppliers.controller',
  './users_controller': './users.controller',
  '../controllers/users_controller': '../controllers/users.controller',
  './variants': './variants.controller',
  '../controllers/variants': '../controllers/variants.controller',
  './variants_v2': './variants-v2.controller',
  '../controllers/variants_v2': '../controllers/variants-v2.controller',

  // Routes
  './activityLog.routes': './activity-logs.routes',
  './authUtils.routes': './auth-utils.routes',
  './commonPdf.routes': './common-pdf.routes',
  './customerCategory.routes': './customer-categories.routes',
  './easyTable.routes': './easy-tables.routes',
  './setting.routes': './settings.routes',
  './stocklogs.routes': './stock-logs.routes',
};

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let updated = false;

  // Update all require/import statements
  Object.entries(pathMappings).forEach(([oldPath, newPath]) => {
    // Match require statements
    const requireRegex = new RegExp(`require\\(["'\`]${oldPath.replace(/\./g, '\\.')}["'\`]\\)`, 'g');
    if (requireRegex.test(content)) {
      content = content.replace(requireRegex, `require("${newPath}")`);
      updated = true;
    }

    // Match import statements
    const importRegex = new RegExp(`from ["'\`]${oldPath.replace(/\./g, '\\.')}["'\`]`, 'g');
    if (importRegex.test(content)) {
      content = content.replace(importRegex, `from "${newPath}"`);
      updated = true;
    }
  });

  if (updated) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

console.log('🔍 Scanning for files to update...\n');

const filesToScan = [
  'src/routes/**/*.js',
  'src/controllers/**/*.js',
  'src/models/**/*.js',
  'src/middleware/**/*.js',
  'app.js',
  'server.js',
];

let totalUpdated = 0;

filesToScan.forEach(pattern => {
  const files = glob.sync(pattern, { cwd: __dirname });
  
  files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (updateFile(filePath)) {
      console.log(`✅ Updated: ${file}`);
      totalUpdated++;
    }
  });
});

console.log(`\n✨ Complete: ${totalUpdated} files updated`);
