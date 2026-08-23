PosnicPro.settings = {
    store_telephone: null,
    /*
     * #/settings/<x> serves two callers: a 24-hex Mongo id is a recycle-bin
     * row (the original meaning), anything else is a SECTION deep link
     * (#/settings/modules, #/settings/tax ...) so a refresh keeps the page
     * you were on - Config sections finally have routes.
     */
    showDetails: function (id) {
        if (!/^[0-9a-f]{24}$/i.test(String(id))) {
            PosnicPro.settings.openSection(String(id));
            return;
        }
        var loader = $(".loader-view-recyclebin");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.settings.viewRecycleBinDetails(id);
    },
    openSection: function (key) {
        if (!$('#settings').is(':visible')) {
            PosnicPro.settings.showDataTablePage();
        }
        // Pill ids are v-pills-<key>-tab, with a few legacy ones missing the
        // suffix (v-pills-unit). Clicking (not tab('show')) runs the pill's
        // own loader onclick; an already-active pill is a no-op, so the
        // hash-sync round trip cannot loop.
        var $pill = $('#v-pills-' + key + '-tab');
        if (!$pill.length) { $pill = $('#v-pills-' + key); }
        // NOT :visible - the whole pills rail is display:none now (the
        // Manage sidebar replaced it), which made every pill "invisible"
        // and silently refused every section switch. Module gating sets
        // INLINE display:none on individual pills; that is the real gate.
        if ($pill.length && $pill.css('display') !== 'none') { $pill[0].click(); }
        if (key === 'general') { PosnicPro.settings.restoreCoreTab(); }
    },
    /*
     * The branch's tax profile dresses the registration field (T2): every
     * country has a registration identity - GSTIN, VAT No., TRN, ABN - so
     * the field shows for everyone, labelled and shaped by the profile.
     * India keeps exactly its current look; the gst_action machinery is
     * untouched. Presentation only, and failure leaves things as they are.
     */
    applyTaxProfile: function () {
        PosnicPro.get({ url: 'setting/taxProfile', data: {} }, function (r) {
            var p = r && r.data;
            if (!p || !p.registration) { return; }
            PosnicPro.settings._taxProfile = p;
            $('.branch-gstin-hide-show').show();
            $('.branch-gstin-hide-show label lang').text(p.registration.label);
            $('#branch_gstin_number').attr('placeholder', 'Enter the ' + p.registration.label);
            if (!p.registration.regex) {
                $('#branch_gstin_number').removeAttr('minlength').attr('maxlength', 30);
            }
        }, function () { /* presentation only - never disturb the page */ });
    },
    restoreCoreTab: function () {
        var stored = PosnicPro.local.get('posnic_core_tab');
        if (stored && $('#core_settings_tabs a[href="' + stored + '"]').length) {
            $('#core_settings_tabs a[href="' + stored + '"]').tab('show');
        }
    },
    showShortcut: function () {
        $('#shortcutkey').modal('show');
        $(document).ready(function () {
            $("#shortcutkey").on("keypress", function (e) {
                if ((e.keyCode <= '122')) {
                    $('#shortcutkey').modal('hide');
                }
            });
        });
    },
    restoreDetails: function (id) {
        PosnicPro.settings.restoreTableData(id);
    },
    /*** restore Document Backup ***/
    restoreTableData: function (id) {
        var arr = [];
        var obj = {};
        obj = id;
        arr.push(obj);
        var params = {
            url: 'setting/restoreBackup',
            data: JSON.stringify({ data: arr })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.settings.settingsTable();
                PosnicPro.items.loadSelectCategory();
                PosnicPro.stocklogs.viewLowStockDashboard();
                hasher.setHash('settings');
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    triggerDefault: function (name) {
        $('.customer_edit_reset').hide();
        $('default' + name).val('');
        $('#' + name + '_title').text('Add');
        $('#' + name + '_button_title').text('Save');
        $('.' + name + '-trigger').val('');
        $(".infobar-settings-sidebar-overlay").css({ "background": "rgba(0,0,0,0.4)", "position": "fixed" });
        $("#infobar-settings-sidebar-" + name).addClass("sidebarshow");
        let default_name = $('.default-' + name + '-name').val();
        $('#' + name + '_name').val(default_name);
    },
    viewRecycleBinDetails: function (id) {
        var module_name = $('#backuptablelist :selected').val();
        $(".setting-heading").text(module_name);
        var loader = $(".loader-view-recyclebin");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/getRecycleBin',
            data: { id: id }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                var module = $('#backuptablelist').val();
                if (module === 'customers') {
                    PosnicPro.customers.viewCustomerData(response);
                } else if (module === 'suppliers') {
                    PosnicPro.suppliers.viewSupplierData(response);
                } else if (module === 'categories') {
                    PosnicPro.categories.viewCategoryData(response);
                } else if (module === 'expenses') {
                    PosnicPro.expenses.viewExpensesData(response);
                } else if (module === 'items') {
                    PosnicPro.items.viewItemData(response);
                } else if (module === 'branches') {
                    PosnicPro.branches.viewBranchData(response);
                } else if (module === 'users') {
                    PosnicPro.users.viewUserData(response);
                } else if (module === 'sales') {
                    $('#sales-total-hide,#viewsale_edit_print_view,#salesitemtitleText,#sale_print_view,#return_print_view').show();
                    $('#hide_sales_print,#hide_return_print').show();
                    var data = response.data;
                    if (data.payment_description === '') {
                        $('.paynote_hide').hide();
                    } else {
                        $('.paynote_hide').show();
                    }
                    if (data.sales_description === '') {
                        $('.salenote_hide').hide();
                    } else {
                        $('.salenote_hide').show();
                    }
                    if (data.sale_process === 'Add' || data.sale_process === 'Edit' || data.sale_process === 'Hold') {
                        $('.sale-view-heading').html('Sale');
                        $('.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print,#show_sales_print').hide();
                    } else if (data.sale_process === 'FullReturn') {
                        $('.sale-view-heading').html('Return');
                        $('.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print').show();
                        $('#viewsale_edit_print_view,#salesitemtitleText,#sales-total-hide,#sale_print_view,#hide_sales_print,#show_sales_print').hide();
                    } else {
                        $('.sale-view-heading').html('Sale');
                        $('#sales-total-hide,.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print,#show_sales_print').show();
                        $('#hide_sales_print,#hide_return_print').hide();
                    }
                    var saleId = data._id || data.id || id;
                    PosnicPro.record_id = saleId;
                    PosnicPro.sales.view.viewSaleData(response, saleId);
                } else if (module === 'stocklogs') {
                    PosnicPro.stocklogs.viewStockData(response);
                } else {
                    $('#receiving_button_print_view,#receiving_return_print_view').show();
                    $('#hide_receiving_print,#hide_receiving_return_print').show();
                    if (data.receiving_status === 'FullReturn') {
                        $('.hide-receiving-return,#receiving_return_print_view,#hide_receiving_return_print').show();
                        $('.hide-receiving-table,#receiving_button_print_view,#show_receiving_print,#hide_receiving_print').hide();
                    } else if (data.receiving_status === 'Open' || data.receiving_status === 'Received') {
                        $('.hide-receiving-table,#receiving_button_print_view,#hide_receiving_print').show();
                        $('.hide-receiving-return,#receiving_return_print_view,#show_receiving_print,#hide_receiving_return_print').hide();
                    } else {
                        $('.hide-receiving-table,.hide-receiving-return,#receiving_button_print_view,#receiving_return_print_view,#show_receiving_print').show();
                        $('#hide_receiving_print,#hide_receiving_return_print').hide();
                    }

                    $('#receivingtitelText').html('Receiving Details (' + data.receiving_status + ')');
                    PosnicPro.receivings.view.viewReceivingData(response);
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    settingsTable: function () {
        PosnicPro.HideSideBarModal();
        let branchId = $("#Select_backup_Branch").val().toString();
        if (branchId !== '') {
            $("#backup_report_selecter").hide();
            $("#backup_report_table_div").show();
            let tableName = $('#backuptablelist').val();
            (tableName === 'branches') ? $('#hide_branch_recyclebin,#Select_backup_Branch').hide() : $('#hide_branch_recyclebin,#Select_backup_Branch').show();
            let loader = $(".loader-table-recyclebin,.loader-table-setting");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendRecyclebinDataTableBody(tableName);
            $("#view_settings").show();
            let daterange = $("#view_backup_daterange").val();
            let fields = daterange.split('-');
            let first_date = fields[0];
            let last_date = fields[1];
            let field_select = $("#view_recycle_bin_fields option:selected").val();
            let field_input = $("#view_recycle_bin_input").val();
            let table = $('#view_settings');
            $('#card_recycle').css({ "background-color": "transparent", "margin-bottom": "0px" });
            let data = {
                page: table.data('current_page'),
                limit: parseInt($('#view_settings_per_page  option:selected').text()),
                table: tableName,
                starting_date: first_date,
                ending_date: last_date,
                branch: $("#Select_backup_Branch").val(),
                field_select: field_select,
                field_input: field_input
            };
            let params = {
                url: 'setting/backupTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    table.data('total', response.data.total);
                    table.data('total_pages', response.data.total_pages);
                    table.data('current_page', response.data.current_page);
                    table.data('per_page', response.data.per_page);
                    PosnicPro.paging(response.data.total_pages, response.data.current_page);
                    table.children('tbody').text('');
                    $('#view_settings_total').text(response.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_settings_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_settings_page_perpage_total').text(page_totals + response.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    for (var i = 0; i < response.data.list.length; i++) {
                        var row = response.data.list[i];
                        var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "branch" data-access = "read"  href="#/settings/' + row._id + '" data-id="settings/' + row._id + '"  data-toggle="tooltip" title="View" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "branch" data-access = "write" data-toggle="tooltip" title="Restore" href="#/settings/' + row._id + '/restore" data-id="settings/' + row._id + '/restore" class="point-cursor mobile_tooltip"><i class="feather icon-repeat"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';
                        var updateDate = PosnicPro.convertDate(row.string_date);
                        if (tableName === 'sales') {
                            var trow = '<tr> <td><input type="checkbox" class="sales-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'sales\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.sales_id + '</td> <td>' + updateDate + '</td> <td>' + row.customer_name + '</td> <td class="text-center"><span class="badge badge-success-inverse">' + row.sale_process + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_total + '</span></td> <td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'receivings') {
                            var receiving_status = '';
                            if (row.receiving_status === 'open') {
                                receiving_status = row.receiving_status;
                            } else {
                                if (row.items.length === 0 && row.items_return.length > 0) {
                                    receiving_status = 'FullReturn';
                                } else if (row.items_return.length === 0 && row.items.length > 0) {
                                    receiving_status = row.receiving_status;
                                } else {
                                    receiving_status = 'PartialReturn';
                                }
                            }

                            var trow = '<tr> <td><input type="checkbox" class="receivings-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'receivings\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.receiving_id + '</td> <td>' + updateDate + '</td> <td>' + row.supplier_name + '</td> <td class="text-center"><span class="badge badge-success-inverse">' + receiving_status + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td>  <td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'branches') {
                            var trow = '<tr> <td><input type="checkbox" class="branches-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'branches\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.branch_name + '</td> <td><a class="sale_color" href="tel:' + row.store_telephone + '">' + row.store_telephone + '</a></td> <td><a class="sale_color" href="mailto:' + row.store_email + '">' + row.store_email + '</a></td> <td>' + row.store_address + '</td>' + '<td>' + row.state + '</td>' + '<td>' + row.country + '</td>' + '<td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'categories') {
                            var discountSign = (row.discount_amount > 0) ? '$' : '%';
                            if (row.discount_amount > 0) {
                                var discount = row.discount_amount;
                            } else {
                                discount = row.discount_percentage;
                            }
                            var image_path = (row.image !== "category.svg") ? row.image : 'static/images/default/' + row.image;
                            var trow = '<tr> <td><input type="checkbox" class="categories-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'categories\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.name + '</td> <td><img src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + row.image + '" onclick="PosnicPro.viewImage(this.id,\'category\');"></td> <td>' + discount + '' + discountSign + '</td> <td>' + (row.description || '') + '</td> <td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'customers') {
                            var trow = '<tr> <td><input type="checkbox" class="customers-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'customers\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.name + '</td> <td><a class="sale_color" href="tel:' + (row.phone || '') + '">' + (row.phone || '') + '</a></td> <td><a class="sale_color" href="mailto:' + (row.email || '') + '">' + (row.email || '') + '</a></td> <td>' + (row.address || '') + '</td><td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'expenses') {
                            var trow = '<tr> <td><input type="checkbox" class="expenses-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'expenses\');"></td> <td scope="row">' + row_no + '</td>  <td>' + currency + '&nbsp;<span class="number">' + row.amount + '</span></td> <td>' + row.type + '</td> <td>' + row.category + '</td>  <td>' + row.recipientname + '</td> <td>' + row.approvedby + '</td> <td>' + (row.description || '') + '</td><td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'items') {
                            var image_path = (row.image !== "item.svg") ? row.image : 'static/images/default/' + row.image;
                            var trow = '<tr> <td><input type="checkbox" class="items-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'items\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.name + '</td> <td><img src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + row.image + '" onclick="PosnicPro.viewImage(this.id,\'image\');"></td> <td>' + row.itemid + '</td> <td>' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td> <td>' + row.available_quantity + '</td> <td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'suppliers') {
                            var trow = '<tr> <td><input type="checkbox" class="suppliers-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'suppliers\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.name + '</td> <td><a class="sale_color" href="tel:' + (row.phone || '') + '">' + (row.phone || '') + '</a></td> <td><a class="sale_color" href="mailto:' + (row.email || '') + '">' + (row.email || '') + '</a></td> <td>' + (row.address || '') + '</td> <td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'registers') {
                            var trow = '<tr> <td data-module="user" data-access="delete"><input type="checkbox" class="registers-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'registers\');"></td> <td scope="row">' + row_no + '</td> <td>' + row.register_name + '</td><td>' + updateDate + '</td><td>' + row.sales_id + '</td><td>' + row.created_by + '</td><td>' + row.branch_name + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.register_amount + '</span></td> <td><span>' + action + ' </span></td> </tr>';
                        } else if (tableName === 'stocklogs') {
                            var trow = '<tr> <td data-module="user" data-access="write"><input type="checkbox" class="stocklogs-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'stocklogs\');"></td> <td scope="row">' + row_no + '</td>  <td class="text-center">' + row.item_barcode_id + '</td> <td>' + row.item_name + '</td><td>' + updateDate + '</td> <td class="text-center"><span class="badge badge-success-inverse">' + row.process + '</span></td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.opening_balance + '</span></td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.closing_balance + '</span></td> <td><span>' + action + ' </span></td> </tr>';
                        } else {
                            var image_path = (row.image !== "user.svg") ? row.image : 'static/images/default/' + row.image;
                            var trow = '<tr> <td><input type="checkbox" class="users-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'users\');"></td> <td scope="row">' + row_no + '</td>  <td>' + row.username + '</td> <td><img src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + row.image + '" onclick="PosnicPro.viewImage(this.id,\'user\');"></td> <td><a class="sale_color" href="mailto:' + (row.email || '') + '">' + (row.email || '') + '</a></td> <td>' + row.usertype + '</td><td><span>' + action + ' </span></td> </tr>';
                        }
                        $('#view_settings').children('tbody').append(trow);
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
                    PosnicPro.setSelectedCheckbox(PosnicPro[tableName + "_checkbox"], tableName);
                    loader.find(".loadingSpinner:first").remove();
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $('#card_recycle').css({ "display": "block", "background-color": "#fff", "margin-bottom": "30px" });
            $("#Select_backup_Branch").select2('focus');
            var branch_id = PosnicPro.local.get('branch_id_set');
            $('.display-current-branch').select2('val', [branch_id]);
        }
    },
    showDataTablePage: function () {
        $('.print_url').hide();
        if (PosnicPro.local.get('userplan') !== 'free') {
            $('.print_url').show();
        }
        PosnicPro.HideSideBarModal();
        PosnicPro.dashboard.datePicker();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container,#danger_zone').hide();
        $('.page-title-box,#settings,#dangerZone,#dangetzoneUserverify').show();
        $('#v-pills-manage-tab,#view_config_page').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_config').show();
        if ($('a#v-pills-recyclebin-tab').hasClass('active')) {
            PosnicPro.settings.settingsTable();
        }
        PosnicPro.settings.coreTabsOverflow();
        PosnicPro.settings.restoreCoreTab();
        // Every Config open re-reads server truth. The controls used to be
        // populated only at login (the DOM carried them between visits), so
        // a change saved on another till showed stale here until re-login -
        // and "does Module On/Off preserve the selections?" deserves a
        // guaranteed yes, not a usually.
        PosnicPro.settings.viewSettings(PosnicPro.local.get('branch_id_set'));
        /* Core Settings is the tab that is already active, so a click handler
           alone never fires on the way in - the switches would sit at their
           markup default and disagree with what is stored. */
        PosnicPro.settings.loadSharing();
    },
    settingImageFormSubmit: function () {
        if ($('#setting_image_value').val() !== '') {
            var data = new FormData(document.getElementById("setting_image_add"));
            PosnicPro.requestImage('POST', "setting/updateBranchLogo", data, false, function (response) {
                if (response.type === 'success') {
                    var imgdata = response.data.replace(/\s/g, '');
                    $('#setting_logo_value').val(imgdata);
                    var image_path = (imgdata !== "store.png") ? imgdata : 'static/images/default/' + imgdata;
                    $('#previewing,#store_image').attr('src', image_path);
                    PosnicPro.settings.updatedImage();
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            });
        } else {
            PosnicPro.alert('success', 'Image updated');
        }
        return false;
    },
    updatedImage: function () {
        var params = {
            url: 'setting/storedImageData',
            data: JSON.stringify(PosnicPro.getFormData($('#setting_image_add')))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.local.set('branchimage', response.data);
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    /*store details Add/Update function*/
    generalSetting: function (value) {
        if ($('#store_name').val() !== '' && $('#store_telephone').val() !== '' && PosnicPro.validateEmail($('#store_email').val()) && $('#setting_country').val() !== '' && $('#setting_state').val() !== '' && $('#currency').val() !== '' && $('#time_zone').val() !== '' && $('#storedate').val() !== '' && $('#store_address').val() !== '' && $('#printing_address').val() !== '') {
            var loader = $(".loader-view-generalsetting");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var currency = $('#currency_type').val();
            var timeZone = $("#time_zone").select2("data");
            var currencyText = $('#currencyText').val();
            var currencyTextname = $('#currencyTextname').val();
            var timezoneValue = {
                time_zone: timeZone[0].element.attributes['data-timezone-name'].value
            };
            let countryValue = $("#setting_country").select2("data");
            let countryId = {
                country_id: countryValue[0].element.attributes['data-setting-id'].value
            };
            var formData = PosnicPro.getFormData($('#setting_add'));
            /* The form lives on the Branch edit page now and always names its
               target branch; registers ride along (class-collected - the
               dynamic rows are not form-serialized). Local state refresh only
               applies when the branch being edited IS the session branch. */
            var target = $('#edit_branch_target').val() || '';
            var editingCurrent = !target || target === PosnicPro.local.get('branch_id_set');
            var registers = {
                register: $('.be-register').map(function () { return $(this).val(); }).get()
                    .filter(function (v) { return v && v.trim().length >= 3; })
            };
            var params = {
                url: 'setting/updateGeneralSetting',
                data: JSON.stringify(Object.assign(formData, timezoneValue, countryId, registers))
            };
            PosnicPro.put(params, function (response) {
                if (response.type === 'success' && !editingCurrent) {
                    loader.find(".loadingSpinner:first").remove();
                    PosnicPro.alert(response.type, response.message);
                    hasher.setHash('branches');
                    PosnicPro.branches.branchesTable('branches');
                    return;
                }
                if (response.type === 'success') {
                    $('.print_store_address').html(response.data['printing_address']);
                    $('.print_store_telephone').html(response.data['store_telephone']);
                    $('.print_store_alternativephone').html(response.data['store_alternativephone']);
                    $('.print_store_email').html(response.data['store_email']);
                    $('.print_store_gst').html(response.data['branch_gstin_number']);
                    $('.print_store_name').html(response.data['branch_name']);
                    $('.display-currency').html(currency);
                    $('#setting_status').val("Yes");
                    PosnicPro.local.set("country_setting", response.data.country);
                    PosnicPro.local.set('countryid', response.data['country_id']);
                    PosnicPro.local.set('countryname', '');
                    PosnicPro.local.set('statename', '');
                    PosnicPro.local.set('countryname', response.data['country']);
                    PosnicPro.local.set('statename', response.data['state']);
                    PosnicPro.local.set('dateformatset', response.data['clientdate']);
                    PosnicPro.local.set('setdateformat', response.data['serverdate']);
                    PosnicPro.local.set('timezone', response.data['time_zone']);
                    PosnicPro.local.set('timeformat', response.data['time_format']);
                    PosnicPro.local.set('currencySign', currency);
                    $(".branch-name").html(response.data['branch_name']);
                    PosnicPro.local.set('branchname', response.data['branch_name']);
                    PosnicPro.local.set('branchemail', response.data['store_email']);
                    PosnicPro.local.set('branchphone', response.data['store_telephone']);
                    PosnicPro.local.set('branchaddress', response.data['store_address']);
                    PosnicPro.local.set('branchgstin', response.data['branch_gstin_number'] || '');
                    
                    // Store general settings including hardware_weight_machine_enable
                    var generalSettings = {
                        hardware_weight_machine_enable: response.data['hardware_weight_machine_enable'] || false,
                        till_lock_enable: response.data['till_lock_enable'] || false,
                        till_lock_idle_minutes: response.data['till_lock_idle_minutes'] || 0,
                        staff_shifts_enable: response.data['staff_shifts_enable'] !== false,
                        staff_tips_enable: response.data['staff_tips_enable'] === true,
                        staff_roster_enable: response.data['staff_roster_enable'] !== false,
                        cash_register_enable: response.data['cash_register_enable'] !== false,
                        module_tax_enable: response.data['module_tax_enable'] !== false,
                        module_credit_enable: response.data['module_credit_enable'] !== false,
                        module_marketing_enable: response.data['module_marketing_enable'] !== false,
                        module_messaging_enable: response.data['module_messaging_enable'] !== false,
                        module_channels_enable: response.data['module_channels_enable'] !== false,
                        module_channels_kiosk_enable: response.data['module_channels_kiosk_enable'] !== false,
                        module_recyclebin_enable: response.data['module_recyclebin_enable'] !== false,
                        module_demo_data_enable: response.data['module_demo_data_enable'] !== false,
                        module_themes_enable: response.data['module_themes_enable'] !== false,
                        module_cashbook_enable: response.data['module_cashbook_enable'] !== false,
                        quick_sale_enable: response.data['quick_sale_enable'] !== false,
                        quotes_enable: response.data['quotes_enable'] !== false,
                        custom_charges_enable: response.data['custom_charges_enable'] === true
                    };
                    PosnicPro.local.set('general_settings', JSON.stringify(generalSettings));
                    PosnicPro.shiftWidget.applyEnabled();
                    
                    let branchRecord = [];
                    branchRecord.push({ name: response.data['branch_name'], phone: response.data['store_telephone'], email: response.data['store_email'], address: response.data['store_address'], image: response.data['branch_image'] });
                    db.customerDisplay.put({ id: '2', 'clear': 'no', 'get': 'no', branch: branchRecord });
                    PosnicPro.commonDate();
                    $('.hide_indian_gst').hide();
                    $('.indian-gstr').hide();
                    PosnicPro.local.set('gst_action', 'disable');
                    if (response.data['country'] === 'India') {
                        $('.hide_indian_gst').show();
                        $('.indian-gstr').show();
                        if ($('#indian_gst').val() === 'gst_on') {
                            $('.disable_indian_gst').show();
                            PosnicPro.local.set('gst_action', 'enable');
                        } else {
                            $('.disable_indian_gst').hide();
                            PosnicPro.local.set('gst_action', 'disable');
                        }
                    } else {
                        $('.hide_indian_gst').hide();
                        $('.indian-gstr').hide();
                        PosnicPro.local.set('gst_action', 'disable');
                    }
                    PosnicPro.settings.applyTaxProfile();
                    loader.find(".loadingSpinner:first").remove();
                    // Saved from the Branch edit page: back to the list.
                    if (target) {
                        hasher.setHash('branches');
                        PosnicPro.branches.branchesTable('branches');
                    }
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    emailPhpStoreSettings: function () {
        if (PosnicPro.validateEmail($('#smtp_php_mail').val())) {
            var loader = $(".loader-view-mail");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var params = {
                url: 'setting/updatePhpEmailSetting',
                data: JSON.stringify(PosnicPro.getFormData($('#php_setting_add')))
            };
            PosnicPro.put(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.alert(response.type, response.message);
                    $('#setting_status').val("Yes");
                    loader.find(".loadingSpinner:first").remove();
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    way2smsSettings: function () {
        var loader = $(".loader-view-sms");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/updateWay2SmsSetting',
            data: JSON.stringify(PosnicPro.getFormData($('#sms_setting')))
        };
        PosnicPro.put(params, function (response) {
            PosnicPro.alert(response.type, response.message);
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    textlocalsmsSettings: function () {
        var loader = $(".loader-view-sms");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/updateTextLocalSmsSetting',
            data: JSON.stringify(PosnicPro.getFormData($('#textlocal_setting')))
        };
        PosnicPro.put(params, function (response) {
            PosnicPro.alert(response.type, response.message);
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    getDefaultCustomerDetails: function (customer) {
        var params = {
            url: 'setting/getDefaultCustomer',
            data: { data: { customer: customer } }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#default_customer').append('<option value="' + response.data['customer_id'] + '">' + response.data['customer_name'] + '</option>');
                PosnicPro.local.set('defaultcustomer', JSON.stringify(response.data['customer']));
                $('.default-customer-id').val(response.data['customer_id']);
                $('.default-customer-name').val(response.data['customer_name']);
            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    getDefaultSupplierDetails: function (supplier) {
        var params = {
            url: 'setting/getDefaultSupplier',
            data: { data: { supplier: supplier } }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#default_supplier').append('<option value="' + response.data['supplier_id'] + '">' + response.data['supplier_name'] + '</option>');
                PosnicPro.local.set('defaultsupplier', JSON.stringify(response.data['supplier']));
                $('.default-supplier-id').val(response.data['supplier_id']);
                $('.default-supplier-name').val(response.data['supplier_name']);
            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    /*To display the setting details*/
    viewSettings: function (id) {
        var params = {
            url: 'branches/getOneStore',
            data: 'id=' + id
        };
        $('#footer_print,#header_print').html('').text('');
        $('#footer_print,#header_print').summernote('code', '');
        let loader = $(".loader-table-setting");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                var data = response.data;
                let country_id = data.country_id;
                PosnicPro.local.set('countryid', country_id);
                PosnicPro.settings.loadSelectSettingState(country_id);
                PosnicPro.record_id = id;
                PosnicPro.roundoff = data.roundOff;
                // Hidden when the module is off OR nothing is configured.
                (data.cash_register_enable === false || data.register.length === 0)
                    ? $('.cashRegisterModule').css('display', 'none')
                    : $('.cashRegisterModule').css('display', 'block');
                $('#id').val(PosnicPro.record_id);
                $('#razor_key').text(data.razorKey);
                $('#razor_url').text(data.razorUrl);
                $('#store_name').val(data.branch_name);
                $('#store_address').val(data.store_address);
                $('#address').val(data.address);
                $('#store_email').val(data.store_email);
                $('#store_telephone').val(data.store_telephone);
                $('#store_alternativephone').val(data.store_alternativephone);
                $('#place').val(data.place);
                $('#city').val(data.city);
                $('#pincode').val(data.pincode);
                $('#website').val(data.website);
                $('#languge').val(data.languge);
                $('#printing_address').val(data.printing_address);
                $('#smtp_username').val(data.smtp_username);
                $('#smtp_hostname').val(data.smtp_hostname);
                $('#smtp_password').val(data.smtp_password);
                $('#smtp_port').val(data.smtp_port);
                $('.from_mail').val(data.from_mail);
                $('#smtp_php_to_mail').val(data.to_mail);
                $('#sms_type').val(data.smstype);
                $('#notification_value').val(data.notification_range);
                localStorage.setItem("notificationrange", data.notification_range);
                $('#serverdate').val(data.server_dateformat);
                $('#dateText').val(data.dateformat_text);
                // Credentials no longer come back from the server (S4), so these
                // load empty by design; markSavedSecrets below says which are set.
                $('#way2sms_api').val(data.way2sms_api || '');
                $('#way2sms_userid').val(data.way2sms_userid || '');
                $('#way2sms_password').val(data.way2sms_password || '');
                $('#textlocal_sender').val(data.textlocal_sender);
                $('#textlocal_api').val(data.textlocal_api || '');
                $('#sales_prefix').val(data.sales_prefix || 'S');
                $('#email_smtp_host').val(data.email_smtp_host || '');
                $('#email_smtp_port').val(data.email_smtp_port || '');
                $('#email_smtp_secure').prop('checked', data.email_smtp_secure === true || data.email_smtp_secure === 'true');
                $('#email_smtp_username').val(data.email_smtp_username || '');
                $('#email_smtp_password').val(data.email_smtp_password || '');
                $('#email_smtp_from').val(data.email_smtp_from || '');
                PosnicPro.settings.markSavedSecrets(data.secrets_configured);
                $('#quote_default_payment_method').val(data.quote_default_payment_method || '');
                $('#quote_default_bank_details').val(data.quote_default_bank_details || '');
                $('#quote_default_terms').val(data.quote_default_terms || '');
                $('#quote_default_signature').val(data.quote_default_signature || '');
                PosnicPro.local.set('quotesignature', data.quote_default_signature || '');
                if (data.quote_default_signature) {
                    $('#quote_signature_thumb').attr('src', data.quote_default_signature).show();
                    $('#quote_signature_clear').show();
                } else {
                    $('#quote_signature_thumb').hide();
                    $('#quote_signature_clear').hide();
                }
                $('#receiving_prefix').val(data.receiving_prefix || 'P');
                $('#allow_sale_date_edit').prop('checked', data.allow_sale_date_edit !== 'false' && data.allow_sale_date_edit !== false);
                PosnicPro.local.set('allow_sale_date_edit', (data.allow_sale_date_edit === 'false' || data.allow_sale_date_edit === false) ? 'false' : 'true');
                const dbValue = data.sms_auto_send_time; // Replace with your actual database value
                let [time, period] = dbValue.split(' '); // Split into time and AM/PM
                let [hour, minute] = time.split(':'); // Split into hour and minute

                hour = parseInt(hour, 10);
                if (period === 'PM' && hour < 12) {
                    hour += 12;
                } else if (period === 'AM' && hour === 12) {
                    hour = 0; // Midnight case
                }
                const formattedTime = hour.toString().padStart(2, '0') + ':' + minute;
                $("#sms_auto_send_time").val(formattedTime);
                $("#sms_auto_send_period").val(data.sms_auto_send_time);
                $("#sms_retry_period option[value='" + data.sms_retry_period + "']").prop("selected", true);
                $("#sms_max_retries option[value='" + data.sms_max_retries + "']").prop("selected", true);
                $("#print_type option[value='" + data.print_type + "']").prop("selected", true);
                let print_size = (typeof (data.print_size) !== "undefined" && data.print_size !== null) ? data.print_size : 'receipt_medium';
                $("#print_size option[value='" + print_size + "']").prop("selected", true);
                PosnicPro.local.set('printing_size', print_size);
                let print_character = (typeof (data.print_character) !== "undefined" && data.print_character !== null) ? data.print_character : 'default';
                $("#print_character option[value='" + print_character + "']").prop("selected", true);
                PosnicPro.local.set('printing_max_char', print_character);
                
                // Module On/Off switches (checkboxes since the toggles-only
                // rebuild). ON unless explicitly false, except tips (opt-in)
                // and the hardware/PIN switches which shipped off.
                $('#hardware_weight_machine_enable').prop('checked', data.hardware_weight_machine_enable === true);
                $('#till_lock_enable').prop('checked', data.till_lock_enable === true);
                $('#till_lock_idle_minutes').val(String(data.till_lock_idle_minutes || 0));
                $('#staff_shifts_enable').prop('checked', data.staff_shifts_enable !== false);
                $('#staff_tips_enable').prop('checked', data.staff_tips_enable === true);
                $('#staff_roster_enable').prop('checked', data.staff_roster_enable !== false);
                $('#cash_register_enable').prop('checked', data.cash_register_enable !== false);
                $('#module_tax_enable').prop('checked', data.module_tax_enable !== false);
                $('#module_credit_enable').prop('checked', data.module_credit_enable !== false);
                $('#module_marketing_enable').prop('checked', data.module_marketing_enable !== false);
                $('#module_messaging_enable').prop('checked', data.module_messaging_enable !== false);
                $('#module_channels_enable').prop('checked', data.module_channels_enable !== false);
                $('#module_channels_kiosk_enable').prop('checked', data.module_channels_kiosk_enable !== false);
                $('#module_recyclebin_enable').prop('checked', data.module_recyclebin_enable !== false);
                $('#module_demo_data_enable').prop('checked', data.module_demo_data_enable !== false);
                /* What it was BEFORE anybody touched it. Turning demo data
                   back on is the only case that needs the server, and off->on
                   cannot be told from on->on without this. */
                PosnicPro.settings._demoWasOn = data.module_demo_data_enable !== false;
                $('#module_themes_enable').prop('checked', data.module_themes_enable !== false);
                $('#pl_include_cashbook').prop('checked', data.pl_include_cashbook !== false);
                $('#module_cashbook_enable').prop('checked', data.module_cashbook_enable !== false);
                $('#quick_sale_enable').prop('checked', data.quick_sale_enable !== false);
                $('#quotes_enable').prop('checked', data.quotes_enable !== false);
                $('#custom_charges_enable').prop('checked', data.custom_charges_enable === true);

                // Store general settings including hardware_weight_machine_enable
                var generalSettings = {
                    hardware_weight_machine_enable: data.hardware_weight_machine_enable || false,
                    till_lock_enable: data.till_lock_enable || false,
                    till_lock_idle_minutes: data.till_lock_idle_minutes || 0,
                    staff_shifts_enable: data.staff_shifts_enable !== false,
                    staff_tips_enable: data.staff_tips_enable === true,
                    staff_roster_enable: data.staff_roster_enable !== false,
                    cash_register_enable: data.cash_register_enable !== false,
                    module_tax_enable: data.module_tax_enable !== false,
                    module_credit_enable: data.module_credit_enable !== false,
                    module_marketing_enable: data.module_marketing_enable !== false,
                    module_messaging_enable: data.module_messaging_enable !== false,
                    module_channels_enable: data.module_channels_enable !== false,
                    module_channels_kiosk_enable: data.module_channels_kiosk_enable !== false,
                    module_recyclebin_enable: data.module_recyclebin_enable !== false,
                    module_demo_data_enable: data.module_demo_data_enable !== false,
                    module_themes_enable: data.module_themes_enable !== false,
                    module_cashbook_enable: data.module_cashbook_enable !== false,
                    quick_sale_enable: data.quick_sale_enable !== false,
                    quotes_enable: data.quotes_enable !== false,
                    custom_charges_enable: data.custom_charges_enable === true
                };
                PosnicPro.local.set('general_settings', JSON.stringify(generalSettings));
                PosnicPro.shiftWidget.applyEnabled();
                PosnicPro.settings.applyModuleNav();
                
                $('.display-branch-name').html(data.branch_name);
                $('.display-tax-value').html(data.tax_percentage);
                $('.display-tax-text').html(data.tax_percentage);
                $('.display-discount-amount-text').html(data.discount_amount);
                $('.display-discount-amount-value').val(data.discount_amount);
                $('.display-discount-percentage-text').html(data.discount_percentage);
                $('.display-discount-percentage-value').val(data.discount_percentage);
                PosnicPro.local.set('setting-discount-amount', data.discount_amount);
                PosnicPro.local.set('currencySign', data.currency_type);
                PosnicPro.local.set('setting-discount-percentage', data.discount_percentage);
                (data.discount_amount === '0') ? data.discount_percentage : data.discount_amount;
                var image_path = (data.logo !== "store.png") ? data.logo : 'static/images/default/' + data.logo;
                $('#previewing,#store_image').attr('src', image_path);
                $('#setting_logo_value').val(data.logo);
                // Ensure kiosk array exists and has at least one object
                // Ensure kiosk array exists and has at least one object
var kioskData = (data.kiosk && data.kiosk.length > 0) ? data.kiosk[0] : {};

// Extract values with fallback to empty strings
var store_id = kioskData.store_id || "";
$("#kioskstore_id").val(store_id);

// ----- Kiosk printers: build rows from array -----
var printers = [];

// Prefer new array field from DB
if ($.isArray(kioskData.printer_names) && kioskData.printer_names.length) {
    printers = kioskData.printer_names;
} else if (kioskData.printer_name) {
    // Backward‑compat: old single value
    printers = [kioskData.printer_name];
}

// Find wrapper and template row
var $wrapper = $('.printer-wrapper .printer-fields');
if ($wrapper.length) {
    var $template = $wrapper.find('.printer-input:first').clone(true);

    // Clear all existing rows
    $wrapper.empty();

    // If no data, still show one empty row
    if (!printers.length) {
        printers = [''];
    }

    $.each(printers, function (idx, name) {
        var $row = $template.clone(true);

        var $input = $row.find('input');
        $input
            .attr('id', 'printer_name_' + idx)
            .attr('name', 'printer_name[' + idx + ']')
            .val(name || '');

        $wrapper.append($row);
    });

    // Only last row shows "+" button
    var $rows = $wrapper.find('.printer-input');
    $rows.find('.add-printer-field').hide();
    $rows.last().find('.add-printer-field').show();
}
                var logo = kioskData.logo || "";
                var banner = kioskData.banner || "";
                var homebanner = kioskData.homebanner || "";
                var advertisement = kioskData.advertisement || "";

                // Default kiosk images for each slot, used only when
                // there is no saved image URL in the kiosk data.
                var defaultHomeBanner = 'static/images/kiosk-default/home.png';
                var defaultLogo = 'static/images/kiosk-default/logo.png';
                var defaultBanner = 'static/images/kiosk-default/banner.jpg';
                var defaultAdvertisement = 'static/images/kiosk-default/banner1.jpg';

                var payment_cod = kioskData.payment_cod === 'true' || kioskData.payment_cod === true;
                var payment_razorpay = kioskData.payment_razorpay === 'true' || kioskData.payment_razorpay === true;
                var payment_number = kioskData.payment_number === 'true' || kioskData.payment_number === true;
                // Set checkbox status
                $('#payment_cod').prop('checked', payment_cod);
                $('#payment_razorpay').prop('checked', payment_razorpay);
                $('#payment_number').prop('checked', payment_number);

                // Update Image Previews
                var logoSrc = logo || defaultLogo;
                $("#preview_logo").attr("src", logoSrc).css("display", "block");

                var bannerSrc = banner || defaultBanner;
                $("#preview_banner").attr("src", bannerSrc).css("display", "block");

                var homebannerSrc = homebanner || defaultHomeBanner;
                $("#preview_homebanner").attr("src", homebannerSrc).css("display", "block");

                var advertisementSrc = advertisement || defaultAdvertisement;
                $("#preview_advertisement").attr("src", advertisementSrc).css("display", "block");

                $('#indian_gst option[value="' + data.indian_gst + '"]').attr("selected", true);
                $('#branch_gstin_number').val(data.branch_gstin_number);
                (data.sales_sms === true) ? $('#sales_sms').prop("checked", true).attr('checked', 'checked') : $('#sales_sms').prop("checked", false).attr('unchecked', 'unchecked');
                (data.auto_sms === true) ? $('#auto_sms').prop("checked", true).attr('checked', 'checked') : $('#auto_sms').prop("checked", false).attr('unchecked', 'unchecked');
                (data.roundOff === true) ? $('#decimal_Round').prop("checked", true).attr('checked', 'checked') : $('#decimal_Round').prop("checked", false).attr('unchecked', 'unchecked');
                (data.printall === true) ? $('#printall').prop("checked", true).attr('checked', 'checked') : $('#printall').prop("checked", false).attr('unchecked', 'unchecked');
                //                (data.print_logo === true) ? $('#printall').attr('checked', 'checked') : $('#printall').attr('unchecked', 'unchecked');

                if (data.keyboard_view === true) {
                    $('#keyboard_view').prop("checked", true).attr('checked', 'checked');
                    PosnicPro.local.set('keyboard_view', 'true');
                    keyboard_view();
                } else {
                    $('#keyboard_view').prop("checked", false).attr('unchecked', 'unchecked');
                    PosnicPro.local.set('keyboard_view', 'false');
                    keyboard_view();
                }
                PosnicPro.local.set('balance_view', 'true');
                if (data.customer_checkbox === true) {
                    $("#default_customer_enable_disable").prop("checked", true);
                    PosnicPro.local.set('default_customer_enable_disable', "true");
                    $('#default_customer').removeAttr('disabled');
                    $(".customer-text-disable").css("color", '#20a83b');
                    $(".customer-text-enable").css("color", '#141d46');
                } else {
                    $("#default_customer_enable_disable").prop("checked", false);
                    PosnicPro.local.set('default_customer_enable_disable', "false");
                    $('#default_customer').attr('disabled', 'disabled');
                    $(".customer-text-disable").css("color", '#141d46');
                    $(".customer-text-enable").css("color", '#20a83b');
                }

                if (data.supplier_checkbox === true) {
                    $("#default_supplier_enable_disable").prop("checked", true);
                    PosnicPro.local.set('default_supplier_enable_disable', "true");
                    $('#default_supplier').removeAttr('disabled');
                    $(".supplier-text-disable").css("color", '#20a83b');
                    $(".supplier-text-enable").css("color", '#141d46');
                } else {
                    $("#default_supplier_enable_disable").prop("checked", false);
                    PosnicPro.local.set('default_supplier_enable_disable', "false");
                    $('#default_supplier').attr('disabled', 'disabled');
                    $(".supplier-text-disable").css("color", '#141d46');
                    $(".supplier-text-enable").css("color", '#20a83b');
                }

                if (data.tax_checkbox === true) {
                    $("#default_tax_enable_disable").prop("checked", true);
                    PosnicPro.local.set('default_tax_enable_disable', "true");
                    $('#tax_percentage').removeAttr('disabled');
                    $(".tax-text-disable").css("color", '#20a83b');
                    $(".tax-text-enable").css("color", '#141d46');
                } else {
                    $("#default_tax_enable_disable").prop("checked", false);
                    PosnicPro.local.set('default_tax_enable_disable', "false");
                    $('#tax_percentage').attr('disabled', 'disabled');
                    $(".tax-text-disable").css("color", '#141d46');
                    $(".tax-text-enable").css("color", '#20a83b');
                }
                let print_url = (typeof (data.print_url) !== "undefined" && data.print_url !== null) ? data.print_url : false;
                (print_url === true) ? $('#print_url').prop("checked", true).attr('checked', 'checked') : $('#print_url').prop("checked", false).attr('unchecked', 'unchecked');
                PosnicPro.local.set('print_url', print_url);
                // the old pencil editor is gone; its stale local key with it
                PosnicPro.local.set('inline_sale', 'disable');
                if (data.sale_quick_edit_enable !== false) {
                    $('#sale_quick_edit').prop("checked", true).attr('checked', 'checked');
                    PosnicPro.local.set('sale_quick_edit', 'enable');
                } else {
                    $('#sale_quick_edit').prop("checked", false).attr('unchecked', 'unchecked');
                    PosnicPro.local.set('sale_quick_edit', 'disable');
                }
                if (data.enable_multi_payment === true) {
                    $('#enable_multi_payment').prop("checked", true).attr('checked', 'checked');
                    PosnicPro.local.set('enable_multi_payment', 'enable');
                } else {
                    $('#enable_multi_payment').prop("checked", false).attr('unchecked', 'unchecked');
                    PosnicPro.local.set('enable_multi_payment', 'disable');
                }
                var $kotLi = $('#view_kot_page').closest('li');
                var $kotOrderLi = $('#view_kotorder_page').closest('li');
                var $kotHistoryLi = $('#view_kothistory_page').closest('li');
                var $kotReportLi = $('#viewkotreport_page').closest('li');
                var $newSaleLi = $('#view_touchsales_page').closest('li');
                if (data.table_options === true) {
                    $('#table_options').prop("checked", true).attr('checked', 'checked');
                    PosnicPro.local.set('table_options', 'enable');
                    $kotLi.show();
                    $kotOrderLi.show();
                    $kotHistoryLi.show();
                    $kotReportLi.show();
                    $newSaleLi.hide();
                    $('#image_sidebar_newsale').hide();
                    $('#item_master_menu').show();
                    PosnicPro.applyKotVisibility(true);
                } else {
                    $('#table_options').prop("checked", false).attr('unchecked', 'unchecked');
                    PosnicPro.local.set('table_options', 'disable');
                    PosnicPro.applyKotVisibility(false);
                    $kotLi.hide();
                    $kotOrderLi.hide();
                    $kotHistoryLi.hide();
                    $kotReportLi.hide();
                    $newSaleLi.show();
                    $('#item_master_menu').hide();
                }

                (data.stock_management === true) ? $('#stock_management').prop("checked", true).attr('checked', 'checked') : $('#stock_management').removeAttr('checked');
                (data.stock_management_log === true) ? $('#stock_log_management').prop("checked", true).attr('checked', 'checked') : $('#stock_log_management').removeAttr('checked');
                (data.sales_mail === true) ? $('#sales_mail').prop("checked", true).attr('checked', 'checked') : $('#sales_mail').prop("checked", false).attr('unchecked', 'unchecked');
                (data.customer_print === true) ? $('#customer_print').prop("checked", true).attr('checked', 'checked') : $('#customer_print').prop("checked", false).attr('unchecked', 'unchecked');
                (data.print_logoimg === true) ? $('#print_logoimg').prop("checked", true).attr('checked', 'checked') : $('#print_logoimg').prop("checked", false).attr('unchecked', 'unchecked');
                (data.print_sale_notes === true) ? $('#print_sale_notes').prop("checked", true).attr('checked', 'checked') : $('#print_sale_notes').prop("checked", false).attr('unchecked', 'unchecked');
                (data.whatsapp_receipt === true) ? $('#whatsapp_receipt').prop("checked", true).attr('checked', 'checked') : $('#whatsapp_receipt').prop("checked", false).attr('unchecked', 'unchecked');
                if (data.country === 'India') {
                    $('.branch-gstin-hide-show').show();
                    $('.hide_indian_gst').show();
                    if (data.indian_gst === 'gst_on') {
                        $('.disable_indian_gst').show();
                        PosnicPro.local.set('gst_action', 'enable');
                    } else {
                        $('.disable_indian_gst').hide();
                        PosnicPro.local.set('gst_action', 'disable');
                    }
                } else {
                    $('.branch-gstin-hide-show').hide();
                    $('.hide_indian_gst').hide();
                    PosnicPro.local.set('gst_action', 'disable');
                }
                PosnicPro.settings.applyTaxProfile();

                $('#setting_country,#customer_country,#supplier_country,#branch_country').val(data.country);
                $('#client_dateformat').val(data.client_dateformat);
                $('#dateformat_text').val(data.dateformat_text);
                $('#server_dateformat').val(data.server_dateformat);
                PosnicPro.local.set("dateformatset", data.client_dateformat);
                var settingStateOPtion = '<option id="' + data.state + '" value="' + data.state + '" selected>' + data.state + '</option>';
                $('#setting_state,#customer_state,#supplier_state,#branch_state').html(settingStateOPtion);
                $('#storedate').val(data.client_dateformat).trigger('change.select2');
                $('#storetime').val(data.time_format).trigger('change.select2');
                PosnicPro.local.set('timeformat', data.time_format);
                $('#currency').val(data.currency_text);
                PosnicPro.local.set('timezone', data.time_zone);
                $("#time_zone").val(data.time_zone).trigger("change");
                localStorage.setItem("payment_gateway", 'false');
                $('.qr_btn').hide();
                $('#payment_gateway').prop("checked", false).attr('unchecked', 'unchecked');
                if (data.payment_gateway['status'] === 'true') {
                    localStorage.setItem("payment_gateway", 'true');
                    $('.qr_btn').show();
                    $('#payment_gateway').prop("checked", true).attr('checked', 'checked');
                }
                $('#site_key,#secret_key').val('');
                $('#site_key').val(data.payment_gateway['key']);
                $('#secret_key').val(data.payment_gateway['secret']);

                if (data.phonepe_payment_gateway) {
                    $('#phonepe_merchant_id').val(data.phonepe_payment_gateway['merchantId']);
                    $('#phonepe_salt_key').val(data.phonepe_payment_gateway['saltKey']);
                } else {
                    $('#phonepe_merchant_id').val('');
                    $('#phonepe_salt_key').val('');
                }

                var viewcurrencyOPtion = "";
                $.each(data.currency_value, function (key, value) {
                    $('#currencyText').val(value.currency_sign);
                    $('#currencyTextname').val(value.currency_text);
                    $("#currency_type option:selected").remove();
                    $('#currency_type').find('option').remove();
                    if (data.currency_type === value.currency_text) {
                        viewcurrencyOPtion += "<option id=" + data.currency_type + '" value="' + data.currency_type + '">Text( ' + data.currency_type + ' )</option>' +
                            " <option id=" + value.currency_sign + '" value="' + value.currency_sign + '">Symbol( ' + value.currency_sign + ' )</option>';
                    } else {
                        viewcurrencyOPtion += "<option id=" + value.currency_text + '" value="' + value.currency_text + '">Text( ' + value.currency_text + ' )</option>' +
                            " <option id=" + data.currency_type + '" value="' + data.currency_type + '">Symbol( ' + data.currency_type + ' )</option>';
                    }

                });
                $('#currency_type').append(viewcurrencyOPtion);
                $('#currency_type').val(data.currency_type).trigger('change.select2');
                $('.display-currency').html(data.currency_type);
                $('#setting_status').val("Yes");
                if (data.country !== 'India') {
                    $('.indian-Gst').css({ "display": "none" });
                }
                var discountamountradionbutton = $('#discount_amount').val();
                if (discountamountradionbutton > 0) {
                    $("#radio_discount_amount").prop('checked', 'checked');
                    $('#discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#discount_amount').removeAttr('disabled', 'disabled').show();
                } else {
                    $("#radio_discount_percentage").prop('checked', 'checked');
                    $('#discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#discount_percentage').removeAttr('disabled', 'disabled').show();
                }
                /*Call For get Default Customer SupplierDtails*/
                PosnicPro.settings.getDefaultCustomerDetails(data.default_customer);
                PosnicPro.settings.getDefaultSupplierDetails(data.default_supplier);
                /*Set Default Tax*/
                if (data.default_tax) { 
                    $("#tax_percentage").val(data.default_tax).trigger("change");
                    PosnicPro.local.set('default_tax_id', data.default_tax);
                }
                if ((data.branch_gstin_number !== "undefined" && data.branch_gstin_number !== "")) {
                    $('.gst_hide_show').show();
                } else {
                    $('.gst_hide_show').hide();
                }
                $('#setting_image_value').val('');

                $('.import-print').html('');
                if (data.regular_body_print != null) {
                    $('.import-print').html(data.regular_body_print);
                } else {
                    $('.import-print').append(data.print_a4html);
                }

                if (data.thermal_body_print != null) {
                    $('.import-standard-print').html(data.thermal_body_print);
                } else {
                    $('.import-standard-print').append(data.print_standard_html);
                }

                var controls = [
                    'lineitem_hsn',
                    'lineitem_price',
                    'lineitem_qty',
                    'lineitem_tax',
                    'lineitem_total',
                    'print_qty',
                    'print_roundoff'
                ];
                var defaultControlValue = 'on';
                if (data.print_controls != null) {
                    $(controls).each(function (key, controlKey) {
                        PosnicPro.local.set(controlKey, data.print_controls.a4[controlKey]);
                    });
                    PosnicPro.local.set('receiving_title', data.print_controls['receiving_title']);
                    PosnicPro.local.set('receiving_return_title', data.print_controls['receiving_return_title']);
                    PosnicPro.local.set('sale_title', data.print_controls['sale_title']);
                    PosnicPro.local.set('sale_return_title', data.print_controls['sale_return_title']);
                } else {
                    $(controls).each(function (key, controlKey) {
                        PosnicPro.local.set(controlKey, defaultControlValue);
                    });
                    PosnicPro.local.set('receiving_title', "<span style=\"font-size: 14px !important; font-weight: 900;\">Purchase Invoice</span>");
                    PosnicPro.local.set('receiving_return_title', "<span style=\"font-size: 14px !important; font-weight: 900;\">Purchase Return Invoice</span>");
                    PosnicPro.local.set('sale_title', "<span style=\"font-size: 14px !important; font-weight: 900;\">Sales Receipt</span>");
                    PosnicPro.local.set('sale_return_title', "<span style=\"font-size: 14px !important; font-weight: 900;\">Sales Return Receipt</span>");
                }

                // SET, never append: the old append-at-response after a
                // clear-at-request duplicated the content once per
                // overlapping load - eight Config opens read
                // "Thank you for shopping...!" eight times over.
                let headerContent = (data.header_print !== '') ? data.header_print : '';
                $('#header_print').html('').append(headerContent);
                var htmlHeaderView = $('#header_print').text();
                $('#header_print').summernote('code', htmlHeaderView);
                $('.header-content').html(htmlHeaderView);

                let footerContent = (data.footer_print !== '') ? data.footer_print : 'Thank you for shopping...!';
                $('#footer_print').html('').append(footerContent);
                var htmlView = $('#footer_print').text();
                $('#footer_print').summernote('code', htmlView);
                $('.footer-content').html(htmlView);

                $('.print_store_name').html(data.branch_name);
                $('.print_store_gst').html(data.branch_gstin_number);
                $('.print_store_address').html(data.printing_address);
                $('.print_store_city').html(data.city);
                $('.print_store_email').html(data.store_email);
                $('.print_store_telephone').html(data.store_telephone);
                $('.print_store_alternativephone').html('');
                if (data.store_alternativephone !== null && data.store_alternativephone !== undefined && data.store_alternativephone.trim() !== "") {
                    $('.print_store_alternativephone').html(data.store_alternativephone);
                }
                $('.print_store_country').html(data.country);
                $('.print_store_state').html(data.state);
                $('.print_store_pincode').html(data.pincode);
                $("#receiving_tax option[value='" + data.tax_percentage + "']").prop("selected", true);
                PosnicPro.local.set("country_value", data.country);
                PosnicPro.local.set("country_setting", data.country);
                PosnicPro.local.set("state_setting", data.state);
                $('#setting_country').val(data.country).trigger('change.select2');
                let stateId = $("#setting_country option[value='" + data.country + "']").data("setting-id");
                PosnicPro.local.set("currency_setting", data.currency);
                $('#currency_setting').val(data.currency_text).trigger('change.select2');
                let $test = $('.email-input:parent');
                $('.add-email-field', $test).hide();
                $.each(data.email_fields, function (key, value) {
                    $('.email-wrapper .email-fields .email-input:nth-child(n+2)').remove();
                    $.each(value.email_address, function (index, value) {
                        var i = 0;
                        $('.email-wrapper').each(function () {
                            i++;
                            var $wrapper = $('.email-fields', this);
                            $('.email-input:first-child', $wrapper).clone(true).appendTo($wrapper).find('input').attr('id', 'emailaddress[' + i + ']').attr('name', 'emailaddress[' + i + ']').removeClass('edit-email-class').val(value.email);
                        });
                    });
                    let $newtest = $('.email-input:last-child');
                    $('.add-email-field', $newtest).show();
                    $('.email-wrapper .email-fields .email-input:nth-child(1)').remove();
                    $('#report_type').val(value.report_type).trigger('change.select2');
                    $('#send_mail').val(value.send_mail).trigger('change.select2');
                    $('.error').remove();
                    var $firstChild = $('.email-input:first-child');
                    $('.add-email-field', $firstChild).show();
                });
                PosnicPro.stocklogs.viewLowStockDashboard();
                PosnicPro.getBranchDropdownOption();
                PosnicPro.denom.denomTable();
                PosnicPro.tableOrders.tableOrdersTable();
                if (!data.payment_gateway || typeof data.payment_gateway.key === "undefined" || data.payment_gateway.key.trim() === '') {
                    $('#payment_razorpay').prop('disabled', true);
                } else {
                    $('#payment_razorpay').prop('disabled', false);
                }             

                //var countryDetail = $('#setting_country').select2("data");
                //PosnicPro.settings.loadSelectSettingState(countryDetail[0].element.attributes['data-setting-id'].value);
            } else {
                $('#setting_status').val("No");
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        var branch_id = PosnicPro.local.get('branch_id_set');
        PosnicPro.settings.viewSettings(branch_id);
    },
    resetEmailSetting: function () {
        var params = {
            url: 'branches/resetEmailSetting',
            data: {}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                let $test = $('.email-input:parent');
                $('.add-email-field', $test).hide();
                $.each(response.data, function (key, value) {
                    $('.email-wrapper .email-fields .email-input:nth-child(n+2)').remove();
                    $.each(value.email_address, function (index, value) {
                        var i = 0;
                        $('.email-wrapper').each(function () {
                            i++;
                            var $wrapper = $('.email-fields', this);
                            $('.email-input:first-child', $wrapper).clone(true).appendTo($wrapper).find('input').attr('id', 'emailaddress[' + i + ']').attr('name', 'emailaddress[' + i + ']').removeClass('edit-email-class').val(value.email);
                        });
                    });
                    let $newtest = $('.email-input:last-child');
                    $('.add-email-field', $newtest).show();
                    $('.email-wrapper .email-fields .email-input:nth-child(1)').remove();
                    $('#report_type').val(value.report_type).trigger('change.select2');
                    $('#send_mail').val(value.send_mail).trigger('change.select2');
                    $('.error').remove();
                    var $firstChild = $('.email-input:first-child');
                    $('.add-email-field', $firstChild).show();
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });

    },
    resetPaymentGateway: function () {
        var params = {
            url: 'branches/resetPaymentGateway',
            data: {}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#site_key').val(response.data['key']);
                $('#secret_key').val(response.data['secret']);
                (response.data['status'] === 'true') ? $('#payment_gateway').prop("checked", true).attr('checked', 'checked')
                    : $('#payment_gateway').prop("checked", false).attr('unchecked', 'unchecked');
            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });

    },
    resetPhonepePaymentGateway: function () {
        var params = {
            url: 'branches/resetPhonepePaymentGateway',
            data: {}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#phonepe_merchant_id').val(response.data['merchantId']);
                $('#phonepe_salt_key').val(response.data['saltKey']);
                (response.data['status'] === 'true') ? $('#phonepe_payment_gateway').prop("checked", true).attr('checked', 'checked')
                    : $('#phonepe_payment_gateway').prop("checked", false).attr('unchecked', 'unchecked');
            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });

    },
    verifyViewDangerZoneConfirmed: function () {
        var regexPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{5,20}$/;
        var password = $('#verifyPassword').val();
        if (password !== '' && (regexPassword.test(password))) {
            var params = {
                url: 'users/userVerify',
                data: { password: password }
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    $('#verifyPassword').val('');
                    PosnicPro.settings.getAllCollection();
                } else {
                    $('#danger_zone').hide();
                    $('#dangerZone').show();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    emailSetting: function () {

        var email = $(".email_list")
            .map(function () {
                return $(this).val();
            }).get();
        var emailValues = {
            email_value: email
        }
        var formData = PosnicPro.getFormData($('#email_add'));
        var loader = $(".loader-view-emailsetting");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/emailSetting',
            data: JSON.stringify(Object.assign(formData, emailValues))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.alert(response.type, response.message);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    kioskAccountSettings: function () {
        const storeId = $('#kioskstore_id').val().trim();
        // const secretKey = $('#kiosksecret_key').val().trim();
        const loader = $(".loader-view-kiosksetting");

        // Clear old loader if exists
        loader.find(".loadingSpinner").remove();
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        // Basic frontend validation
        const isValid = /^[A-Za-z0-9]{3,6}$/.test(storeId);
        if (!isValid) {
            loader.find(".loadingSpinner").remove();
            PosnicPro.alert('error', 'Store ID and Secret Key must be 3–6 letters/numbers only');
            return false;
        }

        const data = {
            store_id: storeId,
            // secret_key: secretKey
        };

        const params = {
            url: 'setting/kioskAccountSettings',
            data: JSON.stringify(data)
        };

        PosnicPro.put(params, function (response) {
            loader.find(".loadingSpinner").remove();

            if (response.type === 'success') {
                PosnicPro.alert('success', response.message || 'Settings saved');
            } else {
                PosnicPro.alert('error', response.message || 'Could not save settings. Please try again.');
            }
        }, function (xhr) {
            loader.find(".loadingSpinner").remove();

            try {
                const response = JSON.parse(xhr.responseText);
                PosnicPro.alert(response.type || 'error', response.message || 'Unexpected server error');
            } catch (e) {
                PosnicPro.alert('error', 'Something went wrong. Please try again.');
            }
        });

        return false;
    },
    kioskPrinterSettings: function () {
        // collect all printer_name[*] values
        const printers = $('input[name^="printer_name["]')
            .map(function () {
                return $.trim($(this).val());
            })
            .get()
            .filter(function (v, idx, arr) {
                return v !== '' && arr.indexOf(v) === idx;   // remove empty + duplicates
            });

        const loader = $(".loader-view-kioskprintersetting");

        loader.find(".loadingSpinner").remove();
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        const data = {
            printer_names: printers        // <-- ARRAY
        };

        const params = {
            url: 'setting/kioskPrinterSettings',
            data: JSON.stringify(data)
        };

        PosnicPro.put(params, function (response) {
            loader.find(".loadingSpinner").remove();

            if (response.type === 'success') {
                PosnicPro.alert('success', response.message || 'Settings saved');
            } else {
                PosnicPro.alert('error', response.message || 'Could not save settings. Please try again.');
            }
        }, function (xhr) {
            loader.find(".loadingSpinner").remove();

            try {
                const response = JSON.parse(xhr.responseText);
                PosnicPro.alert(response.type || 'error', response.message || 'Unexpected server error');
            } catch (e) {
                PosnicPro.alert('error', 'Something went wrong. Please try again.');
            }
        });
    },
    verifyDeleteCollections: function () {
        var regexPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{5,20}$/;
        if ((regexPassword.test($('#verify_password').val()))) {
            var password = ($('#verify_password').val() !== '') ? $('#verify_password').val() : $('#user_verify_password').val();
            var params = {
                url: 'users/userVerify',
                data: { password: password }
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    $('.hideconfirm').show();
                    PosnicPro.collectionDeleteConfirmed();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    changeInputFieldsValueBackupTable: function (index) {
        var field_name = $('#backuptablelist :selected').val();
        $('.hide-recyclebin').hide();
        $('.' + field_name + '-recyclebin').show().prop('selected', 'selected');
        $('.' + field_name + '-recyclebin').attr('selected', 'selected');
        var module = $(index).data('id');
        var field_name = $('#view_' + module + '_fields :selected').text();
        if (module === 'recycle_bin' && typeof field_name === 'string') {
            field_name = field_name.replace(/\s+/g, ' ').trim();
            $('#view_' + module + '_input').prop('placeholder', 'Enter ' + field_name);
            ($(index).val() === 'branches') ? $('#hide_branch_recyclebin,#Select_backup_Branch').hide() : $('#hide_branch_recyclebin,#Select_backup_Branch').show();
        }
        $('#view_' + module + '_input').prop('placeholder', 'Enter ' + field_name);
        ($(index).val() === 'branches') ? $('#hide_branch_recyclebin,#Select_backup_Branch').hide() : $('#hide_branch_recyclebin,#Select_backup_Branch').show();
    },
    printDetail: function () {
        var id = PosnicPro.local.get('sid');
        PosnicPro.get('users/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $.each(data.preference, function (key, val) {
                    $("#print_type option[value='" + val + "']").prop("selected", true);
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    settingImageReadURL: function (e) {
        $("#file").css("color", "green");
        $('#previewing').attr('src', e.target.result);
        $('#previewing').attr('width', '200px');
        $('#previewing').attr('height', '200px');
    },
    /*
     * Module On/Off for another branch (M4): the selector edits any branch
     * of this shop without switching sessions. Remote editing deliberately
     * rides a SEPARATE save path: the full updateCommonSetting collects the
     * whole settings surface plus a dozen session side effects (localStorage,
     * KOT visibility, blob rebuilds), all of which belong to the branch you
     * are logged into, not the one you are editing.
     */
    _featuresDirty: false,
    _moduleToggleIds: [
        'staff_shifts_enable', 'staff_tips_enable', 'staff_roster_enable',
        'cash_register_enable', 'till_lock_enable',
        'module_tax_enable', 'module_credit_enable', 'module_marketing_enable',
        'module_messaging_enable', 'module_channels_enable', 'module_channels_kiosk_enable',
        'module_recyclebin_enable', 'module_themes_enable', 'module_cashbook_enable',
        'module_demo_data_enable',
        'quick_sale_enable',
        'quotes_enable',
        'custom_charges_enable',
        'pl_include_cashbook',
    ],
    initModulesBranchSelect: function () {
        var $sel = $('#modules_branch_select');
        if (!$sel.length) { return; }
        var sessionBranch = PosnicPro.local.get('branch_id_set');
        var options = $('#branch_name option').filter(function () {
            return $(this).val() && $(this).val() !== 'addbranch';
        });
        if (options.length < 2) { $('#modules_branch_wrap').hide(); return; }
        var html = '';
        options.each(function () {
            var v = $(this).val();
            var label = $(this).text();
            html += '<option value="' + v + '"' + (String(v) === String(sessionBranch) ? ' selected' : '') + '>'
                + label + (String(v) === String(sessionBranch) ? ' (this till)' : '') + '</option>';
        });
        $sel.html(html);
        $('#modules_branch_wrap').show();
    },
    _modulesRemoteBranch: function () {
        var v = $('#modules_branch_select').val();
        var sessionBranch = PosnicPro.local.get('branch_id_set');
        return v && String(v) !== String(sessionBranch) ? v : null;
    },
    modulesBranchChanged: function () {
        var remote = PosnicPro.settings._modulesRemoteBranch();
        if (!remote) {
            $('#modules_remote_note').hide();
            // Back home: the server is the truth for this till's switches.
            PosnicPro.settings.viewSettings();
            return;
        }
        PosnicPro.get('setting/branchModules?branch_id=' + encodeURIComponent(remote), function (response) {
            var d = response && response.data;
            if (!d || !d.modules) { PosnicPro.alert('error', 'Could not load that branch'); return; }
            PosnicPro.settings._moduleToggleIds.forEach(function (key) {
                if (d.modules[key] !== undefined) {
                    $('#' + key).prop('checked', d.modules[key] === true);
                }
            });
            PosnicPro.settings.refreshModuleCards();
            $('#modules_remote_note span').text(
                'Editing ' + (d.branch_name || 'another branch') + ' - saving here changes THAT branch only; this till is untouched.'
            );
            $('#modules_remote_note').show();
        }, function () {
            PosnicPro.alert('error', 'Could not load that branch');
        });
    },
    saveModulesTab: function () {
        var remote = PosnicPro.settings._modulesRemoteBranch();
        if (!remote) {
            PosnicPro.settings.updateCommonSetting('Feature switches saved');
            return;
        }
        // Toggles only + the endpoint's validation satisfiers (ignored by
        // the server's remote path, which writes the toggle map and nothing
        // else). NO session side effects, NO local caches, NO gating.
        var payload = { target_branch_id: remote };
        PosnicPro.settings._moduleToggleIds.forEach(function (key) {
            payload[key] = $('#' + key).is(':checked') ? 'true' : 'false';
        });
        payload.sales_prefix = $('#sales_prefix').val() || 'SAL';
        payload.receiving_prefix = $('#receiving_prefix').val() || 'REC';
        var branchLabel = $('#modules_branch_select option:selected').text();
        PosnicPro.put({
            url: 'setting/updateCommonSettings',
            data: JSON.stringify(payload)
        }, function (response) {
            if (response.type === 'success') {
                PosnicPro.settings._featuresDirty = false;
                PosnicPro.settings.restoreDemoDataIfEmpty();
                PosnicPro.alert('success', 'Features saved for ' + branchLabel);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function () {
            PosnicPro.alert('error', 'Could not save that branch');
        });
    },
    /* successLabel: what the toast says on success - each Save button names
       its own act ("Module switches saved") instead of the generic server
       line, which reads the same from four different screens. */
    updateCommonSetting: function (successLabel) {
        var loader = $(".loader-view-mystore");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var taxDetail = $("#tax_percentage").select2("data");
        /*
         * A branch with no taxes configured has an empty select - reading
         * [0].element of nothing threw here and the PUT never fired: the
         * Save button spun forever (owner report). Empty tax is a valid
         * state; the id reads below all go through this helper.
         */
        var _taxId = (taxDetail && taxDetail[0] && taxDetail[0].element
            && taxDetail[0].element.attributes['data-tax-id'])
            ? taxDetail[0].element.attributes['data-tax-id'].value : '';
        var content = $('textarea[name="footer_print"]').html($('#footer_print').summernote('code'));
        var contentHeader = $('textarea[name="header_print"]').html($('#header_print').summernote('code'));
        var params = {
            url: 'setting/updateCommonSettings',
            data: JSON.stringify({
                default_customer: $('#customers_default_value').val(),
                default_supplier: $('#suppliers_default_value').val(),
                default_tax: _taxId,
                notification_value: $('#notification_value').val(),
                discount_percentage: $('#discount_percentage').val(),
                discount_amount: $('#discount_amount').val(),
                sales_prefix: $('#sales_prefix').val(),
                email_smtp_host: $('#email_smtp_host').val() || '',
                email_smtp_port: $('#email_smtp_port').val() || '',
                email_smtp_secure: $('#email_smtp_secure').is(':checked') ? 'true' : 'false',
                email_smtp_username: $('#email_smtp_username').val() || '',
                email_smtp_password: $('#email_smtp_password').val() || '',
                email_smtp_from: $('#email_smtp_from').val() || '',
                quote_default_payment_method: $('#quote_default_payment_method').val() || '',
                quote_default_bank_details: $('#quote_default_bank_details').val() || '',
                quote_default_terms: $('#quote_default_terms').val() || '',
                quote_default_signature: $('#quote_default_signature').val() || '',
                receiving_prefix: $('#receiving_prefix').val(),
                allow_sale_date_edit: ($('#allow_sale_date_edit').is(":checked")) ? 'true' : 'false',
                indian_gst: $('#indian_gst').val(),
                branch_gstin_number: $('#branch_gstin_number').val(),
                print_type: $('#print_type').val(),
                print_size: $('#print_size').val(),
                print_character: $('#print_character').val(),
                header_print: contentHeader.html(),
                footer_print: content.html(),
                stock_log_management: ($('#stock_log_management').is(":checked")) ? 'true' : 'false',
                stock_management: ($('#stock_management').is(":checked")) ? 'true' : 'false',
                printall: ($('#printall').is(":checked")) ? 'true' : 'false',
                roundOff: ($('#decimal_Round').is(":checked")) ? 'true' : 'false',
                receipt_barcode: ($('#receipt_barcode').is(":checked")) ? 'true' : 'false',
                sales_sms: ($('#sales_sms').is(":checked")) ? 'true' : 'false',
                auto_sms: ($('#auto_sms').is(":checked")) ? 'true' : 'false',
                sales_mail: ($('#sales_mail').is(":checked")) ? 'true' : 'false',
                customer_print: ($('#customer_print').is(":checked")) ? 'true' : 'false',
                print_url: ($('#print_url').is(":checked")) ? 'true' : 'false',
                print_logoimg: ($('#print_logoimg').is(":checked")) ? 'true' : 'false',
                print_sale_notes: ($('#print_sale_notes').is(":checked")) ? 'true' : 'false',
                keyboard_view: ($('#keyboard_view').is(":checked")) ? 'true' : 'false',
                whatsapp_receipt: ($('#whatsapp_receipt').is(":checked")) ? 'true' : 'false',
                balance_view: true,
                customer_checkbox: ($('#default_customer_enable_disable').is(":checked")) ? 'true' : 'false',
                supplier_checkbox: ($('#default_supplier_enable_disable').is(":checked")) ? 'true' : 'false',
                tax_checkbox: ($('#default_tax_enable_disable').is(":checked")) ? 'true' : 'false',
                sale_quick_edit_enable: ($('#sale_quick_edit').is(":checked")) ? 'true' : 'false',
                enable_multi_payment: ($('#enable_multi_payment').is(":checked")) ? 'true' : 'false',
                table_options: ($('#table_options').is(":checked")) ? 'true' : 'false',
                enable_notification_reminders: ($('#enable_notification_reminders').is(":checked")) ? 'true' : 'false',
                enable_email_reminders: ($('#enable_email_reminders').is(":checked")) ? 'true' : 'false',
                enable_sms_reminders: ($('#enable_sms_reminders').is(":checked")) ? 'true' : 'false',
                enable_sms_auto_send: ($('#enable_sms_auto_send').is(":checked")) ? 'true' : 'false',
                sms_auto_send_time: $('#sms_auto_send_period').val(),
                sms_retry_period: $('#sms_retry_period').val(),
                sms_max_retries: $('#sms_max_retries').val(),
                hardware_weight_machine_enable: $('#hardware_weight_machine_enable').is(':checked'),
                till_lock_enable: $('#till_lock_enable').is(':checked') ? 'true' : 'false',
                till_lock_idle_minutes: $('#till_lock_idle_minutes').val() || '0',
                staff_shifts_enable: $('#staff_shifts_enable').is(':checked') ? 'true' : 'false',
                staff_tips_enable: $('#staff_tips_enable').is(':checked') ? 'true' : 'false',
                staff_roster_enable: $('#staff_roster_enable').is(':checked') ? 'true' : 'false',
                cash_register_enable: $('#cash_register_enable').is(':checked') ? 'true' : 'false',
                module_tax_enable: $('#module_tax_enable').is(':checked') ? 'true' : 'false',
                module_credit_enable: $('#module_credit_enable').is(':checked') ? 'true' : 'false',
                module_marketing_enable: $('#module_marketing_enable').is(':checked') ? 'true' : 'false',
                module_messaging_enable: $('#module_messaging_enable').is(':checked') ? 'true' : 'false',
                module_channels_enable: $('#module_channels_enable').is(':checked') ? 'true' : 'false',
                module_channels_kiosk_enable: $('#module_channels_kiosk_enable').is(':checked') ? 'true' : 'false',
                module_recyclebin_enable: $('#module_recyclebin_enable').is(':checked') ? 'true' : 'false',
                module_demo_data_enable: $('#module_demo_data_enable').is(':checked') ? 'true' : 'false',
                module_themes_enable: $('#module_themes_enable').is(':checked') ? 'true' : 'false',
                pl_include_cashbook: $('#pl_include_cashbook').is(':checked') ? 'true' : 'false',
                module_cashbook_enable: $('#module_cashbook_enable').is(':checked') ? 'true' : 'false',
                quick_sale_enable: $('#quick_sale_enable').is(':checked') ? 'true' : 'false',
                quotes_enable: $('#quotes_enable').is(':checked') ? 'true' : 'false',
                custom_charges_enable: $('#custom_charges_enable').is(':checked') ? 'true' : 'false',
            })
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.settings._featuresDirty = false;
                PosnicPro.settings.restoreDemoDataIfEmpty();
                let htmlView = $('#footer_print').text();
                $('.footer-content').html(htmlView);
                let htmlHeaderView = $('#header_print').text();
                $('.header-content').html(htmlHeaderView);
                if (_taxId) {
                    $(".items_tax").val(_taxId).trigger("change");
                    PosnicPro.local.set('default_tax_id', _taxId);
                }
                var roundOff = ($('#decimal_Round').is(":checked")) ? true : false;
                PosnicPro.roundoff = roundOff;
                if (_taxId) { $("#tax_percentage").val(_taxId).trigger("change"); }
                var print_value = $('#print_type').val(); 
                PosnicPro.local.set('print_type', print_value);
                PosnicPro.local.set('printing_size', $('#print_size').val());
                PosnicPro.local.set('printing_max_char', $('#print_character').val());
                PosnicPro.local.set('print_url', response.data.url);
                PosnicPro.settings.getDefaultCustomerDetails(response.data.customer);
                PosnicPro.settings.getDefaultSupplierDetails(response.data.supplier);
                var discount_percentage = $('#discount_percentage').val();
                var discount_amount = $('#discount_amount').val();
                PosnicPro.local.set('setting-discount-amount', discount_amount);
                PosnicPro.local.set('setting-discount-percentage', discount_percentage);
                if ($('#indian_gst').val() === 'gst_on') {
                    $('.indian-gstr').show();
                    PosnicPro.local.set('gst_action', 'enable');
                } else {
                    $('.indian-gstr').hide();
                    PosnicPro.local.set('gst_action', 'disable');
                }

if ($("#sale_quick_edit").is(":checked")) {
                    PosnicPro.local.set('sale_quick_edit', 'enable');
                } else {
                    PosnicPro.local.set('sale_quick_edit', 'disable');
                }
                if ($("#enable_multi_payment").is(":checked")) {
                    PosnicPro.local.set('enable_multi_payment', 'enable');
                } else {
                    PosnicPro.local.set('enable_multi_payment', 'disable');
                }
                var $kotLi = $('#view_kot_page').closest('li');
                var $kotOrderLi = $('#view_kotorder_page').closest('li');
                var $kotHistoryLi = $('#view_kothistory_page').closest('li');
                var $kotReportLi = $('#viewkotreport_page').closest('li');
                var $newSaleLi = $('#view_touchsales_page').closest('li');
                if ($("#table_options").is(":checked")) {
                    PosnicPro.local.set('table_options', 'enable');
                    PosnicPro.applyKotVisibility(true);
                    $kotLi.show();
                    $kotOrderLi.show();
                    $kotHistoryLi.show();
                    $kotReportLi.show();
                    $newSaleLi.hide();
                    $('#image_sidebar_newsale').hide();
                    $('#kot_menu').show();
                    $('#item_master_menu').show();
                } else {
                    PosnicPro.local.set('table_options', 'disable');
                    $kotLi.hide();
                    $kotOrderLi.hide();
                    $kotHistoryLi.hide();
                    $kotReportLi.hide();
                    $newSaleLi.show();
                    $('#kot_menu').hide();
                    $('#item_master_menu').hide();
                }

                if ($("#keyboard_view").is(":checked")) {
                    PosnicPro.local.set('keyboard_view', 'true');
                    keyboard_view();
                } else {
                    PosnicPro.local.set('keyboard_view', 'false');
                    keyboard_view();
                }

                PosnicPro.local.set('balance_view', 'true');
                ($('#default_customer_enable_disable').is(":checked")) ? PosnicPro.local.set('default_customer_enable_disable', "true") : PosnicPro.local.set('default_customer_enable_disable', "false");
                ($('#default_supplier_enable_disable').is(":checked")) ? PosnicPro.local.set('default_supplier_enable_disable', "true") : PosnicPro.local.set('default_supplier_enable_disable', "false");
                ($('#default_tax_enable_disable').is(":checked")) ? PosnicPro.local.set('default_tax_enable_disable', "true") : PosnicPro.local.set('default_tax_enable_disable', "false");
                localStorage.setItem("notificationrange", $('#notification_value').val());
                $("#low_item_stock_count").text($('#notification_value').val());
                PosnicPro.stocklogs.viewLowStockDashboard();
                
                // Save the Module On/Off state to localStorage (checkboxes
                // since the toggles-only rebuild).
                var generalSettings = {
                    hardware_weight_machine_enable: $('#hardware_weight_machine_enable').is(':checked'),
                    till_lock_enable: $('#till_lock_enable').is(':checked'),
                    till_lock_idle_minutes: parseInt($('#till_lock_idle_minutes').val(), 10) || 0,
                    staff_shifts_enable: $('#staff_shifts_enable').is(':checked'),
                    staff_tips_enable: $('#staff_tips_enable').is(':checked'),
                    staff_roster_enable: $('#staff_roster_enable').is(':checked'),
                    cash_register_enable: $('#cash_register_enable').is(':checked'),
                    module_tax_enable: $('#module_tax_enable').is(':checked'),
                    module_credit_enable: $('#module_credit_enable').is(':checked'),
                    module_marketing_enable: $('#module_marketing_enable').is(':checked'),
                    module_messaging_enable: $('#module_messaging_enable').is(':checked'),
                    module_channels_enable: $('#module_channels_enable').is(':checked'),
                    module_channels_kiosk_enable: $('#module_channels_kiosk_enable').is(':checked'),
                    module_recyclebin_enable: $('#module_recyclebin_enable').is(':checked'),
                    module_demo_data_enable: $('#module_demo_data_enable').is(':checked'),
                    module_themes_enable: $('#module_themes_enable').is(':checked'),
                    module_cashbook_enable: $('#module_cashbook_enable').is(':checked'),
                    quotes_enable: $('#quotes_enable').is(':checked'),
                    custom_charges_enable: $('#custom_charges_enable').is(':checked'),
                    quick_sale_enable: $('#quick_sale_enable').is(':checked')
                };
                PosnicPro.local.set('general_settings', JSON.stringify(generalSettings));
                // Show or hide the header clock button to match, right away.
                PosnicPro.shiftWidget.applyEnabled();
                // Config's own left menu follows the switches immediately -
                // the feedback loop that teaches "this switch shapes my app".
                PosnicPro.settings.applyModuleNav();
                PosnicPro.applyModuleSidebar();
                // Register menu follows the module toggle the same way.
                if (!$('#cash_register_enable').is(':checked')) {
                    $('.cashRegisterModule').css('display', 'none');
                } else {
                    $('.cashRegisterModule').css('display', 'block');
                    // Re-enabling must also re-arm the sale-screen gate: the
                    // disable path parks branch_has_no_registers='true' to
                    // stand the gate down, so clear it here.
                    PosnicPro.local.set('branch_has_no_registers', '');
                }
            }
            PosnicPro.alert(response.type,
                (response.type === 'success' && successLabel) ? successLabel : response.message);
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    /*
     * Config's left menu shows only the modules the shop runs (Module
     * On/Off). Reads the cached general_settings blob - both the load and
     * save paths refresh the blob before calling this. A group header with
     * nothing visible under it hides too (an empty RESTAURANT header was
     * exactly the clutter the module system exists to remove).
     */
    /*
     * Core Settings tabs: the ones that do not fit the card width fold into
     * the More dropdown on the right. Re-run on show and resize; items are
     * restored first so the measurement is honest.
     */
    coreTabsOverflow: function () {
        var bar = $('#core_settings_tabs');
        if (!bar.length || !bar.is(':visible')) { return; }
        var more = bar.find('.core-tabs-more');
        var menu = more.find('.core-tabs-more-menu').empty();
        var items = bar.children('.nav-item').not(more);
        items.removeClass('d-none');
        more.addClass('d-none');
        var avail = bar.width() - 90; // room for the More toggle
        var used = 0;
        var overflowed = [];
        items.each(function () {
            used += $(this).outerWidth(true);
            if (used > avail) { overflowed.push(this); }
        });
        if (!overflowed.length) { return; }
        more.removeClass('d-none');
        $.each(overflowed, function (i, li) {
            var $a = $(li).children('a');
            $(li).addClass('d-none');
            $('<a class="dropdown-item" href="javascript:void(0)"></a>')
                .text($a.text().trim())
                .on('click', function () { $a.tab('show'); })
                .appendTo(menu);
        });
    },
    /* ON cards vivid, OFF cards greyed - the state must read before the
       labels do. Driven by each card's main switch. */
    refreshModuleCards: function () {
        $('#v-pills-modules .module-card').each(function () {
            var $main = $(this).find('.module-card-head input.custom-control-input').first();
            $(this).toggleClass('is-off', !$main.is(':checked'));
        });
    },
    applyModuleNav: function () {
        PosnicPro.settings.refreshModuleCards();
        var s = {};
        try { s = JSON.parse(PosnicPro.local.get('general_settings') || '{}'); } catch (e) { /* defaults */ }
        var on = function (k) { return s[k] !== false; };

        $('#v-pills-taxmodule-tab').toggle(on('module_tax_enable'));
        $('#v-pills-credit-tab').toggle(on('module_credit_enable'));
        $('#v-pills-marketingmodule-tab').toggle(on('module_marketing_enable'));
        $('#v-pills-messagingmodule-tab').toggle(on('module_messaging_enable'));
        // The entry is the CHANNELS roof now (kiosk is its content), so it
        // gates on the module alone.
        $('#v-pills-kiosk-tab').toggle(on('module_channels_enable'));
        $('#v-pills-recyclebin-tab').toggle(on('module_recyclebin_enable'));
        $('#v-pills-theme-tab').toggle(on('module_themes_enable'));
        $('#v-pills-cashregister-tab').toggle(on('cash_register_enable'));
        $('#v-pills-cashbook-tab').toggle(on('module_cashbook_enable'));
        $('#v-pills-workforce-tab').toggle(on('staff_shifts_enable'));
        // The header and main sidebar follow the same truth at the same
        // moment - every path that refreshes Config refreshes everywhere.
        PosnicPro.applyModuleSidebar();
        PosnicPro.settings.coreTabsOverflow();
        $('#v-pills-tableorder-tab').toggle(PosnicPro.local.get('table_options') === 'enable');

        $('#v-pills-tab .settings-nav-group').each(function () {
            var visible = $(this).nextUntil('.settings-nav-group').filter('a.nav-link').filter(function () {
                return $(this).css('display') !== 'none';
            }).length;
            $(this).toggle(visible > 0);
        });
    },
    changeBranch: function (branch_no) {
        if (branch_no === 'addbranch') {
            var branch_id_set = PosnicPro.local.get('branch_id_set');
            $("#branch_name option[value='" + branch_id_set + "']").prop("selected", "selected");
            hasher.setHash('branches/new/addbranch');
        } else {
            var params = {
                url: 'users/changeBranch',
                data: JSON.stringify({ branch_no: branch_no })
            };
            PosnicPro.post(params, function (response) {
                /* 'success', lowercase. This compared against 'Success' for
                   years, so the server switched the session's branch while
                   the client updated NOTHING - settings kept showing the old
                   branch against the new branch's session. */
                if (response.type === 'success') {
                    $("#branch_name option[value='" + branch_no + "']").prop("selected", "selected");
                    PosnicPro.local.set("branch_id_set", branch_no);
                    if (PosnicPro.sales && PosnicPro.sales.itemCache) {
                        PosnicPro.sales.itemCache.clear();
                    }
                    PosnicPro.settings.viewSettings(branch_no);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    getRestoreAccess: function () {
        var module = $('#backuptablelist :selected').val();
        var restore = PosnicPro[module + "_checkbox"];
        if (restore.length > 0) {
            $('#restoreModal').modal('show');
            $('.restoreCountValue').html(restore.length);
        } else {
            PosnicPro.alert('warning', 'Select at least one row.');
        }
    },
    setRestoreAccess: function () {
        var module = $('#backuptablelist :selected').val();
        var restore = PosnicPro[module + "_checkbox"];
        var arr = [];
        var obj = {};
        $(restore).each(function (key, id) {
            obj = id;
            arr.push(obj);
        });
        var params = {
            url: 'setting/restoreBackup',
            data: JSON.stringify({ data: arr })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.settings.settingsTable();
            }
            $('#restoreModal').modal('hide');
            $('.restoreCountValue').html('');
            $('.showing-hide-show-' + module).hide();
            PosnicPro[module + "_checkbox"] = [];
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    listBranchName: function (id) {
        var params = {
            url: 'users/changeBranch',
            data: JSON.stringify({ branch_no: id })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                $("#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-inventory-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab,#v-pills-manage-tab,#v-pills-branch-tab").removeClass("active");
                PosnicPro.getBranchTaxList();
                PosnicPro.local.set("branch_id_set", id);
                // Cached items carry the OLD branch's stock and pricing.
                if (PosnicPro.sales && PosnicPro.sales.itemCache) {
                    PosnicPro.sales.itemCache.clear();
                }
                //PosnicPro.users.emptyRegisterbrachListuser(id);
                var branchOption = [];
                branchOption.push(id);
                let data = response.data;
                $('.display-current-branch').select2('val', [branchOption]);
                PosnicPro.local.set('branchname', data.branch_name);
                PosnicPro.local.set('branchemail', data.branch_email);
                PosnicPro.local.set('branchphone', data.branch_phone);
                PosnicPro.local.set('branchaddress', data.branch_address);
                PosnicPro.local.set('branchimage', data.branch_logo);
                var branchRecord = [];
                branchRecord.push({ name: data.branch_name, phone: data.branch_phone, email: data.branch_email, address: data.branch_address, image: data.branch_logo });
                db.customerDisplay.put({ id: '2', 'clear': 'no', 'get': 'no', branch: branchRecord });
                var userid = PosnicPro.local.get('userid');
                db.currentbranch.put({ id: '1', branch_id: id, branch_name: data.branch_name, user_id: userid });
                PosnicPro.settings.viewSettings(id);
                PosnicPro.items.itemClearForm();
                PosnicPro.categories.categoryClearForm();
                PosnicPro.variants.variantClearForm();
                PosnicPro.suppliers.supplierClearForm();
                PosnicPro.customers.customerClearForm();
                PosnicPro.tax.taxClearForm();
                PosnicPro.taxgroup.taxgroupClearForm();
                PosnicPro.users.userClearForm();
                PosnicPro.branches.branchClearform();
                PosnicPro.expenses.expenseClearForm();
                PosnicPro.sales.clear.cartItems();
                PosnicPro.receivings.resetReceivingsForm();
                setLocalValue();
                
                // Check if there's an open register for this branch in database
                var registerParams = {
                    url: 'branches/userRegisterBranchSelect',
                    data: {id: id}
                };
                PosnicPro.get(registerParams, function (registerResponse) {
                    if (registerResponse.type === 'success' && registerResponse.data.open_register && registerResponse.data.open_register.register_status === 'Opened') {
                        // Load existing open register
                        PosnicPro.local.set('cash_register_id', registerResponse.data.open_register.cash_register_id);
                        PosnicPro.local.set('register_id', registerResponse.data.open_register.register_id);
                        PosnicPro.local.set('register_name', registerResponse.data.open_register.register_name);
                        PosnicPro.local.set('userRegisterStatus', 'Open');
                        PosnicPro.local.set('branch_has_no_registers', '');
                        
                        db.currentregister.put({
                            id: '1', 
                            register_id: registerResponse.data.open_register.register_id, 
                            register_name: registerResponse.data.open_register.register_name, 
                            register_status: 'open'
                        });
                        
                        PosnicPro.alert('success', 'Branch changed - Continuing with open register: ' + registerResponse.data.open_register.register_name);
                    } else {
                        // No open register - clear register data
                        PosnicPro.local.set('userRegisterStatus', 'Closed');
                        PosnicPro.local.set('cash_register_id', '');
                        PosnicPro.local.set('register_id', '');
                        PosnicPro.local.set('register_name', '');
                        PosnicPro.local.set('branch_has_no_registers', '');
                        
                        db.currentregister.put({id: '1', register_id: '', register_name: '', register_status: 'close'});
                        
                        PosnicPro.alert('success', 'Branch changed - Please select a register before creating sales');
                    }
                });
                
                PosnicPro.stocklogs.viewLowStockDashboard();
                PosnicPro.sales.itemsMenu.onlineProductList();
                $("#dashboardModule a").addClass('active');
                $("#view_config_page").removeClass('active');
                $("#v-pills-dashboard-tab").addClass('active');
                $("#v-pills-dashboard-tab").addClass('active show');
                hasher.setHash('branches');
                PosnicPro.alert('success', 'Branch changed');
            }
            return false;
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    removePopupBranchImage: function () {
        $('#deleteImagePopup').modal('show');
    },
    removeBranchImage: function () {
        var image_value = $('#setting_logo_value').val();
        var params = {
            url: 'setting/branchImageDelete',
            data: JSON.stringify({ data: image_value })
        };
        PosnicPro.delete(params, function (response) {
            if (response.type === 'success') {
                var image_path = 'static/images/default/store.png';
                $('#previewing,#store_image').attr('src', image_path);
                $('#setting_image_value').val('');
                $('#deleteImagePopup').modal('hide');
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    defaultCustomerData: function (checked) {
        if (checked) {
            $("#default_customer_enable_disable").prop("checked", true);
            $('#default_customer').removeAttr('disabled');
            $(".customer-text-disable").css("color", '#20a83b');
            $(".customer-text-enable").css("color", '#141d46');
        } else {
            $("#default_customer_enable_disable").prop("checked", false);
            $('#default_customer').attr('disabled', 'disabled');
            $(".customer-text-disable").css("color", '#141d46');
            $(".customer-text-enable").css("color", '#20a83b');
        }
    },
    defaultSupplierData: function (checked) {
        if (checked) {
            $("#default_supplier_enable_disable").prop("checked", true);
            $('#default_supplier').removeAttr('disabled');
            $(".supplier-text-disable").css("color", '#20a83b');
            $(".supplier-text-enable").css("color", '#141d46');
        } else {
            $("#default_supplier_enable_disable").prop("checked", false);
            $('#default_supplier').attr('disabled', 'disabled');
            $(".supplier-text-disable").css("color", '#141d46');
            $(".supplier-text-enable").css("color", '#20a83b');
        }
    },
    defaultTaxData: function (checked) {
        if (checked) {
            $("#default_tax_enable_disable").prop("checked", true);
            $('#tax_percentage').removeAttr('disabled');
            $(".tax-text-disable").css("color", '#20a83b');
            $(".tax-text-enable").css("color", '#141d46');
        } else {
            $("#default_tax_enable_disable").prop("checked", false);
            $('#tax_percentage').attr('disabled', 'disabled');
            $(".tax-text-disable").css("color", '#141d46');
            $(".tax-text-enable").css("color", '#20a83b');
        }
    },
    loadSelectSettingCountry: function () {
        var countrySelect = $('.setCountry');
        var params = {
            url: 'setting/getJSONCountry',
            data: { name: 'countries' }
        };
        PosnicPro.get(params, function (response) {
            countrySelect.empty();
            suggestions: $.map(response.data['countries'], function (dataItem) {
                var option;
                option += '<option value="' + dataItem.value + '" data-setting-id="' + dataItem.id + '">' + dataItem.value + ' </option>';
                countrySelect.append(option).select2();
            });
            countrySelect.val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    loadSelectSettingState: function (id) {
        var stateSelect = $('#setting_state');
        var params = {
            url: 'setting/getJSONState',
            data: { id: id }
        };
        PosnicPro.get(params, function (response) {
            stateSelect.empty();
            suggestions: $.map(response.data['stateJsonArray'], function (dataItem) {
                var options;
                options += '<option value="' + dataItem + '">' + dataItem + ' </option>';
                stateSelect.append(options).trigger('change');
            });
            if (PosnicPro.local.get("country_setting") === PosnicPro.local.get("country_value")) {
                stateSelect.val(PosnicPro.local.get('state_setting')).trigger('change.select2');
            } else {
                $('#setting_state option:eq(0)').prop('selected', true);
            }
            window.intlTelInputGlobals.getInstance(document.querySelector("#store_telephone")).setCountry(response.data['countrySortName']);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    loadSelectSettingCurrency: function () {
        var currencySelect = $('#currency_setting');
        var params = {
            url: 'setting/getJSONCurrency'
        };
        PosnicPro.get(params, function (response) {
            currencySelect.empty();
            suggestions: $.map(response.data['currency'], function (dataItem) {
                var option;
                option += '<option value="' + dataItem.value + '" data-currency-id="' + dataItem.id + '" data-currency-text="' + dataItem.text + '" data-currency-symbol="' + dataItem.symbol + '">' + dataItem.value + ' </option>';
                currencySelect.append(option).trigger('change');
            });
            currencySelect.val(PosnicPro.local.get("currency_setting")).trigger('change.select2');
            currencySelect.trigger({
                type: 'select2:select',
                params: {
                    data: response
                }
            }).on('select2:select', function (e) {
                let data = e.params.data;
                $('#currencyText').val(data.element.attributes['data-currency-symbol'].value);
                $('#currencyTextname').val(data.element.attributes['data-currency-text'].value);
                var currencyDataOPtion = "";
                $('#currency_type').empty();
                currencyDataOPtion += "<option id=" + data.element.attributes['data-currency-text'].value + '" value="' + data.element.attributes['data-currency-text'].value + '" selected>Text( ' + data.element.attributes['data-currency-text'].value + ' )</option>' +
                    " <option id=" + data.element.attributes['data-currency-symbol'].value + '" value="' + data.element.attributes['data-currency-symbol'].value + '">Symbol( ' + data.element.attributes['data-currency-symbol'].value + ' )</option>';
                $('#currency_type').append(currencyDataOPtion);
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    timeZone: function () {
        var timezoneSelect = $('#time_zone');
        var params = {
            url: 'setting/getJSONTimeZone'
        };
        PosnicPro.get(params, function (response) {
            timezoneSelect.empty();
            suggestions: $.map(response.data, function (dataItem) {
                var options;
                options += '<option value="' + dataItem.text + '" data-timezone-name="' + dataItem.text + '">' + dataItem.value + ' </option>';
                timezoneSelect.append(options).trigger('change');
            });
            let timezone = PosnicPro.local.get('timezone');
            timezoneSelect.val(timezone).trigger('change.select2');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    paymentKey: function () {
        var loader = $(".loader-qrsetting");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/paymentsKey',
            data: JSON.stringify({
                key: $('#site_key').val(),
                secret: $('#secret_key').val(),
                status: ($('#payment_gateway').is(":checked")) ? 'true' : 'false'
            })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                $('#payment_razorpay').prop('disabled', true);
                localStorage.setItem("payment_gateway", response.data);
                (response.data === 'true') ? $('.qr_btn').show() : $('.qr_btn').hide();
                loader.find(".loadingSpinner:first").remove();
            } else {
                $('#payment_razorpay').prop('disabled', false);
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    toggleInputs: function () {
        const isChecked = $('#enable_sms_auto_send').is(':checked');
        $('#sms_auto_send_time, #sms_retry_period, #sms_max_retries').prop('disabled', !isChecked);

    },

    phonepePaymentKey: function () {
        var loader = $(".loader-qrsetting");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/phonepepaymentsKey',
            data: JSON.stringify({
                merchantId: $('#phonepe_merchant_id').val(),
                saltKey: $('#phonepe_salt_key').val(),
                status: ($('#phonepe_payment_gateway').is(":checked")) ? 'true' : 'false'
            })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.alert(response.type, response.message);
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
PosnicPro.tax = {
    triggerModules: function () {
        PosnicPro.showAddModal('tax');
        $('#tax_id').val('');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#tax-heading').text('புதிய');
            $('#tax_text_change').text('சேமி');
        } else {
            $('#tax-heading').html('Add');
            $('#tax_text_change').text('Save');
        }
        var loader = $(".loader-tax");
        loader.find(".loadingSpinner:first").remove();
        $('#tax_reset').show();
        $('.tax_edit_reset').hide();
    },
    triggerTaxEdit: function (id) {
        var module = $('#setting_tax_edit_' + id);
        PosnicPro.showAddModal('tax');
        $('#tax_id').val(id);
        $('#tax_name').val(module.data('taxname'));
        $('#tax_value').val(module.data('taxvalue'));
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#tax-heading').text('திருத்தப்பட்ட') : $('#tax-heading').html('Edit');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#tax-heading').text('திருத்தப்பட்ட');
            $('#tax_text_change').text('புதுப்பி');
        } else {
            $('#tax-heading').html('Edit');
            $('#tax_text_change').text('Update');
        }
        $('#tax_reset').hide();
        $('.tax_edit_reset').show();
        $('.tax_edit_reset').attr("id", id);
        $('.mobile_tooltip').tooltip('hide');
    },
    triggerTaxDelete: function (id) {
        var module = $('#setting_tax_delete_' + id);
        $('#tax_id').val(id);
        $('#tax_name').val(module.data('taxname'));
        $('#tax_value').val(module.data('taxvalue'));
        PosnicPro.tax.deleteTaxData(id);
    },
    taxTable: function () {
        var loader = $(".loader-table-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.HideSideBarModal();
        var table = $('#view_tax');
        var data = {
            tax_group: 'no'
        };
        var params = {
            url: 'setting/getTaxAll',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {

                table.children('tbody').text('');
                data = response.data;
                let currency = PosnicPro.local.get('currencySign');
                for (var i = 0; i < data.length; i++) {
                    let row = data[i];
                    let edit = '<a href="#/settings/tax/' + row.tax_id + '/edit" id="setting_tax_edit_' + row.tax_id + '" data-toggle="tooltip" title="Edit Tax" class="btn btn-primary-rgba mb-1 mr-1 mobile_tooltip" data-module = "branch" data-access = "write" data-taxname="' + row.tax_name + '" data-taxvalue="' + row.tax_value + '" ><i class="feather icon-edit"></i></a>';
                    let deleted = '<a href="#/settings/tax/' + row.tax_id + '/delete" id="setting_tax_delete_' + row.tax_id + '" data-toggle="tooltip" title="Delete Tax" class="btn btn-danger-rgba mb-1 mr-1 mobile_tooltip" data-module = "branch" data-access = "delete" data-taxname="' + row.tax_name + '" data-taxvalue="' + row.tax_value + '" ><i class="feather icon-trash"></i></a>';
                    let trow = '<tr> <td scope="row" width="10%">' + (i + 1) + '</td>  <td width="40%">' + row.tax_name + '</td> <td width="10%" class="text-right">' + currency + '&nbsp;<span class="number">' + row.tax_value + '</span></td><td width="40%" class="text-center">' + edit + ' ' + deleted + '</td> </tr>';
                    $('#view_tax').children('tbody').append(trow);
                }
                $('span.number').number(true, 2);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    addTaxRates: function () {
        if ($('#tax_name').val() !== '' && $('#tax_value').val() !== '') {
            var loader = $(".loader-tax");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var params = {
                url: 'setting/addTax',
                data: JSON.stringify(PosnicPro.getFormData($('#tax_add_form')))
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    $("#tax_add_form").trigger("reset");
                    $('#tax_name').focus();
                    PosnicPro.tax.taxTable();
                    PosnicPro.getBranchTaxList();
                    hasher.setHash('settings');
                    loader.find(".loadingSpinner:first").remove();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    editTaxRates: function () {
        var loader = $(".loader-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/editTax',
            data: JSON.stringify(PosnicPro.getFormData($('#tax_add_form')))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.tax.taxTable();
                PosnicPro.getBranchTaxList();
                $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                hasher.setHash('settings');
            }
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        $('.mobile_tooltip').tooltip('hide');
    },
    resetEditButton: function (id) {
        PosnicPro.tax.triggerTaxEdit(id);
    },
    deleteTaxData: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            PosnicPro.delete('setting/deleteTax?id=' + id, function (response) {
                if (response.type === 'success') {
                    PosnicPro.deleteConfirmation = false;
                    $("#tax_add_form").trigger("reset");
                    PosnicPro.tax.taxTable();
                    PosnicPro.getBranchTaxList();
                    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                    $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deleteTaxData',
                arguments: id
            };
            $('#delete_tax_modal').modal('show');
            $('#show_hide_tax').show();
            $('#show_hide_taxgroup').hide();
        }
        $('.mobile_tooltip').tooltip('hide');
    },
    /*delete tax confirmation*/
    deleteTaxConfirmed: function () {
        $('#delete_tax_modal').modal('hide');
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['tax']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },
    taxClearForm: function () {
        $("#tax_add_form").trigger("reset");
        $('.error_tax').css('display', 'none');
    }

};
PosnicPro.unit = {
    triggerModules: function () {
        PosnicPro.showAddModal('unit');
        $('#unit_id').val('');
        $('#unit_name').val('');
        $('#unit_value').val('');
        $('.error_unit').css('display', 'none');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#unit-heading').text('புதிய');
            $('#unit_text_change').text('சேமி');
        } else {
            $('#unit-heading').html('Add');
            $('#unit_text_change').text('Save');
        }
        var loader = $(".loader-tax");
        loader.find(".loadingSpinner:first").remove();
        $('#unit_reset').show();
        $('.unit_edit_reset').hide();
    },
    unitTable: function () {
        var table = $('#view_unit');
        var params = {
            url: 'setting/getUnitAll'
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                table.children('tbody').text('');
                var data = response.data;
                for (var i = 0; i < data.length; i++) {
                    let row = data[i];
                    let edit = '<a href="#/settings/unit/' + row.unit_id + '/edit" id="setting_unit_edit_' + row.unit_id + '" data-toggle="tooltip" title="Edit Unit" class="btn btn-primary-rgba mb-1 mr-1 mobile_tooltip" data-module = "branch" data-access = "write" data-unitname="' + row.unit_name + '" data-unitvalue="' + row.unit_value + '" ><i class="feather icon-edit"></i></a>';
                    let deleted = '<a href="#/settings/unit/' + row.unit_id + '/delete" id="setting_unit_delete_' + row.unit_id + '" data-toggle="tooltip" title="Delete Unit" class="btn btn-danger-rgba mb-1 mr-1 mobile_tooltip" data-module = "branch" data-access = "delete" data-unitname="' + row.unit_name + '" data-unitvalue="' + row.unit_value + '" ><i class="feather icon-trash"></i></a>';
                    let trow = '<tr> <td scope="row" width="10%">' + (i + 1) + '</td>  <td width="40%">' + row.unit_name + '</td> <td width="10%" class="text-right"><span>' + row.unit_value + '</span></td><td width="40%" class="text-center">' + edit + ' ' + deleted + '</td> </tr>';
                    $('#view_unit').children('tbody').append(trow);
                }
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    triggerUnitEdit: function (id) {
        var module = $('#setting_unit_edit_' + id);
        PosnicPro.showAddModal('unit');
        $('#unit_id').val(id);
        $('#unit_name').val(module.data('unitname'));
        $('#unit_value').val(module.data('unitvalue'));
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#tax-heading').text('திருத்தப்பட்ட') : $('#tax-heading').html('Edit');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#unit-heading').text('திருத்தப்பட்ட');
            $('#unit_text_change').text('புதுப்பி');
        } else {
            $('#unit-heading').html('Edit');
            $('#unit_text_change').text('Update');
        }
        $('#unit_reset').hide();
        $('.unit_edit_reset').show();
        $('.unit_edit_reset').attr("id", id);
        $('.mobile_tooltip').tooltip('hide');
    },
    editUnitRates: function () {
        var params = {
            url: 'setting/editUnit',
            data: JSON.stringify(PosnicPro.getFormData($('#unit_add_form')))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                $("#unit_add_form").trigger("reset");
                PosnicPro.unit.unitTable();
                $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                PosnicPro.items.loadSelectUnit();
                hasher.setHash('settings');
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        $('.mobile_tooltip').tooltip('hide');
    },
    triggerUnitDelete: function (id) {
        var module = $('#setting_unit_delete_' + id);
        $('#unit_id').val(id);
        $('#unit_name').val(module.data('unitname'));
        $('#unit_value').val(module.data('unitvalue'));
        PosnicPro.unit.deleteUnitData(id);
    },
    deleteUnitData: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            PosnicPro.delete('setting/deleteUnit?id=' + id, function (response) {
                if (response.type === 'success') {
                    PosnicPro.deleteConfirmation = false;
                    $("#unit_add_form").trigger("reset");
                    PosnicPro.unit.unitTable();
                    PosnicPro.items.loadSelectUnit();
                    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                    $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deleteUnitData',
                arguments: id
            };
            $('#delete_unit_modal').modal('show');
            $('#show_hide_unit').show();
            hasher.setHash('settings');
        }
        $('.mobile_tooltip').tooltip('hide');
    },
    deleteUnitConfirmed: function () {
        $('#delete_unit_modal').modal('hide');
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['unit']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },
    addUnitRates: function () {
        if ($('#unit_name').val() !== '' && $('#unit_value').val() !== '') {
            var params = {
                url: 'setting/addUnit',
                data: JSON.stringify(PosnicPro.getFormData($('#unit_add_form')))
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    $("#unit_add_form").trigger("reset");
                    $('#unit_name').focus();
                    PosnicPro.unit.unitTable();
                    PosnicPro.items.loadSelectUnit();
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    resetEditButton: function (id) {
        PosnicPro.unit.triggerUnitEdit(id);
    },
    unitClearForm: function () {
        $("#unit_add_form").trigger("reset");
        $('.error_unit').css('display', 'none');
    }
};
PosnicPro.denom = {
    triggerModules: function () {
        PosnicPro.showAddModal('denomcash');
        $('#denom_id').val('');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#denom-heading').text('புதிய');
            $('#denom_text_change').text('சேமி');
        } else {
            $('#denom-heading').html('Add');
            $('#denom_text_change').text('Save');
        }
        var loader = $(".loader-tax");
        loader.find(".loadingSpinner:first").remove();
        $('#denom_reset').show();
        $('.denom_edit_reset').hide();
    },
    triggerTaxEdit: function (id) {
        var module = $('#setting_denom_edit_' + id);
        PosnicPro.showAddModal('denomcash');
        $('#denom_id').val(id);
        $('#denom_value').val(module.data('denomvalue'));
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#tax-heading').text('திருத்தப்பட்ட') : $('#tax-heading').html('Edit');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#denom-heading').text('திருத்தப்பட்ட');
            $('#denom_text_change').text('புதுப்பி');
        } else {
            $('#denom-heading').html('Edit');
            $('#denom_text_change').text('Update');
        }
        $('#denom_reset').hide();
        $('.denom_edit_reset').show();
        $('.denom_edit_reset').attr("id", id);
        $('.mobile_tooltip').tooltip('hide');
    },
    triggerTaxDelete: function (id) {
        PosnicPro.denom.deleteDenomField(id);
    },
    denomTable: function () {
        var loader = $(".loader-table-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.HideSideBarModal();
        var table = $('#view_denom');
        var params = {
            url: 'setting/getDenomAll'
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                table.children('tbody').text('');
                var data = response.data;
                let currency = PosnicPro.local.get('currencySign');
                // Reset cached sale denomination list before repopulating
                if (PosnicPro.sales) {
                    PosnicPro.sales.SaleDenomination = [];
                }
                for (var i = 0; i < data.length; i++) {
                    let row = data[i];
                    let edit = '<a href="#/settings/denom/' + row.denom_id + '/edit" id="setting_denom_edit_' + row.denom_id + '" data-toggle="tooltip" title="Edit Denom" class="btn btn-primary-rgba mobile_tooltip mb-1 mr-1" data-module = "branch" data-access = "write" data-denomvalue="' + row.denom_value + '" ><i class="feather icon-edit"></i></a>';
                    let deleted = '<a href="#/settings/denom/' + row.denom_id + '/delete" id="setting_denom_delete_' + row.denom_id + '" data-toggle="tooltip" title="Delete Denom" class="btn btn-danger-rgba mobile_tooltip mb-1 mr-1" data-module = "branch" data-access = "delete" data-denomvalue="' + row.denom_value + '" ><i class="feather icon-trash"></i></a>';
                    let trow = '<tr> <td scope="row" width="10%">' + (i + 1) + '</td><td width="10%" class="text-right">' + currency + '&nbsp;<span class="number">' + row.denom_value + '</span></td><td width="40%" class="text-center">' + edit + ' ' + deleted + '</td> </tr>';
                    $('#view_denom').children('tbody').append(trow);
                    PosnicPro.sales.SaleDenomination[i] = {
                        id: row.denom_id,
                        amount: row.denom_value
                    };

                }
                $('span.number').number(true, 2);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    addDenomField: function () {
        if ($('#denom_value').val() !== '') {
            var loader = $(".loader-tax");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var params = {
                url: 'setting/addDenomData',
                data: JSON.stringify(PosnicPro.getFormData($('#denom_add_form')))
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.denom.denomClearForm();
                    PosnicPro.denom.denomTable();
                    hasher.setHash('settings');
                    loader.find(".loadingSpinner:first").remove();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    editDenomField: function () {
        var loader = $(".loader-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/editDenomForm',
            data: JSON.stringify(PosnicPro.getFormData($('#denom_add_form')))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.denom.denomTable();
                PosnicPro.getBranchTaxList();
                $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                hasher.setHash('settings');
            }
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert(response.type, response.message);
            $('.mobile_tooltip').tooltip('hide');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    deleteDenomField: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            PosnicPro.delete('setting/deleteDenom?id=' + id, function (response) {
                if (response.type === 'success') {
                    PosnicPro.deleteConfirmation = false;
                    $("#denom_add_form").trigger("reset");
                    PosnicPro.denom.denomTable();
                    PosnicPro.getBranchTaxList();
                    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                    $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deleteDenomField',
                arguments: id
            };
            $('#delete_denom_modal').modal('show');
        }
        $('.mobile_tooltip').tooltip('hide');
    },
    deleteDenomConfirmed: function () {
        $('#delete_denom_modal').modal('hide');
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['denom']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },
    denomClearForm: function () {
        $("#denom_add_form").trigger("reset");
    },
    resetEditButton: function (id) {
        PosnicPro.denom.triggerTaxEdit(id);
    }

};

PosnicPro.tableOrders = {
    currentPage: 1,
    perPage: 10,
    totalItems: 0,
    totalPages: 0,
    allData: [],
    
    showAdd: function () {
        PosnicPro.tableOrders.triggerModules();
    },
    triggerModules: function () {
        PosnicPro.showAddModal('tableorder');
        $('#tableorder_id').val('');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#tableorder-heading').text('புதிய');
            $('#tableorder_text_change').text('சேமி');
        } else {
            $('#tableorder-heading').html('Add');
            $('#tableorder_text_change').text('Save');
        }
        var loader = $(".loader-tax");
        loader.find(".loadingSpinner:first").remove();
        $('#tableorder_reset').show();
        $('.tableorder_edit_reset').hide();
    },
    triggerTaxEdit: function (id) {
        var module = $('#setting_tableorder_edit_' + id);
        PosnicPro.showAddModal('tableorder');
        $('#tableorder_id').val(id);
        $('#tableorder_value').val(module.data('tableordervalue'));
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#tableorder-heading').text('திருத்தப்பட்ட');
            $('#tableorder_text_change').text('புதுப்பி');
        } else {
            $('#tableorder-heading').html('Edit');
            $('#tableorder_text_change').text('Update');
        }
        $('#tableorder_reset').hide();
        $('.tableorder_edit_reset').show();
        $('.tableorder_edit_reset').attr("id", id);
        $('.mobile_tooltip').tooltip('hide');
    },
    triggerTaxDelete: function (id) {
        PosnicPro.tableOrders.deleteTableOrderField(id);
    },
    tableOrdersTable: function () {
        var loader = $(".loader-table-tableorder");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.HideSideBarModal();
        var table = $('#view_tableorder');
        var params = {
            url: 'setting/getTableOrderAll'
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.tableOrders.allData = response.data;
                PosnicPro.tableOrders.totalItems = response.data.length;
                PosnicPro.tableOrders.perPage = parseInt($('#view_tableorder_per_page').val()) || 10;
                PosnicPro.tableOrders.renderPage();
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
                loader.find(".loadingSpinner:first").remove();
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
            loader.find(".loadingSpinner:first").remove();
        });
    },
    
    renderPage: function() {
        var table = $('#view_tableorder');
        table.children('tbody').text('');
        
        var perPage = PosnicPro.tableOrders.perPage;
        var currentPage = PosnicPro.tableOrders.currentPage;
        var totalItems = PosnicPro.tableOrders.totalItems;
        var data = PosnicPro.tableOrders.allData;
        
        // Calculate pagination values
        var totalPages = Math.ceil(totalItems / perPage);
        PosnicPro.tableOrders.totalPages = totalPages;
        
        var startIndex = (currentPage - 1) * perPage;
        var endIndex = Math.min(startIndex + perPage, totalItems);
        
        // Update pagination info
        $('#view_tableorder_showing_from').text(totalItems > 0 ? startIndex + 1 : 0);
        $('#view_tableorder_showing_to').text(endIndex);
        $('#view_tableorder_total').text(totalItems);
        
        // Render table rows for current page
        for (var i = startIndex; i < endIndex; i++) {
            let row = data[i];
            let edit = '<a href="#/settings/tableorder/' + row.tableorder_id + '/edit" id="setting_tableorder_edit_' + row.tableorder_id + '" data-toggle="tooltip" title="Edit Table Order" class="btn btn-primary-rgba mobile_tooltip mb-1 mr-1" data-module="branch" data-access="write" data-tableordervalue="' + row.tableorder_value + '" ><i class="feather icon-edit"></i></a>';
            let deleted = '<a href="#/settings/tableorder/' + row.tableorder_id + '/delete" id="setting_tableorder_delete_' + row.tableorder_id + '" data-toggle="tooltip" title="Delete Table Order" class="btn btn-danger-rgba mobile_tooltip mb-1 mr-1" data-module="branch" data-access="delete" data-tableordervalue="' + row.tableorder_value + '" ><i class="feather icon-trash"></i></a>';
            let trow = '<tr><td scope="row" width="10%">' + (i + 1) + '</td><td width="10%" class="text-right">' + row.tableorder_value + '</td><td width="40%" class="text-center">' + edit + ' ' + deleted + '</td></tr>';
            table.children('tbody').append(trow);
        }
        
        // Store tables list for sales module
        PosnicPro.sales.tablesList = data.map(function(row) {
            return {
                id: row.tableorder_id,
                tableNumber: row.tableorder_value
            };
        });
        
        // Update pagination buttons
        PosnicPro.tableOrders.updatePaginationButtons();
        
        // Initialize tooltips
        $('[data-toggle="tooltip"]').tooltip();
        $('span.number').number(true, 2);
    },
    
    updatePaginationButtons: function() {
        var currentPage = PosnicPro.tableOrders.currentPage;
        var totalPages = PosnicPro.tableOrders.totalPages;
        
        // Update prev/next button states
        if (currentPage <= 1) {
            $('#tableorder_prev_page').addClass('disabled');
        } else {
            $('#tableorder_prev_page').removeClass('disabled');
        }
        
        if (currentPage >= totalPages) {
            $('#tableorder_next_page').addClass('disabled');
        } else {
            $('#tableorder_next_page').removeClass('disabled');
        }
        
        // Generate page number buttons
        var pagination = $('#view_tableorder_pagination');
        pagination.find('.page-number').remove();
        
        var maxButtons = 5;
        var startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        var endPage = Math.min(totalPages, startPage + maxButtons - 1);
        
        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }
        
        for (var i = startPage; i <= endPage; i++) {
            var activeClass = (i === currentPage) ? 'active' : '';
            var pageBtn = '<li class="page-item page-number ' + activeClass + '">' +
                          '<a class="page-link" href="javascript:void(0)" onclick="PosnicPro.tableOrders.goToPage(' + i + ')">' + i + '</a>' +
                          '</li>';
            $(pageBtn).insertBefore('#tableorder_next_page');
        }
    },
    
    changePerPage: function() {
        PosnicPro.tableOrders.perPage = parseInt($('#view_tableorder_per_page').val());
        PosnicPro.tableOrders.currentPage = 1;
        PosnicPro.tableOrders.renderPage();
    },
    
    previousPage: function() {
        if (PosnicPro.tableOrders.currentPage > 1) {
            PosnicPro.tableOrders.currentPage--;
            PosnicPro.tableOrders.renderPage();
        }
    },
    
    nextPage: function() {
        if (PosnicPro.tableOrders.currentPage < PosnicPro.tableOrders.totalPages) {
            PosnicPro.tableOrders.currentPage++;
            PosnicPro.tableOrders.renderPage();
        }
    },
    
    goToPage: function(page) {
        if (page >= 1 && page <= PosnicPro.tableOrders.totalPages) {
            PosnicPro.tableOrders.currentPage = page;
            PosnicPro.tableOrders.renderPage();
        }
    },
    addTableOrderField: function () {
        if ($('#tableorder_value').val() !== '') {
            var loader = $(".loader-tax");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var params = {
                url: 'setting/addTableOrderData',
                data: JSON.stringify(PosnicPro.getFormData($('#tableorder_add_form')))
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.tableOrders.tableOrdersClearForm();
                    PosnicPro.tableOrders.currentPage = 1;
                    PosnicPro.tableOrders.tableOrdersTable();
                    hasher.setHash('settings');
                    loader.find(".loadingSpinner:first").remove();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    editTableOrderField: function () {
        var loader = $(".loader-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/editTableOrderForm',
            data: JSON.stringify(PosnicPro.getFormData($('#tableorder_add_form')))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.tableOrders.tableOrdersTable();
                $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                $("#infobar-settings-sidebar-tableorder").removeClass("sidebarshow");
                hasher.setHash('settings');
            }
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert(response.type, response.message);
            $('.mobile_tooltip').tooltip('hide');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    deleteTableOrderField: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            PosnicPro.delete('setting/deleteTableOrder?id=' + id, function (response) {
                if (response.type === 'success') {
                    PosnicPro.deleteConfirmation = false;
                    $("#tableorder_add_form").trigger("reset");
                    PosnicPro.tableOrders.currentPage = 1;
                    PosnicPro.tableOrders.tableOrdersTable();
                    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                    $("#infobar-settings-sidebar-tableorder").removeClass("sidebarshow");
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deleteTableOrderField',
                arguments: id
            };
            $('#delete_table_order_modal').modal('show');
        }
        $('.mobile_tooltip').tooltip('hide');
    },
    deleteTableOrderConfirmed: function () {
        $('#delete_table_order_modal').modal('hide');
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['tableOrders']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },
    tableOrdersClearForm: function () {
        $("#tableorder_add_form").trigger("reset");
    },
    resetEditButton: function (id) {
        PosnicPro.tableOrders.triggerTaxEdit(id);
    }

};

PosnicPro.tableorder = PosnicPro.tableOrders;

PosnicPro.payment = {
    triggerModules: function () {
        PosnicPro.showAddModal('payment');
        $('.payment_id').val('');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#payment-heading').text('புதிய');
            $('#payment_text_change').text('சேமி');
        } else {
            $('#payment-heading').html('Add');
            $('#payment_text_change').text('Save');
        }
        var loader = $(".loader-tax");
        loader.find(".loadingSpinner:first").remove();
        $('#payment_reset').show();
        $('.payment_edit_reset').hide();
    },
    triggerTaxEdit: function (id) {
        var module = $('#setting_payment_edit_' + id);
        PosnicPro.showAddModal('payment');
        $('.payment_id').val(id);
        $('#payment_value').val(module.data('paymentvalue'));
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#tax-heading').text('திருத்தப்பட்ட') : $('#tax-heading').html('Edit');
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#payment-heading').text('திருத்தப்பட்ட');
            $('#payment_text_change').text('புதுப்பி');
        } else {
            $('#payment-heading').html('Edit');
            $('#payment_text_change').text('Update');
        }
        $('#payment_reset').hide();
        $('.payment_edit_reset').show();
        $('.payment_edit_reset').attr("id", id);
        $('.mobile_tooltip').tooltip('hide');
    },
    triggerTaxDelete: function (id) {
        PosnicPro.payment.deletePaymentField(id);
    },
    paymentTable: function () {
        PosnicPro.configPaymentType = [];
        var loader = $(".loader-table-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_payment');
        var params = {
            url: 'setting/getPaymentAll'
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                table.children('tbody').text('');
                var data = response.data;
                for (var i = 0; i < data.length; i++) {
                    let row = data[i];
                    let edit = '<a href="#/settings/payment/' + row.payment_id + '/edit" id="setting_payment_edit_' + row.payment_id + '" data-toggle="tooltip" title="Edit Payment" class="btn btn-primary-rgba mobile_tooltip mb-1 mr-1" data-module = "branch" data-access = "write" data-paymentvalue="' + row.payment_value + '" ><i class="feather icon-edit"></i></a>';
                    let deleted = '<a href="#/settings/payment/' + row.payment_id + '/delete" id="setting_payment_delete_' + row.payment_id + '" data-toggle="tooltip" title="Delete Payment" class="btn btn-danger-rgba mobile_tooltip mb-1 mr-1" data-module = "branch" data-access = "delete" data-paymentvalue="' + row.payment_value + '" ><i class="feather icon-trash"></i></a>';
                    let trow = '<tr> <td scope="row" width="10%">' + (i + 1) + '</td><td width="10%" class="text-right">' + row.payment_value + '</td><td width="40%" class="text-center">' + edit + ' ' + deleted + '</td> </tr>';
                    $('#view_payment').children('tbody').append(trow);
                    PosnicPro.configPaymentType[i] = {
                        payment_value: row.payment_value
                    };
                }
                // Only refresh payment UI if we're on the sales page
                var currentHash = window.location.hash;
                if (currentHash && currentHash.includes('sales')) {
                    const multi_payment = PosnicPro.sales.EditRecentSaleParams.multi_payment || {};
                    var enableMulti = (PosnicPro.local.get('enable_multi_payment') === 'enable' || Object.keys(multi_payment).length !== 0);
                    if (enableMulti) {
                        PosnicPro.sales.showMultiPaymentMode();
                    } else {
                        PosnicPro.sales.showPaymentMode();
                    }
                }
                $('span.number').number(true, 2);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    addPaymentField: function () {
        if ($('#payment_value').val() !== '') {
            var loader = $(".loader-tax");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var params = {
                url: 'setting/addPaymentData',
                data: JSON.stringify(PosnicPro.getFormData($('#payment_add_form')))
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.payment.paymentTable();
                    PosnicPro.payment.paymentClearForm();
                    
                    // Check if tender sidebar is open (sales page context)
                    var isTenderOpen = $('#infobar-settings-sidebar-tender-details').hasClass('sidebarview');
                    
                    if (isTenderOpen) {
                        // Close only the payment modal, keep tender sidebar open
                        $('#infobar-settings-sidebar-payment').removeClass('sidebarshow');
                        $('.infobar-settings-sidebar-overlay').hide();
                    } else {
                        // Close the settings sidebar (settings page context)
                        $(".infobar-settings-close").trigger("click");
                    }
                    
                    loader.find(".loadingSpinner:first").remove();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    editPaymentField: function () {
        var loader = $(".loader-tax");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'setting/editPaymentForm',
            data: JSON.stringify(PosnicPro.getFormData($('#payment_add_form')))
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.payment.paymentClearForm();
                PosnicPro.payment.paymentTable();
                $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                hasher.setHash('settings');
            }
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert(response.type, response.message);
            $('.mobile_tooltip').tooltip('hide');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    deletePaymentField: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            PosnicPro.delete('setting/deletePayment?id=' + id, function (response) {
                if (response.type === 'success') {
                    PosnicPro.deleteConfirmation = false;
                    PosnicPro.payment.paymentTable();
                    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                    $("#infobar-settings-sidebar-tax").removeClass("sidebarshow");
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deletePaymentField',
                arguments: id
            };
            $('#delete_payment_modal').modal('show');
        }
        $('.mobile_tooltip').tooltip('hide');
    },
    deletePaymentConfirmed: function () {
        $('#delete_payment_modal').modal('hide');
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['payment']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },
    paymentClearForm: function () {
        $("#payment_add_form").trigger("reset");
    },
    resetEditButton: function (id) {
        PosnicPro.payment.triggerTaxEdit(id);
    }
};

PosnicPro.taxgroup = {
    triggerModules: function () {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#taxgroup-heading').text('புதிய') : $('#taxgroup-heading').html('Add');
        PosnicPro.showAddModal('taxgroup');
        $('#taxgroup_id').val('');
        //        $('#taxgroup_text_change').text('Save');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#taxgroup_text_change').text('சேமி') : $('#taxgroup_text_change').text('Save');
        $('#taxgroup_reset').show();
        $('.taxgroup_edit_reset').hide();
        var loader = $(".loader-taxgroup");
        loader.find(".loadingSpinner:first").remove();
        var table = $('#list_tax_rates');
        var data = {
            tax_group: 'no'
        };
        var params = {
            url: 'setting/getTaxAll',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                data = response.data;
                table.children('tbody').html('');
                for (var i = 0; i < data.length; i++) {
                    var row = data[i];
                    var trow = '<tr><td><input type="checkbox" class="tax_rates" name="tax_rates[' + row.tax_id + ']" data-taxid="' + row.tax_id + '" data-taxname="' + row.tax_name + '" data-taxvalue="' + row.tax_value + '"></td><td>' + row.tax_name + '</td><td>' + row.tax_value + '</td></tr>';
                    table.children('tbody').append(trow);
                }

            }
        });
    },
    triggerTaxEdit: function (id) {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#taxgroup-heading').text('திருத்தப்பட்ட') : $('#taxgroup-heading').html('Edit');
        PosnicPro.showAddModal('taxgroup');
        $('#taxgroup_id').val(id);
        //        $('#taxgroup_text_change').text('Update');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#taxgroup_text_change').text('புதுப்பி') : $('#taxgroup_text_change').text('Update');
        var loader = $(".loader-taxgroup");
        loader.find(".loadingSpinner:first").remove();
        $('#taxgroup_reset').hide();
        $('.taxgroup_edit_reset').show();
        $('.taxgroup_edit_reset').attr("id", id);
        var table = $('#list_tax_rates');
        var data = {
            tax_id: id
        };
        var params = {
            url: 'setting/getTaxGroup',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#taxgroup_name').val(response.data.name);
                data = response.data.getall;
                table.children('tbody').html('');
                for (var i = 0; i < data.length; i++) {
                    var row = data[i];
                    var trow = '<tr><td><input type="checkbox" id="tax_checked_id_' + row.tax_id + '" class="tax_rates" name="tax_rates[' + row.tax_id + ']" data-taxid="' + row.tax_id + '" data-taxname="' + row.tax_name + '" data-taxvalue="' + row.tax_value + '"></td><td>' + row.tax_name + '</td><td>' + row.tax_value + '</td></tr>';
                    table.children('tbody').append(trow);
                }
                var checkedid = response.data.checked;
                $(document).ready(function () {
                    for (var i = 0; i < checkedid.length; i++) {
                        var row = checkedid[i];
                        $('#tax_checked_id_' + row.checked_tax).prop('checked', true);
                        $('.mobile_tooltip').tooltip('hide');
                    }
                });
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        PosnicPro.taxgroup.triggerTaxEdit(id);
    },
    triggerTaxDelete: function (id) {
        PosnicPro.record_id = id;
        PosnicPro.taxgroup.deleteTaxGroupData(id);
    },
    taxgroupTable: function () {
        var loader = $(".loader-table-taxgroup");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.HideSideBarModal();
        var table = $('#view_taxgroup');
        var data = {
            tax_group: 'yes'
        };
        var params = {
            url: 'setting/getTaxAll',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                table.children('tbody').text('');
                data = response.data;
                let currency = PosnicPro.local.get('currencySign');
                for (var i = 0; i < data.length; i++) {
                    let row = data[i];
                    let edit = '<a href="#/settings/taxgroup/' + row.tax_id + '/edit" id="setting_taxgroup_edit_' + row.tax_id + '" data-toggle="tooltip" title="Edit Tax" class="btn btn-primary-rgba mobile_tooltip mb-1 mr-1" data-module = "branch" data-access = "write"><i class="feather icon-edit"></i></a>';
                    let deleted = '<a href="#/settings/taxgroup/' + row.tax_id + '/delete" id="setting_taxgroup_delete_' + row.tax_id + '" data-toggle="tooltip" title="Delete Tax" class="btn btn-danger-rgba mobile_tooltip mb-1 mr-1" data-module = "branch" data-access = "delete"><i class="feather icon-trash"></i></a>';
                    let trow = '<tr> <td scope="row" width="10%">' + (i + 1) + '</td>  <td width="40%">' + row.tax_name + '</td> <td width="10%" class="text-right">' + currency + '&nbsp;<span class="number">' + row.tax_value + '</span></td><td width="40%" class="text-center">' + edit + ' ' + deleted + '</td> </tr>';
                    table.children('tbody').append(trow);
                }
                $('span.number').number(true, 2);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    addTaxgroupRates: function () {
        if ($('#taxgroup_name').val() !== '') {
            var loader = $(".loader-taxgroup");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var taxData = [];
            var el = $('.tax_rates');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var taxid = $(el[i]).data("taxid");
                    var taxname = $(el[i]).data("taxname");
                    var taxvalue = $(el[i]).data("taxvalue");
                    taxData.push({ tax_id: taxid, tax_name: taxname, tax_value: taxvalue });
                }
            }

            var params = {
                url: 'setting/addTaxGroup',
                data: JSON.stringify({
                    tax_id: $('#taxgroup_id').val(),
                    tax_name: $('#taxgroup_name').val(),
                    tax_fields: taxData
                })
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    $("#taxgroup_add_form").trigger("reset");
                    $('#taxgroup_name').focus();
                    PosnicPro.taxgroup.taxgroupTable();
                    PosnicPro.getBranchTaxList();
                    hasher.setHash('settings');
                    loader.find(".loadingSpinner:first").remove();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    editTaxgroupRates: function () {
        var loader = $(".loader-taxgroup");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var taxData = [];
        var el = $('.tax_rates');
        for (var i = 0; i < el.length; i++) {
            if ($(el[i]).is(":checked")) {
                var taxid = $(el[i]).data("taxid");
                var taxname = $(el[i]).data("taxname");
                var taxvalue = $(el[i]).data("taxvalue");
                taxData.push({ tax_id: taxid, tax_name: taxname, tax_value: taxvalue });
            }
        }

        var params = {
            url: 'setting/editTaxGroup',
            data: JSON.stringify({
                tax_id: $('#taxgroup_id').val(),
                tax_name: $('#taxgroup_name').val(),
                tax_fields: taxData
            })
        };
        PosnicPro.put(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.taxgroup.taxgroupTable();
                PosnicPro.getBranchTaxList();
                $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                $("#infobar-settings-sidebar-taxgroup").removeClass("sidebarshow");
                hasher.setHash('settings');
            }
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    deleteTaxGroupData: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            PosnicPro.delete('setting/deleteTaxGroup?id=' + id, function (response) {
                if (response.type === 'success') {
                    PosnicPro.deleteConfirmation = false;
                    PosnicPro.taxgroup.taxgroupTable();
                    PosnicPro.getBranchTaxList();
                    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
                    $("#infobar-settings-sidebar-taxgroup").removeClass("sidebarshow");
                    hasher.setHash('settings');
                }
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deleteTaxGroupData',
                arguments: id
            };
            $('#delete_tax_modal').modal('show');
            $('#show_hide_tax').hide();
            $('#show_hide_taxgroup').show();
        }
        $('.mobile_tooltip').tooltip('hide');
    },
    /*delete tax confirmation*/
    deleteTaxConfirmed: function () {
        $('#delete_tax_modal').modal('hide');
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['taxgroup']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },
    taxgroupClearForm: function () {
        $("#taxgroup_add_form").trigger("reset");
        $('.error_taxgroup').css('display', 'none');
    }
};

PosnicPro.kiosk = {
    // Function to handle file input change and preview
    handleFileChange: function (inputId, previewId) {
        $("#" + inputId).change(function () {
            var file = this.files[0];
            var fileSize = file.size;
            var validExtensions = ['gif', 'jpg', 'png', 'jpeg', 'bmp'];
            var fileName = file.name;
            var fileNameExt = fileName.substr(fileName.lastIndexOf('.') + 1).toLowerCase();

            if (fileSize < 5242880) { // 5MB limit
                if ($.inArray(fileNameExt, validExtensions) === -1) {
                    $("#" + inputId).val(''); // Clear the input
                    PosnicPro.alert('error', "Only these file types are accepted: " + validExtensions.join(', '));
                } else {
                    // Show image preview
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        $("#" + previewId).attr("src", e.target.result).show();
                    };
                    reader.readAsDataURL(file);
                }
            } else {
                $("#" + inputId).val(''); // Clear the input
                PosnicPro.alert('error', "File size should be less than 5MB!");
            }
        });
    },
    submitKioskImages: function () {
        var logoValue = $('#kiosk_logo').val();
        var bannerValue = $('#kiosk_banner').val();
        var homeBannerValue = $('#kiosk_homebanner').val();
        var advertisementValue = $('#kiosk_advertisement').val();

        if (logoValue || bannerValue || homeBannerValue || advertisementValue) {
            var loader = $(".loader-view-kioskimage");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var formData = new FormData(document.getElementById("kiosk_settings_form"));

            PosnicPro.requestImage('POST', "setting/updateKioskImages", formData, false, function (response) {
                if (response.type === 'success') {
                    // Update the image preview dynamically based on the response data
                    if (response.data.logo) {
                        $('#preview_logo').attr('src', response.data.logo).show();
                    }
                    if (response.data.banner) {
                        $('#preview_banner').attr('src', response.data.banner).show();
                    }
                    if (response.data.homebanner) {
                        $('#preview_homebanner').attr('src', response.data.homebanner).show();
                    }
                    if (response.data.advertisement) {
                        $('#preview_advertisement').attr('src', response.data.advertisement).show();
                    }

                    PosnicPro.alert('success', response.message);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
                loader.find(".loadingSpinner:first").remove();
            });
        }
    },
    removeImage: function (type) {
        let imageUrl = "";

        if (type === "logo") {
            imageUrl = $("#preview_logo").attr("src");
        } else if (type === "banner") {
            imageUrl = $("#preview_banner").attr("src");
        } else if (type === "advertisement") {
            imageUrl = $("#preview_advertisement").attr("src");
        } else {
            imageUrl = $("#preview_homebanner").attr("src");
        }

        // Check if an actual image URL is there before deleting
        if (imageUrl) {
            var params = {
                url: 'setting/branchImageDelete',
                data: JSON.stringify({ data: image_value })
            };
            PosnicPro.delete(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.kiosk.removeImagePreview(type); // Hide preview after deletion
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            PosnicPro.kiosk.removeImagePreview(type);
        }
    },
    // Function to remove image preview
    removeImagePreview: function (type) {
        if (type === 'logo') {
            $("#preview_logo").attr("src", "//:0").hide();
        } else if (type === 'banner') {
            $("#preview_banner").attr("src", "//:0").hide();
        } else if (type === 'advertisement') {
            $("#preview_advertisement").attr("src", "//:0").hide();
        } else {
            $("#preview_homebanner").attr("src", "//:0").hide();
        }
    }

};
$("#kiosk_settings_form").submit(function (event) {
    event.preventDefault();
    PosnicPro.kiosk.submitKioskImages();
});
$("#radio_discount_amount, #radio_discount_percentage").change(function () {
    if ($("#radio_discount_amount").is(":checked")) {
        $('#discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
        $('#discount_amount').removeAttr('disabled', 'disabled').show().focus().select();
    } else {
        $('#discount_amount').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
        $('#discount_percentage').removeAttr('disabled', 'disabled').show().focus().select();
    }
});
$(function () {
    $('.hide-recyclebin').hide();
    var $backupSelect = $('#backuptablelist');
    if ($backupSelect.length) {
        PosnicPro.settings.changeInputFieldsValueBackupTable($backupSelect[0]);
    }
    /*
     * Test print, using whatever is selected right now.
     *
     * Delegated, because the settings page is loaded into the shell after this
     * script runs and a direct binding would find nothing to bind to.
     *
     * The width is taken from the form rather than from saved settings, so
     * somebody can try 58 and 80 and keep the one that fits without saving a
     * wrong value in between.
     */

    // The printer and paper controls moved to Hardware Manager, a separate
    // window the desktop app owns. This is the way through to it.
    $(document).on('click', '#open_hardware_manager', function () {
        if (window.electronAPI && window.electronAPI.desktop) {
            window.electronAPI.desktop.open('hardware');
        } else {
            PosnicPro.alert('warning',
                'Hardware Manager is part of the desktop app. Open Posnic on the till to set the printer.');
        }
    });

    $('.custom_default_value_search').on('keydown.autocomplete', function () {
        var module = $(this).data('id');
        $(this).autocomplete({
            lookup: function (query, done) {
                var result = {};
                var suggestions = [];
                var params = {
                    url: 'base/getDefaultSuggest',
                    data: 'query=' + query + '&module=' + module
                };
                PosnicPro.get(params, function (response) {
                    if (response.suggestions.length > 0) {
                        suggestions: $.map(response.suggestions, function (dataItem) {
                            suggestions.push({ "value": dataItem.name, "data": dataItem });
                        });
                    } else {
                        suggestions.push({ value: query + ' ', data: -1 });
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
                    $('#' + module + '_default_value').val(suggestion.data.id);
                } else {
                    if (module === 'customers') {
                        hasher.setHash('settings/default/customer');
                    } else {
                        hasher.setHash('settings/default/supplier');
                    }

                }
            },
            autoSelectFirst: true,
            triggerSelectOnValidInput: false,
            formatResult: function (suggestion) {
                var phone = suggestion.data.phone;
                if (suggestion.data === -1 || typeof suggestion.phone === undefined) {
                    phone = "( Add new )";
                }
                return '<div>' +
                    $.Autocomplete.formatResult(suggestion) +
                    '</div><span class="pull-right" style="margin-top:-20px;">' + phone + '</span>';
            }
        });
    });
});
// validate submit
$("#sms_setting").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {

        way2sms_userid: {
            required: true,
            phone: true,
            minlength: 3,
            maxlength: 20
        },
        way2sms_password: {
            required: true,
            maxlength: 50
        },
        way2sms_api: {
            required: true,
            maxlength: 100
        }

    },
    messages: {

        way2sms_userid: {
            required: "Enter the user ID",
            maxlength: "User id should not be more than 20 digits"
        },
        way2sms_password: {
            required: "Enter a password",
            maxlength: "Password should not be more than 50 digits"
        },
        way2sms_api: {
            required: "Enter the API key",
            maxlength: "API should not be more than 100 characters"
        }
    }
});
$("#sms_setting").submit(function (event) {
    event.preventDefault();
    if ($('#sms_setting').valid()) {            // checks form for validity
        PosnicPro.settings.way2smsSettings();
    }
});
// validate submit
$("#textlocal_setting").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {

        textlocal_sender: {
            required: true,
            maxlength: 20
        },
        textlocal_api: {
            required: true,
            maxlength: 100
        }

    },
    messages: {

        textlocal_sender: {
            required: "Enter the sender name",
            maxlength: "Sender name should not be more than 20 characters"
        },
        textlocal_api: {
            required: "Enter the API key",
            maxlength: "API should not be more than 100 characters"
        }
    }
});
$("#textlocal_setting").submit(function (event) {
    event.preventDefault();
    if ($('#textlocal_setting').valid()) {            // checks form for validity
        PosnicPro.settings.textlocalsmsSettings();
    }
});
$("#setting_add").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        store_name: {
            required: true,
            minlength: 3,
            maxlength: 250
        },
        store_telephone: {
            required: true,
            minlength: 3,
            maxlength: 20,
            setting_phone_number: true
        },
        store_email: {
            required: true,
            email: true,
            emailExt: true,
            maxlength: 250
        },
        store_address: {
            required: true,
            minlength: 3,
            maxlength: 500
        },
        printing_address: {
            required: true,
            minlength: 3,
            maxlength: 500
        },
        website: {
            url: true,
            minlength: 3,
            maxlength: 50
        },
        city: {
            maxlength: 50
        },
        pincode: {
            maxlength: 15
        },
        branch_gstin_number: {
            gst: true,
            minlength: 15,
            maxlength: 15
        }
    },
    messages: {
        store_name: {
            required: "Enter the shop name",
            maxlength: "Store name should not be more than 250 characters"
        },
        store_telephone: {
            required: "Enter the phone number",
            setting_phone_number: "Enter a valid phone number",
            minlength: "Use at least 3 characters",
            maxlength: "Use no more than 20 characters"
        },
        store_email: {
            required: "Enter a valid email address",
            maxlength: "Email should not be more than 250 digits"
        },
        store_address: {
            required: "Enter the shop address",
            minlength: "Store Address must be Atleast 3 Characters long",
            maxlength: "Address is too Long !"
        },
        printing_address: {
            required: "Enter the address to print on receipts",
            minlength: "Printing Address must be Atleast 3 Characters long",
            maxlength: "Address is too Long !"
        },
        website: {
            required: "Enter a valid web address",
            minlength: "Website must be Atleast 3 Characters long",
            maxlength: "Website should not be more than 50 digits"
        },
        city: {
            maxlength: "Place should not be more than 50 digits"
        },
        pincode: {
            maxlength: "Place should not be more than 15 digits"
        },
        branch_gstin_number: {
            minlength: "Gstr must be Atleast 15 Characters long",
            maxlength: "Gstr should not be more than 15 digits"
        }
    }
});
jQuery.validator.addMethod("setting_phone_number", function (phone_number, element) {
    let valid = PosnicPro.settings.store_telephone.isValidNumber();
    let num = PosnicPro.settings.store_telephone.getNumber();
    if (valid === true) {
        $('#store_telephone').val(num);
        return true;
    } else {
        return false;
    }

}, "Enter a valid phone number");
jQuery.validator.addMethod("gst", function (value, element) {
    if (value !== '') {
        return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(value);
    }
    return true;
}, "Enter a valid GSTIN");
$("#setting_add").submit(function (event) {
    event.preventDefault();
    if ($('#setting_add').valid()) {          // checks form for validity
        PosnicPro.settings.generalSetting();
    }
});
$("#setting_image_add").submit(function (event) {
    event.preventDefault();
    PosnicPro.settings.settingImageFormSubmit();
});
$("#tax_add_form").validate({
    errorClass: 'error error_tax',
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        tax_name: {
            required: true,
            minlength: 3,
            maxlength: 20
        },
        tax_value: {
            required: true,
            minlength: 1,
            maxlength: 5
        }
    },
    messages: {
        tax_name: {
            required: "Enter the tax name",
            minlength: "Tax name must be at least 3 characters",
            maxlength: "Tax name should not be more than 100 characters"
        },
        tax_value: {
            required: "Enter the tax rate",
            minlength: "Tax value must be at least 1 characters",
            maxlength: "Tax value should not be more than 5 characters"
        }
    }
});
$("#unit_add_form").validate({
    errorClass: 'error error_unit',
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        unit_name: {
            required: true,
            minlength: 1,
            maxlength: 10,
            lettersonly: true
        },
        unit_value: {
            required: true,
            minlength: 1,
            maxlength: 10,
            lettersonly: true
        }
    },
    messages: {
        unit_name: {
            required: "Enter the unit name",
            minlength: "Unit name must be at least 1 characters",
            maxlength: "Unit name should not be more than 10 characters"
        },
        unit_value: {
            required: "Enter the unit short form",
            minlength: "Unit value must be at least 1 characters",
            maxlength: "Unit value should not be more than 10 characters"
        }
    }
});
jQuery.validator.addMethod("lettersonly", function (value, element) {
    return this.optional(element) || /^[a-z\s]+$/i.test(value);
}, "Use letters only");
$("#denom_add_form").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        denom_value: {
            required: true,
            minlength: 1
        }
    },
    messages: {
        denom_value: {
            required: "Enter a cash amount",
            minlength: "value must be at least 1 characters"
        }
    }
});
$("#payment_add_form").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        payment_value: {
            required: true,
            minlength: 1,
            maxlength: 12
        }
    },
    messages: {
        payment_value: {
            required: "Enter a payment amount",
            minlength: "value must be at least 1 characters",
            maxlength: "value should not be more than 12 characters"
        }
    }
});
$("#tax_add_form").submit(function (event) {
    event.preventDefault();
    if ($('#tax_add_form').valid()) {            // checks form for validity
        if ($('#tax_id').val() !== '') {
            PosnicPro.tax.editTaxRates();
        } else {
            PosnicPro.tax.addTaxRates();
        }
    }
});
$("#unit_add_form").submit(function (event) {
    event.preventDefault();
    if ($('#unit_add_form').valid()) {            // checks form for validity
        if ($('#unit_id').val() !== '') {
            PosnicPro.unit.editUnitRates();
        } else {
            PosnicPro.unit.addUnitRates();
        }
    }
});
$("#denom_add_form").submit(function (event) {
    event.preventDefault();
    if ($('#denom_add_form').valid()) {            // checks form for validity
        if ($('#denom_id').val() !== '') {
            PosnicPro.denom.editDenomField();
        } else {
            PosnicPro.denom.addDenomField();
        }
    }
});
$("#payment_add_form").submit(function (event) {
    event.preventDefault();
    if ($('#payment_add_form').valid()) {            // checks form for validity
        if ($('.payment_id').val() !== '') {
            PosnicPro.payment.editPaymentField();
        } else {
            PosnicPro.payment.addPaymentField();
        }
    }
});
$('#tableorder_value').on('input', function () {
    // remove anything that is not A–Z, a–z, 0–9
    this.value = this.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
});
$("#tableorder_add_form").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        tableorder_value: {
            required: true,
            minlength: 1,
            maxlength: 6
        }
    },
    errorClass: 'error error_tableorder',
    messages: {
        tableorder_value: {
            required: "Enter a table number",
            minlength: "value must be at least 1 characters",
            maxlength: "value should not be more than 6 characters"
        }
    }
});
$("#tableorder_add_form").submit(function (event) {
    event.preventDefault();
    if ($('#tableorder_add_form').valid()) {            // checks form for validity
        if ($('#tableorder_id').val() !== '') {
            PosnicPro.tableOrders.editTableOrderField();
        } else {
            PosnicPro.tableOrders.addTableOrderField();
        }
    }
});
$("#taxgroup_add_form").validate({
    errorClass: 'error error_taxgroup',
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        taxgroup_name: {
            required: true,
            minlength: 3,
            maxlength: 20
        },
        'tax_rates[]': {
            required: true
        }
    },
    messages: {
        taxgroup_name: {
            required: "Enter the tax name",
            minlength: "Tax name must be at least 3 characters",
            maxlength: "Tax name should not be more than 100 characters"
        },
        'tax_rates[]': {
            required: "You must check at least 1 box"
        }
    }
});
$("#taxgroup_add_form").submit(function (event) {
    event.preventDefault();
    if ($('#taxgroup_add_form').valid()) {            // checks form for validity
        var checked = $(".tax_rates:checked").length;
        if (checked > 0) {
            $("#error_tax_checkbox").text("").removeClass('error');
            if ($('#taxgroup_id').val() !== '') {
                PosnicPro.taxgroup.editTaxgroupRates();
            } else {
                PosnicPro.taxgroup.addTaxgroupRates();
            }
        } else {
            $("#error_tax_checkbox").text("You must check at least 1 box").addClass('error');
        }
    }
});
$("#eraseForm").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        verifyPassword: {
            required: true,
            minlength: 5,
            strong_password: true,
            maxlength: 20
        }
    },
    messages: {
        verifyPassword: {
            required: "Enter the password",
            minlength: "Password must be at least 5 characters",
            maxlength: "Password should not be more than 20 characters"
        }
    }
});
$("#eraseForm").submit(function (event) {
    event.preventDefault();
    if ($('#eraseForm').valid()) {            // checks form for validity
        PosnicPro.settings.verifyViewDangerZoneConfirmed();
    }
});
// Email setting validate submit
$("#email_add").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        report_type: {
            required: true
        },
        "emailaddress[0]": {
            required: true,
            maxlength: 250,
            email: true,
            emailExt: true
        }
    },
    messages: {
        report_type: {
            required: "Choose a report type"
        },
        "emailaddress[0]": {
            required: "Enter a valid email address",
            email: "Enter a valid email address",
            maxlength: "Email should not be more than 250 Characters"
        }
    }
});
$("#email_add").submit(function (event) {
    event.preventDefault();
    if ($('#email_add').valid()) {
        PosnicPro.settings.emailSetting();
    }
});
// Kiosk account validate submit
$("#kioskaccount_form").validate({
    highlight: function (element) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        kioskstore_id: {
            required: true,
            minlength: 3,
            maxlength: 6,
            pattern: /^[A-Za-z0-9]+$/
        }
        // kiosksecret_key: {
        //     required: true,
        //     minlength: 3,
        //     maxlength: 6,
        //     pattern: /^[A-Za-z0-9]+$/
        // }
    },
    messages: {
        kioskstore_id: {
            required: "Enter the store ID",
            minlength: "Minimum 3 characters",
            maxlength: "Maximum 6 characters",
            pattern: "Only letters and numbers allowed"
        }

        // kiosksecret_key: {
        //     required: "Enter the secret key",
        //     minlength: "Minimum 3 characters",
        //     maxlength: "Maximum 6 characters",
        //     pattern: "Only letters and numbers allowed"
        // }
    }
});
// Add pattern rule support if not already available
$.validator.addMethod("pattern", function (value, element, pattern) {
    if (this.optional(element)) return true;
    if (typeof pattern === "string") {
        pattern = new RegExp(pattern);
    }
    return pattern.test(value);
}, "Invalid format.");

$("#kioskaccount_form").submit(function (event) {
    event.preventDefault();
    if ($(this).valid()) {
        PosnicPro.settings.kioskAccountSettings();
    }
});

$("#kioskprint_form").validate({
    highlight: function (element) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        kioskprinter_name: {
            required: true
        }
    },
    messages: {
        kioskprinter_name: {
            required: "Enter the printer name"
        }
    }
});

$("#kioskprint_form").submit(function (event) {
    event.preventDefault();
    if ($(this).valid()) {
        PosnicPro.settings.kioskPrinterSettings();
    }
});

$('.custom_recyclebin_search_input').on('keypress keydown.autocomplete', function () {
    var module = $('#backuptablelist').val();
    var field_name = $('#view_recycle_bin_fields').val();
    $(this).autocomplete({
        lookup: function (query, done) {
            var result = {};
            var suggestions = [];
            var params = {
                url: 'setting/autoSuggestionRecycleBinTableField',
                data: 'query=' + query + '&field=' + field_name + '&module=' + module
            };
            PosnicPro.get(params, function (response) {
                suggestions: $.map(response.suggestions, function (dataItem) {
                    suggestions.push({ "value": dataItem, "data": dataItem });
                });
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        autoSelectFirst: true
    });
});
$("#click_filter_btn,#v-pills-recyclebin-tab").click(function () {
    if ($('#show_recycle').css('display') == 'none') {
        $('#card_recycle').css({ "display": "block", "background-color": "#fff", "margin-bottom": "30px" });
    } else if ($('.hide-button-action').css('display') == 'none') {
        $('#card_recycle').css({ "display": "none", "background-color": "transparent", "margin-bottom": "0px" });
    }
});
$('.custom_default_value_search').click(function () {
    PosnicPro.selectAllText(jQuery(this));
});
$(document).on('change', '#indian_gst', function () {
    var gst_status = $(this).val();
    if (gst_status === 'gst_on') {
        $('.disable_indian_gst').show();
        PosnicPro.local.set('gst_action', 'enable');
    } else {
        $('.disable_indian_gst').hide();
        PosnicPro.local.set('gst_action', 'disable');
    }
});
$(document).ready(function () {
    $('#discount_amount').keyup(function () {
        if ($('#discount_amount').val() === '')
            $('#discount_amount').val('0');
    });
    $("#setting_country").change(function () {
        if (this.value === 'India') {
            $(".branch-gstin-hide-show").show();
        } else {
            $('#branch_gstin_number').val('');
            $(".branch-gstin-hide-show").hide();
        }
    });
});
$("#decimal_Round").click(function () {
    if ($(this).is(":checked")) {
        $('#decimal_Round').attr('checked', 'checked');
    } else {
        $('#decimal_Round').attr('unchecked', 'unchecked');
    }
});
$("#receipt_barcode").click(function () {
    if ($(this).is(":checked")) {
        $('#receipt_barcode').attr('checked', 'checked');
    } else {
        $('#receipt_barcode').attr('unchecked', 'unchecked');
    }
});
$("#backup_table_data").click(function () {
    $('.storeSetting').removeClass('active');
    $('#backup_table_data').addClass('active');
    $(".backupReportTable").css({ "display": "none" });
    PosnicPro.settings.settingsTable();
});
$('#branch_name').change(function () {
    var branch_no = $('#branch_name').find(":selected").val();
    PosnicPro.settings.changeBranch(branch_no);
});
$(function () {
    $("#radio_discount_amount, #radio_discount_percentage").change(function () {
        if ($("#radio_discount_amount").is(":checked")) {
            $('#discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0');
            $('#discount_amount').removeAttr('disabled', 'disabled').focus().select();
        } else if ($("#radio_discount_percentage").is(":checked")) {
            $('#discount_amount').attr('disabled', 'disabled').addClass('bg-white').val('0');
            $('#discount_percentage').removeAttr('disabled', 'disabled').focus().select();
        }
    });
});
function resize() {
    if ($(window).width() < 768) {
        $('#vertical_nav').addClass('tabs-horizantal');
        $('#vertical_nav').removeClass('tabs-vertical');
    } else {
        $('#vertical_nav').addClass('tabs-vertical');
    }
}

$(document).ready(function () {
    $('#v-pills-manage').addClass('show active');
    $(window).resize(resize);
    resize();
});
// Function to preview image after validation
$(function () {
    PosnicPro.settings.loadSelectSettingCountry();
    PosnicPro.settings.loadSelectSettingCurrency();
    PosnicPro.settings.timeZone();
    PosnicPro.commonDate();
    $("#file").change(function () {
        var fileSize = this.files[0].size;
        if (fileSize < 5242880) {
            var validExtensions = ['gif', 'jpg', 'png', 'jpeg', 'bmp'];
            var fileName = this.files[0].name;
            $('#setting_image_value').val(this.files[0].name);
            var fileNameExt = fileName.substr(fileName.lastIndexOf('.') + 1);
            if ($.inArray(fileNameExt, validExtensions) === -1) {
                this.type = ''
                this.type = 'file'
                PosnicPro.alert('error', "Only these file types are accepted : " + validExtensions.join(', '));
            } else {
                var reader = new FileReader();
                reader.onload = PosnicPro.settings.settingImageReadURL;
                reader.readAsDataURL(this.files[0]);
            }
        } else {
            PosnicPro.alert('error', "size should be less than 5MB !");
        }
    });
    /*Date Select Dropdown*/
    $('#storedate').on({
        change: function () {
            var selectedDate = $('#storedate').val();
            $('#storedate option[value="' + selectedDate + '"]').attr("selected", true);
            var serverDate = $('#storedate option[value="' + selectedDate + '"]').data('id');
            var serverText = $('#storedate option[value="' + selectedDate + '"]').text();
            $('#serverdate').val(serverDate);
            $('#dateText').val(serverText);
            $('#storedate').off('click');
        }
    });
    ($('#backuptablelist').val() === 'branches') ? $('#hide_branch_recyclebin,#Select_backup_Branch').hide() : $('#hide_branch_recyclebin,#Select_backup_Branch').show();
});
$("#Select_backup_Branch").change("change", function () {
    $("#select_backup_value_set").val($(this).find("option:selected").attr("value"));
});
// validate submit
$("#tax_discount_add").validate({
    highlight: function (element, errorClass) {
        $(element).css("border-color", "#f9616d");
    },
    unhighlight: function (element, errorClass) {
        $(element).css("border-color", "#eae8e8");
    },
    rules: {
        default_customer: {
            required: true,
            minlength: 3,
            maxlength: 100
        },
        default_supplier: {
            required: true,
            minlength: 3,
            maxlength: 100
        },
        sales_prefix: {
            maxlength: 6
        },
        receiving_prefix: {
            maxlength: 6
        },
        notification_value: {
            required: true
        },
        header_print: {
            minlength: 3,
            maxlength: 1000
        },
        footer_print: {
            minlength: 3,
            maxlength: 1000
        }
    },
    messages: {
        default_customer: {
            required: "Choose a customer",
            minlength: "Customer name must be at least 3 characters",
            maxlength: "Customer name should not be more than 100 characters"
        },
        default_supplier: {
            required: "Choose a supplier",
            minlength: "Supplier name must be at least 3 characters",
            maxlength: "Supplier name should not be more than 100 characters"
        },
        sales_prefix: {
            required: "Enter a prefix for sale numbers",
            minlength: "Must be at least 3 characters",
            maxlength: "Should not be more than 3 characters"
        },
        receiving_prefix: {
            required: "Enter a prefix for stock entries",
            minlength: "Must be at least 3 characters",
            maxlength: "Should not be more than 3 characters"
        },
        notification_value: {
            required: "Enter a notification value"
        },
        header_print: {
            minlength: "Header content must be at least 3 characters",
            maxlength: "Header content should not be more than 1000 characters"
        },
        footer_print: {
            minlength: "Footer content must be at least 3 characters",
            maxlength: "Footer content should not be more than 1000 characters"
        }
    }
});
jQuery.validator.addMethod("lettersonly", function (value, element) {
    return this.optional(element) || /^[a-z\s]+$/i.test(value);
}, "Use letters only");
$("#tax_discount_add").submit(function (event) {
    event.preventDefault();
    if ($('#tax_discount_add').valid()) {            // checks form for validity
        PosnicPro.settings.updateCommonSetting('Core Settings saved');
    }
});
$("#tax_checked_all").click(function () {
    if ($("#tax_checked_all").is(":checked")) {
        $('.tax_rates').prop('checked', true);
        $("#error_tax_checkbox").text("").removeClass('error');
    } else {
        $('.tax_rates').prop('checked', false);
    }
});
//start cash denom
$('.cashregisters-wrapper').each(function () {
    var $wrapper = $('.cashregisters-fields', this);
    var i = 0;
    $(".add-field", $(this)).click(function (e) {
        i++;
        if ($(this).parent('.cashregisters-input').find('input').val() !== '')
            $('.cashregisters-input:first-child', $wrapper).clone(true).appendTo($wrapper).find('input').attr('id', 'denom[' + i + ']').attr('name', 'cashdenom[' + i + ']').val('').focus();
    });
    $('.cashregisters-input .remove-field', $wrapper).click(function () {
        if ($('.cashregisters-input', $wrapper).length > 1)
            $(this).parent('.cashregisters-input').remove();
    });
});
$('.email-wrapper').each(function () {
    var $wrapper = $('.email-fields', this);
    var i = 0;
    $(".add-email-field", $(this)).click(function (e) {
        i++;
        if ($(this).parent('.email-input').find('input').val() !== '' && PosnicPro.validateEmail($(this).parent('.email-input').find('input').val())) {
            var $test = $('.email-input:parent', $wrapper);
            var $newField = $('.email-input:first-child', $wrapper).clone(true);
            $newField.appendTo($wrapper).find('input').attr('id', 'emailaddress[' + i + ']').attr('name', 'emailaddress[' + i + ']').val('').focus();
            $('.add-email-field', $test).hide();
            $('.add-email-field', $newField).show();
        }
    });
    $('.email-input .remove-email-field', $wrapper).click(function () {
        var $emailInput = $(this).closest('.email-input');
        $('input', $emailInput).val('');
        if ($('.email-input', $wrapper).length > 1)
            $(this).parent('.email-input').remove();
    });
});
$('.remove-email-field').click(function () {
    var $text = $('.email-input:last-child');
    $('.add-email-field', $text).show();
});
$('.printer-wrapper').each(function () {
    var $wrapper = $('.printer-fields', this);
    var i = 0;

    $(".add-printer-field", $(this)).click(function (e) {
        e.preventDefault();
        i++;

        var $newField = $('.printer-input:first-child', $wrapper).clone(true);
        $newField.appendTo($wrapper)
            .find('input')
            .attr('id', 'printer_name_' + i)
            .attr('name', 'printer_name[' + i + ']')
            .val('')
            .focus();

        // only last row shows "+"
        var $rows = $('.printer-input:parent', $wrapper);
        $('.add-printer-field', $rows).hide();
        $('.add-printer-field', $newField).show();
    });

    $('.printer-input .remove-printer-field', $wrapper).click(function (e) {
        e.preventDefault();
        var $row = $(this).closest('.printer-input');
        if ($('.printer-input', $wrapper).length > 1) {
            $row.remove();
            var $last = $('.printer-input:last-child', $wrapper);
            $('.add-printer-field', $last).show();
        } else {
            $('input', $row).val('');
        }
    });
});
$("#v-pills-store-tab").click(function () {
    PosnicPro.HideSideBarModal();
});
$("#v-pills-general-tab").click(function () {
    PosnicPro.HideSideBarModal();
});
$("#v-pills-email-tab").click(function () {
    PosnicPro.HideSideBarModal();
});
$("#setting_image_add").click(function () {
    PosnicPro.HideSideBarModal();
});
$(document).ready(function () {
    if (window.matchMedia("(pointer: coarse)").matches) {
        $('#shortcut').hide();
    } else {
        $('#shortcut').show();
    }
});
$('#setting_country').one('change', function () {
    var countrySelect = $('#setting_country');
    countrySelect.on('select2:select', function (e) {
        var data = e.params.data;
        PosnicPro.settings.loadSelectSettingState(data.element.attributes['data-setting-id'].value);
        PosnicPro.local.set("country_value", data.id);
    });
});

// Initialize form validation

$("#phonepe_qr_code_form").validate({
    rules: {
        phonepe_merchant_id: {
            required: true
        },
        phonepe_salt_key: {
            required: true
        }
    },
    messages: {
        phonepe_merchant_id: {
            required: "Merchant Id is required."
        },
        phonepe_salt_key: {
            required: "Salt key is required."
        }
    }
});
$("#phonepe_qr_code_form").submit(function (event) {
    event.preventDefault();
    if ($('#phonepe_qr_code_form').valid()) {
        PosnicPro.settings.phonepePaymentKey();
    }
});

$("#qr_code_form").validate({
    rules: {
        site_key: {
            required: true
        },
        secret_key: {
            required: true
        }
    },
    messages: {
        site_key: {
            required: "Site key is required."
        },
        secret_key: {
            required: "Secret key is required."
        }
    }
});
$("#qr_code_form").submit(function (event) {
    event.preventDefault();
    if ($('#qr_code_form').valid()) {
        PosnicPro.settings.paymentKey();
    }
});
$("#payment_gateway").on('change', function (event) {
    event.preventDefault();
    if ($('#payment_gateway').is(":checked")) {
        if ($('#site_key').val() === '' || $('#secret_key').val() === '') {
            $('#payment_gateway').prop("checked", false).attr('unchecked', 'unchecked');
            PosnicPro.alert('warning', 'Fill in all required fields.');
        }
    }
});
$('#footer_print,#header_print').summernote({
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
    placeholder: 'Enter a content ...',
    focus: true,
    callbacks: {
        onKeydown: function (e) {
            var t = e.currentTarget.innerText;
            if (t.trim().length === 0) {
                $('#footer_print,#header_print').summernote('code', '');
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
                $('#footer_print,#header_print').summernote('code', '');
            }
            $('#footer_print,#header_print').text(1000 - t.trim().length);
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
            $('#footer_print,#header_print').text(1000 - t.length);
        }
    }
});

$(function () {
    PosnicPro.settings.store_telephone = window.intlTelInput(document.querySelector("#store_telephone"), {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });
    $('#enable_email_reminders, #enable_sms_reminders').on('change', function () {
        if ($('#enable_email_reminders').prop('checked') || $('#enable_sms_reminders').prop('checked')) {
            $('#enable_sms_auto_send').prop('disabled', false);  // Enable the Auto Send checkbox        
        } else {
            $('#enable_sms_auto_send').prop('disabled', true);   // Disable Auto Send checkbox
            $('#enable_sms_auto_send').prop('checked', false);   // Uncheck Auto Send checkbox
            PosnicPro.settings.toggleInputs();
        }
    });
    $('#enable_sms_auto_send').on('change', function () {
        PosnicPro.settings.toggleInputs();
    });
    $('#sms_auto_send_time').on('change', function () {
        const time = $(this).val(); // Get 24-hour format (e.g., "14:30")
        const [hour, minute] = time.split(':'); // Split into hour and minute
        let period = 'am';
        let formattedHour = parseInt(hour, 10);

        if (formattedHour >= 12) {
            period = 'pm';
            if (formattedHour > 12) {
                formattedHour -= 12; // Convert to 12-hour format
            }
        } else if (formattedHour === 0) {
            formattedHour = 12; // Convert midnight to 12 AM
        }
        // Update hidden input for AM/PM
        $('#sms_auto_send_period').val(formattedHour + ':' + minute + ' ' + period);
    });
    PosnicPro.kiosk.handleFileChange("kiosk_logo", "preview_logo");
    PosnicPro.kiosk.handleFileChange("kiosk_banner", "preview_banner");
    PosnicPro.kiosk.handleFileChange("kiosk_homebanner", "preview_homebanner");
    PosnicPro.kiosk.handleFileChange("kiosk_advertisement", "preview_advertisement");

    // read setting stored by settings.js
    var kotEnabled = (PosnicPro.local.get('table_options') === 'enable');

    var $kotLi = $('#view_kot_page').closest('li');
    var $kotOrderLi = $('#view_kotorder_page').closest('li');
    var $kotHistoryLi = $('#view_kothistory_page').closest('li');
    var $kotReportLi = $('#viewkotreport_page').closest('li');

    if (kotEnabled) {
        $kotLi.show();
        $kotOrderLi.show();
        $kotHistoryLi.show();
        $kotReportLi.show();
    } else {
        $kotLi.hide();
        $kotOrderLi.hide();
        $kotHistoryLi.hide();
        $kotReportLi.hide();
    }
});

$('#kiosk_payment_form').on('submit', function (e) {
    // Prevent form submission
    e.preventDefault();

    // Initialize default values
    var paymentParams = {
        payment_cod: false,
        payment_razorpay: false,
        payment_number: false
    };

    // Update based on enabled and checked checkboxes
    $('input[name="payment_methods[]"]:enabled').each(function () {
        const id = $(this).attr('id'); // like 'payment_cod' or 'payment_razorpay', or 'payment_number'
        paymentParams[id] = $(this).is(':checked');
    });
    var params = {
        url: 'setting/kioskPayment', // change to your endpoint
        data: JSON.stringify(paymentParams)
    };

    PosnicPro.post(params, function (response) {
        if (response.type === 'success') {
            PosnicPro.alert(response.type, response.message);
        }
    }, function (xhr) {
        var response = jQuery.parseJSON(xhr.responseText);
        PosnicPro.alert(response.type, response.message);
    });
});
// Module cards mirror their switch instantly (saving still goes through the
// Save button - the card state is feedback, not a write).
$(document).on('change', '#v-pills-modules .module-card-head input.custom-control-input', function () {
    PosnicPro.settings._featuresDirty = true;
    PosnicPro.settings.refreshModuleCards();
});
// Unsaved feature changes get a real decision (owner upgrade from the
// toast): Stay pulls you back with every selection intact; Leave
// discards knowingly.
$(window).on('hashchange', function () {
    if (PosnicPro.settings._featuresDirty && !/settings/i.test(window.location.hash || '')) {
        if (!window.confirm('You have unsaved feature changes. Leave without saving?')) {
            hasher.replaceHash('settings/modules');
            return;
        }
        PosnicPro.settings._featuresDirty = false;
    }
});

// Core Settings tabs refold on resize (debounced - resize storms are real).
(function () {
    var t = null;
    $(window).on('resize', function () {
        clearTimeout(t);
        t = setTimeout(function () { PosnicPro.settings.coreTabsOverflow(); }, 150);
    });
})();

// Config sections carry their route: every pill switch writes
// #/settings/<section>, so a refresh reopens exactly where you were.
// The Core Settings inner tab is remembered per device the same way.
$(function () {
    // Delegated from #settings, NOT from '#v-pills-tab': that id exists
    // TWICE (the main sidebar rail uses it too, first in the DOM), so the
    // original binding caught RAIL clicks - pressing Purchase wrote
    // #/settings/purchase and Config swallowed the page.
    $('#settings').on('shown.bs.tab', 'a[data-toggle="pill"][id^="v-pills-"]', function () {
        var m = /^v-pills-(.+?)(?:-tab)?$/.exec(this.id || '');
        if (!m) { return; }
        var target = 'settings/' + m[1];
        if (window.location.hash.slice(2) !== target) {
            hasher.setHash(target);
        }
        // The Manage sidebar carries the sections now: mirror the active one.
        $('.manage-settings-entry').removeClass('active');
        $('#manage_sec_' + m[1]).addClass('active');
    });
    $('#core_settings_tabs').on('shown.bs.tab', 'a[data-toggle="tab"]', function () {
        PosnicPro.local.set('posnic_core_tab', $(this).attr('href'));
    });
});


/*
 * Integrations admin (roadmap I3): the UI over the shipped token and
 * webhook APIs. Secrets render ONCE into a reveal box; lists never
 * contain them (the server projects them out).
 */
PosnicPro.integrations = {
    // Mirrors the api whitelists - a scope or entity outside these is
    // refused server-side anyway; the UI just doesn't offer it.
    MODULES: ['sales', 'item', 'customer', 'supplier', 'category',
        'receiving', 'expense', 'branch', 'user', 'report', 'dashboard'],
    ENTITIES: ['sales', 'items', 'receivings', 'customers', 'suppliers',
        'categories', 'registers', 'expenses', 'shifts', 'easytables'],
    load: function () {
        PosnicPro.integrations.loadTokens();
        PosnicPro.integrations.loadHooks();
        // Connectors are a TILL surface: the desktop supervises them, so the
        // tab only exists where the desktop bridge does. The web dashboard
        // manages tokens and webhooks; the till manages what runs beside it.
        var hasBridge = !!(window.electronAPI && window.electronAPI.connectors);
        $('#int_connectors_subtab').toggle(hasBridge);
    },
    // ---- connectors (I6 enable flow; desktop only) ----
    loadConnectors: function () {
        var api = window.electronAPI && window.electronAPI.connectors;
        if (!api) { return; }
        var esc = PosnicPro.integrations.esc;
        api.status().then(function (r) {
            var rows = (r && r.connectors) || [];
            if (!rows.length) {
                $('#int_connectors_body').html('<tr><td colspan="4" class="text-center text-muted">None installed yet - connectors arrive with the till&#39;s update checks once published.</td></tr>');
                return;
            }
            var badge = function (c) {
                if (!c.installed) return '<span class="badge badge-secondary">not installed</span>';
                if (c.state === 'running') return '<span class="badge badge-success">running</span>';
                if (c.state === 'crashloop') return '<span class="badge badge-danger">parked (kept failing)</span>';
                if (!c.enabled) return '<span class="badge badge-light">off</span>';
                return '<span class="badge badge-warning">' + esc(c.state) + '</span>';
            };
            var html = '';
            rows.forEach(function (c) {
                var action = c.enabled
                    ? '<button type="button" class="btn btn-outline-danger btn-sm int-conn-disable" data-name="' + esc(c.name) + '">Turn off</button>'
                    : '<button type="button" class="btn btn-outline-primary btn-sm int-conn-enable" data-name="' + esc(c.name) + '"' + (c.installed ? '' : ' disabled') + '>Turn on</button>';
                html += '<tr><td>' + esc(c.name) + '</td>'
                    + '<td>' + esc(c.version || '—') + '</td>'
                    + '<td>' + badge(c) + '</td>'
                    + '<td class="text-right">' + action + '</td></tr>';
            });
            $('#int_connectors_body').html(html);
        }).catch(function () {
            $('#int_connectors_body').html('<tr><td colspan="4" class="text-center text-danger">Could not reach the till&#39;s connector runtime.</td></tr>');
        });
    },
    enableConnector: function (name) {
        // The whole enable act: mint the connector its OWN scoped token
        // (message-this-shop's-customers, nothing more), hand it to the
        // desktop, start. The plaintext token goes straight into the till's
        // config and is never shown - there is nothing for a person to store.
        PosnicPro.post({
            url: 'api-tokens',
            data: JSON.stringify({
                name: 'Connector: ' + name,
                scopes: { customer: { read: true, write: true } },
            })
        }, function (r) {
            if (!(r && r.type === 'success' && r.data && r.data.token)) {
                PosnicPro.alert((r && r.type) || 'error', (r && r.message) || 'Could not mint the connector token.');
                return;
            }
            window.electronAPI.connectors.enable(name, r.data.token, {}).then(function (res) {
                if (res && res.ok) {
                    PosnicPro.alert('success', name + ' turned on');
                    PosnicPro.integrations.loadTokens();
                    PosnicPro.integrations.loadConnectors();
                } else {
                    PosnicPro.alert('error', (res && res.error) || 'The till refused to start it.');
                }
            });
        }, function () {
            PosnicPro.alert('error', 'Could not mint the connector token.');
        });
    },
    disableConnector: function (name) {
        window.electronAPI.connectors.disable(name).then(function (res) {
            if (res && res.ok) {
                PosnicPro.alert('success', name + ' turned off');
                PosnicPro.integrations.loadConnectors();
            } else {
                PosnicPro.alert('error', (res && res.error) || 'Could not stop it.');
            }
        });
    },
    esc: function (v) {
        return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    },
    // ---- tokens ----
    loadTokens: function () {
        PosnicPro.get({ url: 'api-tokens', data: {} }, function (r) {
            var rows = (r && r.data) || [];
            var esc = PosnicPro.integrations.esc;
            if (!rows.length) {
                $('#int_tokens_body').html('<tr><td colspan="5" class="text-center text-muted">No tokens yet - mint one for each integration.</td></tr>');
                return;
            }
            var html = '';
            rows.forEach(function (t) {
                var scopes = [];
                $.each(t.access || {}, function (mod, p) {
                    var perms = ['read', 'write', 'delete'].filter(function (x) { return p && p[x]; });
                    if (perms.length) { scopes.push(mod + ':' + perms.join('/')); }
                });
                var used = t.last_used_at ? PosnicPro.convertDate(t.last_used_at) : 'never';
                html += '<tr' + (t.active === false ? ' class="text-muted"' : '') + '>' +
                    '<td>' + esc(t.name) + (t.active === false ? ' <span class="badge badge-secondary-inverse">revoked</span>' : '') + '</td>' +
                    '<td><code>' + esc(t.hint) + '</code></td>' +
                    '<td style="max-width:260px;"><small>' + esc(scopes.join(', ') || '-') + '</small></td>' +
                    '<td><small>' + esc(used) + '</small></td>' +
                    '<td class="text-right">' + (t.active === false ? '' :
                        '<button type="button" class="btn btn-outline-danger btn-sm int-revoke-btn" data-id="' + esc(t.id) + '">Revoke</button>') +
                    '</td></tr>';
            });
            $('#int_tokens_body').html(html);
        }, function () {
            $('#int_tokens_body').html('<tr><td colspan="5" class="text-center text-danger">Could not load tokens.</td></tr>');
        });
    },
    openMint: function () {
        var rows = '';
        PosnicPro.integrations.MODULES.forEach(function (m) {
            rows += '<tr><td>' + m + '</td>' +
                ['read', 'write', 'delete'].map(function (p) {
                    return '<td class="text-center"><input type="checkbox" class="int-scope" data-mod="' + m + '" data-perm="' + p + '"></td>';
                }).join('') + '</tr>';
        });
        $('#int_mint_scopes').html(rows);
        $('#int_mint_name').val('');
        $('#int_mint_modal').modal('show');
    },
    mint: function () {
        var scopes = {};
        var granted = 0;
        $('.int-scope:checked').each(function () {
            var m = $(this).data('mod'), p = $(this).data('perm');
            scopes[m] = scopes[m] || {};
            scopes[m][p] = true;
            granted++;
        });
        if (!granted) { PosnicPro.alert('error', 'Grant at least one permission - a token that can do nothing is a mistake, not a credential.'); return; }
        PosnicPro.post({
            url: 'api-tokens',
            data: JSON.stringify({ name: $('#int_mint_name').val() || 'API token', scopes: scopes })
        }, function (r) {
            if (r && r.type === 'success' && r.data && r.data.token) {
                $('#int_mint_modal').modal('hide');
                $('#int_token_plain').text(r.data.token);
                $('#int_token_reveal').show();
                PosnicPro.integrations.loadTokens();
            } else {
                PosnicPro.alert((r && r.type) || 'error', (r && r.message) || 'Could not create the token.');
            }
        }, function (xhr) {
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not create the token.');
        });
    },
    copyToken: function () {
        navigator.clipboard.writeText($('#int_token_plain').text()).then(function () {
            PosnicPro.alert('success', 'Token copied');
        });
    },
    revoke: function (id) {
        PosnicPro.delete({ url: 'api-tokens/' + id, data: JSON.stringify({}) }, function (r) {
            PosnicPro.alert((r && r.type) || 'success', (r && r.message) || 'Token revoked');
            PosnicPro.integrations.loadTokens();
        }, function () { PosnicPro.alert('error', 'Could not revoke the token.'); });
    },
    // ---- webhooks ----
    loadHooks: function () {
        var esc = PosnicPro.integrations.esc;
        PosnicPro.get({ url: 'webhooks', data: {} }, function (r) {
            var rows = (r && r.data) || [];
            if (!rows.length) {
                $('#int_hooks_body').html('<tr><td colspan="4" class="text-center text-muted">No webhooks - register an endpoint to receive change signals.</td></tr>');
            } else {
                var html = '';
                rows.forEach(function (h) {
                    html += '<tr>' +
                        '<td style="max-width:280px; word-break:break-all;"><small>' + esc(h.url) + '</small></td>' +
                        '<td><small>' + esc((h.events || []).join(', ') || 'all') + '</small></td>' +
                        '<td>' + (h.active === false ? '<span class="badge badge-secondary-inverse">off</span>' : '<span class="badge badge-success-inverse">active</span>') + '</td>' +
                        '<td class="text-right"><button type="button" class="btn btn-outline-danger btn-sm int-removehook-btn" data-id="' + esc(h.id) + '">Remove</button></td>' +
                        '</tr>';
                });
                $('#int_hooks_body').html(html);
            }
        }, function () {
            $('#int_hooks_body').html('<tr><td colspan="4" class="text-center text-danger">Could not load webhooks.</td></tr>');
        });
        PosnicPro.get({ url: 'webhooks/deliveries', data: {} }, function (r) {
            var rows = (r && r.data) || [];
            if (!rows.length) {
                $('#int_deliveries_body').html('<tr><td colspan="5" class="text-center text-muted">No deliveries yet.</td></tr>');
                return;
            }
            var html = '';
            rows.slice(0, 25).forEach(function (d) {
                var status = d.status || '-';
                var badge = status === 'delivered' ? 'badge-success-inverse'
                    : status === 'dead' ? 'badge-danger-inverse' : 'badge-secondary-inverse';
                html += '<tr>' +
                    '<td><small>' + esc(d.entity || '-') + '</small></td>' +
                    '<td style="max-width:240px; word-break:break-all;"><small>' + esc(d.url || '') + '</small></td>' +
                    '<td><span class="badge ' + badge + '">' + esc(status) + '</span></td>' +
                    '<td><small>' + esc(d.attempts != null ? d.attempts : '-') + '</small></td>' +
                    '<td><small>' + esc(d.updatedAt ? PosnicPro.convertDate(d.updatedAt) : (d.createdAt ? PosnicPro.convertDate(d.createdAt) : '-')) + '</small></td>' +
                    '</tr>';
            });
            $('#int_deliveries_body').html(html);
        }, function () { /* the hooks table is the primary view */ });
    },
    openRegister: function () {
        var html = '';
        PosnicPro.integrations.ENTITIES.forEach(function (e) {
            html += '<label class="mb-0" style="font-weight:400;"><input type="checkbox" class="int-entity" value="' + e + '"> ' + e + '</label>';
        });
        $('#int_hook_entities').html(html);
        $('#int_hook_url').val('');
        $('#int_hook_modal').modal('show');
    },
    register: function () {
        var events = $('.int-entity:checked').map(function () { return this.value; }).get();
        PosnicPro.post({
            url: 'webhooks',
            data: JSON.stringify({ url: $('#int_hook_url').val(), events: events })
        }, function (r) {
            if (r && r.type === 'success' && r.data && r.data.secret) {
                $('#int_hook_modal').modal('hide');
                $('#int_hook_secret').text(r.data.secret);
                $('#int_hook_reveal').show();
                PosnicPro.integrations.loadHooks();
            } else {
                PosnicPro.alert((r && r.type) || 'error', (r && r.message) || 'Could not register the webhook.');
            }
        }, function (xhr) {
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not register the webhook.');
        });
    },
    copySecret: function () {
        navigator.clipboard.writeText($('#int_hook_secret').text()).then(function () {
            PosnicPro.alert('success', 'Secret copied');
        });
    },
    removeHook: function (id) {
        PosnicPro.delete({ url: 'webhooks/' + id, data: JSON.stringify({}) }, function (r) {
            PosnicPro.alert((r && r.type) || 'success', (r && r.message) || 'Webhook removed');
            PosnicPro.integrations.loadHooks();
        }, function () { PosnicPro.alert('error', 'Could not remove the webhook.'); });
    }
};

/*
 * Modifier groups (V2): the Restaurant pane's option-set manager. A group
 * is a name, min/max pick rules and priced options; items reference the
 * groups; the sale screen enforces the rules at pick time.
 */
PosnicPro.modifiers = {
    _esc: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    },
    _cache: [],
    loadGroups: function () {
        var esc = PosnicPro.modifiers._esc;
        PosnicPro.get({ url: 'setting/modifierGroups', data: {} }, function (r) {
            var rows = (r && r.data) || [];
            PosnicPro.modifiers._cache = rows;
            if (!rows.length) {
                $('#modifier_groups_body').html('<tr><td colspan="4" class="text-center text-muted">No modifier groups yet - the kitchen menu starts here.</td></tr>');
                return;
            }
            var html = '';
            rows.forEach(function (g) {
                var rules = (g.min > 0 ? 'pick at least ' + g.min : 'optional')
                    + (g.max > 0 ? ', at most ' + g.max : '');
                var opts = g.options.map(function (o) {
                    var d = Number(o.price_delta) || 0;
                    return esc(o.name) + (d ? ' (' + (d > 0 ? '+' : '') + d + ')' : '');
                }).join(', ');
                html += '<tr><td>' + esc(g.name) + '</td><td><small>' + esc(rules) + '</small></td>'
                    + '<td><small>' + opts + '</small></td>'
                    + '<td class="text-right">'
                    + '<button type="button" class="btn btn-outline-primary btn-sm mod-edit-btn" data-id="' + esc(g.id) + '">Edit</button> '
                    + '<button type="button" class="btn btn-outline-danger btn-sm mod-del-btn" data-id="' + esc(g.id) + '">Delete</button>'
                    + '</td></tr>';
            });
            $('#modifier_groups_body').html(html);
        }, function () {
            $('#modifier_groups_body').html('<tr><td colspan="4" class="text-center text-danger">Could not load modifier groups.</td></tr>');
        });
    },
    openEditor: function (id) {
        var esc = PosnicPro.modifiers._esc;
        var g = id ? (PosnicPro.modifiers._cache.find(function (x) { return x.id === id; }) || {}) : {};
        var optionRow = function (o) {
            o = o || { name: '', price_delta: 0 };
            return '<div class="form-row mb-1 mod-opt-row">'
                + '<div class="col-7"><input type="text" class="form-control form-control-sm mod-opt-name" maxlength="60" placeholder="e.g. Extra cheese" value="' + esc(o.name) + '"></div>'
                + '<div class="col-4"><input type="number" step="0.01" class="form-control form-control-sm mod-opt-delta" placeholder="+/- price" value="' + (Number(o.price_delta) || 0) + '"></div>'
                + '<div class="col-1"><a href="javascript:void(0);" class="text-danger mod-opt-remove"><i class="feather icon-x"></i></a></div>'
                + '</div>';
        };
        $('#modifier_editor_modal').remove();
        $('body').append(
            '<div class="modal fade close_on_esc" id="modifier_editor_modal" tabindex="-1" role="dialog" aria-hidden="true">'
            + '<div class="modal-dialog" role="document"><div class="modal-content">'
            + '<div class="modal-header"><h5 class="modal-title">' + (id ? 'Edit' : 'New') + ' Modifier Group</h5>'
            + '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>'
            + '<div class="modal-body">'
            + '<input type="hidden" id="mod_edit_id" value="' + esc(id || '') + '">'
            + '<div class="form-group"><label style="font-weight:600; font-size:.85rem;">Group name</label>'
            + '<input type="text" class="form-control" id="mod_edit_name" maxlength="60" placeholder="e.g. Toppings" value="' + esc(g.name || '') + '"></div>'
            + '<div class="form-row">'
            + '<div class="form-group col-6"><label style="font-weight:600; font-size:.85rem;">Min picks</label>'
            + '<input type="number" min="0" class="form-control" id="mod_edit_min" value="' + (g.min || 0) + '"></div>'
            + '<div class="form-group col-6"><label style="font-weight:600; font-size:.85rem;">Max picks <small class="text-muted">(0 = no limit)</small></label>'
            + '<input type="number" min="0" class="form-control" id="mod_edit_max" value="' + (g.max || 0) + '"></div>'
            + '</div>'
            + '<label style="font-weight:600; font-size:.85rem;">Options</label>'
            + '<div id="mod_edit_options">' + ((g.options && g.options.length) ? g.options.map(optionRow).join('') : optionRow()) + '</div>'
            + '<button type="button" class="btn btn-outline-secondary btn-sm mt-1" id="mod_opt_add">+ Option</button>'
            + '</div>'
            + '<div class="modal-footer">'
            + '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancel</button>'
            + '<button type="button" class="btn btn-outline-primary" id="mod_edit_save" onclick="PosnicPro.modifiers.save();">Save</button>'
            + '</div></div></div></div>'
        );
        $('#modifier_editor_modal').modal('show');
        $('#mod_opt_add').on('click', function () { $('#mod_edit_options').append(optionRow()); });
        $('#modifier_editor_modal').on('click', '.mod-opt-remove', function () { $(this).closest('.mod-opt-row').remove(); });
    },
    save: function () {
        var id = $('#mod_edit_id').val();
        var payload = {
            name: $('#mod_edit_name').val(),
            min: $('#mod_edit_min').val(),
            max: $('#mod_edit_max').val(),
            options: $('.mod-opt-row').map(function () {
                return {
                    name: $(this).find('.mod-opt-name').val(),
                    price_delta: $(this).find('.mod-opt-delta').val()
                };
            }).get()
        };
        var done = function (r) {
            if (r && r.type === 'success') {
                $('#modifier_editor_modal').modal('hide');
                PosnicPro.alert('success', r.message);
                PosnicPro.modifiers.loadGroups();
            } else {
                PosnicPro.alert((r && r.type) || 'error', (r && r.message) || 'Could not save the group.');
            }
        };
        var fail = function (xhr) {
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the group.');
        };
        if (id) {
            PosnicPro.put({ url: 'setting/modifierGroups/' + id, data: JSON.stringify(payload) }, done, fail);
        } else {
            PosnicPro.post({ url: 'setting/modifierGroups', data: JSON.stringify(payload) }, done, fail);
        }
    },
    remove: function (id) {
        PosnicPro.delete({ url: 'setting/modifierGroups/' + id, data: JSON.stringify({}) }, function (r) {
            PosnicPro.alert((r && r.type) || 'error', (r && r.message) || '');
            PosnicPro.modifiers.loadGroups();
        }, function (xhr) {
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not delete the group.');
        });
    }
};
$(document).on('click', '.mod-edit-btn', function () { PosnicPro.modifiers.openEditor($(this).data('id')); });
$(document).on('click', '.mod-del-btn', function () { PosnicPro.modifiers.remove($(this).data('id')); });

/*
 * Price lists (V4): customer-group pricing manager (Marketing > Customer
 * Pricing). One list per category; the sale screen resolves it live.
 */
PosnicPro.pricelists = {
    _esc: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    },
    _cache: [],
    load: function () {
        var esc = PosnicPro.pricelists._esc;
        PosnicPro.get({ url: 'setting/priceLists', data: {} }, function (r) {
            var rows = (r && r.data) || [];
            PosnicPro.pricelists._cache = rows;
            if (!rows.length) {
                $('#pricelists_body').html('<tr><td colspan="4" class="text-center text-muted">No price lists yet - wholesale pricing starts here.</td></tr>');
                return;
            }
            var html = '';
            rows.forEach(function (l) {
                var rule = l.percent_off
                    ? (l.percent_off > 0 ? l.percent_off + '% off' : Math.abs(l.percent_off) + '% markup')
                    : '—';
                html += '<tr><td>' + esc(l.customer_category_name || l.customer_category_id) + '</td>'
                    + '<td>' + esc(rule) + '</td>'
                    + '<td>' + (l.item_overrides || []).length + '</td>'
                    + '<td class="text-right">'
                    + '<button type="button" class="btn btn-outline-primary btn-sm pl-edit-btn" data-id="' + esc(l.id) + '">Edit</button> '
                    + '<button type="button" class="btn btn-outline-danger btn-sm pl-del-btn" data-id="' + esc(l.id) + '">Delete</button>'
                    + '</td></tr>';
            });
            $('#pricelists_body').html(html);
        }, function () {
            $('#pricelists_body').html('<tr><td colspan="4" class="text-center text-danger">Could not load price lists.</td></tr>');
        });
    },
    openEditor: function (id) {
        var esc = PosnicPro.pricelists._esc;
        var l = id ? (PosnicPro.pricelists._cache.find(function (x) { return x.id === id; }) || {}) : {};
        var overrideRow = function (o) {
            o = o || { item_id: '', item_name: '', price: '' };
            return '<div class="form-row mb-1 pl-ov-row">'
                + '<div class="col-7"><input type="text" class="form-control form-control-sm pl-ov-name" placeholder="Type to search an item" value="' + esc(o.item_name) + '" data-itemid="' + esc(o.item_id) + '"></div>'
                + '<div class="col-4"><input type="number" min="0" step="0.01" class="form-control form-control-sm pl-ov-price" placeholder="Price" value="' + (o.price === '' ? '' : (Number(o.price) || 0)) + '"></div>'
                + '<div class="col-1"><a href="javascript:void(0);" class="text-danger pl-ov-remove"><i class="feather icon-x"></i></a></div>'
                + '</div>';
        };
        $('#pricelist_editor_modal').remove();
        $('body').append(
            '<div class="modal fade close_on_esc" id="pricelist_editor_modal" tabindex="-1" role="dialog" aria-hidden="true">'
            + '<div class="modal-dialog" role="document"><div class="modal-content">'
            + '<div class="modal-header"><h5 class="modal-title">' + (id ? 'Edit' : 'New') + ' Price List</h5>'
            + '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>'
            + '<div class="modal-body">'
            + '<input type="hidden" id="pl_edit_id" value="' + esc(id || '') + '">'
            + '<div class="form-group"><label style="font-weight:600; font-size:.85rem;">Customer category</label>'
            + '<select class="form-control" id="pl_edit_category"><option value="">Loading&hellip;</option></select></div>'
            + '<div class="form-group"><label style="font-weight:600; font-size:.85rem;">Percent off <small class="text-muted">(negative = markup; 0 = item prices only)</small></label>'
            + '<input type="number" step="0.01" class="form-control" id="pl_edit_percent" value="' + (l.percent_off || 0) + '"></div>'
            + '<label style="font-weight:600; font-size:.85rem;">Exact item prices <small class="text-muted">(win over the percentage)</small></label>'
            + '<div id="pl_edit_overrides">' + ((l.item_overrides && l.item_overrides.length) ? l.item_overrides.map(overrideRow).join('') : '') + '</div>'
            + '<button type="button" class="btn btn-outline-secondary btn-sm mt-1" id="pl_ov_add">+ Item price</button>'
            + '</div>'
            + '<div class="modal-footer">'
            + '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancel</button>'
            + '<button type="button" class="btn btn-outline-primary" onclick="PosnicPro.pricelists.save();">Save</button>'
            + '</div></div></div></div>'
        );
        $('#pricelist_editor_modal').modal('show');
        $('#pl_ov_add').on('click', function () { $('#pl_edit_overrides').append(overrideRow()); });
        $('#pricelist_editor_modal').on('click', '.pl-ov-remove', function () { $(this).closest('.pl-ov-row').remove(); });
        // Item search on override rows: first match by name wins on blur.
        $('#pricelist_editor_modal').on('change', '.pl-ov-name', function () {
            var $inp = $(this);
            var q = ($inp.val() || '').trim();
            if (!q) { $inp.data('itemid', ''); return; }
            PosnicPro.get({ url: 'items/search', data: { q: q, limit: 1 } }, function (r) {
                var hit = r && r.data && r.data.list && r.data.list[0];
                if (hit) {
                    $inp.val(hit.name).data('itemid', String(hit._id || hit.id || ''));
                } else {
                    $inp.data('itemid', '');
                    PosnicPro.alert('warning', 'No item matches "' + q + '".');
                }
            }, function () { $inp.data('itemid', ''); });
        });
        // Categories dropdown from the same source the customer form uses.
        PosnicPro.get({ url: 'customerCategory/getCustomerCategoryAjaxList', data: 'query=' }, function (response) {
            var opts = '';
            (response.suggestions || []).forEach(function (c) {
                var sel = String(c.id) === String(l.customer_category_id) ? ' selected' : '';
                opts += '<option value="' + esc(c.id) + '" data-name="' + esc(c.name) + '"' + sel + '>' + esc(c.name) + '</option>';
            });
            $('#pl_edit_category').html(opts || '<option value="">No customer categories yet</option>');
        }, function () {
            $('#pl_edit_category').html('<option value="">Could not load categories</option>');
        });
    },
    save: function () {
        var overrides = $('.pl-ov-row').map(function () {
            return {
                item_id: $(this).find('.pl-ov-name').data('itemid') || '',
                item_name: $(this).find('.pl-ov-name').val(),
                price: $(this).find('.pl-ov-price').val()
            };
        }).get().filter(function (o) { return o.item_id; });
        var payload = {
            customer_category_id: $('#pl_edit_category').val(),
            customer_category_name: $('#pl_edit_category option:selected').data('name') || '',
            percent_off: $('#pl_edit_percent').val(),
            item_overrides: overrides
        };
        PosnicPro.post({ url: 'setting/priceLists', data: JSON.stringify(payload) }, function (r) {
            if (r && r.type === 'success') {
                $('#pricelist_editor_modal').modal('hide');
                PosnicPro.alert('success', r.message);
                PosnicPro.pricelists.load();
            } else {
                PosnicPro.alert((r && r.type) || 'error', (r && r.message) || 'Could not save the list.');
            }
        }, function (xhr) {
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the list.');
        });
    },
    remove: function (id) {
        PosnicPro.delete({ url: 'setting/priceLists/' + id, data: JSON.stringify({}) }, function (r) {
            PosnicPro.alert((r && r.type) || 'error', (r && r.message) || '');
            PosnicPro.pricelists.load();
        }, function () { PosnicPro.alert('error', 'Could not delete the list.'); });
    }
};
$(document).on('click', '.pl-edit-btn', function () { PosnicPro.pricelists.openEditor($(this).data('id')); });
$(document).on('click', '.pl-del-btn', function () { PosnicPro.pricelists.remove($(this).data('id')); });

// Delegated actions: rows repaint on every load.
$(document).on('click', '.int-revoke-btn', function () {
    PosnicPro.integrations.revoke($(this).data('id'));
});
$(document).on('click', '.int-removehook-btn', function () {
    PosnicPro.integrations.removeHook($(this).data('id'));
});
$(document).on('click', '.int-conn-enable', function () {
    PosnicPro.integrations.enableConnector($(this).data('name'));
});
$(document).on('click', '.int-conn-disable', function () {
    PosnicPro.integrations.disableConnector($(this).data('name'));
});

/*
 * First-run Feature picker (user request, from the Loyverse pattern): the
 * first sign-in shows what the till can do, one honest line per feature,
 * pre-set from this branch's real state. Saving writes through the M4
 * modules-only path (toggle map and nothing else - the full settings
 * surface is never touched). Any dismissal marks it seen; it never nags.
 */
PosnicPro.features = {
    /* key, label, consequence - the same wording as the Features cards. */
    INTRO: [
        ['cash_register_enable', 'Cash register', 'Openings, closings and cash counts per till.'],
        ['staff_shifts_enable', 'Shifts & clock-in', 'Track when staff work; powers the labour report.'],
        ['staff_tips_enable', 'Tips', 'Record tips at tender and in payouts.'],
        ['staff_roster_enable', 'Roster', 'Plan the week; staff see their shifts.'],
        ['till_lock_enable', 'Till PIN lock', 'Lock the screen between sales; PIN to resume.'],
        ['module_tax_enable', 'Taxes', 'Tax rates, groups and tax on every sale.'],
        ['module_credit_enable', 'Customer credit', 'Sell on account and settle later.'],
        ['module_marketing_enable', 'Marketing', 'Campaigns, coupons and customer pricing.'],
        ['module_messaging_enable', 'Messaging', 'Receipts and notices by WhatsApp or SMS.'],
        ['module_channels_enable', 'Sales channels', 'Kiosk, QR ordering and online lists.'],
        ['module_cashbook_enable', 'Cash book', 'Expenses and cash movements beside sales.'],
        ['quick_sale_enable', 'Quick sale', 'Type an amount, take payment - the busy-counter pad on the sale screen.'],
        ['module_recyclebin_enable', 'Recycle bin', 'Deleted records are kept and restorable.'],
        ['module_demo_data_enable', 'Demo data', 'The sample products your shop started with.'],
        ['module_themes_enable', 'Themes', 'Change how the till looks.']
    ],
    _blob: function () {
        try { return JSON.parse(PosnicPro.local.get('general_settings') || '{}'); } catch (e) { return {}; }
    },
    maybeShowIntro: function () {
        if (PosnicPro.local.get('features_intro_seen')) { return; }
        var acl = PosnicPro.userACL;
        if (!(acl && acl.setting && acl.setting.write === true)) { return; }
        if (!$('#feature_intro_modal').length) { return; }
        PosnicPro.features.renderIntro();
        $('#feature_intro_modal').modal('show');
        // Seen is seen, however it closes - this must never nag.
        $('#feature_intro_modal').one('hidden.bs.modal', function () {
            PosnicPro.local.set('features_intro_seen', 'true');
        });
    },
    renderIntro: function () {
        var blob = PosnicPro.features._blob();
        var rows = PosnicPro.features.INTRO.map(function (f) {
            var key = f[0];
            // The blob carries every key post-login (guard-tested); absent
            // falls back to each key's polarity: tips/till-lock opt-in OFF,
            // everything else opt-out ON.
            var onByDefault = !(key === 'staff_tips_enable' || key === 'till_lock_enable');
            var on = blob[key] === undefined ? onByDefault : blob[key] === true;
            return '<div class="d-flex align-items-center justify-content-between py-2" style="border-bottom:1px solid rgba(128,128,128,.15);">' +
                '<div class="pr-3"><div style="font-weight:600;">' + f[1] + '</div>' +
                '<small class="text-muted">' + f[2] + '</small></div>' +
                '<div class="custom-control custom-switch">' +
                '<input type="checkbox" class="custom-control-input feature-intro-toggle" id="fi_' + key + '" data-key="' + key + '"' + (on ? ' checked' : '') + '>' +
                '<label class="custom-control-label" for="fi_' + key + '"></label>' +
                '</div></div>';
        }).join('');
        $('#feature_intro_list').html(rows);
    },
    saveIntro: function () {
        /* Toggles only. This used to send sales_prefix:'SAL' and
           receiving_prefix:'REC' - invented values, purely to satisfy a
           validator for two fields this screen does not own. They were
           described as ignored, but nothing guaranteed that: the day the
           modules-only path stopped skipping them, every shop saving a
           feature toggle would have had its receipt numbering overwritten
           with "SAL" and "REC". The features endpoint knows only its own
           keys, so it cannot ask for them and would refuse them by name. */
        var payload = {};
        $('.feature-intro-toggle').each(function () {
            payload[$(this).data('key')] = $(this).is(':checked') ? 'true' : 'false';
        });
        $('#feature_intro_save').prop('disabled', true);
        PosnicPro.put({
            url: 'settings/group/features',
            data: JSON.stringify(payload)
        }, function (response) {
            $('#feature_intro_save').prop('disabled', false);
            if (response.type === 'success') {
                // The session blob must agree with what was just written, and
                // the menus react now, not at next login.
                var blob = PosnicPro.features._blob();
                $('.feature-intro-toggle').each(function () {
                    blob[$(this).data('key')] = $(this).is(':checked');
                });
                PosnicPro.local.set('general_settings', JSON.stringify(blob));
                if (PosnicPro.settings && PosnicPro.settings.applyModuleNav) { PosnicPro.settings.applyModuleNav(); }
                else if (PosnicPro.applyModuleSidebar) { PosnicPro.applyModuleSidebar(); }
                $('#feature_intro_modal').modal('hide');
                PosnicPro.alert('success', 'Feature switches saved');
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function () {
            $('#feature_intro_save').prop('disabled', false);
            PosnicPro.alert('error', 'Could not save - you can set these later under Manage > Features');
        });
    }
};
$(document).on('click', '#feature_intro_save', function () { PosnicPro.features.saveIntro(); });
$(document).ready(function () {
    // After boot settles: login writes the general_settings blob and userACL
    // before the dashboard is usable, so a short delay is enough.
    setTimeout(function () { PosnicPro.features.maybeShowIntro(); }, 2500);
});

/* The customer-display address card was removed from Core Settings on owner
   instruction; customerview.html still serves on the LAN unchanged. */
/*
 * S4: a credential the server will not send back.
 *
 * The field loads empty because the value never leaves the server any more,
 * and an empty field on save means "keep the saved one". Without a word of
 * explanation that reads as "the password was lost", so the placeholder says
 * which ones are configured. The value itself is never in this page.
 */
PosnicPro.settings.markSavedSecrets = function (configured) {
    var labels = {
        email_smtp_password: 'SMTP password',
        smtp_password: 'SMTP password',
        way2sms_password: 'Password',
        way2sms_api: 'API key',
        textlocal_api: 'API key'
    };
    var map = configured || {};
    Object.keys(labels).forEach(function (key) {
        var $f = $('#' + key);
        if (!$f.length) { return; }
        $f.attr('placeholder', map[key]
            ? 'Saved - leave blank to keep it'
            : labels[key]);
        $f.closest('.form-group').find('.secret-saved-flag').remove();
        if (map[key]) {
            $f.after('<small class="secret-saved-flag text-success d-block mt-1">'
                + '<i class="feather icon-check mr-1"></i>Configured</small>');
        }
    });
};


/* Feature search (owner feedback): filter the cards by anything visible on
   them - title, description, sub-toggle labels. */
PosnicPro.settings.filterModuleCards = function (query) {
    var q = String(query || '').trim().toLowerCase();
    $('.module-grid .module-card').each(function () {
        var hit = !q || $(this).text().toLowerCase().indexOf(q) !== -1;
        $(this).toggleClass('search-miss', !hit);
    });
};

/* The settings header names whichever page the pill opened. */
$(document).on('shown.bs.tab', '#v-pills-tab a[data-toggle="pill"]', function () {
    var t = $.trim($(this).text());
    if (t) { $('#settings_page_title').text(t); }
});

/* Authorised signature for quotations: a small image stored with the shop
   settings as a data URL. No image = no signatory line on the quote. */
$(document).on('change', '#quote_signature_file', function () {
    var f = this.files && this.files[0];
    if (!f) { return; }
    if (f.size > 300 * 1024) {
        PosnicPro.alert('warning', 'Keep the signature under 300 KB - a small PNG works best.');
        $(this).val('');
        return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
        $('#quote_default_signature').val(e.target.result);
        $('#quote_signature_thumb').attr('src', e.target.result).show();
        $('#quote_signature_clear').show();
    };
    reader.readAsDataURL(f);
});
$(document).on('click', '#quote_signature_clear', function () {
    $('#quote_default_signature').val('');
    $('#quote_signature_file').val('');
    $('#quote_signature_thumb').hide().attr('src', '');
    $(this).hide();
});

/* Quotation settings live in their own popup off the Features card - the
   card itself stays a clean on/off (owner rule: toggles toggle, config
   configures). Same field ids as ever, so the existing loads fill them. */


/*
 * The generic feature-settings popup (owner rule): EVERY feature's
 * configuration opens here - a big scrollable dialog that can hold even
 * list pages. It ADOPTS an existing pane's children on open and returns
 * them on close, so pages keep working when reached the normal way too.
 */
PosnicPro.settings.openFeatureModal = function (title, paneSelector) {
    if (!$('#feature_settings_modal').length) {
        $('body').append(
            '<div class="modal fade" id="feature_settings_modal" tabindex="-1" role="dialog" aria-hidden="true">'
            + '<div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="document">'
            + '<div class="modal-content">'
            + '<div class="modal-header py-2"><h5 class="modal-title" id="feature_settings_title"></h5>'
            + '<button type="button" class="close" data-dismiss="modal">&times;</button></div>'
            + '<div class="modal-body" id="feature_settings_body"></div>'
            + '</div></div></div>');
        $('#feature_settings_modal').on('hidden.bs.modal', function () {
            var home = $('#feature_settings_body').data('home');
            if (home) { $(home).append($('#feature_settings_body').children()); }
            $('#feature_settings_body').empty().removeData('home');
        });
    }
    var $pane = $(paneSelector);
    if (!$pane.length) { return; }
    $('#feature_settings_title').text(title);
    $('#feature_settings_body').data('home', paneSelector).append($pane.children());
    $('#feature_settings_modal').modal('show');
};
$(document).on('click', '.feature-pane-open', function () {
    PosnicPro.settings.openFeatureModal($(this).data('title') || 'Settings', $(this).data('pane'));
});
/*
 * Sharing between shops (owner ask #85).
 *
 * Its own load and its own save, because it writes at ACCOUNT level while
 * everything around it on this screen writes to the branch. Riding the general
 * form save would let a screen opened on one shop push that shop's view onto
 * all of them - which is the exact failure S5 inheritance was built to avoid.
 *
 * `?level=account` on the read, for the same reason: resolveGroup would answer
 * "what is in force at THIS branch", and saving that back would turn one
 * branch's override into everybody's rule.
 */
PosnicPro.settings = PosnicPro.settings || {};

/* Stock is deliberately absent: a count sits on one shelf, in one building, so
   it is copied once when a shop is created rather than shared as a rule. See
   api/src/services/catalogue-copy.js. */
PosnicPro.settings.SHARING_KEYS = ['share_customers', 'share_suppliers'];

PosnicPro.settings.loadSharing = function () {
    if (!$('#sharing_fieldset').length) { return; }
    PosnicPro.get({ url: 'settings/group/sharing', data: { level: 'account' } }, function (r) {
        var values = (r && r.data && r.data.values) || {};
        $.each(PosnicPro.settings.SHARING_KEYS, function (i, key) {
            /* An absent key means nothing account-wide has been decided, which
               the server reads as off. The switch must show the same thing, or
               the screen and the query disagree. */
            $('#set_' + key).prop('checked', PosnicPro.settings._sharingOn(values[key]));
        });
        $('#sharing_status').text('');
    }, function () {
        $('#sharing_status').text('Could not read the current setting.');
    });
};

/* Settings arrive as a boolean or as the string a form wrote. `!!"false"` is
   true, and for a switch that decides who sees whose customers that is the
   wrong direction to be wrong in - the server reads it the same way. */
PosnicPro.settings._sharingOn = function (v) {
    if (v === true) { return true; }
    if (v === false || v === null || v === undefined) { return false; }
    var t = String(v).trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes' || t === 'on' || t === 'enable' || t === 'enabled';
};

PosnicPro.settings.saveSharing = function () {
    var payload = { level: 'account' };
    $.each(PosnicPro.settings.SHARING_KEYS, function (i, key) {
        /* Stated, never implied. A switch left alone must still travel, or the
           server keeps whatever it had and the screen says otherwise. */
        payload[key] = $('#set_' + key).is(':checked');
    });
    $('#sharing_save_btn').prop('disabled', true);
    $('#sharing_status').text('Saving ...');
    PosnicPro.put({ url: 'settings/group/sharing', data: JSON.stringify(payload) }, function (r) {
        $('#sharing_save_btn').prop('disabled', false);
        $('#sharing_status').text(r.type === 'success' ? 'Saved. Applies to every shop.' : '');
        PosnicPro.alert(r.type, r.type === 'success' ? 'Sharing saved' : r.message);
    }, function (xhr) {
        $('#sharing_save_btn').prop('disabled', false);
        $('#sharing_status').text('');
        var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
        /* 403 has a specific meaning here and a generic "could not save" hides
           it: this is deliberately owner-class, because it decides what other
           people can read. */
        PosnicPro.alert('error', xhr.status === 403
            ? 'Only an owner can change what is shared between shops'
            : (resp.message || 'Could not save sharing'));
    });
};

$(document).on('click', '#v-pills-general-tab', function () {
    PosnicPro.settings.loadSharing();
});

$(document).on('click', '#quote_settings_save', function () {
    var payload = {
        quote_default_payment_method: $('#quote_default_payment_method').val() || '',
        quote_default_bank_details: $('#quote_default_bank_details').val() || '',
        quote_default_terms: $('#quote_default_terms').val() || '',
        quote_default_signature: $('#quote_default_signature').val() || ''
    };
    $('#quote_settings_save').prop('disabled', true);
    // four keys, all of them documents - so the documents endpoint
    PosnicPro.put({ url: 'settings/group/documents', data: JSON.stringify(payload) }, function (r) {
        $('#quote_settings_save').prop('disabled', false);
        PosnicPro.alert(r.type, r.type === 'success' ? 'Quotation settings saved' : r.message);
        if (r.type === 'success') {
            PosnicPro.local.set('quotesignature', payload.quote_default_signature);
        }
    }, function (xhr) {
        $('#quote_settings_save').prop('disabled', false);
        var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
        PosnicPro.alert('error', resp.message || 'Could not save quotation settings');
    });
});

/*
 * Feature detail dialogs (FEATURE_PAGES_DESIGN): every Core feature opens
 * like a marketplace listing - readable while OFF, toggle in the hero,
 * screenshots and benefits when provided, and ALL of its settings adopted
 * into one place. JS-built and body-appended: the only modal pattern that
 * has never broken in this codebase.
 */
PosnicPro.settings.featureInfo = {
    /*
     * Copy written 2026-08-21 for the nine features whose dialog opened with
     * nothing but the one-line card description.
     *
     * Every claim below was checked against the code that implements it rather
     * than written from the feature's name. A listing that promises something
     * the software does not do is worse than a listing with no detail at all -
     * it is the shop owner who finds out, in front of a customer.
     *
     * NO `section` KEY on most of these, deliberately. It names the markup
     * block whose controls the dialog ADOPTS, and only four exist: fc_quotes,
     * fc_restaurant, fc_tillpin and fc_workforce. The first draft invented
     * seven more from the feature names. The renderer guards with
     * $(info.section).length so nothing would have broken - which is exactly
     * what makes it worth catching: it would have sat there reading as wired.
     */
    staff_tips_enable: {
        section: '#fc_workforce',
        tagline: 'Record tips at clock-out and pay them out with wages.',
        about: 'Cash tips are declared by the person who earned them when they clock out, stored against that shift, and carried into the labour and payroll figures - so they are paid rather than remembered.',
        benefits: [
            'Declared at clock-out, by the person who took them',
            'Held against the shift, so who earned what is never in doubt',
            'Flows into payroll rather than living on a piece of paper'
        ],
        how: [
            'Turn it on - a tips box appears at clock-out',
            'Staff enter what they took in cash; blank is fine',
            'Review it per shift, and pay it with that period of wages'
        ]
    },
    staff_roster_enable: {
        section: '#fc_workforce',
        tagline: 'Plan the week ahead; staff see the shifts they are on.',
        about: 'A roster is next week decided this week. Plan a stretch for a person on a day, and the people you rostered can see their own shifts without asking.',
        benefits: [
            'Plan a week in one screen instead of a group message',
            'Staff see their own shifts; managers see everyone',
            'Viewing and planning are separate permissions'
        ],
        how: [
            'Turn it on - Roster appears beside Shifts',
            'Pick a person and a day, and set their stretch',
            'They see it on their own account from then on'
        ]
    },
    module_credit_enable: {
        tagline: 'Sell on account now, settle later - with a limit that holds.',
        about: 'Regulars who pay at month end can take goods today. Each customer carries a balance and an optional credit limit, and the limit is checked when the sale is made rather than discovered at the end of the month.',
        benefits: [
            'A per-customer limit, enforced at the moment of sale',
            'Outstanding balances in one list',
            'Reminders can go out by SMS or WhatsApp',
            'Zero means unlimited, for the customers you trust completely'
        ],
        how: [
            'Turn it on and set a default limit under Credit',
            'Give a customer their own limit if it differs',
            'Sell on account; the balance follows the customer',
            'Settle it whenever they pay, in part or in full'
        ]
    },
    module_marketing_enable: {
        tagline: 'Loyalty points, coupons, cashback and campaigns in one place.',
        about: 'Everything that brings a customer back a second time: points earned per sale, coupons with real rules, cashback into a wallet, and campaigns that decide who hears about what.',
        benefits: [
            'Points earn and redeem on the till, not on a card someone lost',
            'Coupons with limits that are checked before they apply',
            'Cashback waits in the wallet for the next visit',
            'Category pricing for the customers who buy in volume'
        ],
        how: [
            'Turn it on - Marketing appears in the menu',
            'Set how points are earned and what they are worth',
            'Create coupons or a campaign when you want one',
            'It applies itself at the till from then on'
        ]
    },
    module_messaging_enable: {
        tagline: 'Send the receipt where the customer already reads - WhatsApp or SMS.',
        about: 'A paper receipt is thrown away at the door. Messaging sends it to a phone instead, over WhatsApp when it is connected and SMS through your own gateway when it is not.',
        benefits: [
            'The receipt arrives somewhere they will still have it next month',
            'Templates you write once, with the sale filled in',
            'Your own SMS gateway - no per-message markup from us',
            'Can be turned off per till, so a busy counter is not slowed'
        ],
        how: [
            'Turn it on, then connect WhatsApp or fill in your SMS gateway',
            'Write the template you want customers to receive',
            'Send a test to your own phone before the first sale',
            'It offers to send at the end of each sale'
        ]
    },
    module_channels_enable: {
        tagline: 'Let customers order themselves - kiosk, QR menu, or a public list.',
        about: 'Selling without a cashier standing at the screen. A kiosk authenticates with its own key rather than a login, so a tablet on the counter can take orders without holding a staff account.',
        benefits: [
            'A kiosk signs in with its own key, never a staff password',
            'QR ordering from the table, into the same sale flow',
            'Orders land in the list your staff already work from'
        ],
        how: [
            'Turn it on - Channels appears under settings',
            'Register the device and give it its key',
            'Point a tablet or a QR code at it and take orders'
        ]
    },
    module_cashbook_enable: {
        tagline: 'Expenses and cash movements, beside the sales they sit next to.',
        about: 'Money leaves the till as well as entering it. The cash book records what went out and why, so the cash position for the day is the truth rather than sales minus a guess.',
        benefits: [
            'Expenses recorded where the cash actually moved',
            'The day accounts for money out, not only money in',
            'Closing a register has something real to reconcile against'
        ],
        how: [
            'Turn it on - Cash book appears in the menu',
            'Record an expense when money leaves the drawer',
            'It shows against the day, beside the sales'
        ]
    },
    module_demo_data_enable: {
        tagline: 'The sample products you started with, out of the way in one click.',
        about: 'Every new shop arrives with a few sample products so the till can be tried before there is any real stock in it. Once your own catalogue is in, they are only clutter. Switching this off hides them everywhere at once - the item list, the sale screen, search. Nothing is deleted, so switching it back on brings them straight back, and anything you have edited or already sold stays put either way.',
        benefits: [
            'One switch clears the samples out of the whole till',
            'Nothing is destroyed, so it is safe to try',
            'A sample you have edited into a real product is never touched',
            'Anything already sold keeps its place in your sales history'
        ],
        how: [
            'Try the till with the samples that came with your shop',
            'Add your own products when you are ready',
            'Turn this off - the samples disappear and yours remain'
        ]
    },
    module_recyclebin_enable: {
        tagline: 'A deletion you can undo - records are kept, not destroyed.',
        about: 'Deleting marks a record as deleted and hides it; it does not remove it. Anything deleted can be found and restored, which is what makes a delete button safe to hand to a cashier.',
        benefits: [
            'A wrong delete is a mistake, not a loss',
            'Restore puts the record back where it was',
            'Turning the feature off does not destroy what is already kept'
        ],
        how: [
            'Turn it on - Recycle bin appears under settings',
            'Delete as normal; the record moves there instead',
            'Find it and restore it if it should not have gone'
        ]
    },
    module_themes_enable: {
        tagline: 'Change how the till looks, without changing how it works.',
        about: 'A theme sets the colours and surfaces of the whole app from one place. Colour still carries meaning - red destroys, green succeeded, the accent is the main action - so a theme changes the palette, never what a colour means.',
        benefits: [
            'One place for the look of every screen',
            'Light and dark, chosen per person',
            'Meaning is preserved: a theme cannot make red mean "saved"'
        ],
        how: [
            'Turn it on - Themes appears under settings',
            'Pick one; it applies immediately, everywhere',
            'Anyone can change it back without help'
        ]
    },
    quotes_enable: {
        tagline: 'Price an offer today, convert it to a sale when the customer says yes.',
        about: 'A quotation is a price promise with a validity date. Build it from your catalog or free lines, discount per line or per quote, add charges in any name, and share it as a professional A4 PDF.',
        benefits: [
            'Professional A4 document with your logo, GSTIN and signature',
            'Share by PDF, print, email, WhatsApp or a copy-paste link',
            'Accepted quotes freeze their numbers - the promise is kept',
            'Convert loads the sale at the QUOTED prices, discounts visible'
        ],
        how: [
            'Turn the feature on - Quotes appears in the home menu',
            'New quotation: pick a customer, add lines, set validity',
            'Share it; mark Accepted when the customer says yes',
            'Convert to sale - the receipt total matches the quote'
        ],
        section: '#fc_quotes'
    },
    staff_shifts_enable: {
        section: '#fc_workforce',
        tagline: 'Staff clock in and out from the header clock; labour report and payroll exports.',
        about: 'Workforce turns the till into the timesheet: clock in/out, shift history, labour costing and payroll exports - with tips and rosters as optional pieces below.',
        benefits: [
            'One tap clock in/out right on the till header',
            'Labour report shows who worked when, and what it cost',
            'Payroll exports ready for your accountant',
            'Tips at clock-out and rosters when you want them'
        ],
        how: [
            'Turn it on and the clock appears in the header',
            'Staff tap to clock in and out through their day',
            'Review hours in the Labour report under Reports'
        ]
    },
    table_options: {
        tagline: 'Dine-in orders by table, KOTs to the kitchen.',
        about: 'Restaurant mode adds tables, dine-in order flow and kitchen order tickets. Manage your table list right here.',
        benefits: [
            'Orders held per table until the bill is asked for',
            'KOTs reach the kitchen as they are fired',
            'Table list managed from this dialog'
        ],
        how: [
            'Turn it on, then add your tables below',
            'On a sale, pick dine-in and the table number',
            'Fire KOTs; settle the table when the meal ends'
        ],
        section: '#fc_restaurant'
    },
    custom_charges_enable: {
        tagline: 'Parcel, service or delivery charges added on a sale.',
        about: 'Named amounts that join the bill after the item math - never fake line items. Sales that already carry charges stay editable even when this is off, and charges arriving from a quotation always work.',
        benefits: [
            'Any name: parcel, service, delivery, installation',
            'Joins the payable after discounts - honest totals',
            'Quote-borne charges work regardless of this switch'
        ],
        how: [
            'Turn it on; “+ Add charge” appears beside the Payment Note',
            'Name it, amount it - it lists right there, removable',
            'The Pay Total carries it; the sale stores it'
        ]
    },
    quick_sale_enable: {
        tagline: 'Type an amount, take payment - the busy-counter pad on the sale screen.',
        about: 'For the queue that cannot wait for item search: an amount (and optional name) becomes a sale line instantly.',
        benefits: [
            'Fastest possible line for rush hours',
            'Optional name keeps the receipt honest',
            'Default tax applied the way your shop configures it'
        ],
        how: [
            'On the sale screen, type an amount in the item search',
            'Pick the quick-sale suggestion; add to sale',
            'Tender as usual'
        ]
    },
    cash_register_enable: {
        tagline: 'Till sessions, floats and register reports.',
        about: 'Registers add the open-count-close ceremony: a float to start, a session per till, and a register report to reconcile. Off: sales work without any register ceremony.',
        benefits: [
            'Every rupee in the drawer accounted per session',
            'Register report reconciles float, sales and payouts',
            'Resume your own session across devices'
        ],
        how: [
            'Turn it on; login asks which register to open',
            'Count the float, trade the day',
            'Close with a count - the report shows the difference'
        ]
    },
    module_tax_enable: {
        tagline: 'Tax Rates and Tax Groups. Off hides both sections; saved taxes keep.',
        about: 'Configure the taxes your items carry. Items bring their own tax to sales and quotations; documents show tax the moment any line carries it - even if you later switch this off.',
        benefits: [
            'Per-item rates - GST style, every line its own tax',
            'Inclusive or added-on-top, per item',
            'Recorded tax always shows, whatever the toggle says'
        ],
        how: [
            'Turn it on; set Tax Rates under Core Settings',
            'Assign a tax on each item (or via HSN suggestion)',
            'Sales and quotes carry it automatically'
        ]
    },
    till_lock_enable: {
        section: '#fc_tillpin',
        tagline: 'Staff unlock with a 4-digit PIN instead of a password.',
        about: 'The till locks to a PIN pad - fast for staff, safe for the counter. Choose an idle timeout below.',
        benefits: [
            'One tap lock, 4-digit unlock',
            'Idle auto-lock keeps an unattended till safe'
        ],
        how: [
            'Turn it on; staff set their PINs',
            'Pick when the till should lock by itself'
        ]
    }
};

PosnicPro.settings._fpCard = null;
PosnicPro.settings._fpSection = null;
/*
 * The feature PAGE (owner's final shape): each feature opens its OWN
 * dedicated page - hero with the toggle, the help documentation, and only
 * THAT feature's settings, adopted from the hidden store and returned on
 * leave. No popup, no aggregate page, no extra menu entry.
 */
/*
 * A screenshot that is not there yet removes itself, and takes the empty strip
 * with it. Without the second half, a feature with no images keeps a 14px gap
 * and a scroll container holding nothing.
 */
PosnicPro.settings._shotMissing = function (img) {
    var $strip = $(img).closest('.fd-shots');
    $(img).remove();
    if (!$strip.find('img').length) { $strip.remove(); }
};

/*
 * One loaded screenshot asks for the next. This is what keeps the cost at one
 * failed request for a feature with no images instead of one per slot guessed.
 *
 * Capped, because the chain is driven by the server answering 200: a directory
 * that somehow served every name would ask forever. Ten is far more than any
 * feature page should show.
 */
PosnicPro.settings.MAX_SHOTS = 10;
PosnicPro.settings._shotNext = function (img) {
    var $img = $(img);
    var $strip = $img.closest('.fd-shots');
    var key = $strip.attr('data-shot-key');
    var n = Number($img.attr('data-shot-n') || 0);
    if (!key || !n || n >= PosnicPro.settings.MAX_SHOTS) { return; }
    if ($strip.find('[data-shot-n="' + (n + 1) + '"]').length) { return; }
    $('<img>')
        .attr('src', 'static/images/features/' + key + '-' + (n + 1) + '.png')
        .attr('alt', '')
        .attr('data-shot-n', n + 1)
        .attr('onload', 'PosnicPro.settings._shotNext(this);')
        .attr('onerror', 'PosnicPro.settings._shotMissing(this);')
        .appendTo($strip);
};

PosnicPro.settings.openFeaturePage = function ($card) {
    var $main = $card.find('.module-card-head input.custom-control-input').first();
    var key = $main.attr('id') || '';
    var info = PosnicPro.settings.featureInfo[key] || {};
    var title = $.trim($card.find('.module-title').text());
    var desc = $.trim($card.find('.module-desc').text());

    PosnicPro.settings._fpCard = $card;
    $('#fp_icon').html($card.find('.module-ico').html() || '');
    $('#fp_title').text(title);
    $('#fp_tagline').text(info.tagline || desc);
    var on = $main.is(':checked');
    $('#fp_master').prop('checked', on);
    $('#fp_state').text(on ? 'On' : 'Off')
        .toggleClass('badge-success', on)
        .toggleClass('badge-light', !on);

    var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
    var infoHtml = '';
    /*
     * Screenshots by CONVENTION, so adding one is dropping a file.
     *
     * The owner has to take these - they are pictures of his running shop and
     * nobody else can. Everything AROUND that is built here so his one action
     * is the only thing left: drop
     *
     *     static/images/features/<feature_key>-1.png   (-2, -3 ... for more)
     *
     * and it appears. No JS edit, no list to maintain, no deploy for a picture.
     * An explicit `shots` array still wins, for anything that does not fit.
     *
     * PROBED ONE AT A TIME, not three at once. Rendering -1, -2 and -3
     * speculatively costs three 404s every time a dialog opens for a feature
     * with no images - which is every feature today, seventeen of them. Asking
     * for the next only after the current one LOADS means a feature with no
     * screenshot costs exactly one failed request, and a feature with five
     * costs five successes and one failure. The chain extends itself.
     *
     * A missing file removes its own tag, and the strip removes itself once
     * empty, so nothing shows a row of broken-image icons.
     *
     * The CSS fixes the frame at aspect-ratio 8/5, which is why the ask is for
     * 8:5 images - anything else is cropped to fit, not letterboxed.
     */
    var shots = info.shots || [];
    if (shots.length) {
        infoHtml += '<div class="fd-shots">' + shots.map(function (src) {
            return '<img src="' + src + '" alt="" loading="lazy"'
                + ' onerror="PosnicPro.settings._shotMissing(this);">';
        }).join('') + '</div>';
    } else if (key) {
        infoHtml += '<div class="fd-shots" data-shot-key="' + esc(key) + '">'
            + '<img src="static/images/features/' + esc(key) + '-1.png" alt="" data-shot-n="1"'
            + ' onload="PosnicPro.settings._shotNext(this);"'
            + ' onerror="PosnicPro.settings._shotMissing(this);">'
            + '</div>';
    }
    infoHtml += '<div class="q-label">About</div><p class="fd-text">' + esc(info.about || desc) + '</p>';
    if ((info.benefits || []).length) {
        infoHtml += '<div class="q-label">Why use it</div><ul class="fd-list">'
            + info.benefits.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
    }
    if ((info.how || []).length) {
        infoHtml += '<div class="q-label">How it works</div><ol class="fd-list">'
            + info.how.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ol>';
    }
    infoHtml += '<p class="text-muted mt-3 mb-0" style="font-size:13px;">Switching off never deletes anything - switch back on and everything returns.</p>';
    $('#fp_info').html(infoHtml);

    // adopt ONLY this feature's settings section from the store
    PosnicPro.settings._fpReturnSection();
    var $set = $('#fp_settings').empty();
    if (info.section && $(info.section).length) {
        PosnicPro.settings._fpSection = info.section;
        $set.append($(info.section).children());
    }
    $('#fp_settings_title').toggle($set.children().length > 0);

    // show the page pane, keep the Features nav highlighted
    $('#v-pills-modules').removeClass('show active');
    $('#v-pills-featureconf').addClass('show active');
};
PosnicPro.settings._fpReturnSection = function () {
    if (PosnicPro.settings._fpSection) {
        $(PosnicPro.settings._fpSection).append($('#fp_settings').children());
        PosnicPro.settings._fpSection = null;
    }
};
PosnicPro.settings.closeFeaturePage = function () {
    PosnicPro.settings._fpReturnSection();
    PosnicPro.settings._fpCard = null;
    $('#v-pills-featureconf').removeClass('show active');
    $('#v-pills-modules').addClass('show active');
};
$(document).on('click', '#fp_back', function () {
    PosnicPro.settings.closeFeaturePage();
});
$(document).on('change', '#fp_master', function () {
    var $c = PosnicPro.settings._fpCard;
    if (!$c) { return; }
    var on = $(this).is(':checked');
    $c.find('.module-card-head input.custom-control-input').first()
        .prop('checked', on).trigger('change');
    $('#fp_state').text(on ? 'On' : 'Off')
        .toggleClass('badge-success', on)
        .toggleClass('badge-light', !on);
});
// leaving settings altogether returns the section too
$(window).on('hashchange', function () {
    if (!/settings/i.test(window.location.hash || '')) {
        PosnicPro.settings._fpReturnSection();
    }
});
// the whole card is the door to the feature's page
$(document).on('click', '#v-pills-modules .module-card', function (e) {
    if ($(e.target).closest('input, select, textarea, label, a, button, .custom-control').length) { return; }
    PosnicPro.settings.openFeaturePage($(this));
});

/*
 * Putting the sample data back, with something to watch while it happens.
 *
 * Owner ask: "when demo data enabled again. we can do insert data by progress
 * bar."
 *
 * Switching Demo Data off only hides, so turning it back on is usually
 * instant - the rows never went anywhere. This is for the shop that removed
 * the samples for good: without it, the switch appears to do nothing, because
 * there is nothing left to unhide.
 *
 * THE BAR IS HONEST ABOUT WHAT IT KNOWS. The server does the work in one
 * request and cannot report a percentage, so this does not invent one: it
 * eases towards nine tenths while waiting and only completes when the answer
 * arrives. A bar that marches confidently to 100% and then sits there is worse
 * than no bar, because it says the work is done when it is not.
 */
PosnicPro.settings.demoProgress = {
    _timer: null,
    _pct: 0,

    open: function () {
        var self = PosnicPro.settings.demoProgress;
        if (!$('#demo_progress_modal').length) {
            $('body').append(
                '<div class="modal fade" id="demo_progress_modal" tabindex="-1" role="dialog"' +
                ' data-backdrop="static" data-keyboard="false">' +
                '  <div class="modal-dialog modal-dialog-centered modal-sm" role="document">' +
                '    <div class="modal-content">' +
                '      <div class="modal-body text-center" style="padding:26px 22px;">' +
                '        <h5 style="margin:0 0 6px;font-size:16px;">Adding the sample data</h5>' +
                '        <p id="demo_progress_step" class="text-muted"' +
                '           style="font-size:13px;margin:0 0 14px;">Getting ready…</p>' +
                '        <div class="demo-progress-track"><div id="demo_progress_bar"' +
                '             class="demo-progress-bar"></div></div>' +
                '      </div>' +
                '    </div>' +
                '  </div>');
        }
        self._pct = 0;
        self._set(4, 'Getting ready…');
        $('#demo_progress_modal').modal('show');

        /*
         * Named steps rather than a silent crawl. The shop is watching a bar
         * for a few seconds and "Adding products" tells them what they are
         * getting; a bar on its own tells them only to wait.
         */
        var steps = [
            [12, 'Adding categories…'],
            [30, 'Adding products…'],
            [55, 'Adding photographs…'],
            [72, 'Adding sample sales…'],
            [85, 'Adding sample quotes…'],
        ];
        var i = 0;
        self._timer = window.setInterval(function () {
            if (i < steps.length) {
                self._set(steps[i][0], steps[i][1]);
                i++;
                return;
            }
            /* Past the named steps it creeps, and never reaches the end on its
               own - the end belongs to the server's answer. */
            self._set(Math.min(90, self._pct + 1), null);
        }, 600);
    },

    _set: function (pct, label) {
        PosnicPro.settings.demoProgress._pct = pct;
        $('#demo_progress_bar').css('width', pct + '%');
        if (label) { $('#demo_progress_step').text(label); }
    },

    close: function (message, ok) {
        var self = PosnicPro.settings.demoProgress;
        if (self._timer) { window.clearInterval(self._timer); self._timer = null; }
        self._set(100, ok ? 'Done' : 'Stopped');
        /* A beat at 100% so the bar is seen to finish rather than vanishing
           mid-way, which reads as a crash. */
        window.setTimeout(function () {
            $('#demo_progress_modal').modal('hide');
            if (message) { PosnicPro.alert(ok ? 'success' : 'error', message); }
        }, 450);
    }
};

/*
 * Only when the switch has just been turned ON, and only if there is nothing
 * there.
 *
 * The server refuses a second seed, so a stray call is harmless - but calling
 * it on every features save would put a progress bar in front of somebody who
 * changed the tax switch, which is its own small insult.
 */
PosnicPro.settings.restoreDemoDataIfEmpty = function () {
    var on = $('#module_demo_data_enable').is(':checked');
    var was = PosnicPro.settings._demoWasOn;
    PosnicPro.settings._demoWasOn = on;
    if (!on || was !== false) { return; }

    PosnicPro.settings.demoProgress.open();
    PosnicPro.post({ url: 'items/demo', data: JSON.stringify({}) }, function (response) {
        PosnicPro.settings.demoProgress.close(response.message, response.type === 'success');
    }, function (xhr) {
        var resp = {};
        try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
        /*
         * "Already here" is the ordinary case - the switch only hides, so the
         * rows are usually still there. Closing quietly is right: the shop
         * asked to see the samples and they are about to, which is the answer
         * they wanted.
         */
        var msg = resp.message || '';
        var harmless = /already/i.test(msg);
        PosnicPro.settings.demoProgress.close(harmless ? null : (msg || 'Could not add the sample data'), harmless);
    });
};
