const express = require('express');
const router = express.Router();
const BaseController = require('../controllers/base.controller');
const { protect, optionalProtect } = require('../middleware/auth');

const baseController = new BaseController();
const bindController = (handler) => handler.bind(baseController);

// Health check endpoints (no auth required)
router.get('/', (req, res) => {
  return baseController.success(res, { status: 'running' }, 'API is running');
});

/*
 * Health, at two levels of detail.
 *
 * This used to answer every caller with the exact Node version, the platform,
 * the environment name and live memory figures. A monitor needs none of that -
 * it needs to know whether the answer arrives - while an attacker choosing
 * which published Node vulnerability to try wants precisely that list, and this
 * endpoint handed it over without being asked for a password.
 *
 * So the public answer is whether it is up. The detail is still there for
 * anyone who has logged in, which is who was ever meant to read it.
 */
router.get('/health', optionalProtect, (req, res) => {
  const health = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  if (req.user) {
    Object.assign(health, {
      memory: process.memoryUsage(),
      node: process.version,
      platform: process.platform,
      env: process.env.NODE_ENV || 'development',
    });
  }

  return baseController.success(res, health, 'API is healthy');
});

// Autocomplete/suggestion endpoints
router.get(
  '/autoSuggestionTableField',
  protect,
  bindController(baseController.autoSuggestionTableField)
);
router.get(
  '/autoSuggestionReportTableField',
  protect,
  bindController(baseController.autoSuggestionReportTableField)
);
router.get('/getDefaultSuggest', protect, bindController(baseController.getDefaultSuggest));

module.exports = router;
