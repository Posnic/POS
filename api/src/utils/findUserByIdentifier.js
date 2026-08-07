const mongoose = require('mongoose');
const User = require('../models/user.model');

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : value);

const lowerCase = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

async function findUserByIdentifier(identifier) {
  if (!identifier && identifier !== 0) {
    return null;
  }

  const normalized = normalizeString(identifier);
  if (!normalized) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(normalized)) {
    try {
      const byId = await User.findById(normalized).select('+license +branch_access');
      if (byId) {
        return byId;
      }
    } catch (error) {
      console.warn('findUserByIdentifier: failed to lookup by ObjectId', error.message);
    }
  }

  if (typeof normalized !== 'string') {
    return null;
  }

  const normalizedLower = lowerCase(normalized);
  const orConditions = [
    { username: normalizedLower },
    { username: normalized },
    { email: normalizedLower },
    { user_name: normalized },
    { sid: normalized },
    { userId: normalized },
    { name: normalized },
  ];

  return User.findOne({ $or: orConditions }).select('+license +branch_access');
}

module.exports = { findUserByIdentifier };
