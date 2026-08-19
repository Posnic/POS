/**
 * Role / Permission-Group Constants (Phase 1)
 *
 * A ROLE is a reusable, named permission set. Assign a role to a user and they
 * inherit its access; edit the role and everyone with it updates. This replaces
 * the current per-user checkbox matrix (which stored an independent copy on each
 * user).
 *
 * The `access` matrix uses the EXISTING shape the whole app already enforces:
 *   modules: dashboard{read,financials}, sales/receiving/customer/supplier/
 *            category/item/expense/branch/report/user {read,write,delete},
 *            plan{read}
 * so a role resolves straight into today's `access` object (no enforcement
 * change). Granular POS actions (void/refund/discount/no-sale/register) land on
 * `role.pos` in Phase 2.
 *
 * These DEFAULT_ROLES are seeded per tenant as `is_system` roles (clone to make
 * a custom role). They are the STARTING presets — a shop can edit them.
 */

// access-triple helpers
const rwd = (read, write, del) => ({ read, write, delete: del });
const NONE = rwd(false, false, false);
const RO = rwd(true, false, false); // read only
const RW = rwd(true, true, false); // read + write, no delete
const FULL = rwd(true, true, true); // full CRUD

// Build a full 11-module + plan access object from per-module triples.
const access = ({
  dashRead = false,
  financials = false,
  sales = NONE,
  receiving = NONE,
  customer = NONE,
  supplier = NONE,
  category = NONE,
  item = NONE,
  expense = NONE,
  branch = NONE,
  report = NONE,
  user = NONE,
  plan = false,
}) => ({
  dashboard: { read: dashRead, financials },
  sales,
  receiving,
  customer,
  supplier,
  category,
  item,
  expense,
  branch,
  report,
  user,
  plan: { read: plan },
});

// POS-granular permissions (Phase 2). Layered on top of the CRUD access matrix,
// these gate the sensitive till actions. Numeric caps: 0 = no cap (unlimited)
// when the matching boolean is true. `requires_manager_approval` (per role) lists
// actions a role cannot self-perform but a manager may authorise on the spot.
const POS_PERMISSIONS = {
  DISCOUNT_APPLY: 'discount_apply',
  PRICE_OVERRIDE: 'price_override',
  VOID_LINE: 'void_line',
  VOID_SALE: 'void_sale',
  REFUND: 'refund',
  REPRINT_RECEIPT: 'reprint_receipt',
  NO_SALE_OPEN_DRAWER: 'no_sale_open_drawer',
  REGISTER_OPEN: 'register_open',
  REGISTER_CLOSE: 'register_close',
  CASH_IN_OUT: 'cash_in_out',
  CASH_DROP: 'cash_drop',
  // Owner ask: quick sale grantable per cashier; deny only when unticked.
  QUICK_SALE: 'quick_sale',
};

const pos = (o = {}) => ({
  discount_apply: !!o.discount_apply,
  discount_max_percent: o.discount_max_percent != null ? o.discount_max_percent : 0,
  price_override: !!o.price_override,
  void_line: !!o.void_line,
  void_sale: !!o.void_sale,
  refund: !!o.refund,
  refund_max_amount: o.refund_max_amount != null ? o.refund_max_amount : 0,
  reprint_receipt: !!o.reprint_receipt,
  no_sale_open_drawer: !!o.no_sale_open_drawer,
  register_open: !!o.register_open,
  register_close: !!o.register_close,
  cash_in_out: !!o.cash_in_out,
  cash_drop: !!o.cash_drop,
});
const POS_FULL = {
  discount_apply: true,
  discount_max_percent: 100,
  price_override: true,
  void_line: true,
  void_sale: true,
  refund: true,
  reprint_receipt: true,
  no_sale_open_drawer: true,
  register_open: true,
  register_close: true,
  cash_in_out: true,
  cash_drop: true,
};

const ROLE_KEYS = {
  OWNER: 'owner',
  ADMIN: 'admin',
  STORE_MANAGER: 'store_manager',
  SHIFT_SUPERVISOR: 'shift_supervisor',
  CASHIER: 'cashier',
  INVENTORY_CLERK: 'inventory_clerk',
  ACCOUNTANT: 'accountant',
  API: 'api',
};

