/* Device controls never grant access or cache staff/order data. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  async function deviceRequest(path, body) {
    if (demo) throw Error('Device pairing is unavailable in the demo.');
    const response = await fetch('/api/kitchen/devices' + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.message || 'Could not update kitchen devices.');
    return value;
  }
  const run = (id, action) => async () => {
    try {
      await action();
    } catch (error) {
      $(id).textContent = error.message || 'Could not connect.';
    }
  };
  $('device-create').onclick = run('device-manager-result', async () => {
    const result = await deviceRequest('/code', { name: $('device-name').value });
    $('device-manager-result').textContent =
      'Code: ' + result.code + ' — ' + result.branch + '. Valid for five minutes, one screen only.';
  });
  $('device-pair').onclick = run('device-result', async () => {
    const result = await deviceRequest('/pair', { code: $('device-code').value });
    localStorage.setItem('posnic.kitchen.device', result.token);
    $('device-code').value = '';
    location.reload();
  });
  $('device-forget').onclick = () => {
    if (demo) return;
    localStorage.removeItem('posnic.kitchen.device');
    location.reload();
  };
  $('device-list').onclick = run('device-manager-result', async () => {
    const result = await deviceRequest('');
    $('device-list-items').replaceChildren();
    for (const device of result.devices) {
      const row = document.createElement('p'),
        button = document.createElement('button');
      row.textContent = device.name + ' ';
      button.textContent = 'Disconnect';
      button.onclick = run('device-manager-result', async () => {
        await deviceRequest('/revoke', { id: device.id });
        row.remove();
      });
      row.append(button);
      $('device-list-items').append(row);
    }
    $('device-manager-result').textContent = result.devices.length + ' connected screens';
  });
  $('save-delay-settings').onclick = run('delay-result', async () => {
    if (demo) throw Error('Settings are unavailable in the demo.');
    const response = await fetch('/api/kitchen/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orangeMinutes: Number($('orange-minutes').value),
        redMinutes: Number($('red-minutes').value),
        pulse: $('pulse-orders').checked,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.message || 'Could not save settings.');
    $('delay-result').textContent = 'Saved for this branch.';
    $('refresh').click();
  });
  let wake = null,
    wantsWake = false,
    installPrompt = null;
  $('device-address').textContent = 'Start URL: ' + location.origin + '/kitchen/';
  $('setup-toggle').onclick = () => {
    $('device-setup').hidden = !$('device-setup').hidden;
    $('setup-toggle').setAttribute('aria-expanded', String(!$('device-setup').hidden));
  };
  async function acquire() {
    if (!wantsWake || document.hidden || wake) return;
    try {
      if (!navigator.wakeLock) throw Error('unavailable');
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => {
        wake = null;
        $('awake-status').textContent = 'Screen wake lock released by the device.';
      });
      $('awake-status').textContent = 'Screen stays awake while this page is visible.';
    } catch {
      $('awake-status').textContent =
        'Use the device screen-sleep setting. Browser wake lock needs HTTPS and device support.';
    }
  }
  $('keep-awake').onclick = async () => {
    wantsWake = !wantsWake;
    $('keep-awake').textContent = wantsWake ? 'Allow screen sleep' : 'Keep screen awake';
    if (wantsWake) await acquire();
    else {
      await wake?.release();
      wake = null;
      $('awake-status').textContent = 'Normal screen-sleep settings apply.';
    }
  };
  document.addEventListener('visibilitychange', acquire);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('install-board').hidden = false;
  });
  $('install-board').onclick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    $('install-board').hidden = true;
  };
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js', { scope: '/kitchen/' }).catch(() => {});
  } else {
    $('install-help').textContent +=
      ' On plain HTTP, use a browser shortcut or managed kiosk browser; install and wake-lock features may be unavailable.';
  }
})();
