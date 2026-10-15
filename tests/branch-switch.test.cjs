const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function setup(record, options = {}) {
    const dom = new JSDOM('<div id="header_branch_switcher" hidden><span id="header_current_branch"></span><div id="header_branch_list"></div></div><div id="branch_register_swipe"></div>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(require.resolve('../frontend/static/script/js/jquery.min.js'), 'utf8'));
    const $ = dom.window.jQuery;
    const values = { branch_id_set: 'a', branchname: 'First', ...options.values };
    const calls = [];
    $.fn.modal = function (action) { calls.push(['modal', action]); return this; };
    const PosnicPro = {
        i18n: { t: (_key, fallback) => fallback },
        lazyPhoneInput() {},
        local: { get: key => values[key], set: (key, value) => { values[key] = value; } },
        settings: { listBranchName: id => calls.push(['switch', id]) },
        alert: (type, message) => calls.push(['alert', type, message])
    };
    const context = { PosnicPro, $, document: dom.window.document, billingWindowId: options.windowId, db: { currentregister: { get: () => options.fail ? Promise.reject(Error('unavailable')) : Promise.resolve(record) } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/static/script/js/modules/js/branches.js'), 'utf8'), context);
    const core = fs.readFileSync(require.resolve('../frontend/static/script/js/core/PosnicPro.js'), 'utf8');
    const method = core.slice(core.indexOf('    renderBranchSwitcher: function'), core.indexOf('    getBranchTaxList: function'));
    vm.runInNewContext('PosnicPro.renderBranchSwitcher = ({' + method + '}).renderBranchSwitcher;', context);
    return { PosnicPro, $, values, calls, dom };
}

test('switch works on a fresh profile without a current-register row', async () => {
    const s = setup(undefined);
    await s.PosnicPro.branches.showChange('b');
    assert.deepEqual(s.calls, [['switch', 'b']]);
    assert.equal(s.values.changebranchid, 'b');
});
test('open register requires the existing close-register flow', async () => {
    for (const [record, values] of [[{ register_status: 'open' }, {}], [undefined, { userRegisterStatus: 'Open' }]]) {
        const s = setup(record, { values });
        await s.PosnicPro.branches.showChange('b');
        assert.deepEqual(s.calls, [['modal', 'show']]);
    }
});
test('register read failure does not silently switch', async () => {
    const s = setup(undefined, { fail: true });
    await s.PosnicPro.branches.showChange('b');
    assert.equal(s.calls[0][0], 'alert');
    assert.equal(s.calls.some(c => c[0] === 'switch'), false);
});
test('current branch is a no-op and branch-bound windows cannot switch', async () => {
    const s = setup({ register_status: 'close' });
    await s.PosnicPro.branches.showChange('a');
    assert.equal(s.calls.length, 0);
    const bound = setup(undefined, { windowId: 'window-1' });
    await bound.PosnicPro.branches.showChange('b');
    assert.equal(bound.calls[0][0], 'alert');
});
test('header lists assigned branches safely, marks current and switches selected branch', async () => {
    const s = setup({ register_status: 'close' });
    s.PosnicPro.renderBranchSwitcher([{ id: 'a', branch_name: 'First' }, { id: 'b', branch_name: '<img src=x onerror=alert(1)>' }]);
    assert.equal(s.$('#header_branch_switcher').prop('hidden'), false);
    assert.equal(s.$('#header_branch_list button').length, 2);
    assert.equal(s.$('#header_branch_list img').length, 0);
    assert.equal(s.$('#header_branch_list button').first().attr('aria-current'), 'true');
    s.$('#header_branch_list button').last().trigger('click');
    await Promise.resolve();
    assert.deepEqual(s.calls, [['switch', 'b']]);
    s.values.branch_id_set = 'b';
    s.PosnicPro.renderBranchSwitcher([{ id: 'a', branch_name: 'First' }, { id: 'b', branch_name: 'Second' }]);
    assert.equal(s.$('#header_current_branch').text(), 'Second');
});
test('single-branch users and branch-bound windows have no switcher', () => {
    const s = setup(undefined);
    s.PosnicPro.renderBranchSwitcher([{ id: 'a', branch_name: 'First' }, { id: 'a', branch_name: 'First' }]);
    assert.equal(s.$('#header_branch_switcher').prop('hidden'), true);
    const bound = setup(undefined, { windowId: 'window-1' });
    bound.PosnicPro.renderBranchSwitcher([{ id: 'a' }, { id: 'b' }]);
    assert.equal(bound.$('#header_branch_switcher').prop('hidden'), true);
});
