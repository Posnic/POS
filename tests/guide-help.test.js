'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { resolveGuide, pageContext } = require('../frontend/static/script/js/core/guide-help');

const unbranded = { resolved: true, enabled: false, buildEnabled: false };
const commit = 'b1bdb3318dedb505f40b1917f44c229b4d18837d';
const manifest = {
  versions: [{ id: '1.9.2', status: 'released', publicationApproved: true, releaseTag: 'v1.9.2', sourceCommit: commit,
    topics: [{ id: 'settings/onlineordering', status: 'verified', anchors: ['payment'] }] }],
  buildMappings: [{ platform: 'web', page: '1aed5a66', app: '', server: '1.9.2', version: '1.9.2', sourceCommit: commit,
    routes: [{ pattern: '/settings/onlineordering', topic: 'settings/onlineordering' },
      { pattern: '/settings/onlineordering', context: 'payment', topic: 'settings/onlineordering', anchor: 'payment' }] }],
};
const identity = { platform: 'web', page: '1aed5a66', app: '', server: '1.9.2' };

test('exact build and route resolve to a versioned article and explicit tab anchor', () => {
  assert.equal(resolveGuide(unbranded, identity, '#/settings/onlineordering', null, manifest).href,
    '/guide/1.9.2/settings/onlineordering/');
  assert.equal(resolveGuide(unbranded, identity, '#/settings/onlineordering', 'payment', manifest).href,
    '/guide/1.9.2/settings/onlineordering/#payment');
});

test('table-specific KOT routes accept encoded names without leaking them into guide links', () => {
  const restaurantManifest = structuredClone(manifest);
  restaurantManifest.versions[0].topics.push({ id: 'restaurant/kot', status: 'verified' });
  restaurantManifest.buildMappings[0].routes.push(
    { pattern: '/kot/:table_number', topic: 'restaurant/kot' },
    { pattern: '/kotorder/new/:table_number', topic: 'restaurant/kot' },
    { pattern: '/kotorder/new/:table_number/:pax_count', topic: 'restaurant/kot' });
  for (const hash of ['#/kot/Guide%20T1', '#/kotorder/new/Guide%20T1/',
    '#/kotorder/new/%D8%B7%D8%A7%D9%88%D9%84%D8%A9/2']) {
    const result = resolveGuide(unbranded, identity, hash, null, restaurantManifest);
    assert.equal(result.href, '/guide/1.9.2/restaurant/kot/');
    assert.equal(result.kind, 'article');
  }
  for (const hash of ['#/kot/%2e%2e', '#/kot/Guide%2FT1', '#/kot/Guide%5CT1', '#/kot/%bad']) {
    assert.equal(resolveGuide(unbranded, identity, hash, null, restaurantManifest).kind, 'library');
  }
});

