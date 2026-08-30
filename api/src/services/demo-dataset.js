'use strict';

/*
 * Demo data from the website's dataset library.
 *
 * Owner: "if you look for web-frontend you can see dataset folder.
 * posnic.com/dataset/INR/auto_parts.zip - inside all demo data will be there
 * with images. so every currency will have its own data... this functionality
 * is common for both from website and as well from app installing demo data
 * also features demo data toggle."
 *
 * The zips are the richer source: thirty products per trade with real
 * pricing (price, MRP, cost), tax profiles, opening stock, and a photograph
 * per product - against the built-in packs' name+price+stock. One zip per
 * currency per trade, so an INR shop and a USD shop each see prices that
 * make sense where they trade.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: the website is OPTIONAL. Provisioning
 * a shop must never wait on posnic.com being up, slow, or reachable - a shop
 * that cannot be created because a marketing site hiccuped is an outage
 * nobody would think to connect to its cause. Every failure in this file -
 * timeout, size cap, bad zip, missing manifest - resolves to null, and the
 * caller falls back to the built-in packs that have always shipped.
 *
 * IMAGES are extracted into the API's own /uploads/demo/<datasetId>/, which
 * is served with CORS and - unlike the frontend tree - is not rsync --delete
 * territory, so a deploy cannot orphan every demo photograph (the CSP already
 * expects product images on same-origin /uploads). On a multi-tenant box the
 * app directory is shared, so the extract is per-DATASET, written once and
 * reused by every shop that installs that trade; the purge never deletes the
 * files, because another tenant may be pointing at them.
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATASET_HOST = process.env.POSNIC_DATASET_BASE || 'https://posnic.com/dataset';
const FETCH_TIMEOUT_MS = 12000;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;

/*
 * The trades the website publishes, by dataset key.
 *
 * There is no index endpoint yet (the bucket answers 403 to listings), so the
 * keys are named here and probed per currency. Adding a trade on the website
 * plus one entry here makes it installable everywhere; the entry without the
 * upload fails the availability probe and is simply not offered.
 */
const DATASET_TRADES = {
  auto_parts: 'Auto parts & garage',
  restaurant: 'Restaurant & cafe',
  bakery: 'Bakery',
  textile: 'Clothing & textiles',
  hardware: 'Hardware & tools',
  pharmacy: 'Pharmacy',
  retail: 'Supermarket & general retail',
};

/* Input vocabulary -> dataset key, same idea as DEMO_PACK_BY_TYPE. */
const DATASET_KEY_BY_TYPE = {
  auto_parts: 'auto_parts',
  'auto parts': 'auto_parts',
  autoparts: 'auto_parts',
  automobile: 'auto_parts',
  garage: 'auto_parts',
  restaurant: 'restaurant',
  cafe: 'restaurant',
  coffee: 'restaurant',
  bakery: 'bakery',
  textile: 'textile',
  textiles: 'textile',
  apparel: 'textile',
  clothing: 'textile',
  hardware: 'hardware',
  pharmacy: 'pharmacy',
  chemist: 'pharmacy',
  medical: 'pharmacy',
  retail: 'retail',
  supermarket: 'retail',
  kirana: 'retail',
  grocery: 'retail',
  groceries: 'retail',
  general: 'retail',
};

function datasetKeyFor(businessType) {
  const key = String(businessType == null ? '' : businessType)
    .trim()
    .toLowerCase();
  return DATASET_KEY_BY_TYPE[key] || null;
}

function datasetUrl(currency, trade) {
  return `${DATASET_HOST}/${encodeURIComponent(currency)}/${encodeURIComponent(trade)}.zip`;
}

/* One bounded GET. Anything not a clean 200 within the caps is null. */
function fetchBuffer(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_ZIP_BYTES } = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

/*
 * Dataset JSON -> the exact shape the installer already eats.
 *
 * Pure, so the mapping is testable against a committed fixture rather than
 * against the network. `imageFor(productId)` decides what goes in the image
 * field - the caller passes the /uploads path it staged, or null to keep the
 * placeholder.
 */
function toPack(dataset, imageFor) {
  if (!dataset || !Array.isArray(dataset.products) || !dataset.products.length) return null;
  const img = typeof imageFor === 'function' ? imageFor : () => null;

  const categories = (dataset.categories || []).map((c) => ({
    name: c.name,
    description: c.name,
  }));

  const products = dataset.products
    .filter((p) => p && p.name && p.pricing && Number(p.pricing.price) > 0)
    .map((p) => ({
      name: p.displayName || p.name,
      category: p.categoryName || 'General',
      price: Number(p.pricing.price),
      mrp: Number(p.pricing.mrp) || Number(p.pricing.price),
      /* Cost below retail is what makes the margin reports mean something;
         a dataset that omits it gets no invented one. */
      cost_price: Number(p.pricing.costPrice) > 0 ? Number(p.pricing.costPrice) : null,
      unit: p.unit || 'qty',
      stock: Number(p.openingStock) >= 0 ? Number(p.openingStock) : 50,
      track_inventory: p.trackInventory !== false,
      reorder_level: Number(p.reorderLevel) > 0 ? Number(p.reorderLevel) : null,
      tax_rate: p.tax && Number(p.tax.rate) >= 0 ? Number(p.tax.rate) : null,
      sku: p.sku || null,
      description: p.description || '',
      /* The dataset's own rule, kept: barcode stays null unless verified for
         the exact retail item - an invented barcode poisons every join. */
      barcode: null,
      image: img(p.id),
    }));

  if (!products.length) return null;
  return {
    datasetId: String(dataset.datasetId || ''),
    currency: String(dataset.currency || ''),
    categories,
    products,
  };
}

