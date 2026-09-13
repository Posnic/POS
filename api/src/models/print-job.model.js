const mongoose = require('mongoose');
/* Registered through defineModel rather than mongoose.model, so the model
   resolves to the shop the request belongs to. */
const { defineModel } = require('../db/model-registry');

/*
 * A THING SOMEBODY WANTS PRINTED, AND WHICH MACHINE SHOULD PRINT IT.
 *
 * Owner: "there should be way to communicate the till via localhost or via
 * cloud. thats the whole point. make it happen. may be seperate collection for
 * print ? need solution that which till need to send for bill also there."
 *
 * WHY A COLLECTION AND NOT A FLAG ON THE SALE. The first version put
 * bill_requested_at on the sale itself, which works exactly as long as the
 * till and the sale live in the same database. On the shop's own Wi-Fi they
 * do. Pointed at the cloud they do not: the request is written to the cloud's
 * database and the till is looking at its own, so the paper never comes.
 *
 * A job carries everything the printer needs WITH IT. The till does not have
 * to own the sale, look it up, or wait for anything to sync down - it asks
 * "anything for me?", gets a document, and prints it. That one property is
 * what makes localhost and cloud the same code path instead of two.
 *
 * AND IT NAMES THE MACHINE. A shop with a counter till and a first-floor till
 * has two printers in two rooms; "print the bill" is not an instruction until
 * it says where. A job with no till named is for whoever gets to it first,
 * which is the right answer for the overwhelmingly common one-till shop.
 *
 * The claim is what stops two tills printing the same bill - see
 * claimPrintJobs, which moves a job to `printing` and hands it over in ONE
 * atomic update. A queue without that is a queue that duplicates under exactly
 * the conditions it exists for.
 */
const printJobSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    /*
     * Which till should print this. Null means any till in the branch, which
     * is what a one-till shop wants and what an app that has never been told
     * about tills will send.
     */
    till_id: {
      type: String,
      trim: true,
      default: null,
    },

    /* 'bill' today. The kitchen ticket is the obvious second, and the reason
       this says `kind` rather than being called a bill queue. */
    kind: {
      type: String,
      enum: ['bill', 'kot', 'report'],
      default: 'bill',
      required: true,
    },

    /*
     * WHAT TO PRINT, carried rather than referenced.
     *
     * The whole reason the cloud case works. A reference would need the till
     * to hold the sale; a snapshot needs it to hold nothing at all.
     */
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /* For a human reading a log or a support call: "table 4's bill". */
    label: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      enum: ['queued', 'printing', 'done', 'failed'],
      default: 'queued',
      required: true,
      index: true,
    },

    /* Which till took it, so a job stuck in `printing` can be traced to a
       machine rather than to "the system". */
    claimed_by: { type: String, trim: true, default: '' },
    claimed_at: { type: Date, default: null },
    printed_at: { type: Date, default: null },

    /* A job that keeps failing must not be retried for ever - see
       reclaimStalePrintJobs. */
    attempts: { type: Number, default: 0 },
    last_error: { type: String, trim: true, default: '' },

    /* The sale this came from, when it came from one. Not required: a report
       has no sale, and the payload is what gets printed either way. */
    sale_id: { type: mongoose.Schema.Types.ObjectId, default: null },

    created_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, strict: true }
);

/* The query the till makes every few seconds, and the one that decides whether
   this scales past one shop: branch + status + age. */
printJobSchema.index({ branch_id: 1, status: 1, created_at: 1 });

const PrintJob = defineModel('PrintJob', printJobSchema);

module.exports = PrintJob;
