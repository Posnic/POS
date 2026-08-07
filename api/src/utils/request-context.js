const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

const runWithRequestContext = (values, callback) => storage.run({ ...(values || {}) }, callback);

const getRequestContext = () => storage.getStore() || null;

const updateRequestContext = (values) => {
  const current = storage.getStore();
  if (current && values) Object.assign(current, values);
  return current || null;
};

module.exports = { getRequestContext, runWithRequestContext, updateRequestContext };
