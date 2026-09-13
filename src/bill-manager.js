'use strict';

/*
 * THE BILL A WAITER ASKED FOR, COMING OUT AT THE COUNTER.
 *
 * Owner: "if mobile give bill then printer out should comes from desktop
 * connected. not from KOT."
 *
 * That is the standard and it is the whole design here. The waiter is at the
 * table when the guest asks for the bill; walking to the counter so somebody
 * else can press a button is the errand a handset exists to remove. So the
 * handset marks the ticket and this - running on the machine that owns the
 * printers - turns the mark into paper.
 *
 * WHY THE PHONE DOES NOT PRINT. It has no printer, it is not on the counter,
 * and a bill is collected by the person holding the drawer. Sending the job
 * from the phone would also mean every handset needing printer drivers, a
 * route to the printer, and the shop's paper settings. The till already has
 * all three.
 *
 * NOT THE KITCHEN'S PRINTER. A KOT and a bill are different documents, not one
 * document in two places: a ticket is departmental and carries only its own
 * lines, a bill is single and carries the totals, the tax and the shop header.
 * printer-targets.js has modelled that split from the start - a LIST of
 * printerNames for KOT, one printerName for the receipt - and this rides it.
 *
 * WHICH PRINTER, WITHOUT ASKING ANYBODY. The bill goes to the same printer a
 * receipt already goes to. That needs no new setting and no new screen: a shop
 * that can print a receipt can print a bill, and a shop that cannot has a
 * problem this feature did not cause and cannot fix. An explicit override can
 * be added the day somebody actually wants the bill somewhere else.
 *
 * POLLED, NOT PUSHED. Kitchen tickets get an event because a ticket is wanted
 * the second it is saved. A bill is wanted by the time the waiter has walked to
 * the counter, so a short poll is enough and is one less moving part. The real
 * reason it is a poll at all is the same reason the KOT path keeps one: a till
 * that was switched off, asleep or mid-update catches up when it comes back
 * instead of losing the bill.
 */

const { renderSale } = require('./escpos-receipt');
const { columnsFor } = require('./printer-targets');

/*
 * The same string the API emits on. Declared here rather than required from
 * the API, because that ships OUTSIDE the ASAR archive while this file lives
 * inside it - requiring across that line gives two module instances and an
 * event that goes nowhere. kot-manager.js has the same note for the same
 * reason. If one side ever changes this word, both must.
 */
const BILL_EVENT = 'posnic:bill-requested';

/* Long enough not to hammer a local API, short enough that the paper is
   waiting by the time somebody has crossed the room. */
const POLL_MS = 10000;

/* After a failure. A till whose API is down should not spin at ten seconds
   writing the same error into the log a thousand times an hour. */
const BACKOFF_MS = 60000;

/*
 * THE CLOUD DOOR'S PACE IS NOT DECIDED HERE.
 *
 * Owner: "should not give so much load to cloud also. need balanced and well
 * defined solution. polling should happen only when app connected and logged in
 * corrently acitve."
 *
 * The till has no way of knowing whether a waiter has the app open. The server
 * does, so the server answers every claim with how long to wait before the
 * next one, and this side obeys it. These are only the fallbacks for an answer
 * that did not say - an older API, or a reply that lost its shape.
 */
const CLOUD_IDLE_MS = 60000;

/* Nothing the server says is honoured past this. A bad number - a bug, a
   corrupted reply - must not be able to switch a shop's bill printing off for
   the rest of the day. */
const CLOUD_MAX_MS = 15 * 60 * 1000;

/* How often a till with the cloud door SHUT re-reads the switch. No request
   leaves the building on this path; it is a local file being read. */
const CLOUD_OFF_MS = 5 * 60 * 1000;

