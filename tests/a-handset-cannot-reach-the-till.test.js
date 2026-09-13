'use strict';

/*
 * The till notices when a handset cannot reach it.
 *
 * Asked for directly, after a morning spent working out why a phone could not
 * open http://<the till>:5555/api while the till itself could: "desktop app
 * can identify this and ask owner to change if its windows and captain app
 * enabled ?"
 *
 * It can, and the reason it is worth doing is that this failure is completely
 * silent. Windows Firewall does not refuse a blocked connection, it drops it.
 * The handset shows an empty table list. The till shows a working screen. No
 * log anywhere records a packet that never arrived. From the shop floor it is
 * indistinguishable from a dead router, and the usual response - reinstall the
 * app - changes nothing, because the app was never the problem.
 *
 * THE SHAPE OF THE BUG, taken off the owner's own machine rather than imagined:
 *
 *   Program                                          Dir     Act   Profile
 *   ...\programs\posnic\posnic.exe                   Inbound Allow Public
 *   ...\programs\posnic\posnic.exe                   Inbound Allow Public
 *
 * Two Allow rules, both scoped to Public, because both were created while the
 * machine sat on a phone hotspot - and Windows writes the rule for whichever
 * profile it happens to be on when the prompt is answered. That till works
 * today. The day it joins a network Windows calls Private, which is what
 * happens the moment anybody answers Yes to "make this PC discoverable", every
 * handset in the shop goes dark and nothing on screen changes.
 *
 * So the test that matters most here is the third one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const handsets = require(path.join(ROOT, 'src', 'handset-reachability.js'));

const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'hardware-ipc.js'), 'utf8');

/* A probe answer, with only the interesting part spelled out per test. */
function probe({ category = 'Private', enabled = true, allow = [], block = [], name = 'Shop WiFi' } = {}) {
  return {
    network: { name, category },
    firewall: [
      { name: 'Domain', enabled: true },
      { name: 'Private', enabled },
      { name: 'Public', enabled },
    ],
    allow,
    block,
  };
}

/* ---------------------------------------------------------------- verdicts */

test('a rule that covers this network means a handset gets through', () => {
  const v = handsets.verdict(probe({ category: 'Private', allow: ['Private'] }));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.kind, 'reachable');
});

test('and so does one scoped to every profile', () => {
  assert.strictEqual(handsets.verdict(probe({ category: 'Public', allow: ['Any'] })).kind, 'reachable');
});

