/**
 * Audit Log Constants
 *
 * Event types for the append-only accountability audit trail (collection
 * `audit_log`). This records WHO did a sensitive / money / security ACTION
 * (and who approved it, if a manager elevated it).
 *
 * NOTE: this is distinct from `data_change_log` (field-level CRUD diffs written
 * by BaseModel.changeLog). audit_log is about ACTIONS/EVENTS, not row diffs.
 */

const AUDIT_EVENTS = {
  // Session / attendance
  LOGIN: 'login',
  LOGOUT: 'logout',
  CLOCK_IN: 'clock_in',
  CLOCK_OUT: 'clock_out',
  BREAK_START: 'break_start',
  BREAK_END: 'break_end',
  // Sale-sensitive actions
  SALE_VOID: 'sale_void',
  SALE_REFUND: 'sale_refund',
  DISCOUNT_APPLIED: 'discount_applied',
  PRICE_OVERRIDE: 'price_override',
  // Drawer / cash
  NO_SALE_OPEN_DRAWER: 'no_sale_open_drawer',
  CASH_IN: 'cash_in',
  CASH_OUT: 'cash_out',
  CASH_DROP: 'cash_drop',
  REGISTER_OPEN: 'register_open',
  REGISTER_CLOSE: 'register_close',
  // Authorization
  MANAGER_APPROVAL: 'manager_approval',
  ROLE_CHANGE: 'role_change',
  PERMISSION_CHANGE: 'permission_change',
};

module.exports = { AUDIT_EVENTS };
