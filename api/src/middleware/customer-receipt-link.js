'use strict';

// Customer links carry an encrypted receipt identifier. Never expose the
// controller's plain-ID compatibility path to an anonymous caller.
module.exports = function customerReceiptLink(req, res, next) {
  const token = req.query.customer_id || req.query.id || req.params.id;
  try {
    if (typeof token !== 'string' || token.length > 512) throw new Error('Invalid link');
    const encryption = require('../utils/encryption');
    const normalized = token.replace(/ /g, '+').trim();
    const id = encryption.decryptId(normalized);
    if (!/^[a-f0-9]{24}$/i.test(id) || encryption.generateEncryptedId(id) !== normalized)
      throw new Error('Invalid link');
    return next();
  } catch {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: 'This receipt link is invalid. Ask the shop to send it again.',
      data: null,
    });
  }
};
