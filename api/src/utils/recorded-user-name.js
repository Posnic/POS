'use strict';

// Use the recorded creator, never whoever happens to be viewing/editing a bill.
function recordedUserName(...values) {
  return (
    values
      .find(
        (value) =>
          typeof value === 'string' &&
          value.trim() &&
          !/^(undefined|null|\[object Object\])$/i.test(value.trim())
      )
      ?.trim() || ''
  );
}

module.exports = { recordedUserName };
