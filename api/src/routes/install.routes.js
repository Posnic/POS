const express = require('express');
const router = express.Router();
const installController = require('../controllers/install.controller');
const {
  validateInstallation,
  validateCleanup,
  verifyInstallationCredentials,
} = require('../middleware/install.validation');

/**
 * POST /api/install/add - Install new Posnic account
 * Creates user, branch, default customer/supplier, taxes, and optionally demo data
 * Requires posnic_key and posnic_secret for authorization
 */
router.post('/add', verifyInstallationCredentials, validateInstallation, (req, res) =>
  installController.add(req, res)
);

// Alias for backward compatibility
router.post('/', verifyInstallationCredentials, validateInstallation, (req, res) =>
  installController.add(req, res)
);

/**
 * POST /api/install/cleanup - Cleanup all data by license ID
 * Removes all records from all collections for the specified license
 * Requires posnic_key and posnic_secret for authorization
 */
router.post('/cleanup', verifyInstallationCredentials, validateCleanup, (req, res) =>
  installController.cleanup(req, res)
);

module.exports = router;
