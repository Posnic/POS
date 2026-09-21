'use strict';
/* global document, location, window */
const $ = (id) => document.getElementById(id);
const paymentView = new URLSearchParams(location.search).get('view') === 'payments';
const api = new URL(paymentView ? 'branch-payments' : 'mobile/v1/', location.href).pathname;
if (paymentView) {
  document.querySelector('h1').textContent = 'Branch payments';
  document.title = 'Branch payments';
  document.querySelectorAll('#settings > section').forEach((el) => {
    el.hidden = el.id !== 'payments-section';
  });
  $('device-links').hidden = true;
} else {
  $('payments-section').hidden = true;
}
document.querySelectorAll('#settings > section[hidden] input').forEach((el) => {
  el.disabled = true;
});
document.querySelectorAll('[data-nav]').forEach((button) => {
  button.onclick = () => {
    const section = button.dataset.nav;
    if (window.parent !== window)
      window.parent.postMessage({ type: 'posnic-settings-nav', section }, '*');
    else
      message(
        'On the desktop, open Settings → ' +
          ({ modules: 'Features', devices: 'Devices', branchpayments: 'Branch payments' }[
            section
          ] || section)
      );
  };
});
let csrf = '',
  state;
async function call(path, body) {
  const response = await fetch(api + path, {
    credentials: 'same-origin',
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  csrf = response.headers.get('X-CSRF-TOKEN') || csrf;
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        data.message ||
        'Sign in to the desktop, then open Mobile POS settings again.'
    );
  return data;
}
function message(error) {
  $('message').textContent = error.message || error;
}
function account(row = {}) {
  const box = document.createElement('div');
  box.className = 'account';
  box.dataset.id = row.id || crypto.randomUUID();
  const name = document.createElement('input');
  name.placeholder = 'Account name';
  name.value = row.name || '';
  name.className = 'name';
  name.required = true;
  name.maxLength = 80;
  name.setAttribute('aria-label', 'UPI account name');
  const vpa = document.createElement('input');
  vpa.placeholder = 'UPI ID, for example shop@bank';
  vpa.value = row.vpa || '';
  vpa.className = 'vpa';
  vpa.required = true;
  vpa.setAttribute('aria-label', 'UPI ID');
  const label = document.createElement('label'),
    radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'default';
  radio.checked = row.id === state.defaultUpiAccountId || !$('accounts').children.length;
  label.append(radio, ' Default account');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.onclick = () => {
    box.remove();
    if (!document.querySelector('input[name=default]:checked')) {
      const first = document.querySelector('input[name=default]');
      if (first) first.checked = true;
    }
  };
  box.append(name, vpa, label, remove);
  $('accounts').append(box);
}
async function load() {
  state = await call(paymentView ? '' : 'settings');
  $('accounts').replaceChildren();
  state.upiAccounts.forEach(account);
  if (paymentView) {
    $('branch').textContent = state.branch;
    $('settings').hidden = false;
    return;
  }
  $('branch').textContent = state.branch;
  $('feature-status').textContent = state.enabled
    ? 'Mobile POS is enabled for this branch.'
    : 'Mobile POS is off. Enable it in Settings → Features.';
  $('pair').disabled = !state.enabled;
  $('hours').value = state.offlineHours;
  $('quick').checked = state.quickSale;
  $('tax').value = state.quickTaxBps / 100;
  $('inclusive').checked = state.quickTaxInclusive;
  $('till').value = state.tillId;
  $('accounts').replaceChildren();
  state.upiAccounts.forEach(account);
  $('addresses').replaceChildren();
  const addresses = [...new Map(state.addresses.map((a) => [a.url, a])).values()];
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Shop network address');
  const image = document.createElement('img');
  image.width = 180;
  image.height = 180;
  addresses.forEach((a, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = a.url;
    select.append(option);
  });
  const showAddress = () => {
    const a = addresses[Number(select.value)];
    if (a) {
      image.src = a.qr;
      image.alt = 'Scan to connect to ' + a.url;
    }
  };
  select.onchange = showAddress;
  showAddress();
  $('addresses').append(select, image);
  $('settings').hidden = false;
  $('attention').replaceChildren();
  (state.attention || []).forEach((row) => {
    const p = document.createElement('p');
    p.textContent =
      (row.sale?.receipt || '') + ' · ' + row.state + ' · ' + (row.issues || []).join('; ');
    $('attention').append(p);
  });
  $('attention-section').hidden = !state.attention?.length;
}
$('add').onclick = () => account();
$('settings').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const rows = [...document.querySelectorAll('.account')];
    if (paymentView) {
      await call('', {
        upiAccounts: rows.map((r) => ({
          id: r.dataset.id,
          name: r.querySelector('.name').value.trim(),
          vpa: r.querySelector('.vpa').value.trim(),
        })),
        defaultUpiAccountId:
          rows.find((r) => r.querySelector('input[type=radio]').checked)?.dataset.id || '',
      });
      message('Saved. Branch payment accounts updated.');
      return;
    }
    await call('settings', {
      offlineHours: Number($('hours').value),
      quickSale: $('quick').checked,
      quickTaxBps: Math.round(Number($('tax').value) * 100),
      quickTaxInclusive: $('inclusive').checked,
      tillId: $('till').value,
    });
    message('Saved. The phone can now connect when Mobile POS is enabled.');
  } catch (error) {
    message(error);
  }
};
$('pair').onclick = async () => {
  try {
    const result = await call('pair-codes', {});
    $('code').textContent = result.code;
    $('code-help').textContent =
      'Signs in as ' +
      result.staffName +
      '. Expires at ' +
      new Date(result.expires).toLocaleTimeString() +
      '. Use once on the phone.';
  } catch (e) {
    message(e);
  }
};
load().catch(message);
$('recover').onclick = async () => {
  try {
    const r = await call('recover', {});
    message('Resumed ' + r.recovered + ' sales.');
    await load();
  } catch (e) {
    message(e);
  }
};
