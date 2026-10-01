'use strict';

// Conversation/feedback content has a short shop-controlled lifetime. Billing,
// action drafts and security audit collections are deliberately not touched.
const DAYS = [7, 30, 90, 365];
const DEFAULT_DAYS = 30;
const daysFor = (preferences) =>
  DAYS.includes(preferences?.retention_days) ? preferences.retention_days : DEFAULT_DAYS;
const cutoffFor = (preferences, at = new Date()) =>
  new Date(at.getTime() - daysFor(preferences) * 86400000);
const isCurrent = (message, cutoff) =>
  message?.at instanceof Date && Number.isFinite(message.at.getTime()) && message.at >= cutoff;
const indexed = new WeakMap();

async function ensureIndexes(db) {
  if (!indexed.has(db))
    indexed.set(
      db,
      Promise.all([
        db.collection('ask_posnic_conversations').createIndex({ license: 1, 'messages.at': 1 }),
        db.collection('ask_posnic_feedback').createIndex({ license: 1, at: 1 }),
      ]).catch((error) => {
        indexed.delete(db);
        throw error;
      })
    );
  await indexed.get(db);
}

async function sweep(db, { licenseId, at = new Date(), limit = 500 } = {}) {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    throw new Error('A valid retention time is required.');
  await ensureIndexes(db);
  const bound = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 500;
  const conversations = db.collection('ask_posnic_conversations');
  const feedback = db.collection('ask_posnic_feedback');
  // Per-tenant databases are selected by the caller, and license scope is still
  // required in every mutation for installations with more than one shop.
  const licenses = licenseId
    ? [String(licenseId)]
    : [
        ...new Set([
          ...(await conversations.distinct('license')),
          ...(await feedback.distinct('license')),
        ]),
      ].filter((value) => typeof value === 'string' && value);
  let conversationsChanged = 0,
    conversationsDeleted = 0,
    feedbackDeleted = 0;
  for (const license of licenses) {
    const preferences = await db.collection('ask_posnic_preferences').findOne({ license });
    const cutoff = cutoffFor(preferences, at);
    const expired = { $or: [{ at: { $lt: cutoff } }, { at: { $not: { $type: 'date' } } }] };
    const candidates = await conversations
      .find(
        {
          license,
          $or: [{ messages: { $elemMatch: expired } }, { 'messages.0': { $exists: false } }],
        },
        { projection: { _id: 1 } }
      )
      .limit(bound)
      .toArray();
    if (candidates.length) {
      const scope = { license, _id: { $in: candidates.map((row) => row._id) } };
      const changed = await conversations.updateMany(scope, [
        {
          $set: {
            messages: {
              $filter: {
                input: { $cond: [{ $isArray: '$messages' }, '$messages', []] },
                as: 'message',
                cond: {
                  $and: [
                    { $eq: [{ $type: '$$message.at' }, 'date'] },
                    { $gte: ['$$message.at', cutoff] },
                  ],
                },
              },
            },
          },
        },
      ]);
      conversationsChanged += changed.modifiedCount;
      // Checking emptiness again prevents deleting a concurrent new message.
      conversationsDeleted += (
        await conversations.deleteMany({ ...scope, 'messages.0': { $exists: false } })
      ).deletedCount;
    }
    const expiredFeedback = await feedback
      .find({ license, ...expired }, { projection: { _id: 1 } })
      .limit(bound)
      .toArray();
    if (expiredFeedback.length)
      feedbackDeleted += (
        await feedback.deleteMany({
          license,
          ...expired,
          _id: { $in: expiredFeedback.map((row) => row._id) },
        })
      ).deletedCount;
  }
  return { conversationsChanged, conversationsDeleted, feedbackDeleted };
}

module.exports = { DAYS, DEFAULT_DAYS, daysFor, cutoffFor, isCurrent, sweep };
