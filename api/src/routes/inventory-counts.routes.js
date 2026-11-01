'use strict';

const router = require('express').Router();
const controller = require('../controllers/inventory-counts.controller');
const { protect } = require('../middleware/auth');
router.use(protect);
const sheets = require('../services/stock-count-sheet');
const upload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const sheetAction = fn => async (req, res) => {
  try { res.json({ type: 'success', data: await fn(await sheets.scoped(req)) }); }
  catch (e) { res.status(e.status || 400).json({ type: 'error', message: e.message }); }
};
const inventory = require('../services/mobile-inventory');
const spoilage = require('../services/spoilage');
const spoilageSheet = require('../services/spoilage-sheet');
router.get('/spoilage-sheet', sheetAction(spoilageSheet.download));
router.post('/spoilage-sheet', upload.single('file'), sheetAction(spoilageSheet.upload));
router.get('/spoilage', sheetAction(spoilage.list));
router.post('/spoilage', sheetAction(spoilage.save));
router.get('/spoilage/report', sheetAction(spoilage.report));
router.get('/spoilage/policy', sheetAction(spoilage.policy));
router.post('/spoilage/policy', sheetAction(spoilage.policy));
router.post('/spoilage/record', sheetAction(spoilage.record));
router.post('/spoilage/:id/apply', sheetAction(spoilage.applyNow));
router.post('/spoilage/:id/undo', sheetAction(spoilage.undo));
router.get('/spoilage/:id', sheetAction(spoilage.get));
router.post('/spoilage/:id/submit', sheetAction(spoilage.submit));
router.post('/spoilage/:id/decision', sheetAction(spoilage.decide));
router.post('/spoilage/:id/reverse', sheetAction(spoilage.reverse));
router.get('/catalogue', sheetAction(inventory.catalogue));
router.post('/audit', sheetAction(inventory.prepare));
router.get('/audit/:id', sheetAction(inventory.get));
router.post('/audit/:id/confirm', sheetAction(inventory.confirm));
router.post('/audit/:id/cancel', sheetAction(inventory.cancel));
router.get('/audit/:id/report', sheetAction(sheets.report));
router.get('/sheet', sheetAction(sheets.download));
router.post('/sheet', upload.single('file'), sheetAction(sheets.upload));
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.get);
module.exports = router;
