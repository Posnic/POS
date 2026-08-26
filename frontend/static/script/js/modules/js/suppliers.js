PosnicPro.suppliers = {
    supplierAction: 'add',
    supplier_phone: null,
    showAdd: function () {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-purchase-tab,.supplier_new_shortcut').addClass('active');
        $('#v-pills-purchase').addClass('show active');
        $('.vertical-menu li a#view_suppliers_page').addClass('active');
        PosnicPro.showAddModal('supplier');
        $('#supplier_reset').show();
        $('.supplier_edit_reset').hide();
        $('#supplier_country').val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        PosnicPro.local.set('edit_supplier_state', PosnicPro.local.get("state_setting"));
        PosnicPro.suppliers.loadSelectSupplierState(PosnicPro.local.get('countryid'), 'add');
        PosnicPro.suppliers.addSupplierButton();
        $('.add_new_tooltip').tooltip("hide");
        if (PosnicPro.suppliers.supplierAction === 'edit') {
            PosnicPro.suppliers.supplierClearForm();
        }
        PosnicPro.suppliers.supplierAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-supplier");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('suppliers');
        PosnicPro.suppliers.editSupplier(id);
        $('#supplier_reset').hide();
        $('.supplier_edit_reset').show();
        $('.supplier_edit_reset').attr("id", id);
        PosnicPro.suppliers.supplierAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'suppliers');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-supplier");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('suppliers');
        PosnicPro.suppliers.viewSupplier(id);
    },

    suppliersTable: function () {
        var loader = $(".loader-table-supplier");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('suppliers');
        var table = $('#view_suppliers');
        var params = {
            url: 'suppliers',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_suppliers_per_page  option:selected').text()),
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
                $('#view_suppliers_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.supplier_header').hide();
                    $('#supplier_img_hide').show();

                } else {
                    $('#supplier_img_hide').hide();
                    $('.supplier_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_suppliers_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_suppliers_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var phone = row.phone || '';
                    var email = row.email || '';
                    var address = row.address || '';
                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "supplier" data-access = "read" href="#/suppliers/' + row._id + '" data-id="suppliers/' + row._id + '"  data-toggle="tooltip" title="View Supplier" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "supplier" data-access = "write" href="#/suppliers/' + row._id + '/edit" data-id="suppliers/' + row._id + '/edit"  data-toggle="tooltip" title="Edit Supplier" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>' +
                            '<a data-module = "supplier" data-access = "delete" href="#/suppliers/' + row._id + '/delete" data-id="suppliers/' + row._id + '/delete" data-toggle="tooltip" title="Delete Supplier" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad supplier_onclick" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';


                    var trow = '<tr><td><input type="checkbox" class="suppliers-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'suppliers\');"></td> <td scope="row" data-label="#">' + row_no + '</td>  <td width="30%" data-label="Name"><a href="#/suppliers/' + row._id + '"><i class="table_model_item">' + row.name + '</i></a></td> <td class="text-right" data-label="Phone"><a href="tel:' + phone + '" class="sale_color">' + phone + '</a></td> <td width="15%" data-label="Email"><a href="mailto:' + email + '" class="sale_color">' + email + '</a></td> <td width="40%" data-label="Address">' + address + '</td> ' +
                            '<td width="15%" class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';
                    $('#view_suppliers').children('tbody').append(trow);
                }
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

                PosnicPro.setSelectedCheckbox(PosnicPro["suppliers_checkbox"], 'suppliers');
                PosnicPro.ACLForModule('supplier');
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
        var loader = $(".loader-table-supplier");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#suppliers').show();
        $('#suppliers_new,#suppliers_view').modal('hide');
        PosnicPro.suppliers.suppliersTable('suppliers');
        $('#v-pills-purchase-tab').addClass('active');
        $('#v-pills-purchase').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_supply').show();
    },
    triggerModules: function () {
        PosnicPro.showAddModal('supplier');
        PosnicPro.suppliers.addSupplierButton();
        var hash = window.location.hash.slice(1);
        if (hash === '/receivings/suppliers/new' || hash === '/items/suppliers/new') {
            $('#supplier_name').val('');
        } else if (hash === '/receivings/new') {
            $('#supplier_name').val($('#receiving_add_supplier_name').val());
        } else {
            $('#supplier_name').val($('#items_supplier').val());
        }
        $('#supplier_reset').show();
        $('.supplier_edit_reset').hide();
    },
    /*This suppliers Function Used To Add & Edit function*/
    supplier: function () {
        if ($('#supplier_name').val() !== '' && PosnicPro.validateEmail($('#supplier_email').val())) {
            var loader = $(".loader-supplier");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.action = 'add';
            var method = 'POST';
            var url = 'suppliers';
            if ($('#supplierid').val() !== '') {
                PosnicPro.action = 'edit';
                method = 'PUT';
                url += '/' + $('#supplierid').val();
            }
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(PosnicPro.getFormData($('#supplier_add')))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {
                    /*This function while add new item from another page after complete add items go to previous page*/
                    /*START*/
                    loader.find(".loadingSpinner:first").remove();
                    var data = response.data;
                    var supplierId = data.supplier_id || data.id || data._id;
                    var supplierName = data.supplier_name || data.name;
                    var supplierAddress = data.supplier_address || data.address;
                    var supplierPhone = data.supplier_phone || data.phone;
                    var supplierEmail = data.supplier_email || data.email;
                    var supplierGstType = data.supplier_gst_type || data.gst_type;
                    var supplierGstNumber = data.supplier_gst_number || data.gst_number;
                    var hash = window.location.hash.slice(1);
                    if (hash === '/receivings/suppliers/new') {
                        hasher.changed.active = false; //disable changed signal
                        hasher.replaceHash('receivings/new');
                        $('#receiving_add_supplier_id').val(supplierId);
                        $('#receiving_add_supplier_name').val(supplierName);
                        $('#receiving_add_supplier_address').val(supplierAddress);
                        $('#receiving_add_supplier_phone').val(supplierPhone);
                        $('#receiving_add_supplier_email').val(supplierEmail);
                        $('#receiving_add_supplier_gst_type').val(supplierGstType);
                        $('#receiving_add_supplier_gst_number').val(supplierGstNumber);
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-supplier").removeClass("sidebarshow");
                        hasher.changed.active = true; //enable changed signal
                    }
                    if (hash === '/items/suppliers/new') {
                        hasher.changed.active = false; //disable changed signal
                        $('#items_supplier_id').val(supplierId);
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-supplier").removeClass("sidebarshow");
                        $("#infobar-settings-sidebar-item").addClass("sidebarshow");
                        $('#items_supplier').val(supplierName);
                        $('#supplier_check').val('yes');
                        hasher.changed.active = true; //enable changed signal
                        hasher.replaceHash('items/new');
                        $('.error_item').css('display', 'none');
                    }
                    if (PosnicPro.action === 'add') {
                        PosnicPro.suppliers.suppliersTable('suppliers');
                        $('#show_last_created_supplier').show();
                        var path = '#/suppliers/' + supplierId;
                        $('#last_created_supplier').attr('href', path);
                    }
                    if (PosnicPro.action === 'edit') {
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-supplier").removeClass("sidebarshow");
                        hasher.setHash('suppliers');
                    }
                    $(".supplier-trigger").val('');
                    PosnicPro.alert(response.type, response.message);
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
    /*To display the supplier details form*/
    viewSupplier: function (id) {
        var loader = $(".loader-view-supplier");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('suppliers/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.suppliers.viewSupplierData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    viewSupplierData: function (response) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-supplier-details").addClass("sidebarview");
        $("#supplier-detail-tab").addClass("active");
        $("#supplier-receiving-tab").removeClass("active");
        $("#supplier_detail").addClass("active show");
        $("#supplier_receiving").removeClass("active show");
        var data = response.data;
        $('#supplier_view_phone_icon').attr('href', 'tel:' + data.phone);
        $('#supplier_view_email_icon').attr('href', 'mailto:' + data.email);
        $.each(data, function (key, val) {
            if (val === '') {
                $('#supplier_view_' + key).text('');
                $('#supplier_view_' + key + '_icon').hide();
            } else {
                $('#supplier_view_' + key + '_icon').show();
                $('#supplier_view_' + key).text(val);
            }
        });
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#supplier_view_created_date').text(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#supplier_view_updated_date').text(updateUpdateDate);

        $('.indian-gstr').hide();
        if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
            $('.indian-gstr').show();
        }

    },
    /*Edit supplier details*/
    editSupplier: function (id) {
        var loader = $(".loader-supplier");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-supplier").addClass("sidebarshow");
        var params = {
            url: 'suppliers/getSupplierDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#suppliers_new').modal('show');
                data = response.data;
                PosnicPro.record_id = id;
                $('#supplierid').val(PosnicPro.record_id);
                $('#supplier_name').val(data.name);
                $('#supplier_phone').val(data.phone);
                $('#supplier_email').val(data.email);
                $('#supplier_address').val(data.address);
                if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                    $('#supplier_title').text('திருத்தப்பட்ட');
                    $('#supplier_button_title').text('புதுப்பி');
                } else {
                    $('#supplier_title').text('Edit');
                    $('#supplier_button_title').text('Update');
                }
                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                $('#supplier_country').val(data.country).trigger('change.select2');
                PosnicPro.local.set('edit_supplier_state', data.state);
                var countryDetail = $('#supplier_country').select2("data");
                PosnicPro.suppliers.loadSelectSupplierState(countryDetail[0].element.attributes['data-setting-id'].value, 'edit');
                $('#supplier_city').val(data.city);
                $('.indian-gstr').hide();
                if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
                    $('.indian-gstr').show();
                    $("#supplier_gst_type option[value='" + data.gst_type + "']").prop("selected", true);
                    $('#supplier_gstin_number').val(data.gst_number);
                    $('.supplier-gstr-number').hide();
                    if (data.gst_type !== 'consumer' && data.gst_type !== '') {
                        $('.supplier-gstr-number').show();
                    }
                }
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        PosnicPro.suppliers.editSupplier(id);
    },
    addSupplierButton: function () {
        var loader = $(".loader-supplier");
        loader.find(".loadingSpinner:first").remove();
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#supplier_title').text('புதிய');
            $('#supplier_button_title').text('சேமி');
        } else {
            $('#supplier_title').text('Add');
            $('#supplier_button_title').text('Save');

        }
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#supplierid').val('');
        $('#suppliers_new .alert').remove();
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $('.supplier-gstr-number').hide();
        $('#show_last_created_supplier').hide();
    },
    exportSuppliers: function () {
        PosnicPro.exportTableData(PosnicPro.suppliers_checkbox, 'suppliers');
    },
    deleteSelectedSuppliers: function () {
        PosnicPro.deleteTableData(PosnicPro.suppliers_checkbox, 'suppliers');
    },
    gstFields: function () {
        $('.supplier-gstr-number').hide();
        if ($('#supplier_gst_type').val() !== 'consumer') {
            $('.supplier-gstr-number').show();
        }
    },
    supplierClearForm: function () {
        $('#supplier_add')[0].reset();
        $('#supplier_country').val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        PosnicPro.local.set('edit_supplier_state', PosnicPro.local.get("state_setting"));
        PosnicPro.suppliers.loadSelectSupplierState(PosnicPro.local.get('countryid'), 'clear');
        $("#supplier_gst_type option[value='" + data.gst_type + "']").prop("selected", false);
        $('.supplier-gstr-number').hide();
        $('.error_supplier').css('display', 'none');
    },
    loadSelectSupplierState: function (id, action) {
        var stateSelect = $('#supplier_state');
        var params = {
            url: 'setting/getJSONState',
            data: {id: id}
        };
        PosnicPro.get(params, function (response) {
            stateSelect.empty();
            suggestions: $.map(response.data['stateJsonArray'], function (dataItem) {
                var options;
                options += '<option value="' + dataItem + '">' + dataItem + ' </option>';
                stateSelect.append(options).trigger('change');
            });
            // Pre-select the stored state for every action, not just edit: the
            // add/clear paths store the shop's own state (state_setting), so a
            // new supplier now defaults to the shop's state instead of whatever
            // sorts first in the list. Falls back to the first option only when
            // no state is stored.
            if (PosnicPro.local.get('edit_supplier_state') !== '') {
                 stateSelect.val(PosnicPro.local.get('edit_supplier_state')).trigger('change.select2');
            } else {
                $('#supplier_state option:eq(0)').prop('selected', true);
            }
            (PosnicPro.suppliers.supplier_phone || { setCountry: function () {} }).setCountry(response.data['countrySortName']);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    validForm: function () {

        $("#supplier_add").validate({
            errorClass: 'error error_supplier',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                name: {
                    required: true,
                    minlength: 3,
                    maxlength: 250,
                    cname: true
                },
                address: {
                    minlength: 3,
                    maxlength: 500
                },
                email: {
                    email: true,
                    emailExt: true,
                    maxlength: 250
                },
                phone: {
                    minlength: 3,
                    maxlength: 20,
                    supplier_phone_number: true
                },
                city: {
                    city: true,
                    maxlength: 20
                },
                gstin_number: {
                    required: true,
                    gst: true,
                    minlength: 15,
                    maxlength: 15
                }
            },
            messages: {
                name: {
                    required: "Enter the supplier name",
                    minlength: "Supplier Name Must be Atleast 3 Characters",
                    maxlength: "Supplier name should not be more than 250 characters"
                },
                address: {
                    minlength: "Supplier Address must be Atleast 3 Characters long",
                    maxlength: "Address is too Long !"
                },
                email: {
                    maxlength: "Email should not be more than 250 Characters"
                },
                phone: {
                    supplier_phone_number: "Enter a valid phone number",
                    minlength: "Use at least 3 characters",
                    maxlength: "Use no more than 20 characters"
                },
                city: {
                    maxlength: "Supplier city should not be more than 20 Characters"
                },
                gstin_number: {
                    required: "Enter a valid GSTIN",
                    minlength: "Gstr must be Atleast 15 Characters long",
                    maxlength: "Gstr should not be more than 15 digits"
                }
            }
        });
        jQuery.validator.addMethod("supplier_phone_number", function (phone_number, element) {
            // If the field is empty, allow it to be valid
            if (!phone_number) {
                return true;  // Allow blank phone number
            }
            let valid = PosnicPro.suppliers.supplier_phone.isValidNumber();
            let num = PosnicPro.suppliers.supplier_phone.getNumber();
            if (valid === true) {
                $('#supplier_phone').val(num);
                return true;
            } else {
                return false;
            }

        }, "Enter a valid phone number");
        jQuery.validator.addMethod("gst", function (value, element) {
            return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(value);
        }, "Enter a valid GSTIN");
        $("#supplier_add").submit(function (event) {
            event.preventDefault();
            if ($('#supplier_add').valid()) {            // checks form for validity
                PosnicPro.suppliers.supplier();
            }
        });
    }

};
PosnicPro.supplierdetails = {

    supplierdetailsTable: function (type) {
        PosnicPro.appendReportTableBody('supplierdetails');
        var loader = $(".loader-supplieractivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_supplierdetails');
        if ($('a#view_suppliers_page').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#supplier_branch_value").val()
        }
        if (type === 'supplierreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_supplierdetails_per_page').val();
        }
        let supplier_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            supplier_id: supplier_id[1],
            branch: branch
        };
        var params = {
            url: 'receivings/supplierReceivingDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'supplierreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_supplierdetails_total,.supplier_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_supplierdetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_supplierdetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.supplieractivity_content').hide();
                        $('#supplieractivity_img_hide').show();

                    } else {
                        $('#supplieractivity_img_hide').hide();
                        $('.supplieractivity_content').show();
                    }
                    var process_class = "badge badge-success-inverse";
                    var purchaseTotalValue = 0;
                    var returnTotalValue = 0;
                    var purchaseTotalQty = 0;
                    var returnTotalQty = 0;
                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        var row = response.data.table.data.list[i];
                        purchaseTotalValue += Number(row.items_total) || 0;
                        returnTotalValue += Number(row.items_return_total) || 0;
                        if (row.receiving_status == 'Received') {
                            process_class = "badge badge-success-inverse";
                        } else if (row.receiving_status == 'PartialReturn') {
                            process_class = "badge badge-secondary-inverse";
                        } else {
                            process_class = "badge badge-danger-inverse";
                        }
                        let purchaseQty = 0;
                        $(row.items).each(function (key, val) {
                            purchaseQty += val.item_quantity;
                            purchaseTotalQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(row.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                                returnTotalQty += val.item_quantity;
                            });
                        });
                        let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        let updateDate = PosnicPro.convertDate(row.string_date);
                        let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.receiving_id + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-center"><span class="' + process_class + '">' + row.receiving_status + '</span></td> <td class="text-center text-danger">' + returnQty + '</td> <td class="text-right text-danger">' + currency + '&nbsp;' + (Number(row.items_return_total) || 0).toFixed(2) + '</td><td class="text-center text-success">' + purchaseQty + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + (Number(row.items_total) || 0).toFixed(2) + '</span></td></tr>';
                        $('#view_supplierdetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }
                    $('.supplier_details_totalpurchase').html(purchaseTotalQty);
                    $('.supplier_details_totalreturn').html(returnTotalQty);
                    // Prefer the server's COMPLETE purchase/return totals for
                    // this supplier, not a sum over just the loaded page.
                    var supPurchaseTotal =
                        response.data.purchase_amount !== undefined && response.data.purchase_amount !== null
                            ? Number(response.data.purchase_amount)
                            : purchaseTotalValue;
                    var supReturnTotal =
                        response.data.return_amount !== undefined && response.data.return_amount !== null
                            ? Number(response.data.return_amount)
                            : returnTotalValue;
                    $('.supplier_details_purchasetotalvalue').html(supPurchaseTotal.toFixed(2));
                    $('.supplier_details_returntotalvalue').html(supReturnTotal.toFixed(2));
                } else {
                    var supplierreceivingreport = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        let purchaseQty = 0;
                        $(val.items).each(function (key, val) {
                            purchaseQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(val.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                            });
                        });
                        let Date = PosnicPro.convertDate(val.string_date);
                        let Recivingid = val.receiving_id;
                        let process = val.receiving_status;
                        let returnTotal = val.items_return_total;
                        let purchaseTotal = val.items_total;
                        supplierreceivingreport.push({RecivingId: Recivingid, Date: Date, Process: process, NoOfReturn: returnQty, ReturnAmount: returnTotal, NoOfSale: purchaseQty, PurchaseAmount: purchaseTotal});
                    });
                    PosnicPro.JSONToCSVConvertor(supplierreceivingreport, 'supplier-receiving-reports', true);
                    PosnicPro.supplierdetails.supplierdetailsTable();
                }
            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    supplierdetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.supplierdetails.supplierdetailsTable(type);
    }
};

