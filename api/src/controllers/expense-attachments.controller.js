'use strict';

const { ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const multer = require('multer');
const BaseController = require('./base.controller');
const { requestScope } = require('../utils/record-scope');

const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 10 * 1024 * 1024;
const MAX_FILES = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 1, fields: 0 },
}).single('file');

function detectedType(bytes) {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function metadata(documents = []) {
  return documents.map(({ content, ...meta }) => meta);
}

class ExpenseAttachmentsController extends BaseController {
  // Keep small, bounded supporting files on the same document as the entry.
  // Backup/recycle-bin and document sync preserve the bytes with their owner.
  // Never put private receipts under the unauthenticated /uploads directory.
  async context(req, res, action, includeContent = false) {
    if (!this.checkPermission('expense', action, req.user)) {
      this.forbidden(res, 'You do not have permission to access these attachments');
      return null;
    }
    if (!ObjectId.isValid(req.params.id)) {
      this.notFound(res, 'Cash Book entry not found');
      return null;
    }
    const query = { _id: new ObjectId(req.params.id), ...requestScope(req), is_deleted: { $ne: true } };
    const collection = req.db.collection('expenses');
    const entry = await collection.findOne(query, { projection: includeContent
      ? { supporting_documents: 1 }
      : { 'supporting_documents.content': 0 } });
    if (!entry) {
      this.notFound(res, 'Cash Book entry not found');
      return null;
    }
    res.set('Cache-Control', 'no-store');
    return { query, collection, documents: entry.supporting_documents || [] };
  }

  list = async (req, res) => {
    const ctx = await this.context(req, res, 'read');
    if (ctx) return this.success(res, metadata(ctx.documents));
  };

  read = async (req, res) => {
    const ctx = await this.context(req, res, 'read', true);
    if (!ctx) return;
    const file = ctx.documents.find((item) => item.id === req.params.attId);
    if (!file) return this.notFound(res, 'Attachment not found');
    // Authenticated JSON transport also works in the desktop app. The UI builds
    // a local Blob for preview/download; credentials never enter a file URL.
    return this.success(res, file);
  };

  add = async (req, res) => {
    const ctx = await this.context(req, res, 'write');
    if (!ctx) return;
    await new Promise((resolve, reject) => upload(req, res, (error) => error ? reject(error) : resolve()));
    const file = req.file;
    const type = file && detectedType(file.buffer);
    if (!type || !file.size) return this.error(res, 'Attach a PDF, JPG or PNG file.', 400);
    const id = createHash('sha256').update(file.buffer).digest('hex');
    const previous = ctx.documents.find((item) => item.id === id);
    if (previous) return this.success(res, metadata([previous])[0], 'Already attached');
    const meta = {
      id,
      name: Array.from(String(file.originalname || 'receipt')).map((char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\' ? '_' : char
      ).join('').slice(0, 120),
      size: file.size,
      type,
      uploaded_at: new Date(),
      uploaded_by: String(req.user._id || ''),
    };
    const result = await ctx.collection.updateOne({
      ...ctx.query,
      'supporting_documents.id': { $ne: id },
      $expr: { $and: [
        { $lt: [{ $size: { $ifNull: ['$supporting_documents', []] } }, MAX_FILES] },
        { $lte: [{ $sum: '$supporting_documents.size' }, MAX_TOTAL - file.size] },
      ] },
    }, {
      $push: { supporting_documents: { ...meta, content: file.buffer.toString('base64') } },
      $set: { updated_date: new Date() },
    });
    if (!result.matchedCount) {
      const current = await ctx.collection.findOne(ctx.query, { projection: { supporting_documents: 1 } });
      const duplicate = current?.supporting_documents?.find((item) => item.id === id);
      if (duplicate) return this.success(res, metadata([duplicate])[0], 'Already attached');
      return this.error(res, 'Use up to 5 attachments, 5 MB each and 10 MB total per entry.', 409);
    }
    return this.success(res, meta, 'Attached');
  };

  remove = async (req, res) => {
    const ctx = await this.context(req, res, 'write');
    if (!ctx) return;
    await ctx.collection.updateOne({ ...ctx.query, 'supporting_documents.id': req.params.attId }, {
      $pull: { supporting_documents: { id: req.params.attId } },
      $set: { updated_date: new Date() },
    });
    // Idempotent removal: a lost response must not make Save retries fail.
    return this.success(res, { id: req.params.attId }, 'Attachment removed');
  };
}

const controller = new ExpenseAttachmentsController();
function handler(method) {
  return (req, res, next) => controller[method](req, res).catch((error) => {
    if (error instanceof multer.MulterError) return controller.error(res, 'Use one file at a time, up to 5 MB.', 400);
    return next(error);
  });
}
module.exports = { handler, detectedType, metadata, MAX_FILE, MAX_TOTAL, MAX_FILES };
