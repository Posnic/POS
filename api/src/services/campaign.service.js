'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const {
  CHANNEL,
  STATUS,
  SEGMENT_TYPE,
  SEND_STATUS,
  MESSAGES,
} = require('../constants/campaign.constants');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);

/*
 * The campaign engine.
 *
 * Two pieces are pure and unit-tested on their own: renderMessage (fill a
 * template's merge fields for one customer) and buildAudienceQuery (turn a
 * segment into a Mongo filter). The instance methods wrap those with the
 * customer data and the sending, and sending is deliberately careful - explicit,
 * opt-out-aware, de-duplicated per campaign, and able to run as a dry-run that
 * writes the log without dispatching a message.
 */
class CampaignService {
  // ============================ pure helpers ============================

  /** Fill {merge} fields for one customer. Unknown fields render as empty. */
  static renderMessage(template, customer) {
    const c = customer || {};
    const loyalty = c.loyalty || {};
    const map = {
      name: c.name || '',
      phone: c.phone || '',
      points: Number(loyalty.points) || 0,
      balance: Number(loyalty.points) || 0,
      lifetime: Number(loyalty.pointsEarned) || 0,
      tier: loyalty.tier || '',
    };
    return String(template || '').replace(/\{(\w+)\}/g, (m, key) => {
      const k = String(key).toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, k) ? String(map[k]) : m;
    });
  }

  /**
   * Turn a segment into a Mongo filter over customers (without the license,
   * which the caller adds). `now` is passed in so the lapsed window is testable.
   */
  static buildAudienceQuery(segment = {}, now = null) {
    const s = segment || {};
    const nowMs = now != null ? new Date(now).getTime() : Date.now();
    switch (s.type) {
      case SEGMENT_TYPE.TIER:
        return s.tier ? { 'loyalty.tier': s.tier } : {};
      case SEGMENT_TYPE.MIN_POINTS:
        return { 'loyalty.points': { $gte: Math.max(0, Number(s.min_points) || 0) } };
      case SEGMENT_TYPE.CATEGORY:
        return s.category_id ? { category_id: oid(s.category_id) } : {};
      case SEGMENT_TYPE.LAPSED: {
        const days = Math.max(0, Number(s.lapsed_days) || 0);
        const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000);
        // No purchase since the cutoff, or no recorded purchase at all.
        return {
          $or: [
            { lastPurchaseDate: { $lt: cutoff } },
            { lastPurchaseDate: { $exists: false } },
            { lastPurchaseDate: null },
          ],
        };
      }
      case SEGMENT_TYPE.ALL:
      default:
        return {};
    }
  }

  /** Whether a customer may be messaged on this channel (per-channel opt-out). */
  static optedIn(customer, channel) {
    const p = (customer && customer.preferences) || {};
    if (channel === CHANNEL.WHATSAPP) return p.whatsappNotifications !== false;
    if (channel === CHANNEL.SMS) return p.smsNotifications !== false;
    return true;
  }

  // ============================ reads / CRUD ============================

  async list(branchId) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    const rows = await db.collection('campaigns').find(q).sort({ created_date: -1 }).toArray();
    return { status: true, data: rows, message: 'Campaigns' };
  }

  async get(id) {
    const db = await BaseModel.getDb();
    const row = await db
      .collection('campaigns')
      .findOne({ _id: oid(id), license: BaseModel.license });
    if (!row) return { status: false, message: MESSAGES.NOT_FOUND };
    return { status: true, data: row };
  }

  _cleanSegment(seg = {}) {
    const type = Object.values(SEGMENT_TYPE).includes(seg.type) ? seg.type : SEGMENT_TYPE.ALL;
    const out = { type };
    if (type === SEGMENT_TYPE.TIER) out.tier = String(seg.tier || '');
    if (type === SEGMENT_TYPE.MIN_POINTS) out.min_points = Math.max(0, Number(seg.min_points) || 0);
    if (type === SEGMENT_TYPE.CATEGORY)
      out.category_id = seg.category_id ? oid(seg.category_id) : null;
    if (type === SEGMENT_TYPE.LAPSED) out.lapsed_days = Math.max(0, Number(seg.lapsed_days) || 0);
    return out;
  }

  async save(id, data = {}, ctx = {}) {
    const db = await BaseModel.getDb();
    const col = db.collection('campaigns');
    const now = new Date();
    const name = String(data.name || '').trim();
    if (!name) return { status: false, message: MESSAGES.NAME_REQUIRED };
    const channel =
      data.channel === CHANNEL.SMS
        ? CHANNEL.SMS
        : data.channel === CHANNEL.WHATSAPP
          ? CHANNEL.WHATSAPP
          : null;
    if (!channel) return { status: false, message: MESSAGES.BAD_CHANNEL };
    const message = String(data.message || '').trim();
    if (!message) return { status: false, message: MESSAGES.MESSAGE_REQUIRED };

    const set = {
      name,
      channel,
      message,
      segment: this._cleanSegment(data.segment),
      branch_id: ctx.branchId ? oid(ctx.branchId) : null,
      branch_name: ctx.branchName || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      license: BaseModel.license,
    };

    if (id) {
      // A sent campaign is a record; editing it should not resurrect it.
      const existing = await col.findOne({ _id: oid(id), license: BaseModel.license });
      if (!existing) return { status: false, message: MESSAGES.NOT_FOUND };
      await col.updateOne({ _id: oid(id), license: BaseModel.license }, { $set: set });
      const row = await col.findOne({ _id: oid(id), license: BaseModel.license });
      return { status: true, data: row, message: MESSAGES.SAVED };
    }
    const doc = {
      ...set,
      status: STATUS.DRAFT,
      schedule_at: null,
      audience_size: 0,
      sent_count: 0,
      failed_count: 0,
      skipped_count: 0,
      last_run_date: null,
      created_date: now,
      created_by: ctx.userName || '',
    };
    const r = await col.insertOne(doc);
    return { status: true, data: { ...doc, _id: r.insertedId }, message: MESSAGES.SAVED };
  }

  async remove(id) {
    const db = await BaseModel.getDb();
    const r = await db
      .collection('campaigns')
      .deleteOne({ _id: oid(id), license: BaseModel.license });
    if (!r.deletedCount) return { status: false, message: MESSAGES.NOT_FOUND };
    return { status: true, data: { deleted: 1 }, message: MESSAGES.DELETED };
  }

  // ============================ audience ============================

  async _recipients(segment) {
    const db = await BaseModel.getDb();
    const q = { ...CampaignService.buildAudienceQuery(segment), license: BaseModel.license };
    return db.collection('customers').find(q).toArray();
  }

  /** Reach for a segment: total in the segment and how many are actually reachable. */
  async preview(segment, channel) {
    const rows = await this._recipients(segment);
    let reachable = 0;
    const sample = [];
    for (const c of rows) {
      const ok = (c.phone || '').toString().trim() && CampaignService.optedIn(c, channel);
      if (ok) {
        reachable += 1;
        if (sample.length < 5) sample.push({ name: c.name, phone: c.phone });
      }
    }
    return {
      status: true,
      data: { total: rows.length, reachable, sample },
      message: 'Audience preview',
    };
  }

  // ============================ sending ============================

  // The real channel senders, resolved once per send. Injected in tests.
  // SMS goes through the shop's own configured provider (messaging settings);
  // WhatsApp runs on the shop's linked local device.
  async _defaultAdapters(branchId) {
    const whatsappService = require('./whatsapp.service');
    const MessagingService = require('./messaging.service');
    const messagingService = new MessagingService();
    const db = await BaseModel.getDb();
    const branch = branchId
      ? await db.collection('branches').findOne({ _id: oid(branchId) })
      : null;
    const settings = await messagingService._raw(branchId);
    const deviceId = settings.whatsapp_device_id || (branch && branch.whatsapp_device_id);
    return {
      [CHANNEL.WHATSAPP]: async (phone, message) => {
        if (!deviceId) return { ok: false, error: 'No WhatsApp device linked for this branch' };
        try {
          const r = await whatsappService.sendMessage(deviceId, branchId, phone, message);
          return { ok: r && r.status === true, error: r && r.message };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      [CHANNEL.SMS]: async (phone, message) => {
        try {
          return await messagingService.sendSms(branchId, phone, message);
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
    };
  }

  async _log(sendsCol, campaign, cust, phone, status, message, error, dryRun) {
    await sendsCol.insertOne({
      campaign_id: campaign._id,
      customer_id: cust._id,
      customer_name: cust.name || '',
      phone: phone || '',
      channel: campaign.channel,
      status,
      message: message || '',
      error: error || null,
      dry_run: !!dryRun,
      branch_id: campaign.branch_id || null,
      date: new Date(),
      license: BaseModel.license,
    });
  }

  /**
   * Send a campaign to its audience. Explicit and guarded: it skips opt-outs and
   * customers with no phone, never messages the same customer twice for one
   * campaign (so a re-run only reaches those still pending), and with dryRun it
   * renders and logs everything without dispatching a single message.
   */
  async send(campaignId, { dryRun = false, ctx = {}, adapters = null } = {}) {
    const db = await BaseModel.getDb();
    const col = db.collection('campaigns');
    const sendsCol = db.collection('campaign_sends');
    const campaign = await col.findOne({ _id: oid(campaignId), license: BaseModel.license });
    if (!campaign) return { status: false, message: MESSAGES.NOT_FOUND };
    if (!dryRun && (campaign.status === STATUS.SENT || campaign.status === STATUS.SENDING)) {
      return { status: false, message: MESSAGES.ALREADY_SENT };
    }

    const channel = campaign.channel;
    const dispatch = adapters || (await this._defaultAdapters(campaign.branch_id));
    const recipients = await this._recipients(campaign.segment);

    if (!dryRun) await col.updateOne({ _id: campaign._id }, { $set: { status: STATUS.SENDING } });

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const cust of recipients) {
      // De-dupe: a prior non-failed send for this campaign+customer means done.
      const already = await sendsCol.findOne({
        campaign_id: campaign._id,
        customer_id: cust._id,
        license: BaseModel.license,
        status: { $nin: [SEND_STATUS.FAILED] },
      });
      if (already) continue;

      const phone = (cust.phone || '').toString().trim();
      let message = '';
      let status;
      let error = null;
      if (!phone) {
        status = SEND_STATUS.SKIPPED_NOPHONE;
      } else if (!CampaignService.optedIn(cust, channel)) {
        status = SEND_STATUS.SKIPPED_OPTOUT;
      } else {
        message = CampaignService.renderMessage(campaign.message, cust);
        if (dryRun) {
          status = SEND_STATUS.DRY_RUN;
        } else {
          const res = await dispatch[channel](phone, message);
          if (res && res.ok) status = SEND_STATUS.SENT;
          else {
            status = SEND_STATUS.FAILED;
            error = (res && res.error) || 'send failed';
          }
        }
      }
      await this._log(sendsCol, campaign, cust, phone, status, message, error, dryRun);
      if (status === SEND_STATUS.SENT) sent += 1;
      else if (status === SEND_STATUS.FAILED) failed += 1;
      else skipped += 1;
    }

    const summary = {
      audience_size: recipients.length,
      sent,
      failed,
      skipped,
      last_run_date: new Date(),
    };
    if (!dryRun) {
      const finalStatus =
        failed > 0 && sent > 0
          ? STATUS.PARTIAL
          : failed > 0 && sent === 0
            ? STATUS.PARTIAL
            : STATUS.SENT;
      await col.updateOne(
        { _id: campaign._id },
        {
          $set: { ...summary, status: finalStatus, schedule_at: null },
          $inc: { sent_count: sent, failed_count: failed, skipped_count: skipped },
        }
      );
    }
    return {
      status: true,
      data: { dryRun: !!dryRun, ...summary },
      message: dryRun ? 'Dry run complete' : MESSAGES.SENT,
    };
  }

  /** Put a campaign on the schedule (a runner fires it when due). */
  async schedule(campaignId, when, ctx = {}) {
    const db = await BaseModel.getDb();
    const col = db.collection('campaigns');
    const campaign = await col.findOne({ _id: oid(campaignId), license: BaseModel.license });
    if (!campaign) return { status: false, message: MESSAGES.NOT_FOUND };
    const at = new Date(when);
    if (isNaN(at.getTime())) return { status: false, message: 'Invalid schedule time' };
    await col.updateOne(
      { _id: campaign._id },
      { $set: { status: STATUS.SCHEDULED, schedule_at: at, updated_date: new Date() } }
    );
    return { status: true, data: { schedule_at: at }, message: MESSAGES.SCHEDULED };
  }

  /**
   * Send every scheduled campaign that is now due (for the current tenant). A
   * cron tick calls this per tenant; it is safe to call repeatedly - each
   * campaign flips out of 'scheduled' as it runs, and sends stay de-duplicated.
   */
  async runDue({ ctx = {}, adapters = null, now = null } = {}) {
    const db = await BaseModel.getDb();
    const col = db.collection('campaigns');
    const cutoff = now ? new Date(now) : new Date();
    const due = await col
      .find({ license: BaseModel.license, status: STATUS.SCHEDULED, schedule_at: { $lte: cutoff } })
      .toArray();
    const results = [];
    for (const c of due) {
      const r = await this.send(c._id, { ctx, adapters });
      results.push({ id: c._id, ...(r.data || {}), status: r.status });
    }
    return {
      status: true,
      data: { ran: results.length, results },
      message: 'Scheduled run complete',
    };
  }
}

module.exports = CampaignService;