$("#suppliers_new").on('shown.bs.modal', function () {
    $('#supplier_name').focus();
});
$("#supplier_gstin_number").keyup(function (event) {
    $('#supplier_country').val('India');
    var stateOption = '';
    if ($(this).val().length === 2) {
        var params = {
            url: 'setting/getJSONGstState'
        };
        PosnicPro.get(params, function (response) {
            var gst = response.data['gststate'];
            $.each(gst, function (key, val) {

                if ($('#supplier_gstin_number').val() === val.id) {
                    PosnicPro.customers.stateOption = val.value;
                    stateOption += '<option id="' + val.id + '" value="' + val.value + '">' + val.value + '</option>';
                    $('#supplier_state').html(stateOption);
                }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
});
$("#supplierSubmitForm").one('click', function () {
    PosnicPro.suppliers.validForm();
});
$('#supplier_country').one('change', function () {
    var countrySelect = $('#supplier_country');
    countrySelect.on('select2:select', function (e) {
        var data = e.params.data;
        PosnicPro.suppliers.loadSelectSupplierState(data.element.attributes['data-setting-id'].value, 'onChange');
    });
});

$(function () {
    PosnicPro.lazyPhoneInput('#supplier_phone', PosnicPro.suppliers, 'supplier_phone', {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });
});
/*end*/


