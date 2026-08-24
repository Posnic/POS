#!/usr/bin/env node
'use strict';

/*
 * Photographs for the demo products, from Wikimedia Commons.
 *
 * WHY COMMONS
 *
 * The demo products are generic goods - "Cappuccino", "Claw Hammer 500g",
 * "Whole Wheat Bread" - not branded packages. So the question is not "where do
 * we find a picture of THIS product" but "where do we find a freely licensed
 * photograph of this KIND of thing", and Commons is the largest such library
 * there is.
 *
 * It also settles the licensing, which is the part that cannot be hand-waved:
 * these images ship inside a commercial product, to every customer, in every
 * country. Photographs lifted from a search engine are somebody's copyright
 * whatever the intention. This script accepts public-domain and CC licences
 * only, refuses everything else, and records the attribution for every file it
 * keeps - so the credit exists whether or not anyone remembers to write it.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not invent a match. A search that returns nothing acceptable leaves
 * that product without an image, and the till already has a good answer for
 * that: PosnicPro.autoTile gives it a coloured tile from its own name. A wrong
 * photograph is worse than no photograph - a picture of the wrong thing on a
 * sale grid is read as fact and slows the person down.
 *
 *   node scripts/fetch-demo-images.js            # fetch what is missing
 *   node scripts/fetch-demo-images.js --dry-run  # search only, write nothing
 *   node scripts/fetch-demo-images.js --only=cafe
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'frontend', 'static', 'images', 'demo');
const MANIFEST = path.join(OUT_DIR, 'credits.json');

const demo = require(path.join(ROOT, 'api', 'utils', 'demoData.js'));

/*
 * Images a person looked at and turned down, and why.
 *
 * Every one of these passed the licence check and the filters. They were
 * rejected on sight: another company's mark on a cup, a photograph of people,
 * a periodic table where a table fan should be. Automated search is right most
 * of the time and confidently wrong the rest, so the review is not optional -
 * and without this file a re-run would quietly undo it.
 */
const REJECTS = (() => {
  const f = path.join(__dirname, 'demo-image-rejects.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
})();

const PACKS = {
  iceCream: demo.iceCreamDemoData,
  cafe: demo.cafeDemoData,
  bakery: demo.bakeryDemoData,
  supermarket: demo.supermarketDemoData,
  textile: demo.textileDemoData,
  electrical: demo.electricalDemoData,
  hardware: demo.hardwareDemoData,
};

/* Wikimedia asks for a real User-Agent that identifies the caller and a way to
   reach them. Sending a default one is how a tool gets the whole project
   rate-limited. */
const UA = 'PosnicDemoImages/1.0 (https://posnic.com; info@posnic.com)';

/* Licences whose terms allow shipping inside a commercial product, with
   attribution. Anything not on this list is refused rather than guessed at -
   "no licence stated" is not the same as "freely licensed". */
const OK_LICENCE = /^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd|pdm)/i;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, asBuffer = false) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(get(res.headers.location, asBuffer));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('http ' + res.statusCode));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve(asBuffer ? buf : buf.toString('utf8'));
        });
      })
      .on('error', reject);
  });
}

/*
 * A product name is not a search term.
 *
 * "Rice (Sona Masoori) 5kg" should be searched as "Sona Masoori rice" - the
 * pack size is the one part guaranteed not to help, and leaving it in returns
 * photographs of scales and price labels.
 */
function searchTerm(name) {
  return String(name)
    .replace(/\b\d+(\.\d+)?\s*(kg|g|ml|l|ltr|litre|liters?|sqmm|mm|cm|m|pc|pcs|piece|inch|in|w|watt|amp|a)\b/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const slug = (pack, name) =>
  pack +
  '-' +
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function search(term) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search' +
    '&srnamespace=6&srlimit=8&srsearch=' +
    encodeURIComponent(term + ' filetype:bitmap');
  const body = JSON.parse(await get(url));
  return ((body.query && body.query.search) || []).map((r) => r.title);
}

async function info(title) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo' +
    '&iiprop=url|extmetadata|mime|size&iiurlwidth=600&titles=' +
    encodeURIComponent(title);
  const body = JSON.parse(await get(url));
  const pages = (body.query && body.query.pages) || {};
  const page = Object.values(pages)[0];
  const ii = page && page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  const meta = ii.extmetadata || {};
  const plain = (k) =>
    meta[k] && meta[k].value ? String(meta[k].value).replace(/<[^>]*>/g, '').trim() : '';
  return {
    title,
    mime: ii.mime,
    width: ii.width,
    height: ii.height,
    thumb: ii.thumburl || ii.url,
    page: ii.descriptionurl,
    licence: plain('LicenseShortName'),
    author: plain('Artist'),
    credit: plain('Credit'),
  };
}

