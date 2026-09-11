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
  defaultConfig,
  isOpenAt,
  storefront,
  hasStoreId,
  itemAvailability,
  normalizeDayparts,
  nextOpeningFrom,
  normalizeFulfilment,
  normalizeHours,
  normalizeMode,
  normalizeSettings,
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

describe('storefront', () => {
  test('reads the channel off a branch', () => {
    const branch = { online_ordering: { store_id: 'SHOP1', mode: 'order' } };
    expect(storefront(branch).store_id).toBe('SHOP1');
    expect(hasStoreId(storefront(branch))).toBe(true);
  });

  test('a branch with no channel has none', () => {
    expect(storefront({})).toBeNull();
    expect(storefront({ online_ordering: null })).toBeNull();
    expect(hasStoreId(null)).toBe(false);
  });

  /*
   * THE SHAPE THAT COST AN OUTAGE.
   *
   * This lived in `branch.kiosk` as an array of one, matched by a branch_id
   * stored inside a document that was already that branch. The order endpoint
   * read it as an object, `branch.kiosk.store_id`, which is `undefined` on an
   * array - so it refused every order ever placed against this API, and the
   * unit test agreed with the reader that was wrong.
   *
   * An array arriving here now is not a shape to tolerate, it is a bug to
   * surface. Nothing writes one.
   */
  test('an array is not a channel, whatever is in it', () => {
    expect(storefront({ online_ordering: [{ store_id: 'SHOP1' }] })).toBeNull();
    expect(storefront({ online_ordering: [] })).toBeNull();
  });

  test('a channel with no store address has not opted in', () => {
    expect(hasStoreId({ store_id: '   ' })).toBe(false);
    expect(hasStoreId({ mode: 'order' })).toBe(false);
  });
});

describe('normalizeFulfilment', () => {
  /*
   * The field that lets one channel serve a restaurant and a clothes shop
   * without a "restaurant mode" anywhere in the code.
   */
  test('keeps known types in a fixed order, whatever order they arrive in', () => {
    expect(normalizeFulfilment(['delivery', 'dine_in'])).toEqual(['dine_in', 'delivery']);
  });

  test('drops duplicates and anything it does not recognise', () => {
    expect(normalizeFulfilment(['pickup', 'pickup', 'teleport'])).toEqual(['pickup']);
  });

  test('an unset list means the pair the page has always offered', () => {
    expect(normalizeFulfilment(undefined)).toEqual(['dine_in', 'takeaway']);
    expect(normalizeFulfilment('delivery')).toEqual(['dine_in', 'takeaway']);
  });

  /* Offering nothing would take no orders at all, which is what menu mode is
     for and is never what an empty list meant. */
  test('an empty list falls back rather than shutting the channel', () => {
    expect(normalizeFulfilment([])).toEqual(['dine_in', 'takeaway']);
    expect(normalizeFulfilment(['nonsense'])).toEqual(['dine_in', 'takeaway']);
  });
});

describe('defaultConfig', () => {
  test('a new branch carries every field, written out', () => {
    /* Sync replaces whole documents, so a field the winning copy does not
       carry is deleted rather than merged, and absent reads the same as the
       default through the API. Writing them out is what makes the setting
       survive an edit on the other side. */
    const config = defaultConfig();
    for (const key of ['store_id', 'mode', 'paused_until', 'hours', 'fulfilment']) {
      expect(Object.prototype.hasOwnProperty.call(config, key)).toBe(true);
    }
    expect(config.mode).toBe(MODE.ORDER);
    expect(config.paused_until).toBeNull();
    expect(config.hours).toBeNull();
  });

  test('two branches do not share one array', () => {
    /* A frozen module-level default handed out by reference would let one
       shop's edit reach every shop created since the process booted. */
    const a = defaultConfig();
    const b = defaultConfig();
    a.fulfilment.push('delivery');
    expect(b.fulfilment).toEqual(['dine_in', 'takeaway']);
  });
});

