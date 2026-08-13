const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { protect } = require('../middleware/auth');
const {
  validateDashboardFilter,
  handleValidationErrors,
} = require('../middleware/dashboard.validation');

const bindController = (handler) => handler.bind(dashboardController);

router.use(protect);

router.get('/welcome', bindController(dashboardController.getDashboardCurrentWish));
router.get('/getDashboardCurrentWish', bindController(dashboardController.getDashboardCurrentWish));
router.get(
  '/getDashboardPaymentModeData',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getDashboardPaymentModeData)
);
router.get(
  '/getPendingActivities',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getPendingActivities)
);
router.get(
  '/getDashboardTopPerformers',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getDashboardTopPerformers)
);
router.get(
  '/getDashboardBestSellingProducts',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getDashboardBestSellingProducts)
);
router.get(
  '/getDashboardTotalAmounts',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getDashboardTotalAmounts)
);
router.get(
  '/getDashboardSalesPurchase',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getDashboardSalesPurchase)
);
router.get(
  '/getDashboardExpiredProducts',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getDashboardExpiredProducts)
);
router.get(
  '/getProfitSummary',
  validateDashboardFilter,
  handleValidationErrors,
  bindController(dashboardController.getProfitSummary)
);

// Debug endpoint for session filter testing
router.get('/debug-session-filter', bindController(dashboardController.debugSessionFilter));

module.exports = router;