/*
 * Words that mean the photograph is of a BRAND, a shelf or an advert rather
 * than of the thing itself.
 *
 * Found by looking at what came back. A search for "cappuccino" returned a
 * perfectly good cappuccino in a McCafé mug, and "eggs 12 pack" returned a
 * tray of branded salted eggs. Both correctly licensed, both unusable: another
 * company's trademark shipped inside our demo data reads as an endorsement,
 * and a picture of the wrong thing on a sale grid is read as fact.
 */
const BRAND_SIGNAL =
  /\b(logo|advert|advertis|packaging|package|packet|wrapper|label|branded|brand|shopfront|storefront|supermarket|shelf|shelves|vending|signage|billboard)\b/i;

/*
 * The title has to be about the thing we asked for.
 *
 * Commons search is generous, and its eighth result for "claw hammer" is not a
 * claw hammer. Requiring one substantial word of the term to appear in the
 * file's own title is a weak test, but it is the difference between a wrong
 * photograph and none - and none is the better failure.
 */
function onTopic(title, term) {
  const words = term
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (!words.length) return true;
  const t = String(title).toLowerCase();
  return words.some((w) => t.includes(w));
}

function acceptable(i) {
  if (!i) return false;
  if (!/^image\/(jpeg|png|webp)$/.test(i.mime || '')) return false;
  /* Very small originals upscale into mush at tile size. */
  if ((i.width || 0) < 300) return false;
  if (BRAND_SIGNAL.test(i.title || '')) return false;
  if (BRAND_SIGNAL.test(i.credit || '')) return false;
  return OK_LICENCE.test((i.licence || '').replace(/\s+/g, ' ').trim());
}

async function main() {
  if (!DRY) fs.mkdirSync(OUT_DIR, { recursive: true });

  const credits = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  let found = 0;
  let skipped = 0;
  let kept = 0;

  for (const [packName, pack] of Object.entries(PACKS)) {
    if (ONLY && ONLY !== packName) continue;
    for (const product of pack.products) {
      const key = slug(packName, product.name);
      const file = path.join(OUT_DIR, key + '.webp');

      if (credits[key] && fs.existsSync(file)) {
        kept++;
        continue;
      }

      if (REJECTS[key]) {
        skipped++;
        console.log(`  x  ${key.padEnd(38)} rejected on review: ${REJECTS[key]}`);
        continue;
      }

      const term = searchTerm(product.name);
      let picked = null;
      try {
        const titles = await search(term);
        for (const t of titles) {
          // eslint-disable-next-line no-await-in-loop
          const i = await info(t);
          if (acceptable(i) && onTopic(t, term)) {
            picked = i;
            break;
          }
          await sleep(120);
        }
      } catch (e) {
        console.warn(`  ! ${key}: ${e.message}`);
      }

      if (!picked) {
        skipped++;
        console.log(`  -  ${key.padEnd(38)} no freely licensed match for "${term}"`);
        await sleep(200);
        continue;
      }

      found++;
      console.log(`  ok ${key.padEnd(38)} ${picked.licence}`);

      if (!DRY) {
        try {
          const buf = await get(picked.thumb, true);
          await sharp(buf)
            .resize(400, 400, { fit: 'cover', position: 'centre' })
            .webp({ quality: 78 })
            .toFile(file);
          credits[key] = {
            product: product.name,
            pack: packName,
            file: 'static/images/demo/' + key + '.webp',
            source: picked.page,
            licence: picked.licence,
            author: picked.author || picked.credit || 'Unknown',
          };
        } catch (e) {
          console.warn(`  ! ${key}: could not save - ${e.message}`);
          found--;
          skipped++;
        }
      }
      await sleep(250);
    }
  }

  if (!DRY) {
    fs.writeFileSync(MANIFEST, JSON.stringify(credits, null, 2) + '\n');
  }

  console.log('');
  console.log(`  fetched ${found}, already had ${kept}, no match for ${skipped}`);
  console.log(`  credits: ${MANIFEST}`);
  if (skipped) {
    console.log('  Products with no image fall back to their coloured tile, which is a');
    console.log('  real answer - a wrong photograph would not be.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