test('ALLOWED ON PUBLIC, SITTING ON PRIVATE: the one that looks like the app broke', () => {
  /*
   * The owner's machine, one router change later. Both rules say Public and
   * the network now says Private, so nothing admits the handset - and every
   * other sign on the till says the software is fine, because it is.
   */
  const v = handsets.verdict(probe({ category: 'Private', allow: ['Public', 'Public'] }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.kind, 'wrong-profile');
  assert.deepStrictEqual(v.allowed, ['Public'], 'the duplicate should not be read back to the shop twice');
  assert.match(handsets.explain(v), /allows Posnic on Public networks, but .* is a Private network/);
});

test('no rule at all is a different sentence, because it has a different cause', () => {
  const v = handsets.verdict(probe({ category: 'Public', allow: [] }));
  assert.strictEqual(v.kind, 'no-rule');
  assert.match(handsets.explain(v), /no rule letting Posnic accept connections/);
});

test('a Block rule beats an Allow rule, exactly as Windows treats it', () => {
  /*
   * Cancelling the Windows Security Alert does not leave the machine
   * undecided - it writes a Block rule and never asks again. Reading the Allow
   * rule and stopping there would report a healthy till that can never be
   * reached, which is the worst answer of the four.
   */
  const v = handsets.verdict(probe({ category: 'Private', allow: ['Any'], block: ['Private'] }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.kind, 'blocked');
  assert.match(handsets.explain(v), /answered with Cancel/);
});

test('a block scoped somewhere else does not condemn this network', () => {
  assert.strictEqual(handsets.verdict(probe({ category: 'Private', allow: ['Private'], block: ['Public'] })).kind, 'reachable');
});

test('a firewall switched off for this profile is not the thing stopping anyone', () => {
  const v = handsets.verdict(probe({ category: 'Private', enabled: false, allow: [] }));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.kind, 'firewall-off');
});

test('anything unreadable produces no complaint at all', () => {
  /*
   * THE RULE THIS FILE EXISTS TO PROTECT. A check invented to explain a silent
   * failure must never invent one. Every one of these is a machine we could
   * not read, not a machine that is broken.
   */
  for (const bad of [null, undefined, 'nonsense', 42, {}, { network: {} }, { network: { category: 'Guest' } }]) {
    const v = handsets.verdict(bad);
    assert.strictEqual(v.ok, true, `${JSON.stringify(bad)} produced a fault`);
    assert.strictEqual(v.kind, 'unknown');
  }
  /* Including a profile list that does not mention the profile we are on. */
  const missing = handsets.verdict({ network: { category: 'Domain' }, firewall: [{ name: 'Public', enabled: true }], allow: [] });
  assert.strictEqual(missing.ok, true);
  assert.strictEqual(missing.kind, 'unknown');
});

test('the real answer Windows gives, parsed and judged', () => {
  /*
   * Captured from a live machine rather than written by hand, so the field
   * names and the comma-separated profile string are the ones that actually
   * turn up rather than the ones this file would like.
   */
  const raw = '{"allow":["Public","Public"],"firewall":[{"name":"Domain","enabled":true},'
    + '{"name":"Private","enabled":true},{"name":"Public","enabled":true}],"block":[],'
    + '"network":{"category":"Public","name":"D-Link_DIR-615"}}';
  const v = handsets.verdict(handsets.parseProbe(raw));
  assert.strictEqual(v.kind, 'reachable', 'the owner\'s till today is reachable, and must not be nagged');
  assert.strictEqual(v.network, 'D-Link_DIR-615');
});

/* ------------------------------------------------------------ profile maths */

test('a comma list of profiles is a list, not one value', () => {
  /* 'Domain, Private, Public' read as a single value matches nothing, and this
     whole check would then report a fault on every correctly set-up till. */
  assert.strictEqual(handsets.profileCovers('Domain, Private, Public', 'Private'), true);
  assert.strictEqual(handsets.profileCovers('Domain, Private', 'Public'), false);
  assert.strictEqual(handsets.profileCovers('Any', 'Domain'), true);
  assert.strictEqual(handsets.profileCovers('', 'Public'), false);
});

test('a domain-joined network is called two different things by Windows', () => {
  /* Get-NetConnectionProfile says DomainAuthenticated; rules say Domain. */
  assert.strictEqual(handsets.normaliseCategory('DomainAuthenticated'), 'Domain');
  assert.strictEqual(handsets.profileCovers('Domain', handsets.normaliseCategory('DomainAuthenticated')), true);
});

/* ------------------------------------------------------------- who is asked */

test('a shop that has switched the captain app off is never asked about it', () => {
  /*
   * module_captain_enable is an absent-means-ON toggle saved by a form that
   * posts strings, so 'false' is a real stored value. Reading it as a boolean
   * would send this dialog to every kirana store in the country.
   */
  assert.strictEqual(handsets.captainIsOn([{ module_captain_enable: 'false' }]), false);
  assert.strictEqual(handsets.captainIsOn([{ module_captain_enable: false }]), false);
  assert.strictEqual(handsets.captainIsOn([{ module_captain_enable: 'true' }]), true);
  assert.strictEqual(handsets.captainIsOn([{ module_captain_enable: true }]), true);
  /* Absent is on: every shop installed before the toggle existed has no value
     stored, and they are the ones most likely to be using handsets. */
  assert.strictEqual(handsets.captainIsOn([{ branch_name: 'Main' }]), true);
  /* One branch using it is enough; the firewall is per machine, not per shop. */
  assert.strictEqual(handsets.captainIsOn([{ module_captain_enable: false }, { module_captain_enable: true }]), true);
  assert.strictEqual(handsets.captainIsOn([]), false);
});

test('the branch read carries the toggle, or nothing can gate on it', () => {
  assert.match(IPC, /projection: \{ branch_name: 1, module_captain_enable: 1 \}/);
  assert.match(IPC, /module_captain_enable: b\.module_captain_enable/);
});

/* ----------------------------------------------------------------- the probe */

test('the probe asks about the interface handsets actually talk to', () => {
  /*
   * A till with Hyper-V or minikube installed has several connection profiles
   * and the extra ones are Public with no traffic on them. Taking the first
   * would read a virtual switch's classification and answer for the wrong
   * network - on exactly the developer machines most likely to hit this.
   */
  const s = handsets.buildProbeScript({ exePath: 'C:\\x\\Posnic.exe', port: 42590, lanIp: '192.168.0.104' });
  assert.match(s, /Get-NetIPAddress -IPAddress \$ip/);
  assert.match(s, /Where-Object \{ \$_\.InterfaceIndex -eq \$idx \}/);
  assert.match(s, /\$port = 42590/, 'the derived port is not asked about');
  assert.match(s, /ConvertTo-Json/);
});

test('both ways a rule can admit a handset are collected', () => {
  /* A rule may name the program or the port. Either one lets a handset in, so
     reading only one of them would report a fault on a working till. */
  const s = handsets.buildProbeScript({ exePath: 'C:\\x\\Posnic.exe', port: 5555, lanIp: '10.0.0.2' });
  assert.match(s, /Get-NetFirewallApplicationFilter -Program \$exe/);
  assert.match(s, /Get-NetFirewallPortFilter -Protocol TCP/);
  assert.match(s, /LocalPort -eq 'Any'/, 'a rule opening all ports would be missed');
});

test('a quote in a path cannot end the string it sits in', () => {
  const s = handsets.buildProbeScript({ exePath: "C:\\it's\\Posnic.exe", port: 1, lanIp: '' });
  assert.match(s, /\$exe = 'C:\\it''s\\Posnic\.exe'/);
});

/* ------------------------------------------------------------------ the fix */

test('the repair creates the rule before it removes anything', () => {
  /*
   * The order is the whole safety of it. A shop in the wrong-profile state has
   * a rule that works on SOME network; clearing that first and then failing to
   * create the replacement would leave them worse off than when they started.
   */
  const s = handsets.buildFixScript({ exePath: 'C:\\x\\Posnic.exe' });
  const create = s.indexOf('New-NetFirewallRule');
  const clearStrays = s.indexOf('Get-NetFirewallApplicationFilter');
  assert.ok(create > -1 && clearStrays > create, 'strays are cleared before the new rule exists');
  assert.match(s, /\$ErrorActionPreference = 'Stop'/, 'a failed step would be stepped over');
});

test('the rule names the program, not the port', () => {
  /* The API port is derived per installation now (local-ports.js), so a rule
     pinned to 5555 is right on most tills and wrong on the ones that moved -
     which are the ones already having trouble. */
  const s = handsets.buildFixScript({ exePath: 'C:\\x\\Posnic.exe' });
  assert.match(s, /-Program \$exe/);
  assert.match(s, /-Profile Any/, 'a single-profile rule is the bug this feature reports');
  assert.ok(!/-LocalPort/.test(s), 'the rule is pinned to a port');
});

test('it clears a Block rule left by a denied prompt, and only inbound ones', () => {
  const s = handsets.buildFixScript({ exePath: 'C:\\x\\Posnic.exe' });
  assert.match(s, /\$_\.Direction -eq 'Inbound' -and \$_\.Name -ne \$id/);
  assert.match(s, /Remove-NetFirewallRule -ErrorAction SilentlyContinue/);
});

test('the elevated command travels as base64, not as a file on disk', () => {
  /*
   * Writing a .ps1 into the app data folder and running THAT as administrator
   * puts a file any ordinary process can rewrite into the path of an elevated
   * one. Base64 is [A-Za-z0-9+/=] and cannot close the quote it sits in.
   */
  const args = handsets.elevatedArgs(handsets.buildFixScript({ exePath: "C:\\it's\\Posnic.exe" }));
  const command = args[args.length - 1];
  assert.match(command, /-Verb RunAs/, 'the rule cannot be created without elevation');
  const encoded = command.match(/'-EncodedCommand','([^']*)'/);
  assert.ok(encoded, 'the script is not passed as an encoded command');
  assert.match(encoded[1], /^[A-Za-z0-9+/=]+$/, 'the payload can contain a quote');
  assert.match(Buffer.from(encoded[1], 'base64').toString('utf16le'), /New-NetFirewallRule/);
  assert.ok(!/\.ps1/.test(command), 'a script file is written somewhere');
});

