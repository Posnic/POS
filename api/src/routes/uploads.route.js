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
      const res = await s3.getS3Client().send(
        new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key })
      );

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
  const legacy = !store.isValidKey(key) && store.isLegacyFile(key);
  if (!store.isValidKey(key) && !legacy) {
    return res.status(404).end();
  }

  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Content-Type', contentTypeFor(key));
  res.set('Cache-Control', CACHE);

  /* Legacy files live flat in uploads/, not under a tenant directory. path.basename
     is belt and braces - the regex already refused anything with a separator. */
  const local = legacy
    ? path.join(store.UPLOAD_DIR, path.basename(key))
    : store.localPathFor(key);

  if (local && fs.existsSync(local)) {
    return fs.createReadStream(local).on('error', () => res.status(404).end()).pipe(res);
  }

  /* An old flat file has no S3 counterpart to fall back to - it only ever
     existed on the machine that received the upload. */
  if (legacy) return res.status(404).end();

  const buffer = await fetchFromOrigin(key);
  if (!buffer) return res.status(404).end();
  return res.end(buffer);
});

module.exports = router;
