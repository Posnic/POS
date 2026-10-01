'use strict';

const express = require('express');
const controller = require('../controllers/ask-posnic.controller');
const { protect } = require('../middleware/auth');
const { knowledgeUpload } = require('../middleware/upload');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();
router.use(protect);
router.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `${String(req.tenantContext?.licenseId || req.user?.license || '')}:${String(req.user?._id || req.user?.id || '')}` }));
router.get('/status', controller.status.bind(controller));
router.get('/recovery', controller.recoveryStatus.bind(controller));
router.post('/ask', controller.ask.bind(controller));
router.get('/documents', controller.documents.bind(controller));
router.get('/documents/:id', controller.document.bind(controller));
router.post('/documents', controller.addDocument.bind(controller));
router.post('/documents/upload', knowledgeUpload.single('file'), controller.uploadDocument.bind(controller));
router.post('/documents/import-bundle', controller.importKnowledgeBundle.bind(controller));
router.patch('/documents/:id/status', controller.documentStatus.bind(controller));
router.get('/history', controller.history.bind(controller));
router.delete('/history', controller.deleteHistory.bind(controller));
router.get('/audit', controller.audit.bind(controller));
router.post('/feedback', controller.feedback.bind(controller));
router.post('/actions/draft', controller.createDraft.bind(controller));
router.post('/actions/confirm', controller.confirmDraft.bind(controller));
router.get('/actions/:id', controller.actionOutcome.bind(controller));
router.post('/actions/:id/resume', controller.resumeDraft.bind(controller));
router.get('/supplier-messages', controller.supplierMessages.bind(controller));
router.get('/preferences', controller.preferences.bind(controller));
router.put('/preferences', controller.savePreferences.bind(controller));
router.get('/schedules', controller.listSchedules.bind(controller));
router.post('/schedules', controller.saveSchedule.bind(controller));
router.delete('/schedules/:id', controller.removeSchedule.bind(controller));
router.post('/schedules/:id/resume', controller.resumeSchedule.bind(controller));
router.post('/schedules/run-due', controller.runSchedules.bind(controller));

module.exports = router;
