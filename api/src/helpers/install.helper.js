// src/helpers/install.helper.js
const { ObjectId } = require('mongodb');

/**
 * Install Helper Functions
 * Utility functions for installation operations
 */

/**
 * Validate ObjectId format
 * @param {string} id - ID to validate
 * @returns {boolean}
 */
const isValidObjectId = (id) => {
  return ObjectId.isValid(id);
};

/**
 * Convert string to ObjectId
 * @param {string|ObjectId} id - ID to convert
 * @returns {ObjectId|null}
 */
const toObjectId = (id) => {
  if (id instanceof ObjectId) {
    return id;
  }
  if (typeof id === 'string' && ObjectId.isValid(id)) {
    return new ObjectId(id);
  }
  return null;
};

/* Every way a caller has said yes to demo data. Compared lower-cased and
   trimmed, so 'Yes' and ' on ' are the same answer as 'yes'. */
const TRUTHY_DEMO = new Set(['yes', 'on', 'true', '1', 'y']);

/**
 * Sanitize installation data
 * @param {Object} data - Raw installation data
 * @returns {Object}
 */

const sanitizeInstallData = (data) => {
  return {
    register_companyname: (data.register_companyname || '').trim(),
    register_username: (data.register_username || '').trim(),
    register_useremail: (data.register_useremail || '').trim(),
    register_userphone: (data.register_userphone || '').trim(),
    register_userpassword: (data.register_userpassword || '').trim(),
    register_license: (data.register_license || '').trim(),
    register_firstname: (data.register_firstname || '').trim(),
    register_lastname: (data.register_lastname || '').trim(),
    register_address: (data.register_address || '').trim(),
    register_fullnumber: (data.register_fullnumber || '').trim(),
    register_country: (data.register_country || '').trim(),
    register_countryid: (data.register_countryid || '').trim(),
    register_state: (data.register_state || '').trim(),
    register_timezone: (data.register_timezone || '').trim(),
    /*
     * The provisioner's words, not ours.
     *
     * Gateway sends `register_demo: 'yes'` and `business: 'retail'`
     * (apps/provisioner/provision.js). This side checked for `'on'` and read
     * `businessType`, so BOTH missed - every cloud shop was created with no
     * demo data at all and, had it run, always the supermarket pack.
     *
     * Silent, because each miss has a plausible fallback: no demo data looks
     * like a shop that asked for none, and a supermarket pack looks like a
     * default somebody chose. A new customer opened their till and found one
     * product in it.
     *
     * Normalised here rather than changed in Gateway: this is the side that
     * consumes the value, it already normalises businessType for the pack
     * lookup, and a provisioner mid-flight for live signups is the wrong
     * thing to edit to fix a reader.
     */
    register_demo: TRUTHY_DEMO.has(
      String(data.register_demo == null ? '' : data.register_demo)
        .trim()
        .toLowerCase()
    ),
    businessType: (data.businessType || data.business || '').trim(),
  };
};

/**
 * Format installation response
 * @param {boolean} status - Success status
 * @param {*} data - Response data
 * @param {string} message - Response message
 * @returns {Object}
 */
const formatInstallResponse = (status, data, message) => {
  return {
    status,
    data,
    message,
  };
};

module.exports = {
  isValidObjectId,
  toObjectId,
  sanitizeInstallData,
  formatInstallResponse,
};
