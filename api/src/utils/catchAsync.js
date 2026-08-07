/**
 * A utility function to catch errors in async/await functions and pass them to the error handling middleware
 * @param {Function} fn - The async function to wrap
 * @returns {Function} A middleware function that handles errors
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    // Ensure the function is called with proper context and handle both sync/async errors
    return Promise.resolve()
      .then(() => fn(req, res, next))
      .catch((err) => next(err));
  };
};

module.exports = catchAsync;
