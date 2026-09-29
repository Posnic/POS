'use strict';
/*
 * One PowerShell, kept warm, instead of one per receipt.
 *
 * WHY THIS EXISTS
 *
 * Raw ESC/POS on Windows has to reach the spooler through winspool.Drv, and
 * the way this app has always done that is to write a temp script and run
 * `powershell -File` on it. Measured on a real till, that costs 350 to 550 ms
 * BEFORE the printer sees a byte, and it is paid per copy: a two-copy receipt
 * spends most of a second starting processes. Most of it is not the shell at
 * all, it is `Add-Type` compiling the C# interop class on every single run.
 *
 * Owner: "receipt prniter is direct connection right, why its not fired
 * immediately... every seconds counts here."
 *
 * So the process is started once and kept. The C# compiles once. After that a
 * job is a line of JSON down stdin and a line back, which measures at under a
 * millisecond. The saving is the whole spawn, on every print, forever.
 *
 * WHY NOT SOMETHING ELSE
 *
 * A native winspool binding through FFI would be faster still and is a native
 * dependency to build, sign and keep working across Electron versions, for a
 * saving of under a millisecond over this. `cmd.exe` starts in 18 ms but
 * cannot call into winspool at all; copying to a shared printer would need
 * every shop to share its printer first. Keeping the code that already works
 * and paying for it once is the cheapest correct answer.
 *
 * WHAT IT PROMISES
 *
 * A successful reply carries the Windows spooler job ID, not a claim that
 * paper came out. windows-print-queue.js owns readiness, monitoring and
 * recovery. A timeout after sending is ambiguous and must never trigger a
 * second submission through another print path.
 *
 * NOT ON MAC OR LINUX. There the job goes to `lp`, a small native binary that
 * starts in a few milliseconds, so there is nothing to keep warm.
 */
