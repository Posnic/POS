'use strict';

/*
 * Can a handset on the shop Wi-Fi actually reach this till?
 *
 * The Captain app sweeps the local network for the till's API and talks to it
 * over the LAN. Nothing in that chain is ours once the packet leaves the
 * phone: Windows Firewall decides whether the till is allowed to answer, and
 * when it says no it says nothing at all. The handset shows an empty table
 * list, the till shows a working screen, and the shop has no way to tell the
 * two apart from a dead router.
 *
 * WHAT THIS ACTUALLY CATCHES, from a real machine.
 *
 * Windows scopes every firewall rule to a network PROFILE - Domain, Private or
 * Public - and it picks the profile per network, not per machine. When the
 * shopkeeper answers the "Allow access" prompt, Windows writes the rule for
 * whichever profile the machine happened to be on at that moment, and only
 * that one. The owner's own till has two inbound Allow rules for Posnic and
 * both say Public, because both were created on a phone hotspot. The day that
 * machine joins a network Windows classifies as Private - which is what
 * happens the moment anybody answers Yes to "make this PC discoverable" - the
 * rules stop applying and every handset goes dark. Nothing on screen changes.
 * Nothing is written to a log. The app is running perfectly.
 *
 * A denied prompt is worse still. Clicking Cancel on the Windows Security
 * Alert does not leave the machine undecided: it writes a BLOCK rule, and
 * Windows never asks again. That till can never be reached by a handset until
 * somebody goes into Windows Defender and deletes a rule, and nothing
 * anywhere will ever tell them that is the problem.
 *
 * So: read the machine's own answer rather than guess at it. The probe reports
 * which profile this network is, whether the firewall is on for it, and which
 * profiles the rules admitting our port actually cover. verdict() is pure and
 * does the deciding, which is the part worth testing.
 *
 * This is a diagnosis, not a repair. The repair needs an administrator, so it
 * is offered and never performed unattended - see buildFixScript.
 */

const { spawn } = require('child_process');

/* The rule this app creates, if the shop asks it to. RULE_ID is Windows' own
   identifier and has to be unique, which is what makes the fix repeatable. */
const RULE_ID = 'Posnic-Handsets-Inbound';
const RULE_LABEL = 'Posnic (handset ordering)';

/* Windows reports a domain-joined network under a longer name than the one it
   scopes rules with. Everything else already matches. */
const CATEGORY_ALIASES = {
  domainauthenticated: 'Domain',
  domain: 'Domain',
  private: 'Private',
  public: 'Public',
};

function normaliseCategory(value) {
  return CATEGORY_ALIASES[String(value || '').trim().toLowerCase()] || '';
}

/*
 * Does a rule's profile field cover the profile we are on?
 *
 * Windows renders this as 'Any', or as a comma list like 'Domain, Private'.
 * Treating it as a single value - which reads fine, and is wrong - would call
 * a 'Domain, Private, Public' rule irrelevant on every network, and this whole
 * check would then report a fault on a machine that is set up correctly.
 */
function profileCovers(profileField, category) {
  const raw = String(profileField || '').trim();
  if (!raw) return false;
  if (/^any$/i.test(raw)) return true;
  return raw.split(',').map((p) => normaliseCategory(p)).includes(category);
}

/*
 * Is the captain app switched on for this shop?
 *
 * `module_captain_enable` follows the house rule for module toggles: absent
 * means ON, and the string 'false' is a real stored value because the settings
 * form posts strings. Reading it as a plain boolean would count every shop
 * that has switched the captain app OFF as a shop that uses it, and this check
 * would then go and nag a kirana store about handsets it does not own.
 */
function captainIsOn(branches) {
  return (branches || []).some((b) => {
    const v = b && b.module_captain_enable;
    return !(v === false || v === 'false');
  });
}

/* Quote a value into a PowerShell single-quoted string. Everything passed
   through here comes from this process today; it is quoted anyway, so this
   file is not the reason it matters on the day one of them does not. */
