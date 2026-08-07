const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');
const { protect } = require('../middleware/auth');

// Device, template, branch, and sale lookups are tenant-owned operations.
router.use(protect);

// Initialize WhatsApp connection
router.post('/initialize', (req, res) => whatsappController.initializeConnection(req, res));

// Get QR code
router.get('/getQRCode', (req, res) => whatsappController.getQRCode(req, res));

// Get connection status
router.get('/getStatus', (req, res) => whatsappController.getConnectionStatus(req, res));

// Logout
router.post('/logout', (req, res) => whatsappController.logout(req, res));

// Remove Device
router.post('/removeDevice', (req, res) => whatsappController.removeDevice(req, res));

// Send message
router.post('/sendMessage', (req, res) => whatsappController.sendMessage(req, res));

// Template management routes
router.post('/saveTemplate', (req, res) => whatsappController.saveTemplate(req, res));
router.post('/updateTemplate', (req, res) => whatsappController.updateTemplate(req, res));
router.get('/getTemplates', (req, res) => whatsappController.getTemplates(req, res));
router.post('/deleteTemplate', (req, res) => whatsappController.deleteTemplate(req, res));
router.post('/getSalesReceiptTemplate', (req, res) =>
  whatsappController.getSalesReceiptTemplate(req, res)
);

module.exports = router;
