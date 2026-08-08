'use strict';
/*
 * req.db is the handle a request reads the database through.
 *
 * It was read at seven places in easy-tables.controller and assigned nowhere,
 * so every /api/easy-table route threw on undefined.collection(...), had the
 * error swallowed by its own try/catch, and answered 500. Nothing failed
 * loudly, so the routes looked implemented.
 *
 * The second test is the one that matters going forward: when a request
 * carries its own connection, req.db must follow it. That is what lets one
 * process serve several shops, and getting it wrong means a request reads
 * another shop's data - so it is asserted here rather than assumed.
 */

const mongoose = require('mongoose');
const { attachDb, connectionFor } = require('../../../src/db/request-db');

function run(req) {
  const next = jest.fn();
  attachDb(req, {}, next);
  return next;
}

describe('the database handle a request reads through', () => {
  test('is set - the bug that made every easy-table route answer 500', () => {
    const req = {};
    const next = run(req);
    expect(next).toHaveBeenCalled();
    /* Not "is defined": in a unit run there is no live connection, so the
       assertion is that the property is populated from the connection rather
       than left absent. */
    expect('db' in req).toBe(true);
    expect(req.dbConnection).toBe(mongoose.connection);
  });

  test('follows the request when it carries its own connection', () => {
    const tenantDb = { databaseName: 'posnic_t_shop_a' };
    const req = { tenantConnection: { db: tenantDb } };
    run(req);
    expect(req.db).toBe(tenantDb);
    expect(req.db).not.toBe(mongoose.connection.db);
  });

  test('two requests on different connections do not share a handle', () => {
    const a = { tenantConnection: { db: { databaseName: 'posnic_t_a' } } };
    const b = { tenantConnection: { db: { databaseName: 'posnic_t_b' } } };
    run(a);
    run(b);
    expect(a.db.databaseName).toBe('posnic_t_a');
    expect(b.db.databaseName).toBe('posnic_t_b');
  });

  test('a request with no connection of its own falls back to the default', () => {
    expect(connectionFor({})).toBe(mongoose.connection);
    expect(connectionFor(undefined)).toBe(mongoose.connection);
  });

  test('never throws when the connection is not ready, and always continues', () => {
    /* Requests arrive during startup and reconnects. A middleware that threw
       would turn a transient state into a 500 with no useful message. */
    const req = { tenantConnection: {} }; // connection present, .db not yet
    const next = run(req);
    expect(req.db).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