/*
 * The pause between emptying one batch and asking for the next.
 *
 * "Come straight back" must not mean "with no gap at all". A claim that keeps
 * answering with the same job - a server that cannot record the finish, a bug
 * either side - would otherwise spin this loop at whatever the network allows,
 * printing the same slip until the roll runs out. A quarter of a second is
 * imperceptible to a waiter and makes that impossible.
 */
const DRAIN_GAP_MS = 250;

/* Longer than the server's hold, which is twenty seconds, plus room for a slow
   link. Shorter than this and the till would abandon held requests just before
   they answered, and print nothing while looking perfectly busy. */
const CLOUD_TIMEOUT_MS = 40000;

/*
 * Where our own API is listening, RIGHT NOW.
 *
 * Read inside the function and never at module load. main.js sets PORT while
 * it starts up, so a const evaluated when this file is first required captures
 * the fallback instead - a mistake that has already cost this codebase three
 * separate outages, which is why kot-manager.js carries the same warning.
 */
function apiUrl() {
  return `http://127.0.0.1:${Number(process.env.PORT) || 5555}/api`;
}

/*
 * TWO DOORS, AND THE NEAR ONE IS TRIED FIRST.
 *
 * Owner: "even app first try to connect local lan only first thats easy and
 * offline safe. so make changes according to that."
 *
 * THE LOCAL DOOR is always open and costs nothing. A handset on the shop's own
 * Wi-Fi talks to THIS machine's API, which is require()d into this same
 * process, so a bill asked for on the floor arrives as an in-process event and
 * the paper starts in the same tick - 30ms from the tap, measured. The poll
 * underneath it is against 127.0.0.1: no internet, no bandwidth, and it still
 * works with the shop's line cut.
 *
 * THE CLOUD DOOR is shut unless a shop actually needs it - a waiter on mobile
 * data, a handset on a guest network that cannot see the till. It has to be
 * asked for, because a till that polls a tenant it never uses is exactly the
 * waste the owner is objecting to. When it IS open, the server sets the pace
 * and usually holds the request open rather than being asked again.
 *
 * Nothing can push INTO a shop: a till sits behind the shop's router with no
 * address anybody outside can reach. That is why the far door is asked rather
 * than told, and why it is worth so much trouble to avoid needing it.
 */
function cloudApiUrl(configured) {
  const cloud = String(configured || process.env.POSNIC_CLOUD_API || '').trim();
  /* Owners paste addresses. `.../api/` + `/sales/...` is a 404 and a bill
     nobody prints, which is a silly way to lose one. */
  return cloud ? cloud.replace(/\/+$/, '') : '';
}

class BillManager {
  constructor(hardwareManager, options = {}) {
    this.hardware = hardwareManager;
    /* How the till finds out which shop it is. Injected so this file needs no
       database of its own and can be driven by a test. */
    this.branchId = options.branchId || '';
    this.findBranchId = options.findBranchId || null;
    /* Which printer the shop chose for receipts. Injected for the same reason
       the branch is: this file keeps no knowledge of where settings live, and
       a test can hand it an answer. */
    this.findReceiptPrinter = options.findReceiptPrinter || null;
    this.paperSize = options.paperSize || '3inch';

    /*
     * WHICH MACHINE THIS IS, and where its shop keeps its data.
     *
     * Owner: "need solution that which till need to send for bill also there."
     * A shop with a counter till and a first-floor till has two printers in two
     * rooms, so a job can be addressed - and a till has to be able to say who
     * it is when it asks. The hostname is the honest default: it is what the
     * shopkeeper already calls that machine.
     */
    this.tillId = options.tillId || require('os').hostname();

    /*
     * THE FAR DOOR, AND ITS SWITCH.
     *
     * Read through a function rather than captured, so a shop that turns cloud
     * printing on does not have to restart the till - and so a till that was
     * never meant to relay cloud bills makes no request at all, ever.
     */
    this.cloudApi = options.cloudApi || '';
    this.cloudPrint = !!options.cloudPrint;
    this.findCloudPrint = options.findCloudPrint || null;

    this.timer = null;
    this.cloudTimer = null;
    this.polling = false;
    this.lastPollAt = null;
    this.lastStatus = 'idle';
    this.cloudStatus = 'off';
    this.cloudPollAt = null;
    this.printedCount = 0;
  }

