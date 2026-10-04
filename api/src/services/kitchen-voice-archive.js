'use strict';
const crypto = require('crypto');
const { context, allowed, fail } = require('../utils/branch-access');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const bucket = () => process.env.KITCHEN_VOICE_BUCKET || process.env.ORDER_PHOTO_BUCKET;
const client = () =>
  new S3Client({
    region: process.env.AWS_REGION || 'auto',
    ...(process.env.KITCHEN_VOICE_ENDPOINT
      ? { endpoint: process.env.KITCHEN_VOICE_ENDPOINT, forcePathStyle: true }
      : {}),
    ...(process.env.KITCHEN_VOICE_ACCESS_KEY_ID && process.env.KITCHEN_VOICE_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.KITCHEN_VOICE_ACCESS_KEY_ID,
            secretAccessKey: process.env.KITCHEN_VOICE_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
async function scoped(req) {
  if (!req.user?._id || !allowed(req.user, 'sales')) fail('Order access is required.', 403);
  const c = await context(req);
  if (c.branch.module_captain_enable === false) fail('Captain is disabled.', 403);
  return { license: c.license, branch_id: c.branchId, owner: String(req.user._id) };
}
function audio(data) {
  if (typeof data !== 'string' || data.length > 1500000)
    fail('Choose a recording under 1 MB.', 400);
  const match =
    /^data:(audio\/(?:webm|ogg|mp4|wav)(?:;codecs=[a-zA-Z0-9., -]+)?);base64,([A-Za-z0-9+/=]+)$/.exec(
      data
    );
  if (!match) fail('Invalid voice recording.', 400);
  const bytes = Buffer.from(match[2], 'base64');
  if (
    bytes.length < 12 ||
    !(
      bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
      ['RIFF', 'OggS'].includes(bytes.toString('ascii', 0, 4)) ||
      bytes.toString('ascii', 4, 8) === 'ftyp'
    )
  )
    fail('Invalid voice recording.', 400);
  return { bytes, type: match[1], hash: crypto.createHash('sha256').update(bytes).digest('hex') };
}
async function run(req) {
  const scope = await scoped(req),
    coll = req.db.collection('captain_voice_archive'),
    action = req.params.action;
  const where = { ...scope, expiresAt: { $gt: new Date() } };
  if (action === 'recordings')
    return {
      recordings: (
        await coll
          .find(where, { projection: { _id: 1, created: 1, duration: 1, storage: 1 } })
          .sort({ created: -1 })
          .limit(50)
          .toArray()
      ).map((row) => ({
        id: row._id,
        created: row.created,
        duration: row.duration,
        storage: row.storage,
      })),
    };
  const id = req.body?.id;
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
    fail('Invalid recording identity.', 400);
  if (action === 'playback') {
    const row = await coll.findOne({ ...where, _id: id });
    if (!row) fail('Recording is no longer available.', 404);
    if (row.data) return { data: row.data };
    const response = await client().send(
      new GetObjectCommand({ Bucket: row.bucket, Key: row.key })
    );
    return {
      data:
        'data:' +
        row.type +
        ';base64,' +
        Buffer.from(await response.Body.transformToByteArray()).toString('base64'),
    };
  }
  if (action !== 'archive') fail('Unknown recording action.', 400);
  const value = audio(req.body.data),
    existing = await coll.findOne({ _id: id });
  if (existing) {
    if (
      String(existing.license) !== String(scope.license) ||
      String(existing.branch_id) !== String(scope.branch_id) ||
      existing.owner !== scope.owner ||
      existing.hash !== value.hash
    )
      fail('Recording identity already used.', 409);
    if (existing.expiresAt <= new Date())
      fail('This recording has expired. Record a new message.', 410);
    return { id, stored: true, storage: existing.storage };
  }
  if ((await coll.countDocuments(where)) >= 100)
    fail('Recording history is full. Try again later.', 409);
  const row = {
    _id: id,
    ...scope,
    hash: value.hash,
    type: value.type,
    duration: Math.min(30000, Math.max(0, Number(req.body.duration) || 0)),
    created: new Date(),
    expiresAt: new Date(Date.now() + 7 * 86400000),
  };
  if (bucket()) {
    row.bucket = bucket();
    row.key =
      'kitchen-voice/' +
      crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex') +
      '/' +
      id +
      '/' +
      value.hash;
    await client().send(
      new PutObjectCommand({
        Bucket: row.bucket,
        Key: row.key,
        Body: value.bytes,
        ContentType: value.type,
        CacheControl: 'private, no-store',
      })
    );
    row.storage = 'cloud';
  } else {
    row.data = req.body.data;
    row.storage = 'server';
  }
  await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  try {
    await coll.insertOne(row);
  } catch (e) {
    if (e.code === 11000) return run(req);
    throw e;
  }
  return { id, stored: true, storage: row.storage };
}
module.exports = { run, audio };
