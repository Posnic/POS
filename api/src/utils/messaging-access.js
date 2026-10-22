'use strict';

const { resolveAccess } = require('./access-resolver');
const ACTIONS = Object.freeze([
  'send_whatsapp',
  'send_sms',
  'send_email',
  'send_bulk',
  'view_history',
  'manage_settings',
  'manage_reports',
  'manage_automation',
]);

// New grants are opt-in. General branch write access must never grant sending.
function allowed(user, action) {
  if (!ACTIONS.includes(action) || !user) return false;
  if (user.usertype === 'super_admin' || user.role === 'super_admin') return true;
  return resolveAccess(user).messaging?.[action] === true;
}
function matrix(user) {
  const grants = Object.fromEntries(ACTIONS.map((action) => [action, allowed(user, action)]));
  return { ...grants, read: Object.values(grants).some(Boolean) };
}
function sanitize(input) {
  return Object.fromEntries(ACTIONS.map((action) => [action, input?.[action] === true]));
}
function requireActions(...actions) {
  return (req, res, next) => {
    if (actions.every((action) => allowed(req.user, action))) return next();
    return res
      .status(403)
      .json({ type: 'error', message: 'Messaging permission required.', data: null });
  };
}
function requireAny(...actions) {
  return (req, res, next) => {
    if (actions.some((action) => allowed(req.user, action))) return next();
    return res
      .status(403)
      .json({ type: 'error', message: 'Messaging permission required.', data: null });
  };
}
function channelAction(channel) {
  return ['whatsapp', 'sms', 'email'].includes(channel) ? `send_${channel}` : null;
}
module.exports = { ACTIONS, allowed, matrix, sanitize, requireActions, requireAny, channelAction };
