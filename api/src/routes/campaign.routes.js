const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaign.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler === 'function') return handler.bind(campaignController);
  return (req, res) => campaignController.error(res, 'Handler not implemented', 501);
};

// Every campaign route needs an authenticated user (sets req.user + tenant context).
router.use(protect);

// Audience reach for a segment, and the scheduled-run tick. Before /:id routes.
router.post('/preview', bindController(campaignController.preview));
router.post('/run-due', bindController(campaignController.runDue));

// CRUD.
router.get('/', bindController(campaignController.list));
router.post('/', bindController(campaignController.create));
router.get('/:id', bindController(campaignController.get));
router.put('/:id', bindController(campaignController.update));
router.delete('/:id', bindController(campaignController.remove));

// Actions on a campaign.
router.post('/:id/send', bindController(campaignController.send));
router.post('/:id/schedule', bindController(campaignController.schedule));

module.exports = router;