const DEFAULT_ROLES = [
  {
    key: ROLE_KEYS.OWNER,
    name: 'Owner',
    is_system: true,
    description: 'Full access including staff, settings and financials. Cannot be deleted.',
    access: access({
      dashRead: true,
      financials: true,
      sales: FULL,
      receiving: FULL,
      customer: FULL,
      supplier: FULL,
      category: FULL,
      item: FULL,
      expense: FULL,
      branch: FULL,
      report: FULL,
      user: FULL,
      plan: true,
    }),
  },
  {
    key: ROLE_KEYS.ADMIN,
    name: 'Admin',
    is_system: true,
    description: 'Full operational access, plus users and settings.',
    access: access({
      dashRead: true,
      financials: true,
      sales: FULL,
      receiving: FULL,
      customer: FULL,
      supplier: FULL,
      category: FULL,
      item: FULL,
      expense: FULL,
      branch: FULL,
      report: FULL,
      user: FULL,
      plan: true,
    }),
  },
  {
    key: ROLE_KEYS.STORE_MANAGER,
    name: 'Store Manager',
    is_system: true,
    description: 'Runs a store: full operations, reports & financials, manage staff.',
    access: access({
      dashRead: true,
      financials: true,
      sales: FULL,
      receiving: FULL,
      customer: FULL,
      supplier: FULL,
      category: FULL,
      item: FULL,
      expense: FULL,
      branch: RO,
      report: RO,
      user: RW,
      plan: true,
    }),
  },
  {
    key: ROLE_KEYS.SHIFT_SUPERVISOR,
    name: 'Shift Supervisor',
    is_system: true,
    description:
      'Cashier duties plus register open/close and approvals within limits. No financials.',
    access: access({
      dashRead: true,
      financials: false,
      sales: RW,
      receiving: RO,
      customer: RW,
      category: RO,
      item: RO,
      expense: RO,
      report: RO,
    }),
  },
  {
    key: ROLE_KEYS.CASHIER,
    name: 'Cashier / POS Operator',
    is_system: true,
    description:
      'Ring sales and add customers only. No reports, no financials; voids, refunds, discounts over limit, no-sale drawer and register close need a manager (Phase 2).',
    access: access({
      dashRead: true,
      financials: false,
      sales: RW,
      customer: RW,
      category: RO,
      item: RO,
    }),
  },
  {
    key: ROLE_KEYS.INVENTORY_CLERK,
    name: 'Inventory Clerk',
    is_system: true,
    description: 'Manage items, stock and purchases. No POS, no financials.',
    access: access({
      dashRead: true,
      financials: false,
      receiving: RW,
      customer: RO,
      supplier: RW,
      category: RW,
      item: FULL,
      report: RO,
    }),
  },
  {
    key: ROLE_KEYS.ACCOUNTANT,
    name: 'Accountant',
    is_system: true,
    description: 'Reports and financials, read-only. No POS operations.',
    access: access({
      dashRead: true,
      financials: true,
      sales: RO,
      receiving: RO,
      customer: RO,
      supplier: RO,
      category: RO,
      item: RO,
      expense: RO,
      report: RO,
    }),
  },
  {
    key: ROLE_KEYS.API,
    name: 'API / Integration',
    is_system: true,
    description: 'Programmatic access for integrations (adjust per integration).',
    access: access({
      dashRead: true,
      financials: false,
      sales: RW,
      receiving: RW,
      customer: RW,
      supplier: RW,
      category: RW,
      item: RW,
      expense: RO,
      branch: RO,
      report: RO,
    }),
  },
];

// Attach the POS-granular permission set + manager-approval list per role.
// Cashier can only reprint; voids/refunds/discounts/no-sale/register-close need
// a manager. Supervisor can do most within limits (a full void needs a manager).
const ROLE_POS = {
  owner: pos(POS_FULL),
  admin: pos(POS_FULL),
  store_manager: pos(POS_FULL),
  shift_supervisor: pos({
    discount_apply: true,
    discount_max_percent: 20,
    void_line: true,
    refund: true,
    reprint_receipt: true,
    no_sale_open_drawer: true,
    register_open: true,
    register_close: true,
    cash_in_out: true,
    cash_drop: true,
  }),
  cashier: pos({ reprint_receipt: true }),
  inventory_clerk: pos({}),
  accountant: pos({}),
  api: pos({ reprint_receipt: true }),
};
const ROLE_MGR_APPROVAL = {
  owner: [],
  admin: [],
  store_manager: [],
  shift_supervisor: ['void_sale'],
  cashier: [
    'void_line',
    'void_sale',
    'refund',
    'discount_apply',
    'price_override',
    'no_sale_open_drawer',
    'register_close',
  ],
  inventory_clerk: [],
  accountant: [],
  api: [],
};
DEFAULT_ROLES.forEach((r) => {
  r.pos = ROLE_POS[r.key] || pos({});
  r.requires_manager_approval = ROLE_MGR_APPROVAL[r.key] || [];
});

module.exports = { ROLE_KEYS, DEFAULT_ROLES, POS_PERMISSIONS };
