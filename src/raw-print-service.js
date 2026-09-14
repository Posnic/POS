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
 * Nothing new can break. If the helper will not start, or dies, or does not
 * answer in time, the caller falls back to the per-job spawn that has always
 * been there. A printer that is offline fails exactly as it did.
 *
 * NOT ON MAC OR LINUX. There the job goes to `lp`, a small native binary that
 * starts in a few milliseconds, so there is nothing to keep warm.
 */
const { spawn } = require('child_process');

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
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr p);
    [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode)]
    public static extern int StartDocPrinter(IntPtr h, int lvl, IntPtr pDocInfo);
    [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")]
    public static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
    [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Length -eq 0) { continue }
    $id = ''
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
                        [Console]::Out.WriteLine("OK $id")
                    }
                } else {
                    [PosnicRawPrint]::ClosePrinter($hPrinter) | Out-Null
                    [Console]::Out.WriteLine("ERR $id StartDocPrinter failed")
                }
            } else {
                $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
                [Console]::Out.WriteLine("ERR $id Could not open printer (win32 $code)")
            }
        } finally {
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($diPtr)
        }
    } catch {
        $msg = $_.Exception.Message -replace "\\r|\\n", ' '
        [Console]::Out.WriteLine("ERR $id $msg")
    }
    [Console]::Out.Flush()
}`;

class RawPrintService {
  constructor() {
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.unavailable = false;
    /* Kept so a crash loop backs off instead of spawning PowerShell forever on
       a machine where it can never work. Reset by the first job that answers. */
    this.restarts = 0;
    this.restartTimer = null;
    this.heartbeatTimer = null;
    this.stopped = false;
  }

  /** Start it before the first sale, so the first receipt does not pay for it. */
  warm() {
    if (process.platform !== 'win32') return Promise.resolve(false);
    this.stopped = false;
    return this._ensure()
      .then(() => { this._startHeartbeat(); return true; })
      .catch(() => false);
  }

  _ensure() {
    if (this.child && this.ready) return this.ready;

    this.ready = new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', LOOP_SCRIPT], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        return reject(error);
      }
      this.child = child;

      let buffer = '';
      let started = false;
      const settleStart = (error) => {
        if (started) return;
        started = true;
        if (error) reject(error);
        else resolve(true);
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (!line) continue;
          if (line === 'READY') {
            settleStart(null);
            continue;
          }
          this._answer(line);
        }
      });
      child.stderr.on('data', (d) => console.warn('[RawPrint]', String(d).trim()));

      child.on('error', (error) => {
        settleStart(error);
        this._down(error);
      });
      child.on('exit', (code) => {
        settleStart(new Error(`the print helper exited (${code})`));
        this._down(new Error('the print helper stopped'));
      });

      /* A helper that never says READY is a helper that will never print.
         Give up quickly and let the caller use the old path. */
      setTimeout(() => settleStart(new Error('the print helper did not start')), 8000);
    });

    return this.ready;
  }

  /** One answer line: "OK 4" or "ERR 4 something went wrong". */
  _answer(line) {
    const space = line.indexOf(' ');
    const verb = space === -1 ? line : line.slice(0, space);
    const rest = space === -1 ? '' : line.slice(space + 1).trim();
    const idAt = rest.indexOf(' ');
    const id = idAt === -1 ? rest : rest.slice(0, idAt);
    const message = idAt === -1 ? '' : rest.slice(idAt + 1);
    const waiting = this.pending.get(String(id));
    if (!waiting) return;
    this.pending.delete(String(id));
    clearTimeout(waiting.timer);
    /* It answered, so whatever was wrong is over: a later crash should retry
       quickly rather than inherit the backoff from an old bad spell. */
    this.restarts = 0;
    if (verb === 'OK') waiting.resolve({ success: true });
    else waiting.resolve({ success: false, error: message || 'The spooler did not confirm the job' });
  }

  /**
   * The helper is gone.
   *
   * Everyone waiting is told at once - a print that will never answer must not
   * hold a sale open - and then it is brought back WITHOUT waiting for the next
   * ticket to find out. That is the difference between always awake and merely
   * restarted on demand: the order that arrives in the gap is the one that
   * would otherwise wait.
   */
  _down(error) {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.resolve({ success: false, error: error ? error.message : 'the print helper stopped' });
    }
    this.pending.clear();
    this.child = null;
    this.ready = null;
    this._stopHeartbeat();
    if (!this.stopped) this._scheduleRestart();
  }

  /* Backed off, because a machine where PowerShell cannot run at all would
     otherwise spawn it in a tight loop for as long as the till is on. */
  _scheduleRestart() {
    if (this.restartTimer) return;
    const wait = RESTART_DELAYS_MS[Math.min(this.restarts, RESTART_DELAYS_MS.length - 1)];
    this.restarts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopped) return;
      this._ensure().catch(() => { /* _down has already queued the next try */ });
    }, wait);
    if (this.restartTimer.unref) this.restartTimer.unref();
  }

  /*
   * A heartbeat, because a process can be alive and deaf.
   *
   * PowerShell can be running with its loop wedged - a driver call that never
   * returns is the usual way - and from the outside that looks identical to a
   * helper waiting for work. The ping is answered without opening a printer, so
   * proving it costs nothing and no paper.
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.child || this.pending.size) return;   // busy is its own proof
      this.send({ ping: true }).then((r) => {
        if (!r.success && !r.unavailable) {
          console.warn('[RawPrint] the helper stopped answering; restarting it');
          try { if (this.child) this.child.kill(); } catch (e) { /* already gone */ }
        }
      }).catch(() => { /* the restart path handles it */ });
    }, HEARTBEAT_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Print one already-written file.
   *
   * @returns {Promise<{success: boolean, error?: string, unavailable?: boolean}>}
   *   `unavailable` means the helper could not be used at all, and the caller
   *   should fall back rather than treat it as a printer fault.
   */
  async send({ printer, file, doc, ping = false }) {
    if (process.platform !== 'win32') return { success: false, unavailable: true };
    try {
      await this._ensure();
    } catch (error) {
      return { success: false, unavailable: true, error: error && error.message };
    }
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      return { success: false, unavailable: true };
    }

    const id = String(this.nextId++);
    const payload = ping
      ? JSON.stringify({ id, ping: true })
      : JSON.stringify({ id, printer: String(printer), file: String(file), doc: String(doc || 'Posnic Receipt') });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        /* A job that never came back means the helper is wedged. Take it down
           so the next receipt gets a fresh one rather than queueing behind a
           process that has stopped answering. */
        try { if (this.child) this.child.kill(); } catch (e) { /* already gone */ }
        resolve({ success: false, error: 'The printer did not answer in time' });
      }, JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      try {
        this.child.stdin.write(payload + '\n');
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve({ success: false, unavailable: true, error: error && error.message });
      }
    });
  }

  /** Deliberate shutdown, at quit. Nothing else may stop the helper. */
  stop() {
    this.stopped = true;
    this._stopHeartbeat();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (!child) return;
    try { child.stdin.end(); } catch (e) { /* already closed */ }
    try { child.kill(); } catch (e) { /* already gone */ }
  }
}

module.exports = new RawPrintService();
module.exports.RawPrintService = RawPrintService;
module.exports.JOB_TIMEOUT_MS = JOB_TIMEOUT_MS;
module.exports.HEARTBEAT_MS = HEARTBEAT_MS;
module.exports.RESTART_DELAYS_MS = RESTART_DELAYS_MS;
