'use strict';
const $ = (id) => document.getElementById(id);
let csrf = '';
async function call(path, body) {
  const response = await fetch(new URL('captain/v1/' + path, location.href), {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  csrf = response.headers.get('X-CSRF-TOKEN') || csrf;
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message || 'Sign in to the desktop and open Captain settings again.'
    );
  return data;
}
call('settings')
  .then((data) => {
    $('branch').textContent = data.branch;
    $('fallback-url').value = data.fallbackUrl || '';
    for (const staff of data.staff) {
      const option = document.createElement('option');
      option.value = staff.id;
      option.textContent = staff.name;
      $('staff').append(option);
    }
    $('generate').disabled = !data.staff.length;
  })
  .catch((e) => ($('message').textContent = e.message));
$('save-connection').onclick = async () => {
  try {
    await call('connection-settings', { fallbackUrl: $('fallback-url').value });
    $('connection-message').textContent =
      'Saved. Reconnect existing phones to receive the new address immediately; otherwise they receive it at their next session renewal.';
  } catch (e) {
    $('connection-message').textContent = e.message;
  }
};
$('generate').onclick = async () => {
  $('generate').disabled = true;
  try {
    const data = await call('pair-codes', { staffId: $('staff').value });
    $('result').hidden = false;
    $('name').textContent = data.staffName + ' · ' + data.branchName;
    $('code').textContent = data.code;
    $('address').replaceChildren();
    for (const target of data.targets) {
      const option = document.createElement('option');
      option.value = target.qr;
      option.textContent = target.url;
      $('address').append(option);
    }
    $('address').onchange = () => {
      $('qr').src = $('address').value;
    };
    $('address').onchange();
    $('message').textContent = data.targets.length
      ? 'Scan this QR using Captain.'
      : 'No local address found. Connect the till to the shop network and retry.';
  } catch (e) {
    $('message').textContent = e.message;
  } finally {
    $('generate').disabled = false;
  }
};
