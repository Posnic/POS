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
        $('#show_price_fields').show();
        $("#load_price_fields").html('');
        $("#show-hide-item-discount").show();
        $('#item_variant_header').hide();

        PosnicPro.showEditModal('items');
        PosnicPro.items.editItem(id);
        $('#item_discount').show();
        $('#v-pills-inventory-tab').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('#items_reset').hide();
        $('.items_edit_reset').show();
        $('.items_edit_reset').attr("id", id);
        $('.error_item').css('display', 'none');
        PosnicPro.items.itemAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'items');
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

                    let image_path = (row.image !== "item.svg") ? row.image : 'static/images/default/' + row.image;
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
                    var trow = '<tr> <th><input type="checkbox" class="items-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'items\');"></th> <th scope="row">' + row_no + '</th>  <td width="30%"><a href="#/items/' + row._id + '"><i class="table_model_item">' + row.name + '</i></a></td> <td><img src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + row.image + '" onclick="PosnicPro.viewImage(this.id,\'item\');"></td> <td class="text-center">' + row.itemid + '</td> <td class="text-right">' + row.available_quantity + ' ' + item_unit + '</td> <td class="text-center"><span class="' + process_class + '">' + row.item_status + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td> ' +
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
        $('#show_price_fields').show();
        $('#product_without_variant').prop('checked', true);
        $('#product_with_variant').prop('checked', false);
        $('#show_variant_fields').hide();
        $('#show_price_fields').show();
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

                var content = $('textarea[name="items_description"]').html($('#items_description').summernote('code'));
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
                    hsn_code: hsn_code,
                    hsn_description: $('#items_hsndescription').val(),
                    tax_method: tax_method,
                    tax_name: tax_name,
                    tax_id: tax_id,
                    tax: tax_value,
                    tax_type: $('input[name="tax_radio_value"]:checked').val(),
                    description: content.html(),
                    image: PosnicPro.items.imageParams
                };
                var params = {
                    method: method,
                    url: url,
                    data: JSON.stringify(Object.assign(formData, param_fields))
                };
                PosnicPro.request(params, function (response) {

                    if (response.type === 'success') {
                        var data = response.data;
                        PosnicPro.items.addItemButton();
                        PosnicPro.items.loadSelectUnit();
                        $('#item_image_upload_form')[0].reset();
                        PosnicPro.stocklogs.viewLowStockDashboard();
                        PosnicPro.sales.itemsMenu.onlineProductList();
                        if (PosnicPro.action === 'add')
                            $('#show_last_created_item').show();
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
                        $('#items_description').summernote('code', '');
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
                        $(".items_category").val(1).trigger('change.select2');
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
        $("#item-sale-tab,#item-image-tab,#item-description-tab").removeClass("active");
        $("#item_sale,#item_image,#description_detail").removeClass("active show");
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
        var image_path = (data.image !== "item.svg") ? data.image : 'static/images/default/' + data.image;
        $('.itemimageview').attr('src', image_path);
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
    /*Edit item dsetails*/
    editItem: function (id) {
        var loader = $(".loader-item");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#items_new').show();
        $('#items_description').html('').text('');
        $('#items_description').summernote('code', '');
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
                $('#show_price_fields').show();
                var data = response.data;
                PosnicPro.record_id = id;
                $('#itemid').val(PosnicPro.record_id);
                $('#items_name').val(data.name);
                $('#items_itemid').val(data.itemid);
                $('#items_barcodeid').val(data.barcode_id);
                $('#items_hsncode').val(data.hsncode);
                $('#items_hsndescription').val(data.hsndescription);
                $('#items_date').val(response.data.item_date);
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
                $('#item_image').val(data.image);
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
                $('#itemImage').val(data.image);
                $('#items_sort').val(data.sort_order);
                if (data.description !== '') {
                    $('#items_description').append(data.description);
                    var htmlView = $('#items_description').text();
                    $('#items_description').summernote('pasteHTML', htmlView);
                }
                (data.track_inventory === true) ? $('#item_track_inventory').prop('checked', true) : $('#item_track_inventory').prop("checked", false);
                (data.sales_channel === true) ? $('#item_sales_channel').prop('checked', true) : $('#item_sales_channel').prop("checked", false);
                (data.ecommerce === true) ? $('#item_ecommerce').prop('checked', true) : $('#item_ecommerce').prop("checked", false);
                (data.negative_stock === true) ? $('#item_negative_stock').prop('checked', true) : $('#item_negative_stock').prop("checked", false);
                (data.item_weight_machine_based === true) ? $('#item_weight_machine_based').prop('checked', true) : $('#item_weight_machine_based').prop("checked", false);
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
            $('#show_price_fields').show();
            $("#load_price_fields").html('');
            $("#show-hide-item-discount").show();
        } else {
            $('#show_price_fields').hide();
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
    itemImageFormSubmit: function () {

        if ($('#item_value_check').val('') !== '' && $('#items_name').val() !== '') {
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
            PosnicPro.alert('error', 'Please fill required fields');
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
        $('#items_description').summernote('code', '');
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
                $('#items_date').val(response.data.item_date);
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
                (data.tax_type === 'inclusive') ? $('#item_tax_inclusive').prop('checked', true) : $('#item_tax_exclusive').prop("checked", true);
                $("#items_tax").val(data.tax_id).trigger("change");
                $('#addItem').modal('show');
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
                    $('#items_description').append(data.description);
                    var htmlView = $('#items_description').text();
                    $('#items_description').summernote('pasteHTML', htmlView);
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
            PosnicPro.alert('error', 'Please fill required fields');
            $("#items_name").focus();
            return false;
        } else if (variant_value.length === 0) {
            PosnicPro.alert('error', 'Please fill required fields');
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
                html = html + '<lang class="lang_company_title"> Company </lang>';
                html = html + '</label>';
                html = html + '<input type="text" class="form-control allow_decimal text-right" id="items_company_price_' + key + '" name="items_company_price_' + key + '" minlength="1" maxlength="10" value="0.00" placeholder="Company Price">';
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
                    PosnicPro.alert('error', fileNameArray + "Size should be less than 5MB !");
                    return false;
                }
                if ($('#item-display-preview').find('div').length > 11) {
                    PosnicPro.alert('error', "Maximum 12 files are allowed");
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
            console.log('No selectedOption provided');
            return;
        }
        // Get discount values using jQuery data attributes or direct attribute access
        var $option = $(selectedOption);
        var discountAmount = parseFloat($option.attr('data-item-discountamount')) || 0;
        var discountPercentage = parseFloat($option.attr('data-item-discountpercentage')) || 0;
        
        console.log('Category:', $option.attr('data-category-name'));
        console.log('Discount Amount:', discountAmount);
        console.log('Discount Percentage:', discountPercentage);
        
        // Check which discount type is set in the category
        if (discountAmount > 0 && discountPercentage === 0) {
            // Category uses amount discount
            $("#item_radio_discount_amount").prop('checked', true).trigger('click');
            $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#items_discount_amount').removeAttr('disabled').removeClass('bg-white').show();
            $('#items_discount_amount').val(discountAmount);
        } else if (discountPercentage > 0) {
            // Category uses percentage discount
            $("#item_radio_discount_percentage").prop('checked', true).trigger('click');
            $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#items_discount_percentage').removeAttr('disabled').removeClass('bg-white').show();
            $('#items_discount_percentage').val(discountPercentage);
        } else {
            // No discount set, default to amount with 0
            $("#item_radio_discount_amount").prop('checked', true).trigger('click');
            $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#items_discount_amount').removeAttr('disabled').removeClass('bg-white').show();
            $('#items_discount_amount').val(0);
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
            suggestions: $.map(response.suggestions, function (dataItem) {
                var option;
                option += '<option value="' + dataItem.id + '" data-category-name="' + dataItem.name + '" data-category-id="' + dataItem.id + '" data-item-discountamount="' + dataItem.discount_amount + '" data-item-discountpercentage="' + dataItem.discount_percentage + '">' + dataItem.name + ' </option>';
                categorySelect.append(option).select2();
            });
            $(".items_category").val(1).trigger('change.select2');
            $(".items_category").select2({
                placeholder: "Choose a Category"
            });
            if (response.suggestions.length > 0) {
                var lastCategory = response.suggestions[response.suggestions.length - 1];
                categorySelect.val(lastCategory.id).trigger('change.select2');
                $('.error_item').css('display', 'none');
            }
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
        $('#items_description').summernote('code', '');
        $('#items_new .alert').remove();
        if ($("#product_without_variant").is(":checked")) {
            $('#show_variant_fields').hide();
            $('#show_price_fields').show();
            $('#product_without_variant').prop('checked', true);
        } else {
            $('#show_price_fields').hide();
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
        $(".items_category").val(1).trigger('change.select2');
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

                    $('.item_details_saletotalvalue').html(saleTotalValue);
                    $('.item_details_returntotalvalue').html(returnTotalValue);
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
    itemdetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemdetails.itemdetailsTable(type);
    }
};

PosnicPro.instant = {
    triggerModules: function () {
        if ($('#instance_items_discount_amount').val() > 0) {
            $("#instance_item_radio_discount_amount").prop('checked', 'checked');
            $('#instance_items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#instance_items_discount_amount').removeAttr('disabled', 'disabled').show();
            $('#instance_items_discount_amount').val($('#instance_items_discount_amount').val());
        } else if ($('#instance_items_discount_percentage').val() > 0) {
            $("#instance_item_radio_discount_percentage").prop('checked', 'checked');
            $('#instance_items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
            $('#instance_items_discount_percentage').removeAttr('disabled', 'disabled').show();
            $('#instance_items_discount_percentage').val($('#instance_items_discount_percentage').val());
        } else {
            $("#instance_item_radio_discount_amount").prop('checked', 'checked');
            $('#instance_items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide().val('0');
            $('#instance_items_discount_amount').removeAttr('disabled', 'disabled').show();
            $('#instance_items_discount_amount').val('0.00');
        }
        
        // Open modal first
        PosnicPro.showAddModal('instance');
        
        // Load tax options with callback to set default after success
        var data = {
            tax_group: 'all'
        };
        var params = {
            url: 'setting/getTaxAll',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                var taxOption = '';
                if (data.length > 0) {
                    $.each(data, function (index, value) {
                        taxOption += '<option value="' + value.tax_id + '" data-tax-id="' + value.tax_id + '" data-tax-name="' + value.tax_name + '" data-tax-value="' + value.tax_value + '">' + value.tax_name + '</option>';
                    });
                } else {
                    taxOption += '<option selected="selected" value="0">No tax</option>';
                }
                $('#instance_items_tax').html(taxOption);
                
                // Set default tax AFTER options are loaded successfully
                if (PosnicPro.local.get('default_tax_enable_disable') === 'false') {
                    $('#instance_items_tax').val(1).trigger('change.select2');
                } else {
                    var defaultTaxId = PosnicPro.local.get('default_tax_id');
                    if (defaultTaxId && $('#instance_items_tax option[value="' + defaultTaxId + '"]').length) {
                        $('#instance_items_tax').val(defaultTaxId).trigger('change.select2');
                    } else {
                        $('#instance_items_tax').val(1).trigger('change.select2');
                    }
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    instanceItemAdd: function () {
        var loader = $(".loader-instance");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $("#save_submit").removeClass("disabled");

        let unitDetail = $("#instance_items_unit").select2("data") || [];
        var taxDetail = $("#instance_items_tax").select2("data") || [];

        var tax_value = '0';
        var tax_id = '1';
        var tax_name = 'No Tax';

        if (taxDetail.length > 0 && taxDetail[0] && taxDetail[0].element) {
            tax_value = taxDetail[0].element.getAttribute('data-tax-value') || tax_value;
            tax_id = taxDetail[0].element.getAttribute('data-tax-id') || tax_id;
            tax_name = taxDetail[0].element.getAttribute('data-tax-name') || tax_name;
        } else {
            var taxOptionEl = $("#instance_items_tax").find('option:selected')[0];
            if (taxOptionEl) {
                tax_value = taxOptionEl.getAttribute('data-tax-value') || tax_value;
                tax_id = taxOptionEl.getAttribute('data-tax-id') || tax_id;
                tax_name = taxOptionEl.getAttribute('data-tax-name') || tax_name;
            }
        }

        var categoryDetail = $("#instance_items_category").select2("data") || [];
        var categoryEl = null;
        if (categoryDetail.length > 0 && categoryDetail[0] && categoryDetail[0].element) {
            categoryEl = categoryDetail[0].element;
        } else {
            categoryEl = $("#instance_items_category").find('option:selected')[0];
        }

        var category_id = categoryEl ? (categoryEl.getAttribute('data-category-id') || categoryEl.value || '') : '';
        var category_name = categoryEl ? (categoryEl.getAttribute('data-category-name') || categoryEl.textContent || '') : '';

        var unitValue = null;
        if (unitDetail.length > 0 && unitDetail[0] && unitDetail[0].element) {
            unitValue = unitDetail[0].element.getAttribute('data-unit-value') || null;
        } else {
            var unitOptionEl = $("#instance_items_unit").find('option:selected')[0];
            if (unitOptionEl) {
                unitValue = unitOptionEl.getAttribute('data-unit-value') || null;
            }
        }

        var params = {
            url: 'items/instanceItemInsert',
            data: JSON.stringify({
                "items_name": $("#instance_items_name").val(),
                "items_quantity": $("#instance_items_quantity").val(),
                "items_mrp_price": $("#instance_items_mrp_price").val(),
                "items_selling_price": $("#instance_items_selling_price").val(),
                "items_company_price": $("#instance_items_company_price").val(),
                "items_discount_amount": $("#instance_items_discount_amount").val(),
                "items_discount_percentage": $("#instance_items_discount_percentage").val(),
                "items_tax_id": tax_id,
                "items_tax_name": tax_name,
                "items_tax": tax_value,
                "items_tax_type": $('input[name=tax_instant_radio_value]:checked').val(),
                "items_sku": $("#instance_items_itemid").val(),
                "items_category_id": category_id,
                "items_category_name": category_name,
                "items_unit": unitValue
            })
        };
        PosnicPro.post(params, function (response) {

            if (response.type === 'success') {
                var data = response.data;
                var itemDetails = {
                    "item_id": data.id,
                    "item_name": data.name,
                    "selling_price": data.selling_price,
                    "barcode_id": data.barcode_id,
                    "item_quantity": data.available_quantity,
                    "discount_amount": data.discount_amount,
                    "discount_percentage": data.discount_percentage,
                    "tax": data.tax,
                    "company_price": data.company_price,
                    "category_id": data.category_id,
                    "category_name": data.category_name,
                    "tax_type": data.tax_type,
                    "sales_type": 'instant',
                    "instant_status": 'ok',
                    "unit": data.unit
                };
                hasher.changed.active = false; //disable changed signal
                hasher.replaceHash('sales/new');
                PosnicPro.sales.addSalesLineItems(itemDetails);
                $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                $("#infobar-settings-sidebar-instance").removeClass("sidebarshow");
                PosnicPro.sales.instanceClearForm();
                PosnicPro.items.loadSelectUnit();
                hasher.changed.active = true; //enable changed signal
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

$(function () {
    $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0.00').hide();
    $('#items_supplier').on('keypress keydown.autocomplete', function () {
        var branch = PosnicPro.local.get("branch_id_set");
        $(this).autocomplete({
            lookup: function (query, done) {
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
    $("#product_without_variant, #product_with_variant").change(function () {
        if ($("#product_without_variant").is(":checked")) {
            $('#show_variant_fields').hide();
            $('#show_price_fields').show();
            $("#load_price_fields").html('');
            $("#show-hide-item-discount").show();
        } else {
            $('#show_price_fields').hide();
            $('#show_variant_fields').show();
            $("#show-hide-item-discount").hide();
        }
    });
});

/*for display client validation of the form details*/
$(document).ready(function () {
    $("#instance_item_radio_discount_amount,#item_radio_discount_amount").prop('checked', 'checked');
    $('#instance_items_discount_percentage,#items_discount_percentage').attr('disabled', 'disabled').val('0').hide();
    $('#instance_items_discount_amount, #items_discount_amount').removeAttr('disabled', 'disabled').val('0').show();
    jQuery.validator.addMethod("alphanumeric", function (value, element) {
        if ((/[*|\":<>[\]{}`\\';@&#!]/.test(value))) {
            return false;
        }
        return true;
    }, "Please Enter a Valid Name");

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
                required: true,
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
                maxlength: 7
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
            }

        },
        messages: {
            items_name: {
                required: "Please Enter Item Name",
                minlength: "Item Name must consist of at least 3 characters",
                maxlength: "Item Name should not be more than 100 characters"
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
                required: "Please Choose Supplier",
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
    $("#item_image_upload_form").submit(function (event) {
        event.preventDefault();
        if ($('#item_image_upload_form').valid()) {            // checks form for validity
            if ($("#product_with_variant").is(":checked") && $("#load_price_fields").html() === '') {
                PosnicPro.items.loadVariant();
            } else {
                if ($('#item_upload_image_status').val() === 'no') {
                    PosnicPro.items.item();
                } else {
                    PosnicPro.items.itemImageFormSubmit();
                }
            }

        }
    });

    $("#instance_item_radio_discount_amount, #instance_item_radio_discount_percentage").change(function () {
        if ($("#instance_item_radio_discount_amount").is(":checked")) {
            $('#instance_items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
            $('#instance_items_discount_amount').removeAttr('disabled', 'disabled').show().focus().select();
        } else {
            $('#instance_items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').val('0.00').hide();
            $('#instance_items_discount_percentage').removeAttr('disabled', 'disabled').show().focus().select();
        }
    });

});
$('.modal').on('show.bs.modal', function () {
    $('#categories_view').css('z-index', 1051);
});

$("#instance_item_form").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    errorPlacement: function (label, element) {
        if (element.hasClass('instance_items_choose_error') && element.next('.select2-container').length) {
            label.insertAfter(element.next('.select2-container'));
        } else {
            label.addClass('mt-2 text-danger');
            label.insertAfter(element);
        }
    },
    rules: {
        instance_items_name: {
            required: true,
            minlength: 3,
            maxlength: 500
        },
        instance_items_category: {
            required: true
        },
        instance_items_quantity: {
            required: true,
            minlength: 1,
            maxlength: 7
        },
        instance_items_mrp_price: {
            minlength: 1,
            maxlength: 7
        },
        instance_items_tax: {
            required: true
        }
    },
    messages: {
        instance_items_name: {
            required: "Please Enter Item Name",
            minlength: "Item Name must consist of at least 3 characters",
            maxlength: "Item Name should not be more than 500 characters"
        },
        instance_items_category: {
            required: "Choose Item Category"
        },
        instance_items_quantity: {
            required: "Please Enter Item Qty",
            minlength: "Qty must consist of at least 1 characters",
            maxlength: "Qty should not be more than 7 characters"
        },
        instance_items_selling_price: {
            required: "Please Enter Selling Price",
            minlength: "Selling Price must consist of at least 1 characters",
            maxlength: "Selling Price should not be more than 10 characters"
        },
        instance_items_mrp_price: {
            minlength: "This field must consist of at least 1 characters",
            maxlength: "This field should not be more than 7 characters"
        },
        instance_items_tax: {
            required: "Choose Item Tax"
        }
    }
});

// Auto-fill MRP and Company price when selling price is entered
$(document).on('input', '#instance_items_selling_price', function() {
    var sellingPrice = $(this).val();
    if (sellingPrice && sellingPrice !== '') {
        $('#instance_items_mrp_price').val(sellingPrice);
        $('#instance_items_company_price').val(sellingPrice);
    }
});

$("#instance_item_form").submit(function (event) {
    event.preventDefault();
    if ($('#instance_item_form').valid()) {            // checks form for validity
        PosnicPro.instant.instanceItemAdd();
    }
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

$('#items_description').summernote({
    height: 120,
    toolbar: [
        ['style', ['style']],
        ['font', ['bold', 'underline', 'clear']],
        ['color', ['color']],
        ['para', ['ul', 'ol', 'paragraph']],
        ['table', ['table']],
        ['view', ['fullscreen', 'help']],
        ['height', ['height']],
        ['fontsize', ['fontsize']],
        ['fontname', ['fontname']]
    ],
    placeholder: 'Enter a description ...',
    focus: true,
    callbacks: {
        onKeydown: function (e) {
            var t = e.currentTarget.innerText;
            if (t.trim().length === 0) {
                $('#items_description').summernote('code', '');
            }
            if (t.trim().length >= 1000) {
                //delete keys, arrow keys, copy, cut, select all
                if (e.keyCode != 8 && !(e.keyCode >= 37 && e.keyCode <= 40) && e.keyCode != 46 && !(e.keyCode == 88 && e.ctrlKey) && !(e.keyCode == 67 && e.ctrlKey) && !(e.keyCode == 65 && e.ctrlKey))
                    e.preventDefault();
            }
        },
        onKeyup: function (e) {
            var t = e.currentTarget.innerText;
            if (t.trim().length === 0) {
                $('#items_description').summernote('code', '');
            }
            $('#items_description').text(1000 - t.trim().length);
        },
        onPaste: function (e) {
            var t = e.currentTarget.innerText;
            var bufferText = ((e.originalEvent || e).clipboardData || window.clipboardData).getData('Text');
            e.preventDefault();
            var maxPaste = bufferText.length;
            if (t.length + bufferText.length > 1000) {
                maxPaste = 1000 - t.length;
            }
            if (maxPaste > 0) {
                document.execCommand('insertText', false, bufferText.substring(0, maxPaste));
            }
            $('#items_description').text(1000 - t.length);
        }
    }

});

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



$('.hsnCode').one({
    click: function () {
        var params = {
            url: 'items/getJSONhsncode'
        };
        PosnicPro.get(params, function (data) {

            $('.hsnCode').autocomplete({
                lookup: data.data['hsn'],
                autoSelectFirst: false,
                minChars: 1,
                lookupLimit: 5,
                onSelect: function (suggestion) {
                    $('#items_hsndescription').val(suggestion.description);
                    $('#hsn_tax').val(suggestion.taxrate);
                },
                lookupFilter: function (suggestion, query, queryLowerCase) {
                    var id = suggestion.description,
                            value = suggestion.value.toLowerCase();
                    return id.indexOf(query) === 0 || value.indexOf(queryLowerCase) === 0;
                },
                formatResult: function (suggestion) {
                    var description = suggestion.description;
                    return '<div>' +
                            $.Autocomplete.formatResult(suggestion) +
                            '</div><span style="margin-top:-20px;">' + description + '</span><span class="pull-right" style="margin-top:-20px;">Tax :' + suggestion.taxrate + '</span>';
                }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
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
    $(".items_category").val(1).trigger('change.select2');
    $(".items_category").select2({
        placeholder: "Choose a Category"
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
        } else if (hash === '/sales/instant/new') {
            if (data.element.attributes['data-item-discountamount'].value > 0) {
                $("#instance_item_radio_discount_amount").prop('checked', 'checked');
                $('#instance_items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                $('#instance_items_discount_amount').removeAttr('disabled', 'disabled').show();
                $('#instance_items_discount_amount').val(data.element.attributes['data-item-discountamount'].value);
            } else {
                $("#instance_item_radio_discount_percentage").prop('checked', 'checked');
                $('#instance_items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
                $('#instance_items_discount_percentage').removeAttr('disabled', 'disabled').show();
                $('#instance_items_discount_percentage').val(data.element.attributes['data-item-discountpercentage'].value);
            }
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

