/**
 * Shift / attendance constants (Phase 4).
 *
 * A SHIFT is one clock-in -> clock-out cycle for a staff member. It underpins
 * attendance, the labour/payout reports (Phase 5) and ties a person's worked
 * time to the register sessions they ran.
 */

const SHIFT_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed',
};

module.exports = { SHIFT_STATUS };
