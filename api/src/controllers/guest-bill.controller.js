'use strict';
const { createService } = require('../services/guest-bill.service');
const service = createService();
const run = (fn) => async (req, res) => {
  try {
    const data = await fn({ ...req.query, ...req.body });
    return res.json({ type: 'success', data });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Guest bill request failed:', error);
    return res
      .status(status)
      .json({
        type: 'error',
        message:
          status === 500 ? 'Could not prepare the guest bills. Please retry.' : error.message,
      });
  }
};
module.exports = {
  read: run(async (input) => (await service.read(input)).snapshot),
  send: run(service.send),
  latest: run(service.latest),
};
