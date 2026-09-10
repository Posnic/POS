'use strict';

/**
 * Unit tests for src/utils/order-approval.js
 *
 * The two that matter: which way this fails when the setting cannot be read,
 * and that accepting twice does not print two tickets.
 */

const {
  APPROVAL,
  ORDER_STATE,
  approvalMode,
  decideOnArrival,
  needsApproval,
  transition,
} = require('../../../src/utils/order-approval');

describe('approvalMode', () => {
  test('manual is manual, however it is typed', () => {
    expect(approvalMode('manual')).toBe(APPROVAL.MANUAL);
    expect(approvalMode(' MANUAL ')).toBe(APPROVAL.MANUAL);
  });

  /*
   * WHICH WAY THIS FAILS, and why.
   *
   * An order that reaches the kitchen and should not have is a conversation.
   * An order that silently waits for an approval screen nobody knows to open
   * is a customer in a hotel room wondering where dinner is. So anything that
   * is not exactly "manual" is auto - a typo, a missing document, a half
   * migrated setting.
   */
  test('anything unreadable is auto, never a silent hold', () => {
    expect(approvalMode(undefined)).toBe(APPROVAL.AUTO);
    expect(approvalMode(null)).toBe(APPROVAL.AUTO);
    expect(approvalMode('')).toBe(APPROVAL.AUTO);
    expect(approvalMode('manuel')).toBe(APPROVAL.AUTO);
    expect(approvalMode(true)).toBe(APPROVAL.AUTO);
  });

  test('needsApproval agrees with it', () => {
    expect(needsApproval('manual')).toBe(true);
    expect(needsApproval('auto')).toBe(false);
    expect(needsApproval('nonsense')).toBe(false);
  });
});

describe('decideOnArrival', () => {
  test('auto accepts, prints, and makes a short noise', () => {
    expect(decideOnArrival('auto')).toEqual({
      state: ORDER_STATE.ACCEPTED,
      printKitchenTicket: true,
      alert: 'received',
    });
  });

  test('manual holds, prints nothing, and raises an alarm', () => {
    /* An alarm rather than a chime: nobody is watching this screen, and the
       point is to reach somebody in another room or on another page. */
    expect(decideOnArrival('manual')).toEqual({
      state: ORDER_STATE.PENDING,
      printKitchenTicket: false,
      alert: 'waiting',
    });
  });

  /* The state and the ticket travel together so a caller cannot save one and
     forget the other, leaving the kitchen and the screen disagreeing about
     what is cooking. */
  test('a held order never reports that it printed', () => {
    const held = decideOnArrival('manual');
    expect(held.state).toBe(ORDER_STATE.PENDING);
    expect(held.printKitchenTicket).toBe(false);
  });
});

describe('transition', () => {
  test('accepting a pending order prints the ticket', () => {
    expect(transition(ORDER_STATE.PENDING, ORDER_STATE.ACCEPTED)).toMatchObject({
      allowed: true,
      state: ORDER_STATE.ACCEPTED,
      printKitchenTicket: true,
    });
  });

  test('rejecting a pending order prints nothing', () => {
    expect(transition(ORDER_STATE.PENDING, ORDER_STATE.REJECTED)).toMatchObject({
      allowed: true,
      state: ORDER_STATE.REJECTED,
      printKitchenTicket: false,
    });
  });

  /*
   * THE DOUBLE TAP.
   *
   * A slow screen and an impatient thumb is the ordinary way this happens, and
   * two tickets for one order is two lots of food. Not an error - nothing has
   * gone wrong - but nothing prints either.
   */
  test('accepting twice does not print a second ticket', () => {
    const again = transition(ORDER_STATE.ACCEPTED, ORDER_STATE.ACCEPTED);
    expect(again.allowed).toBe(true);
    expect(again.printKitchenTicket).toBe(false);
  });

  /*
   * Rejecting food the kitchen has already started is not a state change. It
   * is a conversation and then a void, and a void is a different operation
   * with its own audit trail that this must not quietly stand in for.
   */
  test('an accepted order cannot be rejected out from under the kitchen', () => {
    const late = transition(ORDER_STATE.ACCEPTED, ORDER_STATE.REJECTED);
    expect(late.allowed).toBe(false);
    expect(late.state).toBe(ORDER_STATE.ACCEPTED);
    expect(late.reason).toMatch(/already accepted/);
  });

  test('a rejected order does not come back', () => {
    expect(transition(ORDER_STATE.REJECTED, ORDER_STATE.ACCEPTED).allowed).toBe(false);
  });

  test('an unknown target is refused rather than guessed', () => {
    const out = transition(ORDER_STATE.PENDING, 'cooked');
    expect(out.allowed).toBe(false);
    expect(out.printKitchenTicket).toBe(false);
  });

  test('an order with no state yet is treated as pending', () => {
    expect(transition(undefined, ORDER_STATE.ACCEPTED)).toMatchObject({
      allowed: true,
      printKitchenTicket: true,
    });
  });
});
