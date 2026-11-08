/* Header search combines permitted menu destinations with scoped business records. */
(function () {
  'use strict';

  function aclCan(module, perm) {
    var u = PosnicPro.userACL;
    return !!(u && u[module] && u[module][perm] === true);
  }

  /* name, hash, acl [module, perm], keywords for matching */
  var PAGES = [
    ['New Sale', 'sales/new', ['sales', 'write'], 'bill billing pos sell tender'],
    ['Sales History', 'sales', ['sales', 'read'], 'invoices orders list'],
    ['Sales Report', 'salereport', ['report', 'read'], 'graph analytics'],
    ['Items', 'items', ['item', 'read'], 'products stock inventory'],
    ['Add Item', 'items/new', ['item', 'write'], 'product create'],
    ['Item Report', 'itemreport', ['report', 'read'], 'product analytics'],
    ['Low Stock', 'lowstock', ['item', 'read'], 'reorder empty'],
    ['Stock Logs', 'stocklogs', ['branch', 'write'], 'movements audit'],
    ['Categories', 'categories', ['category', 'read'], 'groups'],
    ['Customers', 'customers', ['customer', 'read'], 'clients'],
    ['Add Customer', 'customers/new', ['customer', 'write'], 'client'],
    ['Customer Report', 'customerreport', ['customer', 'read'], 'analytics'],
    ['Suppliers', 'suppliers', ['supplier', 'read'], 'vendors'],
    ['Add Supplier', 'suppliers/new', ['supplier', 'write'], 'vendor create'],
    ['Supplier Report', 'supplierreport', ['report', 'read'], 'vendor analytics'],
    ['Receivings', 'receivings', ['receiving', 'read'], 'purchases grn'],
    ['New Purchase', 'receivings/new', ['receiving', 'write'], 'purchase'],
    ['Receiving Report', 'receivingreport', ['report', 'read'], 'purchase analytics'],
    ['Expenses', 'expenses', ['expense', 'read'], 'costs spend'],
    ['Add Expense', 'expenses/new', ['expense', 'write'], 'cost create'],
    ['Users', 'users', ['user', 'read'], 'staff team'],
    ['Add User', 'users/new', ['user', 'write'], 'staff create'],
    ['Staff Report', 'userreport', ['report', 'read'], 'user analytics'],
    ['Cash Register', 'registers', ['sales', 'read'], 'till drawer open close denomination'],
    [
      'Billing outlets',
      'billingoutlets',
      ['sales', 'read'],
      'bar restaurant room service windows daily summary handover',
    ],
    ['Register Report', 'registerreport', ['report', 'read'], 'till sessions'],
    ['Branches', 'branches', ['branch', 'read'], 'outlets stores'],
    ['Roles', 'roles', ['user', 'write'], 'permissions access'],
    ['Settings', 'settings', ['branch', 'write'], 'configuration preferences modules'],
    ['Dashboard', 'dashboard', ['dashboard', 'read'], 'home overview charts'],
  ];

  var ACTIONS = [
    {
      name: 'Help & feedback',
      nameKey: 'lang_help_feedback',
      keywords: 'help feedback complaint suggestion customization customisation custom work request support contact email problem',
      visible: function () {
        return !!document.getElementById('posnic_feedback_dialog');
      },
      run: function () {
        $('#posnic_feedback_dialog').modal('show');
      },
    },
    {
      name: 'Clock In / Out',
      keywords: 'shift attendance tips',
      visible: function () {
        return !!(PosnicPro.shiftWidget && PosnicPro.shiftWidget.openWidget);
      },
      run: function () {
        PosnicPro.shiftWidget.openWidget();
      },
    },
    {
      name: 'Labour / Payout Report',
      keywords: 'payroll wages hours staff',
      visible: function () {
        return aclCan('user', 'read') && !!(PosnicPro.shiftWidget && PosnicPro.shiftWidget.openReport);
      },
      run: function () {
        PosnicPro.shiftWidget.openReport();
      },
    },
    {
      name: 'About Posnic',
      keywords: 'version build cache info support help about this till',
      visible: function () {
        return !!PosnicPro.versionBadge;
      },
      run: function () {
        PosnicPro.versionBadge.show();
      },
    },
    {
      /* The cache doctor (SW roadmap W3): one click instead of the
               "clear site data" support walk-through. Unregisters the
               worker, empties every cache, reloads - the page comes back on
               plain network and re-registers a fresh worker. */
      name: 'Refresh App Cache',
      keywords: 'clear cache stale doctor reload service worker fix',
      visible: function () {
        return true;
      },
      run: function () {
        var done = function () {
          window.location.reload();
        };
        try {
          var work = [];
          if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            work.push(
              navigator.serviceWorker.getRegistrations().then(function (regs) {
                return Promise.all(
                  regs.map(function (r) {
                    return r.unregister();
                  }),
                );
              }),
            );
          }
          if (window.caches && caches.keys) {
            work.push(
              caches.keys().then(function (keys) {
                return Promise.all(
                  keys.map(function (k) {
                    return caches.delete(k);
                  }),
                );
              }),
            );
          }
          Promise.all(work).then(done, done);
        } catch (e) {
          done();
        }
      },
    },
  ];

  /* Operator vocabulary is shared by every route. Only complete words are folded:
   * a bill number, SKU or phone is always looked up using the original input. */
  const families = [
    ['new', 'add', 'create', 'make'],
    ['sale', 'sales', 'sell', 'selling'],
    ['purchase', 'purchases', 'receiving', 'receivings'],
    ['setting', 'settings', 'setup', 'configure', 'configuration', 'preferences', 'preference'],
    ['customer', 'customers', 'client', 'clients'],
    ['supplier', 'suppliers', 'vendor', 'vendors'],
    ['item', 'items', 'product', 'products'],
    ['report', 'reports', 'analytics'],
    ['invoice', 'invoices'],
    ['quote', 'quotes', 'quotation', 'quotations'],
    ['category', 'categories'],
    ['branch', 'branches', 'outlet', 'outlets'],
    ['price', 'prices', 'pricing'],
    ['stock', 'inventory'],
    ['extension', 'extensions', 'addon', 'addons'],
    ['employee', 'employees', 'staff'],
    ['user', 'users'],
    ['order', 'orders'],
    ['print', 'printing', 'printer', 'printers'],
    ['payment', 'payments'],
    ['tax', 'taxes'],
    ['receipt', 'receipts'],
    ['bill', 'bills', 'billing'],
    ['view', 'show', 'open', 'find'],
    ['edit', 'update', 'change'],
    ['feature', 'features', 'module', 'modules'],
  ];
  const vocabulary = new Map(families.flatMap((words) => words.map((word) => [word, words[0]])));
  function words(text) {
    return (
      String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .match(/[\p{L}\p{M}\p{N}]+/gu) || []
    )
      .filter((word) => !['a', 'an', 'the', 'for', 'of', 'to'].includes(word))
      .map((word) => {
        if (vocabulary.has(word)) return vocabulary.get(word);
        if (/^[a-z]{2,}ies$/.test(word)) return word.slice(0, -3) + 'y';
        if (/^[a-z]{2,}(?:ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
        if (/^[a-z]{3,}s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
        return word;
      });
  }
  function score(query, command) {
    const terms = words(query);
    if (!terms.length) return 0;
    const title = words(command.name);
    if (terms.includes('new') && !command.create) return 0;
    const aliases = words(command.keywords);
    const all = title.concat(aliases, ['view']);
    if (!terms.every((term) => all.some((word) => word === term || word.startsWith(term)))) return 0;
    if (title.join(' ') === terms.join(' ')) return 4;
    return terms.every((term) => title.includes(term)) ? 3 : 2;
  }
  const groupKeys = {
    Sales: 'lang_rgrp_sales',
    Inventory: 'lang_inventory_title',
    Purchases: 'lang_po_title',
    Customers: 'lang_customer_title',
    Reports: 'lang_report_title',
    Extensions: 'lang_extensions',
    Settings: 'lang_settings_title',
    All: 'lang_all_title',
  };
  const kindLabels = {
    sales: 'Sale',
    customers: 'Customer',
    items: 'Item',
    invoices: 'Invoice',
    quotes: 'Quote',
    suppliers: 'Supplier',
    purchaseorders: 'Purchase order',
    receivings: 'Receiving',
  };
  const groupNames = [
    'All',
    'Sales',
    'Inventory',
    'Purchases',
    'Customers',
    'Reports',
    'Settings',
    'Extensions',
  ];
  const groups = {
    sales: 'Sales',
    quotes: 'Sales',
    invoices: 'Sales',
    item: 'Inventory',
    category: 'Inventory',
    variant: 'Inventory',
    customer: 'Customers',
    supplier: 'Purchases',
    receiving: 'Purchases',
    extensions: 'Extensions',
  };
  function groupFor(hash, module) {
    if (hash.startsWith('settings') || /settings$/i.test(hash)) return 'Settings';
    if (/report|analytics/i.test(hash) || module === 'report') return 'Reports';
    return groups[module] || 'Settings';
  }
  function allowedLink(link) {
    const permission = link.dataset.access;
    if (permission && !permission.split('||').some((p) => aclCan(link.dataset.module, p))) return false;
    for (let node = link; node && !node.matches('.tab-pane,.dropdown-menu'); node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === 'none') return false;
    }
    return true;
  }
  function commands() {
    const list = new Map();
    for (const [name, hash, acl, keywords] of PAGES) {
      if (!aclCan(...acl)) continue;
      if (hash === 'billingoutlets' && !document.querySelector('#manage_li_billingoutlets a')) continue;
      list.set(hash, { name, hash, keywords, group: groupFor(hash, acl[0]), create: hash.endsWith('/new') });
    }
    const blocked = new Set(),
      permitted = new Set();
    const links = document.querySelectorAll('.vertical-menu a[href^="#/"], .add_dropdown a[href^="#/"]');
    for (const link of links) {
      const hash = link.getAttribute('href').slice(2);
      if (!allowedLink(link)) {
        blocked.add(hash);
        continue;
      }
      permitted.add(hash);
      const old = list.get(hash);
      const label = (link.querySelector('lang') || link).textContent.trim();
      const create = hash.endsWith('/new');
      const name =
        create && old ? old.name : create && link.closest('.add_dropdown') ? 'Add ' + label : label;
      if (!name) continue;
      const group = hash.startsWith('extensions/') ? 'Extensions' : groupFor(hash, link.dataset.module);
      if (
        !hash.includes('/') &&
        aclCan(link.dataset.module, 'write') &&
        typeof PosnicPro[hash]?.showAdd === 'function' &&
        !list.has(hash + '/new')
      ) {
        list.set(hash + '/new', {
          name: 'New ' + label,
          hash: hash + '/new',
          create: true,
          group,
          keywords: 'create ' + hash,
        });
      }
      list.set(hash, {
        hash,
        name,
        create,
        group,
        keywords: [
          old?.keywords,
          old?.name,
          label,
          hash.replace(/[/-]/g, ' '),
          create ? 'new' : '',
          group === 'Settings' ? 'settings edit manage' : '',
        ].join(' '),
      });
    }
    for (const hash of blocked) if (!permitted.has(hash)) list.delete(hash);
    for (const action of ACTIONS)
      if (action.visible()) list.set(action.name, { ...action,
        name: action.nameKey ? PosnicPro.i18n.t(action.nameKey, action.name) : action.name,
        group: 'Settings' });
    for (const label of document.querySelectorAll('#v-pills-tabContent label[for]')) {
      const pane = label.closest('[role=tabpanel][id^="v-pills-"]');
      const control = document.getElementById(label.htmlFor);
      if (!pane || !control || control.type === 'hidden' || control.type === 'password') continue;
      const hash = 'settings/' + pane.id.slice('v-pills-'.length);
      const page = list.get(hash);
      const name = (label.querySelector('lang') || label).textContent.trim();
      if (!page || !name) continue;
      list.set(hash + '@' + control.id, {
        hash,
        control: control.id,
        name,
        group: 'Settings',
        keywords: [page.name, 'settings', control.id.replace(/_/g, ' ')].join(' '),
      });
    }
    return [...list.values()];
  }
  const requestedSearches = [];
  function rememberTerm(term) {
    const text = term.trim();
    if (!text) return;
    const old = requestedSearches.findIndex((value) => value.toLowerCase() === text.toLowerCase());
    if (old >= 0) requestedSearches.splice(old, 1);
    requestedSearches.unshift(text);
    requestedSearches.splice(5);
  }
  function resetSession() {
    requestedSearches.length = 0;
    historyData = { events: [], records: [] };
    if (opened) close();
  }
  const node = (id) => document.getElementById(id);
  const scope = () =>
    [PosnicPro.local.get('username'), PosnicPro.local.get('branch_id_set'), location.origin].join('|');
  let sequence = 0,
    opened = false,
    tab = 'All',
    selected = 0,
    timer,
    results = [],
    catalog = [],
    previousFocus,
    searchScope,
    historyData = { events: [], records: [] };
  function historyKey(c) {
    return c.control ? c.hash + '@' + c.control : c.hash;
  }
  function renderList(entries) {
    results = entries;
    selected = 0;
    const list = node('cmdk-list');
    list.replaceChildren();
    let section = '';
    entries.forEach((entry, i) => {
      if (entry.section && entry.section !== section) {
        section = entry.section;
        const heading = document.createElement('div');
        heading.className = 'cmdk-section';
        heading.textContent = section;
        list.append(heading);
      }
      const row = document.createElement('div');
      row.className = 'cmdk-item';
      row.id = 'cmdk-option-' + i;
      row.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = entry.name;
      row.append(label);
      const kind = document.createElement('span');
      kind.className = 'cmdk-kind';
      kind.textContent =
        kindLabels[entry.kind] ||
        entry.kind ||
        (entry.create
          ? PosnicPro.i18n.t('lang_action', 'Action')
          : PosnicPro.i18n.t(groupKeys[entry.group], entry.group));
      row.append(kind);
      row.addEventListener('click', () => pick(entry));
      list.append(row);
    });
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'cmdk-empty';
      empty.textContent = 'No matches';
      list.append(empty);
    }
    highlight();
  }
  function highlight() {
    node('cmdk-list')
      .querySelectorAll('[role=option]')
      .forEach((row, i) => {
        row.classList.toggle('cmdk-active', i === selected);
        row.setAttribute('aria-selected', String(i === selected));
      });
    if (results.length) node('cmdk-input').setAttribute('aria-activedescendant', 'cmdk-option-' + selected);
    else node('cmdk-input').removeAttribute('aria-activedescendant');
  }
  function recent() {
    const candidates = new Map(
      [...catalog, ...historyData.records]
        .filter((c) => tab === 'All' || c.group === tab)
        .map((c) => [historyKey(c), c]),
    );
    const uses = new Map();
    for (const e of [...historyData.events].reverse()) {
      if (candidates.has(e.hash)) uses.set(e.hash, (uses.get(e.hash) || 0) + 1);
    }
    const keys = [...uses.keys()].slice(0, 5);
    const frequent = [...uses.keys()]
      .filter((k) => !keys.includes(k) && uses.get(k) >= 2)
      .sort((a, b) => uses.get(b) - uses.get(a))
      .slice(0, 3);
    const entries = keys
      .map((k) => ({ ...candidates.get(k), section: 'Recent searches' }))
      .concat(frequent.map((k) => ({ ...candidates.get(k), section: 'Frequently opened' })));
    const repeated =
      tab === 'All'
        ? requestedSearches.map((term) => ({
            name: /^[+\d() .-]{7,}$/.test(term) ? 'Lookup ending ' + term.replace(/\D/g, '').slice(-4) : term,
            query: term,
            kind: 'Search',
            section: 'Recent searches',
          }))
        : [];
    const recentEntries = [...repeated, ...entries.filter((e) => e.section === 'Recent searches')].slice(
      0,
      5,
    );
    const shown = [...recentEntries, ...entries.filter((e) => e.section === 'Frequently opened')];
    return shown.length ? shown : [...candidates.values()].filter((c) => c.create).slice(0, 5);
  }
  function recordPage(q, page) {
    clearTimeout(timer);
    const version = ++sequence;
    PosnicPro.post(
      { url: 'search', data: JSON.stringify({ q, page, group: tab === 'All' ? '' : tab }) },
      (r) => {
        if (!opened || version !== sequence || searchScope !== scope()) return;
        renderList((r.data.results || []).concat(pageLinks(r.data.more)));
        node('cmdk-status').textContent = r.data.partial ? 'Some records are unavailable' : '';
      },
      () => {
        if (version === sequence) node('cmdk-status').textContent = 'Record search unavailable';
      },
    );
  }
  function pageLinks(pages) {
    return (pages || []).map((page) => ({
      name: 'More ' + page.type + (page.mode === 'name' ? ' by name' : ''),
      kind: 'More',
      page,
    }));
  }
  function render() {
    clearTimeout(timer);
    const version = ++sequence;
    const q = node('cmdk-input').value.trim();
    node('cmdk-status').textContent = '';
    const local = catalog
      .filter((c) => tab === 'All' || c.group === tab)
      .map((c) => ({ ...c, rank: score(q, c) }))
      .filter((c) => c.rank)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 12);
    renderList(q ? local : recent());
    if ((q.length < 2 && !/^\d$/.test(q)) || ['Reports', 'Settings'].includes(tab)) return;
    timer = setTimeout(() => {
      function current() {
        return opened && version === sequence && searchScope === scope();
      }
      PosnicPro.post(
        { url: 'search', data: JSON.stringify({ q, group: tab === 'All' ? '' : tab }) },
        (r) => {
          if (!current()) return;
          const data = r.data || {};
          const records = data.results || [];
          const terms = words(q);
          const navigation = terms.some((term) => ['new', 'setting', 'report', 'list'].includes(term));
          const ranked = navigation ? local.concat(records) : records.concat(local);
          const seen = new Set();
          const items = ranked.filter((item) => {
            const key = historyKey(item) || item.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          renderList(items.concat(pageLinks(data.more)));
          if (data.partial) node('cmdk-status').textContent = 'Some records are unavailable';
        },
        () => {
          if (current()) node('cmdk-status').textContent = 'Record search unavailable';
        },
      );
    }, 200);
  }
  function focusControl(entry) {
    let attempts = 0;
    const handle = setInterval(() => {
      if (++attempts > 35 || location.hash.replace(/^#\/?/, '') !== entry.hash) {
        clearInterval(handle);
        return;
      }
      const field = node(entry.control);
      if (!field || !field.closest('.tab-pane.active')) return;
      const pane = field.closest('.tab-pane');
      if (pane && !pane.classList.contains('active')) {
        const trigger = document.querySelector('a[href="#' + CSS.escape(pane.id) + '"]');
        if (trigger) $(trigger).tab('show');
      }
      if (!field.getClientRects().length) return;
      clearInterval(handle);
      field.scrollIntoView({ block: 'center' });
      field.focus({ preventScroll: true });
    }, 80);
  }
  function pick(entry) {
    if (searchScope !== scope()) {
      close();
      return;
    }
    if (entry.page) {
      recordPage(node('cmdk-input').value.trim(), entry.page);
      return;
    }
    if (entry.query) {
      node('cmdk-input').value = entry.query;
      render();
      node('cmdk-input').focus();
      return;
    }
    if (entry.hash) {
      if (!entry.kind && !entry.extension && !commands().some((c) => historyKey(c) === historyKey(entry)))
        return;
      if (entry.kind && /^[a-z]+\/[a-f0-9]{24}$/.test(entry.hash) && !entry.resolved) {
        const version = sequence;
        PosnicPro.post(
          {
            url: 'search/resolve',
            data: JSON.stringify({ ref: entry.hash }),
            quietStatuses: [403, 404, 503],
          },
          (r) => {
            if (opened && sequence === version && scope() === searchScope && r.data?.hash === entry.hash)
              pick({ ...r.data, resolved: true });
          },
          () => {
            if (opened && sequence === version)
              node('cmdk-status').textContent = 'This record is unavailable';
          },
        );
        return;
      }
      if (!entry.kind && !entry.control) rememberTerm(node('cmdk-input').value);
      PosnicPro.post(
        {
          url: 'search/history',
          data: JSON.stringify({
            hash: historyKey(entry),
            generation: historyData.generation || 0,
            eventId: window.crypto?.randomUUID?.(),
          }),
        },
        () => {},
        () => {},
      );
      close();
      hasher.setHash(entry.hash);
      if (entry.control) focusControl(entry);
    } else if (entry.run) {
      close();
      entry.run();
    }
  }
  function dismiss() {
    const dialog = node('cmdk-overlay');
    if (!dialog?.open || dialog.classList.contains('cmdk-closing')) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      close();
      return;
    }
    dialog.classList.add('cmdk-closing');
    setTimeout(() => {
      if (dialog.classList.contains('cmdk-closing')) close();
    }, 145);
  }
  function close() {
    node('cmdk-overlay')?.classList.remove('cmdk-closing');
    opened = false;
    sequence++;
    clearTimeout(timer);
    if (node('cmdk-overlay')?.open) node('cmdk-overlay').close();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function ensureDom() {
    if (node('cmdk-overlay')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'cmdk-overlay';
    dialog.setAttribute('aria-label', 'Search POSNIC');
    dialog.innerHTML =
      '<div id="cmdk-box"><div class="cmdk-field"><input id="cmdk-input" type="search" maxlength="96" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-label="Search POSNIC" data-t-aria-label="lang_search_posnic" placeholder="Search POSNIC" data-t-placeholder="lang_search_posnic"><button type="button" id="cmdk-close" aria-label="Close search" data-t-aria-label="lang_close_search">×</button></div><div id="cmdk-tabs"></div><div id="cmdk-list" role="listbox"></div><div id="cmdk-status" role="status"></div><div id="cmdk-hint">↑ ↓ Select · Enter Open · Esc Close <button type="button" id="cmdk-clear"><lang class="lang_clear_history">Clear history</lang></button></div></div>';
    document.body.append(dialog);
    for (const name of groupNames) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.group = name;
      b.textContent = PosnicPro.i18n.t(groupKeys[name], name);
      b.onclick = () => {
        tab = name;
        refreshTabs();
        render();
        node('cmdk-input').focus();
      };
      node('cmdk-tabs').append(b);
    }
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      dismiss();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dismiss();
    });
    node('cmdk-close').onclick = dismiss;
    node('cmdk-clear').onclick = () => {
      const owner = searchScope;
      PosnicPro.delete({ url: 'search/history' }, (r) => {
        if (opened && searchScope === owner) {
          requestedSearches.length = 0;
          historyData = { events: [], records: [], generation: r.data?.generation || 0 };
          render();
        }
      });
    };
    node('cmdk-input').oninput = render;
    node('cmdk-input').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (results[selected]) pick(results[selected]);
        else rememberTerm(node('cmdk-input').value);
      }
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        selected = Math.max(0, Math.min(results.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
        highlight();
        node('cmdk-option-' + selected)?.scrollIntoView({ block: 'nearest' });
      }
    };
  }
  function refreshTabs() {
    for (const b of node('cmdk-tabs').children)
      b.setAttribute('aria-pressed', String(tab === b.dataset.group));
  }
  function position() {
    const d = node('cmdk-overlay'),
      r = node('posnic-header-search')?.getBoundingClientRect();
    if (!d) return;
    const width = Math.min(710, window.innerWidth - 24);
    d.style.setProperty('--cmdk-left', Math.max(12, Math.min(r?.left || 16, innerWidth - width - 12)) + 'px');
    d.style.setProperty('--cmdk-top', Math.max(8, r?.top || 20) + 'px');
    d.style.setProperty('--cmdk-start', (r?.width || 140) + 'px');
  }
  let session = 0;
  function open() {
    if (PosnicPro.lockScreen?.isOpen()) return;
    ensureDom();
    if (opened) return;
    if (scope() !== searchScope) resetSession();
    const token = ++session;
    previousFocus = document.activeElement;
    searchScope = scope();
    opened = true;
    tab = 'All';
    refreshTabs();
    position();
    node('cmdk-overlay').showModal();
    node('cmdk-input').value = '';
    node('cmdk-input').focus();
    historyData = { events: [], records: [] };
    catalog = commands();
    render();
    PosnicPro.get(
      { url: 'extensions/v1', quietStatuses: [403, 404] },
      (r) => {
        if (!opened || token !== session || scope() !== searchScope) return;
        for (const ext of r.extensions || []) {
          if (ext.enabled === false || ext.installed === false) continue;
          const hash = 'extensions/' + encodeURIComponent(ext.id);
          for (const page of ext.searchPages || []) {
            catalog.push({
              hash: hash + '/find/' + page.target + '/page',
              name: page.label,
              create: page.action === 'create',
              keywords: [
                ext.displayName,
                ...page.keywords,
                page.action === 'create' ? 'new' : 'settings',
              ].join(' '),
              group: 'Extensions',
              extension: true,
            });
          }
          if (!catalog.some((c) => c.hash === hash))
            catalog.push({
              hash,
              name: ext.displayName || ext.id,
              keywords: 'installed extension ' + ext.id,
              group: 'Extensions',
              extension: true,
            });
        }
        render();
      },
      () => {},
    );
    PosnicPro.get(
      { url: 'search/history' },
      (r) => {
        if (!opened || token !== session || scope() !== searchScope) return;
        historyData = r.data || historyData;
        if (!node('cmdk-input').value) render();
      },
      () => {},
    );
  }
  PosnicPro.palette = { open, close, resetSession, toggle: () => (opened ? close() : open()) };
  document.addEventListener('click', (e) => {
    if (e.target.closest('#posnic-header-search')) open();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!e.repeat) PosnicPro.palette.toggle();
    }
  });
  window.addEventListener('resize', position);
  window.addEventListener('hashchange', () => {
    if (opened) close();
  });
})();
