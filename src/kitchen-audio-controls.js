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
      row.style.cssText = 'display:flex;align-items:center;gap:12px;margin:10px 0';
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
      test.textContent = 'Test this speaker';
      test.onclick = async () => {
        try {
          await save();
          const r = await bridge.test(d.id);
          status.textContent = 'Test queued. Check playback status below.';
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
    status.textContent = 'Kitchen Sound saved. Changes apply to new messages; already queued audio is retained.';
    return true;
  }
  window.saveKitchenAudioSettings=save;
  document.getElementById('kitchenAudioSave').onclick = () =>
    save().catch((e) => (status.textContent = e.message));
  document.getElementById('kitchenAudioRefresh').onclick = () =>
    refresh().catch((e) => (status.textContent = e.message));
  await refresh();
  const button = document.getElementById('kitchenTalk');
  let busy = false,
    held = false,
    session,
    recorder,
    stream,
    limit,
    cancelled = false;
  function stop(cancel = false) {
    held = false;
    cancelled = cancelled || cancel;
    clearTimeout(limit);
    if (recorder?.state === 'recording') recorder.stop();
    else if (session) bridge.cancel(session.id).catch(() => {});
    button.textContent = 'Hold to record kitchen message';
  }
  button.onpointerdown = async (e) => {
    if (busy) return;
    busy = true;
    held = true;
    cancelled = false;
    if (e.pointerId !== null) button.setPointerCapture(e.pointerId);
    try {
      session = await bridge.start();
      if (!held) {
        await bridge.cancel(session.id);
        busy = false;
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!held) {
        stream.getTracks().forEach((t) => t.stop());
        await bridge.cancel(session.id);
        busy = false;
        return;
      }
      const parts = [];
      recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          if (cancelled) return await bridge.cancel(session.id);
          const blob = new Blob(parts, { type: recorder.mimeType });
          const data = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          if (cancelled) return await bridge.cancel(session.id);
          await bridge.voice(session.id, data);
          status.textContent = 'Voice message queued. Check each speaker below.';
        } catch (e) {
          status.textContent = e.message;
        } finally {
          session = null;
          recorder = null;
          busy = false;
        }
      };
      recorder.onerror = () => {
        status.textContent = 'Microphone recording failed.';
        stop(true);
      };
      recorder.start();
      button.textContent = 'Recording — release to send';
      limit = setTimeout(() => stop(), 30000);
    } catch (e) {
      status.textContent = e.message;
      stop(true);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      busy = false;
    }
  };
  button.onkeydown = (e) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      button.onpointerdown({ pointerId: null });
    }
  };
  button.onkeyup = (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      stop();
    }
  };
  button.onpointerup = () => stop();
  button.onpointercancel = () => stop(true);
  window.addEventListener('blur', () => {
    if (recorder?.state === 'recording') stop(true);
  });
  window.addEventListener('pagehide', () => stop(true));
  const report = document.getElementById('kitchenAudioJobs');
  setInterval(async () => {
    try {
      const value = await bridge.status();
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
    }
  }, 2000);
})().catch((e) => {
  const status = document.getElementById('kitchenAudioStatus');
  if (status) status.textContent = e.message;
});
