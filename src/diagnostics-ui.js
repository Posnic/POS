'use strict';
const api = window.electronAPI.diagnostics;
const el = id => document.getElementById(id);
let busy = false;
let step = 'choice', mode = 'remote';
function showStep(next, focus = true) {
  step = next;
  for (const name of ['choice', 'setup', 'running', 'done']) el('step-' + name).hidden = name !== step;
  if (focus) el('step-' + next).querySelector('h2').focus();
}
el('next').onclick = () => {
  if (busy) return;
  mode = document.querySelector('input[name="support-mode"]:checked').value;
  el('code-entry').hidden = mode !== 'remote';
  el('connectionHint').textContent = mode === 'remote' ? 'Paste the code from your support officer. Starting will share the report automatically.' : 'No code needed. Your report stays on this computer.';
  el('connect').textContent = mode === 'remote' ? 'Connect and start' : 'Start';
  el('status').textContent = ''; showStep('setup'); refresh().catch(() => {});
};
el('back').onclick = () => { if (!busy) { el('status').textContent = ''; showStep('choice'); } };
async function refresh() {
  const state = await api.state();
  el('state').textContent = state.remote ? 'Connected to support' : step === 'running' ? 'Recording locally' : step === 'done' ? 'Finished' : 'Ready';
  if (state.remote && step !== 'running') showStep('running');
  if (step === 'running' && !state.active) showStep('done');
  el('session').textContent = state.active ? 'Use Posnic as usual to reproduce the problem. Checks end at ' + new Date(state.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' : 'Start a new check to collect a fresh report.';
  const rows = state.health || [];
  const pending = state.checking || rows.some(row => row.status === 'pending');
  const attention = rows.filter(row => row.status === 'attention').length;
  el('healthTitle').textContent = !state.active ? 'Session ended' : pending ? 'Checking your computer...' : attention ? attention + ' areas need attention' : 'Checks complete';
  el('progress').hidden = !state.active || !pending;
  el('health').replaceChildren(...rows.map(row => {
    const card = document.createElement('div'); card.className = 'check ' + row.status;
    const badge = document.createElement('div'); badge.className = 'badge'; badge.textContent = { ok: 'Ready', attention: 'Needs attention', pending: state.active ? 'Checking' : 'Not checked', info: 'For your information' }[row.status];
    const title = document.createElement('strong'); title.textContent = row.label;
    const message = document.createElement('span'); message.textContent = row.message;
    card.append(badge, title, message); return card;
  }));
  el('capture').checked = state.captureOnly; el('captureWarning').hidden = !state.captureOnly;
  el('start').disabled = busy;
  el('back').disabled = busy;
  for (const id of ['snapshot', 'capture', 'stop']) el(id).disabled = !state.active || busy;
  el('snapshot').disabled = !state.active || busy || state.checking;
  el('connect').disabled = !!state.remote || busy || (mode === 'remote' && !state.uploadAvailable);
  el('upload').hidden = !state.remote; el('upload').disabled = !state.remote || busy;
  el('endpoint').textContent = 'Support service: ' + (state.endpoint || 'not configured');
  el('remote').textContent = state.remote ? state.remote.error ? 'Connection interrupted. Reconnecting automatically...' : state.remote.lastUpload ? 'Connected. Support is monitoring. Keep using Posnic as usual.' : 'Connected. Sending your report...' : 'Recording on this computer. No report is being sent to support.';

}
function action(id, fn) {
  el(id).addEventListener('click', async () => {
    if (busy) return; busy = true; el('status').textContent = id === 'connect' ? (mode === 'remote' ? 'Connecting to support and sending your report...' : 'Starting your local session...') : id === 'snapshot' || id === 'start' ? 'Checking your computer...' : 'Working...';
    try { await refresh(); const message = await fn(); el('status').textContent = typeof message === 'string' ? message : 'Done.'; }
    catch (error) { el('status').textContent = String(error.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
    finally { busy = false; refresh().catch(() => {}); }
  });
}
action('start', () => { showStep('choice'); return ''; });
action('stop', async () => {
  let message = 'Save the report and send it to your support officer when ready.';
  const state = await api.state();
  if (state.remote) {
    try { if (!state.remote.lastUpload || Date.now() - Date.parse(state.remote.lastUpload) >= 2000) await api.upload(); message = 'Your report was sent to support. You can also save a copy.'; }
    catch (_) { message = 'The latest update could not be sent. Save the report and share it with support.'; }
  }
  await api.stop(); el('code').value = ''; showStep('done'); return message;
});
action('snapshot', async () => { await api.snapshot(); return 'Checks updated.'; });
action('review', async () => { el('report').textContent = JSON.stringify(await api.report(), null, 2); el('report').hidden = false; return 'This is the report shared with support.'; });
action('export', async () => { const r = await api.export(); return r.canceled ? 'Export cancelled.' : 'Compressed report saved.'; });
action('connect', async () => {
  if (step !== 'setup') return '';
  if (mode === 'remote' && !el('code').value.trim()) throw Error('Paste your support code, or go Back and choose Without a code.');
  if (!(await api.state()).active) await api.start();
  if (mode === 'remote') await api.connect({ code: el('code').value.trim(), consent: true });
  el('code').value = ''; showStep('running'); return '';
});
action('upload', async () => { await api.upload(); return 'Latest report sent.'; });
action('preview', async () => {
  const html = await api.preview();
  if (!html) return 'Enable capture mode, then use Print Receipt in the till. Nothing will be sent to the printer.';
  el('receipt').srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' + html;
  el('receipt').hidden = false; return 'Local document preview; not proof of physical printing. Remote images are blocked.';
});
el('capture').addEventListener('change', async () => { try { await api.capture(el('capture').checked); } catch (e) { el('status').textContent = e.message; } await refresh(); });
setInterval(() => refresh().catch(() => {}), 2000);
refresh().catch(e => { el('status').textContent = e.message; });
