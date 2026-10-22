const { requireActions: messagingPermission, requireAny } = require('../utils/messaging-access');
const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');
const { protect } = require('../middleware/auth');

// Device, template, branch, and sale lookups are tenant-owned operations.
router.use(protect);

// Initialize WhatsApp connection
router.post('/initialize', messagingPermission('manage_settings'), (req, res) =>
  whatsappController.initializeConnection(req, res)
);

// Get QR code
router.get('/getQRCode', messagingPermission('manage_settings'), (req, res) =>
  whatsappController.getQRCode(req, res)
);

// Get connection status
router.get('/getStatus', requireAny('send_whatsapp', 'manage_settings'), (req, res) =>
  whatsappController.getConnectionStatus(req, res)
);

// Logout
router.post('/logout', messagingPermission('manage_settings'), (req, res) =>
  whatsappController.logout(req, res)
);

// Remove Device
router.post('/removeDevice', messagingPermission('manage_settings'), (req, res) =>
  whatsappController.removeDevice(req, res)
);

// Send message
router.post('/sendMessage', messagingPermission('send_whatsapp'), (req, res) =>
  whatsappController.sendMessage(req, res)
);

// Template management routes
router.post('/saveTemplate', messagingPermission('manage_automation'), (req, res) =>
  whatsappController.saveTemplate(req, res)
);
router.post('/updateTemplate', messagingPermission('manage_automation'), (req, res) =>
  whatsappController.updateTemplate(req, res)
);
router.get('/getTemplates', requireAny('send_whatsapp', 'manage_automation'), (req, res) =>
  whatsappController.getTemplates(req, res)
);
router.post('/deleteTemplate', messagingPermission('manage_automation'), (req, res) =>
  whatsappController.deleteTemplate(req, res)
);
router.post('/getSalesReceiptTemplate', messagingPermission('send_whatsapp'), (req, res) =>
  whatsappController.getSalesReceiptTemplate(req, res)
);

module.exports = router;
