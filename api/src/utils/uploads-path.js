'use strict';
const path = require('node:path');

// Desktop files belong with retained shop data, never with replaceable binaries.
// Cloud installations retain their established uploads directory unless configured.
module.exports = process.env.POSNIC_UPLOADS_DIR
  ? path.resolve(process.env.POSNIC_UPLOADS_DIR)
  : path.join(__dirname, '..', '..', 'uploads');
