'use strict';
/*
 * Serving an image, from whichever of the two places currently has it.
 *
 * The client asks for /uploads/<key> and does not know or care where the bytes
 * come from. That indirection is the entire reason a till and the web app can
 * render the same string: each resolves the relative path against its own
 * origin, and the server on the other end answers from whatever it has.
 *
 *     on disk        stream it. No network, so this works with the line down,
 *                    which is the case that matters - a shop mid-sale should
 *                    never wait on the internet to draw a product photo.
 *
 *     not on disk    fetch from S3 once, answer the request, and keep a copy.
 *                    A new till, or one that was reinstalled, heals itself the
 *                    first time somebody looks at each image.
 *
 * express.static still sits in front of this for the common case; this handles
 * the miss. Keys are content-addressed, so a file that exists is by definition
 * the right file and can be cached hard.
 */

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const store = require('../utils/image-store');

const router = express.Router();

/* A year. The key contains a hash of the contents, so the bytes behind a
   given URL can never change - a new image is a new key. */
const CACHE = 'public, max-age=31536000, immutable';

const TYPE_FOR = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function contentTypeFor(key) {
  return TYPE_FOR[String(key).split('.').pop().toLowerCase()] || 'application/octet-stream';
}

/* Only one fetch per key at a time. Ten tills opening the same screen would
   otherwise pull the same object ten times and write over each other. */
const inFlight = new Map();

/**
 * Pull an object from S3 and put it on the local disk.
 *
 * Returns null rather than throwing when it cannot: a missing image should be
 * a broken thumbnail, never a 500 on the page that contains it.
 */
async function fetchFromOrigin(key) {
  if (inFlight.has(key)) return inFlight.get(key);

  const work = (async () => {
    try {
      const s3 = require('../utils/s3');
      if (!process.env.AWS_S3_BUCKET) return null;

      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const res = await s3
        .getS3Client()
        .send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }));

      const chunks = [];
      for await (const c of res.Body) chunks.push(c);
      const buffer = Buffer.concat(chunks);

      /* Cache it, but do not fail the request if the disk will not take it -
         a full or read-only disk should still serve the image it just got. */
      try {
        await store.saveLocal(key, buffer);
      } catch (e) {
        /* nothing - the bytes below are what the caller actually needs */
      }
      return buffer;
    } catch (e) {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, work);
  return work;
}

router.get(/^\/(.+)$/, async (req, res) => {
  const key = req.params[0];

  /*
   * Anything that is not a key this system could have minted is refused
   * outright. The path reaches the filesystem, so ../ is the obvious risk -
   * and validating against the exact expected shape is a stronger guarantee
   * than trying to strip the dangerous parts out.
   */
  /*
   * A miss must NOT be cached. This route is fronted by Cloudflare, and the
   * one-year immutable header used to be set before the file was known to
   * exist - so an image requested before its file had synced returned a 404
   * carrying "cache for a year", Cloudflare stored the 404, and the picture
   * stayed broken for everyone long after the file arrived. Every 404 here
   * says no-store, so the very next request after the file lands is a fresh
   * miss that finds it.
   */
  const miss = (res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(404).end();
  };

  const legacy = !store.isValidKey(key) && store.isLegacyFile(key);
  if (!store.isValidKey(key) && !legacy) {
    return miss(res);
  }

  /* Legacy files keep their own sub-path (item_images/<file>); the regex
     guarantees every segment starts alphanumeric, so no traversal. */
  const local = legacy ? path.join(store.UPLOAD_DIR, key) : store.localPathFor(key);

  const hit = (stream) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Content-Type', contentTypeFor(key));
    res.set('Cache-Control', CACHE); // only now, when the bytes are real
    return stream;
  };

  if (local && fs.existsSync(local)) {
    return fs
      .createReadStream(local)
      .on('error', () => miss(res))
      .pipe(hit(res));
  }

  /* An old flat file has no S3 counterpart to fall back to - it only ever
     existed on the machine that received the upload. */
  if (legacy) return miss(res);

  const buffer = await fetchFromOrigin(key);
  if (!buffer) return miss(res);
  hit(res);
  return res.end(buffer);
});

module.exports = router;
