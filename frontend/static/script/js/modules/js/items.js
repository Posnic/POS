PosnicPro.items = {
    itemStatus: '',
    imageParams: [],
    form_data: new FormData(),
    itemAction: 'add',
    showAdd: function () {
        var loader = $(".loader-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.HideSideBarModal();
        // A fresh form belongs to no family.
        $('#item_family_strip').hide().find('.family-chips').html('');
        PosnicPro.items._family = null;
        PosnicPro.items.renderModifierGroups([]);
        $('#item_discount').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").addClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        PosnicPro.showAddModal('item');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#items_new,#item_variant_header').show();
        $('#v-pills-inventory-tab,#view_items_page,.item_new_shortcut').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('#v-pills-purchase-tab').removeClass('active');
        $('#v-pills-purchase').removeClass('show active');
        $("#items_mfg_date").val('');
        $("#items_expiry_date").val('');
        $('#item_upload_image_status').val('no');
        // IC1c: a fresh entry starts with the essentials; the collapsed
        // sections open on demand (and always open on edit).
        // Owner: these sections stay open - nothing on the form hides behind a click.
        PosnicPro.items.applyHardwareGates();
        PosnicPro.items.addItemButton();
        $('#items_reset').show();
        $('.items_edit_reset').hide();
        if (PosnicPro.items.itemAction === 'edit') {
            PosnicPro.items.itemClearForm();
        }
        PosnicPro.items.itemAction = 'add';
        
        // Apply discount from selected category
        setTimeout(function() {
            var selectedOption = $('.items_category').find('option:selected')[0];
            if (selectedOption) {
                console.log('triggerAddNew: Applying discount from category');
                PosnicPro.items.applyCategoryDiscount(selectedOption);
            }
        }, 500);
    },
    showClone: function (id) {
        var loader = $(".loader-item");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.items.cloneItem(id);
    },
    showEdit: function (id) {
        var loader = $(".loader-item");
        loader.find(".loadingSpinner:first").remove();
        $('#product_without_variant').prop('checked', true);
        $('#product_with_variant').prop('checked', false);

        $('#show_variant_fields').hide();
        $('#show_price_fields,#sku_card_col').show();
        $("#load_price_fields").html('');
        $("#show-hide-item-discount").show();
        $('#item_variant_header').hide();

        PosnicPro.showEditModal('items');
        PosnicPro.items.applyHardwareGates();
        // Editing is a see-everything visit: open the collapsed sections so
        // stored description/images/dates/flags are never hidden state.
        $('#item_details_collapse, #item_extras_collapse').collapse('show');
        PosnicPro.items.editItem(id);
        $('#item_discount').show();
        $('#v-pills-inventory-tab').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('#items_reset').hide();
        $('.items_edit_reset').show();
        // The record id rides data-id; overwriting the DOM id broke every
        // later #items_edit_reset selector.
        $('.items_edit_reset').attr('data-id', id);
        $('.error_item').css('display', 'none');
        PosnicPro.items.itemAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'items');
    },
    /* Tile colour: keep the hidden input and the swatch highlight in step. */
    /* LS1: the comma-separated tags field as a clean array. */
    _tagList: function () {
        return ($('#items_tags').val() || '').split(',')
            .map(function (t) { return t.trim(); })
            .filter(function (t) { return t.length > 0; });
    },
    setTileShape: function (shape) {
        $('#item_tile_shape').val(shape || '');
        $('#item_tile_shapes .tile-shape').removeClass('is-picked').filter(function () {
            return ($(this).data('shape') || '') === (shape || '');
        }).addClass('is-picked');
    },
    setTileColor: function (color) {
        $('#item_tile_color').val(color || '');
        $('#item_tile_swatches .tile-swatch').removeClass('is-picked').filter(function () {
            return ($(this).data('color') || '') === (color || '');
        }).addClass('is-picked');
    },
    /* Services (Q3): a service holds no stock - the stock-ish inputs step
       aside and the pricing unit select appears. The server forces
       track_inventory off regardless, so this is presentation only. */
    applyServiceMode: function () {
        var isService = $('#item_is_service').is(':checked');
        $('#item_service_unit').attr('style', isService ? 'width:auto;' : 'width:auto; display:none !important;');
        $('#items_available_quantity, #items_reorder_point').closest('.col-md-6').toggle(!isService);
        $('#items_barcodes_alt, #items_purchase_unit, #items_conversion_factor').closest('.form-row').toggle(!isService);
    },
    /* The weight-scale flag only means anything when the weight-machine
       hardware module is on - the sales side gates on the same setting. */
    applyHardwareGates: function () {
        var settings = null;
        try { settings = JSON.parse(PosnicPro.local.get('general_settings') || 'null'); } catch (e) { /* defaults */ }
        var weightOn = !!(settings && settings.hardware_weight_machine_enable);
        $('#item_weight_flag_wrap').toggle(weightOn);
        if (!weightOn) { $('#item_weight_machine_based').prop('checked', false); }
    },
    showDetails: function (id) {
        var loader = $(".loader-view-item");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('items');
        PosnicPro.items.viewItem(id);
    },
    showBarcode: function (id) {
        PosnicPro.items.printLableView(id);
    },
    itemsTable: function () {
        // A fresh page/search/refresh ends any "select all N" - the set behind
        // the list has changed, so the old whole-set selection no longer holds.
        PosnicPro.clearSelectAllMatching('items');
        var loader = $(".loader-table-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('items');
        var table = $('#view_items');
        var params = {
            url: 'items',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_items_per_page  option:selected').text()),
                filters: table.data('filters')
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                table.data('total', response.data.total);
                table.data('total_pages', response.data.total_pages);
                table.data('current_page', response.data.current_page);
                table.data('per_page', response.data.per_page);
                PosnicPro.paging(response.data.total_pages, response.data.current_page);
                table.children('tbody').text('');
                $('#view_items_total').text(response.data.total);

                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.item_header').hide();
                    $('#item_img_hide').show();

                } else {
                    $('#item_img_hide').hide();
                    $('.item_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_items_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_items_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    if (row.barcode_id === undefined || row.barcode_id === '') {
                        var lableicon = '<span id="show_label_icon" style="display:none;"></span>';
                        $('#show_label_icon').hide();
                    } else {
                        $('#show_label_icon').show();
                        var lableicon = '<a data-module = "item" data-access = "write" href="#/items/' + row._id + '/barcode" data-id="items/' + row._id + '/barcode" data-toggle="tooltip" title="Barcode Item" class="point-cursor mobile_tooltip"><i class="feather icon-align-justify"></i></a>';
                    }

                    let image_path = (row.image && row.image !== "item.svg") ? row.image : 'static/images/default/item.svg';
                    // A colour/shape item shows its tile in the Image column -
                    // that is what the colour is FOR (owner report).
                    var _listTile = '';
                    var _lrt = (PosnicPro.resolveTile ? PosnicPro.resolveTile(row) : { color: row.tile_color, shape: row.tile_shape });
                    if ((!row.image || row.image === 'item.svg') && _lrt.color) {
                        var _lShape = PosnicPro.tileShapeCss(_lrt.shape || '', '4px');
                        _listTile = '<span style="display:inline-flex;width:30px;height:30px;' + _lShape + 'background:' + _lrt.color + ';color:#fff;font-weight:700;font-size:13px;align-items:center;justify-content:center;">' + String(row.name || '?').trim().charAt(0).toUpperCase() + '</span>';
                    }
                    let process_class = '';
                    let edit_icon = '<a data-module = "item" data-access = "write" href="#/items/' + row._id + '/edit" data-id="items/' + row._id + '/edit"  data-toggle="tooltip" title="Edit Item" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>';
                    if (row.item_status === 'instant') {
                        process_class = "badge badge-warning-inverse";
                        edit_icon = '<span id="item_show_edit_icon" style="display:none;"></span>';
                    } else {
                        process_class = "badge badge-success-inverse";
                    }
                    let item_unit = (typeof (row.unit) != "undefined" && row.unit !== null) ? row.unit : "qty";
                    let action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<span id="show_label_icon" style="display:none;">' + lableicon + ' </span>' +
                            '<a data-module = "item" data-access = "write" href="#/items/' + row._id + '/clone" data-id="items/' + row._id + '/clone" data-toggle="tooltip" title="Clone" class="point-cursor mobile_tooltip"><i class="feather icon-external-link"></i></a>' +
                            '<a data-module = "item" data-access = "read" href="#/items/' + row._id + '" data-id="items/' + row._id + '"  data-toggle="tooltip" title="View Item" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<span id="item_show_edit_icon" style="display:none;">' + edit_icon + ' </span>' +
                            '<a data-module = "item" data-access = "delete" href="#/items/' + row._id + '/delete" data-id="items/' + row._id + '/delete" data-toggle="tooltip" title="Delete Item" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';
                    let isChecked = row.isAvailable ? 'checked' : '';
                    let kioskToggle = '<label class="switch">' +
                            '<input type="checkbox" id="kiosk_' + row._id + '" class="kiosk-toggle" ' + isChecked + '>' +
                            '<span class="slider round"></span>' +
                            '</label>';
                    var trow = '<tr> <th><input type="checkbox" class="items-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'items\');"></th> <th scope="row">' + row_no + '</th>  <td width="30%"><a href="#/items/' + row._id + '"><i class="table_model_item">' + row.name + '</i></a></td> <td>' + (_listTile !== '' ? _listTile : '<img src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + row.image + '" onerror="this.onerror=null;this.src=\'static/images/default/item.svg\';" onclick="PosnicPro.viewImage(this.id,\'item\');">') + '</td> <td class="text-center">' + row.itemid + '</td> <td class="text-right">' + row.available_quantity + ' ' + item_unit + '</td> <td class="text-center"><span class="' + process_class + '">' + row.item_status + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td> ' +
                            '<td class="text-center kiosk-column">' + kioskToggle + '</td>' + '<td class="text-center"><span>' + action + ' </span></td></tr>';

                    $('#view_items').children('tbody').append(trow);
                }

                /*
                 * The Kiosk column, only where there is a kiosk.
                 *
                 * A shop that has not set up Kiosk Settings has no use for a
                 * per-item kiosk toggle: the switch would do nothing anybody
                 * could see, while taking space from Quantity and Price on the
                 * page staff are in all day.
                 *
                 * The server decides - see isKioskConfigured in the items
                 * controller - because it is the only side that knows whether a
                 * store id has been entered without the Settings page having
                 * been opened first.
                 */
                if (response.data.kiosk_configured) {
                    $('.kiosk-column').show();
                } else {
                    $('.kiosk-column').hide();
                }

                $('span.number').number(true, 2);
                $(document).ready(function () {
                    for (var i = 0; i < response.data.list.length; i++) {
                        $('#onclick-toolbar_' + i).toolbar({
                            content: '#onclick-toolbar-options_' + i,
                            event: 'click',
                            style: 'primary',
                            hideOnClick: true
                        });
                        $('#onclick-toolbar_' + i).on('toolbarItemClick', function (event, element) {
                            hasher.setHash($(element).data('id'));
                            $(this).trigger('click');
                            $('.mobile_tooltip').tooltip('hide');
                        });
                    }
                });
                PosnicPro.setSelectedCheckbox(PosnicPro["items_checkbox"], 'items');
                PosnicPro.ACLForModule('item');
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    showDataTablePage: function () {
        var loader = $(".loader-table-item");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#items').show();
        $('#items_new,#items_view').modal('hide');
        $('#v-pills-inventory-tab,#view_items_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        PosnicPro.items.itemsTable('items');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_itemdetail').show();

    },
    triggerAddNew: function () {
        PosnicPro.items.showAdd();
        $('#item_variant_header').hide();
        $('#show_variant_fields').hide();
        $('#show_price_fields,#sku_card_col').show();
        $('#product_without_variant').prop('checked', true);
        $('#product_with_variant').prop('checked', false);
        $('#show_variant_fields').hide();
        $('#show_price_fields,#sku_card_col').show();
        $("#load_price_fields").html('');
        $("#show-hide-item-discount").show();
        if ($('#sales_new_item_name').val() !== '') {
            var itemname = $('#sales_new_item_name').val();
            PosnicPro.items.itemStatus = 'salespage';
        } else {
            itemname = $('#receiving_add_item_name').val();
            PosnicPro.items.itemStatus = 'receivingpage';
        }
        $('#items_name').val(itemname);

    },
    /*
     * Modifier groups on the item form (V2): Restaurant-mode only. The
     * checkbox list renders from the shop's groups; selections travel as
     * modifier_group_ids. The key is only SENT when the section rendered -
     * the server's presence-gating then means a retail save can never
     * silently strip a restaurant item's groups.
     */
    renderModifierGroups: function (selectedIds) {
        var wrap = $('#item_modifier_wrap');
        if (!wrap.length) { return; }
        if (PosnicPro.local.get('table_options') !== 'enable') { wrap.hide(); return; }
        var chosen = (selectedIds || []).map(String);
        PosnicPro.get({ url: 'setting/modifierGroups', data: {} }, function (r) {
            var rows = (r && r.data) || [];
            if (!rows.length) { wrap.hide(); return; }
            var esc = function (s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            };
            var html = '';
            rows.forEach(function (g) {
                var checked = chosen.indexOf(String(g.id)) >= 0 ? ' checked' : '';
                html += '<div class="custom-control custom-checkbox">'
                    + '<input type="checkbox" class="custom-control-input item-modgroup" id="modgrp_' + esc(g.id) + '" value="' + esc(g.id) + '"' + checked + '>'
                    + '<label class="custom-control-label" for="modgrp_' + esc(g.id) + '">' + esc(g.name) + '</label>'
                    + '</div>';
            });
            $('#item_modifier_groups').html(html);
            wrap.show();
        }, function () { wrap.hide(); });
    },
    /* Alternate barcodes (V3): the comma-separated field as a clean array. */
    _altBarcodes: function () {
        var raw = $('#items_barcodes_alt').val();
        if (raw === undefined) { return undefined; }
        return String(raw).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    },
    /* Array when the section rendered (send the key: empty = clear all);
       undefined when it did not (omit the key: server leaves it alone). */
    _modifierGroupIds: function () {
        if ($('#item_modifier_wrap').css('display') === 'none') { return undefined; }
        return $('.item-modgroup:checked').map(function () { return $(this).val(); }).get();
    },
    /*
     * The fields every row of a save shares - category, supplier, tax,
     * flags, description - read ONCE from the form. The old variant loop
     * re-read all of these per row on its way to firing N independent
     * POSTs; the family path reads them here and sends one request.
     */
    _sharedItemFields: function () {
        var content = $('#items_description');
        var hsnValue = $("input[name='hsntax_radio_value']:checked").val();
        var tax_value, hsn_code, tax_id, tax_name, tax_method;
        if (hsnValue === 'hsncode') {
            tax_value = $('#hsn_tax').val();
            hsn_code = $('#items_hsncode').val();
            tax_id = '';
            tax_name = '';
            tax_method = 'hsn';
        } else {
            var taxDetail = $("#items_tax").select2("data");
            tax_value = taxDetail[0].element.attributes['data-tax-value'].value;
            tax_id = taxDetail[0].element.attributes['data-tax-id'].value;
            tax_name = taxDetail[0].element.attributes['data-tax-name'].value;
            hsn_code = 0;
            tax_method = 'default';
        }
        var categoryDetail = $("#items_category").select2("data");
        return {
            supplier_id: $('#items_supplier_id').val(),
            supplier_name: $('#items_supplier').val(),
            category_id: categoryDetail[0].element.attributes['data-category-id'].value,
            category_name: categoryDetail[0].element.attributes['data-category-name'].value,
            cover_image: $('#item_logo').val(),
            inventory: $('#item_track_inventory').is(':checked'),
            sales_channel: $('#item_sales_channel').is(':checked'),
            ecommerce: $('#item_ecommerce').is(':checked'),
            negative_stock: $('#item_negative_stock').is(':checked'),
            item_weight_machine_based: $('#item_weight_machine_based').is(':checked'),
            open_price: $('#item_open_price').is(':checked'),
            tile_color: $('#item_tile_color').val() || PosnicPro.autoTile($('#items_name').val()).color,
            tile_shape: $('#item_tile_shape').val() || PosnicPro.autoTile($('#items_name').val()).shape,
            plu_code: $('#items_plu_code').val() || '',
            item_kind: $('#item_is_service').is(':checked') ? 'service' : 'product',
            service_unit: $('#item_service_unit').val() || 'fixed',
            brand: $('#items_brand').val(),
            tags: PosnicPro.items._tagList(),
            reorder_point: $('#items_reorder_point').val() === '' ? undefined : Number($('#items_reorder_point').val()),
            hsn_code: hsn_code,
            hsn_description: $('#items_hsndescription').val(),
            tax_method: tax_method,
            tax_name: tax_name,
            tax_id: tax_id,
            tax: tax_value,
            tax_type: $('input[name="tax_radio_value"]:checked').val(),
            description: content.val(),
            image: PosnicPro.items.imageParams,
            modifier_group_ids: PosnicPro.items._modifierGroupIds(),
            barcodes: PosnicPro.items._altBarcodes(),
            purchase_unit: $('#items_purchase_unit').val(),
            conversion_factor: $('#items_conversion_factor').val(),
            // IC1c: the Details section (dates included) is visible in
            // variant mode now, so families inherit what it shows - the old
            // divergence where item() sent dates and this builder did not.
            items_mfg_date: $('#items_mfg_date').val(),
            items_expiry_date: $('#items_expiry_date').val()
        };
    },
    /*
     * Variant family creation (V1): ONE atomic request instead of one POST
     * per value. The server validates every row before creating any and
     * rolls back if a row fails mid-way - a network blip can no longer
     * leave half a family behind.
     */
    saveVariantFamily: function (loader) {
        var itemName = $('#items_name').val();
        var values = $('#item_variant_list').val() || [];
        var shared = PosnicPro.items._sharedItemFields();
        var variantDetail = $('#items_variant').select2('data');
        var axis = (variantDetail && variantDetail.length) ? variantDetail[0].text : '';
        var rows = [];
        $(values).each(function (key, variantName) {
            var unitVariantDetail = $('#items_unit_' + key + '');
            rows.push(Object.assign({}, shared, {
                name: itemName + ' / ' + variantName,
                variant_value: variantName,
                sku_id: $('#items_itemid_' + key + '').val(),
                barcode_id: $('#items_barcodeid_' + key + '').val(),
                mrp_price: $('#items_mrp_price_' + key + '').val(),
                company_price: $('#items_company_price_' + key + '').val(),
                selling_price: $('#items_selling_price_' + key + '').val(),
                available_quantity: $('#items_available_quantity_' + key + '').val(),
                position: $('#items_sort_' + key + '').val(),
                unit: unitVariantDetail.find(':selected').attr('data-unit-value'),
                unit_id: unitVariantDetail.find(':selected').attr('data-unit-id'),
                discount_amount: $('#items_discount_amount_' + key + '').val(),
                discount_percentage: $('#items_discount_percentage_' + key + '').val()
            }));
        });
        PosnicPro.post({
            url: 'items/createFamily',
            data: JSON.stringify({
                items: rows,
                variant_axis: axis,
                variant_parent_name: itemName
            })
        }, function (response) {
            loader.find(".loadingSpinner:first").remove();
            if (response.type === 'success') {
                PosnicPro.alert('success', response.message || 'Family created');
                PosnicPro.items.addItemButton();
                PosnicPro.items.loadSelectUnit();
                $('#item_image_upload_form')[0].reset();
                PosnicPro.stocklogs.viewLowStockDashboard();
                PosnicPro.sales.itemsMenu.onlineProductList();
                /* IC2: ONE after-save rule - every create stays on the form
                   for the next entry (edit is what returns to the list).
                   Variant mode resets to the plain-item state. */
                $('#load_price_fields').html('').hide();
                $('#show_variant_fields').hide();
                $('#show_price_fields,#sku_card_col').show();
                $('#product_without_variant').prop('checked', true);
                PosnicPro.items.itemClearForm();
                $('#items_name').focus();
            } else {
                PosnicPro.alert(response.type || 'error', response.message || 'Could not create the family');
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not create the family - nothing was kept.');
        });
    },
    /*This Items Function Used To Add & Edit*/
    item: function () {
        var loader = $(".loader-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        if ($('#items_name').val() !== '') {
            PosnicPro.action = 'add';
            var method = 'POST';
            var url = 'items';
            if ($('#itemid').val() !== '') {
                PosnicPro.action = 'edit';
                method = 'PUT';
                url += '/' + $('#itemid').val();
            }

            /* CREATE with variants: the atomic family path. Edits and
               plain items keep the legacy flow below untouched. */
            if (PosnicPro.action === 'add' && $('#product_with_variant').is(':checked')
                && ($('#item_variant_list').val() || []).length > 0) {
                PosnicPro.items.saveVariantFamily(loader);
                return;
            }

            var variant_list = $('#item_variant_list').val();
            var variant_array = ["variant"];
            var variant_value = (variant_list.length > 0) ? $('#item_variant_list').val() : variant_array;
            $(variant_value).each(function (key, variantName) {
                var itemName = $("#items_name").val();
                var unitDetail = $("#items_unit").select2("data");
                let unitVariantDetail = $('#items_unit_' + key + '');
                let unitVariantValue = unitVariantDetail.find(':selected').attr('data-unit-value');
                let unitVariantId = unitVariantDetail.find(':selected').attr('data-unit-id');

                if ($("#product_without_variant").is(":checked")) {
                    var name = itemName;
                    var param_fields = {
                        sku_id: $('#items_itemid').val(),
                        barcode_id: $('#items_barcodeid').val(),
                        mrp_price: $('#items_mrp_price').val(),
                        company_price: $('#items_company_price').val(),
                        selling_price: $('#items_selling_price').val(),
                        available_quantity: $('#items_available_quantity').val(),
                        position: $('#items_sort').val(),
                        items_mfg_date: $('#items_mfg_date').val(),
                        items_expiry_date: $('#items_expiry_date').val(),
                        unit: (unitDetail.length > 0) ? unitDetail[0].element.attributes['data-unit-value'].value : null,
                        unit_id: (unitDetail.length > 0) ? unitDetail[0].element.attributes['data-unit-id'].value : null,
                        discount_amount: $('#items_discount_amount').val(),
                        discount_percentage: $('#items_discount_percentage').val()
                    };
                } else {
                    var name = itemName + ' / ' + variantName;
                    var param_fields = {
                        sku_id: $('#items_itemid_' + key + '').val(),
                        barcode_id: $('#items_barcodeid_' + key + '').val(),
                        mrp_price: $('#items_mrp_price_' + key + '').val(),
                        company_price: $('#items_company_price_' + key + '').val(),
                        selling_price: $('#items_selling_price_' + key + '').val(),
                        available_quantity: $('#items_available_quantity_' + key + '').val(),
                        position: $('#items_sort_' + key + '').val(),
                        unit: unitVariantValue,
                        unit_id: unitVariantId,
                        discount_amount: $('#items_discount_amount_' + key + '').val(),
                        discount_percentage: $('#items_discount_percentage_' + key + '').val()
                    };
                }

                var content = $('#items_description');
                var hsnValue = $("input[name='hsntax_radio_value']:checked").val();
                if (hsnValue === 'hsncode') {
                    var tax_value = $('#hsn_tax').val();
                    var hsn_code = $('#items_hsncode').val();
                    var tax_id = '';
                    var tax_name = '';
                    var tax_method = 'hsn';
                } else {
                    var taxDetail = $("#items_tax").select2("data");
                    var tax_value = taxDetail[0].element.attributes['data-tax-value'].value;
                    var tax_id = taxDetail[0].element.attributes['data-tax-id'].value;
                    var tax_name = taxDetail[0].element.attributes['data-tax-name'].value;
                    var hsn_code = 0;
                    var tax_method = 'default';
                }
                var categoryDetail = $("#items_category").select2("data");
                var formData = {
                    id: $('#itemid').val(),
                    name: name,
                    supplier_id: $('#items_supplier_id').val(),
                    supplier_name: $('#items_supplier').val(),
                    category_id: categoryDetail[0].element.attributes['data-category-id'].value,
                    category_name: categoryDetail[0].element.attributes['data-category-name'].value,
                    cover_image: $('#item_logo').val(),
                    inventory: $('#item_track_inventory').is(':checked'),
                    sales_channel: $('#item_sales_channel').is(':checked'),
                    ecommerce: $('#item_ecommerce').is(':checked'),
                    negative_stock: $('#item_negative_stock').is(':checked'),
                    item_weight_machine_based: $('#item_weight_machine_based').is(':checked'),
                    open_price: $('#item_open_price').is(':checked'),
                    tile_color: $('#item_tile_color').val() || PosnicPro.autoTile($('#items_name').val()).color,
            tile_shape: $('#item_tile_shape').val() || PosnicPro.autoTile($('#items_name').val()).shape,
            plu_code: $('#items_plu_code').val() || '',
                    item_kind: $('#item_is_service').is(':checked') ? 'service' : 'product',
                    service_unit: $('#item_service_unit').val() || 'fixed',
                    brand: $('#items_brand').val(),
                    tags: PosnicPro.items._tagList(),
                    reorder_point: $('#items_reorder_point').val() === '' ? undefined : Number($('#items_reorder_point').val()),
                    hsn_code: hsn_code,
                    hsn_description: $('#items_hsndescription').val(),
                    tax_method: tax_method,
                    tax_name: tax_name,
                    tax_id: tax_id,
                    tax: tax_value,
                    tax_type: $('input[name="tax_radio_value"]:checked').val(),
                    description: content.val(),
                    image: PosnicPro.items.imageParams,
                    modifier_group_ids: PosnicPro.items._modifierGroupIds(),
                    barcodes: PosnicPro.items._altBarcodes(),
                    purchase_unit: $('#items_purchase_unit').val(),
                    conversion_factor: $('#items_conversion_factor').val()
                };
                var params = {
                    method: method,
                    url: url,
                    data: JSON.stringify(Object.assign(formData, param_fields))
                };
                var typedSku = (formData.sku_id || '').trim();
                PosnicPro.request(params, function (response) {

                    if (response.type === 'success') {
                        var data = response.data;
                        // The server keeps a genuinely unique SKU and rewrites a
                        // colliding one to the next free number - say so instead
                        // of saving silently under a different SKU.
                        if (typedSku && data.itemid && String(data.itemid) !== typedSku) {
                            PosnicPro.alert('info', 'Saved with SKU ' + data.itemid + ' — ' + typedSku + ' was already taken');
                        }
                        PosnicPro.items.addItemButton();
                        PosnicPro.items.loadSelectUnit();
                        $('#item_image_upload_form')[0].reset();
                        PosnicPro.stocklogs.viewLowStockDashboard();
                        PosnicPro.sales.itemsMenu.onlineProductList();
                        if (PosnicPro.action === 'add') {
                            $('#show_last_created_item').show();
                            // The rapid-entry loop: cursor back on the name.
                            $('#items_name').focus();
                        }
                        var path = '#/items/' + data.id;
                        $('#last_created_item').attr('href', path);
                        var itemDetails = {
                            "item_id": data.id,
                            "item_name": data.name,
                            "selling_price": data.selling_price,
                            "mrp_price": data.mrp_price,
                            "itemid": data.itemid,
                            "available_quantity": data.available_quantity,
                            "company_price": data.company_price,
                            "barcode_id": data.barcode_id,
                            "discount_amount": data.discount_amount,
                            "discount_percentage": data.discount_percentage,
                            "tax": data.tax,
                            "tax_type": data.tax_type,
                            "category_id": data.category_id,
                            "category_name": data.category_name,
                            "supplier_id": data.supplier_id,
                            "supplier_name": data.supplier_name
                        };
                        var newPrice = window.location.hash.slice(1);

                        if (newPrice === '/items/new/addnewitem') {
                            if (PosnicPro.items.itemStatus === 'receivingpage') {

                                hasher.replaceHash('receivings/new');
                                PosnicPro.receivings.addReceivingLineItems(itemDetails);
                            } else {

                                hasher.replaceHash('sales/new');
                                PosnicPro.sales.addSalesLineItems(itemDetails);
                            }
                            loader.find(".loadingSpinner:first").remove();
                            return false;
                        }

                        if (newPrice === '/receivings/items/new') {
                            $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
                            $(".vertical-menu li a").removeClass("active");
                            $('#v-pills-purchase-tab').addClass('active');
                            $('#v-pills-purchase').addClass('show active');
                            if (PosnicPro.receivings.editPriceAction === 'add') {
                                hasher.setHash('receivings/new');
                                PosnicPro.receivings.addReceivingLineItems(itemDetails);
                                $('#view_receiving_page').addClass('active');
                            } else {
                                hasher.setHash('receivings/' + PosnicPro.receivings.receivingAddId + '/edit');
                                setTimeout(function () {
                                    PosnicPro.receivings.addReceivingLineItems(itemDetails);
                                }, 1000);
                                $('.view_receivings_page').addClass('active');
                            }

                            loader.find(".loadingSpinner:first").remove();
                            return false;
                        }

                        $('.get-items-value').val('');
                        $('.get-items-price').val('0');
                        $('#item-display-preview').html('');
                        $('#item_logo').val('item.svg');
                        PosnicPro.items.imageParams = [];
                        $('.item_add').trigger('reset');
                        $('#items_description').val('');
                        loader.find(".loadingSpinner:first").remove();
                        $('#hsn_code_show,#hsn_tax').hide();
                        $('#default_tax').show();
                        if (PosnicPro.local.get('default_tax_enable_disable') === 'false') {
                            $('#items_tax').val(1).trigger('change.select2');
                        } else {
                            var taxDetail = PosnicPro.local.get('default_tax_id');
                            $('#items_tax').val(taxDetail).trigger("change");
                        }
                        var defaultsupplier = JSON.parse(PosnicPro.local.get('defaultsupplier'));
                        if (PosnicPro.local.get('default_supplier_enable_disable') === 'false') {
                            $('#items_supplier_id').val('');
                            $('#items_supplier').val('');
                        } else {
                            $('#items_supplier_id').val(defaultsupplier.supplier_id);
                            $('#items_supplier').val(defaultsupplier.supplier_name);
                        }
                        $(".items_category").val('').trigger('change.select2');
                        $(".items_category").select2({
                            placeholder: "Choose a Category"
                        });
                        $("#items_variant").val(1).trigger('change.select2');
                        $("#items_variant").select2({
                            placeholder: "Choose a Variant"
                        });
                        $('#item_variant_list,#load_price_fields').html('');
                        if ($('#show_variant_fields').css('display') === 'none') {
                            $('#product_without_variant').prop('checked', true);
                            $('#product_with_variant').prop('checked', false);
                        } else {
                            $('#product_without_variant').prop('checked', false);
                            $('#product_with_variant').prop('checked', true);
                        }

                        PosnicPro.alert(response.type, response.message);
                        /*This function while add new item from another page after complete add items go to previous page*/
                        /*END*/

                        if (PosnicPro.action === 'edit') {
                            var editPrice = window.location.hash.slice(1);
                            if (editPrice === '/receivings/' + data.id + '/price') {
                                $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
                                $(".vertical-menu li a").removeClass("active");
                                $('#v-pills-purchase-tab').addClass('active');
                                $('#v-pills-purchase').addClass('show active');
                                if (PosnicPro.receivings.editPriceAction === 'add') {
                                    hasher.setHash('receivings/new');
                                    PosnicPro.receivings.addReceivingLineItems(itemDetails);
                                    $('#view_receiving_page').addClass('active');
                                } else {
                                    hasher.setHash('receivings/' + PosnicPro.receivings.receivingAddId + '/edit');
                                    setTimeout(function () {
                                        PosnicPro.receivings.removeLineItemReceiving(data.id);
                                        PosnicPro.receivings.addReceivingLineItems(itemDetails);
                                    }, 1000);
                                    $('.view_receivings_page').addClass('active');
                                }

                                loader.find(".loadingSpinner:first").remove();
                                return false;
                            }
                            PosnicPro.items.itemsTable('items');
                            hasher.setHash('items');
                        }

                    } else {
                        PosnicPro.alert(response.type, response.message);
                    }
                }, function (xhr) {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type, response.message);
                });
            });
            return false;
        }
    },
    /*TO display the item details*/
    viewItem: function (id) {
        var loader = $(".loader-view-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('items/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.items.viewItemData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewItemData: function (response) {
        $('#v-pills-inventory').addClass('show active');
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-item-details").addClass("sidebarview");
        $("#item-detail-tab").addClass("active");
        $("#item_detail").addClass("active show");
        $("#item-sale-tab,#item-image-tab,#item-description-tab,#item-pricehistory-tab").removeClass("active");
        $("#item_sale,#item_image,#description_detail,#item_price_history").removeClass("active show");
        $('#show_product_image,#item-image-tab,#item-description-tab').hide();
        var data = response.data;

        $.each(data, function (key, val) {
            if (val === '') {
                $('#item_view_' + key).text('');
            } else {
                $('#item_view_' + key).text(val);
            }
        });
        let unit = (typeof (data.unit) != "undefined" && data.unit !== null) ? data.unit : "qty";
        $('#item_view_units').text(unit);
        if (response.data.tax_method === 'default') {
            $('.item-taxdefault').show();
            $('.item-hsntax').hide();
        } else {
            $('.item-taxdefault').hide();
            $('.item-hsntax').show();
        }
        var updateCreateDate = PosnicPro.convertDate(response.data.created_date);
        $('#item_view_date').text(updateCreateDate);
        if (data.discount_amount > 0) {
            var currency = PosnicPro.local.get('currencySign');
            $('.item-discount-sign').html(currency);
            $('.item-discount-value').html(data.discount_amount);
        } else {
            $('.item-discount-sign').html('%');
            $('.item-discount-value').html(data.discount_percentage);
            if (data.discount_amount === 0 && data.discount_percentage === 0) {
                $('.item-discount-value').html('0');
            }
        }
        var sign = $('.item-discount-sign').html();
        if (sign === '%') {
            $('.discount_amountval').css("display", "none");
            $('.discount_percentageval').css("display", "block");
        } else {
            $('.discount_amountval').css("display", "block");
            $('.discount_percentageval').css("display", "none");
        }
        if (data.track_inventory === true) {
            $('#item-access').removeClass('badge-danger').addClass('badge-success');
            $('#item-view-access').removeClass('fa-times').addClass('fa-check');
            $('#inventory-access-item').html('ON');
        } else {
            $('#item-access').removeClass('badge-success').addClass('badge-danger');
            $('#item-view-access').removeClass('fa-check').addClass('fa-times');
            $('#inventory-access-item').html('OFF');
        }
        if (data.sales_channel === true) {
            $('#channel-access').removeClass('badge-danger').addClass('badge-success');
            $('#item-view-channel-access').removeClass('fa-times').addClass('fa-check');
            $('#channel-access-item').html('ON');
        } else {
            $('#channel-access').removeClass('badge-success').addClass('badge-danger');
            $('#item-view-channel-access').removeClass('fa-check').addClass('fa-times');
            $('#channel-access-item').html('OFF');
        }
        if (data.ecommerce === true) {
            $('#ecommerce-access').removeClass('badge-danger').addClass('badge-success');
            $('#item-view-ecommerce-access').removeClass('fa-times').addClass('fa-check');
            $('#ecommerce-access-item').html('ON');
        } else {
            $('#ecommerce-access').removeClass('badge-success').addClass('badge-danger');
            $('#item-view-ecommerce-access').removeClass('fa-check').addClass('fa-times');
            $('#ecommerce-access-item').html('OFF');
        }

        if (data.negative_stock === true) {
            $('#stock-access').removeClass('badge-danger').addClass('badge-success');
            $('#item-view-stock-access').removeClass('fa-times').addClass('fa-check');
            $('#stock-access-item').html('ON');
        } else {
            $('#stock-access').removeClass('badge-success').addClass('badge-danger');
            $('#item-view-stock-access').removeClass('fa-check').addClass('fa-times');
            $('#stock-access-item').html('OFF');
        }

        $('#item_view_mrpprice').number(data.mrp_price, 2);
        $('#item_view_companyprice').number(data.company_price, 2);
        $('#item_view_sellingprice').number(data.selling_price, 2);
        var image_path = (data.image && data.image !== "item.svg") ? data.image : 'static/images/default/item.svg';
        $('.itemimageview').attr('src', image_path);
        $('.itemimageview').attr('onerror', "this.onerror=null;this.src='static/images/default/item.svg';");
        $('.itemimageview').attr('id', data.image);
        $('.itemimageview').attr('onClick', 'PosnicPro.viewImage(this.id,\'item\')');
        $('#item_view_created_date').text(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(response.data.updated_date);
        $('#item_view_updated_date').text(updateUpdateDate);
        $('#item_view_image').html('');
        // Handle MongoDB date object format for manufacturing date
        var mfgDateValue = response.data.items_mfg_date;
        if (mfgDateValue && typeof mfgDateValue === 'object' && mfgDateValue.$date && mfgDateValue.$date.$numberLong) {
            mfgDateValue = parseInt(mfgDateValue.$date.$numberLong);
        }
        var updateMfgDate = mfgDateValue ? PosnicPro.convertDate(mfgDateValue) : 'N/A';
        $('#items_view_mfg_date').text(updateMfgDate);
        // Handle MongoDB date object format for expiry date
        var expDateValue = response.data.items_expiry_date;
        if (expDateValue && typeof expDateValue === 'object' && expDateValue.$date && expDateValue.$date.$numberLong) {
            expDateValue = parseInt(expDateValue.$date.$numberLong);
        }
        var updateExpDate = expDateValue ? PosnicPro.convertDate(expDateValue) : 'N/A';
        $('#items_view_expiry_date').text(updateExpDate);
        $.each(data.multi_image, function (key, val) {
            $('#item-image-tab').show();
            $('#show_product_image').show();
            var image_path = val.name;
            let img = jQuery('<img class="imagezoom item_tab_images" id="' + image_path + '" src="" style="height:150px; width:150px;border: 2px solid #ccc;border-radius: 10px;padding:5px;margin-right: 20px;" onclick="PosnicPro.viewImage(this.id);">');
            img.attr('src', image_path);
            $('#item_view_image').append(img);
        });
        $('#item_view_description_value,#item_description_value').html('');
        if (data.description !== '') {
            $('#item-description-tab').show();
            var desciptionInnerText = $('#item_view_description_value').html(data.description);
            $('#item_description_value').html(desciptionInnerText.prop("innerText"));
        }
    },
    /*
     * The family strip (V1): the edit page finally knows an item's
     * siblings. Chips link across the family; "+ Add" creates one new
     * linked member through the ordinary single-item POST - the server's
     * presence-gated passthrough stamps the link, no special endpoint.
     */
    renderFamilyStrip: function (data) {
        var strip = $('#item_family_strip');
        if (!strip.length) { return; }
        if (!data || !data.variant_group_id) { strip.hide().find('.family-chips').html(''); return; }
        var esc = function (s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        };
        var currentId = String(data.id || data._id || PosnicPro.record_id || '');
        PosnicPro.get({ url: 'items/family', data: { group_id: data.variant_group_id } }, function (r) {
            var rows = (r && r.data) || [];
            if (rows.length < 1) { strip.hide(); return; }
            PosnicPro.items._family = {
                group_id: String(data.variant_group_id),
                axis: rows[0].variant_axis || 'Variant',
                parent: rows[0].variant_parent_name || String(rows[0].name || '').split(' / ')[0],
            };
            var chips = '<span class="text-muted mr-2">' + esc(PosnicPro.items._family.axis) + ':</span>';
            rows.forEach(function (m) {
                var isCurrent = String(m.id) === currentId;
                chips += '<a href="#/items/' + esc(m.id) + '" class="badge ' +
                    (isCurrent ? 'badge-primary' : 'badge-light border') + ' mr-1" style="font-size:.8rem; padding:6px 10px;">' +
                    esc(m.variant_value || m.name) + '</a>';
            });
            chips += '<button type="button" class="btn btn-outline-primary btn-sm ml-2" ' +
                'onclick="PosnicPro.items.openAddValue();"><i class="feather icon-plus mr-1"></i>Add ' +
                esc(PosnicPro.items._family.axis) + '</button>';
            strip.find('.family-chips').html(chips);
            strip.css('display', 'flex');
        }, function () { strip.hide(); });
    },
    openAddValue: function () {
        var fam = PosnicPro.items._family;
        if (!fam) { return; }
        $('#family_add_modal').remove();
        $('body').append(
            '<div class="modal fade close_on_esc" id="family_add_modal" tabindex="-1" role="dialog" aria-hidden="true">' +
            '<div class="modal-dialog modal-sm" role="document"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title">Add ' + fam.axis + '</h5>' +
            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>' +
            '<div class="modal-body">' +
            '<div class="form-group"><label style="font-weight:600; font-size:.85rem;">' + fam.axis + ' value</label>' +
            '<input type="text" class="form-control" id="family_add_value" maxlength="60" placeholder="e.g. XL"></div>' +
            '<div class="form-group"><label style="font-weight:600; font-size:.85rem;">Selling price</label>' +
            '<input type="number" min="0" step="0.01" class="form-control" id="family_add_price" value="' + ($('#items_selling_price').val() || '') + '"></div>' +
            '<div class="form-group"><label style="font-weight:600; font-size:.85rem;">Barcode <small class="text-muted">(optional)</small></label>' +
            '<input type="text" class="form-control" id="family_add_barcode"></div>' +
            '<div class="form-group mb-0"><label style="font-weight:600; font-size:.85rem;">Opening stock</label>' +
            '<input type="number" min="0" class="form-control" id="family_add_qty" value="0"></div>' +
            '<small class="form-text text-muted">Category, tax, supplier and the other settings copy from this item.</small>' +
            '</div>' +
            '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancel</button>' +
            '<button type="button" class="btn btn-outline-primary" id="family_add_btn" onclick="PosnicPro.items.submitAddValue();">Add</button>' +
            '</div></div></div></div>'
        );
        $('#family_add_modal').modal('show');
        setTimeout(function () { $('#family_add_value').trigger('focus'); }, 400);
    },
    submitAddValue: function () {
        var fam = PosnicPro.items._family;
        var value = ($('#family_add_value').val() || '').trim();
        if (!fam || !value) { PosnicPro.alert('warning', 'Enter the new value.'); return; }
        $('#family_add_btn').prop('disabled', true);
        var shared = PosnicPro.items._sharedItemFields();
        var payload = Object.assign({}, shared, {
            name: fam.parent + ' / ' + value,
            variant_group_id: fam.group_id,
            variant_axis: fam.axis,
            variant_value: value,
            variant_parent_name: fam.parent,
            sku_id: '',
            barcode_id: ($('#family_add_barcode').val() || '').trim(),
            mrp_price: $('#items_mrp_price').val(),
            company_price: $('#items_company_price').val(),
            selling_price: $('#family_add_price').val(),
            available_quantity: $('#family_add_qty').val() || '0',
            position: $('#items_sort').val(),
            unit: ($("#items_unit").select2('data')[0] || { element: { attributes: {} } }).element
                ? ($("#items_unit").find(':selected').attr('data-unit-value') || null) : null,
            unit_id: $("#items_unit").find(':selected').attr('data-unit-id') || null,
            discount_amount: $('#items_discount_amount').val(),
            discount_percentage: $('#items_discount_percentage').val()
        });
        PosnicPro.post({ url: 'items', data: JSON.stringify(payload) }, function (r) {
            $('#family_add_btn').prop('disabled', false);
            if (r.type === 'success') {
                $('#family_add_modal').modal('hide');
                PosnicPro.alert('success', fam.parent + ' / ' + value + ' added');
                PosnicPro.items.renderFamilyStrip({
                    variant_group_id: fam.group_id,
                    id: PosnicPro.record_id
                });
            } else {
                PosnicPro.alert(r.type || 'error', r.message || 'Could not add it.');
            }
        }, function (xhr) {
            $('#family_add_btn').prop('disabled', false);
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not add it.');
        });
    },
    /*Edit item dsetails*/
    editItem: function (id) {
        var loader = $(".loader-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#items_new').show();
        $('#items_description').html('').text('');
        $('#items_description').val('');
        $('#item-display-preview').html('');
        PosnicPro.items.imageParams = [];
        var params = {
            url: 'items/getItemDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                $('#show_variant_fields').hide();
                $('#show_price_fields,#sku_card_col').show();
                var data = response.data;
                // Family strip (V1): if this item belongs to a variant
                // family, show its siblings and the add-value button. The
                // strip is what finally makes families editable after
                // creation - the old flow forgot the relationship entirely.
                PosnicPro.items.renderFamilyStrip(data);
                PosnicPro.items.renderModifierGroups(data.modifier_group_ids || []);
                PosnicPro.record_id = id;
                $('#itemid').val(PosnicPro.record_id);
                $('#items_name').val(data.name);
                $('#items_itemid').val(data.itemid);
                $('#items_barcodeid').val(data.barcode_id);
                $('#items_barcodes_alt').val(Array.isArray(data.barcodes) ? data.barcodes.join(', ') : '');
                $('#items_purchase_unit').val(data.purchase_unit || '');
                $('#items_conversion_factor').val(data.conversion_factor || '');
                $('#items_hsncode').val(data.hsncode);
                $('#items_hsndescription').val(data.hsndescription);
                $('#items_supplier').val(data.supplier_name);
                $('#items_supplier_id').val(data.supplier_id);
                $("#items_category").val(data.category_id).trigger("change");
                $('#items_discount_amount').val(data.discount_amount);
                $('#items_discount_percentage').val(data.discount_percentage);
                $('#items_mrp_price').val(data.mrp_price);
                $('#items_company_price').val(data.company_price);
                $('#items_selling_price').val(data.selling_price);
                $('#items_available_quantity').val(data.available_quantity);
                $("#items_unit option[value='" + data.unit + "']").prop("selected", true);
                if (data.items_mfg_date) {
                    var mfgDate = new Date(data.items_mfg_date);
                    var formattedMfgDate = mfgDate.getFullYear() + '-' + ('0' + (mfgDate.getMonth() + 1)).slice(-2) + '-' + ('0' + mfgDate.getDate()).slice(-2);
                    $('#items_mfg_date').val(formattedMfgDate);
                } else {
                    $('#items_mfg_date').val('');
                }
                if (data.items_expiry_date) {
                    var expiryDate = new Date(data.items_expiry_date);
                    var formattedExpiryDate = expiryDate.getFullYear() + '-' + ('0' + (expiryDate.getMonth() + 1)).slice(-2) + '-' + ('0' + expiryDate.getDate()).slice(-2);
                    $('#items_expiry_date').val(formattedExpiryDate);
                } else {
                    $('#items_expiry_date').val('');
                }
                $('#item_title_data').text('Edit');
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#item_button_title').text('புதுப்பி') : $('#item_button_title').text('Update');
                if ((data.itemid === data.barcode_id) && (data.itemid !== '')) {
                    $("#same_as_sku").prop("checked", true);
                } else {
                    $("#same_as_sku").prop("checked", false);
                }
                $('#items_sort').val(data.sort_order);
                if (data.description !== '') {
                    $('#items_description').val(
                        $('<div>').html(data.description).text() || data.description
                    );
                }
                (data.track_inventory === true) ? $('#item_track_inventory').prop('checked', true) : $('#item_track_inventory').prop("checked", false);
                (data.sales_channel === true) ? $('#item_sales_channel').prop('checked', true) : $('#item_sales_channel').prop("checked", false);
                (data.ecommerce === true) ? $('#item_ecommerce').prop('checked', true) : $('#item_ecommerce').prop("checked", false);
                (data.negative_stock === true) ? $('#item_negative_stock').prop('checked', true) : $('#item_negative_stock').prop("checked", false);
                (data.item_weight_machine_based === true) ? $('#item_weight_machine_based').prop('checked', true) : $('#item_weight_machine_based').prop("checked", false);
                (data.open_price === true) ? $('#item_open_price').prop('checked', true) : $('#item_open_price').prop("checked", false);
                $('#item_is_service').prop('checked', data.item_kind === 'service');
                $('#item_service_unit').val(data.service_unit || 'fixed');
                PosnicPro.items.applyServiceMode();
                $('#items_brand').val(data.brand || '');
                $('#items_tags').val(Array.isArray(data.tags) ? data.tags.join(', ') : '');
                $('#items_reorder_point').val(data.reorder_point === null || data.reorder_point === undefined ? '' : data.reorder_point);
                PosnicPro.items.setTileColor(data.tile_color || '');
                PosnicPro.items.setTileShape(data.tile_shape || '');
                $('#items_plu_code').val(data.plu_code || '');
                $("#items_tax").val(data.tax_id).trigger("change");
                $("#items_unit").val(data.unit_id).trigger("change");
                var radionbutton = $('#items_discount_amount').val();
                if (radionbutton > 0) {
                    $("#item_radio_discount_amount").prop('checked', 'checked');
                    $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#items_discount_amount').removeAttr('disabled', 'disabled').show();
                } else {
                    $("#item_radio_discount_percentage").prop('checked', 'checked');
                    $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#items_discount_percentage').removeAttr('disabled', 'disabled').show();
                }

                if (data.hsncode > 0) {
                    $('#item_tax_hsncode').prop('checked', true);
                    $('#hsn_code_show').show();
                    $('#hsn_tax').show().val(data.tax);
                    $('#default_tax').hide();
                } else {
                    $('#item_tax_default').prop('checked', true);
                    $('#hsn_code_show').hide();
                    $('#hsn_tax').hide();
                    $('#default_tax').show();
                }
                $('#item_upload_image_status').val('no');
                (data.tax_type === 'inclusive') ? $('#item_tax_inclusive').prop('checked', true) : $('#item_tax_exclusive').prop("checked", true);
                $.each(data.multi_image, function (key, val) {
                    var image_path = val.name;
                    var convertFunction = PosnicPro.convertFileToDataURLviaFileReader;
                    convertFunction(image_path, function (base64Img) {
                        var strImage = base64Img.replace(/^data:image\/[a-z]+;base64,/, "");
                        PosnicPro.items.imageParams[key] = {
                            name: val.name,
                            data: strImage,
                            size: base64Img.length,
                            cover: val.cover
                        };
                    });

                    $('#item-display-preview').append(
                            '<div id="selector_' + key + '" class="receiving-image-wrapper image-area" style="position: relative;"> \
                        <img class="image_style" class="img-thumbnail" src="' + image_path + '" \
                        title="' + escape(val.name) + '" /><br /> \
                    <span id="coverimage_selector_' + key + '" class="coverImageAdd" style="display: block;border: 1px solid #ddd;border-radius: 5px;margin-top: 2px; background: #506fe4; color: #fff" onclick="PosnicPro.items.coverImageEdit(this.id,\'' + key + '\',\'' + val.name + '\',\'' + val.size + '\')">Choose Cover</span><a class="remove-image" style="cursor:pointer;display: inline;position: absolute; top: -10px; right: -10px; border-radius: 10em; padding: 2px 6px 3px; text-decoration: none; font: 700 21px/20px sans-serif; background: #f48787; border: 3px solid #fff; color: #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.5); -webkit-transition: background 0.5s; transition: background 0.5s;" onclick="PosnicPro.items.image_edit_remove_selected(\'' + key + '\',\'' + val.name + '\')">&#215;</a> \
                        </div>');

                    if (val.cover === "yes") {
                        $('#item_logo').val(val.name);
                        $('#coverimage_selector_' + key).html('');
                        var styles = {
                            display: 'block',
                            border: '1px solid #ddd',
                            'border-radius': '5px',
                            'margin-top': '2px',
                            background: 'green',
                            color: '#fff'
                        };
                        $('#coverimage_selector_' + key).css(styles).append('Cover');
                    }

                });

            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    resetEditButton: function (id) {
        PosnicPro.items.editItem(id);
    },
    addItemButton: function () {
        var loader = $(".loader-item");
        loader.find(".loadingSpinner:first").remove();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('#v-pills-inventory-tab,#new_items_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('#item_title_data').text('Add');
        $('#itemid').val('');
        // A fresh entry: the discount fields are untouched again, so a
        // category pick may fill them (applyCategoryDiscount checks this).
        PosnicPro.items._discountTouched = false;
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#item_button_title').text('சேமி') : $('#item_button_title').text('Save');

        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#show_last_created_item').hide();
        if (PosnicPro.local.get('sameassku') === "true") {
            PosnicPro.items.sameAsSku(true);
        } else {
            PosnicPro.items.sameAsSku(false);
        }

        if ($("#product_without_variant").is(":checked")) {
            $('#show_variant_fields').hide();
            $('#show_price_fields,#sku_card_col').show();
            $("#load_price_fields").html('');
            $("#show-hide-item-discount").show();
        } else {
            $('#show_price_fields,#sku_card_col').hide();
            $('#show_variant_fields').show();
            $('#show_variant_fields').css("display", "block");
            $("#show-hide-item-discount").hide();
        }

        var defaultsupplier = JSON.parse(PosnicPro.local.get('defaultsupplier'));
        if (defaultsupplier.supplier_id !== $('#items_supplier_id').val() && PosnicPro.local.get('default_supplier_enable_disable') === 'false') {
            $('#items_supplier_id').val();
            $('#items_supplier').val();
        } else if (PosnicPro.local.get('default_supplier_enable_disable') === 'false') {
            $('#items_supplier_id').val('');
            $('#items_supplier').val('');
        } else {
            $('#items_supplier_id').val(defaultsupplier.supplier_id);
            $('#items_supplier').val(defaultsupplier.supplier_name);
        }

        if (PosnicPro.local.get('default_tax_enable_disable') === 'false') {
            $('#items_tax').val();
        } else {
            var taxDetail = PosnicPro.local.get('default_tax_id');
            $('#items_tax').val(taxDetail).trigger("change");
        }

        $(".items_category").val();
        $(".items_category").select2({
            placeholder: "Choose a Category"
        });
        $("#items_variant").val();
        $("#items_variant").select2({
            placeholder: "Choose a Variant"
        });

        if (PosnicPro.local.get('setting-discount-amount') > 0) {
            $("#item_radio_discount_amount").prop('checked', 'checked');
            $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide().val('0');
            $('#items_discount_amount').removeAttr('disabled', 'disabled').show().val(PosnicPro.local.get('setting-discount-amount'));
        } else {
            $("#item_radio_discount_percentage").prop('checked', 'checked');
            $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide().val('0.00');
            $('#items_discount_percentage').removeAttr('disabled', 'disabled').show().val(PosnicPro.local.get('setting-discount-percentage'));
        }

    },
    exportItems: function () {
        PosnicPro.exportTableData(PosnicPro.items_checkbox, 'items');
    },
    deleteSelectedItems: function () {
        PosnicPro.deleteTableData(PosnicPro.items_checkbox, 'items');
    },

    /*
     * Bulk price update.
     *
     * A shop that changes prices often should not have to open every item, or
     * export a file and re-import it (which is how images were being lost). It
     * raises or lowers one price field across all items, or one category, by a
     * percentage or a flat amount. The server does the arithmetic and records
     * every change in price history - this is only the form.
     */
    openBulkPrice: function () {
        $('input[name="bulk_price_scope"][value="all"]').prop('checked', true);
        $('.bulk-price-category-row').hide();
        $('#bulk_price_field').val('selling_price');
        $('#bulk_price_direction').val('increase');
        $('#bulk_price_op').val('percent');
        $('.bulk-price-unit').text('%');
        $('#bulk_price_value').val('');
        $('#bulk_price_skip').prop('checked', true);
        $('#bulk_price_check_result').hide().empty();
        $('#bulk_price_submit').prop('disabled', false);
        PosnicPro.items.loadBulkPriceCategories();
        $('#bulk_price_modal').modal('show');
    },

    // Read + validate the bulk-price form once, for both Check and Update.
    readBulkPriceForm: function () {
        var scope = $('input[name="bulk_price_scope"]:checked').val();
        var value = $('#bulk_price_value').val();
        if (value === '' || isNaN(value) || Number(value) < 0) {
            PosnicPro.alert('warning', 'Enter a valid amount.');
            return null;
        }
        var category_id = (scope === 'category') ? $('#bulk_price_category').val() : null;
        if (scope === 'category' && !category_id) {
            PosnicPro.alert('warning', 'Choose a category.');
            return null;
        }
        return {
            scope: scope,
            category_id: category_id,
            field: $('#bulk_price_field').val(),
            op: $('#bulk_price_op').val(),
            value: value,
            direction: $('#bulk_price_direction').val()
        };
    },

    // Dry-run the change and show what it would do - how many change, and how
    // many would end up over MRP or under cost - before anything is written.
    checkBulkPrice: function () {
        var form = PosnicPro.items.readBulkPriceForm();
        if (!form) return false;
        var currency = PosnicPro.local.get('currencySign') || '';
        var box = $('#bulk_price_check_result');
        box.html('<span class="dim">Checking...</span>').show();

        PosnicPro.post({ url: 'items/bulkPricePreview', data: JSON.stringify(form) }, function (response) {
            if (response.type !== 'success') {
                box.hide();
                PosnicPro.alert(response.type, response.message);
                return;
            }
            var d = response.data || {};
            var esc = function (v) { return $('<div>').text(v == null ? '' : v).html(); };
            var line = function (rows, label, limitLabel) {
                if (!rows || !rows.length) return '';
                var sample = rows.slice(0, 5).map(function (r) {
                    return '<li>' + esc(r.name) + ': ' + currency + Number(r.new_value).toFixed(2) +
                        ' <span class="dim">(' + limitLabel + ' ' + currency + Number(r.limit).toFixed(2) + ')</span></li>';
                }).join('');
                var more = rows.length > 5 ? '<li class="dim">and ' + (rows.length - 5) + ' more</li>' : '';
                return '<div style="margin-top:6px;"><b>' + label + '</b><ul style="margin:4px 0 0; padding-left:18px;">' + sample + more + '</ul></div>';
            };

            var hasIssue = (d.exceedsMrpCount || 0) + (d.belowCostCount || 0) > 0;
            var head = '<b>' + (d.willChange || 0) + '</b> of ' + (d.total || 0) + ' item(s) would change.';
            var body = '';
            if (hasIssue) {
                body += line(d.exceedsMrp, (d.exceedsMrpCount || 0) + ' would go ABOVE MRP', 'MRP');
                body += line(d.belowCost, (d.belowCostCount || 0) + ' would sell BELOW cost', 'cost');
                body += '<div class="dim" style="margin-top:6px; font-size:12px;">With "skip" ticked, these are left unchanged.</div>';
            } else {
                body = '<div class="text-success" style="margin-top:4px;"><i class="feather icon-check"></i> No item would break MRP or cost.</div>';
            }
            box.attr('class', hasIssue ? 'alert alert-warning' : 'alert alert-success')
                .css({ 'font-size': '12.5px', 'padding': '8px 12px' })
                .html(head + body).show();
        }, function () {
            box.hide();
        });
        return false;
    },

    toggleBulkCategory: function () {
        var scope = $('input[name="bulk_price_scope"]:checked').val();
        (scope === 'category') ? $('.bulk-price-category-row').show() : $('.bulk-price-category-row').hide();
    },

    bulkPriceOpChanged: function () {
        var op = $('#bulk_price_op').val();
        var currency = PosnicPro.local.get('currencySign') || '';
        $('.bulk-price-unit').text(op === 'percent' ? '%' : (currency || 'Amt'));
    },

    loadBulkPriceCategories: function () {
        var sel = $('#bulk_price_category');
        var params = { url: 'categories/getCategoryAjaxList', data: 'query=' };
        PosnicPro.get(params, function (response) {
            sel.empty();
            $.map(response.suggestions || [], function (dataItem) {
                sel.append('<option value="' + dataItem.id + '">' + dataItem.name + '</option>');
            });
            // Keep the dropdown inside the modal so it is not clipped or lost
            // behind it (a known select2-in-modal quirk).
            sel.select2({ placeholder: 'Choose a category', dropdownParent: $('#bulk_price_modal') });
        });
    },

    submitBulkPrice: function () {
        var form = PosnicPro.items.readBulkPriceForm();
        if (!form) return false;
        form.skipViolations = $('#bulk_price_skip').is(':checked');

        $('#bulk_price_submit').prop('disabled', true);
        var params = {
            url: 'items/bulkUpdatePrices',
            data: JSON.stringify(form)
        };
        PosnicPro.post(params, function (response) {
            $('#bulk_price_submit').prop('disabled', false);
            if (response.type === 'success') {
                $('#bulk_price_modal').modal('hide');
                PosnicPro.alert('success', response.message);
                PosnicPro.items.itemsTable();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function () {
            $('#bulk_price_submit').prop('disabled', false);
        });
        return false;
    },

    // ---- Bulk stock update: add/remove stock across items or a category, with
    // a note carried into the stock log. Mirrors bulk price; no MRP/cost rules. ----
    /* Stock adjustment with reasons (Loyverse study L2). Inventory count
       SETS stock to what was counted; Loss and Damage SUBTRACT what
       disappeared. Rows are picked via the receiving autocomplete endpoint
       (it carries current stock); the server logs every change with the
       reason as its process. */
    _adjRows: {},
    openStockAdjustment: function () {
        PosnicPro.items._adjRows = {};
        $('#stock_adjust_note').val('');
        $('#stock_adjust_search').val('');
        $('#stock_adjust_reason').val('Inventory count');
        $('#stock_adjust_custom').val('');
        $('#stock_adjust_custom_wrap').hide();
        PosnicPro.items.renderAdjRows();
        $('#stock_adjust_modal').modal('show');
        setTimeout(function () { $('#stock_adjust_search').focus(); }, 400);
    },
    /* The direction in force: seeded reasons imply theirs, custom says its own. */
    _adjMode: function () {
        var reason = $('#stock_adjust_reason').val();
        if (reason === '__custom__') { return $('#stock_adjust_mode').val() || 'subtract'; }
        if (reason === 'Inventory count') { return 'set'; }
        if (reason === 'Stock found') { return 'add'; }
        return 'subtract';
    },
    adjReasonChanged: function () {
        $('#stock_adjust_custom_wrap').toggle($('#stock_adjust_reason').val() === '__custom__');
        PosnicPro.items.renderAdjRows();
    },
    renderAdjRows: function () {
        var mode = PosnicPro.items._adjMode();
        $('#stock_adjust_qty_head').text(mode === 'set' ? 'Counted' : mode === 'add' ? 'Qty found' : 'Qty lost');
        var keys = Object.keys(PosnicPro.items._adjRows);
        if (!keys.length) {
            $('#stock_adjust_rows').html('<tr><td colspan="5" class="text-center text-muted">Search and pick items to adjust.</td></tr>');
            return;
        }
        var html = keys.map(function (id) {
            var r = PosnicPro.items._adjRows[id];
            var qty = Number(r.qty) || 0;
            var after = mode === 'set' ? qty : mode === 'add' ? (Number(r.stock) || 0) + qty : Math.max(0, (Number(r.stock) || 0) - qty);
            return '<tr>' +
                '<td>' + $('<span>').text(r.name).html() + '</td>' +
                '<td class="text-right">' + (Number(r.stock) || 0) + '</td>' +
                '<td class="text-right"><input type="number" min="0" class="form-control form-control-sm text-right adj-qty" data-id="' + id + '" value="' + qty + '" style="width:100px;display:inline-block;"></td>' +
                '<td class="text-right">' + after + '</td>' +
                '<td><a href="javascript:void(0)" class="text-danger adj-remove" data-id="' + id + '">&times;</a></td>' +
                '</tr>';
        }).join('');
        $('#stock_adjust_rows').html(html);
    },
    submitStockAdjustment: function () {
        var rows = Object.keys(PosnicPro.items._adjRows).map(function (id) {
            return { item_id: id, qty: Number(PosnicPro.items._adjRows[id].qty) || 0 };
        });
        if (!rows.length) {
            PosnicPro.alert('warning', 'Pick at least one item');
            return;
        }
        $('#stock_adjust_submit').prop('disabled', true);
        var reasonSel = $('#stock_adjust_reason').val();
        var reason = reasonSel === '__custom__' ? ($('#stock_adjust_custom').val() || '').trim() : reasonSel;
        if (!reason) {
            PosnicPro.alert('warning', 'Name the custom reason');
            $('#stock_adjust_submit').prop('disabled', false);
            return;
        }
        PosnicPro.post({
            url: 'items/stockAdjustment',
            data: JSON.stringify({
                reason: reason,
                mode: PosnicPro.items._adjMode(),
                note: $('#stock_adjust_note').val(),
                rows: rows
            })
        }, function (response) {
            $('#stock_adjust_submit').prop('disabled', false);
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') {
                $('#stock_adjust_modal').modal('hide');
                PosnicPro.items.itemsTable('items');
                PosnicPro.stocklogs.viewLowStockDashboard();
            }
        }, function (xhr) {
            $('#stock_adjust_submit').prop('disabled', false);
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not adjust stock');
        });
    },
    openBulkStock: function () {
        $('input[name="bulk_stock_scope"][value="all"]').prop('checked', true);
        $('.bulk-stock-category-row').hide();
        $('#bulk_stock_direction').val('increase');
        $('#bulk_stock_op').val('amount');
        $('.bulk-stock-unit').text('Qty');
        $('#bulk_stock_value').val('');
        $('#bulk_stock_note').val('');
        $('#bulk_stock_check_result').hide().empty();
        $('#bulk_stock_submit').prop('disabled', false);
        PosnicPro.items.loadBulkStockCategories();
        $('#bulk_stock_modal').modal('show');
    },

    readBulkStockForm: function () {
        var scope = $('input[name="bulk_stock_scope"]:checked').val();
        var value = $('#bulk_stock_value').val();
        if (value === '' || isNaN(value) || Number(value) < 0) {
            PosnicPro.alert('warning', 'Enter a valid quantity.');
            return null;
        }
        var category_id = (scope === 'category') ? $('#bulk_stock_category').val() : null;
        if (scope === 'category' && !category_id) {
            PosnicPro.alert('warning', 'Choose a category.');
            return null;
        }
        return {
            scope: scope,
            category_id: category_id,
            op: $('#bulk_stock_op').val(),
            value: value,
            direction: $('#bulk_stock_direction').val(),
            note: $('#bulk_stock_note').val()
        };
    },

    checkBulkStock: function () {
        var form = PosnicPro.items.readBulkStockForm();
        if (!form) return false;
        var box = $('#bulk_stock_check_result');
        box.html('<span class="dim">Checking...</span>').show();
        PosnicPro.post({ url: 'items/bulkStockPreview', data: JSON.stringify(form) }, function (response) {
            if (response.type !== 'success') {
                box.hide();
                PosnicPro.alert(response.type, response.message);
                return;
            }
            var d = response.data || {};
            var esc = function (v) { return $('<div>').text(v == null ? '' : v).html(); };
            var sample = (d.sample || []).slice(0, 5).map(function (r) {
                return '<li>' + esc(r.name) + ': ' + esc(r.old_value) + ' &rarr; <b>' + esc(r.new_value) + '</b></li>';
            }).join('');
            var more = (d.willChange > 5) ? '<li class="dim">and ' + (d.willChange - 5) + ' more</li>' : '';
            var head = '<b>' + (d.willChange || 0) + '</b> of ' + (d.total || 0) + ' item(s) would change.';
            var body = sample ? '<ul style="margin:4px 0 0; padding-left:18px;">' + sample + more + '</ul>' : '';
            box.attr('class', 'alert alert-info')
                .css({ 'font-size': '12.5px', 'padding': '8px 12px' })
                .html(head + body).show();
        }, function () {
            box.hide();
        });
        return false;
    },

    toggleBulkStockCategory: function () {
        var scope = $('input[name="bulk_stock_scope"]:checked').val();
        (scope === 'category') ? $('.bulk-stock-category-row').show() : $('.bulk-stock-category-row').hide();
    },

    bulkStockOpChanged: function () {
        var op = $('#bulk_stock_op').val();
        $('.bulk-stock-unit').text(op === 'percent' ? '%' : 'Qty');
    },

    loadBulkStockCategories: function () {
        var sel = $('#bulk_stock_category');
        var params = { url: 'categories/getCategoryAjaxList', data: 'query=' };
        PosnicPro.get(params, function (response) {
            sel.empty();
            $.map(response.suggestions || [], function (dataItem) {
                sel.append('<option value="' + dataItem.id + '">' + dataItem.name + '</option>');
            });
            sel.select2({ placeholder: 'Choose a category', dropdownParent: $('#bulk_stock_modal') });
        });
    },

    submitBulkStock: function () {
        var form = PosnicPro.items.readBulkStockForm();
        if (!form) return false;
        $('#bulk_stock_submit').prop('disabled', true);
        var params = { url: 'items/bulkUpdateStock', data: JSON.stringify(form) };
        PosnicPro.post(params, function (response) {
            $('#bulk_stock_submit').prop('disabled', false);
            if (response.type === 'success') {
                $('#bulk_stock_modal').modal('hide');
                PosnicPro.alert('success', response.message);
                PosnicPro.items.itemsTable();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function () {
            $('#bulk_stock_submit').prop('disabled', false);
        });
        return false;
    },
    itemImageFormSubmit: function () {

        if ($('#items_name').val() !== '') {
            var loader = $(".loader-item");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            let uniqueImageParams = PosnicPro.items.imageParams.filter((c, index) => {
                return PosnicPro.items.imageParams.indexOf(c) === index;
            });
            var params = {
                url: 'items/uploadItemMultiImage',
                data: JSON.stringify({
                    "items_image": uniqueImageParams

                })
            };

            PosnicPro.post(params, function (response) {
                PosnicPro.items.imageParams = [];
                $.each(response.data, function (key, val) {
                    if (val.cover === 'yes') {
                        $('#item_logo').val(val.name);
                    }
                    PosnicPro.items.imageParams[key] = {
                        name: val.name,
                        size: val.size,
                        cover: val.cover
                    };
                    $('#item-display-preview').html('');
                });
                PosnicPro.items.item();
                loader.find(".loadingSpinner:first").remove();
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });

        } else {
            PosnicPro.alert('error', 'Fill in the required fields.');
        }
        return false;
    },
    updateItemAvailability: function (id, isChecked) {
        var params = {
            url: 'items/updateKioskStatus',
            data: JSON.stringify({id: id, status: isChecked}),
            contentType: "application/json"
        };

        PosnicPro.post(params, function (response) {
            if (response.type !== 'success') {
                PosnicPro.alert('error', response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert('error', response.message);
        });
    },
    /*Clone item details*/
    cloneItem: function (id) {
        var loader = $(".loader-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-item").addClass("sidebarshow");
        $('#items_description').html('').text('');
        $('#items_description').val('');
        PosnicPro.get('items/' + id, function (response) {
            if (response.type === 'success') {
                hasher.setHash('items/new');
                $('#item_title_data').text('Clone');
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#item_button_title').text('நகல் & சேமி') : $('#item_button_title').text('Duplicate & Save');
                var data = response.data;
                $('#itemid').val('');
                $('#items_name').val(data.name + '_copy');
                $('#items_itemid').val(data.itemid);
                $('#items_barcodeid').val(data.barcode_id);
                $('#items_supplier').val(data.supplier_name);
                $('#items_supplier_id').val(data.supplier_id);
                $("#items_category").val(data.category_id).trigger("change");
                $('#items_discount_amount').val(data.discount_amount);
                $('#items_discount_percentage').val(data.discount_percentage);
                $('#items_mrp_price').val(data.mrp_price);
                $('#items_company_price').val(data.company_price);
                $('#items_selling_price').val(data.selling_price);
                $('#items_available_quantity').val(data.available_quantity);
                $('#item_upload_image_status').val('no');
                $('#item-display-preview').html('');
                $.each(data.multi_image, function (key, val) {
                    var image_path = val.name;
                    var convertFunction = PosnicPro.convertFileToDataURLviaFileReader;
                    convertFunction(image_path, function (base64Img) {
                        var strImage = base64Img.replace(/^data:image\/[a-z]+;base64,/, "");
                        PosnicPro.items.imageParams[key] = {
                            name: val.name,
                            data: strImage,
                            size: base64Img.length,
                            cover: val.cover
                        };
                    });
                    $('#item-display-preview').append(
                            '<div id="selector_' + key + '" class="receiving-image-wrapper image-area" style="position: relative;"> \
                        <img class="image_style" class="img-thumbnail" src="' + image_path + '" \
                        title="' + escape(val.name) + '" /><br /> \
                    <span id="coverimage_selector_' + key + '" class="coverImageAdd" style="display: block;border: 1px solid #ddd;border-radius: 5px;margin-top: 2px; background: #506fe4; color: #fff" onclick="PosnicPro.items.coverImageEdit(this.id,\'' + key + '\',\'' + val.name + '\',\'' + val.size + '\')">Choose Cover</span><a class="remove-image" style="cursor:pointer;display: inline;position: absolute; top: -10px; right: -10px; border-radius: 10em; padding: 2px 6px 3px; text-decoration: none; font: 700 21px/20px sans-serif; background: #f48787; border: 3px solid #fff; color: #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.5); -webkit-transition: background 0.5s; transition: background 0.5s;" onclick="PosnicPro.items.image_edit_remove_selected(\'' + key + '\',\'' + val.name + '\')">&#215;</a> \
                        </div>');

                    if (val.cover === "yes") {
                        $('#item_logo').val(val.name);
                        $('#coverimage_selector_' + key).html('');
                        var styles = {
                            display: 'block',
                            border: '1px solid #ddd',
                            'border-radius': '5px',
                            'margin-top': '2px',
                            background: 'green',
                            color: '#fff'
                        };
                        $('#coverimage_selector_' + key).css(styles).append('Cover');
                    }

                });

                $('#items_sort').val(data.sort_order);
                $('#items_hsncode').val(data.hsncode);
                $('#items_hsndescription').val(data.hsndescription);
                if (data.hsncode > 0) {
                    $('#item_tax_hsncode').prop('checked', true);
                    $('#hsn_code_show').show();
                    $('#hsn_tax').show().val(data.tax);
                    $('#default_tax').hide();
                } else {
                    $('#item_tax_default').prop('checked', true);
                    $('#hsn_code_show').hide();
                    $('#hsn_tax').hide();
                    $('#default_tax').show();
                }
                (data.track_inventory === true) ? $('#item_track_inventory').prop('checked', true) : $('#item_track_inventory').prop("checked", false);
                (data.sales_channel === true) ? $('#item_sales_channel').prop('checked', true) : $('#item_sales_channel').prop("checked", false);
                (data.ecommerce === true) ? $('#item_ecommerce').prop('checked', true) : $('#item_ecommerce').prop("checked", false);
                (data.negative_stock === true) ? $('#item_negative_stock').prop('checked', true) : $('#item_negative_stock').prop("checked", false);
                (data.item_weight_machine_based === true) ? $('#item_weight_machine_based').prop('checked', true) : $('#item_weight_machine_based').prop("checked", false);
                (data.open_price === true) ? $('#item_open_price').prop('checked', true) : $('#item_open_price').prop("checked", false);
                $('#item_is_service').prop('checked', data.item_kind === 'service');
                $('#item_service_unit').val(data.service_unit || 'fixed');
                PosnicPro.items.applyServiceMode();
                $('#items_brand').val(data.brand || '');
                $('#items_tags').val(Array.isArray(data.tags) ? data.tags.join(', ') : '');
                $('#items_reorder_point').val(data.reorder_point === null || data.reorder_point === undefined ? '' : data.reorder_point);
                PosnicPro.items.setTileColor(data.tile_color || '');
                PosnicPro.items.setTileShape(data.tile_shape || '');
                $('#items_plu_code').val(data.plu_code || '');
                (data.tax_type === 'inclusive') ? $('#item_tax_inclusive').prop('checked', true) : $('#item_tax_exclusive').prop("checked", true);
                $("#items_tax").val(data.tax_id).trigger("change");
                var radionbutton = $('#items_discount_amount').val();
                if (radionbutton > 0) {
                    $("#item_radio_discount_amount").prop('checked', 'checked');
                    $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#items_discount_amount').removeAttr('disabled', 'disabled').show();
                } else {
                    $("#item_radio_discount_percentage").prop('checked', 'checked');
                    $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#items_discount_percentage').removeAttr('disabled', 'disabled').show();
                }
                if (data.description !== '') {
                    $('#items_description').val(
                        $('<div>').html(data.description).text() || data.description
                    );
                }
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    loadOnchangeSku: function () {
        if (PosnicPro.local.get('sameassku') === "true") {
            PosnicPro.items.sameAsSku(true);
        } else {
            PosnicPro.items.sameAsSku(false);
        }
    },
    sameAsSku: function (checked) {
        if ($("#product_without_variant").is(":checked")) {
            if (checked) {
                $('#items_barcodeid').val($('#items_itemid').val());
                $('#items_barcodeid').attr('disabled', 'disabled');
                $("#same_as_sku").prop("checked", true);
                PosnicPro.local.set('sameassku', "true");
            } else {
                $("#same_as_sku").prop("checked", false);
                PosnicPro.local.set('sameassku', "false");
                $('#items_barcodeid').removeAttr('disabled');
            }
        } else {
            var variant_value = $('#item_variant_list').val();
            $(variant_value).each(function (key, id) {
                if (checked) {
                    $('#items_barcodeid_' + key + '').val($('#items_itemid_' + key + '').val());
                    $('#items_barcodeid_' + key + '').attr('disabled', 'disabled');
                    $('#same_as_sku_' + key + '').prop("checked", true);
                    PosnicPro.local.set('sameassku', "true");
                } else {
                    $('#same_as_sku_' + key + '').prop("checked", false);
                    PosnicPro.local.set('sameassku', "false");
                    $('#items_barcodeid_' + key + '').removeAttr('disabled');
                }
            });
        }
    },

    printLableView: function (id) {
        var loader = $(".loader-label-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $("#mfg_checkbox").prop("checked", false);
        $('#mfg-date-value').attr('disabled', 'disabled');
        $("#exp_checkbox").prop("checked", false);
        $('#exp-date-value').attr('disabled', 'disabled');
        PosnicPro.get('items/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                var currency = PosnicPro.local.get('currencySign');
                PosnicPro.record_id = data.barcode_id;
                let items_mfg_date = data.items_mfg_date !== null ? data.items_mfg_date : '';
                let items_expiry_date = data.items_expiry_date !== null ? data.items_expiry_date : '';
                items_mfg_date = items_mfg_date.split(' ')[0];
                items_expiry_date = items_expiry_date.split(' ')[0];
                $('#userInput').val(data.barcode_id);
                $('#branch-value').val(data.name);
                $('#branch-name').html(data.name);
                $('#price-name').text('PRICE' + " " + currency + " " + data.selling_price);
                $('#mrp-price').text('MRP' + " " + currency + " " + data.mrp_price);
                $('#price-value').val('PRICE' + " " + currency + " " + data.selling_price);
                $('#mrp-price-value').val('MRP' + " " + currency + " " + data.mrp_price);
                $('#mfg-date-value').val('MFG DATE' + " " + items_mfg_date);
                $('#exp-date-value').val('EXP DATE' + " " + items_expiry_date);
                $('#view_print_lable').modal('show');
                loader.find(".loadingSpinner:first").remove();
                newBarcode();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    mfgCheckbox: function (checked) {
        if (checked) {
            $("#mfg_checkbox").prop("checked", true);
            $('#mfg-date-value').removeAttr('disabled');
            $("#mfg-date").text($('#mfg-date-value').val());
        } else {
            $("#mfg_checkbox").prop("checked", false);
            $('#mfg-date-value').attr('disabled', 'disabled');
            $("#mfg-date").text('');
        }
    },

    expCheckbox: function (checked) {
        if (checked) {
            $("#exp_checkbox").prop("checked", true);
            $('#exp-date-value').removeAttr('disabled');
            $("#exp-date").text($('#exp-date-value').val());
        } else {
            $("#exp_checkbox").prop("checked", false);
            $('#exp-date-value').attr('disabled', 'disabled');
            $("#exp-date").text('');
        }
    },

    printLabelBarcode: function () {
        var labelWidth = $('#document_width').val();   // in inches
        var labelHeight = $('#document_height').val(); // in inches

        // Create a copy of the print preview for printing
        var printContent = document.getElementById("print-preview").cloneNode(true);
        printContent.id = 'print-content-copy';

        // Get current settings
        var fontFamily = $('#font').val();
        var textAlign = $(".text-align.btn-primary").val() || 'center';
        var backgroundColor = $('#background-color').val();

        // Apply exact dimensions and styling for printing
        var printStyle =
            "@page { " +
            "size: " + labelWidth + "in " + labelHeight + "in; " +
            "margin: 0; " +
            "} " +

            "html, body { " +
            "margin: 0; " +
            "padding: 0; " +
            "width: " + labelWidth + "in; " +
            "height: " + labelHeight + "in; " +
            "font-family: " + fontFamily + "; " +
            "} " +

            "#print-content-copy { " +
            "width: " + labelWidth + "in !important; " +
            "height: " + labelHeight + "in !important; " +
            "padding: 2px; " +
            "box-sizing: border-box; " +
            "border: none; " +
            "background: " + backgroundColor + "; " +
            "} " +

            "#print-content-copy > div { " +
            "width: 100% !important; " +
            "height: 100% !important; " +
            "display: flex !important; " +
            "flex-direction: column !important; " +
            "justify-content: center !important; " +
            "align-items: center !important; " +
            "} " +

            "#print-content-copy p { " +
            "margin: 0 !important; " +
            "font-family: " + fontFamily + " !important; " +
            "text-align: " + textAlign + " !important; " +
            "} " +

            "#print-content-copy svg { " +
            "display: block !important; " +
            "margin: 2px auto !important; " +
            "max-width: 100% !important; " +
            "max-height: 100px !important; " +
            "} " +

            ".fontfamily { " +
            "font-family: " + fontFamily + " !important; " +
            "text-align: " + textAlign + " !important; " +
            "}";

        // Use PrintJS to print with exact dimensions
        printJS({
            printable: printContent.outerHTML,
            type: 'raw-html',
            style: printStyle,
            scanStyles: false
        });

        // $('#view_print_lable').modal('hide');
        //
        // Navigate back to barcode view if needed
        // let parts = window.location.hash.split('/');
        // if (parts.length > 1) {
        //     PosnicPro.items.showBarcode(parts[1]);
        // }

        return false;
    },

    loadVariant: function () {
        var variant_value = $('#item_variant_list').val();
        $("#load_price_fields").html('');
        var html = "";
        var item_name = $("#items_name").val();
        if (item_name === '' || item_name.length <= 2) {
            PosnicPro.alert('error', 'Fill in the required fields.');
            $("#items_name").focus();
            return false;
        } else if (variant_value.length === 0) {
            PosnicPro.alert('error', 'Fill in the required fields.');
            $("#item_variant_list").focus();
            return false;
        } else {

            $(variant_value).each(function (key, name) {
                $("#load_price_fields").show();
                html = html + '<div class="card-body">';
                html = html + '<div class="card-body">';
                html = html + '<div class="card-header">';
                html = html + '<h5 class="card-title text-primary">' + (key + 1) + ' ) ' + item_name + ' / ' + name + '</h5>';
                html = html + '</div>';
                html = html + '<div class="row">';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_itemid_' + key + '">';
                html = html + '<lang class="lang_sku_title"> SKU </lang>';
                html = html + '<span class="tool" data-tip="sku number is unique code that is assigned to each product" tabindex="6">';
                html = html + '<i class="mdi mdi mdi-help-circle"></i>';
                html = html + '</span>';
                html = html + '</label>';
                html = html + '<input type="text" class="form-control" id="items_itemid_' + key + '" name="items_itemid_' + key + '" minlength="1" maxlength="20" placeholder="Enter SKU Code"  autocomplete="off" onkeyup="PosnicPro.items.loadOnchangeSku();"/>';
                html = html + '</div>';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_barcodeid_' + key + '">';
                html = html + '<lang class="lang_barcode_title"> Barcode </lang>';
                html = html + '<span style="padding-left:50px">';
                html = html + '<input type="checkbox" class="custom-control-input" id="same_as_sku_' + key + '" name="same_as_sku_' + key + '" onclick="PosnicPro.items.sameAsSku(this.checked);"/>';
                html = html + '<label class="custom-control-label" for="same_as_sku_' + key + '">';
                html = html + '<span class="text-dark" style="font-size:11px;">Same as SKU</span>';
                html = html + '</label>';
                html = html + '</span>';
                html = html + '</label>';
                html = html + '<input type="text" class="form-control" id="items_barcodeid_' + key + '" name="items_barcodeid_' + key + '" minlength="1" maxlength="100" placeholder="Scan From Bar Code Reader" autocomplete="off">';
                html = html + '</div>';
                html = html + '</div>';
                html = html + '<div class="row">';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_company_price_' + key + '">';
                html = html + '<lang class="lang_company_title"> Cost </lang>';
                html = html + '</label>';
                html = html + '<input type="text" class="form-control allow_decimal text-right" id="items_company_price_' + key + '" name="items_company_price_' + key + '" minlength="1" maxlength="10" value="0.00" placeholder="Cost">';
                html = html + '</div>';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_mrp_price_' + key + '">';
                html = html + '<lang class="lang_mrp_title"> M.R.P </lang>';
                html = html + '</label>';
                html = html + '<input type="text" class="form-control allow_decimal text-right" id="items_mrp_price_' + key + '" name="items_mrp_price_' + key + '" minlength="1" maxlength="10" value="0.00" placeholder="M.R.P">';
                html = html + '</div>';
                html = html + '</div>';
                html = html + '<div class="row">';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_selling_price_' + key + '">';
                html = html + '<lang class="lang_sales_title"> Selling </lang>';
                html = html + '</label>';
                html = html + '<input type="text" class="form-control allow_decimal text-right" id="items_selling_price_' + key + '" name="items_selling_price_' + key + '" minlength="1" maxlength="10" value="0.00" placeholder="Sale Price">';
                html = html + '</div>';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_available_quantity_' + key + '">';
                html = html + '<lang class="lang_itemquantity_title"> Quantity </lang>';
                html = html + '</label>';
                html = html + '<input type="number" class="form-control allow_decimal text-right" id="items_available_quantity_' + key + '" name="items_available_quantity_' + key + '" minlength="1" maxlength="10" value="0" placeholder="Available Quantity">';
                html = html + '</div>';
                html = html + '</div>';
                html = html + '<div class="row">';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_sort_' + key + '">';
                html = html + '<lang class="lang_showitemposition_title"> Item Position </lang>';
                html = html + '</label>';
                html = html + '<input type="number" class="form-control allow_decimal text-right" id="items_sort_' + key + '" name="items_sort_' + key + '" minlength="1" maxlength="10" value="99" placeholder="Available Quantity">';
                html = html + '</div>';
                html = html + '<div class="col-md-6">';
                html = html + '<label class="form-control-placeholder" for="items_unit_' + key + '">';
                html = html + '<lang class="lang_showitemposition_title"> Item Units </lang>';
                html = html + '</label>';
                html = html + '<select class="form-control items_units select2" id="items_unit_' + key + '" name="items_unit_' + key + '"></select>';
                html = html + '</div>';
                html = html + '</div>';

                html += '<div class="row">';
                html += '  <div class="col-md-6">';
                html += '    <div class="custom-control custom-radio custom-control-inline">';
                html += '      <input type="radio" id="item_radio_discount_amount_' + key + '" name="radio_discount_' + key + '" class="custom-control-input" checked>';
                html += '      <label class="custom-control-label" for="item_radio_discount_amount_' + key + '">Discount Amount</label>';
                html += '    </div>';
                html += '    <div class="custom-control custom-radio custom-control-inline">';
                html += '      <input type="radio" id="item_radio_discount_percentage_' + key + '" name="radio_discount_' + key + '" class="custom-control-input">';
                html += '      <label class="custom-control-label" for="item_radio_discount_percentage_' + key + '">Discount Percentage</label>';
                html += '    </div>';
                html += '    <div class="col-md-12" style="padding: 0 !important; margin-top: 10px;">';
                html += '      <div class="floating-label">';
                html += '        <input name="items_discount_amount_' + key + '" id="items_discount_amount_' + key + '" type="text" class="form-control border-control allow_decimal text-right" min="0" minlength="1" maxlength="10" value="0">';
                html += '        <input name="items_discount_percentage_' + key + '" id="items_discount_percentage_' + key + '" type="number" class="form-control border-control text-right" min="0" max="100" minlength="1" maxlength="4" onkeyup="this.value = PosnicPro.minmax(this.value, 0, 100)" onkeypress="return PosnicPro.isNumber(event)" value="0" style="display: none;">';
                html += '      </div>';
                html += '    </div>';
                html += '  </div>';
                html += '</div>';

// Add toggle behavior using jQuery
                html += '<script>';
                html += '$(document).ready(function () {';
                html += '    $("input[name=\'radio_discount_' + key + '\']").change(function () {';
                html += '        if ($(this).attr("id").includes("amount")) {';
                html += '            $("#items_discount_amount_' + key + '").show();';
                html += '            $("#items_discount_percentage_' + key + '").hide();';
                html += '        } else {';
                html += '            $("#items_discount_percentage_' + key + '").show();';
                html += '            $("#items_discount_amount_' + key + '").hide();';
                html += '        }';
                html += '    });';
                html += '});';
                html += '</script>';


                var params = {
                    url: 'setting/getUnitAjaxList',
                    data: 'query='
                };
                let unitOption;
                PosnicPro.get(params, function (response) {
                    $("#items_unit_" + key + '').empty();
                    $(response.suggestions).each(function (key, dataItem) {
                        unitOption += '<option value="' + dataItem.unit_id + '" data-unit-id="' + dataItem.unit_id + '" data-unit-name="' + dataItem.unit_name + '" data-unit-value="' + dataItem.unit_value + '">' + dataItem.unit_name + ' - ' + dataItem.unit_value + '</option>';
                    });
                    $("#items_unit_" + key + '').append(unitOption);
                });

                html = html + '</select>';
                html = html + '</div>';
                html = html + '</div>';
                html = html + '</div>';
                html = html + '</div>';
            });
            $("#load_price_fields").append(html);
            $("#items_itemid_0").focus();
        }
    },
    item_image_preview: function () {

        var len_files = $("#item_upload_image").prop("files").length;
        for (var i = 0; i < len_files; i++) {
            var file_data = $("#item_upload_image").prop("files")[i];
            PosnicPro.items.form_data.append(file_data.name, file_data);
            reader = new FileReader();
            reader.onload = function (e) {
                var count = $('#item-display-preview').find('div').length;
                var validExtensions = ['gif', 'GIF', 'jpg', 'JPG', 'png', 'PNG', 'jpeg', 'JPEG', 'bmp', 'BMP'];
                var fileName = file_data.name;
                var fileNameExt = fileName.substr(fileName.lastIndexOf('.') + 1);
                if ($.inArray(fileNameExt, validExtensions) === -1) {
                    this.type = '';
                    this.type = 'file';
                    PosnicPro.alert('error', "Only these file types are accepted : " + validExtensions.join(', '));
                    return false;
                }
                let imageSizeArr = 0;
                let imageArr = document.getElementById('item_upload_image');
                let fileNameArray = [];
                let imageToBig = false;
                for (let i = 0; i < imageArr.files.length; i++) {
                    let imageSize = imageArr.files[i].size;
                    let imageName = imageArr.files[i].name;
                    if (imageSize > 5242880) {
                        imageSizeArr = 1;
                    }
                    if (imageSizeArr == 1) {
                        fileNameArray.push(imageName);
                        imageToBig = true;
                    }
                }
                if (imageToBig) {
                    //give an alert that at least one image is to big
                    PosnicPro.alert('error', fileNameArray + "Each file must be under 5 MB.");
                    return false;
                }
                if ($('#item-display-preview').find('div').length > 11) {
                    PosnicPro.alert('error', "You can upload up to 12 files.");
                    return false;
                }

                var fileImage = e.target.result.substr(e.target.result.indexOf(',') + 1);
                $('#item_upload_image_status').val('yes');
                $('#item-display-preview').append(
                        '<div id="selector_' + count + '" class="receiving-image-wrapper image-area" style="position: relative;"> \
                        <img class="image_style" class="img-thumbnail" src="' + e.target.result + '" \
                        title="' + escape(file_data.name) + '" /><br /> \
                            <span id="coverimage_selector_' + count + '" class="coverImageAdd" style="display: block;border: 1px solid #ddd;border-radius: 5px;margin-top: 2px; background: #506fe4; color: #fff" onclick="PosnicPro.items.coverImage(this.id,\'' + count + '\',\'' + file_data.name + '\',\'' + file_data.size + '\',\'' + fileImage + '\')">Choose Cover</span><a class="remove-image" style="cursor:pointer;display: inline;position: absolute; top: -10px; right: -10px; border-radius: 10em; padding: 2px 6px 3px; text-decoration: none; font: 700 21px/20px sans-serif; background: #f48787; border: 3px solid #fff; color: #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.5); -webkit-transition: background 0.5s; transition: background 0.5s;" onclick="PosnicPro.items.image_remove_selected(\'' + count + '\',\'' + file_data.name + '\')">&#215;</a> \
                        </div>');
                // Determine cover flag based on count
                let coverFlag = count === 0 ? 'yes' : 'no';

                // Set image parameters
                PosnicPro.items.imageParams[count] = {
                    name: file_data.name,
                    size: file_data.size,
                    data: fileImage,
                    cover: coverFlag
                };

                // If it's the first image, update the logo and styles
                if (count === 0) {
                    $('#item_logo').val(file_data.name);
                    const coverImageSelector = "#coverimage_selector_" + count;

                    $(coverImageSelector).html('').css({
                        display: 'block',
                        border: '1px solid #ddd',
                        'border-radius': '5px',
                        'margin-top': '2px',
                        background: 'green',
                        color: '#fff'
                    }).append('Cover');
                }


            };
            reader.readAsDataURL(file_data);
        }
    },
    coverImage: function (id, row, name, size, image) {
        $('.receiving-image-wrapper').removeClass('category-focused');
        $('#selector_' + id).addClass('category-focused');
        $('.coverImageAdd').text('');
        var styleblue = {
            display: 'block',
            border: '1px solid #ddd',
            'border-radius': '5px',
            'margin-top': '2px',
            background: '#506fe4',
            color: '#fff'
        };
        $('.coverImageAdd').css(styleblue).append('Choose Cover');
        $('#' + id).html('');
        var styles = {
            display: 'block',
            border: '1px solid #ddd',
            'border-radius': '5px',
            'margin-top': '2px',
            background: 'green',
            color: '#fff'
        };
        $('#' + id).css(styles).append('cover');

        PosnicPro.items.imageParams.map(function (item, index) {
            PosnicPro.items.imageParams[index] = {
                name: item.name,
                size: item.size,
                data: item.data,
                cover: 'no'
            };
        });

        PosnicPro.items.imageParams[row] = {
            name: name,
            size: size,
            data: image,
            cover: 'yes'
        };

    },
    image_remove_selected: function (id, name) {
        var removeIndex = PosnicPro.items.imageParams.map(function (item) {
            return item.name;
        }).indexOf(name);
        PosnicPro.items.imageParams.splice(removeIndex, 1);
        $('#selector_' + id).remove();
        if (PosnicPro.items.imageParams.length === 0) {
            $('#item_logo').val('item.svg');
            $('#item_upload_image_status').val('no');
        }
    },
    coverImageEdit: function (id, row, name, size) {
        $('.receiving-image-wrapper').removeClass('category-focused');
        $('#selector_' + id).addClass('category-focused');
        $('.coverImageAdd').text('');
        var styleblue = {
            display: 'block',
            border: '1px solid #ddd',
            'border-radius': '5px',
            'margin-top': '2px',
            background: '#506fe4',
            color: '#fff'
        };
        $('.coverImageAdd').css(styleblue).append('Choose Cover');
        $('#' + id).html('');
        $('#item_logo').val(name);
        var styles = {
            display: 'block',
            border: '1px solid #ddd',
            'border-radius': '5px',
            'margin-top': '2px',
            background: 'green',
            color: '#fff'
        };
        $('#' + id).css(styles).append('cover');

        PosnicPro.items.imageParams.map(function (item, index) {
            PosnicPro.items.imageParams[index] = {
                name: item.name,
                size: item.size,
                cover: 'no'
            };
        });

        PosnicPro.items.imageParams[row] = {
            name: name,
            size: size,
            cover: 'yes'
        };


    },
    image_edit_remove_selected: function (id, name) {
        var removeIndex = PosnicPro.items.imageParams.map(function (item) {
            return item.name;
        }).indexOf(name);
        PosnicPro.items.imageParams.splice(removeIndex, 1);
        $('#selector_' + id).remove();
        if (PosnicPro.items.imageParams.length === 0) {
            $('#item_upload_image_status').val('no');
            $('#item_logo').val('item.svg');
        }
        PosnicPro.items.imageParams.map(function (item) {
            if (item.cover === 'yes') {
                $('#item_logo').val(item.name);
            } else {
                $('#item_logo').val('item.svg');
            }
        });
    },
    applyCategoryDiscount: function(selectedOption) {
        if (!selectedOption) {
            return;
        }
        var $option = $(selectedOption);
        var discountAmount = parseFloat($option.attr('data-item-discountamount')) || 0;
        var discountPercentage = parseFloat($option.attr('data-item-discountpercentage')) || 0;

        /*
         * Offer, never impose (IC1): the category's discount fills the form
         * only while the user has not touched the discount fields this entry
         * (a dirty flag, because the shop-default discount pre-fills values
         * and must still lose to the more specific category discount). A
         * value the user typed survives a category change - the old code
         * overwrote it, and reset it to 0 when the category had no discount.
         */
        if (PosnicPro.items._discountTouched) {
            return;
        }

        if (discountAmount > 0 && discountPercentage === 0) {
            $("#item_radio_discount_amount").prop('checked', true).trigger('click');
            $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#items_discount_amount').removeAttr('disabled').removeClass('bg-white').show();
            $('#items_discount_amount').val(discountAmount);
        } else if (discountPercentage > 0) {
            $("#item_radio_discount_percentage").prop('checked', true).trigger('click');
            $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#items_discount_percentage').removeAttr('disabled').removeClass('bg-white').show();
            $('#items_discount_percentage').val(discountPercentage);
        }
    },
    loadSelectCategory: function () {
        var categorySelect = $('.items_category');
        var params = {
            url: 'categories/getCategoryAjaxList',
            data: 'query='
        };
        PosnicPro.get(params, function (response) {
            categorySelect.empty();
            /* IC1: a real placeholder, selected. The old code auto-picked the
               LAST category in the list, so an untouched form filed the item
               under an arbitrary category - misfiled catalogues by default.
               Category is required; choosing it is one deliberate tap. */
            categorySelect.append('<option value=""></option>');
            suggestions: $.map(response.suggestions, function (dataItem) {
                var option;
                option += '<option value="' + dataItem.id + '" data-category-name="' + dataItem.name + '" data-category-id="' + dataItem.id + '" data-item-discountamount="' + dataItem.discount_amount + '" data-item-discountpercentage="' + dataItem.discount_percentage + '">' + dataItem.name + ' </option>';
                categorySelect.append(option).select2();
            });
            $(".items_category").select2({
                placeholder: "Choose a Category"
            });
            $(".items_category").val('').trigger('change.select2');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    loadSelectVariant: function () {

        var variantSelect = $('#items_variant');
        var params = {
            url: 'variants/getVariantsAjaxList',
            data: 'query='
        };
        PosnicPro.get(params, function (response) {
            variantSelect.empty();
            suggestions: $.map(response.suggestions, function (dataItem) {
                var option;
                option += '<option id="' + dataItem.id + '" value="' + dataItem.id + '" data-variant-name="' + dataItem.name + '" data-variant-id="' + dataItem.id + '">' + dataItem.name + ' </option>';
                variantSelect.append(option).select2();
                $('#' + dataItem.id).attr('data-variant-fields', JSON.stringify(dataItem.fields));
            });
            $("#items_variant").val(1).trigger('change.select2');
            $("#items_variant").select2({
                placeholder: "Choose a Variant"
            });
            $('#item_variant_list').html('');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    loadSelectTax: function () {
        var taxSelect = $('#items_tax');
        var params = {
            url: 'setting/getTaxAjaxList',
            data: 'query='
        };
        PosnicPro.get(params, function (response) {
            taxSelect.empty();
            suggestions: $.map(response.suggestions, function (dataItem) {
                var option;
                option += '<option value="' + dataItem.tax_id + '" data-tax-id="' + dataItem.tax_id + '" data-tax-name="' + dataItem.tax_name + '" data-tax-value="' + dataItem.tax_value + '">' + dataItem.tax_name + '</option>';
                taxSelect.append(option).trigger('change');
            });
            if (PosnicPro.local.get('default_tax_enable_disable') === 'false') {
                taxSelect.val(1).trigger('change.select2');
            } else {
                var taxDetail = PosnicPro.local.get('default_tax_id');
                taxSelect.val(taxDetail).trigger("change");
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    loadSelectUnit: function () {
        let unitSelect = $('.items_unit');
        var params = {
            url: 'setting/getUnitAjaxList',
            data: 'query='
        };
        PosnicPro.get(params, function (response) {
            unitSelect.empty();
            suggestions: $.map(response.suggestions, function (dataItem) {
                var option;
                option += '<option value="' + dataItem.unit_id + '" data-unit-id="' + dataItem.unit_id + '" data-unit-name="' + dataItem.unit_name + '" data-unit-value="' + dataItem.unit_value + '">' + dataItem.unit_name + ' - ' + dataItem.unit_value + '</option>';
                unitSelect.append(option).trigger('change');
            });
            $('.items_unit option:eq(0)').prop('selected', true);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    itemClearForm: function () {
        $('.error_item').css('display', 'none');
        $('#item-display-preview').html('');
        $('#items_description').val('');
        $('#items_new .alert').remove();
        if ($("#product_without_variant").is(":checked")) {
            $('#show_variant_fields').hide();
            $('#show_price_fields,#sku_card_col').show();
            $('#product_without_variant').prop('checked', true);
        } else {
            $('#show_price_fields,#sku_card_col').hide();
            $('#show_variant_fields').show();
            $('#show_variant_fields').css("display", "block");
            $('#item_variant_list').empty().trigger('change');
            $('#product_with_variant').prop('checked', true);
        }
        $('#items_name').val('');
        $("#items_variant").val('').trigger('change');
        $("#item_variant_list").val('').trigger('change');
        $("#items_hsncode").val('');
        $("#hsn_tax").val('');
        $("#items_discount_amount").val('0.00');
        $("#items_discount_percentage").val('0');
        $("#load_price_fields").html('');
        $(".clear_text_item").val('');
        var defaultsupplier = JSON.parse(PosnicPro.local.get('defaultsupplier'));
        if (PosnicPro.local.get('default_supplier_enable_disable') === 'false') {
            $('#items_supplier_id').val('');
            $('#items_supplier').val('');
        } else {
            $('#items_supplier_id').val(defaultsupplier.supplier_id);
            $('#items_supplier').val(defaultsupplier.supplier_name);
        }
        $('#items_company_price,#items_mrp_price,#items_selling_price').val('0.00');
        $('#items_available_quantity').val('0');
        $('#items_sort').val('99');
        $('#item_tax_default,#item_tax_inclusive').prop('checked', true);
        $('#hsn_code_show').hide();
        $('#hsn_tax').hide();
        $('#default_tax').show();
        $('#item_logo').val('item.svg');
        PosnicPro.items.imageParams = [];
        $(".items_category").val('').trigger('change.select2');
        $(".items_category").select2({
            placeholder: "Choose a Category"
        });
        PosnicPro.items.loadSelectCategory();
        PosnicPro.items.loadSelectTax();
        PosnicPro.items.loadSelectVariant();
    }
};

PosnicPro.itemdetails = {

    itemdetailsTable: function (type) {
        PosnicPro.appendReportTableBody('customerdetails');
        var loader = $(".loader-itemactivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_itemdetails');
        if ($('a#view_items_page').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#item_branch_value").val()
        }
        if (type === 'customerreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_itemdetails_per_page').val();
        }
        let item_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            item_id: item_id[1],
            branch: branch
        };
        var params = {
            url: 'sales/itemSaleDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'itemreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_itemdetails_total,.item_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_itemdetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_itemdetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.itemactivity_content').hide();
                        $('#itemactivity_img_hide').show();

                    } else {
                        $('#itemactivity_img_hide').hide();
                        $('.itemactivity_content').show();
                    }
                    var process_class = "badge badge-success-inverse";
                    var saleTotalValue = 0;
                    var returnTotalValue = 0;
                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        var row = response.data.table.data.list[i];
                        saleTotalValue += row.items_total;
                        returnTotalValue += row.items_return_total;
                        if (row.sale_process == 'Add' || row.sale_process == 'Edit') {
                            process_class = "badge badge-success-inverse";
                        } else if (row.sale_process == 'PartialReturn') {
                            process_class = "badge badge-secondary-inverse";
                        } else {
                            process_class = "badge badge-danger-inverse";
                        }
                        let salesQty = 0;
                        $(row.items).each(function (key, val) {
                            salesQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(row.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                            });
                        });
                        let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                        // Prefer backend-provided string_date, but gracefully
                        // fall back to raw date fields so we never show the
                        // current time when no preformatted date is present.
                        let rawDate = row.string_date || row.date || row.created_date || row.updated_date;
                        let updateDate = rawDate ? PosnicPro.convertDate(rawDate) : '';
                        let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.sales_id + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-center"><span class="' + process_class + '">' + row.sale_process + '</span></td> <td class="text-center text-danger">' + returnQty + '</td> <td class="text-right text-danger">' + currency + '&nbsp;' + row.items_return_total.toFixed(2) + '</td><td class="text-center text-success">' + salesQty + '</td><td class="text-right text-success">' + currency + '&nbsp;' + row.items_total.toFixed(2) + '</td></tr>';
                        $('#view_itemdetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }
                    let total = 0;
                    $('.item_details_totalsale').html('0');
                    if (response.data.sale.length !== 0) {
                        total = response.data.sale[0];
                        $('.item_details_totalsale').html(total);
                    }

                    let totalreturn = 0;
                    $('.item_details_totalreturn').html('0');
                    if (response.data.return.length !== 0) {
                        totalreturn = response.data.return[0];
                        $('.item_details_totalreturn').html(totalreturn);
                    }

                    // Prefer the server's item-revenue total (the sum of THIS
                    // item's line totals across all its sales). The old fallback
                    // summed each sale's whole-bill total over just the loaded
                    // page, so it counted other items in the bill and changed as
                    // you paged. Round to 2 decimals (no raw 1306.8600000000001).
                    var itemSaleValue =
                        response.data.sale_amount !== undefined && response.data.sale_amount !== null
                            ? Number(response.data.sale_amount)
                            : saleTotalValue;
                    var itemReturnValue =
                        response.data.return_amount !== undefined && response.data.return_amount !== null
                            ? Number(response.data.return_amount)
                            : returnTotalValue;
                    $('.item_details_saletotalvalue').html(itemSaleValue.toFixed(2));
                    $('.item_details_returntotalvalue').html(itemReturnValue.toFixed(2));
                } else {
                    var itemsalesreport = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        let salesQty = 0;
                        $(val.items).each(function (key, val) {
                            salesQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(val.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                            });
                        });

                        // Use the same date fallback for CSV export so the
                        // exported report matches the on-screen Date column.
                        let exportRawDate = val.string_date || val.date || val.created_date || val.updated_date;
                        let date = exportRawDate ? PosnicPro.convertDate(exportRawDate) : '';
                        let process = val.sale_process;
                        let saleId = val.sales_id;
                        let returnTotal = val.items_return_total;
                        let saleTotal = val.items_total;
                        itemsalesreport.push({SalesId: saleId, Date: date, Process: process, NoOfReturn: returnQty, ReturnAmount: returnTotal, NoOfSale: salesQty, SaleAmount: saleTotal});
                    });
                    PosnicPro.JSONToCSVConvertor(itemsalesreport, 'item-sales-reports', true);
                    PosnicPro.itemdetails.itemdetailsTable();
                }
            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    /*
     * A single item's price trail.
     *
     * Inventory was already tracked; price was not, and shops that reprice
     * often had no way to see what a product used to cost or who changed it.
     * Every price change - a manual edit, a re-import, a bulk update - is
     * recorded server-side; this reads it back, newest first.
     */
    priceHistory: function () {
        var item_id = currentHash.split('/')[1];
        if (!item_id) { return false; }

        var loader = $('.loader-item-pricehistory');
        $('#item_pricehistory_body').empty();
        $('#item_history_filter_row').hide();
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get({ url: 'items/priceHistory/' + item_id, data: '' }, function (response) {
            loader.find('.loadingSpinner:first').remove();
            var rows = (response && response.data) ? response.data : [];
            PosnicPro.itemdetails._historyRows = rows;
            if (!rows.length) {
                $('#item_pricehistory_wrap').hide();
                $('#item_history_filter_row').hide();
                $('#item_pricehistory_empty').show();
                return;
            }
            $('#item_pricehistory_empty').hide();
            $('#item_pricehistory_wrap').show();
            $('#item_history_filter').val('all');
            $('#item_history_filter_row').show();
            PosnicPro.itemdetails.renderHistory();
        }, function (xhr) {
            loader.find('.loadingSpinner:first').remove();
            $('#item_pricehistory_wrap').hide();
            $('#item_history_filter_row').hide();
            $('#item_pricehistory_empty').show();
        });
        return false;
    },

    /*
     * Draw the stored history through the current filter.
     *
     * The rows are already loaded, so filtering by "Price changes", "Name",
     * "Category", "Tax" or "SKU / Barcode" is instant - no round trip. A field
     * is matched by its stored `field`/`value_type`, so this keeps working as
     * new tracked fields are added server-side.
     */
    renderHistory: function () {
        var rows = PosnicPro.itemdetails._historyRows || [];
        var filter = $('#item_history_filter').val() || 'all';
        var match = function (r) {
            var type = r.value_type || 'money';
            var f = r.field || '';
            switch (filter) {
                case 'price': return type === 'money' || type === 'percent';
                case 'name': return f === 'name';
                case 'category': return f === 'category_name';
                case 'tax': return f === 'tax' || f === 'tax_name';
                case 'sku': return f === 'itemid' || f === 'barcode_id';
                default: return true;
            }
        };

        var legacyLabel = {
            selling_price: 'Selling price',
            mrp_price: 'MRP price',
            company_price: 'Company price'
        };
        var currency = PosnicPro.local.get('currencySign') || '';
        var esc = function (v) {
            return String(v === undefined || v === null ? '' : v)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        };
        var show = function (v, type) {
            if (type === 'money') return currency + '&nbsp;' + (Number(v) || 0).toFixed(2);
            if (type === 'percent') return (Number(v) || 0) + '%';
            var t = esc(v);
            return t === '' ? '<span class="text-muted">-</span>' : t;
        };

        var html = '';
        var shown = 0;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!match(r)) continue;
            shown += 1;
            var type = r.value_type || 'money';
            var label = r.label || legacyLabel[r.field] || r.field || '';

            // The up/down arrow only means something for a number. A name going
            // from "Pen" to "Pencil" gets a neutral dash instead.
            var change = '<span class="text-muted">-</span>';
            if (type === 'money' || type === 'percent') {
                var oldN = Number(r.old_value) || 0;
                var newN = Number(r.new_value) || 0;
                change = (newN >= oldN)
                    ? '<span class="text-success"><i class="feather icon-arrow-up"></i> ' + (newN - oldN).toFixed(2) + '</span>'
                    : '<span class="text-danger"><i class="feather icon-arrow-down"></i> ' + (oldN - newN).toFixed(2) + '</span>';
            }

            var rawDate = r.date || r.created_date || r.updated_date;
            var when = rawDate ? PosnicPro.convertDate(rawDate) : '';
            var source = esc(r.process || 'Edit');
            var by = esc(r.changed_by || '');
            html += '<tr>'
                + '<td>' + when + '</td>'
                + '<td>' + esc(label) + '</td>'
                + '<td class="text-right">' + show(r.old_value, type) + '</td>'
                + '<td class="text-right f-w-6">' + show(r.new_value, type) + '</td>'
                + '<td class="text-center">' + change + '</td>'
                + '<td><span class="badge badge-info-inverse">' + source + '</span></td>'
                + '<td>' + by + '</td>'
                + '</tr>';
        }
        if (!shown) {
            html = '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">No changes of this kind.</td></tr>';
        }
        $('#item_pricehistory_body').html(html);
        $('#item_history_filter_count').text(shown + ' of ' + rows.length);
    },

    itemdetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemdetails.itemdetailsTable(type);
    }
};


$(function () {
    $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0.00').hide();
    // One-time init like the sale search: never rebuild per keystroke.
    $('#items_supplier').autocomplete({
        deferRequestBy: 120,
            lookup: function (query, done) {
                var branch = PosnicPro.local.get("branch_id_set");
                var result = {};
                var suggestions = [];
                var params = {
                    url: 'suppliers/getSuppliersAjaxList',
                    data: 'query=' + query + '&branch=' + branch
                };
                PosnicPro.get(params, function (response) {
                    if (response.suggestions.length > 0) {
                        suggestions: $.map(response.suggestions, function (dataItem) {
                            suggestions.push({"value": dataItem.name, "data": dataItem});
                        });
                    } else {
                        suggestions.push({value: $('#items_supplier').val() + ' ', data: -1});
                    }
                    result["suggestions"] = suggestions;
                    done(result);
                }, function (xhr) {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type, response.message);
                });
            },
            onSelect: function (suggestion) {
                if (suggestion.data !== -1) {
                    $('#items_supplier_id').val(suggestion.data.id);
                } else {
                    hasher.setHash('items/suppliers/new');
                }
            },
            autoSelectFirst: true,
            triggerSelectOnValidInput: false,
            formatResult: function (suggestion) {
                var addnew = '';
                var phone = suggestion.data.phone;
                if (suggestion.data === -1 || typeof suggestion.phone === undefined) {
                    addnew = "( Add new )";
                    phone = '';
                }
                return '<div>' +
                        $.Autocomplete.formatResult(suggestion) +
                        '</div><span class="pull-right">' + phone + '</span><span class="pull-right" style="margin-top:-20px;">' + addnew + '</span>';
            }
    });
});

$(function () {
    $("#item_radio_discount_amount, #item_radio_discount_percentage").change(function () {
        if ($("#item_radio_discount_amount").is(":checked")) {
            $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
            $('#items_discount_amount').removeAttr('disabled', 'disabled').show().focus().select();
        } else {
            $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
            $('#items_discount_percentage').removeAttr('disabled', 'disabled').show().focus().select();
        }
    });
    $('#items_discount_amount').keyup(function () {
        if ($('#items_discount_amount').val() === '')
            $('#items_discount_amount').val('0');
    });
    var syncVariantLink = function () {
        $('#variant_mode_link').text($('#product_with_variant').is(':checked')
            ? 'Remove variants' : '+ This item has variants');
    };
    $(document).on('click', '#variant_mode_link', function () {
        var withVariant = $('#product_with_variant').is(':checked');
        $(withVariant ? '#product_without_variant' : '#product_with_variant')
            .prop('checked', true).trigger('change');
    });
    $(window).on('hashchange', function () {
        if (/items\/(new|[^/]+\/(edit|clone))/.test(window.location.hash)) {
            setTimeout(syncVariantLink, 400);
        }
    });
    $("#product_without_variant, #product_with_variant").change(function () {
        syncVariantLink();
        if ($("#product_without_variant").is(":checked")) {
            $('#show_variant_fields').hide();
            $('#show_price_fields,#sku_card_col').show();
            $("#load_price_fields").html('');
            $("#show-hide-item-discount").show();
        } else {
            $('#show_price_fields,#sku_card_col').hide();
            $('#show_variant_fields').show();
            $("#show-hide-item-discount").hide();
        }
    });
});

/*for display client validation of the form details*/
$(document).ready(function () {
    $("#item_radio_discount_amount").prop('checked', 'checked');
    $('#items_discount_percentage').attr('disabled', 'disabled').val('0').hide();
    $('#items_discount_amount').removeAttr('disabled', 'disabled').val('0').show();
    jQuery.validator.addMethod("alphanumeric", function (value, element) {
        if ((/[*|\":<>[\]{}`\\';@&#!]/.test(value))) {
            return false;
        }
        return true;
    }, "Please Enter a Valid Name");

    /* IC1: a selling price is required unless the item is deliberately
       open-price (ask at the till). The old form accepted the 0.00 default
       silently, which is how shops end up with unpriced catalogues. */
    jQuery.validator.addMethod("sellingPriceOrOpen", function (value) {
        if ($('#item_open_price').is(':checked')) {
            return true;
        }
        return (parseFloat(value) || 0) > 0;
    }, "Enter a selling price, or tick Price at sale");

    $("#item_image_upload_form").validate({
        errorClass: 'error error_item',
        highlight: function (element, errorClass) {
            $(element).css("border-color", "#f9616d");
        },
        unhighlight: function (element, errorClass) {
            $(element).css("border-color", "#eae8e8");
        },
        errorPlacement: function (label, element) {
            if (element.hasClass('items_choose_error') && element.next('.select2-container').length) {
                label.insertAfter(element.next('.select2-container'));
            } else {
                label.addClass('mt-2 text-danger');
                label.insertAfter(element);
            }
        },
        rules: {
            items_name: {
                required: true,
                alphanumeric: true,
                minlength: 3,
                maxlength: 500
            },
            items_category: {
                required: true
            },
            items_supplier: {
                maxlength: 250
            },
            items_itemid: {
                minlength: 1,
                maxlength: 20
            },
            items_barcodeid: {
                minlength: 1,
                maxlength: 100
            },
            items_mrp_price: {
                minlength: 1,
                maxlength: 7
            },
            items_company_price: {
                minlength: 1,
                maxlength: 7
            },
            items_selling_price: {
                minlength: 1,
                maxlength: 7,
                sellingPriceOrOpen: true
            },
            items_available_quantity: {
                minlength: 1,
                maxlength: 10
            },
            items_discount_amount: {
                minlength: 1,
                maxlength: 10
            },
            items_discount_percentage: {
                minlength: 1,
                maxlength: 4
            },
            items_sort: {
                minlength: 1,
                maxlength: 10
            },
            items_tax: {
                required: true
            },
            items_description: {
                minlength: 5,
                maxlength: 1000
            },
            items_variant: {
                required: true
            },
            item_variant_list: {
                required: true
            },
            items_mfg_date: {
                dateISO: true
            },
            items_expiry_date: {
                dateISO: true,
                greaterThanMfgDate: "#items_mfg_date",
                expiryGreaterThanCurrentDate: true
            },
            // Validated only when HSN tax mode shows it (hidden fields are
            // ignored) - it is the tax source in that mode, so it must be a
            // real HSN: 4-8 digits.
            items_hsncode: {
                digits: true,
                minlength: 4,
                maxlength: 8
            }

        },
        messages: {
            items_name: {
                required: "Please Enter Item Name",
                minlength: "Item Name must consist of at least 3 characters",
                maxlength: "Item Name should not be more than 500 characters"
            },
            items_category: {
                required: "Please Choose Category"
            },
            items_variant: {
                required: "Please Choose Variant"
            },
            item_variant_list: {
                required: "Please Choose Variant field"
            },
            items_supplier: {
                minlength: "Item supplier must consist of at least 3 characters",
                maxlength: "Item supplier should not be more than 250 characters"
            },
            items_itemid: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 20 characters"
            },
            items_barcodeid: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 100 characters"
            },
            items_mrp_price: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 7 characters"
            },
            items_company_price: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 7 characters"
            },
            items_selling_price: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 7 characters"
            },
            items_available_quantity: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 10 characters"
            },
            items_discount_amount: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 10 characters"
            },
            items_discount_percentage: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 4 characters"
            },
            items_sort: {
                minlength: "This field must consist of at least 1 characters",
                maxlength: "This field should not be more than 10 characters"
            },
            items_description: {
                minlength: "This field must consist of at least 100 characters",
                maxlength: "This field should not be more than 10000 characters"
            },
            items_hsncode: {
                digits: "HSN code is digits only",
                minlength: "HSN code is 4 to 8 digits",
                maxlength: "HSN code is 4 to 8 digits"
            },
            items_mfg_date: {
                dateISO: "Please enter a valid date in the format YYYY-MM-DD",
            },
            items_expiry_date: {
                dateISO: "Please enter a valid date in the format YYYY-MM-DD",
                greaterThanMfgDate: "Expiry date must be greater than manufacturing date"
            }
        }
    });
    $.validator.addMethod("expiryGreaterThanCurrentDate", function (value, element) {
        if (!value)
            return true;
        return moment(value, 'YYYY-MM-DD').isSameOrAfter(moment(), 'day');
    }, "Expiry date must be today's date or in the future.");
    $.validator.addMethod("greaterThanMfgDate", function (value, element, param) {
        var mfgDate = $(param).val();
        if (!mfgDate || !value)
            return true;
        return new Date(value) > new Date(mfgDate);
    }, "Expiry date must be greater than manufacturing date");
    jQuery.validator.addMethod("greaterThan", function (value, element, param) {
        var $otherElement = $(param);
        return parseFloat(value, 10) >= parseFloat($otherElement.val(), 10);
    }, "Please enter a valid date in the format");

    $('#items_category,#items_tax,#item_variant_list,#items_variant').on('change', function () {
        $(this).trigger('blur');
    });
    $("#items_available_quantity,#items_sort").on('input', function () {
        $(this).valid();
    });
    /* IC2: duplicate-name warning at entry, non-blocking. The server only
       rejects when name AND barcode AND all three prices match, so this is
       where a "did you mean the existing one?" moment actually happens. */
    $('#items_name').on('blur', function () {
        var typed = ($(this).val() || '').trim();
        $('.item-dup-note').remove();
        if ($('#itemid').val() !== '' || typed.length < 3) { return; }
        PosnicPro.get({
            url: 'base/autoSuggestionTableField',
            data: 'query=' + encodeURIComponent(typed) + '&field=name&module=items'
        }, function (response) {
            var list = (response && response.data && response.data.suggestions) || [];
            var clash = list.some(function (s) {
                var value = (s && (s.value || s)) || '';
                return typeof value === 'string' && value.trim().toLowerCase() === typed.toLowerCase();
            });
            // Re-check the field still shows what we looked up.
            if (clash && ($('#items_name').val() || '').trim() === typed) {
                $('#items_name').after(
                    '<small class="item-dup-note text-warning d-block mt-1">An item named &quot;' +
                    $('<span>').text(typed).html() + '&quot; already exists.</small>'
                );
            }
        }, function () { /* advisory only - stay quiet on failure */ });
    });

    /* IC2: the per-variant price rows render the moment the values are
       chosen - Save no longer has a silent first click that only rendered
       rows. The submit-time render below stays as a fallback (with a voice)
       for any path that reaches Save with the rows still missing. */
    $('#item_variant_list').on('change', function () {
        if ($('#product_with_variant').is(':checked') && ($(this).val() || []).length > 0) {
            PosnicPro.items.loadVariant();
        }
    });
    $("#item_image_upload_form").submit(function (event) {
        event.preventDefault();
        if ($('#item_image_upload_form').valid()) {            // checks form for validity
            if ($("#product_with_variant").is(":checked") && $("#load_price_fields").html() === '') {
                PosnicPro.items.loadVariant();
                PosnicPro.alert('info', 'Review each variant\'s price below, then Save');
            } else {
                if ($('#item_upload_image_status').val() === 'no') {
                    PosnicPro.items.item();
                } else {
                    PosnicPro.items.itemImageFormSubmit();
                }
            }

        }
    });

});
$('.modal').on('show.bs.modal', function () {
    $('#categories_view').css('z-index', 1051);
});


$(document).ready(function () {

    db.printLableValues.get('1').then(function (data) {
        $(data.printLabel).each(function (key, val) {
            // Set input values first
            $('#document_width').val(val.document_width);
            $('#document_height').val(val.document_height);
            $("#margin_top").val(val.margin_top);
            $("#margin_bottom").val(val.margin_bottom);
            $("#margin_left").val(val.margin_left);
            $("#margin_right").val(val.margin_right);
            $("#barcodeLabelType").val(val.format);

            // Set color values (MISSING BEFORE)
            $("#background-color").val(val.backgroundColor || '#FFFFFF');
            $("#line-color").val(val.lineColor || '#000000');

            // Update slider limits based on loaded document size
            updateSliderLimits();

            // Set text alignment
            $(".text-align").removeClass("btn-primary");
            $(".text-align[value='" + val.textAlign + "']").addClass("btn-primary");
            $(".fontfamily").css({"text-align": val.textAlign});

            // Set slider values AND trigger visual updates in one go
            $("#bar-height").val(val.height).rangeslider('update', true);
            $("#bar-width").val(val.width).rangeslider('update', true);
            $("#bar-margin").val(val.margin).rangeslider('update', true);
            $("#bar-text-margin").val(val.textMargin).rangeslider('update', true);
            $("#bar-fontSize").val(val.fontSize || 9).rangeslider('update', true);

            // Set font
            $("#font").val(val.font);

            // Update display values manually
            $("#bar-width-display").text(val.width);
            $("#bar-height-display").text(val.height);
            $("#bar-margin-display").text(val.margin);
            $("#bar-text-margin-display").text(val.textMargin);
            $("#bar-fontSize-display").text(val.fontSize || 9);

            // Update preview and generate barcode
            updatePreviewDimensions();
            newBarcode();
        });
    }).catch(function(error) {
        console.log('No saved label values found, using defaults');
        // Initialize with defaults
        updateSliderLimits();
        updatePreviewDimensions();
        newBarcode();
    });

    $("#userInput").on('input', newBarcode);
    $("#barcodeLabelType").change(function () {
        $("#userInput").val($('#userInput').val());
        newBarcode();
    });

    $("#branch-value,#price-value,#address-value,#mrp-price-value,#mfg-date-value,#exp-date-value,#margin_top,#margin_bottom,#margin_left,#margin_right").on('input load', function () {
        updateLabelPreview();
        newBarcode();
    });

    $(".text-align").click(function () {
        $(".text-align").removeClass("btn-primary");
        $(this).addClass("btn-primary");
        newBarcode();
    });

    $(".font-option").click(function () {
        if ($(this).hasClass("btn-primary")) {
            $(this).removeClass("btn-primary");
        } else {
            $(this).addClass("btn-primary");
        }
        newBarcode();
    });

    $(".display-text").click(function () {
        $(".display-text").removeClass("btn-primary");
        $(this).addClass("btn-primary");

        if ($(this).val() === "true") {
            $("#font-options").slideDown("fast");
        } else {
            $("#font-options").slideUp("fast");
        }
        newBarcode();
    });

    $("#font").change(function () {

        newBarcode();

    });

    $('.range-type').rangeslider({
        polyfill: false,
        rangeClass: 'rangeslider',
        fillClass: 'rangeslider__fill',
        handleClass: 'rangeslider__handle',
        onSlide: newBarcode,
        onSlideEnd: newBarcode
    });

    $('.color').colorPicker({renderCallback: newBarcode});
    newBarcode();
    $('.hide_price_digit').on('focus', function () {
        var enteredValue = $(this).val();
        if (enteredValue === '0.00') {
            $(this).val('');
        }
    });

    $('#document_width, #document_height').on('input change', function() {
        // Small delay to allow input to complete
        setTimeout(() => {
            updateSliderLimits();
            updatePreviewDimensions();
            newBarcode();
        }, 100);
    });

    // Validate when barcode dimensions change
    $('#bar-width, #bar-height, #bar-fontSize').on('input change', function() {
        setTimeout(() => {
            newBarcode();
        }, 100);
    });

});

/* IC1c followup: the description is a plain textarea now (maxlength
   in the markup). The Summernote WYSIWYG toolbar was heavyweight for
   a 1000-char field no receipt renders rich. */

// Update preview function to work with existing system
var updateLabelPreview = function() {
    $("#branch-name").text($('#branch-value').val());
    $("#price-name").text($('#price-value').val());
    $("#mrp-price").text($('#mrp-price-value').val());
    $("#address-name").text($('#address-value').val());

    if ($('#mfg_checkbox').is(':checked')) {
        $("#mfg-date").text($('#mfg-date-value').val());
    } else {
        $("#mfg-date").text('');
    }

    if ($('#exp_checkbox').is(':checked')) {
        $("#exp-date").text($('#exp-date-value').val());
    } else {
        $("#exp-date").text('');
    }
};

function updatePreviewDimensions() {
    var labelWidth = parseFloat($('#document_width').val()) || 1.96;
    var labelHeight = parseFloat($('#document_height').val()) || 1.18;

    // Update dimension display
    $('#preview-width').text(labelWidth);
    $('#preview-height').text(labelHeight);

    // Calculate scaled dimensions for preview (max 300px width for screen display)
    var maxPreviewWidth = 300;
    var aspectRatio = labelHeight / labelWidth;

    var previewWidth = Math.min(maxPreviewWidth, labelWidth * 96); // 96 DPI conversion
    var previewHeight = previewWidth * aspectRatio;

    // Apply dimensions to preview container
    $('#preview-container').css({
        'width': previewWidth + 'px',
        'height': previewHeight + 'px'
    });

    // Adjust font sizes based on preview size
    var fontScale = previewWidth / 200; // Scale factor based on 200px base
    var baseFontSize = Math.max(8, 12 * fontScale);

    $('#print-preview').css({
        'font-size': baseFontSize + 'px'
    });
}

function updateSliderLimits() {
    var docWidth = parseFloat($('#document_width').val()) || 1.96;
    var docHeight = parseFloat($('#document_height').val()) || 1.96;

    // Calculate reasonable max values based on document size
    var maxBarWidth = Math.max(1, docWidth * 1.5); // Allow reasonable width range
    var maxBarHeight = Math.max(10, docHeight * 40); // Convert inches to reasonable pixel height

    // Update slider max attributes
    $('#bar-width').attr('max', maxBarWidth);
    $('#bar-height').attr('max', maxBarHeight);

    // Update rangeslider if it exists
    if ($.fn.rangeslider) {
        $('#bar-width').rangeslider('destroy').rangeslider({
            polyfill: false,
            rangeClass: 'rangeslider',
            fillClass: 'rangeslider__fill',
            handleClass: 'rangeslider__handle',
            onSlide: newBarcode,
            onSlideEnd: newBarcode
        });

        $('#bar-height').rangeslider('destroy').rangeslider({
            polyfill: false,
            rangeClass: 'rangeslider',
            fillClass: 'rangeslider__fill',
            handleClass: 'rangeslider__handle',
            onSlide: newBarcode,
            onSlideEnd: newBarcode
        });
    }
}


// Updated newBarcode function with validation
var newBarcode = function () {
    // Update preview dimensions first
    updatePreviewDimensions();


    // Get values needed outside labelSettings
    var barcodeValue = $("#userInput").val();
    var backgroundColor = $("#background-color").val();
    var lineColor = $("#line-color").val();
    var fontSize = parseInt($("#bar-fontSize").val());

    // Create settings object - get values directly
    var labelSettings = {
        document_width: $('#document_width').val(),
        document_height: $('#document_height').val(),
        format: $("#barcodeLabelType").val(),
        margin_top: parseInt($('#margin_top').val()),
        margin_bottom: parseInt($('#margin_bottom').val()),
        margin_left: parseInt($('#margin_left').val()),
        margin_right: parseInt($('#margin_right').val()),
        textAlign: $(".text-align.btn-primary").val() || 'center',
        height: parseInt($("#bar-height").val()),
        width: parseFloat($("#bar-width").val()),
        margin: parseFloat($("#bar-margin").val()),
        textMargin: parseFloat($("#bar-text-margin").val()),
        font: $("#font").val(),

        // MISSING VALUES - Add these:
        fontSize: parseInt($("#bar-fontSize").val()),
        backgroundColor: $("#background-color").val(),
        lineColor: $("#line-color").val()
    };

    // Save to database early
    db.printLableValues.put({id: '1', printLabel: [labelSettings]});

    // Update display values
    $("#bar-width-display").text(labelSettings.width);
    $("#bar-height-display").text(labelSettings.height);
    $("#bar-fontSize-display").text(fontSize);
    $("#bar-margin-display").text(labelSettings.margin);
    $("#bar-text-margin-display").text(labelSettings.textMargin);

    // Update font and alignment for preview elements
    $(".fontfamily").css({
        "font-family": labelSettings.font,
        "text-align": labelSettings.textAlign,
        "font-size": fontSize + 'px'
    });

    // Generate barcode with current settings - reuse labelSettings
    $("#labelBarcode").JsBarcode(barcodeValue, {
        "format": labelSettings.format,
        "background": backgroundColor,
        "lineColor": lineColor,
        "fontSize": fontSize,
        "height": labelSettings.height,
        "width": labelSettings.width,
        "margin": labelSettings.margin,
        "textMargin": labelSettings.textMargin,
        "displayValue": "true",
        "font": labelSettings.font,
        "textAlign": labelSettings.textAlign,
        "marginTop": labelSettings.margin_top,
        "marginBottom": labelSettings.margin_bottom,
        "marginLeft": labelSettings.margin_left,
        "marginRight": labelSettings.margin_right,
        "fontOptions": $(".font-option.btn-primary").map(function () {
            return this.value;
        }).get().join(" "),
        "valid": function (valid) {
            if (valid) {
                $("#labelBarcode").show();
                $("#invalid").hide();
            } else {
                $("#labelBarcode").hide();
                $("#invalid").show();
            }
        }
    });

    // Update preview content
    updateLabelPreview();
};


$('#bar-fontSize').change(function () {
    $(".fontfamily").css({"font-size": $("#bar-fontSize").val() + 'px'});
});



/*
 * HSN lookup (owner ask): search by text as well as code - "electron"
 * finds electronics rows - and suggest codes from the item and category
 * names. The 8,924-row list loads once on demand and stays in memory;
 * every keystroke filters locally, nothing blocks typing.
 */
PosnicPro.items._hsnRows = null;
PosnicPro.items._hsnLoad = function (done) {
    if (PosnicPro.items._hsnRows) { done(PosnicPro.items._hsnRows); return; }
    PosnicPro.get({ url: 'items/getJSONhsncode' }, function (data) {
        var rows = (data && data.data && data.data.hsn) || [];
        rows.forEach(function (r) { r._d = (r.description || '').toLowerCase(); });
        PosnicPro.items._hsnRows = rows;
        done(rows);
    }, function () { done([]); });
};
PosnicPro.items._hsnRate = function (r) {
    var n = parseFloat(String(r.taxrate || '').replace('%', ''));
    return isFinite(n) ? n : 0;
};
PosnicPro.items._hsnApply = function (r) {
    $('#items_hsncode').val(r.value);
    $('#items_hsndescription').val(r.description);
    $('#hsn_tax').val(PosnicPro.items._hsnRate(r));
    $('#hsn_suggest_row').hide();
};
/* Top matches for the item + category words - the "right tax" nudge. */
PosnicPro.items.hsnSuggest = function () {
    if ($("input[name='hsntax_radio_value']:checked").val() !== 'hsncode') { return; }
    if ($.trim($('#items_hsncode').val())) { return; }
    var words = ($('#items_name').val() + ' ' + ($('.items_category option:selected').text() || ''))
        .toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 3; });
    if (!words.length) { $('#hsn_suggest_row').hide(); return; }
    PosnicPro.items._hsnLoad(function (rows) {
        var scored = [];
        for (var i = 0; i < rows.length; i++) {
            var hit = 0;
            for (var j = 0; j < words.length; j++) {
                if (rows[i]._d.indexOf(words[j]) !== -1) { hit++; }
            }
            if (hit) { scored.push([hit, rows[i]]); }
        }
        scored.sort(function (a, b) { return b[0] - a[0]; });
        var top = scored.slice(0, 3).map(function (x) { return x[1]; });
        if (!top.length) { $('#hsn_suggest_row').hide(); return; }
        var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
        $('#hsn_suggest_row').html('<small class="text-muted mr-1">Suggested:</small>' + top.map(function (r, i) {
            return '<a href="javascript:void(0)" class="badge badge-light border mr-1 hsn-chip" data-i="' + i + '">'
                + esc(r.value) + ' &middot; ' + esc((r.description || '').slice(0, 34))
                + ' &middot; ' + esc(String(r.taxrate || '').replace('%', '') || '0') + '%</a>';
        }).join('')).show().data('rows', top);
    });
};
$(document).on('click', '.hsn-chip', function () {
    var rows = $('#hsn_suggest_row').data('rows') || [];
    var r = rows[$(this).data('i')];
    if (r) { PosnicPro.items._hsnApply(r); }
});
$(document).on('change', "input[name='hsntax_radio_value']", function () {
    setTimeout(PosnicPro.items.hsnSuggest, 50);
});
$('.hsnCode').one({
    click: function () {
        PosnicPro.items._hsnLoad(function (rows) {
            $('.hsnCode').autocomplete({
                lookup: rows,
                autoSelectFirst: false,
                minChars: 1,
                deferRequestBy: 80,
                lookupLimit: 8,
                onSelect: function (suggestion) {
                    PosnicPro.items._hsnApply(suggestion);
                },
                lookupFilter: function (suggestion, query, queryLowerCase) {
                    return suggestion.value.indexOf(queryLowerCase) === 0
                        || suggestion._d.indexOf(queryLowerCase) !== -1;
                },
                formatResult: function (suggestion, currentValue) {
                    var rate = String(suggestion.taxrate || '').replace('%', '') || '0';
                    return '<div class="sug-row">'
                        + '<div class="sug-main"><div class="sug-name">'
                        + $.Autocomplete.formatResult(suggestion, currentValue)
                        + '</div><div class="sug-meta">' + $('<i>').text(suggestion.description || '').html()
                        + '</div></div><div class="sug-side"><span class="sug-stock in">GST ' + rate + '%</span></div></div>';
                }
            });
        });
    }
});

$(document).ready(function () {
    $('#hsn_code_show').hide();
    $('#hsn_tax').hide();
    $('#default_tax').show();
    PosnicPro.items.loadSelectCategory();
    PosnicPro.items.loadSelectVariant();
    PosnicPro.items.loadSelectTax();
    PosnicPro.items.loadSelectUnit();
    var defaultsupplierData = PosnicPro.local.get('defaultsupplier');
    var defaultsupplier = defaultsupplierData ? JSON.parse(defaultsupplierData) : null;

    if (PosnicPro.local.get('default_supplier_enable_disable') === 'false' || !defaultsupplier) {
        $('#items_supplier_id').val('');
        $('#items_supplier').val('');
    } else {
        $('#items_supplier_id').val(defaultsupplier.supplier_id);
        $('#items_supplier').val(defaultsupplier.supplier_name);
    }
    $(".items_category").val('').trigger('change.select2');
    $(".items_category").select2({
        placeholder: "Choose a Category"
    });
    // Typing in either discount field marks the pair as the user's - a
    // category pick then leaves them alone (applyCategoryDiscount).
    $(document).on('change', '#item_is_service', function () {
        PosnicPro.items.applyServiceMode();
    });
    $(document).on('click', '#item_tile_swatches .tile-swatch', function () {
        PosnicPro.items.setTileColor($(this).data('color') || '');
    });
    $(document).on('click', '#item_tile_shapes .tile-shape', function () {
        var shape = $(this).data('shape') || '';
        // Tap the picked shape again to clear it back to the default square.
        if (($('#item_tile_shape').val() || '') === shape) { shape = ''; }
        PosnicPro.items.setTileShape(shape);
    });
    $('#items_discount_amount, #items_discount_percentage').on('input', function () {
        PosnicPro.items._discountTouched = true;
    });
    // Ticking open-price re-judges the selling price immediately, so the
    // "enter a price" error clears the moment the choice is made.
    $('#item_open_price').on('change', function () {
        if ($('#items_selling_price').closest('form').data('validator')) {
            $('#items_selling_price').valid();
        }
    });
    /* IC1: real pickers on the date fields - they were bare text inputs
       validated as ISO dates, so MFG/expiry entry was guesswork. The
       daterangepicker bundle already ships with the dashboard (reports).
       autoUpdateInput stays off so an untouched field stays empty - both
       dates are optional. */
    if ($.fn.daterangepicker) {
        $('#items_mfg_date, #items_expiry_date').daterangepicker({
            singleDatePicker: true,
            showDropdowns: true,
            autoUpdateInput: false,
            locale: { format: 'YYYY-MM-DD' }
        }).on('apply.daterangepicker', function (ev, picker) {
            $(this).val(picker.startDate.format('YYYY-MM-DD')).trigger('change');
        });
    }
    // Stock adjustment: pick items via the receiving autocomplete (it
    // carries current stock); edit quantities in place; remove rows.
    $('#stock_adjust_search').autocomplete({
        lookup: function (query, done) {
            PosnicPro.get({
                url: 'items/getReceivingItemsAjaxList',
                data: 'query=' + encodeURIComponent(query) + '&type=normal'
            }, function (response) {
                done({
                    suggestions: $.map(response.suggestions || [], function (d) {
                        return { value: d.item_name, data: d };
                    })
                });
            }, function () { done({ suggestions: [] }); });
        },
        onSelect: function (suggestion) {
            var d = suggestion.data;
            if (!d || !d.item_id) { return; }
            if (!PosnicPro.items._adjRows[d.item_id]) {
                PosnicPro.items._adjRows[d.item_id] = {
                    name: d.item_name,
                    stock: Number(d.available_quantity) || 0,
                    qty: 0
                };
            }
            PosnicPro.items.renderAdjRows();
            var $box = $('#stock_adjust_search');
            $box.val('');
            if ($box.data('autocomplete')) { $box.autocomplete('clear'); }
            setTimeout(function () { $box.focus(); }, 0);
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false
    });
    $(document).on('input', '.adj-qty', function () {
        var id = $(this).data('id');
        if (PosnicPro.items._adjRows[id]) {
            PosnicPro.items._adjRows[id].qty = Number($(this).val()) || 0;
            // Update only the computed cell, keep focus in the input.
            var mode = PosnicPro.items._adjMode();
            var r = PosnicPro.items._adjRows[id];
            var after = mode === 'set' ? r.qty : mode === 'add' ? r.stock + r.qty : Math.max(0, r.stock - r.qty);
            $(this).closest('tr').find('td').eq(3).text(after);
        }
    });
    $(document).on('click', '.adj-remove', function () {
        delete PosnicPro.items._adjRows[$(this).data('id')];
        PosnicPro.items.renderAdjRows();
    });
    $("#items_variant").val(1).trigger('change.select2');
    $("#items_variant").select2({
        placeholder: "Choose a Variant"
    });
    $("#items_tax").select2({
        placeholder: "Choose a Tax"
    });
    $("#load_price_fields").html('');
});
$('.click-tax-value').click(function () {
    var hsnValue = $("input[name='hsntax_radio_value']:checked").val();
    if (hsnValue === 'hsncode') {
        $('#hsn_code_show').show();
        $('#hsn_tax').show();
        $('#default_tax').hide();
    } else {
        $('#hsn_code_show').hide();
        $('#hsn_tax').hide();
        $('#default_tax').show();
    }
});

$('.item_image_setting').click(function () {
    $('#image_popup').modal('show');
});
$('.itemimageview').click(function () {
    $('#item_coverimg_popup').modal('show');
});

$('#items_variant').one('change', function () {
    var variantSelect = $('#items_variant');
    variantSelect.on('select2:select', function (e) {
        var data = e.params.data;
        var variant = data.element.attributes['data-variant-fields'].value;
        var variantOption = [];
        variant: $.map(JSON.parse(variant), function (dataItem) {
            variantOption += '<option value="' + dataItem.name + '">' + dataItem.name + '</option>';
        });
        $('#item_variant_list').html(variantOption);
    });
});
$('.items_category').one('change', function () {
    var categorySelect = $('.items_category');
    categorySelect.on('select2:select', function (e) {
        var data = e.params.data;
        var hash = window.location.hash.slice(1);
        if (hash === '/items/new') {
            // Use the common function to apply discount
            PosnicPro.items.applyCategoryDiscount(data.element);
        }
    });
});
$('#items_barcodeid').scannerDetection({
    timeBeforeScanTest: 200, // wait for the next character for upto 200ms
    avgTimeByChar: 40, // it's not a barcode if a character takes longer than 100ms
    preventDefault: true,
    endChar: [13],
    onComplete: function (barcode, qty) {
        validScan = true;
        $('#items_barcodeid').val(barcode).focus();
    },
    onError: function (string, qty) {
        $('#items_barcodeid').val($('#items_barcodeid').val() + string).focus();
    }
});
$(document).on('change', '.kiosk-toggle', function () {
    var itemId = $(this).attr('id').replace('kiosk_', '');
    var isChecked = $(this).is(':checked');
    PosnicPro.items.updateItemAvailability(itemId, isChecked);
});
/*end*/

