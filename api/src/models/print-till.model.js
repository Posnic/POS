const mongoose = require('mongoose');
/* Registered through defineModel rather than mongoose.model, so the model
   resolves to the shop the request belongs to. */
const { defineModel } = require('../db/model-registry');

/*
 * A TILL THIS SHOP HAS ALLOWED TO PRINT ITS BILLS.
 *
 * Owner: "there should be way to communicate the till via localhos or via
 * cloude. thats the whole point."
 *
 * The queue made that possible and then could not be used, for a reason that
 * only shows up on a real shop's machines. Every Posnic installation generates
 * its own kiosk key the first time it starts (main.js, crypto.randomBytes(32)),
 * and a cloud tenant IS an installation - the provisioner writes it a random
 * one of its own. So a till presenting its key to its shop's cloud address is
 * refused, every time, for every shop, and the only symptom is that bills never
 * arrive.
 *
 * Somebody has to introduce the two. This collection is that introduction: the
 * shopkeeper copies the key off their till's own screen and pastes it here,
 * once, and from then on that machine is allowed to take print jobs.
 *
 * WHY THIS DIRECTION. The other way round - show the shop's server key in the
 * browser and paste it into the till - means a server secret travels to a web
 * page, and this codebase deliberately went the other way when it made branch
 * credentials write-only (services/settings-groups.js, BRANCH_CREDENTIALS).
 * A key that starts life on the till and is only ever stored here as a HASH
 * never leaves the machine that owns it.
 *
 * WHY A HASH AND NOT THE KEY. If this collection leaks, nothing in it can be
 * replayed. The key is 256 bits of randomness, so a plain SHA-256 is enough -
 * there is no password here to guess, no dictionary to run, and deliberately
 * no salt, because a salt would mean scanning every row on every request
 * instead of looking one up by its index.
 */
const printTillSchema = new mongoose.Schema(
  {
    /*
     * What the shopkeeper calls that machine. "Counter PC", "Upstairs".
     *
     * The only thing on this row a person can recognise, so it is the only
     * thing that makes "remove" a safe button to press.
     */
    label: {
      type: String,
      trim: true,
      required: true,
    },

    /*
     * SHA-256 of the key, hex. Unique, so pasting the same till twice is a
     * clear "already allowed" rather than two rows that both match.
     */
    key_hash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    /*
     * The first few characters of the key, to show beside the label.
     *
     * A shopkeeper with two tills needs to tell one row from the other when
     * the labels have drifted, and "ends with 4f2a" is how anybody has ever
     * done that. Short enough to be useless on its own.
     */
    hint: {
      type: String,
      trim: true,
      default: '',
    },

    /*
     * WHEN IT LAST ASKED FOR WORK, which is the whole diagnostic.
     *
     * "Last seen 2 seconds ago" and "never" are the two answers a shopkeeper
     * needs when bills are not arriving, and they point at completely
     * different problems: a wrong key, or a printer.
     */
    last_seen_at: {
      type: Date,
      default: null,
    },

    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'print_tills', versionKey: false }
);

module.exports = defineModel('PrintTill', printTillSchema);
