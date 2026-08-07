/*
 * Every test runs on the same clock, whatever machine it is on.
 *
 * helpers.test.js asserted that 14:05 UTC formats as "07:35 pm" - true on the
 * machine it was written on, which was in India, and false on CI, which runs in
 * UTC. So the suite passed for whoever wrote it and failed for everybody else,
 * and the failure said nothing about the code.
 *
 * Pinned to Asia/Kolkata rather than UTC because that is what this product
 * assumes everywhere else: it is the documented default for a branch with no
 * timezone set, and a test suite that disagrees with the application's own
 * default is testing a configuration nobody runs.
 *
 * This makes tests reproducible. It does not make timezone handling correct -
 * that needs assertions about specific zones, which is what
 * date-preference.test.js does. A pinned clock and explicit timezone tests are
 * complementary: one removes the noise, the other checks the behaviour.
 */
/*
 * Set outright, not as a fallback, so the suite does not quietly follow
 * whatever the machine happens to be set to.
 *
 * Know its limit: this cannot rescue a process that started in UTC. Node
 * resolves the zone once at startup and takes a fast path for UTC that never
 * re-reads process.env.TZ, so on a CI runner this line runs and changes
 * nothing. That is why CI sets TZ in the workflow, before Node starts, and why
 * that is the authoritative setting rather than this one.
 *
 * This helps a developer whose machine is in some third timezone, where the
 * override does take effect. It is a convenience, not the guarantee.
 */
process.env.TZ = 'Asia/Kolkata';
