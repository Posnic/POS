'use strict';
(async function () {
  const api = window.electronAPI,
    bridge = api.kitchenAudio,
    settings = api.kitchenCall;
  const host = document.getElementById('kitchenAudioOutputs');
  if (!host) return;
  const status = document.getElementById('kitchenAudioStatus');
  let saved = await settings.get();
  const volume = document.getElementById('kitchenAudioVolume'),
    enabled = document.getElementById('kitchenTalkEnabled'),
    branch = document.getElementById('kitchenAudioBranch');
  const talkTing=document.getElementById('kitchenTalkTing'),talkBell=document.getElementById('kitchenTalkBell'),pauseRecording=document.getElementById('kitchenPauseRecording');
  talkTing.checked=!!saved.talkTing;pauseRecording.checked=saved.pauseWhileRecording!==false;
  for(const name of (await settings.bells()).arrival||[]){const option=document.createElement('option');option.value=name;option.textContent=name;talkBell.append(option);}
  talkBell.value=saved.talkBell||'rising';
  document.getElementById('kitchenTalkBellTest').onclick=async()=>{try{await save();await bridge.preview('arrival',talkBell.value);status.textContent='Voice-message ting queued for selected speakers.';}catch(e){status.textContent=e.message;}};
  volume.value = saved.volume ?? 1;
  const volumeValue = document.getElementById('kitchenVolumeValue');
  const updateVolume = () => { volumeValue.textContent = Math.round(Number(volume.value) * 100) + '%'; };
  volume.addEventListener('input', updateVolume);
  updateVolume();
  enabled.checked = !!saved.talkEnabled;
  const branches = (await api.kot.getConfig()).branches || [];
  for (const b of branches) {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = b.name;
    branch.append(o);
  }
  branch.value = saved.branchId || '';
  async function refresh() {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'audiooutput' && !['default', 'communications'].includes(d.deviceId),
    );
    const chosen = new Map((saved.outputs || []).map((o) => [o.id, o]));
    host.textContent = '';
    const list = devices.map((d, i) => ({
      id: d.deviceId,
      label: d.label || 'Audio output ' + (i + 1),
      present: true,
    }));
    for (const o of chosen.values())
      if (!list.some((d) => d.id === o.id)) list.push({ ...o, present: false });
    for (const d of list) {
      const row = document.createElement('div');
      row.className = 'sound-speaker';
      const label = document.createElement('label'),
        cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = chosen.has(d.id);
      cb.dataset.id = d.id;
      cb.dataset.label = d.label;
      label.append(
        cb,
        document.createTextNode(' ' + d.label + (d.present ? '' : ' — disconnected')),
      );
      const test = document.createElement('button');
      test.className = 'btn';
      test.textContent = 'Test';
      test.setAttribute('aria-label', 'Test ' + d.label);
      test.onclick = async () => {
        try {
          await save();
          const r = await bridge.test(d.id);
          status.textContent = 'Speaker test queued.';
        } catch (e) {
          status.textContent = e.message;
        }
      };
      row.append(label, test);
      host.append(row);
    }
    if (!list.length)
      host.textContent = 'No audio outputs found. Connect your speaker and refresh.';
  }
  async function save() {
    const outputs = [...host.querySelectorAll('input:checked')].map((cb) => ({
      id: cb.dataset.id,
      label: cb.dataset.label,
    }));
    if (!outputs.length) throw Error('Select at least one kitchen speaker.');
    const ok = await settings.set({
      outputs,
      volume: Number(volume.value),
      talkEnabled: enabled.checked,
      talkTing: talkTing.checked, talkBell:talkBell.value, pauseWhileRecording:pauseRecording.checked,
      ting: document.getElementById('kitchenTing').checked,
      speak: document.getElementById('kitchenSpeak').checked,
      itemTing: document.getElementById('kitchenItemTing').checked,
      arrivalBell: document.getElementById('kitchenArrivalBell').value||saved.arrivalBell,
      itemBell: document.getElementById('kitchenItemBell').value||saved.itemBell,
      voice: document.getElementById('kitchenVoice').value,
      branchId: branch.value,
    });
    if (!ok) throw Error('Could not save kitchen audio settings.');
    saved = await settings.get();
    window.dispatchEvent(new CustomEvent('kitchen-audio-saved'));
    status.textContent = 'Settings saved for new messages.';
    return true;
  }
  window.saveKitchenAudioSettings=save;
  document.getElementById('soundTab').addEventListener('change', () => {
    document.getElementById('kitchenSoundSaveResult').textContent = 'Unsaved changes';
  });
  document.getElementById('kitchenAudioRefresh').onclick = () =>
    refresh().catch((e) => (status.textContent = e.message));
  await refresh();
  const button = document.getElementById('kitchenTalk');
  const preview = document.getElementById('kitchenTalkPreview');
  const send = document.getElementById('kitchenTalkSend');
  const discard = document.getElementById('kitchenTalkDiscard');
  const timer = document.getElementById('kitchenTalkTimer');
  let busy = false, recorder, stream, session, draft, uploadId, limit, ticker,
    started = 0, generation = 0, cancelled = false;
  function renderMessage() {
    const recording = recorder?.state === 'recording';
    button.hidden = !!draft;
    button.disabled = busy;
    button.textContent = recording ? 'Stop recording' : 'Record message';
    button.dataset.recording = String(recording);
    timer.hidden = !recording;
    preview.hidden = !draft;
    send.hidden = discard.hidden = !draft;
    send.disabled = discard.disabled = busy;
  }
  function stop(cancel = false) {
    cancelled = cancelled || cancel;
    clearTimeout(limit);
    clearInterval(ticker);
    if (recorder?.state === 'recording') { busy = true; renderMessage(); recorder.stop(); }
    stream?.getTracks().forEach(t => t.stop());
  }
  button.onclick = async () => {
    if (busy) return;
    if (recorder?.state === 'recording') { stop(); return; }
    busy = true;
    cancelled = false;
    const current = ++generation;
    renderMessage();
    status.textContent = 'Opening microphone…';
    try {
      session = await bridge.start();
      if (current !== generation) { await bridge.cancel(session.id); return; }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (current !== generation) { stop(true); await bridge.cancel(session.id); return; }
      const parts = [];
      recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
      recorder.onerror = () => { status.textContent = 'Recording failed. Please try again.'; stop(true); };
      recorder.onstop = async () => {
        busy = true;
        stream.getTracks().forEach(t => t.stop());
        clearTimeout(limit); clearInterval(ticker);
        renderMessage();
        try {
          // Listening to a draft must not pause the shared kitchen speaker queue.
          await bridge.cancel(session.id);
          if (cancelled || current !== generation) return;
          const blob = new Blob(parts, { type: recorder.mimeType });
          if (!blob.size || blob.size > 1000000) throw Error('Recording failed. Please record again.');
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.onerror = reject; reader.readAsDataURL(blob);
          });
          if (cancelled || current !== generation) return;
          draft = data; uploadId = null; preview.src = draft;
          status.textContent = 'Listen to your message, then send or discard.';
        } catch (e) { status.textContent = e.message; }
        finally { session = null; recorder = null; busy = false; renderMessage(); }
      };
      recorder.start(); started = Date.now(); timer.textContent = '0:00';
      ticker = setInterval(() => { timer.textContent = '0:' + String(Math.floor((Date.now()-started)/1000)).padStart(2,'0'); }, 250);
      limit = setTimeout(() => stop(), 30000);
      status.textContent = 'Recording… Tap Stop when finished.';
    } catch (e) {
      status.textContent = e.message;
      stop(true);
      if (session) await bridge.cancel(session.id).catch(() => {});
      session = null;
    } finally { busy = false; renderMessage(); }
  };
  send.onclick = async () => {
    if (busy || !draft) return;
    busy = true; preview.pause(); renderMessage();
    status.textContent = 'Sending message…';
    try {
      if (!uploadId) uploadId = (await bridge.start()).id;
      // Retry an uncertain response with the same ID; never create a second broadcast.
      await bridge.voice(uploadId, draft);
      draft = null; uploadId = null; preview.removeAttribute('src');
      status.textContent = 'Voice message queued for the kitchen.';
    } catch (e) { status.textContent = e.message + ' Your recording is kept here; retry Send.'; }
    finally { busy = false; renderMessage(); }
  };
  discard.onclick = () => {
    if (busy) return;
    preview.pause(); preview.removeAttribute('src'); draft = null;
    if (uploadId) bridge.cancel(uploadId).catch(() => {});
    uploadId = null; status.textContent = 'Recording discarded.'; renderMessage();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => {
    generation++; stop(true); preview.pause();
    if (session) bridge.cancel(session.id).catch(() => {});
  });
  renderMessage();
  const report = document.getElementById('kitchenAudioJobs');
  const summary = document.getElementById('kitchenPlaybackSummary');
  setInterval(async () => {
    try {
      const value = await bridge.status();
      const pending = value.jobs.filter((j) => !j.complete);
      const failed = pending.some((j) => j.targets.some((t) => t.status !== 'Waiting' && t.status !== 'Playback completed'));
      summary.textContent = value.error || failed ? 'Playback needs attention — open details' : pending.length ? pending.length + ' queued for playback' : 'No messages waiting';
      summary.dataset.attention = String(!!value.error || failed);
      report.textContent =
        (value.error ? value.error + '\n' : '') +
        value.jobs
          .map(
            (j) =>
              (j.kind === 'voice' ? 'Staff voice message' : j.kind === 'order' ? 'Automatic order' : 'Speaker test') +
              ' — ' +
              j.targets.map((t) => t.label + ': ' + t.status).join('; '),
          )
          .join('\n') ||
        'No queued audio.';
    } catch (e) {
      report.textContent = 'Audio service unavailable.';
      summary.textContent = 'Audio service unavailable';
      summary.dataset.attention = 'true';
    }
  }, 2000);
})().catch((e) => {
  const status = document.getElementById('kitchenAudioStatus');
  if (status) status.textContent = e.message;
});
