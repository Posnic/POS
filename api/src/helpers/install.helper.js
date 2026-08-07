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
    register_demo: data.register_demo || false,
    businessType: (data.businessType || '').trim(),
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
