const { loginLimiter, registerLimiter } = require('../middleware/auth-rate-limit');
const express = require('express');
const router = express.Router();
const userController = require('../controllers/users.controller');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { ObjectId } = require('mongodb');
const {
  validateUser,
  validateLogin,
  validatePasswordUpdate,
  validateUserVerify,
  validateChangeBranch,
  validateUserProfile,
  handleValidationErrors,
} = require('../middleware/users.validation');

const bindController = (handler) => handler.bind(userController);

// Public routes
router.post(
  '/register',
  registerLimiter,
  validateUser,
  handleValidationErrors,
  bindController(userController.add)
);
router.post('/login', loginLimiter, bindController(userController.login));

// Legacy login endpoint - keeps existing Frontend (/users/verify) working
router.post(
  '/verify',
  loginLimiter,
  validateLogin,
  handleValidationErrors,
  bindController(userController.legacyVerifyLogin)
);

// PHP: mobileLogin() - Mobile app login (public)
router.post(
  '/mobileLogin',
  validateLogin,
  handleValidationErrors,
  bindController(userController.mobileLogin)
);

// PHP: kioskMobileLogin() - Kiosk mobile app login (public)
router.post(
  '/kioskMobileLogin',
  validateLogin,
  handleValidationErrors,
  bindController(userController.kioskMobileLogin)
);

// PHP: ssoAuth() - SSO authentication (public)
router.get('/ssoAuth', bindController(userController.ssoAuth));

// PHP: ssoToken() - Generate SSO token (internal, requires posnic keys)
router.post('/ssoToken/:key/:secret', bindController(userController.ssoToken));

// PHP: planUpdate() - Update user plan (internal, requires posnic keys)
router.post('/planUpdate/:key/:secret', bindController(userController.planUpdate));

// PHP: getUserKeyDetails() - Verify user key for password reset (public)
router.get('/getUserKeyDetails', bindController(userController.getUserKeyDetails));

// PHP: updateNewPassword() - Update password using forgot password key (public)
router.post(
  '/updateNewPassword',
  validatePasswordUpdate,
  handleValidationErrors,
  bindController(userController.updateNewPassword)
);

// Token verification endpoint (public)
router.get('/verify-token', protect, (req, res) => {
  // If we reach here, the token is valid (validated by protect middleware)
  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    },
  });
});

// Protected routes (require authentication)
router.use(protect);

// Legacy branch selection endpoints (require auth but not admin)
router.get('/userBranchSelection', bindController(userController.userBranchSelection));
router.get('/userDefaultBranchSet', bindController(userController.userDefaultBranchSet));
router.get('/getUserRegisterList', bindController(userController.getUserRegisterList));
router
  .route('/getUserAccessDetails')
  .get(bindController(userController.getUserAccessDetails))
  .post(bindController(userController.getUserAccessDetails));

// User profile routes
router.get('/me', (req, res) => {
  req.params = { id: req.user._id };
  return userController.getOne(req, res);
});

router.patch('/update-me', upload.single('photo'), (req, res) => {
  req.params = { id: req.user._id };
  return userController.edit(req, res);
});

// Password update
router.patch('/update-password', bindController(userController.updatePassword));

// Deactivate account
router.delete('/deactivate-me', (req, res) => {
  req.params = { id: req.user._id };
  return userController.delete(req, res);
});

// Admin user management routes
router
  .route('/')
  .get(bindController(userController.getAll))
  .post(validateUser, handleValidationErrors, bindController(userController.add))
  .delete(bindController(userController.delete));

// Legacy route aliases for frontend compatibility
router.get('/listAll', bindController(userController.getAll));
router.delete('/delete', bindController(userController.delete));

// Legacy report route that frontend still requests under /users
router.get('/userstatusReportTable', bindController(userController.userstatusReportTable));

// PHP: getUserDetails() - Get user details
router.get('/getUserDetails', bindController(userController.getUserDetails));

// PHP: getDataChanges() - Data sync
router.get('/getDataChanges', bindController(userController.getDataChanges));

// PHP: exportUsers() - Export to Excel
router.post('/exportUsers', bindController(userController.exportUsers));

// PHP: getUserAjaxList() - Ajax autocomplete
router.get('/getUserAjaxList', bindController(userController.getUserAjaxList));

// PHP: uploadUserImage() - Upload image
router.post(
  '/uploadUserImage',
  upload.single('ImageUser'),
  bindController(userController.uploadUserImage)
);

// PHP: userImageDelete() - Delete image
router.delete('/userImageDelete', bindController(userController.userImageDelete));

// PHP: updatePrintSetting() - Update print settings
router.post('/updatePrintSetting', bindController(userController.updatePrintSetting));

// PHP: printType() - Get print types
router.get('/printType', bindController(userController.printType));

// PHP: userProfile() - Update user profile
router.post(
  '/userProfile',
  validateUserProfile,
  handleValidationErrors,
  bindController(userController.userProfile)
);

// PHP: logOut() - Logout user
router.get('/logOut', protect, bindController(userController.logOut));
router.post('/logOut', protect, bindController(userController.logOut));

// PHP: changeBranch() - Change active branch
router.post(
  '/changeBranch',
  validateChangeBranch,
  handleValidationErrors,
  bindController(userController.changeBranch)
);

// PHP: userVerify() - Verify user for danger zone operations
router.get(
  '/userVerify',
  validateUserVerify,
  handleValidationErrors,
  bindController(userController.userVerify)
);

// PHP: ssoClientLogin() - SSO client login redirect (requires authentication)
router.post('/ssoClientLogin', protect, bindController(userController.ssoClientLogin));

// Middleware to ensure valid ObjectId for /:id routes
const ensureValidUserId = (req, res, next) => {
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({
      type: 'error',
      message: 'Invalid user ID format. ID must be a 24 character hex string.',
      data: null,
    });
  }
  next();
};

router
  .route('/:id')
  .get(ensureValidUserId, bindController(userController.getOne))
  .put(ensureValidUserId, validateUser, handleValidationErrors, bindController(userController.edit))
  .patch(
    ensureValidUserId,
    validateUser,
    handleValidationErrors,
    bindController(userController.edit)
  )
  .delete(ensureValidUserId, bindController(userController.delete));

module.exports = router;
