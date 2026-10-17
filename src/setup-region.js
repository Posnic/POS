'use strict';
(() => {
  const data = window.PosnicSetupRegionData;
  const field = id => document.getElementById(id);
  const country = field('qCountry'), currency = field('qCurrency');
  if (!data || !country) return;
  const option = (value, text = value) => new Option(text, value);
  data.countries.forEach(row => country.add(option(row[2])));
  data.currencies.forEach(code => currency.add(option(code)));
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  zones.forEach(zone => field('qTimezoneList').appendChild(option(zone)));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  field('qTimezone').value = timezone;
  function updateCountry() {
    const row = data.countries.find(row => row[2] === country.value);
    field('qState').value = '';
    field('qStateList').replaceChildren();
    const states = row ? data.states.filter(state => state[0] === row[0]) : [];
    states.forEach(state => field('qStateList').appendChild(option(state[1])));
    field('qState').required = states.length > 0;
    document.querySelector('label[for="qState"]').textContent = states.length ? 'State / province *' : 'State / province';
    if (row && data.currencies.includes(row[3])) currency.value = row[3];
    else currency.value = '';
  }
  // Language is not location (many Indian computers use en-US). Only suggest
  // a country when the device timezone matches one bundled country mapping.
  try {
    const canonical = zone => new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
    const matches = Object.entries(data.timezones).filter(([, zone]) => canonical(zone) === canonical(timezone));
    if (matches.length === 1 && data.countries.some(row => row[2] === matches[0][0])) {
      country.value = matches[0][0]; updateCountry();
    }
  } catch (_) { /* Country remains an explicit choice. */ }
  country.addEventListener('change', updateCountry);
  const ids = ['qBusinessName', 'qEmail', 'qPassword', 'qConfirmPassword', 'qCountry', 'qState', 'qCity', 'qCurrency', 'qTimezone'];
  ids.forEach(id => {
    const input = field(id);
    const error = document.createElement('div');
    error.id = id + 'Error'; error.className = 'setup-field-error'; error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    input.insertAdjacentElement('afterend', error);
    input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
  });
  function values() {
    const row = data.countries.find(row => row[2] === country.value);
    return { register_country: country.value, register_countryid: row ? row[0] : '',
      register_state: field('qState').value.trim(), register_city: field('qCity').value.trim(),
      register_currency: currency.value, register_timezone: field('qTimezone').value.trim() };
  }
  function validate() {
    const messages = {};
    if (field('qConfirmPassword').value && field('qConfirmPassword').value !== field('qPassword').value) messages.qConfirmPassword = 'Passwords do not match.';
    const required = { qBusinessName: 'Enter your shop name.', qEmail: 'Enter your login email.', qPassword: 'Enter a password.', qConfirmPassword: 'Confirm your password.',
      qCountry: 'Select the country where your shop is located.', qCity: 'Enter your city or town.',
      qCurrency: 'Select your shop currency.', qTimezone: 'Select a valid timezone.' };
    if (field('qState').required) required.qState = 'Enter your state or province.';
    Object.entries(required).forEach(([id, message]) => { if (!field(id).value.trim()) messages[id] = message; });
    if (field('qEmail').value.trim() && !field('qEmail').validity.valid) messages.qEmail = 'Enter a valid email address, for example name@example.com.';
    if (field('qPassword').value && field('qPassword').value.length < 8) messages.qPassword = 'Use at least 8 characters for your password.';
    const row = data.countries.find(row => row[2] === country.value);
    const states = row ? data.states.filter(state => state[0] === row[0]).map(state => state[1]) : [];
    if (states.length && field('qState').value.trim()) {
      const match = states.find(state => state.toLowerCase() === field('qState').value.trim().toLowerCase());
      if (match) field('qState').value = match;
      else messages.qState = 'Choose a state or province from the suggestions for this country.';
    }
    if (field('qTimezone').value.trim()) {
      try { new Intl.DateTimeFormat('en', { timeZone: field('qTimezone').value.trim() }).format(); }
      catch (_) { messages.qTimezone = 'Choose a valid timezone, for example Asia/Kolkata.'; }
    }
    ids.forEach(id => { const error = field(id + 'Error'); error.textContent = messages[id] || ''; error.hidden = !messages[id];
      if (messages[id]) field(id).setAttribute('aria-invalid', 'true'); else field(id).removeAttribute('aria-invalid'); });
    const first = ids.find(id => messages[id]);
    if (first) { field('qError').textContent = 'Please correct the highlighted fields.'; field('qError').style.display = 'block'; field(first).focus(); }
    if (!first) { field('qError').textContent = ''; field('qError').style.display = 'none'; }
    return !first;
  }
  window.PosnicSetupRegion = { values, validate };
})();