function psQuote(value) {
  return "'" + String(value == null ? '' : value).replace(/'/g, "''") + "'";
}

/*
 * The probe. One PowerShell run, JSON out, no decisions taken.
 */
function buildProbeScript({ exePath, port, lanIp }) {
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$ProgressPreference = 'SilentlyContinue'",
    '$exe = ' + psQuote(exePath),
    '$port = ' + (Number(port) || 0),
    '$ip = ' + psQuote(lanIp),
    '',
    /* The profile of the interface we actually advertise to handsets. A till
       with a Hyper-V or minikube switch has several connection profiles, and
       the extra ones are Public with no traffic on them - so taking the first
       would read the wrong network's classification. */
    '$idx = $null',
    'if ($ip) { $idx = (Get-NetIPAddress -IPAddress $ip -AddressFamily IPv4 | Select-Object -First 1).InterfaceIndex }',
    '$profiles = @(Get-NetConnectionProfile)',
    '$active = $null',
    'if ($idx) { $active = $profiles | Where-Object { $_.InterfaceIndex -eq $idx } | Select-Object -First 1 }',
    "if (-not $active) { $active = $profiles | Where-Object { $_.IPv4Connectivity -eq 'Internet' } | Select-Object -First 1 }",
    'if (-not $active) { $active = $profiles | Select-Object -First 1 }',
    '',
    "$fw = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; enabled = ([string]$_.Enabled -eq 'True') } })",
    '',
    /* Two ways in: a rule naming this program, or a rule naming this port.
       Either one admits a handset, so both are collected. */
    "$appRules = @(Get-NetFirewallApplicationFilter -Program $exe | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' })",
    "$portRules = @(Get-NetFirewallPortFilter -Protocol TCP | Where-Object { $_.LocalPort -eq 'Any' -or ($_.LocalPort -split ',') -contains \"$port\" } | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' })",
    '$all = @($appRules) + @($portRules)',
    '',
    '$out = @{',
    '  network = @{ name = [string]$active.Name; category = [string]$active.NetworkCategory }',
    '  firewall = $fw',
    "  allow = @($all | Where-Object { $_.Action -eq 'Allow' } | ForEach-Object { [string]$_.Profile })",
    "  block = @($all | Where-Object { $_.Action -eq 'Block' } | ForEach-Object { [string]$_.Profile })",
    '}',
    '$out | ConvertTo-Json -Depth 5 -Compress',
  ];
  return lines.join('\n');
}

/*
 * The elevated repair.
 *
 * One rule, all three profiles, naming the program rather than the port - the
 * API port is derived per installation now (see local-ports.js), so a rule
 * pinned to 5555 would be right on most tills and quietly wrong on exactly the
 * ones that had to move.
 *
 * The order is deliberate. Our own rule is replaced first, the new one is
 * created, and only if THAT succeeded are the strays cleared, including any
 * Block rule a denied prompt left behind. A failure at any point leaves the
 * shop as it was rather than with nothing at all.
 */
function buildFixScript({ exePath }) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$exe = ' + psQuote(exePath),
    '$id = ' + psQuote(RULE_ID),
    '$label = ' + psQuote(RULE_LABEL),
    'Remove-NetFirewallRule -Name $id -ErrorAction SilentlyContinue',
    'New-NetFirewallRule -Name $id -DisplayName $label -Direction Inbound -Action Allow -Program $exe -Protocol TCP -Profile Any -Enabled True | Out-Null',
    'Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue |',
    '  Get-NetFirewallRule -ErrorAction SilentlyContinue |',
    "  Where-Object { $_.Direction -eq 'Inbound' -and $_.Name -ne $id } |",
    '  Remove-NetFirewallRule -ErrorAction SilentlyContinue',
  ];
  return lines.join('\n');
}

/*
 * Hand a script to PowerShell as UTF-16 base64 rather than as a file.
 *
 * The alternative is writing a .ps1 into the app's data folder and running
 * that as administrator, which puts a file any ordinary process can rewrite in
 * the path of an elevated one. Base64 is [A-Za-z0-9+/=] and cannot close the
 * quote it sits inside, so the argument is safe by its own alphabet.
 */
function encodeCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

function elevatedArgs(script) {
  const encoded = encodeCommand(script);
  return [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    'Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait '
      + "-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','" + encoded + "'",
  ];
}

/*
 * What the probe means. Pure, and the only place a fault is decided.
 *
 * Every unreadable answer resolves to ok, on purpose. This check exists to
 * explain a silent failure; one that invents a failure when it cannot see
 * clearly would be the same disease with a dialog attached.
 */
