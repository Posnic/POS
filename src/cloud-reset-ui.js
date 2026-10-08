'use strict';
(() => {
  const panel = document.getElementById('cloudConflict');
  const remove = document.getElementById('deleteLocalShop');
  const keep = document.getElementById('keepLocalShop');
  window.showCloudConflict = result => {
    panel.hidden = result?.code !== 'LOCAL_SHOP_CONFLICT';
  };
  keep.onclick = () => {
    panel.hidden = true;
    document.getElementById('browserSignInBtn')?.focus();
    document.getElementById('browserBtn')?.focus();
  };
  remove.onclick = async () => {
    remove.disabled = keep.disabled = true;
    remove.textContent = 'Preparing reset…';
    const status = document.getElementById('cloudResetStatus');
    status.textContent = '';
    try {
      const result = await window.electronAPI.cloud.resetLocalShop();
      if (result.ok) status.textContent = 'Restarting setup…';
      else if (!result.cancelled) status.textContent = result.error || 'Could not reset. Please retry.';
    } catch (error) { status.textContent = error.message; }
    finally {
      remove.disabled = keep.disabled = false;
      remove.textContent = 'Delete local data and restart';
    }
  };
})();
