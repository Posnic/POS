'use strict';

// A release rollback can serve HTML older than the browser's cached document.
// File dates cannot validate that document: it selects the runtime bundles.
// Always deliver the small shell; fingerprinted assets retain their own cache.
module.exports = function freshDocument(req, res, next) {
  if (
    (req.method === 'GET' || req.method === 'HEAD') &&
    (req.path === '/' || /\.html$/i.test(req.path))
  ) {
    delete req.headers['if-modified-since'];
    delete req.headers['if-none-match'];
  }
  next();
};
