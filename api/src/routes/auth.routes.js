const { loginLimiter, passwordResetLimiter } = require('../middleware/auth-rate-limit');
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Apply authentication middleware
const { protect, restrictTo, auth } = require('../middleware/auth');

/*
 * Registration is not public.
 *
 * This sat above router.use(protect), and the handler passed role straight from
 * the request body into User.create - a schema whose role enum includes "admin"
 * and "super_admin", and whose hasPermission returns true for everything when
 * role is "admin". So an unauthenticated stranger could POST a name, an email,
 * a password and role: "super_admin" and be signed in as one. The API router is
 * mounted at both /api and /, so it was reachable twice over.
 *
 * Nothing calls it. A real installation creates its first user through
 * /install/add, which checks the per-machine key and secret that main.js
 * generates - so this is closed rather than repaired, and the same guard is
 * used, which means a bootstrap still works and a stranger still cannot.
 */
const { verifyInstallationCredentials } = require('../middleware/install.validation');

router.post('/register', verifyInstallationCredentials, authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/verify', auth, authController.verifyToken);
router.post('/forgot-password', passwordResetLimiter, authController.forgotPassword);
router.patch('/reset-password/:token', authController.resetPassword);

/*
 * Support signing in as one of this shop's users, from the Posnic console.
 *
 * Necessarily above router.use(protect): its whole job is to establish a
 * session, so requiring one first would make it unreachable. It is not
 * unauthenticated - it requires a token signed with this shop's own
 * JWT_SECRET, valid for a minute, spendable once. See the controller for why
 * that adds no exposure the secret does not already carry.
 *
 * Rate limited with the same limiter as login. The token cannot be guessed, but
 * an endpoint that does database work per request is worth not leaving open to
 * being hammered.
 */
const { shadowLogin } = require('../controllers/shadow-login.controller');
router.get('/shadow', loginLimiter, shadowLogin);

// Protected routes (require authentication)
router.use(protect);

router.patch('/update-password', authController.updatePassword);
router.get('/me', authController.getMe);
router.patch('/update-me', authController.updateMe);
router.delete('/delete-me', authController.deleteMe);

// Admin routes (require admin role)
router.use(restrictTo('admin'));

router.route('/').get(authController.getAllUsers);

router
  .route('/:id')
  .get(authController.getUser)
  .patch(authController.updateUser)
  .delete(authController.deleteUser);

module.exports = router;