describe('normalizeSettings', () => {
  test('returns only what the caller sent', () => {
    expect(normalizeSettings({ mode: 'menu' })).toEqual({ mode: 'menu' });
    expect(normalizeSettings({})).toEqual({});
  });

  test('clears a pause when asked to resume', () => {
    expect(normalizeSettings({ paused_until: null }).paused_until).toBeNull();
    expect(normalizeSettings({ paused_until: '' }).paused_until).toBeNull();
  });

  test('refuses a pause it cannot read rather than storing rubbish', () => {
    expect(() => normalizeSettings({ paused_until: 'whenever' })).toThrow(/valid date/);
  });

  test('clock strings become minutes past midnight', () => {
    const out = normalizeSettings({ hours: { mon: [{ open: '11:00', close: '15:00' }] } });
    expect(out.hours.mon).toEqual([{ open: 660, close: 900 }]);
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

describe('serving periods', () => {
  const BREAKFAST = {
    id: 'breakfast',
    name: 'Breakfast',
    hours: { mon: [{ open: '07:00', close: '11:00' }] },
  };
  const DINNER = {
    id: 'dinner',
    name: 'Dinner',
    hours: { mon: [{ open: '19:00', close: '01:00' }] },
  };
  const PARTS = [BREAKFAST, DINNER];
  const MON = 1;
  const TUE = 2;

  test('a dish in no period is served all day', () => {
    /* Most of a menu. The cost of this feature must fall only on the dishes
       that actually need it. */
    expect(itemAvailability({}, PARTS, MON, 16 * 60)).toEqual({ available: true, periods: [] });
    expect(itemAvailability({ daypart_ids: [] }, PARTS, MON, 16 * 60).available).toBe(true);
  });

  test('a breakfast dish is on at breakfast and off at teatime', () => {
    expect(itemAvailability({ daypart_ids: ['breakfast'] }, PARTS, MON, 8 * 60).available).toBe(
      true
    );
    expect(itemAvailability({ daypart_ids: ['breakfast'] }, PARTS, MON, 16 * 60).available).toBe(
      false
    );
  });

  /* Why it names the period: an unexplained grey card reads as "they have run
     out", where "Breakfast only" is a reason to come back. */
  test('an unavailable dish still says when it is served', () => {
    expect(itemAvailability({ daypart_ids: ['breakfast'] }, PARTS, MON, 16 * 60).periods).toEqual([
      'Breakfast',
    ]);
  });

  test('a period that runs past midnight is still on after midnight', () => {
    /* Dinner 19:00-01:00 on Monday is being served at 00:30 on Tuesday. Same
       arithmetic as a bar's opening hours, and the same trap. */
    expect(itemAvailability({ daypart_ids: ['dinner'] }, PARTS, TUE, 30).available).toBe(true);
  });

  test('a dish in two periods needs only one of them to be on', () => {
    const both = { daypart_ids: ['breakfast', 'dinner'] };
    expect(itemAvailability(both, PARTS, MON, 8 * 60).available).toBe(true);
    expect(itemAvailability(both, PARTS, MON, 20 * 60).available).toBe(true);
    expect(itemAvailability(both, PARTS, MON, 16 * 60).available).toBe(false);
  });

  /* A dish pointing only at deleted periods must not become unorderable for
     ever - that is a dish nothing can ever serve. */
  test('a dish pointing at a period the shop deleted is served all day', () => {
    expect(itemAvailability({ daypart_ids: ['brunch'] }, PARTS, MON, 16 * 60).available).toBe(true);
  });

  test('a period with no hours set is on rather than silently off', () => {
    /* Half-configured must not take dishes off the menu: "we have not set the
       times yet" is far more common than "this is never served". */
    const vague = [{ id: 'allday', name: 'All day' }];
    expect(itemAvailability({ daypart_ids: ['allday'] }, vague, MON, 3 * 60).available).toBe(true);
  });

  describe('normalizeDayparts', () => {
    test('keeps id, name and a normalised week', () => {
      const [p] = normalizeDayparts([
        { id: 'Breakfast', name: 'Breakfast', hours: { mon: [{ open: '07:00', close: '11:00' }] } },
      ]);
      expect(p.id).toBe('breakfast');
      expect(p.hours.mon).toEqual([{ open: 420, close: 660 }]);
    });

    test('drops anything with no id or no name, and any duplicate', () => {
      expect(normalizeDayparts([{ name: 'No id' }])).toEqual([]);
      expect(normalizeDayparts([{ id: 'a', name: '' }])).toEqual([]);
      expect(
        normalizeDayparts([
          { id: 'a', name: 'A' },
          { id: 'a', name: 'Again' },
        ])
      ).toHaveLength(1);
    });

    test('a non-list is no periods', () => {
      expect(normalizeDayparts(null)).toEqual([]);
      expect(normalizeDayparts('breakfast')).toEqual([]);
    });
  });
});