/* --------------------------------------------------------------- the runner */

/** A stand-in for spawn: answers with whatever this test wants to hand back. */
function fakeRun(stdout, code = 0) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', stdout);
      child.emit('close', code);
    });
    return child;
  };
  run.calls = calls;
  return run;
}

test('nothing is spawned on a machine this cannot apply to', async () => {
  const run = fakeRun('{}');
  const v = await handsets.check({ platform: 'darwin', exePath: '/x', port: 1, lanIp: '1.1.1.1', run });
  assert.strictEqual(v.kind, 'not-windows');
  assert.strictEqual(run.calls.length, 0);
});

test('a machine that answers with rubbish is a machine we say nothing about', async () => {
  for (const answer of ['', 'Get-NetFirewallRule : The term is not recognized', '<html>']) {
    const v = await handsets.check({ platform: 'win32', exePath: 'C:\\x.exe', port: 5555, lanIp: '10.0.0.1', run: fakeRun(answer) });
    assert.strictEqual(v.ok, true);
  }
});

test('a real answer through the real runner reaches a real verdict', async () => {
  const run = fakeRun('{"network":{"name":"Shop","category":"Private"},'
    + '"firewall":[{"name":"Private","enabled":true}],"allow":["Public"],"block":[]}');
  const v = await handsets.check({ platform: 'win32', exePath: 'C:\\x.exe', port: 5555, lanIp: '10.0.0.1', run });
  assert.strictEqual(v.kind, 'wrong-profile');
  assert.strictEqual(run.calls[0].cmd, 'powershell.exe');
  assert.ok(run.calls[0].args.includes('-NonInteractive'), 'the probe could stop and wait for input');
});

