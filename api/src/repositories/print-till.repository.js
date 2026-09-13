'use strict';

/*
 * THE TILLS A SHOP HAS ALLOWED TO PRINT ITS BILLS.
 *
 * Four operations: allow one, list them, forget one, and - the one that runs
 * on every claim - decide whether a key belongs to any of them.
 *
 * See models/print-till.model.js for why this exists at all. The short version:
 * every installation generates its own kiosk key, a cloud tenant is an
 * installation, so a till and its shop's cloud server can never agree about a
 * key unless somebody introduces them.
 */

const crypto = require('crypto');

/*
 * THE MODEL IS FETCHED WHEN IT IS USED, NOT WHEN THIS FILE LOADS.
 *
 * The same trap print-job.repository documents: a schema built at load time
 * reads `mongoose.Schema.Types` while a suite has mongoose stubbed, and throws
 * before a single test runs - in suites that have nothing to do with printing.
 */
function printTillModel() {
  return require('../models/print-till.model');
}

/* 256 bits of randomness, so a plain digest is enough: there is nothing here
   to guess. Deliberately unsalted so a key can be found by its index rather
   than by comparing against every row. */
const hashOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/* Enough to tell two tills apart in a list, useless to anybody who has it. */
const hintOf = (key) => {
  const s = String(key || '');
  return s.length > 6 ? `...${s.slice(-6)}` : '';
};

/**
 * Allow a till to print this shop's bills.
 *
 * Pasting the same key twice is not an error and must not be: a shopkeeper who
 * is not sure whether it worked will paste it again, and the honest answer is
 * "that one is already allowed" rather than a duplicate row or a red message.
 *
 * @param {string} key the key copied off the till's own screen
 * @param {string} label what the shopkeeper calls that machine
 */
async function allowTill(key, label, { Model } = {}) {
  const model = Model || printTillModel();
  const clean = String(key || '').trim();

  /*
   * A short key is a paste that went wrong, and saying so beats storing it.
   * Every real one is 64 hex characters; anything under 32 is a fragment, a
   * label typed into the wrong box, or an empty clipboard.
   */
  if (clean.length < 32) {
    return { status: false, message: 'That does not look like a printing key', data: null };
  }

  const name = String(label || '').trim() || 'A till';

  try {
    const key_hash = hashOf(clean);
    const existing = await model.findOne({ key_hash }).lean();
    if (existing) {
      /* Re-labelling an already-allowed till is the useful reading of a
         second paste, so take the new name with it. */
      await model.updateOne({ key_hash }, { $set: { label: name } });
      return {
        status: true,
        message: 'That till was already allowed',
        data: { id: String(existing._id), label: name, hint: existing.hint, already: true },
      };
    }

    const made = await model.create({
      label: name,
      key_hash,
      hint: hintOf(clean),
      created_at: new Date(),
    });

    return {
      status: true,
      message: "That till can now print this shop's bills",
      data: { id: String(made._id), label: made.label, hint: made.hint, already: false },
    };
  } catch (error) {
    console.error('Error in allowTill:', error);
    return { status: false, message: 'Could not allow that till', data: null };
  }
}

/**
 * The tills this shop has allowed, newest first.
 *
 * The hash never leaves this file. What comes back is what a person needs to
 * decide whether to remove a row: what it is called, which key it ends with,
 * and whether it has ever actually asked for anything.
 */
async function listTills({ Model } = {}) {
  const model = Model || printTillModel();
  try {
    const rows = await model.find({}).sort({ created_at: -1 }).limit(50).lean();
    return {
      status: true,
      message: 'success',
      data: rows.map((r) => ({
        id: String(r._id),
        label: r.label,
        hint: r.hint || '',
        last_seen_at: r.last_seen_at || null,
        created_at: r.created_at || null,
      })),
    };
  } catch (error) {
    console.error('Error in listTills:', error);
    return { status: false, message: 'Could not read the allowed tills', data: [] };
  }
}

/** Stop a till printing this shop's bills. */
async function forgetTill(id, { Model } = {}) {
  const model = Model || printTillModel();
  try {
    const out = await model.deleteOne({ _id: id });
    if (!out || !out.deletedCount) {
      return { status: false, message: 'No such till', data: null };
    }
    return { status: true, message: "That till can no longer print this shop's bills", data: null };
  } catch (error) {
    console.error('Error in forgetTill:', error);
    return { status: false, message: 'Could not remove that till', data: null };
  }
}

/**
 * Does this key belong to a till this shop allowed?
 *
 * One indexed lookup by the digest itself, which is what makes this safe to
 * run on every claim: no scan, no comparison loop, and therefore nothing for
 * a timing attack to measure.
 *
 * Stamps when it was last seen, because "last seen 2 seconds ago" and "never"
 * are the two answers that tell a shopkeeper whether the key is wrong or the
 * printer is.
 */
async function tillIsAllowed(key, { Model } = {}) {
  const clean = String(key || '').trim();
  if (clean.length < 32) return false;

  const model = Model || printTillModel();
  try {
    const found = await model.findOneAndUpdate(
      { key_hash: hashOf(clean) },
      { $set: { last_seen_at: new Date() } },
      { returnDocument: 'after' }
    );
    return !!found;
  } catch (error) {
    /*
     * A database that cannot be read must REFUSE, not admit. Failing open here
     * would turn a momentary outage into an open print queue.
     */
    console.error('Error in tillIsAllowed:', error);
    return false;
  }
}

module.exports = {
  allowTill,
  listTills,
  forgetTill,
  tillIsAllowed,
  hashOf,
};
