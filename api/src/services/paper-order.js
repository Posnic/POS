'use strict';
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');

// A separate private bucket: menu images may intentionally be publicly readable.
const config = () => ({ bucket: process.env.ORDER_PHOTO_BUCKET, region: process.env.AWS_REGION });
const clientConfig = () => ({
  region: config().region,
  maxAttempts: 2,
  ...(process.env.ORDER_PHOTO_AWS_ACCESS_KEY_ID && process.env.ORDER_PHOTO_AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.ORDER_PHOTO_AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.ORDER_PHOTO_AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});
const enabled = (branch) => branch.captain_paper_orders === true;
async function scope(req, settings = false) {
  if (!req.user?._id || !allowed(req.user, settings ? 'settings' : 'sales'))
    fail('Permission is required.', 403);
  return context(req);
}
async function options(req) {
  const c = await scope(req);
  return {
    enabled: enabled(c.branch),
    configured: Boolean(config().bucket && config().region),
    referenceAttachments: true,
    stagedPhotoUpload: true,
  };
}
async function settings(req) {
  const c = await scope(req, true);
  if (typeof req.body?.enabled !== 'boolean') fail('Choose whether to enable paper orders.');
  if (req.body.enabled && (!config().bucket || !config().region))
    fail('Configure private order-photo storage and AWS Textract on the server first.', 503);
  await req.db
    .collection('branches')
    .updateOne(
      { _id: c.branchId, license: c.license },
      { $set: { captain_paper_orders: req.body.enabled } }
    );
  return { saved: true, enabled: req.body.enabled };
}
function image(value) {
  if (typeof value !== 'string' || value.length > 7000000) fail('Choose a photo under 5 MB.');
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail('Choose a JPEG or PNG photo.');
  const bytes = Buffer.from(match[2], 'base64');
  const valid =
    match[1] === 'jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!valid || bytes.length > 5 * 1024 * 1024) fail('Choose a valid photo under 5 MB.');
  return { bytes, type: 'image/' + match[1] };
}
function parse(blocks) {
  let table = '',
    pax = null;
  const lines = [];
  // Textract can split a right-aligned quantity from its item into another LINE.
  // Join only a unique number on the same visual row, never by reading order.
  const input = (blocks || []).filter((b) => b.BlockType === 'LINE').map((b) => ({ ...b }));
  const consumed = new Set();
  for (const number of input.filter((b) => /^\d+(?:\.\d+)?$/.test(b.Text?.trim()))) {
    const n = number.Geometry?.BoundingBox;
    if (!n) continue;
    const candidates = input.filter((b) => {
      const r = b.Geometry?.BoundingBox;
      if (
        !r ||
        b === number ||
        consumed.has(b) ||
        !/[a-z]/i.test(b.Text || '') ||
        /\d\s*$/.test(b.Text || '')
      )
        return false;
      const overlap = Math.min(r.Top + r.Height, n.Top + n.Height) - Math.max(r.Top, n.Top);
      return r.Left + r.Width < n.Left && overlap >= Math.min(r.Height, n.Height) * 0.6;
    });
    if (candidates.length === 1) {
      const item = candidates[0];
      const peers = input.filter((b) => {
        const r = b.Geometry?.BoundingBox;
        return (
          /^\d+(?:\.\d+)?$/.test(b.Text?.trim()) &&
          r &&
          r.Left > item.Geometry.BoundingBox.Left + item.Geometry.BoundingBox.Width &&
          Math.min(r.Top + r.Height, n.Top + n.Height) - Math.max(r.Top, n.Top) >=
            Math.min(r.Height, n.Height) * 0.6
        );
      });
      if (peers.length !== 1) continue;
      item.Text += ' ' + number.Text.trim();
      item.Confidence = Math.min(item.Confidence || 0, number.Confidence || 0);
      consumed.add(number);
    }
  }
  for (const block of input) {
    if (consumed.has(block)) continue;
    if (block.BlockType !== 'LINE') continue;
    const raw = String(block.Text || '')
      .trim()
      .slice(0, 200);
    // Only a complete metadata line is consumed; item numbers remain item text.
    const header =
      /^(?:T(?:able)?\s*[:#-]?\s*(\d+[\w-]*))?(?:\s*[,/]?\s*(?:P(?:ax)?|Guests?)\s*[:#-]?\s*(\d+))?$/i.exec(
        raw
      );
    if (header && (header[1] || header[2])) {
      if (header[1]) table = header[1];
      if (header[2]) pax = Number(header[2]);
      continue;
    }
    if (!raw) continue;
    const item = /^(.*?)\s+(?:x\s*)?(\d+(?:\.\d+)?)$/i.exec(raw);
    lines.push({
      text: raw,
      name: item ? item[1].trim() : raw,
      quantity: item ? Number(item[2]) : null,
      confidence: Number(block.Confidence) || 0,
    });
  }
  return { table, pax, lines: lines.slice(0, 100), truncated: lines.length > 100 };
}
async function recognize(req, referenceOnly = false, mobileContext = null) {
  const c = mobileContext || (await scope(req));
  if (!(mobileContext ? c.config.photoOrders === true : enabled(c.branch)))
    fail('Photo orders are not enabled for this branch.', 403);
  const cfg = config();
  if (!cfg.bucket || !cfg.region) fail('Paper recognition is not configured on this server.', 503);
  const id = String(req.body?.id || '');
  if (!/^[a-f0-9-]{36}$/i.test(id)) fail('A photo request ID is required.');
  let originalData = req.body.original;
  if (!originalData && req.body.uploadId && !referenceOnly && !mobileContext) {
    const source = await req.db.collection('paper_order_photos').findOne({
      _id: String(req.body.uploadId),
      license: c.license,
      branch_id: c.branchId,
      owner: String(req.user._id),
      'result.referenceOnly': true,
    });
    if (!source) fail('Uploaded photo not found. Upload the photo again.', 404);
    originalData = (await read({ ...req, params: { id: source._id } })).data;
  }
  const original = image(originalData),
    crop = req.body.crop ? image(req.body.crop) : original;
  const digest = crypto
    .createHash('sha256')
    .update(original.bytes)
    .update(crop.bytes)
    .update(referenceOnly ? 'reference-only' : '')
    .digest('hex');
  const where = { _id: id, license: c.license, branch_id: c.branchId, owner: String(req.user._id) };
  const coll = req.db.collection('paper_order_photos');
  const existing = await coll.findOne({ _id: id });
  if (existing) {
    if (
      String(existing.license) !== String(c.license) ||
      String(existing.branch_id) !== String(c.branchId) ||
      existing.owner !== where.owner ||
      existing.digest !== digest
    )
      fail('This photo request belongs to another draft.', 409);
    if (existing.result) return { id, ...existing.result };
    if (existing.runningUntil > new Date())
      fail('This photo is still processing. Retry shortly.', 409);
  } else {
    try {
      await coll.insertOne({ ...where, digest, created: new Date() });
    } catch (e) {
      if (e.code === 11000) fail('This photo is already processing. Retry shortly.', 409);
      throw e;
    }
  }
  const lock = await coll.updateOne(
    {
      ...where,
      $or: [{ runningUntil: { $exists: false } }, { runningUntil: { $lte: new Date() } }],
    },
    { $set: { runningUntil: new Date(Date.now() + 120000) } }
  );
  if (!lock.modifiedCount) fail('This photo is still processing. Retry shortly.', 409);
  const key = `orders/${c.license}/${c.branchId}/${id}`;
  try {
    const month = new Date().toISOString().slice(0, 7);
    const quotaId = `${c.license}/${c.branchId}/${month}`;
    const quota = req.db.collection('paper_order_usage');
    try {
      await quota.updateOne({ _id: quotaId }, { $setOnInsert: { count: 0 } }, { upsert: true });
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
    const limit = Math.max(1, Number(process.env.ORDER_PHOTO_MONTHLY_LIMIT) || 3000);
    const counted = referenceOnly
      ? { modifiedCount: 1 }
      : await quota.updateOne({ _id: quotaId, count: { $lt: limit } }, { $inc: { count: 1 } });
    if (!counted.modifiedCount) fail('This branch has reached its monthly paper-scan limit.', 429);
    const s3 = new S3Client(clientConfig());
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: original.bytes,
        ContentType: original.type,
        ServerSideEncryption: 'AES256',
      }),
      { abortSignal: AbortSignal.timeout(30000) }
    );
    let result = { referenceOnly: true };
    if (!referenceOnly) {
      const textract = new TextractClient(clientConfig());
      const response = await textract.send(
        new DetectDocumentTextCommand({ Document: { Bytes: crop.bytes } }),
        { abortSignal: AbortSignal.timeout(45000) }
      );
      result = parse(response.Blocks);
    }
    await coll.updateOne(where, {
      $set: { result, key, bucket: cfg.bucket, type: original.type },
      $unset: { runningUntil: '' },
    });
    return { id, ...result };
  } catch (e) {
    await coll.updateOne(where, { $unset: { runningUntil: '' } });
    if (e.status) throw e;
    fail('Photo recognition could not finish. Keep the photo and retry.', 503);
  }
}
// Bind before sale insertion. Retries may reuse the same order key, never another order.
async function reference(db, c, id, orderKey, owner) {
  if (!id) return null;
  if (!orderKey || !owner) fail('Sign in and retry this photo order.', 403);
  const where = {
    _id: String(id),
    license: c.license,
    branch_id: c.branchId,
    owner: String(owner),
    result: { $exists: true },
    $or: [{ orderKey: { $exists: false } }, { orderKey: String(orderKey) }],
  };
  const doc = await db
    .collection('paper_order_photos')
    .findOneAndUpdate(where, { $set: { orderKey: String(orderKey) } }, { returnDocument: 'after' });
  if (!doc) fail('This photo belongs to another order or is not ready.', 409);
  return {
    id: doc._id,
    key: doc.key,
    bucket: doc.bucket,
    type: doc.type,
    uploaded_at: doc.created,
    uploaded_by: doc.owner,
    url: `/captain/v1/paper-orders/photos/${doc._id}`,
  };
}
async function read(req) {
  const c = await scope(req);
  const id = String(req.params.id || '');
  const sales = req.db.collection('sales');
  const sale = await sales.findOne(
    {
      license: c.license,
      branch_id: c.branchId,
      $or: [{ 'paper_order.id': id }, { 'order_photos.id': id }],
    },
    { projection: { paper_order: 1, order_photos: 1 } }
  );
  const doc =
    (sale?.paper_order?.id === id
      ? sale.paper_order
      : sale?.order_photos?.find((photo) => photo.id === id)) ||
    (await req.db.collection('paper_order_photos').findOne({
      _id: id,
      license: c.license,
      branch_id: c.branchId,
      owner: String(req.user._id),
    }));
  if (
    !doc?.key ||
    doc.bucket !== config().bucket ||
    doc.key !== `orders/${c.license}/${c.branchId}/${id}`
  )
    fail('Photo not found.', 404);
  const result = await new S3Client(clientConfig()).send(
    new GetObjectCommand({ Bucket: doc.bucket, Key: doc.key }),
    { abortSignal: AbortSignal.timeout(30000) }
  );
  return {
    data: `data:${doc.type};base64,${Buffer.from(await result.Body.transformToByteArray()).toString('base64')}`,
  };
}
async function mobileOptions(req) {
  const mobile = require('./mobile-pos');
  if (!mobile.allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await mobile.context(req);
  return {
    enabled: c.config.photoOrders === true,
    configured: Boolean(config().bucket && config().region),
    handwritingLanguages: ['en'],
    printedLanguages: ['en', 'de', 'fr', 'es', 'it', 'pt'],
  };
}
async function mobileRecognize(req) {
  const mobile = require('./mobile-pos');
  if (!mobile.allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  return recognize(req, false, await mobile.context(req));
}
async function attach(req) {
  const c = await scope(req);
  if (!enabled(c.branch)) fail('Paper orders are not enabled for this branch.', 403);
  if (!ObjectId.isValid(String(req.body?.saleId || ''))) fail('Order not found.', 404);
  const where = { _id: new ObjectId(req.body.saleId), license: c.license, branch_id: c.branchId };
  if (!(await req.db.collection('sales').findOne(where))) fail('Order not found.', 404);
  const result = await recognize(req, true);
  const photo = await reference(req.db, c, result.id, String(where._id), req.user._id);
  const saved = await req.db.collection('sales').updateOne(where, {
    $addToSet: { order_photos: photo },
    $set: { updated_date: new Date() },
  });
  if (!saved.matchedCount) fail('Order not found.', 404);
  require('../sync/outbox').enqueue({ collection: 'sales', documentId: where._id, reason: 'sale' });
  require('../sync/nudge').nudgeSyncAgent();
  return { photo: { id: photo.id } };
}
module.exports = {
  upload: (req) => recognize(req, true),
  options,
  settings,
  recognize,
  reference,
  read,
  attach,
  parse,
  image,
  enabled,
  mobileOptions,
  mobileRecognize,
};
