'use strict';

/*
 * A SHOP CAN TURN THE BUSY-KITCHEN NOTICE OFF.
 *
 * Owner, asked whether this should be configurable: "yes. have configuraiton
 * option."
 *
 * ABSENT IS ON, and that default is the whole of the risk here. The notice
 * already shows on every restaurant running table service, so a key that read
 * as off when unset would switch a shipped behaviour off for every shop on the
 * day it merged - silently, because nobody would have touched a setting.
 *
 * And the string 'false' counts as off. The settings group has carried both
 * real booleans and the strings the old form posted for years, and a reader
 * doing `if (value)` treats stored 'false' as ON. That is the oldest bug in
 * this product's settings and it is why the read is written out rather than
 * left to truthiness.
 */

/*
 * A CLASS, not an instance. item.repository exports the constructor, the way
 * settings.repository does - a trap this codebase has paid for before, because
 * `require(...).method` is undefined rather than an error at require time.
 */
const ItemRepository = require('../../../src/repositories/item.repository');
const SettingsRepository = require('../../../src/repositories/settings.repository');

const repo = new ItemRepository();
const branch = { _id: 'b1', license: 'SHOP-1' };

/** The settings repository answering with one shop's channel values. */
function shopSays(values, { fails = false } = {}) {
  return jest
    .spyOn(SettingsRepository.prototype, 'resolveGroup')
    .mockImplementation(async (group) => {
      if (fails) throw new Error('settings unreachable');
      expect(group).toBe('channels');
      return { status: true, data: { values } };
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('what a shop has asked for', () => {
  test('a shop that has never been asked is shown the notice', async () => {
    /*
     * THE ONE THAT MATTERS. Every restaurant on the product today is in this
     * state, and the answer has to be the behaviour they already have.
     */
    shopSays({});
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(true);
  });

  test('a shop that switched it off is not', async () => {
    shopSays({ online_kitchen_notice: false });
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(false);
  });

  test("and the STRING 'false' is off too", async () => {
    /* The form has posted strings for years. A reader doing `if (value)`
       treats this as ON, which is the failure this line exists to prevent. */
    shopSays({ online_kitchen_notice: 'false' });
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(false);
  });

  test('a shop that switched it back on is shown it', async () => {
    shopSays({ online_kitchen_notice: true });
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(true);
  });

  test("the string 'true' is on, like every other shape that is not false", async () => {
    shopSays({ online_kitchen_notice: 'true' });
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(true);
  });
});

describe('nothing here may cost a shop its menu', () => {
  test('a settings read that fails still shows the notice', async () => {
    /*
     * The safer way round, and deliberately not symmetrical with the rest of
     * this file: a menu that will not load because a settings lookup failed is
     * far worse than a customer seeing a warning the shop meant to hide.
     */
    shopSays({}, { fails: true });
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(true);
  });

  test('a settings read that answers nothing at all still shows it', async () => {
    jest
      .spyOn(SettingsRepository.prototype, 'resolveGroup')
      .mockImplementation(async () => ({ status: false, data: null }));
    await expect(repo.wantsKitchenNotice(branch)).resolves.toBe(true);
  });
});

describe('the switch is wired all the way through', () => {
  /*
   * A setting on this page has to be linked in every one of these or the value
   * is dropped with no error at all. Read from source, because the failure
   * this guards against is a link that was never made rather than one that
   * behaves wrongly.
   */
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..', '..', '..', '..');
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

  test('the key is one the settings group will store', () => {
    const groups = read('api', 'src', 'services', 'settings-groups.js');
    expect(groups).toMatch(/'online_kitchen_notice'/);
  });

  test('the control carries both an id and a name', () => {
    /* Without the name the form does not post it; without the id the script
       above cannot read it. Missing either is silent. */
    const html = read('frontend', 'modules', 'settings_write.html');
    expect(html).toMatch(/id="online_kitchen_notice"/);
    expect(html).toMatch(/name="online_kitchen_notice"/);
    /* Ticked in the markup, so a shop that has never saved sees the state it
       is actually in rather than being told it switched something off. */
    expect(html).toMatch(
      /id="online_kitchen_notice"[^>]*checked|checked[^>]*id="online_kitchen_notice"/
    );
  });

  test('the screen reads it back, with absent meaning ticked', () => {
    const js = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
    expect(js).toMatch(
      /values\.online_kitchen_notice !== false && values\.online_kitchen_notice !== "false"/
    );
  });

  test('the screen saves it, and only when the control is really there', () => {
    /* A screen that never drew the switch must not post a false for it and
       hide a notice the shop never asked to hide. */
    const js = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
    expect(js).toMatch(/if \(\$\("#online_kitchen_notice"\)\.length\) \{/);
    expect(js).toMatch(
      /out\.online_kitchen_notice = \$\("#online_kitchen_notice"\)\.is\(":checked"\)/
    );
  });

  test('the storefront asks before it raises the notice', () => {
    const items = read('api', 'src', 'repositories', 'item.repository.js');
    expect(items).toMatch(/await this\.wantsKitchenNotice\(branchDoc\)/);
  });

  test('the words are in every pack', () => {
    const packs = fs
      .readdirSync(path.join(ROOT, 'languages'))
      .filter((name) => name.endsWith('.json') && !name.startsWith('_'));
    expect(packs.length).toBeGreaterThanOrEqual(17);
    for (const pack of packs) {
      const words = JSON.parse(read('languages', pack));
      expect(words.lang_tell_customers_the_kitchen_is_busy).toBeTruthy();
      expect(words.lang_tell_customers_the_kitchen_is_busy_help).toBeTruthy();
    }
  });
});
