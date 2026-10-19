'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
const fail = (code, status = 503) => {
  throw Object.assign(Error(code), { code, status });
};
const validDate = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
async function readImportStatus({
  db,
  scope,
  storeCode,
  root = process.env.POSNIC_HKTV_CONNECTOR_ROOT,
  now = Date.now(),
}) {
  if (!root || !path.isAbsolute(root)) fail('hktv_cloud_connection_required');
  const config = JSON.parse(await fs.readFile(path.join(root, 'private/config.json'), 'utf8'));
  if (
    config.tenantDb !== db.databaseName ||
    config.license !== String(scope.license) ||
    config.branchId !== String(scope.branchId) ||
    config.storeCode !== storeCode
  )
    fail('hktv_connection_scope_mismatch', 403);
  if (!path.isAbsolute(config.journalDirectory || '')) fail('hktv_journal_unavailable');
  const result = {
    state: 'unknown',
    lastCompletedAt: null,
    lastAttemptAt: null,
    lastAttemptResult: null,
    lastError: null,
    total: null,
  };
  let checkpointFile;
  try {
    checkpointFile = await fs.open(path.join(config.journalDirectory, 'checkpoint.json'), 'r');
    const stat = await checkpointFile.stat();
    if (stat.size > 65536) fail('hktv_checkpoint_invalid');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await checkpointFile.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) fail('hktv_checkpoint_invalid');
    const checkpoint = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (
      checkpoint.storeCode !== storeCode ||
      !Number.isSafeInteger(checkpoint.total) ||
      checkpoint.total < 0
    )
      fail('hktv_checkpoint_invalid');
    result.lastCompletedAt = stat.mtime.toISOString();
    result.total = checkpoint.total;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  } finally {
    await checkpointFile?.close();
  }
  let file;
  try {
    file = await fs.open(path.join(config.journalDirectory, 'runs.jsonl'), 'r');
    const stat = await file.stat(),
      size = Math.min(stat.size, 65536),
      start = stat.size - size,
      buffer = Buffer.alloc(size);
    const { bytesRead } = await file.read(buffer, 0, size, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start) text = text.slice(text.indexOf('\n') + 1);
    const lines = text.split('\n');
    if (!text.endsWith('\n')) lines.pop();
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      const entry = JSON.parse(lines[i]);
      if (!validDate(entry.startedAt) || !['success', 'failed'].includes(entry.result))
        fail('hktv_journal_invalid');
      result.lastAttemptAt = entry.startedAt;
      result.lastAttemptResult = entry.result;
      result.lastError =
        entry.result === 'failed' && /^[A-Z0-9_]{1,100}$/.test(entry.code || '')
          ? entry.code
          : null;
      break;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  } finally {
    await file?.close();
  }
  const completed = result.lastCompletedAt && Date.parse(result.lastCompletedAt),
    age = completed ? now - completed : null;
  result.state =
    age === null
      ? 'never-synced'
      : age < 0 || age > 300000
        ? 'stale'
        : result.lastAttemptResult === 'failed' && Date.parse(result.lastAttemptAt) > completed
          ? 'error'
          : 'recent';
  return result;
}
module.exports = { readImportStatus };
