'use strict';
/*
 * Where a product image lives, and how both halves of the product find it.
 *
 * A till and the web app render the SAME string - a relative path, /uploads/<key>.
 * The browser resolves it against whichever origin it happens to be on:
 *
 *     till     http://localhost:5000/uploads/<key>
 *     web app  https://shop.example.com/uploads/<key>
 *
 * So nothing environment-specific is ever written to the database. That matters
 * because the alternative is what we already have: rows holding
 * "http://localhost:5000/uploads/x.jpg" that were correct on the machine that
 * created them and meaningless everywhere else, plus controller code that
 * detects and rewrites them on the way out.
 *
 * The key is the whole design:
 *
 *     <tenantId>/<kind>/<sha256>.<ext>
 *
 *     local   uploads/<key>
 *     S3      s3://<bucket>/<key>
 *
 * One string, both locations derived from it. Keyed by the tenant's ObjectId
 * rather than its subdomain or shop name, because those change - a shop
 * rebrands, moves domain, gets renamed - and an id does not. Content-hashed,
 * so the same photo uploaded twice is one object and a retry after a dropped
 * connection is a no-op rather than a duplicate.
 *
 * Reading prefers local, always. A shop with the line down still shows its
 * images, because the file is on the disk in front of the person using it.
 * S3 is the origin; the disk is the cache; the till never waits on a network
 * to draw something it has already seen.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/* Deliberately narrow. This value reaches fs.join and a URL, and the only
   thing that should ever produce it is keyFor() below. */
/*
 * The prefix is a tenant's ObjectId in the cloud, and the literal "local" on a
 * till - which is not multi-tenant and has no tenant record to be keyed by.
 *
 * A till's images are only ever read by that till, so "local" collides with
 * nothing. If one is later pushed to S3 it is re-keyed under the tenant it
 * syncs into, because by then there is a tenant to name.
 */
const KEY_RE = /^(?:[a-f0-9]{24}|local)\/[a-z]+\/[a-f0-9]{64}\.(jpg|jpeg|png|webp)$/;

const LOCAL_PREFIX = 'local';

const EXT_FOR = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

/** Bytes -> the key they will live under, for this tenant and kind. */
function keyFor({ tenantId, kind, buffer, mimeType }) {
  const ext = EXT_FOR[String(mimeType || '').toLowerCase()];
  if (!ext) throw new Error('unsupported image type');

  /*
   * The tenant comes from the authenticated session, never from the request
   * body. It is the whole of the isolation between one shop's images and
   * another's, so it is not something a caller gets to pass in.
   *
   * A till has no tenant record, so it keys under "local". Passing an
   * unrecognised value is a bug rather than a reason to guess, and guessing
   * here would file one shop's images under another.
   */
  const raw = String(tenantId || '').trim();
  const tid = raw && /^[a-f0-9]{24}$/.test(raw) ? raw : LOCAL_PREFIX;
  if (raw && tid === LOCAL_PREFIX && raw !== LOCAL_PREFIX) {
    throw new Error('tenant id for an image must be an ObjectId');
  }

  const safeKind = String(kind || 'items').toLowerCase();
  if (!/^[a-z]+$/.test(safeKind)) throw new Error('bad image kind');

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return `${tid}/${safeKind}/${hash}.${ext}`;
}

/** True only for keys this module could itself have produced. */
function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

/**
 * The absolute path a key maps to on this machine.
 *
 * Rejects anything that is not a well-formed key rather than trying to
 * sanitise it, so no amount of ../ reaches the filesystem.
 */
function localPathFor(key) {
  if (!isValidKey(key)) return null;
  return path.join(UPLOAD_DIR, key);
}

/** What a client renders. Relative on purpose - see the note at the top. */
function urlFor(key) {
  if (!isValidKey(key)) return null;
  return `/uploads/${key}`;
}

function existsLocally(key) {
  const p = localPathFor(key);
  return !!p && fs.existsSync(p);
}

