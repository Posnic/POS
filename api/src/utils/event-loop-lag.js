/*
 * How far behind the event loop is running.
 *
 * A Node process can be answering /health while being useless: one synchronous
 * gzip of a large backup, one report that builds a 200 MB array, one regex that
 * backtracks, and every request queues behind it. The process is alive, the
 * port is open, and a cashier is staring at a spinner.
 *
 * This measures the gap between when a timer was due and when it actually ran.
 * A loop with nothing to do reports near zero; a loop blocked in synchronous
 * work reports however long that work took.
 *
 * Why there is a peak as well as a current reading: the first version of this
 * kept only the newest sample, and that hid exactly what it was built to find.
 * Blocking the loop for 1.5 s and asking a second later returned 2 ms, because
 * a fresh sample had already replaced the spike. A stall is brief and a
 * supervisor polls slowly, so the number worth reporting is the worst of the
 * recent past, not the instant.
 *
 * The sampler is unref'd, so it never holds the process open, and it costs one
 * timer per second.
 */

const INTERVAL_MS = 1000;
const WINDOW_SAMPLES = 60; // one minute of history

const samples = new Array(WINDOW_SAMPLES).fill(0);
let cursor = 0;
let lastLagMs = 0;
let timer = null;

function record(lagMs) {
  lastLagMs = lagMs;
  samples[cursor] = lagMs;
  cursor = (cursor + 1) % WINDOW_SAMPLES;
}

function sample() {
  const due = Date.now() + INTERVAL_MS;
  timer = setTimeout(() => {
    /* Anything past the scheduled time is the loop being busy elsewhere.
       Timers can also fire a millisecond early; clamp at zero. */
    record(Math.max(0, Date.now() - due));
    sample();
  }, INTERVAL_MS);

  /* Never a reason for the process to stay alive. */
  if (typeof timer.unref === 'function') timer.unref();
}

function start() {
  if (!timer) sample();
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** The most recent sample. Useful for a live display, not for a decision. */
function currentLagMs() {
  return lastLagMs;
}

/** The worst sample in the last minute. This is what a health check should read. */
function peakLagMs() {
  return samples.reduce((worst, value) => (value > worst ? value : worst), 0);
}

/** Exported for tests, which need a known starting point. */
function reset() {
  samples.fill(0);
  cursor = 0;
  lastLagMs = 0;
}

/* Start on require. Nothing has to remember to turn it on, and an unref'd
   timer changes neither shutdown nor the test runner's exit. */
start();

module.exports = { currentLagMs, peakLagMs, start, stop, reset, INTERVAL_MS, WINDOW_SAMPLES };