function verdict(probe) {
  if (!probe || typeof probe !== 'object') return { ok: true, kind: 'unknown' };

  const network = String((probe.network && probe.network.name) || '').trim();
  const category = normaliseCategory(probe.network && probe.network.category);
  if (!category) return { ok: true, kind: 'unknown', network };

  const profile = (probe.firewall || []).find((p) => normaliseCategory(p && p.name) === category);
  /* No entry for this profile, or it is switched off: whatever is stopping a
     handset, it is not this. */
  if (!profile) return { ok: true, kind: 'unknown', category, network };
  if (!profile.enabled) return { ok: true, kind: 'firewall-off', category, network };

  const allow = (probe.allow || []).filter(Boolean);
  const block = (probe.block || []).filter(Boolean);

  /*
   * A Block rule beats an Allow rule in Windows, so it is checked first and
   * reported as its own thing. It is also the only fault here a shop cannot
   * stumble out of, because Windows will not prompt again once it exists.
   */
  if (block.some((p) => profileCovers(p, category))) {
    return { ok: false, kind: 'blocked', category, network };
  }
  if (allow.some((p) => profileCovers(p, category))) {
    return { ok: true, kind: 'reachable', category, network };
  }
  /*
   * Allowed somewhere, just not here. This is the one that looks like the app
   * broke itself: it worked for months and stopped on the day the shop changed
   * router, or answered a Windows prompt differently.
   */
  if (allow.length) {
    return { ok: false, kind: 'wrong-profile', category, network, allowed: [...new Set(allow)] };
  }
  return { ok: false, kind: 'no-rule', category, network };
}

/* Every fault gets a sentence a shopkeeper can act on, not a rule name. */
function explain(result) {
  const where = result && result.network ? '"' + result.network + '"' : 'this network';
  switch (result && result.kind) {
    case 'blocked':
      return 'Windows Firewall is blocking Posnic on ' + where + '. This is what happens when the '
        + '"Allow access" prompt was answered with Cancel: Windows remembers that answer and never asks again.';
    case 'wrong-profile':
      return 'Windows Firewall allows Posnic on ' + (result.allowed || []).join(' and ')
        + ' networks, but ' + where + ' is a ' + result.category
        + ' network, so that permission does not apply to it.';
    case 'no-rule':
      return 'Windows Firewall has no rule letting Posnic accept connections on ' + where + '.';
    default:
      return '';
  }
}

/* Run PowerShell and hand back its output. Never rejects: a machine that will
   not answer is a machine we say nothing about. */
function runPowerShell(args, { timeoutMs = 20000, run = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = run('powershell.exe', args, { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: '', error: e.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (payload) => { if (!done) { done = true; resolve(payload); } };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* already gone */ }
      finish({ code: -1, stdout, error: 'timed out' });
    }, timeoutMs);
    if (timer.unref) timer.unref();
    if (child.stdout) child.stdout.on('data', (d) => { stdout += String(d); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => { clearTimeout(timer); finish({ code: -1, stdout, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, stdout, error: code === 0 ? null : (stderr.trim() || 'exit ' + code) });
    });
  });
}

function parseProbe(stdout) {
  try {
    const text = String(stdout || '').trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** Look, and decide. Windows only; anywhere else this is not the problem. */
async function check({ platform = process.platform, exePath, port, lanIp, run, timeoutMs } = {}) {
  if (platform !== 'win32') return { ok: true, kind: 'not-windows' };
  const script = buildProbeScript({ exePath, port, lanIp });
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  const result = await runPowerShell(args, { timeoutMs, run });
  return verdict(parseProbe(result.stdout));
}

/** Ask Windows for the rule, with the administrator prompt that requires. */
async function applyFix({ exePath, run, timeoutMs = 120000 } = {}) {
  const result = await runPowerShell(elevatedArgs(buildFixScript({ exePath })), { timeoutMs, run });
  return { ok: result.code === 0, error: result.error || null };
}

module.exports = {
  RULE_ID,
  RULE_LABEL,
  normaliseCategory,
  profileCovers,
  captainIsOn,
  buildProbeScript,
  buildFixScript,
  encodeCommand,
  elevatedArgs,
  verdict,
  explain,
  parseProbe,
  check,
  applyFix,
};
