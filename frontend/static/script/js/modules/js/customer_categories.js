PosnicPro.customercategory = {
    categoryAction: 'add',
    showAdd: function () {
        PosnicPro.HideSideBarModal();
        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
        $(".infobar-settings-sidebar").removeClass("sidebarshow");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $(".vertical-layout").removeClass("toggle-menu");
        $('#v-pills-customer-tab,.customer_new_shortcut').addClass('active');
        $('#v-pills-customer').addClass('show active');
        $('#page_customercategory').addClass('active');
        PosnicPro.showAddModal('customercategory');
        PosnicPro.customercategory.addCategoryButton();
        $('#customercategory_reset').show();
        $('.customercategory_edit_reset').hide();
        $('.add_new_tooltip').tooltip("hide");
        if (PosnicPro.customercategory.categoryAction === 'edit') {
            PosnicPro.customercategory.categoryClearForm();
        }
        PosnicPro.customercategory.categoryAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-customercategory");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('customercategory');
        PosnicPro.customercategory.editCategory(id);
        $('#v-pills-inventory').addClass('show active');
        $('#category_discount').show();
        $('#customercategory_reset').hide();
        $('.customercategory_edit_reset').show();
        $('.customercategory_edit_reset').attr("id", id);
        PosnicPro.customercategory.categoryAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'customerCategory');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-category");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('customercategory');
        PosnicPro.customercategory.viewCategory(id);
    },
    customercategoryTable: function () {
        var loader = $(".loader-table-customercategory");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('customercategory');
        var table = $('#view_customercategory');
        var params = {
            url: 'customerCategory',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_customercategory_per_page  option:selected').text()),
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
                $('#view_customercategory_total').text(response.data.total);

                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.customercategory_header').hide();
                    $('#customercategory_img_hide').show();

                } else {
                    $('#customercategory_img_hide').hide();
                    $('.customercategory_header').show();
                }
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_customercategory_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_customercategory_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "category" data-access = "read" href="#/customercategory/' + row._id + '" data-id="customercategory/' + row._id + '"  data-toggle="tooltip" title="View Category" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "category" data-access = "write" href="#/customercategory/' + row._id + '/edit" data-id="customercategory/' + row._id + '/edit"  data-toggle="tooltip" title="Edit Category" class="point-curso mobile_tooltipr"><i class="feather icon-edit"></i></a>' +
                            '<a data-module = "category" data-access = "delete" href="#/customercategory/' + row._id + '/delete" data-id="customercategory/' + row._id + '/delete" data-toggle="tooltip" title="Delete Category" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';

                    var trow = '<tr> \n\
                                <th><input type="checkbox" class="customercategory-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'customercategory\');"></th> <th scope="row">' + row_no + '</th>  \n\
                                <td><a href="#/customercategory/' + row._id + '" ><i data-toggle="tooltip" class="table_model_item">' + row.name + '</i></a></td> \n\
                                <td>' + row.description + '</td> ' +
                            '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';

                    $('#view_customercategory').children('tbody').append(trow);
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
                PosnicPro.setSelectedCheckbox(PosnicPro["customercategory_checkbox"], 'customercategory');
                PosnicPro.ACLForModule('customer');

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
        var loader = $(".loader-table-customercategory");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#customercategory').show();
        $('#customercategory_new,#customercategory_view').modal('hide');
        $('#page_customercategory').addClass('active');
        $('#v-pills-customer-tab').addClass('active');
        $('#v-pills-customer').addClass('show active');
        PosnicPro.customercategory.customercategoryTable('customercategory');
        $('.dashboard_img_menu').hide();

    },
    /*This Categories Function Used To Add & Edit*/
    category: function () {
        var loader = $(".loader-customercategory");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var method = 'POST';
        var url = 'customerCategory';
        if ($('#customercategory_id').val() === '') {
            PosnicPro.action = 'add';
        } else {
            method = 'PUT';
            url += '/' + $('#customercategory_id').val();
            PosnicPro.action = 'edit';
        }
        var params = {
            method: method,
            url: url,
            data: JSON.stringify(PosnicPro.getFormData($('.customercategory_add')))
        };
        PosnicPro.request(params, function (response) {

            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                $(".customercategory_add").trigger('reset');
                if (PosnicPro.action === 'add') {
                    PosnicPro.customercategory.customercategoryTable('customercategory');
                    $('#show_last_created_customercategory').show();
                    var path = '#/customercategory/' + response.data;
                    $('#last_created_customercategory').attr('href', path);
                }
                if (PosnicPro.action === 'edit') {
                    $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                    $("#infobar-settings-sidebar-customercategory").removeClass("sidebarshow");
                    hasher.setHash('customercategory');
                }                        
                PosnicPro.customercategory.loadSelectCustomereCategory();
                PosnicPro.alert(response.type, response.message);        
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    /*Display the category details*/
    viewCategory: function (id) {
        var loader = $(".loader-view-category");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('customerCategory/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.customercategory.viewCategoryData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    viewCategoryData: function (response) {
        $('#v-pills-inventory').addClass('show active');
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-customercategory-details").addClass("sidebarview");
        $("#customercategory-detail-tab").addClass("active");
        $("#customercategory-sale-tab").removeClass("active");
        $("#customercategory_detail").addClass("active show");
        $("#customercategory_sale").removeClass("active show");
        var data = response.data;
        $.each(data, function (key, val) {
            if (val === '') {
                $('#customercategory_view_' + key).html('');
            } else {
                $('#customercategory_view_' + key).html(val);
            }
        });
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#customercategory_view_created_date').html(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#customercategory_view_updated_date').html(updateUpdateDate);
    },
    /*Edit category details*/
    editCategory: function (id) {
        $('#category_value_check').val('');
        var loader = $(".loader-customercategory");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-customercategory").addClass("sidebarshow");
        var params = {
            url: 'customerCategory/getCategoryDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#customercategory_new').modal('show');
                data = response.data;
                PosnicPro.record_id = id;
                $('#customercategory_id').val(PosnicPro.record_id);
                $('#customercategory_name').val(data.name);
                $('#customercategory_description').val(data.description);
                if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                    $('#customercategory_title').text('திருத்தப்பட்ட');
                    $('#customercategory_button_title').text('புதுப்பி');
                } else {
                    $('#customercategory_title').text('Edit');
                    $('#customercategory_button_title').text('Update');
                }
                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
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
        PosnicPro.customercategory.editCategory(id);
    },
    addCategoryButton: function () {
        var loader = $(".loader-customercategory");
        loader.find(".loadingSpinner:first").remove();
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#customercategory_title').text('புதிய');
            $('#customercategory_button_title').text('சேமி');
        } else {
            $('#customercategory_title').text('Add');
            $('#customercategory_button_title').text('Save');
        }
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#customercategory_id').val('');
        $('#customercategory_new .alert').remove();
        $('#show_last_created_customercategory').hide();
    },
    exportCategories: function () {
        PosnicPro.exportTableData(PosnicPro.customercategory_checkbox, 'customerCategory');
    },
    deleteSelectedCategories: function () {
        PosnicPro.deleteTableData(PosnicPro.customercategory_checkbox, 'customerCategory');
    },
    categoryClearForm: function () {
        $(".customercategory_add")[0].reset();
        $('.error_category').css('display', 'none');
        $('#customercategory_description').html('');
    },
    validForm: function () {

        // validate signup form on keyup and submit
        $(".customercategory_add").validate({
            errorClass: 'error error_category',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                name: {
                    required: true,
                    cname: true,
                    minlength: 3,
                    maxlength: 50
                },
                description: {
                    minlength: 3,
                    maxlength: 500
                }
            },
            messages: {
                name: {
                    required: "Please Enter a Category Name",
                    minlength: "Category Name must consist of at least 3 Characters",
                    maxlength: "Category name should not be more than 250 characters"
                },
                description: {
                    minlength: "Category Discription must be at least 3 Characters",
                    maxlength: "Discription is too Long !"
                }
            }
        });
        $(".customercategory_add").submit(function (event) {
            event.preventDefault();
            if ($('.customercategory_add').valid()) {            // checks form for validity
                PosnicPro.customercategory.category();
            }
        });
    },
    loadSelectCustomereCategory: function () {

        var categorySelect = $('.customer_category');
        var params = {
            url: 'customerCategory/getCustomerCategoryAjaxList',
            data: 'query='
        };
        PosnicPro.get(params, function (response) {
            categorySelect.empty();
            suggestions: $.map(response.suggestions, function (dataItem) {
                var option;
                option += '<option value="' + dataItem.id + '" data-category-name="' + dataItem.name + '" data-category-id="' + dataItem.id + '" data-item-discountamount="' + dataItem.discount_amount + '" data-item-discountpercentage="' + dataItem.discount_percentage + '">' + dataItem.name + ' </option>';
                categorySelect.append(option).select2();
            });
            $(".customer_category").val(1).trigger('change.select2');
            $(".customer_category").select2({
                placeholder: "Choose a customer category"
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
    }
};
$("#customercategorySubmitForm").one('click', function () {
    PosnicPro.customercategory.validForm();
});

$("#customercategory_new").on('shown.bs.modal', function () {
    $(this).find('#customercategory_name').focus();
});
$(document).ready(function () {
    PosnicPro.customercategory.loadSelectCustomereCategory();
});

PosnicPro.customercategorydetails = {

    customercategorydetailsTable: function (type) {
        PosnicPro.appendReportTableBody('customerdetails');
        var loader = $(".loader-customercategoryactivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_customercategorydetails');
        if ($('a#page_customercategory').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#customer_branch_value").val()
        }
        if (type === 'customercategoryreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_customercategorydetails_per_page').val();
        }
        let category_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            category_id: category_id[1],
            branch: branch
        };
        var params = {
            url: 'sales/customerCategorySaleDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'customercategoryreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_customercategorydetails_total,.customercategory_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_customercategorydetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_customercategorydetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.customercategoryactivity_content').hide();
                        $('#customercategoryactivity_img_hide').show();

                    } else {
                        $('#customercategoryactivity_img_hide').hide();
                        $('.customercategoryactivity_content').show();
                    }
                    var process_class = "badge badge-success-inverse";
                    var saleTotalValue = 0;
                    var returnTotalValue = 0;
                    var salesTotalQty = 0;
                    var returnTotalQty = 0;
                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        let row = response.data.table.data.list[i];
                        saleTotalValue += row.items_total;
                        returnTotalValue += row.items_return_total;
                        if (row.sale_process == 'Add') {
                            process_class = "badge badge-success-inverse";
                        } else if (row.sale_process == 'Edit') {
                            process_class = "badge badge-primary-inverse";
                        } else if (row.sale_process == 'PartialReturn') {
                            process_class = "badge badge-secondary-inverse";
                        } else {
                            process_class = "badge badge-danger-inverse";
                        }
                        let salesQty = 0;
                        $(row.items).each(function (key, val) {
                            salesQty += val.item_quantity;
                            salesTotalQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(row.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                                returnTotalQty += val.item_quantity;
                            });
                        });
                        let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                        // Prefer backend-provided string_date, but gracefully
                        // fall back to raw date fields so we never show the
                        // current time when no preformatted date is present.
                        let rawDate = row.string_date || row.date || row.created_date || row.updated_date;
                        let updateDate = rawDate ? PosnicPro.convertDate(rawDate) : '';
                        let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.sales_id + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-center"><span class="' + process_class + '">' + row.sale_process + '</span></td> <td class="text-center text-danger">' + returnQty + '</td> <td class="text-right text-danger">' + currency + '&nbsp;' + row.items_return_total.toFixed(2) + '</td><td class="text-center text-success">' + salesQty + '</td><td class="text-right text-success">' + currency + '&nbsp;' + row.items_total.toFixed(2) + '</td></tr>';
                        $('#view_customercategorydetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }

                    // Show summary values with clean rounding so we avoid
                    // long floating point tails like 1499.3600000000001
                    var saleTotalDisplay = Number(saleTotalValue.toFixed(2));
                    var returnTotalDisplay = Number(returnTotalValue.toFixed(2));

                    $('.customercategory_details_totalsale').html(salesTotalQty);
                    $('.customercategory_details_totalreturn').html(returnTotalQty);
                    $('.customercategory_details_saletotalvalue').html(saleTotalDisplay);
                    $('.customercategory_details_returntotalvalue').html(returnTotalDisplay);

                } else {
                    var customercategorysalesreport = [];
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
                        customercategorysalesreport.push({SalesId: saleId, Date: date, Process: process, NoOfReturn: returnQty, ReturnAmount: returnTotal, NoOfSale: salesQty, SaleAmount: saleTotal});
                    });
                    PosnicPro.JSONToCSVConvertor(customercategorysalesreport, 'customercategory-sales-reports', true);
                    PosnicPro.customercategorydetails.customercategorydetailsTable();
                }

            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    customercategorydetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.customercategorydetails.customercategorydetailsTable(type);
    }
};

/*end*/

