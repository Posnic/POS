'use strict';

function validateSeconds(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error('Return to New Sale must be a whole number from 0 to 300 seconds');
  }
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300) {
    throw new Error('Return to New Sale must be a whole number from 0 to 300 seconds');
  }
  return seconds;
}

module.exports = { validateSeconds };
