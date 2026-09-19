'use strict';

/*
 * THE PHONES THIS SHOP HAS, AND THE SWITCH THAT STOPS ONE.
 *
 * Owner: "map device to cloud account."
 *
 * A handset signs in with a username and a password and is given a token that
 * lasts thirty days, because a part-time waiter who does not know the shop's
 * password cannot be made to find a manager every morning. That is right, and
 * it is only safe while the shop can stop one phone without stopping the rest.
 *
 * So: a list of what has signed in, and a switch beside each one.
 *
 * WHY A LIST AND NOT A COUNT. "Four handsets" is not a thing anybody can act
 * on. The model, who last used it, and when it was last seen are what let
 * somebody point at the row that is the phone left in a taxi last night.
 *
 * Behind `protect`, so this is the till and the browser, never the handset:
 * a phone cannot list the shop's phones, and cannot turn another one off.
 */

const express = require('express');
const mongoose = require('mongoose');

const { protect } = require('../middleware/auth');
const { handsetLimiter } = require('../middleware/auth-rate-limit');
const { currentConnection } = require('../db/tenant-context');
const handsets = require('../utils/handsets');

const router = express.Router();

router.use(protect, handsetLimiter);

const db = () => currentConnection(mongoose.connection).db;

/** Who may see the shop's handsets, and turn one off. */
// Accounts use super_admin; retain superadmin for older shop records.
const MAY = new Set(['admin', 'owner', 'manager', 'super_admin', 'superadmin']);
const allowed = (user) => MAY.has(String(user?.usertype || user?.role || '').toLowerCase());

const refuse = (res) =>
  res.status(403).json({
    type: 'error',
    status: false,
    message: "You do not have permission to manage this shop's handsets",
    data: null,
  });

router.get('/', async (req, res) => {
  if (!allowed(req.user)) return refuse(res);

  const rows = await handsets.list(db());
  return res.status(200).json({
    type: 'success',
    status: true,
    message: rows.length ? 'Handsets' : 'No handset has signed in yet',
    data: rows,
  });
});

/*
 * Two verbs rather than a flag on one, because these are two different things
 * to do and one of them is the one somebody does in a hurry, on a phone, in
 * the dark, having just realised a handset is gone.
 */
router.post('/:deviceId/revoke', async (req, res) => {
  if (!allowed(req.user)) return refuse(res);

  const found = await handsets.setRevoked(
    db(),
    req.params.deviceId,
    true,
    req.user?.username || req.user?.email || ''
  );

  if (!found) {
    return res.status(404).json({
      type: 'error',
      status: false,
      message: 'No handset with that id has signed in to this shop',
      data: null,
    });
  }

  /*
   * Said plainly, because the thing somebody wants to know next is whether it
   * is done yet. It is, for this process; another process serving the same
   * shop reads its own answer within half a minute. See utils/handsets.js.
   */
  return res.status(200).json({
    type: 'success',
    status: true,
    message: 'That phone is turned off. Signing in on it again will let it back.',
    data: null,
  });
});

router.post('/:deviceId/allow', async (req, res) => {
  if (!allowed(req.user)) return refuse(res);

  const found = await handsets.setRevoked(db(), req.params.deviceId, false, '');
  if (!found) {
    return res.status(404).json({
      type: 'error',
      status: false,
      message: 'No handset with that id has signed in to this shop',
      data: null,
    });
  }

  return res.status(200).json({
    type: 'success',
    status: true,
    message: 'That phone may be used again',
    data: null,
  });
});

module.exports = router;
