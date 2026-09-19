const express = require('express');
const router = express.Router();
const authUtilsController = require('../controllers/auth-utils.controller');
const { protect } = require('../middleware/auth');

// Apply authentication middleware to all routes in this file
router.use(protect);

// POST /api/authutils/sign-token - Sign a new token
router.post('/sign-token', (req, res, next) => {
  try {
    const token = authUtilsController.signToken(req.user.id, req.user.authVersion);
    res.status(200).json({ status: 'success', token });
  } catch (error) {
    next(error);
  }
});

// POST /api/authutils/verify-token - Verify a token
router.post('/verify-token', (req, res, next) => {
  try {
    const token = authUtilsController.getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }
    const decoded = authUtilsController.verifyToken(token);
    res.status(200).json({ status: 'success', data: { user: decoded } });
  } catch (error) {
    next(error);
  }
});

// POST /api/authutils/refresh-token - Refresh an expired token
router.post('/refresh-token', async (req, res, next) => {
  try {
    const token = authUtilsController.getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }
    const decoded = await authUtilsController.verifyToken(token);
    if (
      String(decoded.id) !== String(req.user._id || req.user.id) ||
      !require('../utils/auth-version').current(req.user, decoded)
    ) {
      return res.status(401).json({ status: 'error', message: 'Please sign in again.' });
    }
    const newToken = authUtilsController.signToken(decoded.id, req.user.authVersion);
    res.status(200).json({ status: 'success', token: newToken });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
