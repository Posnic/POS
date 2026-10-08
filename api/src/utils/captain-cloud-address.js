'use strict';

// The explicit manager setting takes precedence over verified cloud discovery.
module.exports = (branch) => branch.captain_fallback_url || branch.captain_cloud_url || null;
