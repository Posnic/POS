'use strict';

/**
 * Unit tests for src/utils/online-ordering.js
 *
 * Pure module, no mocks and no clock faking: every function that cares about
 * time takes the time as an argument. That is the point of the split.
 */

const {
  MODE,
  STATE,
  channelState,
  isOpenAt,
  kioskEntry,
  hasStoreId,
  nextOpeningFrom,
  normalizeHours,
  normalizeMode,
  normalizeTimeZone,
  normalizeWindows,
  toClock,
  toMinutes,
} = require('../../../src/utils/online-ordering');

const SUN = 0;
const FRI = 5;
const SAT = 6;

/* 11:00-15:00 and 19:00-23:00, the ordinary Indian restaurant day. */
const SPLIT_DAY = [
  { open: '11:00', close: '15:00' },
  { open: '19:00', close: '23:00' },
];

function week(overrides = {}) {
  return normalizeHours({
    sun: SPLIT_DAY,
    mon: SPLIT_DAY,
    tue: SPLIT_DAY,
    wed: SPLIT_DAY,
    thu: SPLIT_DAY,
    fri: SPLIT_DAY,
    sat: SPLIT_DAY,
    ...overrides,
  });
}

describe('kioskEntry', () => {
  /*
   * The bug this module exists for. branch.kiosk is an array in every write
   * path in the application, and the order guard read it as an object, so
   * every QR order was refused.
   */
  test('reads the array shape the application actually writes', () => {
    const branch = { kiosk: [{ store_id: 'QR-1', mode: 'order' }] };
    expect(kioskEntry(branch).store_id).toBe('QR-1');
    expect(hasStoreId(kioskEntry(branch))).toBe(true);
  });

  test('still reads the object shape older fixtures use', () => {
    expect(kioskEntry({ kiosk: { store_id: 'QR-1' } }).store_id).toBe('QR-1');
  });

  test('prefers the entry matching the store id when several exist', () => {
    const branch = { kiosk: [{ store_id: 'A' }, { store_id: 'B' }] };
    expect(kioskEntry(branch, 'B').store_id).toBe('B');
  });

  test('an empty array is not a configured kiosk', () => {
    expect(kioskEntry({ kiosk: [] })).toBeNull();
    expect(hasStoreId(kioskEntry({ kiosk: [] }))).toBe(false);
  });

  test('a branch with no kiosk field at all is not a configured kiosk', () => {
    expect(kioskEntry({})).toBeNull();
    expect(hasStoreId(null)).toBe(false);
  });

  test('an entry with a blank store id has not opted in', () => {
    expect(hasStoreId({ store_id: '   ' })).toBe(false);
  });
});

describe('normalizeMode', () => {
  test('defaults to order', () => {
    expect(normalizeMode(undefined)).toBe(MODE.ORDER);
    expect(normalizeMode(null)).toBe(MODE.ORDER);
    expect(normalizeMode('')).toBe(MODE.ORDER);
  });

  test('menu is the only thing that turns ordering off', () => {
    expect(normalizeMode('menu')).toBe(MODE.MENU);
    expect(normalizeMode('MENU')).toBe(MODE.MENU);
    expect(normalizeMode(' menu ')).toBe(MODE.MENU);
  });

  /* An enum has no truthy trap. The string 'false' reading as ON through
     `!== false` has cost this estate real bugs. */
  test('junk is order, never an accidental menu', () => {
    expect(normalizeMode('false')).toBe(MODE.ORDER);
    expect(normalizeMode(false)).toBe(MODE.ORDER);
    expect(normalizeMode(0)).toBe(MODE.ORDER);
  });
});

