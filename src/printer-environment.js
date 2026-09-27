'use strict';

// Read-only, bounded diagnostics. No sudo, shell interpolation, test prints or
// automatic power changes. Unknown must never be presented as a healthy result.
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
function command(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, {
    windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}
const instructions = {
  win32: [
    'Open Control Panel → Power Options → Change plan settings → Advanced power settings. Check Sleep and Hibernate for a dedicated counter.',
    'For idle USB failures, record the original USB selective suspend setting and temporarily test Disabled. A desktop may show only “Setting”; a laptop may show Plugged in and On battery. Restore the original value if it does not help.',
    'If the option is missing, check the printer’s USB hub in Device Manager → Properties → Power Management, where available. Test only the affected hub; do not change every USB device.',
    'Open the printer queue in Windows Settings → Printers & scanners. Check paused/offline jobs before trying again. Do not submit another copy of a queued ticket.',
  ],
  darwin: [
    'Keep the Mac connected to power. In System Settings → Battery → Options (laptops), or Energy (desktops), look for “Prevent automatic sleeping when the display is off”. Names vary by macOS and hardware. Keep the laptop lid open while serving.',
    'Open System Settings → Printers & Scanners → your printer → Printer Queue. Resume a paused queue after checking paper, cover, power and connection. Do not reprint a ticket that is still queued.',
    'macOS has no equivalent universal USB selective-suspend switch. Check the printer’s own sleep setting in its manual and test a short direct USB cable or powered hub if it disappears.',
  ],
  linux: [
    'In your desktop’s Power settings, check Automatic Suspend while plugged in. The location varies between GNOME, KDE and other desktops. Keep the laptop lid open while serving.',
    'Open your desktop’s Printers settings or CUPS printer queue. Check whether the queue is paused or rejecting jobs; resume only after checking the printer. Pending tickets may print on resume—do not send extra copies.',
    'USB power/control=auto permits autosuspend; it does not prove autosuspend caused a failure. If shown below, ask your administrator to test power/control=on for that exact printer device only, record the original setting and restore it if it does not help. Do not globally disable USB power management.',
  ],
};
function parsePmset(text) {
  const values = []; let source = 'Current';
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*(AC Power|Battery Power|UPS Power):/);
    if (section) source = section[1];
    const sleep = line.match(/^\s*sleep\s+(\d+)\b/);
    if (sleep) values.push({ source, minutes: Number(sleep[1]) });
  }
  return values;
}
async function inspect({ platform = process.platform, run = command, files = fs, windows } = {}) {
  const checks = [];
  const add = (label, status, detail) => checks.push({ label, status, detail });
  if (platform === 'win32') {
    try {
      const settings = await (windows || require('./windows-printer-transport').systemSettings)();
      for (const [key, label] of [['sleep', 'System sleep'], ['hibernate', 'Hibernate'], ['usbSuspend', 'USB selective suspend']]) {
        for (const [source, name] of [['ac', 'Plugged in / desktop setting'], ['dc', 'Battery setting, if applicable']]) {
          const value = settings[key]?.[source];
          add(`${label} — ${name}`, value == null ? 'unknown' : value === 0 ? 'info' : 'review',
            value == null ? 'Could not read this setting.' : key === 'usbSuspend' ? (value ? 'Enabled; test only if idle disconnections occur.' : 'Disabled.') : (value ? `Configured after ${value} seconds.` : 'Never.'));
        }
      }
      for (const advice of (settings.guidance || []).filter(text => /helper/i.test(text))) add('Windows helper check', 'review', advice);
    } catch (_) { add('Windows power settings', 'unknown', 'Could not read the active power plan. Follow the manual steps below.'); }
  } else if (platform === 'darwin' || platform === 'linux') {
    await Promise.all(['-p', '-a'].map(async flag => {
      try {
        const text = await run('lpstat', [flag]);
        add(flag === '-p' ? 'CUPS printer queues' : 'CUPS job acceptance', /disabled|not accepting/i.test(text) ? 'review' : 'info', text || 'No printer queues reported.');
      } catch (_) { add('CUPS ' + flag, 'unknown', 'Could not query printer queues. CUPS may be unavailable or access restricted. Check Printers settings.'); }
    }));
    if (platform === 'darwin') {
      try {
        const values = parsePmset(await run('pmset', ['-g', 'custom']));
        if (!values.length) throw new Error('Unrecognized output');
        for (const value of values) add('System sleep — ' + value.source, value.minutes ? 'review' : 'info', value.minutes ? `Configured after ${value.minutes} minutes.` : 'Never.');
      } catch (_) { add('macOS sleep settings', 'unknown', 'Could not read sleep settings. Review System Settings manually.'); }
      add('USB and printer firmware sleep', 'unknown', 'Queue availability does not confirm a USB connection or paper output. Printer-specific sleep settings cannot be checked here.');
    } else {
      for (const source of ['ac', 'battery']) {
        try {
          const action = (await run('gsettings', ['get', 'org.gnome.settings-daemon.plugins.power', 'sleep-inactive-' + source + '-type'])).replace(/'/g, '');
          if (!['nothing', 'suspend', 'hibernate', 'shutdown', 'interactive', 'blank', 'logout'].includes(action)) throw new Error('Unknown policy');
          let delay = null;
          try {
            const raw = await run('gsettings', ['get', 'org.gnome.settings-daemon.plugins.power', 'sleep-inactive-' + source + '-timeout']);
            const match = raw.trim().match(/^(?:uint32\s+)?(\d+)$/);
            if (match) delay = Number(match[1]);
          } catch (_) { /* show policy, but do not invent a timeout */ }
          const harmless = action === 'nothing' || action === 'blank' || delay === 0;
          add('GNOME idle action — ' + source, harmless ? 'info' : delay === null ? 'unknown' : 'review',
            action + (delay === null ? '; timeout could not be verified.' : delay === 0 ? '; idle timeout disabled.' : ` after ${delay} seconds.`) + ' Applies only if this session uses GNOME power management.');
        } catch (_) { add('Desktop sleep — ' + source, 'unknown', 'GNOME settings unavailable. KDE, other desktops, logind and power tools may have separate policies. Check your desktop Power settings.'); }
      }
      try {
        const base = '/sys/bus/usb/devices';
        const entries = await files.readdir(base); const devices = new Set();
        // Printer class is on the interface; read power state on its parent device.
        for (const entry of entries.filter(name => /^\d+-[\d.]+:\d+\.\d+$/.test(name)).slice(0, 128)) {
          try { if ((await files.readFile(path.posix.join(base, entry, 'bInterfaceClass'), 'utf8')).trim() === '07') devices.add(entry.split(':')[0]); } catch (_) { /* unavailable interface */ }
        }
        for (const device of devices) {
          try {
            const dir = path.posix.join(base, device);
            const control = (await files.readFile(path.posix.join(dir, 'power/control'), 'utf8')).trim();
            const runtime = (await files.readFile(path.posix.join(dir, 'power/runtime_status'), 'utf8')).trim();
            add('USB printer device ' + device, control === 'auto' ? 'review' : control === 'on' ? 'info' : 'unknown', `power/control=${control}; runtime_status=${runtime}. Device path: ${dir}. Not mapped to a particular queue.`);
          } catch (_) { add('USB printer device ' + device, 'unknown', 'Power attributes are not readable.'); }
        }
        if (!devices.size) add('USB printer devices', 'unknown', 'No USB printer-class interfaces detected. Network, vendor-specific printers and some adapters are not covered; this does not prove disconnection.');
      } catch (_) { add('USB power settings', 'unknown', 'USB sysfs information is unavailable or unreadable.'); }
    }
  } else add('Operating system', 'unknown', 'Automatic checks are unavailable for this operating system.');
  return { platform, checkedAt: Date.now(), checks, instructions: instructions[platform] || [],
    common: [
      'Keep Posnic running and enable kitchen printing while serving. Posnic requests automatic system-sleep prevention while KOT is active; screen lock and display sleep may continue. Forced sleep, closing a laptop lid or signing out can still interrupt service.',
      'Check paper, cover, power and the printer’s own sleep/auto-off setting. Use the printer manual; there is no universal wake command.',
      'Compare one test ticket before and after the usual idle period. Change one setting at a time, record its original value, and restore it if there is no improvement.',
      'If USB still disappears, repeat the idle test with a short direct USB cable, bypassing extenders. Check the queue before sending another ticket; queued jobs can print after reconnect.',
    ] };
}
let cached, pending;
async function status() {
  if (!cached || Date.now() - cached.checkedAt > 60000) {
    if (!pending) pending = inspect().then(value => { cached = value; return value; }).finally(() => { pending = null; });
    await pending;
  }
  let awake = false;
  try { awake = require('./till-stays-awake').isAwakeHeld(); } catch (_) { /* unavailable */ }
  return { ...cached, awake };
}
module.exports = { inspect, status, parsePmset };
