'use strict';
function summarize(parts, events = []) {
  const rows = [];
  function check(key, label, describe) {
    const part = parts[key];
    if (!part) { rows.push({ key, label, status: 'pending', message: 'Waiting for check' }); return; }
    if (part.status !== 'ok') { rows.push({ key, label, status: 'attention', message: part.status === 'error' ? 'Could not complete this check. Support can review the details.' : 'Check returned incomplete information.' }); return; }
    rows.push({ key, label, ...describe(part.data || {}) });
  }
  const result = (status, message) => ({ status, message });
  check('system', 'Computer & storage', d => d.freeMemory < 512 * 1024 ** 2 || (d.disk && d.disk.availableBytes < 1024 ** 3) ? result('attention', 'Memory or free storage is running low.') : result('ok', 'Memory and storage checked.'));
  check('services', 'Local app & database', d => Array.isArray(d) && d.length && d.every(v => v.status === 'reachable') ? result('ok', 'Both local services are reachable.') : result('attention', 'A local service is unavailable or still starting.'));
  check('sync', 'Online sync', d => d.running ? result('info', 'Sync process is running. Data freshness is not verified.') : result('info', 'Sync is not running. This may be expected in offline mode.'));
  check('printers', 'Printer connections', d => !d.printers?.length ? result('info', 'No printers found or printer checks are not ready.') : d.printers.some(p => p.error || p.health?.workOffline || p.health?.present === false || p.health?.detectedError > 0) ? result('attention', 'A printer needs checking. Open details for its status.') : result('ok', d.printers.length + ' printer connections checked. Paper output is not verified.' + (d.omitted ? ' Other printers were not checked.' : '')));
  check('printQueue', 'Pending print jobs', d => !d.initialized ? result('info', 'Print queue is not available on this setup.') : d.jobs?.some(j => ['failed', 'uncertain', 'recovery'].includes(j.state)) ? result('attention', 'Print jobs need review. Do not resend uncertain jobs.') : result('ok', 'No failed jobs in the checked queue.'));
  check('printHelper', 'Printing service', d => d.state === 'ready' ? result('ok', 'Printing service is ready.') : result('info', 'Printing service is ' + (d.state || 'not checked') + '.'));
  check('audio', 'Kitchen sound', d => d.enabled == null ? result('info', 'Sound has not been checked yet.') : d.enabled === false ? result('info', 'Kitchen sound is switched off.') : result('info', 'Sound settings checked. Speaker playback needs a listening test.'));
  const failures = events.filter(e => e.success === false || e.status === 'error' || e.stage === 'process-gone' || e.stage === 'child-process-gone' || e.stage === 'load-failed');
  rows.push({ key: 'activity', label: 'App activity', ...result(failures.length ? 'attention' : 'info', failures.length ? failures.length + ' recorded errors for support to review.' : 'No errors recorded in this session. This does not verify every feature.') });
  return rows;
}
module.exports = { summarize };