/**
 * Write the bytes to this machine's disk.
 *
 * Always the first thing that happens, and the only thing that has to succeed
 * for the image to be usable: the person who just took the photo sees it on
 * the item immediately, with or without a working line.
 *
 * Content-addressed, so a file that is already there is already correct and
 * rewriting it would only risk tearing a file something else is reading.
 */
async function saveLocal(key, buffer) {
  const dest = localPathFor(key);
  if (!dest) throw new Error('refusing to write an image with a malformed key');
  if (fs.existsSync(dest)) return { key, path: dest, deduped: true };

  await fsp.mkdir(path.dirname(dest), { recursive: true });

  /* Write to a temporary name in the same directory and rename into place.
     A half-written file that a reader can see is worse than no file, and
     rename within a filesystem is atomic. */
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, dest);
  return { key, path: dest, deduped: false };
}

/*
 * ---------------------------------------------------------------------------
 * Everything below exists for the images that are already out there.
 * ---------------------------------------------------------------------------
 *
 * Items created before this stored a FULL URL in the document, and the files
 * sit in a flat uploads/ directory named like "item-1699887-482910.jpg". Both
 * shapes are in live data and neither is going to be rewritten in place: a
 * migration that edits every item row to chase a storage change is a lot of
 * risk for a cosmetic gain, and it can only ever be run once.
 *
 * So the two shapes coexist, and resolve() is the single place that knows the
 * difference. New writes produce keys. Old rows keep working, untouched,
 * for as long as they last.
 */

/*
 * The paths that were in use before this.
 *
 * These are NOT flat, which is what I assumed and got wrong. Live shops serve
 * things like uploads/item_images/2026-08-09-20-41-40-..._item_image-xxx.jpg,
 * so a pattern that refused a directory separator rejected the actual data.
 * Nothing broke, because express.static answers these before the fallback
 * route ever sees them - but resolve() returned '' for them, and wiring that
 * into the controllers would have blanked every existing image at once.
 *
 * Each segment must begin with an alphanumeric, so ".." can never appear and
 * the path cannot climb out of uploads/.
 */
const LEGACY_FILE_RE =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/){0,4}[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(jpg|jpeg|png|webp)$/i;

function isLegacyFile(name) {
  return typeof name === 'string' && LEGACY_FILE_RE.test(name);
}

/**
 * Turn whatever is stored on a document into something a browser can load.
 *
 * Handles, in order:
 *
 *   <tenant>/items/<hash>.jpg   a key         -> /uploads/<key>
 *   /uploads/anything           already relative, already correct
 *   http://localhost:5000/...   a URL that was only ever true on one machine.
 *                               The filename is the useful part; the origin is
 *                               noise from wherever it happened to be created.
 *   https://cdn/... or s3       someone else's origin - left completely alone
 *   item-123-456.jpg            a bare legacy filename
 *
 * Returns '' for anything unrecognised, so a caller renders nothing rather
 * than an <img> pointed at a string that was never a location.
 */
function resolve(stored) {
  const v = String(stored || '').trim();
  if (!v) return '';

  if (isValidKey(v)) return `/uploads/${v}`;
  if (v.startsWith('/uploads/')) return v;
  if (isLegacyFile(v)) return `/uploads/${v}`;

  if (/^https?:\/\//i.test(v)) {
    let u;
    try {
      u = new URL(v);
    } catch (e) {
      return '';
    }

    /*
     * A loopback URL is the one shape that is actively wrong. It was written
     * by whichever machine created the item and means "me" on every machine
     * that reads it afterwards - so on the cloud it points the browser at the
     * customer's own computer. Keep the path, drop the origin, and let it
     * resolve against wherever it is actually being viewed.
     */
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
      return u.pathname.startsWith('/uploads/') ? u.pathname : `/uploads${u.pathname}`;
    }

    /* Any other absolute URL is a real origin - a CDN, an S3 bucket, an image
       somebody pasted in from elsewhere. Not ours to reinterpret. */
    return v;
  }

  return '';
}

module.exports = {
  keyFor,
  isValidKey,
  localPathFor,
  urlFor,
  existsLocally,
  saveLocal,
  resolve,
  isLegacyFile,
  UPLOAD_DIR,
  KEY_RE,
  LEGACY_FILE_RE,
};