test('a cancelled administrator prompt is reported, not swallowed', async () => {
  const res = await handsets.applyFix({ exePath: 'C:\\x.exe', run: fakeRun('', 1) });
  assert.strictEqual(res.ok, false);
});

/* --------------------------------------------------------------- the wiring */

test('the till only asks a shop that uses handsets, and only on Windows', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function reportHandsetReachability'), MAIN.indexOf('function seedBrandFromBuild'));
  assert.match(fn, /if \(process\.platform !== 'win32'\) return;/);
  assert.match(fn, /if \(!handsets\.captainIsOn\(branches\)\) return;/);
  assert.match(fn, /if \(!branches\.length\) return;/, 'a till still being set up would be asked');
  assert.match(fn, /if \(result\.ok\) return;/, 'a healthy till would be asked');
});

test('nothing on the machine changes unless the shop says so', () => {
  /*
   * A machine-level firewall rule is not something to add to somebody's till
   * while they are looking the other way. The owner asked for the app to
   * "ask owner to change", and asking is the whole of it.
   */
  const fn = MAIN.slice(MAIN.indexOf('async function reportHandsetReachability'), MAIN.indexOf('function seedBrandFromBuild'));
  const fix = fn.indexOf('handsets.applyFix');
  const ask = fn.indexOf('dialog.showMessageBox');
  assert.ok(ask > -1 && fix > ask, 'the repair runs before the shop has been asked');
  assert.match(fn, /if \(answer\.response !== 0\) return;/);
  assert.match(fn, /buttons: \['Allow through Windows Firewall', 'Not now', 'We do not use handsets'\]/);
});

test('a shop that says it does not use handsets is not asked again', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function reportHandsetReachability'), MAIN.indexOf('function seedBrandFromBuild'));
  assert.match(fn, /readHealthDismissals\(\)/);
  assert.match(fn, /writeHealthDismissals\(\[\.\.\.dismissed, fingerprint\]\)/);
  /* Keyed on the fault, not the network, so a different problem still speaks
     up on a till that dismissed this one. */
  assert.match(fn, /handsets:\$\{result\.kind\}:\$\{result\.category\}/);
});

test('whether the repair worked is checked, not assumed', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function reportHandsetReachability'), MAIN.indexOf('function seedBrandFromBuild'));
  const after = fn.slice(fn.indexOf('handsets.applyFix'));
  assert.match(after, /const after = await handsets\.check\(/);
  assert.match(after, /title: after\.ok \? 'Handsets can reach this till' : 'Still blocked'/);
});

test('the check stays off the startup path', () => {
  /* It spawns PowerShell and reads the whole firewall, which takes seconds.
     A till that is already serving must not wait on a diagnostic. */
  assert.match(MAIN, /setTimeout\(\(\) => \{\s*\n\s*reportHandsetReachability\(\)/);
});

test('the module is in the packaged build', () => {
  /* build.files is an allowlist. A module missing from it throws "Cannot find
     module" on a customer's counter and nowhere else. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/handset-reachability.js'));
});

test('the old firewall batch file is gone rather than left to mislead', () => {
  /*
   * src/open-firewall-port.bat opened port 5555 for all profiles. It was never
   * referenced by anything, never in build.files so never shipped, and since
   * the API port became per-installation it named the wrong port on any till
   * that had to move off 5555. A repair that silently fixes nothing is worse
   * than no repair.
   */
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'open-firewall-port.bat')));
});
