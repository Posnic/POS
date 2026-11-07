'use strict';
(() => {
  const panel = document.getElementById('cloudConflict');
  const manage = document.getElementById('manageLocalShops');
  const keep = document.getElementById('keepLocalShop');
  const shops = document.getElementById('shopsOnComputer');
  if (shops) shops.onclick = () => window.electronAPI.cloud.manageShops();
  window.showCloudConflict = result => {
    panel.hidden = result?.code !== 'LOCAL_SHOP_CONFLICT';
  };
  keep.onclick = () => {
    panel.hidden = true;
    document.getElementById('browserSignInBtn')?.focus();
    document.getElementById('browserBtn')?.focus();
  };
  manage.onclick = () => window.electronAPI.cloud.manageShops();
})();
