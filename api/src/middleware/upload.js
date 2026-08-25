const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

// File filter to allow only certain file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, JPG, and PNG files are allowed.'), false);
  }
};

// Initialize multer with configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter,
});

/*
 * Turn what multer just wrote into a content-addressed key.
 *
 * Runs AFTER multer, and deliberately leaves req.file.path and .filename alone
 * so every controller that reads them today keeps working untouched. The only
 * addition is req.file.imageKey, which new code stores on the document instead
 * of a URL.
 *
 * The file moves from its random temporary name to uploads/<key>. Local first,
 * always: the person who just took the photo sees it on the item immediately,
 * with or without a working line. S3 comes later, on the background lane,
 * because an image is never worth delaying a sale for.
 *
 * A failure here does not fail the request. The upload already succeeded and
 * the old flat filename still resolves - so the worst case is an image that
 * did not get re-keyed, not a shop that cannot add a product.
 */
async function attachImageKey(req, res, next) {
  const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : [];
  if (!files.length) return next();

  const store = require('../utils/image-store');
  const fsp = require('fs/promises');

  for (const file of files) {
    try {
      if (!file || !file.path) continue;
      const buffer = await fsp.readFile(file.path);

      /* Cloud requests carry a tenant; a till does not, and keys under
         "local". Never taken from the request body - see keyFor(). */
      const tenantId = (req.tenant && (req.tenant._id || req.tenant.id)) || req.tenantId || null;

      const key = store.keyFor({
        tenantId,
        kind: req.imageKind || 'items',
        buffer,
        mimeType: file.mimetype,
      });

      await store.saveLocal(key, buffer);
      file.imageKey = key;
      file.imageUrl = store.urlFor(key);

      /* The temporary copy is now redundant - the same bytes live under the
         key. Left in place if it cannot be removed; a stray file is harmless
         next to a request that otherwise worked. */
      try {
        await fsp.unlink(file.path);
      } catch (e) {
        /* nothing */
      }
    } catch (e) {
      /* Keyed storage is an improvement on the flat filename, not a
         precondition for it. The upload stands either way. */
    }
  }

  return next();
}

/*
 * Document uploads: the supplier's own PO, an invoice scan, a delivery
 * note - attached to a purchase (owner: "we cant upload any file.
 * supplier po or some other stuff"). PDFs join the image types; the
 * name is regenerated server-side so nothing a filename carries ever
 * reaches the filesystem.
 */
const documentUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dir = path.join(uploadDir, 'attachments');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
      cb(null, 'doc-' + uniqueSuffix + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF and image files can be attached.'), false);
  },
});

module.exports = upload;
module.exports.attachImageKey = attachImageKey;
module.exports.documentUpload = documentUpload;
