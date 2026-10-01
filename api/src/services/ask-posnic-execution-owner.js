'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs');
function processNamespace() {
  if (process.platform !== 'linux') return `${process.platform}:system`;
  try { return fs.readlinkSync('/proc/self/ns/pid'); }
  catch (_error) { return null; }
}
const identity = Object.freeze({ host: os.hostname(), pid: process.pid, process_namespace: processNamespace(), instance: crypto.randomUUID(), started_at: new Date() });
const current = () => ({ ...identity });

function running(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw new Error('The worker process state could not be verified.', { cause: error }); }
}

function requireStopped(owner, dependencies = {}) {
  if (!owner?.host || !owner.instance || !owner.process_namespace || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('This older record has no verifiable worker identity; automatic recovery is unavailable.');
  if (String(owner.host).toLowerCase() !== (dependencies.hostname || os.hostname()).toLowerCase()) throw new Error('Run recovery on the worker host; remote process absence cannot be inferred.');
  if (owner.process_namespace !== (dependencies.namespace || processNamespace())) throw new Error('Run recovery in the worker process namespace; a host PID check cannot prove a container worker stopped.');
  if ((dependencies.running || running)(owner.pid)) throw new Error('The worker process is still present. Stop it and verify its termination before recovery.');
  return true;
}

module.exports = { current, requireStopped };
