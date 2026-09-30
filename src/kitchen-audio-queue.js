'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
class KitchenAudioQueue {
  constructor(file, settings) {
    this.file = file;
    this.settings = settings;
    this.recordings = new Map();
    this.jobs = [];
    try {
      this.jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        !Array.isArray(this.jobs) ||
        this.jobs.some((j) => !Array.isArray(j.steps) || !Array.isArray(j.targets))
      )
        throw Error(
          'Saved kitchen audio queue is damaged. Contact support; pending messages were preserved.',
        );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.jobs));
    fs.renameSync(temp, this.file);
  }
  paused() {
    const now = Date.now();
    for (const [id, recording] of this.recordings) {
      if (recording.uploadUntil <= now) this.recordings.delete(id);
    }
    return this.settings().pauseWhileRecording !== false && [...this.recordings.values()].some(recording => recording.until > now);
  }
  start(owner) {
    if (!this.settings().talkEnabled) throw Error('Kitchen talk is disabled.');
    if (!this.settings().outputs?.length) throw Error('Choose kitchen speakers first.');
    this.paused(); // Expire abandoned recordings without blocking other senders.
    if (this.recordings.size >= 50) throw Error('Too many recordings waiting to send. Please retry.');
    const recording = { owner, id: crypto.randomUUID(), until: Date.now() + 35000 };
    // Network uploads may finish after recording ends; they must not hold playback paused.
    recording.uploadUntil = recording.until + 120000;
    this.recordings.set(recording.id, recording);
    return { id: recording.id, expiresAt: recording.until };
  }
  cancel(owner, id) {
    if (this.recordings.get(id)?.owner === owner) this.recordings.delete(id);
  }
  validateVoice(owner, id, data) {
    const existing = this.jobs.find((j) => j.id === id && j.owner === owner);
    if (existing) {
      if (existing.kind !== 'voice' || existing.steps.at(-1)?.audio !== data)
        throw Error('This message ID already contains a different recording.');
      return { id, queued: true };
    }
    this.paused();
    if (this.recordings.get(id)?.owner !== owner)
      throw Error('Talk session expired. Please record again.');
    if (
      typeof data !== 'string' ||
      data.length > 1500000 ||
      !/^data:audio\/(webm|ogg|mp4|wav)(;codecs=[a-zA-Z0-9., -]+)?;base64,[A-Za-z0-9+/=]+$/.test(
        data,
      )
    )
      throw Error('Invalid or oversized voice message.');
    if (!this.settings().talkEnabled) throw Error('Kitchen voice messages are disabled.');
    return { id, queued: false };
  }
  voice(owner, id, data) {
    const validated = this.validateVoice(owner, id, data);
    if (validated.queued) return validated;
    const config = this.settings();
    const steps = [];
    if (config.talkTing) steps.push({audio:require('./order-alert').bellSound('arrival',config.talkBell)});
    steps.push({audio:data});
    const job = this.enqueue({ steps, kind: 'voice', owner }, id);
    this.recordings.delete(id);
    return job;
  }
  enqueue(payload, id = crypto.randomUUID()) {
    if (this.jobs.some((j) => j.id === id)) return { id, queued: true };
    if (!Array.isArray(payload.steps) || !payload.steps.length || payload.steps.length > 500)
      throw Error('Invalid audio message.');
    const outputs = (this.settings().outputs || []).filter(
      (o) => !payload.outputIds || payload.outputIds.includes(o.id),
    );
    if (!outputs.length) throw Error('Choose kitchen speakers first.');
    if (this.jobs.filter((j) => !j.complete).length >= 50)
      throw Error('Kitchen audio queue is full. Check speakers.');
    const targets = outputs.map((o) => ({
      id: o.id,
      label: o.label,
      index: 0,
      error: '',
      next: 0,
    }));
    const job = {
      id,
      created: Date.now(),
      kind: payload.kind || 'order',
      owner: payload.owner,
      steps: payload.steps,
      targets,
      complete: false,
    };
    const previous = this.jobs;
    const recentCompleted = new Set(this.jobs.filter(j => j.complete &&
      j.created > Date.now() - 86400000).slice(-50).map(j => j.id));
    // Trim completed history only. An old disconnected speaker must never lose pending work.
    this.jobs = [...this.jobs.filter(j => !j.complete || recentCompleted.has(j.id)), job];
    if (JSON.stringify(this.jobs).length > 20000000) {
      this.jobs = previous;
      throw Error('Kitchen audio storage is full.');
    }
    try {
      this.save();
    } catch (e) {
      this.jobs = previous;
      throw e;
    }
    return { id, queued: true };
  }
  next() {
    if (this.paused()) return null;
    const blocked = new Set();
    // Persisted insertion order is the tie-breaker even for messages received in the same millisecond.
    for (const j of this.jobs) {
      if (j.complete) continue;
      for (const t of j.targets) {
        if (t.index >= j.steps.length) continue;
        if (blocked.has(t.id)) continue;
        blocked.add(t.id);
        if (t.next <= Date.now())
          return {
            jobId: j.id,
            target: { id: t.id, label: t.label },
            index: t.index,
            step: j.steps[t.index],
            volume: this.settings().volume ?? 1,
          };
      }
    }
    return null;
  }

  ack({ jobId, targetId, index, error }) {
    const j = this.jobs.find((j) => j.id === jobId);
    const t = j?.targets.find((t) => t.id === targetId);
    if (!t || t.index !== index) return false;
    const old = JSON.stringify(this.jobs);
    if (error) {
      t.error = String(error).slice(0, 180);
      t.next = Date.now() + 10000;
    } else {
      t.index++;
      t.error = '';
      t.next = 0;
    }
    j.complete = j.targets.every((t) => t.index >= j.steps.length);
    try {
      this.save();
    } catch (e) {
      this.jobs = JSON.parse(old);
      throw e;
    }
    return true;
  }
  status(owner) {
    return {
      paused: this.paused(),
      jobs: this.jobs.filter((j) => !owner || j.owner === owner)
        .filter((j) => !j.complete)
        .concat(this.jobs.filter((j) => j.complete && (!owner || j.owner === owner)).slice(-5))
        .map((j) => ({
          id: j.id,
          kind: j.kind,
          created: j.created,
          complete: j.complete,
          targets: j.targets.map((t) => ({
            label: t.label,
            status: t.index >= j.steps.length ? 'Playback completed' : t.error || 'Waiting',
            done: t.index,
            total: j.steps.length,
          })),
        })),
    };
  }
}
module.exports = { KitchenAudioQueue };
