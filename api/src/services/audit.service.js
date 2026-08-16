// src/services/audit.service.js
//
// Append-only writer for the accountability audit trail (`audit_log`).
//
// record() NEVER throws — an audit failure must not break the caller's primary
// operation (a sale must still complete even if the audit write fails). Tenant
// (license / branch) and actor default from the per-request BaseModel context
// (AsyncLocalStorage), so callers usually only pass the event + specifics.

const BaseModel = require('../models/base.model');
const AuditModel = require('../models/audit.model');
const { AUDIT_EVENTS } = require('../constants/audit.constants');

class AuditService {
  constructor(model) {
    // Allow injecting a model so controller-set context (license/branch) is reused.
    this.model = model || new AuditModel();
  }

  /**
   * Record one audit event. Append-only; resolves { status } and never throws.
   *
   * @param {string} event  one of AUDIT_EVENTS (defaults to 'unknown')
   * @param {object} ctx    optional overrides + specifics:
   *   actor_user_id, actor_name, approved_by_user_id, approved_by_name,
   *   entity, entity_id, device_id, amount (number), reason, details (object),
   *   license, branch_id, at (Date)
   * @returns {Promise<{status:boolean, error?:string}>}
   */
  async record(event, ctx = {}) {
    try {
      const toId = (v) => {
        if (v === null || v === undefined) return null;
        try {
          return this.model.toObjectId(v) || null;
        } catch (e) {
          return null;
        }
      };

      const collection = await this.model.getCollection('audit_log');

      const doc = {
        at: ctx.at instanceof Date ? ctx.at : new Date(),
        event: String(event || 'unknown'),
        license: toId(ctx.license) || BaseModel.license || this.model.licenseId || null,
        branch_id: toId(ctx.branch_id) || BaseModel.currentBranch || this.model.branchId || null,
        actor_user_id: toId(ctx.actor_user_id) || toId(BaseModel.loggedUser) || null,
        actor_name: ctx.actor_name || BaseModel.loggedUserName || null,
        approved_by_user_id: toId(ctx.approved_by_user_id),
        approved_by_name: ctx.approved_by_name || null,
        entity: ctx.entity || null,
        entity_id: ctx.entity_id !== null && ctx.entity_id !== undefined ? String(ctx.entity_id) : null,
        device_id: ctx.device_id || null,
        amount: typeof ctx.amount === 'number' ? ctx.amount : null,
        reason: ctx.reason || null,
        details: ctx.details && typeof ctx.details === 'object' ? ctx.details : null,
      };

      // Keep documents lean — drop keys that resolved to null/undefined.
      Object.keys(doc).forEach((k) => {
        if (doc[k] === null || doc[k] === undefined) delete doc[k];
      });

      await collection.insertOne(doc);
      return { status: true };
    } catch (error) {
      // Swallow — auditing must never break the primary operation.
      // eslint-disable-next-line no-console
      console.error('AuditService.record failed:', error && error.message);
      return { status: false, error: error && error.message };
    }
  }
}

module.exports = { AuditService, AUDIT_EVENTS };