  getStatus() {
    return {
      isPolling: this.polling,
      lastPollAt: this.lastPollAt,
      lastStatus: this.lastStatus,
      printed: this.printedCount,
      branchId: this.branchId,
      tillId: this.tillId,
      /* Reported separately because the two doors fail separately: a shop can
         have a perfectly working counter printer and a cloud address that is
         wrong, and one status line would hide that. */
      cloud: { status: this.cloudStatus, lastPollAt: this.cloudPollAt },
    };
  }

  start(config = {}) {
    if (config.branchId) this.branchId = String(config.branchId);
    if (config.paperSize) this.paperSize = config.paperSize;
    if (this.polling) return;
    this.polling = true;

    /*
     * THE FAST PATH, AND THE REASON THIS IS NOT JUST A POLLER.
     *
     * When a handset is on the shop's own Wi-Fi it talks to THIS MACHINE's
     * API, and that API is require()d into this same process - so a bill
     * requested on the floor arrives here as an in-process event, and the
     * paper starts in the same tick. No ten second wait, no round trip, no
     * database sync in between.
     *
     * A cloud shop cannot be reached from outside its router, so nothing can
     * push to it and the poll below is the only way it learns anything. The
     * event simply never fires there, which costs nothing.
     *
     * The poll stays underneath in both cases: it is what catches a request
     * made while this app was starting, one whose print failed, and one that
     * arrived in the gap while the printer was busy.
     */
    if (!this._onRequested) {
      this._onRequested = (payload) => {
        if (!this.polling) return;
        /* A branch arriving on the event is used when nothing is configured,
           the way the KOT manager takes one from a sale. */
        if (!this.branchId && payload && payload.branchId) {
          this.branchId = String(payload.branchId);
        }
        console.log('[BILL] asked for from the floor - printing now');
        this._schedule(0);
      };
      try {
        process.on(BILL_EVENT, this._onRequested);
      } catch (e) {
        /* No event bus is survivable: the poll below still serves. */
      }
    }

    this._schedule(0);
    /* The far door starts by reading its own switch, which is a local file.
       A till with cloud printing off never gets past that line. */
    this._scheduleCloud(0);
  }

  stop() {
    this.polling = false;
    clearTimeout(this.timer);
    clearTimeout(this.cloudTimer);
    this.timer = null;
    this.cloudTimer = null;
    if (this._onRequested) {
      try {
        process.removeListener(BILL_EVENT, this._onRequested);
      } catch (e) {
        /* going away anyway */
      }
      this._onRequested = null;
    }
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    if (!this.polling) return;
    this.timer = setTimeout(() => this._poll(), ms);
  }

  _scheduleCloud(ms) {
    clearTimeout(this.cloudTimer);
    if (!this.polling) return;
    this.cloudTimer = setTimeout(() => this._pollCloud(), ms);
  }

  /**
   * Ask the API what the counter is owed, print it, say it printed.
   *
   * Marked printed only AFTER the paper came out. A till that dies mid-job
   * asks again when it returns, which costs a duplicate bill at worst - and a
   * duplicate bill is a piece of paper, while a lost one is a guest sitting at
   * a table waiting for something nobody is going to bring.
   */
  async _poll() {
    if (!this.polling) return;

    try {
      if (!this.branchId && typeof this.findBranchId === 'function') {
        this.branchId = String((await this.findBranchId()) || '');
      }
      if (!this.branchId) {
        /* Nothing to ask about yet. Not an error: a till still being set up. */
        this.lastStatus = 'no branch';
        return this._schedule(POLL_MS);
      }

      /*
       * THE NEAR DOOR. This machine's own API, on 127.0.0.1.
       *
       * No internet, no bandwidth, no cloud account - a shop with its line cut
       * still prints every bill its waiters ask for. This is the path almost
       * every shop uses and it is deliberately the one that needs nothing
       * configured.
       */
      const out = await this._drain(apiUrl());
      this.lastStatus = 'ok';
      /* Straight round again while there is a queue: a table waiting on three
         rounds should not wait ten seconds between slips. */
      return this._schedule(out.count ? DRAIN_GAP_MS : POLL_MS);
    } catch (error) {
      this.lastStatus = `error: ${error && error.message ? error.message : error}`;
      console.error('[BILL] poll failed:', error && error.message);
      return this._schedule(BACKOFF_MS);
    }
  }

