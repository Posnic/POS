'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/settings-groups.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

/*
 * One endpoint per settings group (D2). Each knows only its own keys, so the
 * partial-save failures that came from a single endpoint serving every
 * screen cannot be expressed here. `group` is validated against the group
 * map - an unknown one is a 404, never a guess.
 *
 * GET /settings/group/secrets reports WHICH credentials are set, never their
 * values, and only to an owner-class account.
 */
router.get('/:group', controller.read);
router.put('/:group', controller.write);

module.exports = router;