const { spawn } = require('child_process');
const path = require('node:path');
const STARTUP_TIMEOUT_MS = 20000; // Cold Add-Type compilation can exceed eight seconds.
function powershellPath(env = process.env) {
  const root = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  return path.win32.join(root, process.arch === 'ia32' && env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/* Long enough for a real receipt on a slow spooler, and the same ceiling the
   per-job spawn has always used. */
const JOB_TIMEOUT_MS = 20000;
/*
 * THE HELPER NEVER SLEEPS.
 *
 * It used to shut itself down after ten minutes with nothing to print, to save
 * holding a PowerShell open on a till that had closed for the night. That is a
 * real saving and it was the wrong trade, because ten minutes is shorter than a
 * quiet afternoon: the shop goes half an hour without an order, the helper
 * stops, and the next ticket - the one somebody is standing and waiting for -
 * pays the whole spawn and the C# compile again.
 *
 * The owner watched it happen and named it before the code was read: "may be
 * check print process is sleeping. when active its printing". Printing from the
 * till woke it, and every handset order after that was instant, which is
 * exactly the shape of an idle shutdown.
 *
 * So it stays up for as long as the app does. One PowerShell is a few tens of
 * megabytes; a kitchen ticket that arrives late is an order that arrives late.
 *
 * Staying up is not the same as staying healthy, so the two things below make
 * "always awake" mean it: a helper that dies is restarted without waiting for
 * the next ticket to discover it, and a heartbeat proves it can still answer.
 */
const RESTART_DELAYS_MS = [250, 500, 1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_MS = 60 * 1000;

/*
 * The resident script.
 *
 * Compiles the interop class once, then answers one job per line forever. Each
 * reply carries the id it belongs to, so a slow job cannot be mistaken for the
 * next one's answer. Everything is wrapped: a failure is a line, never a dead
 * process, because a dead process costs the next receipt a restart.
 */
const LOOP_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PosnicRawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPTStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPTStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPTStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr p);
    [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr h, int lvl, IntPtr pDocInfo);
    [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
    [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Length -eq 0) { continue }
    $id = ''
    $submitted = $false
    try {
        $job = $line | ConvertFrom-Json
        $id = $job.id
        # A heartbeat. Proving the helper is alive must not cost a receipt, so
        # a ping is answered without opening the printer at all.
        if ($job.ping) { [Console]::Out.WriteLine("OK $id"); [Console]::Out.Flush(); continue }
        $bytes = [System.IO.File]::ReadAllBytes($job.file)
        $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
        $hPrinter = [IntPtr]::Zero
        $di = New-Object PosnicRawPrint+DOCINFO
        $di.pDocName = $job.doc
        $di.pDataType = 'RAW'
        $diPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal([System.Runtime.InteropServices.Marshal]::SizeOf($di))
        [System.Runtime.InteropServices.Marshal]::StructureToPtr($di, $diPtr, $false)
        try {
            if ([PosnicRawPrint]::OpenPrinter($job.printer, [ref]$hPrinter, [IntPtr]::Zero)) {
                $submitted = $true
                $docId = [PosnicRawPrint]::StartDocPrinter($hPrinter, 1, $diPtr)
                if ($docId -gt 0) {
                    # EVERY ONE OF THESE RETURN VALUES IS CHECKED, and the count
                    # of bytes written is compared against the count sent.
                    # They were all piped to Out-Null, so a write that failed
                    # outright still answered OK - the ticket went into the
                    # day's log as printed and no paper ever came out. That is
                    # the worst way for a printer to fail, because the one
                    # place anybody would look says it worked.
                    $pageOk = [PosnicRawPrint]::StartPagePrinter($hPrinter)
                    $w = 0
                    $wrote = [PosnicRawPrint]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$w)
                    $endPageOk = [PosnicRawPrint]::EndPagePrinter($hPrinter)
                    $endDocOk = [PosnicRawPrint]::EndDocPrinter($hPrinter)
                    [PosnicRawPrint]::ClosePrinter($hPrinter) | Out-Null
                    if (-not $pageOk) {
                        [Console]::Out.WriteLine("ERR $id The printer refused the page")
                    } elseif (-not $wrote) {
                        $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
                        [Console]::Out.WriteLine("ERR $id The printer refused the data (win32 $code)")
                    } elseif ($w -ne $bytes.Length) {
                        [Console]::Out.WriteLine("ERR $id Only $w of $($bytes.Length) bytes reached the printer")
                    } elseif (-not $endPageOk -or -not $endDocOk) {
                        [Console]::Out.WriteLine("ERR $id The printer did not close the job")
                    } else {
                        [Console]::Out.WriteLine("OK $id $docId")
                    }
                } else {
                    [PosnicRawPrint]::ClosePrinter($hPrinter) | Out-Null
                    [Console]::Out.WriteLine("NOTSENT $id StartDocPrinter failed")
                }
            } else {
                $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
                [Console]::Out.WriteLine("NOTSENT $id Could not open printer (win32 $code)")
            }
        } finally {
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($diPtr)
        }
    } catch {
        $msg = $_.Exception.Message -replace "\\r|\\n", ' '
        if ($submitted) { [Console]::Out.WriteLine("ERR $id $msg") }
        else { [Console]::Out.WriteLine("NOTSENT $id $msg") }
    }
    [Console]::Out.Flush()
}`;

class RawPrintService {
  constructor(options = {}) {
    this.spawn = options.spawn || spawn;
    this.platform = options.platform || process.platform;
    this.startupMs = options.startupMs || STARTUP_TIMEOUT_MS;
    this.jobMs = options.jobMs || JOB_TIMEOUT_MS;
    this.heartbeatMs = options.heartbeatMs || HEARTBEAT_MS;
    this.delays = options.delays || RESTART_DELAYS_MS;
    this.executable = options.executable || powershellPath();
    this.state = 'stopped';
    this.stopped = false;
    this.child = null;
    this.ready = null;
    this.attempt = null;
    this.generation = 0;
    this.pending = new Map();
    this.nextId = 1;
    this.restarts = 0;
    this.restartTimer = null;
    this.heartbeatTimer = null;
    this.lastDiagnostic = null;
  }

  warm() {
    if (this.platform !== 'win32') return Promise.resolve(false);
    this.stopped = false;
    return this._ensure().then(() => true).catch(() => false);
  }

  status() { return { state: this.state, generation: this.generation, diagnostic: this.lastDiagnostic }; }

  _ensure() {
    if (this.stopped) return Promise.reject(new Error('Print helper is stopped'));
    if (this.state === 'ready') return Promise.resolve(this.attempt);
    if (this.state === 'starting') return this.ready;
    if (this.state === 'backoff') return Promise.reject(new Error(this.lastDiagnostic?.error || 'Print helper startup failed: recovery backoff'));
    if (this.child && !this.attempt?.exited) {
      this.state = 'backoff'; this._scheduleRestart();
      return Promise.reject(new Error('Print helper startup failed: waiting for previous helper to exit'));
    }
    this.state = 'starting';
    const a = this.attempt = { generation: ++this.generation, startedAt: Date.now(), stderr: '', active: true };
    // Allocate the shared promise before spawn: synchronous errors must also clear it.
    const promise = this.ready = new Promise((resolve, reject) => { a.resolve = resolve; a.reject = reject; });
    const current = () => this.attempt === a && a.active;
    a.timer = setTimeout(() => this._down(new Error('READY deadline exceeded'), a), this.startupMs);
    try {
      const child = a.child = this.child = this.spawn(this.executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', LOOP_SCRIPT],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let buffer = '';
      child.stdin.on('error', error => { if (current()) this._down(error, a); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (!current()) return;
        buffer += chunk;
        if (buffer.length > 65536) return this._down(new Error('Invalid helper output'), a);
        let at;
        while ((at = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
          if (line === 'READY' && this.state === 'starting') {
            clearTimeout(a.timer); a.timer = null;
            this.state = 'ready'; this.ready = null; a.resolve(a);
            this._startHeartbeat();
          } else if (this.state === 'ready') this._answer(line);
        }
      });
      child.stdout.on('error', error => { if (current()) this._down(error, a); });
      child.stderr.on('error', error => { if (current()) this._down(error, a); });
      child.stderr.on('data', chunk => {
        if (!current()) return;
        a.stderr = (a.stderr + String(chunk)).slice(-4096);
      });
      child.on('error', error => {
        if (!current()) return;
        if (!child.pid) { a.exited = true; this.child = null; }
        this._down(error, a);
      });
      child.on('exit', (code, signal) => {
        if (this.attempt !== a) return;
        a.exited = true;
        if (this.child === child) this.child = null;
        if (a.active) this._down(new Error('Helper exited: code=' + code + ', signal=' + signal), a);
      });
    } catch (error) {
      a.exited = !a.child;
      this._down(error, a);
    }
    return promise;
  }

  _answer(line) {
    const match = /^(OK|ERR|NOTSENT) (\S+)(?: (.*))?$/.exec(line);
    if (!match) return;
    const [, verb, id, message] = match;
    const waiting = this.pending.get(id);
    if (!waiting) return;
    this.pending.delete(id); clearTimeout(waiting.timer);
    this.restarts = 0;
    if (verb === 'OK') waiting.resolve(message ? { success: true, spoolerJobId: Number(message) } : { success: true });
    else waiting.resolve({ success: false, submission: verb === 'NOTSENT' ? 'not-submitted' : 'uncertain',
      error: message || 'The spooler did not confirm the job' });
  }

  _down(error, a = this.attempt) {
    if (!a || this.attempt !== a || !a.active) return;
    const startup = this.state === 'starting';
    a.active = false;
    clearTimeout(a.timer); a.timer = null;
    const details = { phase: startup ? 'startup' : 'runtime', generation: a.generation,
      pid: a.child?.pid, executable: this.executable, elapsedMs: Date.now() - a.startedAt,
      deadlineMs: this.startupMs, stderr: a.stderr, cause: error?.message || 'Helper stopped' };
    details.error = (startup ? 'Print helper startup failed: ' : 'Print helper failed: ') + details.cause +
      (a.stderr ? '; stderr: ' + a.stderr.trim() : '');
    if (!this.stopped) {
      this.lastDiagnostic = details;
      console.warn('[RawPrint]', JSON.stringify(details));
    }
    if (startup) a.reject(new Error(details.error));
    this.ready = null;
    this._stopHeartbeat();
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.resolve({ success: false, submission: waiting.ping ? 'not-submitted' : 'uncertain', error: details.error });
    }
    this.pending.clear();
    // Do not start a replacement until exit confirms that this process is gone.
    // kill() returning true means a signal was sent, not that the child exited.
    if (a.child && !a.exited) {
      try { a.child.stdin.end(); } catch (_) { /* already closed */ }
      try { a.child.kill(); } catch (_) { /* retry retirement during backoff */ }
    }
    this.state = this.stopped ? 'stopped' : 'backoff';
    if (!this.stopped) this._scheduleRestart();
  }

  _scheduleRestart() {
    if (this.restartTimer || this.stopped) return;
    const delay = this.delays[Math.min(this.restarts++, this.delays.length - 1)];
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopped) return;
      if (this.child && !this.attempt?.exited) {
        try { this.child.kill(); } catch (_) { /* never overlap helpers */ }
        this._scheduleRestart(); return;
      }
      this.state = 'stopped';
      this._ensure().catch(() => {});
    }, delay);
    this.restartTimer.unref?.();
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.child || this.pending.size) return;
      const a = this.attempt;
      this.send({ ping: true }).then(result => {
        if (!result.success && this.attempt === a && a.active && !this.pending.size) {
          this._down(new Error(result.error || 'Heartbeat failed'), a);
        }
      }).catch(error => this._down(error, a));
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }
  _stopHeartbeat() { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }

  async send({ printer, file, doc, ping = false }) {
    const notSent = error => ({ success: false, unavailable: true, submission: 'not-submitted', error });
    if (this.platform !== 'win32') return notSent('Windows helper is not supported on this platform');
    let a;
    try { a = await this._ensure(); }
    catch (error) { return notSent(error.message); }
    if (this.attempt !== a || !a.active || this.state !== 'ready' || !a.child.stdin?.writable) {
      if (a.active) this._down(new Error('Helper stdin is not writable'), a);
      return notSent('Print helper unavailable before submission');
    }
    const id = String(this.nextId++);
    const payload = ping ? { id, ping: true } : { id, printer: String(printer), file: String(file), doc: String(doc || 'Posnic Receipt') };
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        // A ping must not terminate receipts that arrived while it was waiting.
        if (ping && [...this.pending.values()].some(job => !job.ping)) {
          this.pending.delete(id);
          resolve({ success: false, submission: 'not-submitted', error: 'Heartbeat timed out while receipts were active' });
          return;
        }
        this._down(new Error(ping ? 'Heartbeat timed out' : 'Print helper response timed out; submission outcome uncertain'), a);
      }, this.jobMs);
      this.pending.set(id, { resolve, timer, ping });
      try {
        // Once write is attempted, EPIPE/timeout/exit cannot prove non-submission.
        a.child.stdin.write(JSON.stringify(payload) + '\n', error => { if (error) this._down(error, a); });
      } catch (error) { this._down(error, a); }
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer); this.restartTimer = null;
    this._stopHeartbeat();
    this._down(new Error('App shutdown'), this.attempt);
    if (this.child && !this.attempt?.exited) {
      try { this.child.kill(); } catch (_) { /* no replacement during shutdown */ }
    }
    this.ready = null;
    this.state = 'stopped';
  }
}

module.exports = new RawPrintService();
module.exports.RawPrintService = RawPrintService;
module.exports.JOB_TIMEOUT_MS = JOB_TIMEOUT_MS;
module.exports.STARTUP_TIMEOUT_MS = STARTUP_TIMEOUT_MS;
module.exports.HEARTBEAT_MS = HEARTBEAT_MS;
module.exports.RESTART_DELAYS_MS = RESTART_DELAYS_MS;
module.exports.powershellPath = powershellPath;