  /**
   * What this machine was told about relaying cloud bills, right now.
   *
   * Asked on every pass rather than captured at startup, so turning the switch
   * on in Hardware Manager takes effect on the next tick instead of on the next
   * restart - and so turning it OFF actually stops the requests.
   */
  async _cloudSettings() {
    if (typeof this.findCloudPrint === 'function') {
      try {
        const said = (await this.findCloudPrint()) || {};
        return {
          enabled: said.enabled === undefined ? this.cloudPrint : !!said.enabled,
          apiUrl: String(said.apiUrl || this.cloudApi || '').trim(),
        };
      } catch (error) {
        /* An unreadable preferences file must not decide a shop's printing.
           Fall through to whatever this manager was constructed with. */
      }
    }
    return { enabled: !!this.cloudPrint, apiUrl: String(this.cloudApi || '').trim() };
  }

  /**
   * THE FAR DOOR: the shop's cloud tenant, asked only when it is needed.
   *
   * Three things keep this from being the waste the owner objected to:
   *
   *   1. It is off unless somebody turned it on. A till with the switch shut
   *      reads a local file every five minutes and sends nothing.
   *   2. The server decides when to come back - five seconds while a waiter is
   *      working, a minute when the floor is empty - so a closed restaurant
   *      costs one request a minute rather than one every five seconds.
   *   3. `wait` lets the server HOLD the request instead of answering empty,
   *      which is both fewer requests than polling and faster than it: the
   *      bill leaves the moment it is asked for.
   */
  async _pollCloud() {
    if (!this.polling) return;

    try {
      const settings = await this._cloudSettings();
      const base = cloudApiUrl(settings.apiUrl);
      if (!settings.enabled || !base) {
        /* Nothing leaves this machine on this path. */
        this.cloudStatus = 'off';
        return this._scheduleCloud(CLOUD_OFF_MS);
      }

      if (!this.branchId && typeof this.findBranchId === 'function') {
        this.branchId = String((await this.findBranchId()) || '');
      }
      if (!this.branchId) {
        this.cloudStatus = 'no branch';
        return this._scheduleCloud(CLOUD_IDLE_MS);
      }

      const out = await this._drain(base, { wait: true, timeoutMs: CLOUD_TIMEOUT_MS });
      this.cloudPollAt = new Date().toISOString();
      this.cloudStatus = 'ok';
      return this._scheduleCloud(out.pace);
    } catch (error) {
      this.cloudStatus = `error: ${error && error.message ? error.message : error}`;
      console.error('[BILL] cloud poll failed:', error && error.message);
      return this._scheduleCloud(BACKOFF_MS);
    }
  }

