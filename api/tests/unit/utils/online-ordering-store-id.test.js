'use strict';

/*
 * A store id nobody had to think of.
 *
 * Owner: "first store id dont wait for customer based store just assign
 * something." The id is the last part of the address customers use, and it
 * spent its life blank because the only way it got a value was a shopkeeper
 * inventing one. These pin the shape of the generated one, because the rest
 * of the system - the form's pattern, the route's regex, a printed card read
 * out over the phone - already has opinions about it.
 */

const {
  newStoreId,
  STORE_ID_ALPHABET,
  storeIdIsAvailable,
} = require('../../../src/utils/online-ordering');

/* The same rule the form, the route and the URL parser use. */
const SHAPE = /^[A-Za-z0-9]{3,6}$/;

test('a generated id is one the form, the route and the URL already accept', () => {
  for (let i = 0; i < 500; i += 1) {
    const id = newStoreId();
    expect(id).toMatch(SHAPE);
    expect(id).toHaveLength(5);
  }
});

test('nothing that can be misread over the phone', () => {
  /* No O or 0, no I, L or 1. A code under a QR on a table tent has to survive
     being read out to somebody, and those are the pairs that do not. */
  expect(STORE_ID_ALPHABET).not.toMatch(/[O0IL1]/);
  expect(STORE_ID_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  for (let i = 0; i < 500; i += 1) {
    expect(newStoreId()).not.toMatch(/[O0IL1]/);
  }
});

test('the randomness is injectable, so a caller can prove its retry loop', () => {
  /* Always the first letter: the caller that checks for collisions can drive
     one on purpose. */
  expect(newStoreId(() => 0)).toBe('AAAAA');
  /* And never off the end of the alphabet, whatever the source returns. */
  expect(newStoreId(() => 0.999999)).toMatch(SHAPE);
  expect(newStoreId(() => 1)).toMatch(SHAPE);
});

test('a generated id is never one of the words the route reserves', () => {
  /* /order/table/... and /order/venue/... are paths, not shops. The
     generator's alphabet has no lower case, which is what keeps it clear of
     them, and this says so rather than relying on it. */
  for (let i = 0; i < 200; i += 1) {
    expect(storeIdIsAvailable(newStoreId())).toBe(true);
  }
});
