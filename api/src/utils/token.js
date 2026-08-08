const jwt = require('jsonwebtoken');
const crypto = require('crypto');
/* Read per request, not at module load. In a process serving one shop this is
   process.env exactly as before; in a process serving several it is the shop
   the request belongs to, and an error rather than a guess if there is none. */
const { currentSecret } = require('../db/tenant-context');

const generateToken = (id) => {
  return jwt.sign({ id }, currentSecret('JWT_SECRET'), {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const verifyToken = (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, currentSecret('JWT_SECRET'), (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
};

const generateRandomToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
  generateToken,
  verifyToken,
  generateRandomToken,
  hashToken,
};
