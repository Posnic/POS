'use strict';

// A capability inventory, not an API executor. Module pages enforce their own
// feature switches, role permissions and approval rules.
const groups = [
  [
    'Core operations',
    [
      [
        'Sales & receipts',
        'Basket preparation, checkout, payment and receipt printing',
        '#/sales/new',
        'sale_checkout',
      ],
      [
        'Sales history & returns',
        'Find sales, reprint receipts, return or refund through the sales workflow',
        '#/sales',
      ],
      ['Items', 'Products, barcodes, prices, stock and item details', '#/items'],
      ['Categories', 'Product categories', '#/categories'],
      ['Variants', 'Product variants', '#/variants'],
      ['Units', 'Units of measure', '#/units'],
      ['Customers', 'Customers, balances and purchase history', '#/customers'],
      ['Customer categories', 'Customer groups', '#/customercategory'],
      ['Suppliers', 'Supplier records and purchasing', '#/suppliers'],
      ['Purchases & receiving', 'Receive purchases, returns and supplier payments', '#/receivings'],
      ['Pricing', 'Price lists and item pricing', '#/pricesettings'],
      [
        'Purchase orders',
        'Prepare low-stock or demand-based purchase-order drafts',
        '#/purchaseorders',
        'purchase_order',
      ],
      ['Inventory counts', 'Prepare stock-count worksheets', '#/inventorycounts', 'stock_count'],
      ['Stock movements', 'Inventory movement history', '#/stocklogs'],
      ['Quotations', 'Prepare sales quotations', '#/quotes', 'sale_draft'],
      ['Invoices', 'Invoices and receivables', '#/invoices'],
      ['Branches & outlets', 'Outlet management', '#/branches'],
      ['Employees', 'Staff, roles and permissions', '#/users'],
    ],
  ],
  [
    'Insights & reporting',
    [
      [
        'Shop insights',
        'Sales, profit, tax, payment mix, top items, low stock, receivables, trends, comparisons, category and promotion performance, customer segments and reorder suggestions',
        '#/askposnic',
        'insights',
      ],
      ['Item reports', 'Item sales and inventory reports', '#/itemreport'],
      ['Purchase reports', 'Purchasing reports', '#/receivingreport'],
      ['Customer reports', 'Customer transaction reports', '#/customerreport'],
      ['Payment reports', 'Payment reports and reconciliation', '#/paymentreport'],
      ['Tax reports', 'GST reports and tax filing workflows', '#/gstrOne'],
    ],
  ],
  [
    'Optional features',
    [
      ['Restaurant & kitchen', 'Tables, orders and KOT', '#/settings/tableorder'],
      ['Cash register', 'Open, count and close tills', '#/settings/cashregister'],
      ['Workforce', 'Shifts, clock-in, tips and rosters', '#/settings/workforce'],
      ['Cash book', 'Expenses and cash movements', '#/settings/cashbook'],
      ['Customer credit', 'Credit sales and settlements', '#/settings/credit'],
      ['Tax settings', 'Tax rates and groups', '#/settings/taxmodule'],
      [
        'Marketing',
        'Prepare campaign drafts; review audience and sending in Marketing',
        '#/settings/marketingmodule',
        'campaign',
      ],
      [
        'Messaging',
        'Receipt and notification channels; supplier-message drafts',
        '#/settings/messagingmodule',
        'supplier_message',
      ],
      ['Online ordering', 'Customer QR and link ordering', '#/settings/onlineordering'],
      ['Kiosk', 'Self-service ordering terminals', '#/settings/kioskmachine'],
      ['Captain App', 'Staff ordering at tables', '#/settings/captainapp'],
      ['Mobile POS', 'Mobile selling', '#/settings/mobilepos'],
      ['Billing outlets', 'Multiple billing outlets', '#/billingoutlets'],
      ['Delivery partners', 'Delivery channel setup', '#/settings/deliverypartners'],
      ['Webshop', 'Online shop configuration', '#/settings/webshop'],
      ['Themes', 'Appearance and themes', '#/settings/theme'],
      ['Till PIN lock', 'Lock and unlock the till', '#/settings/tillpin'],
      ['Recycle bin', 'Review and restore deleted records', '#/settings/recyclebin'],
      ['Demo data', 'Sample shop data', '#/settings/demodata'],
    ],
  ],
  [
    'Administration',
    [
      [
        'Core settings',
        'Shop preferences, payment methods, receipts and printers',
        '#/settings/general',
      ],
      ['Feature switches', 'Enable or disable optional shop modules', '#/settings/modules'],
      ['Devices', 'Connected devices', '#/settings/devices'],
      ['Integrations', 'API tokens, webhooks and connectors', '#/settings/integrations'],
      ['Cloud sync', 'Synchronization settings', '#/settings/cloudsync'],
      ['Backups', 'Backup and restore workflows', '#/settings/backups'],
      ['System status', 'Diagnostics and service health', '#/settings/systemstatus'],
      ['Updates', 'Application updates', '#/settings/updates'],
      ['Ask Posnic', 'Knowledge, access, AI usage and report schedules', '#/settings/ai'],
    ],
  ],
];

function catalog(preferences, user, canPrepare, capabilityAllowed) {
  return groups.flatMap(([group, rows]) =>
    rows.map(([name, description, route, capability]) => ({
      group,
      name,
      description,
      route,
      mode: capability === 'insights' ? 'insights' : capability ? 'action' : 'module',
      enabled:
        capability === 'insights'
          ? capabilityAllowed(preferences, 'insights', user) && canPrepare('insights')
          : capability
            ? capabilityAllowed(preferences, 'actions', user) &&
              preferences.allowed_actions.includes(capability) &&
              canPrepare(capability)
            : null,
    }))
  );
}

module.exports = { catalog };
