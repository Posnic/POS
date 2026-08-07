const express = require('express');
const router = express.Router();
const branchesController = require('../controllers/branches.controller');
const { protect } = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const {
  validateBranch,
  validateBranchUpdate,
  handleValidationErrors,
} = require('../middleware/branches.validation');

// Bind controller methods so `this` remains the instance across routes
const bound = {
  getAll: branchesController.getAll.bind(branchesController),
  getOptions: branchesController.getOptions.bind(branchesController),
  getOneStore: branchesController.getOneStore.bind(branchesController),
  userRegisterBranchSelect: branchesController.userRegisterBranchSelect.bind(branchesController),
  getBranchList: branchesController.getBranchList.bind(branchesController),
  getBranchDetails: branchesController.getBranchDetails.bind(branchesController),
  getDataChanges: branchesController.getDataChanges.bind(branchesController),
  exportBranches: branchesController.exportBranches.bind(branchesController),
  getBranchRegisterList: branchesController.getBranchRegisterList.bind(branchesController),
  getStats: branchesController.getStats.bind(branchesController),
  search: branchesController.search.bind(branchesController),
  toggleStatus: branchesController.toggleStatus.bind(branchesController),
  getOne: branchesController.getOne.bind(branchesController),
  add: branchesController.add.bind(branchesController),
  edit: branchesController.edit.bind(branchesController),
  delete: branchesController.delete.bind(branchesController),
  resetPaymentGateway: branchesController.resetPaymentGateway.bind(branchesController),
  resetPhonepePaymentGateway:
    branchesController.resetPhonepePaymentGateway.bind(branchesController),
  resetEmailSetting: branchesController.resetEmailSetting.bind(branchesController),
};

router.use(protect);

// GET /api/branches - Get all branches
router.get('/', bound.getAll);

// GET /api/branches/options - Get branch options for dropdown
router.get('/options', bound.getOptions);

// Legacy route for branch list (frontend expects this once authenticated)
router.get('/getBranchList', bound.getBranchList);

// Legacy route for branch registers (used by Frontend)
router.get('/userRegisterBranchSelect', bound.userRegisterBranchSelect);

// Legacy route for store details
router.get('/getOneStore', bound.getOneStore);

// PHP: getBranchDetails() - Get branch details
router.get('/getBranchDetails', bound.getBranchDetails);

// PHP: getDataChanges() - Data sync
router.get('/getDataChanges', bound.getDataChanges);

// PHP: exportBranches() - Export to Excel
router.post('/exportBranches', bound.exportBranches);

// PHP: getBranchRegisterList() - Get branch registers
router.get('/getBranchRegisterList', bound.getBranchRegisterList);

// PHP: resetPaymentGateway()
router.get('/resetPaymentGateway', bound.resetPaymentGateway);

// PHP: resetPhonepePaymentGateway()
router.get('/resetPhonepePaymentGateway', bound.resetPhonepePaymentGateway);

// PHP: resetEmailSetting()
router.get('/resetEmailSetting', bound.resetEmailSetting);

// GET /api/branches/stats - Get branch statistics
router.get('/stats', bound.getStats);

// GET /api/branches/search - Search branches
router.get('/search', bound.search);

// Middleware to ensure valid ObjectId for /:id routes
const ensureValidBranchId = (req, res, next) => {
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({
      type: 'error',
      message: 'Invalid branch ID format. ID must be a 24 character hex string.',
      data: null,
    });
  }
  next();
};

// PATCH /api/branches/:id/toggle-status - Toggle branch status
router.patch('/:id/toggle-status', ensureValidBranchId, bound.toggleStatus);

// GET /api/branches/:id - Get branch by ID
router.get('/:id', ensureValidBranchId, bound.getOne);

// POST /api/branches - Create new branch
router.post('/', validateBranch, handleValidationErrors, bound.add);

// PUT /api/branches/:id - Update branch
router.put('/:id', ensureValidBranchId, validateBranchUpdate, handleValidationErrors, bound.edit);

// DELETE /api/branches/delete - Delete branch (legacy PHP endpoint, expects body.data)
router.delete('/delete', bound.delete);

// DELETE /api/branches/:id - Delete branch (RESTful endpoint, expects :id in URL)
router.delete('/:id', ensureValidBranchId, bound.delete);

module.exports = router;
