'use strict';

/*
 * Campaigns - reach a segment of customers with a message.
 *
 * A campaign picks an audience (a segment), renders a message per recipient, and
 * sends it through a channel. It is deliberately channel-neutral and
 * currency-agnostic: merge fields like {points} are plain counts, {balance} is a
 * number, and nothing here assumes a locale.
 *
 * Sending is guarded on purpose. A campaign only sends when explicitly told to;
 * it respects each customer's per-channel opt-out, skips anyone with no phone,
 * never sends the same customer twice for one campaign, and can be run as a
 * dry-run that renders and logs without dispatching a single message.
 */

const CHANNEL = {
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
};

const STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  SENDING: 'sending',
  SENT: 'sent',
  PARTIAL: 'partial', // finished, but some recipients failed
  CANCELLED: 'cancelled',
};

// How an audience is chosen. Each is a cheap filter over the customers we hold.
const SEGMENT_TYPE = {
  ALL: 'all', // every customer
  TIER: 'tier', // a loyalty tier
  MIN_POINTS: 'min_points', // at least N points in the wallet
  CATEGORY: 'category', // a customer category
  LAPSED: 'lapsed', // no purchase in the last N days (or never)
};

// The outcome recorded per recipient, so a campaign is fully auditable.
const SEND_STATUS = {
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED_OPTOUT: 'skipped_optout',
  SKIPPED_NOPHONE: 'skipped_nophone',
  SKIPPED_DUPLICATE: 'skipped_duplicate',
  DRY_RUN: 'dry_run',
};

// Merge fields a message template may use, resolved per recipient.
const MERGE_FIELDS = ['name', 'phone', 'points', 'balance', 'lifetime', 'tier'];

const MESSAGES = {
  SAVED: 'Campaign saved',
  DELETED: 'Campaign deleted',
  NOT_FOUND: 'Campaign not found',
  NAME_REQUIRED: 'A campaign name is required',
  MESSAGE_REQUIRED: 'A message is required',
  BAD_CHANNEL: 'Choose a valid channel',
  ALREADY_SENT: 'This campaign has already been sent',
  SCHEDULED: 'Campaign scheduled',
  SENT: 'Campaign sent',
  NOTHING_TO_SEND: 'No reachable recipients for this campaign',
};

module.exports = { CHANNEL, STATUS, SEGMENT_TYPE, SEND_STATUS, MERGE_FIELDS, MESSAGES };
