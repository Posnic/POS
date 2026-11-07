'use strict';
async function openShop(id) {
  try { await window.electronAPI.install.openShop(id); }
  catch { document.getElementById('status').textContent = 'Could not open the shop. Try again.'; }
}
async function load() {
  const { active, shops, connected } = await window.electronAPI.install.shops();
  const search = document.getElementById('search');
  const current = shops.find(shop => shop.id === active);
  document.getElementById('title').textContent = shops.length > 1 ? 'Switch shop' : current.name;
  search.hidden = shops.length < 2;
  function explain(shop, trigger) {
    const picker = document.getElementById('picker');
    const details = document.getElementById('details');
    const title = document.getElementById('actionTitle');
    const back = document.getElementById('back');
    const confirm = document.getElementById('confirm');
    const status = document.getElementById('status');
    title.textContent = shop ? 'Open ' + shop.name : 'Add another shop';
    const nextStep = shop
      ? 'Posnic will restart and open ' + shop.name + '.'
      : 'Posnic will restart and open cloud setup for the additional shop.';
    document.getElementById('description').textContent =
      nextStep + ' Your sales and other saved records stay in ' + current.name +
      '. You can open it again from Shops on this computer.';
    confirm.textContent = shop ? 'Open ' + shop.name : 'Continue to cloud setup';
    picker.hidden = true;
    details.hidden = false;
    status.textContent = '';
    title.focus();
    back.onclick = () => {
      details.hidden = true;
      picker.hidden = false;
      status.textContent = '';
      trigger.focus();
    };
    confirm.onclick = async () => {
      back.disabled = confirm.disabled = true;
      status.textContent = 'Opening ' + (shop ? shop.name : 'cloud setup') + '…';
      try {
        await window.electronAPI.install.openShop(shop ? shop.id : 'add');
      } catch {
        back.disabled = confirm.disabled = false;
        status.textContent = 'The shop could not open. Go back to return to ' + current.name + '.';
      }
    };
  }
  function display() {
    const list = document.getElementById('shops');
    list.replaceChildren();
    for (const shop of shops.filter(s => s.name.toLowerCase().includes(search.value.trim().toLowerCase()))) {
      const row = document.createElement('li');
      const label = document.createElement('div');
      label.textContent = shop.name;
      row.append(label);
      if (shop.id === active) {
        const state = document.createElement('small');
        state.setAttribute('aria-current', 'true');
        state.textContent = (connected ? 'Cloud connected' : 'Local shop') + ' · Current shop';
        label.append(state);
      } else {
        const button = document.createElement('button');
        button.textContent = 'Open ' + shop.name;
        button.onclick = () => explain(shop, button);
        row.append(button);
      }
      list.append(row);
    }
  }
  display();
  search.oninput = display;
  const connect = document.getElementById('connect');
  connect.hidden = connected;
  connect.onclick = () => openShop('connect');
  const add = document.getElementById('add');
  add.disabled = false;
  add.onclick = () => explain(null, add);
}
load().catch(() => { document.getElementById('status').textContent = 'Could not read shops on this computer.'; });
