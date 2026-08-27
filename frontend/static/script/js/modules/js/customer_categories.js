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
    /* The name the OLD table machinery answered to - the save flow and the
       shared clearListFilters/refresh doors still call it. */
    customercategoryTable: function () {
        PosnicPro.customercategory.loadList(1);
    },
    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-customer-tab,#page_customercategory').addClass('active');
        $('#v-pills-customer').addClass('show active');
        $('.page-title-box,#customercategory').show();
        $('#customercategory_new,#customercategory_view').modal('hide');
        $('.dashboard_img_menu').hide();
    },
    showDataTablePage: function () {
        PosnicPro.customercategory._chrome();
        PosnicPro.customercategory.loadList(1);
    },
    mountFilters: function (force) {
        if (!$('#customercategory_filter_panel').length) { return; }
        if (!force && $('#customercategory_filter_panel').data('mounted')) { return; }
        $('#customercategory_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'customercategory',
            container: '#customercategory_filter_panel',
            button: '#customercategory_filter_btn',
            searchPlaceholder: 'Search category name',
            searchFields: [
                { value: 'all', label: 'All fields' },
                { value: 'name', label: 'Name' },
                { value: 'description', label: 'Description' }
            ],
            onChange: function () { PosnicPro.customercategory.loadList(1); }
        });
    },
    loadList: function (page) {
        PosnicPro.customercategory.mountFilters();
        var self = PosnicPro.customercategory;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('customercategory', {});
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'customerCategory',
            data: { page: self._page, limit: self.PAGE_SIZE, filters: JSON.stringify(filters) }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('customercategory') > 0;
                $('#customercategory_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? 'No customer categories match this filter.' : 'No customer categories yet - press New to add the first.') + '</div>');
                $('#customercategory_list_paging').html('');
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th>Name</th><th class="cc-col-desc">Description</th><th style="width:90px;"></th></tr></thead><tbody>';
            list.forEach(function (r) {
                html += '<tr class="md-row customercategory-row highlight-select" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td>' + esc(r.name) + '</td>'
                    + '<td class="cc-col-desc q-muted">' + esc(r.description || '-') + '</td>'
                    + '<td class="text-right" style="white-space:nowrap;">'
                    + '<a data-module="customer" data-access="write" href="#/customercategory/' + esc(r._id) + '/edit" class="btn btn-sm btn-light cc-row-act" data-toggle="tooltip" title="Edit"><i class="feather icon-edit-2"></i></a> '
                    + '<a data-module="customer" data-access="delete" href="#/customercategory/' + esc(r._id) + '/delete" class="btn btn-sm btn-light cc-row-act" data-toggle="tooltip" title="Delete"><i class="feather icon-trash-2"></i></a>'
                    + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#customercategory_list_rows').html(html);
            PosnicPro.ACLForModule('customer');
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#customercategory_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">Could not load customer categories - try again.</div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.customercategory;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + (total === 1 ? ' customer category' : ' customer categories');
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' · ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.customercategory.goPage(' + to + ');">' + text + '</button>';
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
        $('#customercategory_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.customercategory._page = n;
        PosnicPro.customercategory.loadList();
    },
    exportCsv: function () {
        var rows = [['Name', 'Description']];
        (PosnicPro.customercategory._lastRows || []).forEach(function (r) {
            rows.push([r.name, r.description || '']);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'customer-categories.csv';
        a.click();
        URL.revokeObjectURL(a.href);
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
                    required: "Enter the category name",
                    minlength: "Category Name must consist of at least 3 Characters",
                    maxlength: "Category name should not be more than 250 characters"
                },
                description: {
                    minlength: "Category description must be at least 3 characters",
                    maxlength: "Description is too long."
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
/* Standard list wiring: Filter button, row click into the details
   slide-over, row action buttons that must not also open the row. */
$(document).on('click', '#customercategory_filter_btn', function () {
    PosnicPro.customercategory.mountFilters(true);
    PosnicPro.listFilter.toggle('customercategory');
});
$(document).on('click', '#customercategory_list_rows tr.customercategory-row', function (e) {
    if ($(e.target).closest('.cc-row-act').length) { return; }
    hasher.setHash('customercategory/' + $(this).data('id'));
});

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
                        saleTotalValue += Number(row.items_total) || 0;
                        returnTotalValue += Number(row.items_return_total) || 0;
                        if (!row.sale_process || row.sale_process == 'Add') {
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
                        let trow = '<tr> <td scope="row" data-label="#">' + row_no + '</td> <td data-label="Sale">' + row.sales_id + '</td> <td class="export-date" data-label="Date">' + updateDate + '</td> <td class="text-center" data-label="Process"><span class="' + process_class + '">' + (row.sale_process || 'Add') + '</span></td> <td class="text-center text-danger" data-label="Return qty">' + returnQty + '</td> <td class="text-right text-danger" data-label="Return total">' + currency + '&nbsp;' + (Number(row.items_return_total) || 0).toFixed(2) + '</td><td class="text-center text-success" data-label="Qty">' + salesQty + '</td><td class="text-right text-success" data-label="Total">' + currency + '&nbsp;' + (Number(row.items_total) || 0).toFixed(2) + '</td></tr>';
                        $('#view_customercategorydetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }

                    // Show summary values with clean rounding so we avoid
                    // long floating point tails like 1499.3600000000001
                    // Prefer the server's COMPLETE totals for this customer
                    // category, not a sum over just the loaded page.
                    var saleTotalDisplay =
                        response.data.total && response.data.total.length
                            ? Number(Number(response.data.total[0]).toFixed(2))
                            : Number(saleTotalValue.toFixed(2));
                    var returnTotalDisplay =
                        response.data.return_total && response.data.return_total.length
                            ? Number(Number(response.data.return_total[0]).toFixed(2))
                            : Number(returnTotalValue.toFixed(2));

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
                        let process = val.sale_process || 'Add';
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

