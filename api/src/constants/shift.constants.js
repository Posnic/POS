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

/*
 * Forgot-to-clock-out safeguard. A shift still open after STALE_AFTER_MINUTES
 * is treated as forgotten: the next clock action for that user auto-closes it,
 * capping the worked time at AUTO_CLOCKOUT_CAP_MINUTES (gross, before breaks)
 * so one forgotten tap can't book a 30-hour day. Auto-closes are flagged in
 * the note and audited; a manager corrects the exact times via the timecard.
 */
const STALE_SHIFT_AFTER_MINUTES = 16 * 60;
const AUTO_CLOCKOUT_CAP_MINUTES = 12 * 60;

module.exports = { SHIFT_STATUS, STALE_SHIFT_AFTER_MINUTES, AUTO_CLOCKOUT_CAP_MINUTES };
