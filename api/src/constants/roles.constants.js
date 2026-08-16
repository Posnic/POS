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
    access: access({ dashRead: true, financials: true, sales: FULL, receiving: FULL, customer: FULL, supplier: FULL, category: FULL, item: FULL, expense: FULL, branch: FULL, report: FULL, user: FULL, plan: true }),
  },
  {
    key: ROLE_KEYS.ADMIN,
    name: 'Admin',
    is_system: true,
    description: 'Full operational access, plus users and settings.',
    access: access({ dashRead: true, financials: true, sales: FULL, receiving: FULL, customer: FULL, supplier: FULL, category: FULL, item: FULL, expense: FULL, branch: FULL, report: FULL, user: FULL, plan: true }),
  },
  {
    key: ROLE_KEYS.STORE_MANAGER,
    name: 'Store Manager',
    is_system: true,
    description: 'Runs a store: full operations, reports & financials, manage staff.',
    access: access({ dashRead: true, financials: true, sales: FULL, receiving: FULL, customer: FULL, supplier: FULL, category: FULL, item: FULL, expense: FULL, branch: RO, report: RO, user: RW, plan: true }),
  },
  {
    key: ROLE_KEYS.SHIFT_SUPERVISOR,
    name: 'Shift Supervisor',
    is_system: true,
    description: 'Cashier duties plus register open/close and approvals within limits. No financials.',
    access: access({ dashRead: true, financials: false, sales: RW, receiving: RO, customer: RW, category: RO, item: RO, expense: RO, report: RO }),
  },
  {
    key: ROLE_KEYS.CASHIER,
    name: 'Cashier / POS Operator',
    is_system: true,
    description: 'Ring sales and add customers only. No reports, no financials; voids, refunds, discounts over limit, no-sale drawer and register close need a manager (Phase 2).',
    access: access({ dashRead: true, financials: false, sales: RW, customer: RW, category: RO, item: RO }),
  },
  {
    key: ROLE_KEYS.INVENTORY_CLERK,
    name: 'Inventory Clerk',
    is_system: true,
    description: 'Manage items, stock and purchases. No POS, no financials.',
    access: access({ dashRead: true, financials: false, receiving: RW, customer: RO, supplier: RW, category: RW, item: FULL, report: RO }),
  },
  {
    key: ROLE_KEYS.ACCOUNTANT,
    name: 'Accountant',
    is_system: true,
    description: 'Reports and financials, read-only. No POS operations.',
    access: access({ dashRead: true, financials: true, sales: RO, receiving: RO, customer: RO, supplier: RO, category: RO, item: RO, expense: RO, report: RO }),
  },
  {
    key: ROLE_KEYS.API,
    name: 'API / Integration',
    is_system: true,
    description: 'Programmatic access for integrations (adjust per integration).',
    access: access({ dashRead: true, financials: false, sales: RW, receiving: RW, customer: RW, supplier: RW, category: RW, item: RW, expense: RO, branch: RO, report: RO }),
  },
];

module.exports = { ROLE_KEYS, DEFAULT_ROLES };