describe('toMinutes / toClock', () => {
  test('parses clock strings', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('9:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });

  test('accepts a minute count it previously produced', () => {
    expect(toMinutes(570)).toBe(570);
    expect(toMinutes(0)).toBe(0);
  });

  test('refuses anything that is not a clock time', () => {
    expect(toMinutes('24:00')).toBeNull();
    expect(toMinutes('12:60')).toBeNull();
    expect(toMinutes('noon')).toBeNull();
    expect(toMinutes(1440)).toBeNull();
    expect(toMinutes(-1)).toBeNull();
    expect(toMinutes(null)).toBeNull();
  });

  test('round-trips', () => {
    expect(toClock(toMinutes('19:05'))).toBe('19:05');
    expect(toClock(0)).toBe('00:00');
  });
});

describe('normalizeWindows', () => {
  test('keeps valid windows and sorts them by opening time', () => {
    const w = normalizeWindows([
      { open: '19:00', close: '23:00' },
      { open: '11:00', close: '15:00' },
    ]);
    expect(w).toEqual([
      { open: 660, close: 900 },
      { open: 1140, close: 1380 },
    ]);
  });

  test('drops windows with an unparseable end', () => {
    expect(normalizeWindows([{ open: '11:00', close: 'later' }])).toEqual([]);
  });

  /* Not a 24-hour day: somebody typed the same time twice. A shop that never
     closes leaves hours null instead. */
  test('drops a zero-length window', () => {
    expect(normalizeWindows([{ open: '11:00', close: '11:00' }])).toEqual([]);
  });

  test('keeps a window that crosses midnight', () => {
    expect(normalizeWindows([{ open: '18:00', close: '02:00' }])).toEqual([
      { open: 1080, close: 120 },
    ]);
  });

  test('a non-array is no windows', () => {
    expect(normalizeWindows(null)).toEqual([]);
    expect(normalizeWindows('11:00-15:00')).toEqual([]);
  });
});

describe('normalizeHours', () => {
  test('null means no schedule, which means always open', () => {
    expect(normalizeHours(null)).toBeNull();
    expect(isOpenAt(null, SUN, 0)).toBe(true);
  });

  test('a week with nothing in it is treated as no schedule', () => {
    /* Saving a schedule that shuts the shop forever is never what anybody
       meant, and it would be invisible until customers stopped arriving. */
    expect(normalizeHours({ mon: [], tue: [] })).toBeNull();
  });

  test('a day with no windows is closed that day, and that is different', () => {
    const hours = week({ mon: [] });
    expect(hours).not.toBeNull();
    expect(hours.mon).toEqual([]);
    expect(isOpenAt(hours, 1, 720)).toBe(false);
  });
});

describe('isOpenAt', () => {
  const hours = week();

  test('inside a window', () => {
    expect(isOpenAt(hours, FRI, toMinutes('12:00'))).toBe(true);
    expect(isOpenAt(hours, FRI, toMinutes('20:00'))).toBe(true);
  });

  test('in the gap between lunch and dinner', () => {
    expect(isOpenAt(hours, FRI, toMinutes('17:00'))).toBe(false);
  });

  test('before the first window and after the last', () => {
    expect(isOpenAt(hours, FRI, toMinutes('09:00'))).toBe(false);
    expect(isOpenAt(hours, FRI, toMinutes('23:30'))).toBe(false);
  });

  test('open at the opening minute, shut at the closing minute', () => {
    expect(isOpenAt(hours, FRI, toMinutes('11:00'))).toBe(true);
    expect(isOpenAt(hours, FRI, toMinutes('15:00'))).toBe(false);
  });

  describe('windows that cross midnight', () => {
    const bar = week({ fri: [{ open: '18:00', close: '02:00' }], sat: [] });

    test('open late on the evening it started', () => {
      expect(isOpenAt(bar, FRI, toMinutes('23:30'))).toBe(true);
    });

    /* The pass people forget: Saturday has no windows of its own, and the
       shop is open anyway because Friday's has not closed yet. */
    test('still open after midnight, on a day with no windows of its own', () => {
      expect(isOpenAt(bar, SAT, toMinutes('00:30'))).toBe(true);
      expect(isOpenAt(bar, SAT, toMinutes('01:59'))).toBe(true);
    });

    test('shut once the spillover ends', () => {
      expect(isOpenAt(bar, SAT, toMinutes('02:00'))).toBe(false);
      expect(isOpenAt(bar, SAT, toMinutes('12:00'))).toBe(false);
    });

    test('the week wraps, so Sunday sees Saturday night', () => {
      const late = week({ sat: [{ open: '20:00', close: '03:00' }], sun: [] });
      expect(isOpenAt(late, SUN, toMinutes('01:00'))).toBe(true);
    });
  });
});

describe('nextOpeningFrom', () => {
  const hours = week();

  test('later the same day', () => {
    expect(nextOpeningFrom(hours, FRI, toMinutes('17:00'))).toEqual({
      dayOffset: 0,
      minutes: toMinutes('19:00'),
    });
  });

  test('tomorrow, when today is finished', () => {
    expect(nextOpeningFrom(hours, FRI, toMinutes('23:30'))).toEqual({
      dayOffset: 1,
      minutes: toMinutes('11:00'),
    });
  });

  test('skips days that are closed', () => {
    /* Friday night, with Saturday and Sunday shut: the next opening is
       Monday lunch, three days out. */
    const closedWeekend = week({ sat: [], sun: [] });
    expect(nextOpeningFrom(closedWeekend, FRI, toMinutes('23:30'))).toEqual({
      dayOffset: 3,
      minutes: toMinutes('11:00'),
    });
  });

  test('no schedule has no next opening, because it never shut', () => {
    expect(nextOpeningFrom(null, FRI, 0)).toBeNull();
  });
});

describe('normalizeTimeZone', () => {
  /* branch.model.js writes Asia/Calcutta, setting.model.js writes
     Asia/Kolkata. Same zone, different strings. */
  test('keeps a real zone, including the deprecated Indian alias', () => {
    expect(normalizeTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(normalizeTimeZone('Asia/Calcutta')).toBe('Asia/Calcutta');
    expect(normalizeTimeZone('Europe/London')).toBe('Europe/London');
  });

  test('a typo falls back rather than taking the channel down', () => {
    expect(normalizeTimeZone('Asia/Kolkatta')).toBe('Asia/Kolkata');
    expect(normalizeTimeZone('')).toBe('Asia/Kolkata');
    expect(normalizeTimeZone(null)).toBe('Asia/Kolkata');
  });
});

describe('channelState', () => {
  const IST = 'Asia/Kolkata';
  /* 2026-09-11 is a Friday. 12:30 IST is inside the lunch window. */
  const fridayLunch = new Date('2026-09-11T07:00:00Z');
  const fridayTeatime = new Date('2026-09-11T11:30:00Z'); // 17:00 IST, the gap

  const open = { store_id: 'QR-1', mode: 'order' };

  test('open when nothing says otherwise', () => {
    const s = channelState(open, { now: fridayLunch, timeZone: IST });
    expect(s.state).toBe(STATE.OPEN);
    expect(s.accepting).toBe(true);
    expect(s.message).toBe('');
  });

  test('a branch with no store id has not opted in', () => {
    const s = channelState({ mode: 'order' }, { now: fridayLunch, timeZone: IST });
    expect(s.state).toBe(STATE.DISABLED);
    expect(s.accepting).toBe(false);
  });

  test('the shop-level module switch wins over everything', () => {
    const s = channelState(open, { now: fridayLunch, timeZone: IST, moduleEnabled: false });
    expect(s.state).toBe(STATE.DISABLED);
    expect(s.accepting).toBe(false);
  });

  test('menu mode never accepts, and says where to order', () => {
    const s = channelState({ ...open, mode: 'menu' }, { now: fridayLunch, timeZone: IST });
    expect(s.state).toBe(STATE.MENU_ONLY);
    expect(s.accepting).toBe(false);
    expect(s.message).toMatch(/counter/i);
  });

  describe('pause', () => {
    test('a pause in the future stops orders and says when it lifts', () => {
      const until = new Date(fridayLunch.getTime() + 30 * 60000);
      const s = channelState({ ...open, paused_until: until }, { now: fridayLunch, timeZone: IST });
      expect(s.state).toBe(STATE.PAUSED);
      expect(s.accepting).toBe(false);
      expect(s.resumes_at).toBe(until.toISOString());
      expect(s.message).toMatch(/Back at 1:00 PM/);
    });

    /* The reason a pause is a timestamp and not a boolean: it cannot be left
       on. A boolean flipped during a Friday rush is still on on Tuesday. */
    test('a pause in the past has already lifted itself', () => {
      const until = new Date(fridayLunch.getTime() - 60 * 60000);
      const s = channelState({ ...open, paused_until: until }, { now: fridayLunch, timeZone: IST });
      expect(s.state).toBe(STATE.OPEN);
      expect(s.accepting).toBe(true);
    });

    test('an unparseable pause is no pause', () => {
      const s = channelState(
        { ...open, paused_until: 'whenever' },
        { now: fridayLunch, timeZone: IST }
      );
      expect(s.state).toBe(STATE.OPEN);
    });
  });

  describe('opening hours', () => {
    const scheduled = { ...open, hours: week() };

    test('open inside a window', () => {
      const s = channelState(scheduled, { now: fridayLunch, timeZone: IST });
      expect(s.state).toBe(STATE.OPEN);
      expect(s.accepting).toBe(true);
    });

    test('closed in the gap, and says when it opens', () => {
      const s = channelState(scheduled, { now: fridayTeatime, timeZone: IST });
      expect(s.state).toBe(STATE.CLOSED_HOURS);
      expect(s.accepting).toBe(false);
      expect(s.message).toMatch(/Opens at 7:00 PM/);
      expect(new Date(s.opens_at).toISOString()).toBe('2026-09-11T13:30:00.000Z');
    });

    test('the same instant is open or closed depending on the zone', () => {
      /* 17:00 IST is 12:30 in Nepal... but more usefully, a branch in London
         at that instant is at 12:30 and inside its own lunch window. */
      const s = channelState(scheduled, { now: fridayTeatime, timeZone: 'Europe/London' });
      expect(s.state).toBe(STATE.OPEN);
    });

    test('no schedule means always open', () => {
      const s = channelState(open, { now: fridayTeatime, timeZone: IST });
      expect(s.state).toBe(STATE.OPEN);
    });
  });

  test('menu mode outranks the schedule, because it never took orders', () => {
    const s = channelState(
      { ...open, mode: 'menu', hours: week() },
      { now: fridayLunch, timeZone: IST }
    );
    expect(s.state).toBe(STATE.MENU_ONLY);
  });

  test('every refusal still carries the mode, so the page can draw the menu', () => {
    for (const now of [fridayLunch, fridayTeatime]) {
      const s = channelState({ ...open, hours: week() }, { now, timeZone: IST });
      expect(s.mode).toBe(MODE.ORDER);
      expect(s.time_zone).toBe(IST);
    }
  });
});