test('printable-menu tab uses its own guide while other Restaurant tabs retain page help', () => {
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/modules/settings_write.html'), 'utf8');
  assert.match(markup, /id="v-pills-tableorder" data-guide-route="\/settings\/tableorder"/);
  assert.match(markup, /id="restaurantprintmenu-tab-line"[^>]*data-guide-context="restaurant:printable-menu"/);
  let printableTabActive = false;
  const owner = {
    getAttribute: (name) => name === 'data-guide-route' ? '/settings/tableorder' : null,
    querySelector: () => printableTabActive ? { getAttribute: () => 'restaurant:printable-menu' } : null,
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const restaurantManifest = structuredClone(manifest);
  restaurantManifest.versions[0].topics.push({ id: 'restaurant/tables', status: 'verified' },
    { id: 'restaurant/menu', status: 'verified' });
  restaurantManifest.buildMappings[0].routes.push(
    { pattern: '/settings/tableorder', topic: 'restaurant/tables' },
    { pattern: '/settings/tableorder', context: 'restaurant:printable-menu', topic: 'restaurant/menu' });
  const href = () => resolveGuide(unbranded, identity, '#/settings/tableorder',
    pageContext(doc, '/settings/tableorder'), restaurantManifest).href;
  assert.equal(href(), '/guide/1.9.2/restaurant/tables/');
  printableTabActive = true;
  assert.equal(href(), '/guide/1.9.2/restaurant/menu/');
  restaurantManifest.versions[0].topics.find((topic) => topic.id === 'restaurant/menu').status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
});

test('Tax subtabs resolve Rates and Groups help while General keeps the page guide', () => {
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/modules/settings_write.html'), 'utf8');
  assert.match(markup, /id="v-pills-taxmodule"[^>]*data-guide-route="\/settings\/taxmodule"/);
  assert.match(markup, /href="#tax-sub-rates"[^>]*data-guide-context="tax:rates"/);
  assert.match(markup, /href="#tax-sub-groups"[^>]*data-guide-context="tax:groups"/);
  let active = null;
  const owner = {
    getAttribute: name => name === 'data-guide-route' ? '/settings/taxmodule' : null,
    querySelector: () => active ? { getAttribute: () => active } : null,
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const taxManifest = structuredClone(manifest);
  taxManifest.versions[0].topics.push(
    { id: 'settings/taxmodule', status: 'verified' },
    { id: 'settings/taxmodule/rates', status: 'verified' },
    { id: 'settings/taxmodule/groups', status: 'verified' });
  taxManifest.buildMappings[0].routes.push(
    { pattern: '/settings/taxmodule', topic: 'settings/taxmodule' },
    { pattern: '/settings/taxmodule', context: 'tax:rates', topic: 'settings/taxmodule/rates' },
    { pattern: '/settings/taxmodule', context: 'tax:groups', topic: 'settings/taxmodule/groups' });
  const href = () => resolveGuide(unbranded, identity, '#/settings/taxmodule',
    pageContext(doc, '/settings/taxmodule'), taxManifest).href;
  assert.equal(href(), '/guide/1.9.2/settings/taxmodule/');
  active = 'tax:rates';
  assert.equal(href(), '/guide/1.9.2/settings/taxmodule/rates/');
  active = 'tax:groups';
  assert.equal(href(), '/guide/1.9.2/settings/taxmodule/groups/');
  taxManifest.versions[0].topics.find(topic => topic.id === 'settings/taxmodule/groups').status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
  assert.equal(pageContext(doc, '/settings/general'), null);
});

test('Integrations subtabs select their own exact-build help without cross-route leakage', () => {
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/modules/settings_write.html'), 'utf8');
  assert.match(markup, /id="v-pills-integrations"[^>]*data-guide-route="\/settings\/integrations"/);
  for (const [tab, context] of [['tokens', 'tokens'], ['webhooks', 'webhooks'],
    ['connectors', 'connectors'], ['analytics', 'analytics']]) {
    assert.match(markup, new RegExp('href="#int-sub-' + tab + '"[^>]*data-guide-context="integrations:' + context + '"'));
  }
  let active = 'integrations:tokens';
  const owner = {
    getAttribute: name => name === 'data-guide-route' ? '/settings/integrations' : null,
    querySelector: () => ({ getAttribute: () => active }),
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const integrationManifest = structuredClone(manifest);
  const topics = ['tokens', 'webhooks', 'connectors', 'analytics'];
  integrationManifest.versions[0].topics.push(...topics.map(id =>
    ({ id: 'settings/integrations/' + id, status: 'verified' })));
  integrationManifest.buildMappings[0].routes.push(...topics.map(id =>
    ({ pattern: '/settings/integrations', context: 'integrations:' + id,
      topic: 'settings/integrations/' + id })));
  const href = () => resolveGuide(unbranded, identity, '#/settings/integrations',
    pageContext(doc, '/settings/integrations'), integrationManifest).href;
  for (const id of topics) {
    active = 'integrations:' + id;
    assert.equal(href(), '/guide/1.9.2/settings/integrations/' + id + '/');
  }
  integrationManifest.versions[0].topics.find(topic => topic.id === 'settings/integrations/webhooks').status = 'draft';
  active = 'integrations:webhooks';
  assert.equal(href(), '/guide/1.9.2/');
  assert.equal(pageContext(doc, '/settings/taxmodule'), null);
});

test('Marketing subtabs select separate guides only with a verified exact-build mapping', () => {
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/modules/settings_write.html'), 'utf8');
  assert.match(markup, /id="v-pills-marketingmodule"[^>]*data-guide-route="\/settings\/marketingmodule"/);
  const tabs = ['loyalty', 'coupons', 'cashback', 'campaigns', 'pricing'];
  for (const tab of tabs) {
    assert.match(markup, new RegExp('href="#mkt-sub-' + tab + '"[^>]*data-guide-context="marketing:' + tab + '"'));
  }
  let active = 'marketing:loyalty';
  const owner = {
    getAttribute: name => name === 'data-guide-route' ? '/settings/marketingmodule' : null,
    querySelector: () => ({ getAttribute: () => active }),
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const marketingManifest = structuredClone(manifest);
  marketingManifest.versions[0].topics.push(...tabs.map(id =>
    ({ id: 'settings/marketingmodule/' + id, status: 'verified' })));
  marketingManifest.buildMappings[0].routes.push(...tabs.map(id =>
    ({ pattern: '/settings/marketingmodule', context: 'marketing:' + id,
      topic: 'settings/marketingmodule/' + id })));
  const href = () => resolveGuide(unbranded, identity, '#/settings/marketingmodule',
    pageContext(doc, '/settings/marketingmodule'), marketingManifest).href;
  for (const id of tabs) {
    active = 'marketing:' + id;
    assert.equal(href(), '/guide/1.9.2/settings/marketingmodule/' + id + '/');
  }
  marketingManifest.versions[0].topics.find(topic => topic.id.endsWith('/campaigns')).status = 'draft';
  active = 'marketing:campaigns';
  assert.equal(href(), '/guide/1.9.2/');
  assert.equal(pageContext(doc, '/settings/integrations'), null);
});

test('Messaging Help follows the active outer and WhatsApp inner tabs', () => {
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/modules/settings_write.html'), 'utf8');
  assert.match(markup, /id="v-pills-messagingmodule"[^>]*data-guide-route="\/settings\/messagingmodule"/);
  for (const [tab, context] of [['providers', 'providers'], ['whatsapp', 'whatsapp'], ['email', 'email']]) {
    assert.match(markup, new RegExp('href="#msg-sub-' + tab + '"[^>]*data-guide-context="messaging:' + context + '"'));
  }
  for (const [tab, context] of [['connection', 'connection'], ['template', 'template'], ['test', 'test']]) {
    assert.match(markup, new RegExp('id="whatsapp-' + tab + '-tab"[^>]*data-guide-context="messaging:whatsapp:' + context + '"'));
  }
  let outer = 'messaging:providers';
  let inner = 'messaging:whatsapp:connection';
  const owner = {
    getAttribute: name => name === 'data-guide-route' ? '/settings/messagingmodule' : null,
    querySelector: selector => selector.startsWith('#messagingmodule_subnav') ?
      { getAttribute: () => outer } : selector.startsWith('#whatsappSubTabs') ?
        { getAttribute: () => inner } : null,
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const messagingManifest = structuredClone(manifest);
  const contexts = ['providers', 'email', 'whatsapp:connection', 'whatsapp:template', 'whatsapp:test'];
  messagingManifest.versions[0].topics.push(...contexts.map(id =>
    ({ id: 'settings/messagingmodule/' + id.replace(':', '/'), status: 'verified' })));
  messagingManifest.buildMappings[0].routes.push(...contexts.map(id =>
    ({ pattern: '/settings/messagingmodule', context: 'messaging:' + id,
      topic: 'settings/messagingmodule/' + id.replace(':', '/') })));
  const href = () => resolveGuide(unbranded, identity, '#/settings/messagingmodule',
    pageContext(doc, '/settings/messagingmodule'), messagingManifest).href;
  assert.equal(href(), '/guide/1.9.2/settings/messagingmodule/providers/');
  outer = 'messaging:email';
  assert.equal(href(), '/guide/1.9.2/settings/messagingmodule/email/');
  outer = 'messaging:whatsapp';
  for (const tab of ['connection', 'template', 'test']) {
    inner = 'messaging:whatsapp:' + tab;
    assert.equal(href(), '/guide/1.9.2/settings/messagingmodule/whatsapp/' + tab + '/');
  }
  messagingManifest.versions[0].topics.find(topic => topic.id.endsWith('/test')).status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
  assert.equal(pageContext(doc, '/settings/integrations'), null);
});

test('current Messaging centre Help follows its section and selected service', () => {
  let section = 'connection';
  let channel = 'whatsapp';
  const centre = {
    querySelector: selector => selector.includes('data-message-tab') ?
      { getAttribute: () => section } : selector.includes('data-message-channel') ?
        { getAttribute: () => channel } : null,
  };
  const owner = {
    getAttribute: name => name === 'data-guide-route' ? '/settings/messagingmodule' : null,
    querySelector: selector => selector === '#message_centre' ? centre :
      selector.startsWith('#messagingmodule_subnav') ? { getAttribute: () => 'messaging:providers' } : null,
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const contexts = ['messaging:connection:whatsapp', 'messaging:connection:sms',
    'messaging:connection:email', 'messaging:automatic', 'messaging:campaigns',
    'messaging:reports', 'messaging:history'];
  const currentManifest = structuredClone(manifest);
  currentManifest.versions[0].topics.push(...contexts.map((context, i) =>
    ({ id: 'messaging/section-' + i, status: 'verified' })));
  currentManifest.buildMappings[0].routes.push(...contexts.map((context, i) =>
    ({ pattern: '/settings/messagingmodule', context, topic: 'messaging/section-' + i })));
  const href = () => resolveGuide(unbranded, identity, '#/settings/messagingmodule',
    pageContext(doc, '/settings/messagingmodule'), currentManifest).href;
  for (const [i, name] of ['whatsapp', 'sms', 'email'].entries()) {
    channel = name;
    assert.equal(pageContext(doc, '/settings/messagingmodule'), 'messaging:connection:' + name);
    assert.equal(href(), '/guide/1.9.2/messaging/section-' + i + '/');
  }
  for (const [i, name] of ['automatic', 'campaigns', 'reports', 'history'].entries()) {
    section = name;
    assert.equal(pageContext(doc, '/settings/messagingmodule'), 'messaging:' + name);
    assert.equal(href(), '/guide/1.9.2/messaging/section-' + (i + 3) + '/');
  }
  currentManifest.versions[0].topics.find(topic => topic.id === 'messaging/section-6').status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
  assert.equal(pageContext(doc, '/settings/integrations'), null);
});

test('white label, unknown brand and mismatched builds never open a guide', () => {
  for (const brand of [{ resolved: true, enabled: true, buildEnabled: false },
    { resolved: false, enabled: false, buildEnabled: false },
    { resolved: true, enabled: false, buildEnabled: true }]) {
    assert.deepEqual(resolveGuide(brand, identity, '#/settings/onlineordering', null, manifest), { visible: false });
  }
  const mismatch = resolveGuide(unbranded, { ...identity, page: 'deadbeef' }, '#/settings/onlineordering', null, manifest);
  assert.equal(mismatch.kind, 'unavailable');
  assert.equal(mismatch.href, undefined);
});

test('draft releases and unsafe routes cannot become published links', () => {
  const draft = structuredClone(manifest);
  draft.versions[0].publicationApproved = false;
  assert.equal(resolveGuide(unbranded, identity, '#/settings/onlineordering', null, draft).href, undefined);
  const invalid = resolveGuide(unbranded, identity, '#/settings/%2e%2e/onlineordering?customer=123', null, manifest);
  assert.equal(invalid.href, '/guide/1.9.2/');
  assert.equal(invalid.kind, 'library');
});

test('only the shipped empty manifest is active before article approval', () => {
  const shipped = require('../frontend/static/json/guide-manifest.json');
  assert.deepEqual(shipped.buildMappings, []);
  assert.deepEqual(shipped.versions, []);
  assert.equal(resolveGuide(unbranded, identity, '#/settings/onlineordering', null, shipped).href, undefined);
});

test('an open feature detail resolves its own help without changing the Features route', () => {
  let active = true;
  let key = 'module_mobile_pos_enable';
  const doc = {
    getElementById: () => ({ classList: { contains: () => active }, getAttribute: () => key }),
    querySelectorAll: () => [],
  };
  const featureManifest = structuredClone(manifest);
  featureManifest.versions[0].topics.push({ id: 'features', status: 'verified' },
    { id: 'features/mobile_pos', status: 'verified' });
  featureManifest.buildMappings[0].routes.push(
    { pattern: '/settings/modules', topic: 'features' },
    { pattern: '/settings/modules', context: 'feature:module_mobile_pos_enable', topic: 'features/mobile_pos' });
  const route = '#/settings/modules';
  assert.equal(pageContext(doc, '/settings/modules'), 'feature:module_mobile_pos_enable');
  assert.equal(resolveGuide(unbranded, identity, route, pageContext(doc, '/settings/modules'), featureManifest).href,
    '/guide/1.9.2/features/mobile_pos/');
  active = false;
  assert.equal(pageContext(doc, '/settings/modules'), null);
  assert.equal(resolveGuide(unbranded, identity, route, pageContext(doc, '/settings/modules'), featureManifest).href,
    '/guide/1.9.2/features/');
  active = true;
  key = '../unsafe';
  assert.equal(pageContext(doc, '/settings/modules'), null);
  assert.equal(pageContext(doc, '/settings/onlineordering'), null);
});

test('item modals select their own guide context and restore Items help when closed', () => {
  let labelsOpen = false;
  let importOpen = false;
  const modal = (open) => ({ classList: { contains: (name) => name === 'show' && open() } });
  const doc = {
    getElementById: (id) => id === 'view_print_lable' ? modal(() => labelsOpen) :
      id === 'import_modal' ? modal(() => importOpen) : null,
    querySelectorAll: () => [],
  };
  const itemManifest = structuredClone(manifest);
  itemManifest.versions[0].topics.push(
    { id: 'items', status: 'verified' },
    { id: 'items/labels', status: 'verified' },
    { id: 'items/import', status: 'verified' });
  itemManifest.buildMappings[0].routes.push(
    { pattern: '/items', topic: 'items' },
    { pattern: '/items', context: 'modal:labels', topic: 'items/labels' },
    { pattern: '/items', context: 'modal:items-import', topic: 'items/import' });
  const href = () => resolveGuide(unbranded, identity, '#/items', pageContext(doc, '/items'), itemManifest).href;
  assert.equal(href(), '/guide/1.9.2/items/');
  labelsOpen = true;
  assert.equal(pageContext(doc, '/items'), 'modal:labels');
  assert.equal(href(), '/guide/1.9.2/items/labels/');
  labelsOpen = false;
  importOpen = true;
  assert.equal(pageContext(doc, '/items'), 'modal:items-import');
  assert.equal(href(), '/guide/1.9.2/items/import/');
  assert.equal(pageContext(doc, '/sales/new'), null);
  importOpen = false;
  assert.equal(href(), '/guide/1.9.2/items/');
  itemManifest.versions[0].topics.find((topic) => topic.id === 'items/labels').status = 'draft';
  labelsOpen = true;
  assert.equal(href(), '/guide/1.9.2/');
});

test('an open stock adjustment offers its guide on the dialog route only', () => {
  let open = false;
  const doc = {
    getElementById: (id) => id === 'stock_adjust_modal' ?
      { classList: { contains: (name) => name === 'show' && open } } : null,
    querySelectorAll: () => [],
  };
  const stockManifest = structuredClone(manifest);
  stockManifest.versions[0].topics.push(
    { id: 'inventorycounts', status: 'verified' },
    { id: 'inventory/adjustments', status: 'verified' });
  stockManifest.buildMappings[0].routes.push(
    { pattern: '/inventorycounts', topic: 'inventorycounts' },
    { pattern: '/inventorycounts', context: 'modal:stock-adjustment', topic: 'inventory/adjustments' },
    { pattern: '/items', context: 'modal:stock-adjustment', topic: 'inventory/adjustments' },
    { pattern: '/lowstockitems', context: 'modal:stock-adjustment', topic: 'inventory/adjustments' });
  const href = (route) => resolveGuide(unbranded, identity, `#${route}`, pageContext(doc, route), stockManifest).href;
  assert.equal(href('/inventorycounts'), '/guide/1.9.2/inventorycounts/');
  open = true;
  for (const route of ['/inventorycounts', '/items', '/lowstockitems']) {
    assert.equal(pageContext(doc, route), 'modal:stock-adjustment');
    assert.equal(href(route), '/guide/1.9.2/inventory/adjustments/');
  }
  assert.equal(pageContext(doc, '/sales/new'), null);
  stockManifest.versions[0].topics.find((topic) => topic.id === 'inventory/adjustments').status = 'draft';
  assert.equal(href('/inventorycounts'), '/guide/1.9.2/');
  open = false;
  assert.equal(href('/inventorycounts'), '/guide/1.9.2/inventorycounts/');
});

test('new-item variant choices use their own help only while the editor is visible', () => {
  let checked = false;
  let hidden = true;
  const doc = {
    getElementById: (id) => id === 'iv2-has-variants' ? { checked } :
      id === 'iv2-panel-more' ? { hidden } : null,
    querySelectorAll: () => [],
  };
  const itemManifest = structuredClone(manifest);
  itemManifest.versions[0].topics.push(
    { id: 'items/new', status: 'verified' },
    { id: 'items/variants', status: 'verified' });
  itemManifest.buildMappings[0].routes.push(
    { pattern: '/items/new', topic: 'items/new' },
    { pattern: '/items/new', context: 'item:variants', topic: 'items/variants' });
  const href = () => resolveGuide(unbranded, identity, '#/items/new', pageContext(doc, '/items/new'), itemManifest).href;
  assert.equal(href(), '/guide/1.9.2/items/new/');
  checked = true;
  assert.equal(href(), '/guide/1.9.2/items/new/');
  hidden = false;
  assert.equal(pageContext(doc, '/items/new'), 'item:variants');
  assert.equal(href(), '/guide/1.9.2/items/variants/');
  hidden = true;
  assert.equal(href(), '/guide/1.9.2/items/new/');
  itemManifest.versions[0].topics.find((topic) => topic.id === 'items/variants').status = 'draft';
  hidden = false;
  assert.equal(href(), '/guide/1.9.2/');
});

test('price editing modes resolve file and schedule help only on the active edit tab', () => {
  let editorActive = true;
  let mode = 'file';
  const node = (id) => id === 'ps-grid' ? { classList: { contains: (name) => name === 'active' && editorActive } } :
    id === 'ps-file-tab' || id === 'ps-schedules-tab' ?
      { getAttribute: (name) => name === 'aria-selected' ? String(id === `ps-${mode}-tab`) : null } : null;
  const doc = { getElementById: node, querySelectorAll: () => [] };
  const priceManifest = structuredClone(manifest);
  priceManifest.versions[0].topics.push({ id: 'pricesettings', status: 'verified' },
    { id: 'prices/import', status: 'verified' }, { id: 'prices/schedules', status: 'verified' });
  priceManifest.buildMappings[0].routes.push(
    { pattern: '/pricesettings', topic: 'pricesettings' },
    { pattern: '/pricesettings', context: 'prices:file', topic: 'prices/import' },
    { pattern: '/pricesettings', context: 'prices:schedules', topic: 'prices/schedules' });
  const href = () => resolveGuide(unbranded, identity, '#/pricesettings', pageContext(doc, '/pricesettings'), priceManifest).href;
  assert.equal(pageContext(doc, '/pricesettings'), 'prices:file');
  assert.equal(href(), '/guide/1.9.2/prices/import/');
  mode = 'schedules';
  assert.equal(pageContext(doc, '/pricesettings'), 'prices:schedules');
  assert.equal(href(), '/guide/1.9.2/prices/schedules/');
  mode = 'direct';
  assert.equal(pageContext(doc, '/pricesettings'), null);
  assert.equal(href(), '/guide/1.9.2/pricesettings/');
  mode = 'schedules';
  editorActive = false;
  assert.equal(pageContext(doc, '/pricesettings'), null);
  assert.equal(href(), '/guide/1.9.2/pricesettings/');
  priceManifest.versions[0].topics.find((topic) => topic.id === 'prices/schedules').status = 'draft';
  editorActive = true;
  assert.equal(href(), '/guide/1.9.2/');
});

test('a saved-sale detail resolves receipt help without exposing its record id', () => {
  const saleManifest = structuredClone(manifest);
  saleManifest.versions[0].topics.push(
    { id: 'sales', status: 'verified' },
    { id: 'sales/receipts', status: 'verified' },
    { id: 'sales/returns', status: 'verified' });
  saleManifest.buildMappings[0].routes.push(
    { pattern: '/sales', topic: 'sales' },
    { pattern: '/sales/:id', topic: 'sales/receipts' },
    { pattern: '/sales/:id/return', topic: 'sales/returns' });
  const saleId = '507f1f77bcf86cd799439011';
  assert.equal(resolveGuide(unbranded, identity, '#/sales', null, saleManifest).href,
    '/guide/1.9.2/sales/');
  const detail = resolveGuide(unbranded, identity, `#/sales/${saleId}`, null, saleManifest);
  assert.equal(detail.href, '/guide/1.9.2/sales/receipts/');
  assert.equal(detail.href.includes(saleId), false);
  const returnEditor = resolveGuide(unbranded, identity, `#/sales/${saleId}/return`, null, saleManifest);
  assert.equal(returnEditor.href, '/guide/1.9.2/sales/returns/');
  assert.equal(returnEditor.href.includes(saleId), false);
  saleManifest.versions[0].topics.find((topic) => topic.id === 'sales/receipts').status = 'draft';
  assert.equal(resolveGuide(unbranded, identity, `#/sales/${saleId}`, null, saleManifest).href,
    '/guide/1.9.2/');
  saleManifest.versions[0].topics.find((topic) => topic.id === 'sales/returns').status = 'draft';
  assert.equal(resolveGuide(unbranded, identity, `#/sales/${saleId}/return`, null, saleManifest).href,
    '/guide/1.9.2/');
});

test('an open invoice payment strip resolves payment help and closes back to invoice help', () => {
  let display = 'none';
  const doc = {
    getElementById: (id) => id === 'invoices_pay_strip' ? { style: { display } } : null,
    querySelectorAll: () => [],
  };
  const invoiceManifest = structuredClone(manifest);
  invoiceManifest.versions[0].topics.push(
    { id: 'invoices', status: 'verified' },
    { id: 'invoices/payments', status: 'verified' });
  invoiceManifest.buildMappings[0].routes.push(
    { pattern: '/invoices/:id', topic: 'invoices' },
    { pattern: '/invoices/:id', context: 'invoices:payment', topic: 'invoices/payments' });
  const invoiceId = '507f1f77bcf86cd799439011';
  const href = () => resolveGuide(unbranded, identity, `#/invoices/${invoiceId}`,
    pageContext(doc, `/invoices/${invoiceId}`), invoiceManifest).href;
  assert.equal(href(), '/guide/1.9.2/invoices/');
  display = 'block';
  assert.equal(pageContext(doc, `/invoices/${invoiceId}`), 'invoices:payment');
  assert.equal(href(), '/guide/1.9.2/invoices/payments/');
  assert.equal(href().includes(invoiceId), false);
  display = 'none';
  assert.equal(href(), '/guide/1.9.2/invoices/');
  invoiceManifest.versions[0].topics.find((topic) => topic.id === 'invoices/payments').status = 'draft';
  display = 'block';
  assert.equal(href(), '/guide/1.9.2/');
});

test('new-sale Help targets split payments only while the split tender panel is open', () => {
  let open = false;
  let splitInputs = false;
  const tender = {
    classList: { contains: name => name === 'sidebarview' && open },
    querySelector: selector => selector === '.payment-amount-input' && splitInputs ? {} : null,
  };
  const doc = { getElementById: id => id === 'infobar-settings-sidebar-tender-details' ? tender : null,
    querySelectorAll: () => [] };
  const saleManifest = structuredClone(manifest);
  saleManifest.versions[0].topics.push(
    { id: 'sales/new', status: 'verified' }, { id: 'sales/split_payment', status: 'verified' });
  saleManifest.buildMappings[0].routes.push(
    { pattern: '/sales/new', topic: 'sales/new' },
    { pattern: '/sales/new', context: 'sales:split-payment', topic: 'sales/split_payment' });
  const href = () => resolveGuide(unbranded, identity, '#/sales/new',
    pageContext(doc, '/sales/new'), saleManifest).href;
  assert.equal(pageContext(doc, '/sales/new'), null);
  assert.equal(href(), '/guide/1.9.2/sales/new/');
  splitInputs = true;
  assert.equal(pageContext(doc, '/sales/new'), null, 'hidden tender inputs cannot take over the sale guide');
  open = true;
  assert.equal(pageContext(doc, '/sales/new'), 'sales:split-payment');
  assert.equal(href(), '/guide/1.9.2/sales/split_payment/');
  open = false;
  assert.equal(href(), '/guide/1.9.2/sales/new/');
  open = true;
  splitInputs = false;
  assert.equal(href(), '/guide/1.9.2/sales/new/');
  splitInputs = true;
  saleManifest.versions[0].topics.find(topic => topic.id === 'sales/split_payment').status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
});

test('saved-sale Help targets payment correction only while its method dialog is open', () => {
  let open = false;
  const correction = { classList: { contains: name => name === 'show' && open } };
  const doc = { getElementById: id => id === 'payment-correction' ? correction : null,
    querySelectorAll: () => [] };
  const correctionManifest = structuredClone(manifest);
  correctionManifest.versions[0].topics.push(
    { id: 'sales/receipts', status: 'verified' }, { id: 'sales/payment_correction', status: 'verified' });
  correctionManifest.buildMappings[0].routes.push(
    { pattern: '/sales/:id', topic: 'sales/receipts' },
    { pattern: '/sales/:id', context: 'sales:payment-correction', topic: 'sales/payment_correction' });
  const saleId = '507f1f77bcf86cd799439011';
  const href = () => resolveGuide(unbranded, identity, `#/sales/${saleId}`,
    pageContext(doc, `/sales/${saleId}`), correctionManifest).href;
  assert.equal(href(), '/guide/1.9.2/sales/receipts/');
  open = true;
  assert.equal(pageContext(doc, `/sales/${saleId}`), 'sales:payment-correction');
  assert.equal(href(), '/guide/1.9.2/sales/payment_correction/');
  assert.equal(href().includes(saleId), false);
  assert.equal(pageContext(doc, '/sales/new'), null, 'the same dialog cannot take over a different route');
  open = false;
  assert.equal(href(), '/guide/1.9.2/sales/receipts/');
  open = true;
  correctionManifest.versions[0].topics.find(topic => topic.id === 'sales/payment_correction').status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
});

test('an older brand response cannot restore Posnic help after a newer white-label response', async () => {
  const brandResponses = [];
  let poll;
  let clickHelp;
  let manifestFetches = 0;
  const host = { hidden: true };
  const button = { setAttribute() {}, addEventListener: (type, handler) => {
    if (type === 'click') clickHelp = handler;
  } };
  const message = { hidden: true };
  const doc = {
    getElementById: id => ({ posnic_guide_help_li: host, posnic_guide_help_button: button,
      posnic_guide_help_message: message })[id] || null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const root = {
    document: doc, location: { hash: '#/settings/onlineordering' }, navigator: { userAgent: 'Chrome' },
    PosnicPro: { versionBadge: { read: () => Promise.resolve(identity) } },
    addEventListener() {}, setInterval: callback => { poll = callback; },
    open() { assert.fail('An unmapped build must not open an external guide'); },
    fetch: url => {
      if (url === 'brand.json') return new Promise(resolve => brandResponses.push(resolve));
      assert.equal(url, 'static/json/guide-manifest.json');
      manifestFetches++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ versions: [], buildMappings: [] }) });
    },
  };
  const script = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/static/script/js/core/guide-help.js'), 'utf8');
  vm.runInNewContext(script, { window: root });
  const drain = () => new Promise(resolve => setImmediate(resolve));

  brandResponses.shift()({ ok: true, json: () => Promise.resolve(unbranded) });
  await drain();
  assert.equal(host.hidden, false);
  assert.equal(manifestFetches, 1);
  clickHelp();
  assert.equal(message.hidden, false);
  poll();
  brandResponses.shift()({ ok: true, json: () => Promise.resolve(unbranded) });
  await drain();
  assert.equal(message.hidden, false, 'a routine brand refresh should not close the open Help explanation');

  poll();
  poll();
  assert.equal(brandResponses.length, 2);
  const stale = brandResponses.shift();
  brandResponses.shift()({ ok: true, json: () => Promise.resolve({ resolved: true, enabled: true,
    buildEnabled: false }) });
  await drain();
  assert.equal(host.hidden, true);
  assert.equal(message.hidden, true, 'branding also hides the body-level explanation');
  stale({ ok: true, json: () => Promise.resolve(unbranded) });
  await drain();
  assert.equal(host.hidden, true);
  assert.equal(manifestFetches, 1);
});


test('Core Settings Help follows only the active outer tab and its active payment or print child', () => {
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../frontend/modules/settings_write.html'), 'utf8');
  assert.match(markup, /id="v-pills-general"[^>]*data-guide-route="\/settings\/general"/);
  const tabs = { 'core-tab-sale': 'core:sale', 'core-tab-receiving': 'core:receivings',
    'core-tab-inventory': 'core:inventory', 'core-tab-payments': 'core:payments',
    'core-tab-print': 'core:print', 'core-tab-wording': 'core:wording',
    'pay-sub-modes': 'core:payments:modes', 'pay-sub-gateway': 'core:payments:gateway',
    'pay-sub-denom': 'core:payments:denominations', 'pay-sub-general': 'core:payments:split',
    'print-printers': 'core:print:printers', 'print-design': 'core:print:design' };
  for (const [target, context] of Object.entries(tabs)) {
    assert.ok(markup.includes('href="#' + target + '" data-guide-context="' + context + '"'));
  }
  assert.match(markup, /class="nav nav-tabs print-settings-tabs/);
  let outer = 'core:sale', payment = 'core:payments:modes', print = 'core:print:design';
  const node = value => value ? { getAttribute: () => value } : null;
  const owner = {
    getAttribute: key => key === 'data-guide-route' ? '/settings/general' : null,
    querySelector: selector => selector.startsWith('#core_settings_tabs ') ? node(outer) :
      selector.startsWith('#payments_subnav ') ? node(payment) :
      selector.startsWith('.print-settings-tabs ') ? node(print) : null,
  };
  const doc = { getElementById: () => null, querySelectorAll: () => [owner] };
  const candidate = structuredClone(manifest);
  const targets = { 'core:sale': 'core_settings/sale', 'core:receivings': 'core_settings/receivings',
    'core:inventory': 'core_settings/inventory', 'core:payments': 'core_settings/payments',
    'core:payments:split': 'core_settings/payments', 'core:payments:modes': 'core_settings/payments/modes',
    'core:payments:gateway': 'core_settings/payments/gateway', 'core:payments:denominations': 'core_settings/payments/denominations',
    'core:print': 'core_settings/print', 'core:print:printers': 'core_settings/print', 'core:print:design': 'core_settings/print' };
  for (const topic of new Set(['core_settings', ...Object.values(targets)]))
    candidate.versions[0].topics.push({ id: topic, status: 'verified' });
  candidate.buildMappings[0].routes.push({ pattern: '/settings/general', topic: 'core_settings' });
  for (const [context, topic] of Object.entries(targets))
    candidate.buildMappings[0].routes.push({ pattern: '/settings/general', context, topic });
  const href = () => resolveGuide(unbranded, identity, '#/settings/general',
    pageContext(doc, '/settings/general'), candidate).href;
  assert.equal(href(), '/guide/1.9.2/core_settings/sale/', 'inactive nested tabs cannot override Sale');
  for (const [context, topic] of Object.entries(targets)) {
    if (context.startsWith('core:payments:')) { outer = 'core:payments'; payment = context; }
    else if (context.startsWith('core:print:')) { outer = 'core:print'; print = context; }
    else { outer = context; if (context === 'core:payments') payment = null; if (context === 'core:print') print = null; }
    assert.equal(href(), '/guide/1.9.2/' + topic + '/');
  }
  assert.equal(pageContext(doc, '/settings/taxmodule'), null, 'Core context stays on its owning route');
  outer = null;
  assert.equal(href(), '/guide/1.9.2/core_settings/');
  outer = 'core:wording';
  assert.equal(href(), '/guide/1.9.2/core_settings/', 'unmapped wording uses reviewed page fallback');
  outer = 'core:payments'; payment = 'core:payments:modes';
  candidate.versions[0].topics.find(t => t.id === 'core_settings/payments/modes').status = 'draft';
  assert.equal(href(), '/guide/1.9.2/');
  assert.equal(resolveGuide({ resolved: true, enabled: true, buildEnabled: false }, identity,
    '#/settings/general', 'core:sale', candidate).visible, false);
});


test('Help explanation placement stays within narrow viewports at either header edge', () => {
  const { messagePlacement } = require('../frontend/static/script/js/core/guide-help');
  for (const viewportWidth of [375, 640, 768, 1280]) {
    for (const right of [36, viewportWidth / 2, viewportWidth - 8]) {
      const position = messagePlacement({ top: 48, bottom: 84, right }, viewportWidth, 720, 110);
      assert.ok(position.left >= 8);
      assert.ok(position.left + position.width <= viewportWidth - 8);
      assert.equal(position.top, 91);
    }
  }
  const above = messagePlacement({ top: 650, bottom: 686, right: 600 }, 768, 720, 110);
  assert.equal(above.top, 533);
});
