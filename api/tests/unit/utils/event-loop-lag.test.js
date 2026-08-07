/*
 * The event-loop lag sampler behind /api/healthz.
 *
 * The point of the peak is easy to get wrong, and the first version of this
 * module did: it kept only the newest sample, so blocking the loop for 1.5
 * seconds and asking a second later returned 2 ms. The stall had already been
 * overwritten. A supervisor polls every few seconds, so the number worth
 * reporting is the worst of the recent past.
 */

const lag = require('../../../src/utils/event-loop-lag');

describe('event loop lag', () => {
  afterEach(() => lag.reset());

  test('an idle loop reports no meaningful lag', () => {
    lag.reset();
    expect(lag.currentLagMs()).toBe(0);
    expect(lag.peakLagMs()).toBe(0);
  });

  test('the peak survives later quiet samples', async () => {
    lag.reset();

    /* Block the loop for long enough that the next timer is visibly late. */
    const until = Date.now() + 1400;
    while (Date.now() < until) {
      /* deliberately synchronous */
    }

    /* Let the delayed sample land, then let a quiet one land after it. */
    await new Promise((resolve) => setTimeout(resolve, 2400));

    expect(lag.peakLagMs()).toBeGreaterThan(300);
  }, 15000);

  test('reset clears the history', () => {
    lag.reset();
    expect(lag.peakLagMs()).toBe(0);
    expect(lag.currentLagMs()).toBe(0);
  });

  test('the sampler never keeps the process alive', () => {
    /* An unref'd timer is the difference between a health check and a process
       that will not exit. Jest would hang here rather than fail. */
    lag.stop();
    lag.start();
    expect(typeof lag.currentLagMs()).toBe('number');
  });

  test('it keeps a bounded window rather than growing forever', () => {
    expect(lag.WINDOW_SAMPLES).toBeGreaterThan(0);
    expect(lag.WINDOW_SAMPLES).toBeLessThanOrEqual(600);
    expect(lag.INTERVAL_MS).toBeGreaterThanOrEqual(250);
  });
});
