'use strict';
// The installer marks manual installs/updates, not ordinary daily launches.
// Setup never infers cloud deletion from a missing record or copies a profile
// from another device. The existing sync agent remains responsible for sync.
// Setup is post-install configuration. Closing uses the normal window action,
// never uninstall, reset, or rollback; the desktop shortcut opens it again.
document.getElementById('setupLaterBtn')?.addEventListener('click', async () => {
  try { await window.electronAPI?.cloud?.cancelAuthorization?.(); }
  finally { await window.electronAPI?.window?.close?.(); }
});
(async () => {
  const api = window.electronAPI?.install;
  if (!api?.state) return;
  const error = document.getElementById('simpleSetupError');
  const sections = ['stepExisting', 'stepFresh'];
  function show(id) {
    document.querySelectorAll('.form-section').forEach(el => { el.style.display = el.id === id ? 'block' : 'none'; });
    document.body.classList.remove('choosing');
  }
  try {
    const state = await api.state();
    if (!state.existing) return;
    document.getElementById('existingConnection').textContent = state.connected ? 'Linked to cloud · sync resumes automatically' : 'Community edition · data stays on this computer';
    document.getElementById('existingSyncNote').textContent = state.connected
      ? 'Keep your data and hardware settings. Cloud updates and confirmed deletions sync when connected.'
      : 'Keep your data and hardware settings. You can connect to cloud later in Settings.';
    show(sections[0]);
    document.getElementById('continueExisting').onclick = async () => {
      const result = await api.continueExisting();
      if (!result.ok) error.textContent = result.error || 'Please retry.';
    };
    document.getElementById('showFresh').onclick = () => show(sections[1]);
    document.getElementById('freshBack').onclick = () => show(sections[0]);
    document.getElementById('startFresh').onclick = async () => {
      const button = document.getElementById('startFresh');
      button.disabled = true;
      document.getElementById('freshBack').disabled = true;
      const status = document.getElementById('freshStatus');
      status.textContent = 'Closing services and saving a verified recovery copy…';
      try {
        const result = await api.startFresh({ keepHardware: document.getElementById('freshKeepHardware').checked });
        status.textContent = result.ok ? 'Restarting setup…' : result.error || 'Could not save a recovery copy. Setup stopped.';
      } catch (e) { status.textContent = e.message; }
      finally { button.disabled = false; document.getElementById('freshBack').disabled = false; }
    };
  } catch (e) { error.textContent = 'Could not read existing setup: ' + e.message; }
})();
