const BaseController = require('./base.controller');
const feedback = require('../services/help-feedback.service');
const base = new BaseController();

exports.getContext = (req, res) => base.success(res, feedback.context(req));

exports.submit = async (req, res) => {
  try {
    feedback.payload(req);
  } catch (error) {
    return res.status(400).json({ type: 'error', message: error.message });
  }
  try {
    const result = await feedback.submit(req);
    if (result.status !== 200)
      return res.status(result.status).json({ type: 'error', message: result.message });
    return base.success(
      res,
      { reference: result.reference },
      'Message received by Posnic support.'
    );
  } catch (_) {
    return res.status(503).json({
      type: 'error',
      message:
        'Could not reach support. Check your internet connection and retry. Your comment is kept.',
    });
  }
};
