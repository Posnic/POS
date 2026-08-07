const { query, validationResult } = require('express-validator');

const validateDashboardFilter = [
  query('filter')
    .optional()
    .isIn(['day', 'today', 'yesterday', 'week', 'month', 'year'])
    .withMessage('Invalid filter value. Must be one of: day, today, yesterday, week, month, year'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((err) => err.msg);
    return res.status(400).json({
      type: 'error',
      message: errorMessages.join(', '),
      data: null,
    });
  }
  next();
};

module.exports = {
  validateDashboardFilter,
  handleValidationErrors,
};
