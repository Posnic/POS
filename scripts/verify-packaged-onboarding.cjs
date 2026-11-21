'use strict';

const { setTimeout: delay } = require('node:timers/promises');

function command(url, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const finish = (error, result) => {
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Onboarding renderer command timed out')), 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = event => {
      const response = JSON.parse(event.data);
      if (response.id !== 1) return;
      if (response.error || response.result?.exceptionDetails) {
        finish(new Error('Onboarding renderer command failed'));
      } else finish(null, response.result);
    };
    ws.onerror = () => finish(new Error('Onboarding debugger connection failed'));
  });
}

async function evaluate(target, expression) {
  const result = await command(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  return result.result?.value;
}

async function waitFor(port, pagePattern, expression, label) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(2000),
      })).json();
      const target = targets.find(t => t.type === 'page' && pagePattern.test(t.url));
      if (target && await evaluate(target, expression)) return target;
    } catch { /* Navigation briefly replaces the renderer target. */ }
    await delay(300);
  }
  throw new Error('Packaged onboarding did not reach ' + label);
}

async function enter(target, id, value) {
  // Input.insertText follows Chromium's editing path, including maxlength.
  // Assigning .value alone would miss the released login truncation bug.
  const focused = await evaluate(target, `(() => {
    const field = document.getElementById(${JSON.stringify(id)});
    if (!field || field.disabled || !field.getClientRects().length) return false;
    field.focus(); field.select(); return document.activeElement === field;
  })()`);
  if (!focused) throw new Error('Onboarding input is unavailable: ' + id);
  await command(target.webSocketDebuggerUrl, 'Input.insertText', { text: value });
  const exact = await evaluate(target, `document.getElementById(${JSON.stringify(id)}).value === ${JSON.stringify(value)}`);
  if (!exact) throw new Error('Onboarding input changed or truncated: ' + id);
}

async function verifyOnboarding(port, wizard) {
  // Only called from smokeExecutable's newly-created isolated profile. Never
  // attach this test to a customer's running till or an existing user profile.
  const email = 'package-acceptance@example.invalid';
  const password = ' PackageAcceptance!LongPassword194 ';
  await evaluate(wizard, "document.getElementById('chooseLocalBtn').click(); true");
  for (const [id, value] of Object.entries({
    qBusinessName: 'Package Acceptance Shop', qEmail: email,
    qPassword: password, qConfirmPassword: password,
  })) await enter(wizard, id, value);
  await evaluate(wizard, `(() => {
    const country = document.getElementById('qCountry');
    country.value = 'United Arab Emirates';
    country.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  for (const [id, value] of Object.entries({
    qState: 'Dubai', qCity: 'Dubai', qTimezone: 'Asia/Dubai',
  })) await enter(wizard, id, value);
  await evaluate(wizard, "document.getElementById('qCreateBtn').click(); true");
  wizard = await waitFor(port, /install-wizard\.html/, "document.getElementById('recoverySaved')?.getClientRects().length > 0", 'the recovery-code confirmation');
  // Test-only credentials and codes are disposable; do not print them in logs.
  await evaluate(wizard, "document.getElementById('recoverySaved').click(); document.getElementById('recoveryContinue').click(); true");
  const login = await waitFor(port, /login\.html/, "document.readyState === 'complete' && !!window.PosnicPro?.users?.loginCheck && !!document.getElementById('login_button')", 'the login form');
  await enter(login, 'username', email);
  await enter(login, 'password', 'DeliberatelyWrong!Password');
  await evaluate(login, "document.getElementById('login_button').click(); true");
  await waitFor(port, /login\.html/, "document.getElementById('login_error')?.innerText.includes('Username or password is incorrect') && document.getElementById('login_error').getClientRects().length > 0 && !localStorage.getItem('posnic_jwt_token')", 'wrong-password rejection');
  await enter(login, 'username', email);
  await enter(login, 'password', password);
  await evaluate(login, "document.getElementById('login_button').click(); true");
  const dashboard = await waitFor(port, /dashboard\.html/, "document.readyState === 'complete' && !!localStorage.getItem('posnic_jwt_token') && !!document.body?.innerText.trim()", 'the authenticated dashboard');
  await evaluate(dashboard, "document.getElementById('logout').click(); true");
  const confirmation = await waitFor(port, /dashboard\.html/, "document.querySelector('.swal2-confirm')?.getClientRects().length > 0", 'logout confirmation');
  await evaluate(confirmation, "document.querySelector('.swal2-confirm').click(); true");
  const loggedOut = await waitFor(port, /login\.html/, "document.readyState === 'complete' && !!window.PosnicPro?.users?.loginCheck && !localStorage.getItem('posnic_jwt_token')", 'the logged-out form');
  await enter(loggedOut, 'username', email);
  await enter(loggedOut, 'password', password);
  await evaluate(loggedOut, "document.getElementById('login_button').click(); true");
  await waitFor(port, /dashboard\.html/, "document.readyState === 'complete' && !!localStorage.getItem('posnic_jwt_token') && !!document.body?.innerText.trim()", 'the dashboard after signing in again');
  console.log('PASS: packaged offline setup rejected a wrong password, authenticated exact new credentials, and signed in again after logout.');
}

module.exports = { verifyOnboarding };
