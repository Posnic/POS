/*
 * Two faster ways to add items, beside the full form rather than instead of it.
 *
 * The full form asks for around forty things because an item can carry around
 * forty things. That is the right form for one carefully specified product and
 * the wrong one for entering a shop's opening catalogue, where the answer to
 * most of the forty is "leave it".
 *
 * Both pages here post to the same endpoint the full form posts to, with the
 * same field names, so an item added from either is indistinguishable from one
 * added the long way. Nothing about the existing form has been touched: shops
 * already using it keep it exactly as it is.
 *
 * What is deliberately NOT done: no barcode is invented for an item left
 * without one. The full form does not generate them either, and a catalogue
 * full of made-up codes is harder to fix than a catalogue with blanks.
 */
(function () {
    'use strict';

    /*
     * The payload the items endpoint expects.
     *
     * Mirrors what the full form sends (items.js, PosnicPro.items.item) so the
     * server sees the same shape from both. Fields left out default server
     * side: prices to 0, unit to "qty", status to regular.
     */
    function itemPayload(f) {
        return {
            name: f.name,
            selling_price: f.selling_price || 0,
            company_price: f.company_price || 0,
            mrp_price: f.mrp_price || 0,
            available_quantity: f.quantity || 0,
            barcode_id: f.barcode || '',
            sku_id: f.sku || '',
            category_id: f.category_id || '',
            category_name: f.category_name || '',
            unit: f.unit || '',
            unit_id: f.unit_id || '',
            tax_id: f.tax_id || '',
            tax_name: f.tax_name || '',
            tax: f.tax || 0,
            tax_type: f.tax_type || PosnicPro.local.get('tax_type') || 'inclusive',
            // The full form ships this checked, so an item added quickly counts
            // stock the same way as one added the long way.
            inventory: f.inventory !== false,
            // Sellable in New Sale by default (the full form ships this checked
            // too) - without it, bulk/quick items are hidden from every sale view.
            sales_channel: true,
            ecommerce: false,
            // Allow selling even when stock is 0 (industry-standard flexible
            // default). Stock is still tracked; the shopkeeper can restrict an
            // item later by unchecking "allow negative stock" on it.
            negative_stock: true,
            item_weight_machine_based: false,
            // Imageless items dress themselves (stable from the name).
            tile_color: (PosnicPro.autoTile && PosnicPro.autoTile(f.name).color) || '',
            tile_shape: (PosnicPro.autoTile && PosnicPro.autoTile(f.name).shape) || '',
            description: ''
        };
    }

    /*
     * Create one item.
     *
     * The endpoint answers 409 with status "exist" when an identical item is
     * already on file - same name, barcode and all three prices. That is worth
     * reporting as its own outcome rather than as a failure, because when
     * someone is entering a long list the useful message is "you already have
     * this one", not "error".
     */
    function createItem(fields, onDone) {
        var params = {
            url: 'items',
            method: 'POST',
            data: JSON.stringify(itemPayload(fields))
        };
        PosnicPro.request(params, function (response) {
            if (response && response.type === 'success') {
                onDone({ ok: true, data: response.data });
            } else {
                onDone({ ok: false, message: (response && response.message) || 'Could not save' });
            }
        }, function (xhr) {
            var message = 'Could not save';
            var duplicate = false;
            try {
                var body = JSON.parse(xhr.responseText);
                message = body.message || message;
                duplicate = xhr.status === 409;
            } catch (e) {
                // A non-JSON body means the request never reached the handler -
                // the status line is the only thing left worth reporting.
                message = 'Could not save (' + (xhr.status || 'no response') + ')';
            }
            onDone({ ok: false, duplicate: duplicate, message: message });
        });
    }

    function num(sel) {
        var v = parseFloat($(sel).val());
        return isNaN(v) ? 0 : v;
    }

    /* ------------------------------------------------------------------ *
     * Quick Item Add: one item at a time, as fast as typing allows.
     * ------------------------------------------------------------------ */

    PosnicPro.quickitems = {
        added: [],

        showDataTablePage: function () {
            PosnicPro.HideSideBarModal();
            $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
            $('.vertical-layout').removeClass('toggle-menu');
            $('.vertical-menu li a').removeClass('active');
            $('.page_loader,#osk-container').hide();
            $('.page-title-box,#quickitems').show();
            $('#v-pills-inventory-tab,#quick_items_page').addClass('active');
            $('#v-pills-inventory').addClass('show active');

            PosnicPro.quickitems.loadOptions();
            PosnicPro.quickitems.bind();
            $('#qa_name').focus();
        },

        // The router calls showAdd for #/<module>/new; this page is the same
        // page either way.
        showAdd: function () {
            PosnicPro.quickitems.showDataTablePage();
        },

        bound: false,
        bind: function () {
            if (PosnicPro.quickitems.bound) return;
            PosnicPro.quickitems.bound = true;

            /*
             * Enter moves on rather than submitting from wherever it is
             * pressed. Someone entering a catalogue keeps both hands on the
             * keyboard, and reaching for the mouse once per item is the whole
             * cost being removed here.
             */
            $('#qa_name').on('keydown', function (e) {
                if (e.which === 13) {
                    e.preventDefault();
                    $('#qa_selling_price').focus();
                }
            });
            $('#qa_selling_price, #qa_quantity').on('keydown', function (e) {
                if (e.which === 13) {
                    e.preventDefault();
                    PosnicPro.quickitems.save();
                }
            });

            // Warn about a name already used, without blocking it: two items
            // can legitimately share a name at different sizes or prices.
            $('#qa_name').on('blur', function () {
                var name = $.trim($(this).val());
                if (!name) { $('#qa_name_hint').text(''); return; }
                var seen = PosnicPro.quickitems.added.filter(function (a) {
                    return a.name.toLowerCase() === name.toLowerCase();
                });
                $('#qa_name_hint').text(seen.length
                    ? 'You already added "' + name + '" in this sitting.' : '');
            });
        },

        toggleMore: function () {
            var $more = $('#qa_more');
            $more.slideToggle(120);
            $('#qa_more_toggle i').toggleClass('icon-chevron-down icon-chevron-up');
        },

        loadOptions: function () {
            if (PosnicPro.quickitems.optionsLoaded) return;
            PosnicPro.quickitems.optionsLoaded = true;

            PosnicPro.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (r) {
                var html = '<option value="">No category</option>';
                $.each((r && r.suggestions) || [], function (i, c) {
                    html += '<option value="' + c.id + '" data-name="' + c.name + '">' + c.name + '</option>';
                });
                $('#qa_category').html(html);
            }, function () { /* a missing list must not stop the page working */ });

            PosnicPro.get({ url: 'setting/getUnitAjaxList', data: 'query=' }, function (r) {
                var html = '<option value="">qty</option>';
                $.each((r && r.suggestions) || [], function (i, u) {
                    html += '<option value="' + u.unit_id + '" data-value="' + u.unit_value + '">'
                        + u.unit_name + ' - ' + u.unit_value + '</option>';
                });
                $('#qa_unit').html(html);
            }, function () {});

            PosnicPro.get({ url: 'setting/getTaxAll', data: { tax_group: 'all' } }, function (r) {
                var html = '<option value="">No tax</option>';
                $.each((r && r.data) || [], function (i, t) {
                    html += '<option value="' + t.tax_id + '" data-name="' + t.tax_name + '"'
                        + ' data-value="' + t.tax_value + '">' + t.tax_name + '</option>';
                });
                $('#qa_tax').html(html);
                var def = PosnicPro.local.get('default_tax_id');
                if (def && $('#qa_tax option[value="' + def + '"]').length) $('#qa_tax').val(def);
            }, function () {});
        },

        save: function () {
            var name = $.trim($('#qa_name').val());
            if (!name) {
                PosnicPro.alert('error', 'An item needs a name.');
                $('#qa_name').focus();
                return false;
            }

            var $cat = $('#qa_category').find('option:selected');
            var $unit = $('#qa_unit').find('option:selected');
            var $tax = $('#qa_tax').find('option:selected');

            var fields = {
                name: name,
                selling_price: num('#qa_selling_price'),
                company_price: num('#qa_company_price'),
                mrp_price: num('#qa_mrp_price'),
                quantity: num('#qa_quantity'),
                barcode: $.trim($('#qa_barcode').val()),
                sku: $.trim($('#qa_sku').val()),
                category_id: $('#qa_category').val() || '',
                category_name: $cat.data('name') || '',
                unit_id: $('#qa_unit').val() || '',
                unit: $unit.data('value') || '',
                tax_id: $('#qa_tax').val() || '',
                tax_name: $tax.data('name') || '',
                tax: $tax.data('value') || 0,
                inventory: $('#qa_track_inventory').is(':checked')
            };

            $('#qa_save').prop('disabled', true);
            createItem(fields, function (result) {
                $('#qa_save').prop('disabled', false);
                if (!result.ok) {
                    PosnicPro.alert('error', result.message);
                    return;
                }
                PosnicPro.quickitems.remember(name, fields.selling_price, result.data);
                PosnicPro.quickitems.clearForm();
            });
            return false;
        },

        remember: function (name, price, data) {
            PosnicPro.quickitems.added.unshift({
                name: name,
                price: price,
                id: (data && (data.id || data._id)) || ''
            });
            var html = '';
            $.each(PosnicPro.quickitems.added, function (i, a) {
                html += '<div class="d-flex justify-content-between align-items-center py-2"'
                    + ' style="border-bottom:1px solid rgba(0,0,0,.06);">'
                    + '<span style="color:inherit;">' + $('<i>').text(a.name).html() + '</span>'
                    + '<span>' + Number(a.price || 0).toFixed(2)
                    + (a.id ? ' <a href="#/items/' + a.id + '/edit" class="ml-2">edit</a>' : '')
                    + '</span></div>';
            });
            $('#qa_recent').html(html);
            $('#qa_count').text('(' + PosnicPro.quickitems.added.length + ')');
        },

        /*
         * Clear for the next item, but keep category, unit and tax.
         *
         * A catalogue is entered in runs - twenty groceries, then ten drinks -
         * so the classification usually holds from one item to the next while
         * the name and price never do.
         */
        clearForm: function () {
            $('#qa_name, #qa_selling_price, #qa_quantity, #qa_company_price,'
                + ' #qa_mrp_price, #qa_barcode, #qa_sku').val('');
            $('#qa_name_hint').text('');
            $('#qa_name').focus();
        }
    };

    /* ------------------------------------------------------------------ *
     * Bulk Item Add: a grid that grows, and takes a paste from a spreadsheet.
     * ------------------------------------------------------------------ */

    var COLUMNS = ['name', 'selling_price', 'company_price', 'quantity', 'barcode', 'category'];

    /*
     * Categories the shop already has, so a typed name can become a real one.
     *
     * The server stores category_name as given and category_id only when it is
     * a valid id, so posting a bare name would produce items labelled with a
     * category that nothing else in the app knows about - they would not show
     * under it, or filter by it. Matching the name against the real list keeps
     * the pair consistent, and an unmatched name is reported rather than
     * quietly saved as a label.
     */
    var categoryIndex = null;

    function loadCategoryIndex() {
        PosnicPro.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (r) {
            categoryIndex = {};
            $.each((r && r.suggestions) || [], function (i, c) {
                categoryIndex[String(c.name).trim().toLowerCase()] = { id: c.id, name: c.name };
            });
        }, function () {
            // Leave it null: unknown is different from "the shop has none", and
            // only the first would be wrong to report as a bad category.
            categoryIndex = null;
        });
    }

    function resolveCategory(typed) {
        if (!typed) return { id: '', name: '' };
        if (!categoryIndex) return { id: '', name: typed };
        var hit = categoryIndex[String(typed).trim().toLowerCase()];
        return hit ? { id: hit.id, name: hit.name } : { id: '', name: typed, unknown: true };
    }

    PosnicPro.bulkitems = {
        /*
         * Name and price only, until asked otherwise.
         *
         * A shop that already has its list as a file has CSV import, which
         * takes every field an item can carry. What this page is for is the
         * other case - typing a lot of items - and there the two things you
         * actually type are the name and what it sells for. Six columns of
         * mostly-empty boxes made it look like the form it was meant to
         * replace.
         */
        extraShown: false,

        toggleColumns: function () {
            PosnicPro.bulkitems.extraShown = !PosnicPro.bulkitems.extraShown;
            $('.bulk-extra').toggle(PosnicPro.bulkitems.extraShown);
            $('#bulk_columns_toggle').html(PosnicPro.bulkitems.extraShown
                ? '<i class="feather icon-columns mr-2"></i>Fewer columns'
                : '<i class="feather icon-columns mr-2"></i>More columns');
        },

        showDataTablePage: function () {
            PosnicPro.HideSideBarModal();
            $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
            $('.vertical-layout').removeClass('toggle-menu');
            $('.vertical-menu li a').removeClass('active');
            $('.page_loader,#osk-container').hide();
            $('.page-title-box,#bulkitems').show();
            $('#v-pills-inventory-tab,#bulk_items_page').addClass('active');
            $('#v-pills-inventory').addClass('show active');

            if (categoryIndex === null) loadCategoryIndex();
            if (!$('#bulk_rows tr').length) PosnicPro.bulkitems.addRows(8);
            $('#bulk_rows tr:first input:first').focus();
        },

        showAdd: function () {
            PosnicPro.bulkitems.showDataTablePage();
        },

        addRows: function (n) {
            var start = $('#bulk_rows tr').length;
            var html = '';
            for (var i = 0; i < n; i++) {
                var r = start + i;
                var hidden = PosnicPro.bulkitems.extraShown ? '' : ' style="display:none;"';
                html += '<tr data-row="' + r + '">'
                    + '<td class="text-muted">' + (r + 1) + '</td>'
                    + '<td><input type="text" class="form-control form-control-sm bulk-cell"'
                    + ' data-col="name" maxlength="100"></td>'
                    + '<td><input type="number" step="0.01" min="0" class="form-control form-control-sm bulk-cell"'
                    + ' data-col="selling_price"></td>'
                    + '<td class="bulk-extra"' + hidden + '><input type="number" step="0.01" min="0"'
                    + ' class="form-control form-control-sm bulk-cell" data-col="company_price"></td>'
                    + '<td class="bulk-extra"' + hidden + '><input type="number" step="0.001" min="0"'
                    + ' class="form-control form-control-sm bulk-cell" data-col="quantity"></td>'
                    + '<td class="bulk-extra"' + hidden + '><input type="text"'
                    + ' class="form-control form-control-sm bulk-cell" data-col="barcode" maxlength="100"></td>'
                    + '<td class="bulk-extra"' + hidden + '><input type="text"'
                    + ' class="form-control form-control-sm bulk-cell" data-col="category" maxlength="100"></td>'
                    + '<td class="bulk-status text-muted" style="font-size:12px;"></td>'
                    + '</tr>';
            }
            $('#bulk_rows').append(html);
            PosnicPro.bulkitems.bind();
        },

        bound: false,
        bind: function () {
            if (PosnicPro.bulkitems.bound) return;
            PosnicPro.bulkitems.bound = true;

            /*
             * The grid grows as it fills, so nobody has to decide up front how
             * many rows they need. Typing in the last row adds another.
             */
            $('#bulk_rows').on('input', '.bulk-cell', function () {
                var $row = $(this).closest('tr');
                if (!$row.next('tr').length && $.trim($(this).val()) !== '') {
                    PosnicPro.bulkitems.addRows(1);
                }
            });

            /*
             * Paste a block from a spreadsheet.
             *
             * Most shops already have their list somewhere - a supplier's sheet,
             * a stocktake - and retyping it is the actual work. Excel puts tabs
             * between cells and newlines between rows on the clipboard, so a
             * block can be laid straight into the grid from wherever the cursor
             * is, growing rows to fit.
             */
            $('#bulk_rows').on('paste', '.bulk-cell', function (e) {
                var text = (e.originalEvent || e).clipboardData.getData('text/plain');
                if (text.indexOf('\t') === -1 && text.indexOf('\n') === -1) return;
                e.preventDefault();

                var rows = text.replace(/\r/g, '').split('\n').filter(function (l) {
                    return $.trim(l) !== '';
                });
                var startRow = $(this).closest('tr').index();
                var startCol = COLUMNS.indexOf($(this).data('col'));

                var needed = startRow + rows.length - $('#bulk_rows tr').length;
                if (needed > 0) PosnicPro.bulkitems.addRows(needed);

                var landedInHidden = false;
                $.each(rows, function (r, line) {
                    var cells = line.split('\t');
                    var $tr = $('#bulk_rows tr').eq(startRow + r);
                    $.each(cells, function (c, value) {
                        var col = COLUMNS[startCol + c];
                        if (!col) return;
                        var $cell = $tr.find('[data-col="' + col + '"]');
                        // Always written, so a paste over existing rows
                        // replaces them rather than leaving stale values
                        // behind; only a real value is worth opening a column
                        // for.
                        $cell.val($.trim(value));
                        if ($.trim(value) && $cell.closest('td').hasClass('bulk-extra')) {
                            landedInHidden = true;
                        }
                    });
                });

                /*
                 * A paste wider than the visible grid opens the rest of it.
                 *
                 * Silently filling a column nobody can see would mean saving
                 * data the person pasting never got to check - and if it were
                 * wrong, they would have no way of knowing where it came from.
                 */
                if (landedInHidden && !PosnicPro.bulkitems.extraShown) {
                    PosnicPro.bulkitems.toggleColumns();
                }
                PosnicPro.bulkitems.status('info',
                    'Pasted ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '. Check them, then Save all.');
            });
        },

        status: function (kind, message) {
            var colour = { info: '#0c5460', error: '#721c24', success: '#155724' }[kind] || '#0c5460';
            var background = { info: '#d1ecf1', error: '#f8d7da', success: '#d4edda' }[kind] || '#d1ecf1';
            $('#bulk_status').html('<div style="padding:10px 14px;border-radius:6px;margin-bottom:12px;'
                + 'background:' + background + ';color:' + colour + ';">' + message + '</div>');
        },

        rowFields: function ($tr) {
            var f = {};
            $tr.find('.bulk-cell').each(function () {
                f[$(this).data('col')] = $.trim($(this).val());
            });
            return f;
        },

        /*
         * Save every row that has a name.
         *
         * One at a time rather than all at once: fifty parallel writes would
         * race each other for the duplicate check, and the point of the status
         * column is that a failure names the row it belongs to. Rows that
         * succeed are locked so a second press cannot enter them twice.
         */
        saveAll: function () {
            var pending = [];
            $('#bulk_rows tr').each(function () {
                var $tr = $(this);
                if ($tr.data('saved')) return;
                var f = PosnicPro.bulkitems.rowFields($tr);
                if (f.name) pending.push({ $tr: $tr, fields: f });
            });

            if (!pending.length) {
                PosnicPro.bulkitems.status('error', 'Nothing to save - every row with a name is already in.');
                return;
            }

            $('#bulk_save').prop('disabled', true);
            PosnicPro.bulkitems.status('info', 'Saving ' + pending.length + ' items...');

            var done = 0, saved = 0, failed = 0;
            function next(i) {
                if (i >= pending.length) {
                    $('#bulk_save').prop('disabled', false);
                    PosnicPro.bulkitems.status(failed ? 'error' : 'success',
                        saved + ' saved' + (failed ? ', ' + failed + ' need attention - see the Status column' : '') + '.');
                    return;
                }
                var row = pending[i];
                row.$tr.find('.bulk-status').text('saving...').css('color', '#6c757d');

                var category = resolveCategory(row.fields.category);
                if (category.unknown) {
                    failed++;
                    row.$tr.find('.bulk-status')
                        .text('no category "' + row.fields.category + '"')
                        .css('color', '#856404');
                    next(i + 1);
                    return;
                }

                createItem({
                    name: row.fields.name,
                    selling_price: parseFloat(row.fields.selling_price) || 0,
                    company_price: parseFloat(row.fields.company_price) || 0,
                    quantity: parseFloat(row.fields.quantity) || 0,
                    barcode: row.fields.barcode || '',
                    category_id: category.id,
                    category_name: category.name,
                    inventory: true
                }, function (result) {
                    done++;
                    if (result.ok) {
                        saved++;
                        row.$tr.data('saved', true);
                        row.$tr.find('.bulk-cell').prop('readonly', true).css('background', '#f6f6f6');
                        row.$tr.find('.bulk-status').text('saved').css('color', '#155724');
                    } else {
                        failed++;
                        row.$tr.find('.bulk-status')
                            .text(result.duplicate ? 'already exists' : result.message)
                            .css('color', result.duplicate ? '#856404' : '#721c24');
                    }
                    next(i + 1);
                });
            }
            next(0);
        },

        clear: function () {
            // Only the rows that have not been written yet: clearing the grid
            // must never suggest that saved items were undone.
            $('#bulk_rows tr').each(function () {
                if ($(this).data('saved')) return;
                $(this).find('.bulk-cell').val('');
                $(this).find('.bulk-status').text('');
            });
            PosnicPro.bulkitems.status('info', 'Unsaved rows cleared. Items already saved are untouched.');
        }
    };

    /*
     * The same create flow as this page, as a popup - the sale and purchase
     * searches open it when a typed name matches nothing. Name and price
     * now, everything else later on the Items page.
     */
    PosnicPro.quickitems.popup = function (name, onCreated) {
        if (!$('#quick_item_modal').length) {
            $('body').append(
                '<div class="modal fade" id="quick_item_modal" tabindex="-1" role="dialog" aria-hidden="true">' +
                '<div class="modal-dialog modal-dialog-centered modal-sm" role="document"><div class="modal-content">' +
                '<div class="modal-header py-2"><h5 class="modal-title">New item</h5>' +
                '<button type="button" class="close" data-dismiss="modal">&times;</button></div>' +
                '<div class="modal-body">' +
                '<label class="mb-0 small text-muted" for="quick_item_name">Name</label>' +
                '<input type="text" class="form-control mb-2" id="quick_item_name" maxlength="100" autocomplete="off">' +
                '<label class="mb-0 small text-muted" for="quick_item_price">Selling price</label>' +
                '<input type="number" min="0" step="any" class="form-control mb-2 text-right" id="quick_item_price" placeholder="0.00" autocomplete="off">' +
                '<label class="mb-0 small text-muted" for="quick_item_qty">Stock on hand</label>' +
                '<input type="number" min="0" step="any" class="form-control text-right" id="quick_item_qty" placeholder="0" autocomplete="off">' +
                '<small class="text-muted d-block mt-2">Saved to your items - add details anytime from the Items page.</small>' +
                '</div>' +
                '<div class="modal-footer py-2">' +
                '<button type="button" class="btn btn-secondary-rgba" data-dismiss="modal">Cancel</button>' +
                '<button type="button" class="btn btn-primary" id="quick_item_save">Save item</button>' +
                '</div></div></div></div>');
            $('#quick_item_price,#quick_item_qty').on('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); $('#quick_item_save').click(); }
            });
            $('#quick_item_save').on('click', function () { PosnicPro.quickitems._popupSave(); });
        }
        PosnicPro.quickitems._onCreated = onCreated || null;
        $('#quick_item_name').val(name || '');
        $('#quick_item_price,#quick_item_qty').val('');
        $('#quick_item_modal').modal('show');
        setTimeout(function () { $(name ? '#quick_item_price' : '#quick_item_name').focus(); }, 400);
    };

    PosnicPro.quickitems._popupSave = function () {
        var name = $.trim($('#quick_item_name').val());
        if (!name) { $('#quick_item_name').focus(); return; }
        var price = parseFloat($('#quick_item_price').val());
        var qty = parseFloat($('#quick_item_qty').val());
        // The sale page caches the shop default tax for quick sales - a new
        // item born at the till inherits it when available.
        var t = (PosnicPro.sales && PosnicPro.sales.quickSale && PosnicPro.sales.quickSale._tax) || null;
        $('#quick_item_save').prop('disabled', true);
        createItem({
            name: name,
            selling_price: isNaN(price) ? 0 : price,
            mrp_price: isNaN(price) ? 0 : price,
            quantity: isNaN(qty) ? 0 : qty,
            tax_id: (t && t.id) || '',
            tax_name: (t && t.name) || '',
            tax: (t && t.value) || 0,
            inventory: true
        }, function (result) {
            $('#quick_item_save').prop('disabled', false);
            if (!result.ok) {
                PosnicPro.alert(result.duplicate ? 'warning' : 'error', result.message);
                return;
            }
            $('#quick_item_modal').modal('hide');
            PosnicPro.alert('success', 'Item saved');
            var id = (result.data && (result.data.id || result.data._id)) || '';
            var cb = PosnicPro.quickitems._onCreated;
            PosnicPro.quickitems._onCreated = null;
            if (cb) {
                cb(id, {
                    name: name,
                    selling_price: isNaN(price) ? 0 : price,
                    quantity: isNaN(qty) ? 0 : qty
                });
            }
        });
    };
}());
