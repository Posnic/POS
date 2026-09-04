#!/usr/bin/env node
'use strict';

/*
 * Contact sheets of the fetched demo images, so every one gets looked at.
 *
 * An automated image search is right most of the time and confidently wrong
 * the rest, and the wrong ones are exactly the ones that must not ship: a
 * picture of the wrong product on a sale grid is read as fact, and a third
 * party's trademark in our demo data reads as an endorsement.
 *
 * Ninety-five images is too many to open one at a time and too few to trust
 * blind, so they are laid out in labelled grids. The label is the PRODUCT
 * NAME, not the file, because the question being asked of each tile is "is
 * this a picture of that?".
 *
 *   node scripts/demo-image-sheet.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'frontend', 'static', 'images', 'demo');
const OUT = path.join(ROOT, '.demo-review');

const COLS = 5;
const ROWS = 4;
const CELL = 200;
const LABEL = 26;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  const credits = JSON.parse(fs.readFileSync(path.join(DIR, 'credits.json'), 'utf8'));
  const keys = Object.keys(credits).sort();
  fs.mkdirSync(OUT, { recursive: true });

  const perSheet = COLS * ROWS;
  const sheets = Math.ceil(keys.length / perSheet);

  for (let s = 0; s < sheets; s++) {
    const slice = keys.slice(s * perSheet, (s + 1) * perSheet);
    const rows = Math.ceil(slice.length / COLS);
    const W = COLS * CELL;
    const H = rows * (CELL + LABEL);

    const composites = [];
    for (let i = 0; i < slice.length; i++) {
      const key = slice[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CELL;
      const y = row * (CELL + LABEL);

      const file = path.join(DIR, key + '.webp');
      if (!fs.existsSync(file)) continue;

      // eslint-disable-next-line no-await-in-loop
      const img = await sharp(file).resize(CELL, CELL, { fit: 'cover' }).toBuffer();
      composites.push({ input: img, top: y, left: x });

      const name = credits[key].product;
      const label = Buffer.from(
        `<svg width="${CELL}" height="${LABEL}">
           <rect width="100%" height="100%" fill="#111"/>
           <text x="4" y="17" font-family="sans-serif" font-size="12" fill="#fff">${esc(
             (i + 1 + s * perSheet).toString().padStart(2, '0') + '. ' + name
           ).slice(0, 200)}</text>
         </svg>`
      );
      composites.push({ input: label, top: y + CELL, left: x });
    }

    const out = path.join(OUT, `sheet-${s + 1}.png`);
    await sharp({
      create: { width: W, height: H, channels: 3, background: '#222' },
    })
      .composite(composites)
      .png()
      .toFile(out);
    console.log(`  ${out}  (${slice.length} images)`);
  }

  console.log('');
  console.log(`  ${keys.length} images across ${sheets} sheets`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
