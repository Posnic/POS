'use strict';

/*
 * A SETTING THAT NEVER LEAVES THE CLOUD.
 *
 * A shop changed its address, and its till kept printing the old one on every
 * bill. Not for a moment - for ten months. Its branch document still carried
 * `updated_date` equal to `created_date`, and every settings change it had ever
 * made was correct in the cloud, correct on the web, and invisible to the
 * machine at the counter.
 *
 * Nothing had failed. The sync gateway offers a device only the rows whose
 * watermark has moved:
 *
 *     { updated_date: { $gt: since.ts } }
 *     { $expr: { $gt: ['$updated_date', '$_syncMeta.at'] } }
 *
 * and the settings write goes through the NATIVE driver, so the schema's
 * `timestamps: { updatedAt: 'updated_date' }` never fires. The row was simply
 * never eligible to travel, and no error exists for that.
 *
 * This is the shape of bug this codebase keeps producing: a thing that is
 * written, is correct, and is read by nobody. It is the same family as the
 * module packaged where nothing could require it and the guard whose regex
 * could never match.
 *
 * So this asserts on the WRITE ITSELF - what actually reaches updateOne -
 * rather than on a helper that might not be the one the save path calls.
 */

const path = require('path');
const fs = require('fs');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'models', 'setting.model.js'),
  'utf8'
);

/* Comments stripped before anything is asserted about the body: an assertion
   that matches its own explaining comment has been written here before. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

describe('a settings save', () => {
  test('STAMPS updated_date, or no till will ever be offered the change', () => {
    const stamps = (CODE.match(/updateData\.updated_date\s*=/g) || []).length;
    expect(stamps).toBeGreaterThan(0);
  });

  test('and every branch write is stamped, not just the first one found', () => {
    /*
     * Two separate saves write to the branch document - the feature switches
     * and the locale/currency block. Fixing one and not the other leaves half
     * the settings screen silently stuck, which is worse than fixing neither,
     * because it looks like it works.
     */
    /* Every `const collection = await this.getCollection(<arg>)`, with where it
       is and what it opened. An empty arg is the branch collection; the payment
       settings name their own. */
    const opens = [...CODE.matchAll(/await this\.getCollection\(([^)]*)\)/g)].map((m) => ({
      at: m.index,
      arg: m[1].trim(),
    }));
    const writes = [
      ...CODE.matchAll(/await collection\.updateOne\(filter, \{ \$set: updateData \}\)/g),
    ];

    const unstamped = [];
    let branchWrites = 0;
    for (const write of writes) {
      const opened = opens.filter((o) => o.at < write.index).pop();
      if (!opened || opened.arg !== '') continue;
      branchWrites += 1;
      const before = CODE.slice(Math.max(0, write.index - 400), write.index);
      if (!/updateData\.updated_date\s*=/.test(before)) {
        unstamped.push(CODE.slice(0, write.index).split('\n').length);
      }
    }

    expect(branchWrites).toBeGreaterThan(1);
    expect(unstamped).toEqual([]);
  });

  test('the stamp is a real date, not a string the gateway cannot compare', () => {
    /* `updated_date: '2026-09-16'` would sort as text against a BSON date and
       the comparison in the gateway would stop meaning anything. */
    expect(CODE).toMatch(/updateData\.updated_date\s*=\s*new Date\(\)/);
  });
});

describe('why this cannot be left to the schema', () => {
  test('the write goes through the native driver, where timestamps do not fire', () => {
    /*
     * If this ever becomes a Mongoose call, `timestamps` handles it and the
     * explicit stamp is redundant - but it is not redundant today, and this
     * test is what will say so if the answer changes.
     */
    expect(CODE).toMatch(/await collection\.updateOne\(/);
  });

  test('and the model does declare the timestamp it is not getting', () => {
    const branchModel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'models', 'branch.model.js'),
      'utf8'
    );
    expect(branchModel).toMatch(/updatedAt:\s*'updated_date'/);
  });
});