  /**
   * Take whatever is waiting at one address, print it, say what happened.
   *
   * The same code for both doors, because it IS the same conversation - only
   * the address differs. The job arrives carrying what to print, so nothing
   * has to be looked up and nothing has to have synced down first. That is the
   * whole reason the queue exists.
   *
   * Claiming is atomic on the server: a second till asking at the same instant
   * gets a different job, or none. Two tills in one shop is exactly when that
   * matters and exactly when a shop is busy enough to have two running.
   */
  async _drain(base, { wait = false, timeoutMs = 0 } = {}) {
    const key = process.env.KIOSK_API_KEY || '';
    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        kioskkey: key,
      },
      body: JSON.stringify({
        branchId: this.branchId,
        tillId: this.tillId,
        kind: 'bill',
        wait,
      }),
    };
    /* A held request needs a deadline longer than the hold. Without one a
       dropped link leaves this waiting for ever and the till stops printing
       while looking perfectly healthy. */
    if (timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      request.signal = AbortSignal.timeout(timeoutMs);
    }

    const response = await fetch(`${base}/sales/claimPrintJobs`, request);
    const answer = await response.json();
    this.lastPollAt = new Date().toISOString();

    /*
     * Two shapes accepted on purpose. The queue answers `{ jobs, poll }`; an
     * older API answered with the list itself. A till in a shop is updated
     * when the shopkeeper gets round to it, not when we ship, so reading both
     * costs one line and saves a shop that skipped a version.
     */
    const said = answer && answer.data;
    const jobs = Array.isArray(said) ? said : (said && Array.isArray(said.jobs) ? said.jobs : []);
    const told = said && said.poll ? Number(said.poll.nextMs) : NaN;

    if (jobs.length) console.log(`[BILL] ${jobs.length} bill(s) to print`);

    for (const job of jobs) {
      /* eslint-disable-next-line no-await-in-loop -- printers are serial
         devices; two jobs sent at once interleave on the same roll. */
      const printed = await this._printOne(job.payload || {});
      if (printed.ok) this.printedCount += 1;
      /* eslint-disable-next-line no-await-in-loop -- see above */
      await this._finish(base, key, this._idOf(job), printed.ok, printed.error);
    }

    const pace = Number.isFinite(told)
      ? Math.max(DRAIN_GAP_MS, Math.min(told, CLOUD_MAX_MS))
      : (jobs.length ? DRAIN_GAP_MS : CLOUD_IDLE_MS);

    return { count: jobs.length, pace };
  }

  _idOf(sale) {
    if (!sale) return '';
    const id = sale._id;
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (id.$oid) return String(id.$oid);
    return id.toString ? id.toString() : '';
  }

  /**
   * The printer this bill belongs on.
   *
   * THE RECEIPT PRINTER, which in a restaurant is the one at the counter
   * where the customer is standing. This used to ask for "whatever Windows
   * calls the default", which in a two-printer shop is a coin toss: a shop
   * with a counter roll and a kitchen roll had its customer's bill come out
   * in the kitchen, and nothing said why. Worse, getDefaultPrinter falls back
   * to the FIRST printer it enumerates when Windows has no default at all, so
   * the answer could change between two boots of the same machine.
   *
   * The Windows default is still the fallback, because every shop running
   * today predates the Receipt Printer setting and refusing to print a
   * customer's bill until somebody opens Hardware Manager would be worse than
   * printing it in the wrong room. It is logged, so the wrong room has a
   * reason next to it in the log.
   */
  async _receiptPrinterName() {
    try {
      const chosen = this.findReceiptPrinter ? await this.findReceiptPrinter() : null;
      if (chosen && String(chosen).trim()) return String(chosen).trim();
    } catch (error) {
      console.error('[BILL] could not read the receipt printer:', error && error.message);
    }
    const printer = await this.hardware.getDefaultPrinter();
    const fallback = printer && printer.name ? printer.name : '';
    if (!fallback) return '';

    /*
     * NOT THE KITCHEN, whatever Windows prefers.
     *
     * Owner, on a two-printer restaurant: "receipt only send to Reception
     * right. kitchen should receive only kot print." A till with no receipt
     * printer chosen falls back to the Windows default, and on a restaurant
     * machine that default is very often the kitchen roll - which is exactly
     * how a customer's bill came out beside the cook with nothing to explain
     * it.
     *
     * A printer this till already sends kitchen tickets to is, by definition,
     * not the counter. Refusing is better than guessing wrong: the bill waits,
     * the poll keeps it, and the log says what to do about it.
     */
    try {
      const devicePrefs = require('./device-preferences');
      if (devicePrefs.isKitchenPrinter(fallback)) {
        console.error(
          '[BILL] no receipt printer is set, and the Windows default (' + fallback + ') is a '
          + 'kitchen printer. Choose a receipt printer in Hardware Manager; the bill is not printed.'
        );
        return '';
      }
    } catch (error) {
      /* Unable to tell: fall through and use the default, as before. */
    }

    console.warn(
      '[BILL] no receipt printer is set for this till, so the bill goes to the Windows default:',
      fallback
    );
    return fallback;
  }

  /**
   * One bill, on the counter's roll.
   *
   * Answers WHY when it could not, not just that it could not. The reason
   * travels back to the queue and sits on the job, which is the only place
   * anybody can read it afterwards: the till's own console is a window nobody
   * has open on a shop floor, and "the bill did not come out" with no reason
   * attached is a support call that starts from nothing.
   *
   * @returns {Promise<{ok: boolean, error: string}>}
   */
  async _printOne(sale) {
    try {
      const name = await this._receiptPrinterName();
      if (!name) {
        const why = 'No receipt printer is set on this till and Windows has no default.';
        console.error(`[BILL] ${why}`);
        return { ok: false, error: why };
      }

      /*
       * Rendered for THIS roll's width. An 80mm roll is 48 columns and a 58mm
       * is 32, and the same bytes cannot serve both - getting it wrong wraps
       * the total onto its own line, which reads as a rounding bug on paper.
       */
      /*
       * The bill a waiter carries to the table is not a receipt.
       *
       * It reached the roll with no document heading at all, because
       * pendingBillPrints answers raw sale documents and a sale carries no
       * title. So the customer got an unlabelled slip, then a second slip
       * headed SALES RECEIPT after paying.
       *
       * A GST-registered shop issues a TAX INVOICE for the supply; a shop
       * without GST issues a BILL. Both say UNPAID, because this is a demand
       * for payment, and the receipt follows once it is paid.
       */
      const gstin = String((sale && (sale.branch_gstin_number || sale.gstin)) || '').trim();
      const bytes = renderSale(
        { ...(sale || {}), title: (gstin ? 'TAX INVOICE' : 'BILL') + ' - UNPAID' },
        {
          paperWidth: String(columnsFor(this.paperSize)),
          /* The drawer is the cashier business and this is not a payment. */
          openDrawer: false,
          cut: true,
        }
      );

      const result = await this.hardware.sendRawToPrinter(name, bytes, 'Posnic Bill');
      if (!result || result.success === false) {
        const why = (result && result.error) || 'the printer refused the job';
        console.error('[BILL] printer refused:', why);
        return { ok: false, error: `${name}: ${why}` };
      }
      return { ok: true, error: '' };
    } catch (error) {
      const why = (error && error.message) || String(error);
      console.error('[BILL] could not print:', why);
      return { ok: false, error: why };
    }
  }

  /**
   * Say what happened to a job this till took.
   *
   * A failure goes back on the queue rather than being dropped: the attempt
   * was already counted when it was claimed, so a printer that is off cannot
   * spin for ever, and a printer that was merely busy gets another go.
   */
  async _finish(base, key, id, ok, error = '') {
    if (!id) return;
    try {
      await fetch(`${base}/sales/finishPrintJob`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          kioskkey: key,
        },
        body: JSON.stringify({ id, ok, error: ok ? '' : String(error || '') }),
      });
    } catch (error) {
      /*
       * The paper is already out. Failing to say so means the job goes stale
       * and is offered again later - a wasted slip rather than a lost bill,
       * which is the right way round for this to fail.
       */
      console.error('[BILL] printed but could not close the job:', error && error.message);
    }
  }

}

module.exports = BillManager;
