/*
 * Units - promoted from Core Settings -> Inventory to a first-class page in
 * the Inventory group (owner: "Units also we can move from Core settings to
 * here"). Same API the settings tab used (setting/getUnitAll, addUnit upserts
 * on unit_id, deleteUnit), but the page follows LIST_PAGE_UX_STANDARD.md:
 * the row opens the unit in the right pane, the pane owns Edit/Delete, and
 * the editor is an inline strip IN the pane - no slide-over, no modal.
 */
PosnicPro.units = {
    _page: 1,
    PAGE_SIZE: 25,
    _all: [],
    _filtered: [],
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_units_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#units').show();
        $('.dashboard_img_menu').hide();
    },
    showDataTablePage: function () {
        PosnicPro.units._chrome();
        PosnicPro.units.loadList(1);
    },
    /* Deep link #/units/<id>: the list with that unit open in the pane. */
    showDetails: function (id) {
        if (PosnicPro.listDoc.activeId('units') === String(id)
            && $('#units_detail_card').is(':visible')) { return; }
        PosnicPro.units._chrome();
        PosnicPro.units.loadList(1, function () { PosnicPro.units.openDoc(id); });
    },
    showAdd: function () {
        PosnicPro.units._chrome();
        PosnicPro.units.loadList(null, function () { PosnicPro.units.openEditor(''); });
    },
    showEdit: function (id) {
        PosnicPro.units._chrome();
        PosnicPro.units.loadList(null, function () { PosnicPro.units.openEditor(id); });
    },
    showDelete: function (id) {
        PosnicPro.units._chrome();
        PosnicPro.units.loadList(null, function () {
            PosnicPro.units.openDoc(id);
            PosnicPro.units.askDelete(id);
        });
    },
    mountFilters: function (force) {
        if (!$('#units_filter_panel').length) { return; }
        if (!force && $('#units_filter_panel').data('mounted')) { return; }
        $('#units_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'units',
            container: '#units_filter_panel',
            button: '#units_filter_btn',
            searchPlaceholder: PosnicPro.i18n.t('lang_search_unit_name', 'Search unit name'),
            searchFields: [
                { value: 'name', label: PosnicPro.i18n.t('lang_name_title', 'Name') }
            ],
            onChange: function () { PosnicPro.units.renderList(1); }
        });
    },
    _find: function (id) {
        return (PosnicPro.units._all || []).filter(function (u) {
            return String(u.unit_id) === String(id);
        })[0];
    },
    /* getUnitAll returns the whole list - the search and the pager both
       run client-side, the endpoint takes no params. */
    loadList: function (page, then) {
        PosnicPro.units.mountFilters();
        PosnicPro.get({ url: 'setting/getUnitAll' }, function (response) {
            if (response.type !== 'success') {
                $('#units_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20"><lang class="lang_could_not_load_units_try_again">Could not load units - try again.</lang></div>');
                return;
            }
            PosnicPro.units._all = response.data || [];
            PosnicPro.units.renderList(page || PosnicPro.units._page);
            if (then) { then(); }
        }, function () {
            $('#units_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20"><lang class="lang_could_not_load_units_try_again">Could not load units - try again.</lang></div>');
        });
    },
    renderList: function (page) {
        var self = PosnicPro.units;
        if (page) { self._page = page; }
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var filters = PosnicPro.listFilter.legacyFilters('units', {});
        var needle = String((filters && filters.search_value) || '').toLowerCase();
        self._filtered = self._all.filter(function (u) {
            return !needle || String(u.unit_name || '').toLowerCase().indexOf(needle) !== -1;
        });
        if (!self._filtered.length) {
            var filtered = PosnicPro.listFilter.activeCount('units') > 0;
            $('#units_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                + (filtered ? PosnicPro.i18n.t('lang_no_units_match_this_filter', 'No units match this filter.') : PosnicPro.i18n.t('lang_no_units_yet_press_new_to_add_the_first', 'No units yet - press New to add the first.')) + '</div>');
            $('#units_list_paging').html('');
            return;
        }
        var pages = Math.ceil(self._filtered.length / self.PAGE_SIZE) || 1;
        if (self._page > pages) { self._page = pages; }
        var slice = self._filtered.slice((self._page - 1) * self.PAGE_SIZE, self._page * self.PAGE_SIZE);
        var html = '<div class="table-responsive"><table class="table table-borderless">'
            + '<thead><tr><th><lang class="lang_name_title">Name</lang></th><th class="text-right"><lang class="lang_value_title">Value</lang></th></tr></thead><tbody>';
        slice.forEach(function (u) {
            html += '<tr class="md-row units-row highlight-select'
                + (PosnicPro.listDoc.activeId('units') === String(u.unit_id) ? ' is-active' : '') + '" data-id="' + esc(u.unit_id) + '" style="cursor:pointer;">'
                + '<td>' + esc(u.unit_name) + '</td>'
                + '<td class="text-right">' + esc(u.unit_value) + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';
        $('#units_list_rows').html(html);
        self.renderPager(self._filtered.length);
    },
    renderPager: function (total) {
        var self = PosnicPro.units;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + ' ' + (total === 1 ? PosnicPro.i18n.t('lang_unit', 'unit') : PosnicPro.i18n.t('lang_units', 'units'));
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' · ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.units.goPage(' + to + ');">' + text + '</button>';
        };
        var html = '';
        if (pages > 1) {
            html += btn(p - 1, '&laquo;', p <= 1);
            var end = Math.min(pages, Math.max(1, p - 2) + 4);
            var start = Math.max(1, end - 4);
            for (var n = start; n <= end; n++) {
                html += '<span class="q-pg-num">' + btn(n, n, false, n === p ? 'btn-primary-rgba' : 'btn-secondary-rgba') + '</span>';
            }
        }
        html += '<span class="q-pg-count">' + label + '</span>';
        if (pages > 1) { html += btn(p + 1, '&raquo;', p >= pages); }
        $('#units_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.units._page = n;
        PosnicPro.units.renderList();
    },
    openDoc: function (id) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var u = PosnicPro.units._find(id);
        if (!u) { return; }
        var actions = '<button type="button" class="btn btn-sm btn-light" data-module="branch" data-access="write" data-toggle="tooltip" title="Edit this unit" data-t-title="lang_edit_this_unit" aria-label="Edit" data-t-aria-label="lang_edit_title"'
            + ' onclick="hasher.setHash(\'units/' + esc(id) + '/edit\');"><i class="feather icon-edit-2"></i></button>'
            + '<button type="button" class="btn btn-sm btn-light" data-module="branch" data-access="delete" data-toggle="tooltip" title="Delete this unit" data-t-title="lang_delete_this_unit" aria-label="Delete" data-t-aria-label="lang_delete"'
            + ' onclick="PosnicPro.units.askDelete(\'' + esc(id) + '\');"><i class="feather icon-trash-2"></i></button>';
        PosnicPro.listDoc.open({
            key: 'units',
            id: id,
            title: u.unit_name,
            actions: actions,
            body: '<div id="units_doc_stats">'
                + PosnicPro.listDoc.stats([{ v: esc(u.unit_value), l: PosnicPro.i18n.t('lang_value_title', 'Value') }])
                + '</div>'
                + PosnicPro.listDoc.grid([
                    { label: PosnicPro.i18n.t('lang_about', 'About'), lines: [
                        '<div>' + esc(u.unit_name) + '</div>',
                        '<div class="q-muted">e.g. "2 ' + esc(u.unit_name) + '" on a bill line</div>'
                    ] }
                ])
                + '<div data-module="item" data-access="read||write||delete">'
                + '<div class="q-label" style="margin-top:14px;"><lang class="lang_used_by_items">Used by items</lang></div>'
                + '<div id="units_doc_items" class="q-muted"><lang class="lang_loading_4">Loading ...</lang></div>'
                + '</div>'
                + '<div id="units_doc_strip"></div>'
        });
        PosnicPro.ACLForModule('branch');
        PosnicPro.ACLForModule('item');
        PosnicPro.units.loadUsage(u);
    },
    /* The owner's ask on promotion day: the pane shows the unit AND the
       items that ride it. Old items carry only the unit NAME, newer ones
       the id too - the $or covers both generations. */
    loadUsage: function (u) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var cur = PosnicPro.local.get('currencySign') || '';
        PosnicPro.get({
            url: 'items',
            data: {
                page: 1, limit: 6,
                filters: JSON.stringify({ $or: [{ unit_id: String(u.unit_id) }, { unit: u.unit_name }] })
            }
        }, function (response) {
            if (PosnicPro.listDoc.activeId('units') !== String(u.unit_id)) { return; }
            var data = (response && response.data) || {};
            var list = data.list || [];
            var total = Number(data.total) || list.length;
            $('#units_doc_stats .s-doc-stats').append(
                '<div class="s-stat"><div class="s-stat-value">' + total + '</div>'
                + '<div class="s-stat-label">' + (total === 1 ? PosnicPro.i18n.t('lang_item_uses_it', 'Item uses it') : PosnicPro.i18n.t('lang_items_use_it', 'Items use it')) + '</div></div>');
            if (!list.length) {
                $('#units_doc_items').html(PosnicPro.i18n.t('lang_no_items_use_this_unit_yet', 'No items use this unit yet.'));
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless table-sm" style="margin-bottom:0;">'
                + '<thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th class="un-col-sku"><lang class="lang_sku_title">SKU</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th><th class="text-right"><lang class="lang_stock">Stock</lang></th></tr></thead><tbody>';
            list.forEach(function (r) {
                var tracked = r.track_inventory === true || r.track_inventory === 'true';
                html += '<tr class="un-doc-item-row highlight-select" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td>' + esc(r.name) + '</td>'
                    + '<td class="un-col-sku q-muted">' + esc(r.sku || '') + '</td>'
                    + '<td class="text-right">' + cur + '<span class="number">' + esc(r.sell_price) + '</span></td>'
                    + '<td class="text-right">' + (tracked ? esc(r.available_quantity) + ' ' + esc(r.unit || '') : '<span class="q-muted">not tracked</span>') + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            if (total > list.length) {
                html += '<div class="q-muted" style="margin-top:6px;">and ' + (total - list.length) + ' more.</div>';
            }
            $('#units_doc_items').removeClass('q-muted').html(html);
        }, function () {
            $('#units_doc_items').html(PosnicPro.i18n.t('lang_could_not_load_the_items_for_this_unit', 'Could not load the items for this unit.'));
        });
    },
    /* The editor is the pane itself: two fields and Save. An empty id is a
       new unit; addUnit upserts on unit_id, same as the old settings flow. */
    openEditor: function (id) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var u = id ? PosnicPro.units._find(id) : null;
        if (id && !u) { return; }
        PosnicPro.listDoc.open({
            key: 'units',
            id: id || 'new',
            title: u ? 'Edit · ' + u.unit_name : 'New unit',
            actions: '',
            body: '<div class="form-row">'
                + '<div class="form-group col-md-7"><label for="unit_page_name">Name <span class="text-danger">*</span></label>'
                + '<input id="unit_page_name" type="text" maxlength="10" class="form-control border-control" value="' + esc(u ? u.unit_name : '') + '" placeholder="e.g. Kg, Litre, Box"></div>'
                + '<div class="form-group col-md-5"><label for="unit_page_value">Value <span class="text-danger">*</span></label>'
                + '<input id="unit_page_value" type="text" maxlength="10" class="form-control border-control" value="' + esc(u ? u.unit_value : '') + '" placeholder="e.g. 1"></div>'
                + '</div>'
                + '<div class="text-danger" id="unit_page_error" style="display:none; margin-bottom:10px;"></div>'
                + '<div>'
                + '<button type="button" class="btn btn-sm btn-primary" onclick="PosnicPro.units.save(\'' + esc(id || '') + '\');">' + (u ? PosnicPro.i18n.t('lang_refresh_title', 'Update') : PosnicPro.i18n.t('lang_save_title', 'Save')) + '</button> '
                + '<button type="button" class="btn btn-sm btn-light border" onclick="'
                + (id ? 'hasher.setHash(\'units/' + esc(id) + '\'); PosnicPro.units.openDoc(\'' + esc(id) + '\');'
                    : 'PosnicPro.listDoc.close(\'units\'); hasher.setHash(\'units\');')
                + '">Cancel</button>'
                + '</div>'
        });
        setTimeout(function () { $('#unit_page_name').focus(); }, 100);
    },
    save: function (id) {
        var name = $.trim($('#unit_page_name').val());
        var value = $.trim($('#unit_page_value').val());
        if (!name || !value) {
            $('#unit_page_error').text(PosnicPro.i18n.t('lang_both_the_name_and_the_value_are_needed', 'Both the name and the value are needed.')).show();
            return;
        }
        /* Two doors on purpose: addUnit only inserts (and refuses duplicate
           values), editUnit updates by unit_id - same split the settings
           tab used. */
        PosnicPro.post({
            url: id ? 'setting/editUnit' : 'setting/addUnit',
            data: JSON.stringify(id
                ? { unit_id: id, unit_name: name, unit_value: value }
                : { unit_name: name, unit_value: value })
        }, function (response) {
            PosnicPro.alert(response.type, response.message);
            if (response.type !== 'success') { return; }
            /* The item form's unit dropdown feeds off the same list. */
            if (PosnicPro.items && PosnicPro.items.loadSelectUnit) { PosnicPro.items.loadSelectUnit(); }
            PosnicPro.units.loadList(null, function () {
                var back = id || ((PosnicPro.units._all.filter(function (u) {
                    return u.unit_name === name;
                })[0] || {}).unit_id);
                if (back) { hasher.setHash('units/' + back); PosnicPro.units.openDoc(back); }
                else { PosnicPro.listDoc.close('units'); hasher.setHash('units'); }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    /* Delete confirms inline in the pane - a danger strip, never a
       window.prompt (owner ruling from the purchases build). */
    askDelete: function (id) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var u = PosnicPro.units._find(id);
        if (!u) { return; }
        $('#units_doc_strip').html('<div class="alert alert-danger" style="margin-top:14px;">'
            + 'Delete the unit <strong>' + esc(u.unit_name) + '</strong>? Items already using it keep working; it just leaves the pick list. '
            + '<div style="margin-top:8px;">'
            + '<button type="button" class="btn btn-sm btn-danger" onclick="PosnicPro.units.remove(\'' + esc(id) + '\');">Delete</button> '
            + '<button type="button" class="btn btn-sm btn-light border" onclick="$(\'#units_doc_strip\').empty();">Keep</button>'
            + '</div></div>');
    },
    remove: function (id) {
        PosnicPro.delete('setting/deleteUnit?id=' + id, function (response) {
            PosnicPro.alert(response.type, response.message);
            if (response.type !== 'success') { return; }
            if (PosnicPro.items && PosnicPro.items.loadSelectUnit) { PosnicPro.items.loadSelectUnit(); }
            PosnicPro.listDoc.close('units');
            hasher.setHash('units');
            PosnicPro.units.loadList();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    _csvRows: function (list) {
        var rows = [['Name', 'Value']];
        (list || []).forEach(function (u) { rows.push([u.unit_name, u.unit_value]); });
        return rows;
    },
    exportCsv: function () {
        var self = PosnicPro.units;
        var slice = self._filtered.slice((self._page - 1) * self.PAGE_SIZE, self._page * self.PAGE_SIZE);
        PosnicPro.listExport.save(self._csvRows(slice), 'units.csv');
    },
    exportAllCsv: function () {
        PosnicPro.listExport.save(PosnicPro.units._csvRows(PosnicPro.units._filtered), 'units.csv');
    }
};

$(document).on('click', '#units_filter_btn', function () {
    PosnicPro.units.mountFilters(true);
    PosnicPro.listFilter.toggle('units');
});
$(document).on('click', '#units_list_rows tr.units-row', function () {
    var id = $(this).data('id');
    hasher.setHash('units/' + id);
    PosnicPro.units.openDoc(id);
});
$(document).on('click', '.un-doc-item-row', function () {
    hasher.setHash('items/' + $(this).data('id'));
});