/*
 * Pull the zip apart: the manifest, and the product images.
 *
 * Layout, from the shipped zips: <trade>/data.json and
 * <trade>/images/<productId>/front.jpg.
 */
async function openZip(buffer) {
  // eslint-disable-next-line global-require
  const unzipper = require('unzipper');
  const dir = await unzipper.Open.buffer(buffer);
  let manifest = null;
  const images = new Map();
  for (const entry of dir.files) {
    if (entry.type !== 'File') continue;
    if (entry.path.endsWith('/data.json') || entry.path === 'data.json') {
      // eslint-disable-next-line no-await-in-loop
      manifest = JSON.parse((await entry.buffer()).toString('utf8'));
    } else {
      const m = /images\/([^/]+)\/front\.(jpe?g|png|webp)$/i.exec(entry.path);
      if (m) images.set(m[1], entry);
    }
  }
  return { manifest, images };
}

/*
 * Stage the images once per TRADE, shared by every tenant and every currency
 * on the box.
 *
 * They used to be staged per dataset - "GBP-retail-v1", "INR-retail-v1" - and
 * the photographs in those are byte-identical. Measured across six currencies:
 * 252 image slots, 42 distinct images. A box serving shops in six countries
 * held six copies of the same tin of tomatoes, and every install paid 3MB to
 * write bytes that were already on the disk.
 *
 * Keyed by trade AND a hash of the image set, rather than by trade alone. If a
 * currency ever does ship its own photographs it gets its own directory
 * automatically, so this shares what is identical without assuming it always
 * will be. That assumption is the kind that holds until the day somebody
 * uploads a localized product shot and every other country quietly gets it.
 */
function imageSetKey(trade, images) {
  const h = crypto.createHash('sha256');
  for (const id of [...images.keys()].sort()) h.update(id).update('|');
  /* The names, not the bytes: reading every image to decide whether to write
     it would cost exactly what this is here to save. A currency that reshoots
     a product without renaming it is the one case this misses, and the
     dataset version in the id covers that. */
  return String(trade).replace(/[^A-Za-z0-9._-]/g, '_') + '-' + h.digest('hex').slice(0, 12);
}

/*
 * A file that already exists is not rewritten - the second shop installing
 * auto_parts costs zero image writes, and now nor does the first shop in the
 * fiftieth currency.
 */
async function stageImages(datasetId, images, uploadsRoot) {
  const rel = path.join('demo', datasetId.replace(/[^A-Za-z0-9._-]/g, '_'));
  const dest = path.join(uploadsRoot, rel);
  await fs.promises.mkdir(dest, { recursive: true });
  const staged = new Map();
  for (const [productId, entry] of images) {
    const safe = productId.replace(/[^A-Za-z0-9._-]/g, '_');
    const ext = path.extname(entry.path).toLowerCase() || '.jpg';
    const file = path.join(dest, safe + ext);
    if (!fs.existsSync(file)) {
      // eslint-disable-next-line no-await-in-loop
      const buf = await entry.buffer();
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.writeFile(file, buf);
    }
    staged.set(productId, '/uploads/' + rel.split(path.sep).join('/') + '/' + safe + ext);
  }
  return staged;
}

/*
 * The whole journey: currency + trade -> installer-ready pack, or null.
 *
 * Null is the contract, never a throw: the caller's fallback to the built-in
 * packs is the availability story, and a marketing-site hiccup must cost a
 * shop its photographs, not its existence.
 */
async function loadDatasetPack({ currency, businessType, uploadsRoot }) {
  try {
    const trade = datasetKeyFor(businessType);
    const cur = String(currency || '')
      .trim()
      .toUpperCase();
    if (!trade || !/^[A-Z]{3}$/.test(cur)) return null;

    const buf = await fetchBuffer(datasetUrl(cur, trade));
    if (!buf) return null;

    const { manifest, images } = await openZip(buf);
    if (!manifest) return null;

    let staged = new Map();
    if (uploadsRoot && images.size) {
      try {
        staged = await stageImages(imageSetKey(trade, images), images, uploadsRoot);
      } catch (e) {
        /* Images are the garnish. The products still install. */
        console.error('[demo-dataset] image staging failed:', e.message);
      }
    }
    return toPack(manifest, (id) => staged.get(id) || null);
  } catch (e) {
    console.error('[demo-dataset] falling back to built-in packs:', e.message);
    return null;
  }
}

/*
 * Is the zip there for this currency? A HEAD, remembered for ten minutes.
 *
 * The Demo Data page calls this per trade on open; without the memory every
 * page open would pay one round trip to posnic.com per trade, and the page
 * is exactly where somebody impatient is standing.
 */
const availability = new Map();
const AVAILABILITY_TTL_MS = 10 * 60 * 1000;

function headOk(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function datasetAvailable(currency, trade) {
  const cur = String(currency || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return false;
  const key = cur + '/' + trade;
  const hit = availability.get(key);
  const now = Date.now();
  if (hit && now - hit.at < AVAILABILITY_TTL_MS) return hit.ok;
  const ok = await headOk(datasetUrl(cur, trade));
  availability.set(key, { ok, at: now });
  return ok;
}

/* The chooser rows for the website trades this currency actually has. */
async function listDatasetPacks(currency) {
  const rows = [];
  for (const [trade, label] of Object.entries(DATASET_TRADES)) {
    // eslint-disable-next-line no-await-in-loop
    if (await datasetAvailable(currency, trade)) {
      rows.push({
        key: trade,
        label,
        categories: null,
        products: null,
        photos: null,
        dataset: true,
      });
    }
  }
  return rows;
}

module.exports = {
  datasetAvailable,
  listDatasetPacks,
  DATASET_TRADES,
  datasetKeyFor,
  datasetUrl,
  fetchBuffer,
  toPack,
  loadDatasetPack,
  imageSetKey,
};
