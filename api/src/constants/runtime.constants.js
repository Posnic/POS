/**
 * Runtime / update-contract constants (SEAMLESS_UPDATE_ROADMAP U1).
 *
 * These two numbers are the coordination points that let mixed versions
 * coexist across a fleet or an old community install:
 *
 * - API_SCHEMA_VERSION bumps when a database migration ships (see
 *   src/db/migrations). A client or sync peer can compare schemas instead of
 *   guessing from app versions.
 * - SYNC_PROTOCOL_VERSION mirrors the gateway sync protocol generation
 *   (Gateway/docs/SYNC-PROTOCOL.md - currently v1, HTTPS polling). The
 *   gateway supports N and N-1, so agents update without a flag day.
 *
 * Bump rules: never reuse a number; bump schema WITH the migration that
 * requires it, in the same commit.
 */

const API_SCHEMA_VERSION = 1;
const SYNC_PROTOCOL_VERSION = 1;

module.exports = { API_SCHEMA_VERSION, SYNC_PROTOCOL_VERSION };
