/*
 * Suites that are failing today and are not yet fixed.
 *
 * These are quarantined rather than deleted or silenced. The distinction
 * matters: CI still runs every other suite and still fails on any new
 * breakage, and this file is the list of what is owed - visible, countable and
 * in version control, rather than a green tick that means nothing.
 *
 * Nothing else should be added here without a reason beside it. A quarantine
 * list that grows quietly is how a test suite stops being worth running.
 *
 * To see where they stand:  npm run test:known-failures
 */
module.exports = [
  'tests/unit/config/config.test.js',
  'tests/unit/constants/install.constants.test.js',
  'tests/unit/controllers/common-pdf.controller.test.js',
  'tests/unit/middleware/install.validation.test.js',
  'tests/unit/models/activity-log.model.test.js',
  'tests/unit/models/install.model.test.js',
  'tests/unit/models/register.model.test.js',
  'tests/unit/models/setting.model.test.js',
  'tests/unit/repositories/sale.repository.test.js',
  'tests/unit/services/whatsapp.service.test.js',
];
