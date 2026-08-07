const express = require('express');
const router = express.Router();
const commonPdfController = require('../controllers/common-pdf.controller');
const { protect } = require('../middleware/auth');

// POST /api/commonpdf/generate - Generate a PDF
router.post('/generate', protect, commonPdfController.generatePdf);

module.exports = router;
