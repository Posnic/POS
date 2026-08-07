const tokenTypes = {
  ACCESS: 'access',
  REFRESH: 'refresh',
  RESET_PASSWORD: 'resetPassword',
  VERIFY_EMAIL: 'verifyEmail',
};

const tokenExpiration = {
  ACCESS: '15m', // 15 minutes
  REFRESH: '7d', // 7 days
  RESET_PASSWORD: '10m', // 10 minutes
  VERIFY_EMAIL: '24h', // 24 hours
};

module.exports = {
  tokenTypes,
  tokenExpiration,
};
