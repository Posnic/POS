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

    this.timer = null;
    this.polling = false;
    this.lastPollAt = null;
    this.lastStatus = 'idle';
    this.printedCount = 0;
  }

  getStatus() {
    return {
      isPolling: this.polling,
      lastPollAt: this.lastPollAt,
      lastStatus: this.lastStatus,
      printed: this.printedCount,
      branchId: this.branchId,
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
  }

  stop() {
    this.polling = false;
    clearTimeout(this.timer);
    this.timer = null;
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

      const key = process.env.KIOSK_API_KEY || '';
      const response = await fetch(`${apiUrl()}/sales/pendingBillPrints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          kioskkey: key,
        },
        body: JSON.stringify({ branchId: this.branchId }),
      });

      const answer = await response.json();
      this.lastPollAt = new Date().toISOString();

      const bills = Array.isArray(answer && answer.data) ? answer.data : [];
      if (!bills.length) {
        this.lastStatus = 'ok';
        return this._schedule(POLL_MS);
      }

      console.log(`[BILL] ${bills.length} bill(s) asked for from the floor`);

      const printed = [];
      for (const sale of bills) {
        const id = this._idOf(sale);
        if (!id) continue;
        /* eslint-disable-next-line no-await-in-loop -- printers are serial
           devices; two jobs sent at once interleave on the same roll. */
        const ok = await this._printOne(sale);
        if (ok) printed.push(id);
      }

      if (printed.length) {
        this.printedCount += printed.length;
        await this._markPrinted(printed);
      }

      this.lastStatus = 'ok';
      return this._schedule(POLL_MS);
    } catch (error) {
      this.lastStatus = `error: ${error && error.message ? error.message : error}`;
      console.error('[BILL] poll failed:', error && error.message);
      return this._schedule(BACKOFF_MS);
    }
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
    if (fallback) {
      console.warn(
        '[BILL] no receipt printer is set for this till, so the bill goes to the Windows default:',
        fallback
      );
    }
    return fallback;
  }

  /** One bill, on the counter's roll. */
  async _printOne(sale) {
    try {
      const name = await this._receiptPrinterName();
      if (!name) {
        console.error('[BILL] no receipt printer is set and Windows has no default; cannot print the bill');
        return false;
      }

      /*
       * Rendered for THIS roll's width. An 80mm roll is 48 columns and a 58mm
       * is 32, and the same bytes cannot serve both - getting it wrong wraps
       * the total onto its own line, which reads as a rounding bug on paper.
       */
      const bytes = renderSale(sale || {}, {
        paperWidth: String(columnsFor(this.paperSize)),
        /* The drawer is the cashier's business and this is not a payment. */
        openDrawer: false,
        cut: true,
      });

      const result = await this.hardware.sendRawToPrinter(name, bytes, 'Posnic Bill');
      if (!result || result.success === false) {
        console.error('[BILL] printer refused:', result && result.error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[BILL] could not print:', error && error.message);
      return false;
    }
  }

  async _markPrinted(saleIds) {
    try {
      await fetch(`${apiUrl()}/sales/markBillPrinted`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          kioskkey: process.env.KIOSK_API_KEY || '',
        },
        body: JSON.stringify({ saleIds }),
      });
    } catch (error) {
      /*
       * The paper is already out. Failing to say so means it prints again on
       * the next pass, which is a wasted slip rather than a lost bill - the
       * right way round for this to fail.
       */
      console.error('[BILL] printed but could not mark:', error && error.message);
    }
  }
}

module.exports = BillManager;
