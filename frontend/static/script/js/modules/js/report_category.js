PosnicPro.categoryreport = {

    showModuleProductDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-categoryreport-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.productdetails.productdetailsTable();
    },
    showDataTablePage: function () {
        var loader = $(".loader-category-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#categoryreport_new').show();
        $('#v-pills-report-tab,#viewcategoryreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#category-tab-line').hasClass('active')) {
            PosnicPro.categoryreport.categoryTableTabClick();
        } else {
            PosnicPro.categoryproductreport.categoryProductTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#category-line, #category-product-line').css('filter', 'blur(2px)');
            $('#categoryreport_exportbtn, #categoryproductreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#category_upgrade').show();
        } else {
            $('#category-line, #category-product-line').css('filter', 'none');
            $('#categoryreport_exportbtn, #categoryproductreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#category_upgrade').hide();
        }
    },
    categoryreportTable: function (type) {
        var branchId = $(".category_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-category-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('categoryreport');
            var daterange = $(".view_category_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_categoryreport');
            if (type === 'categoryreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_categoryreport_per_page  option:selected').text());
            }

            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".category_branch_value").val()
            };
            let category_id = ($(".categories_input_id").val() !== '') ? $(".categories_input_id").val() : '';
            var field_input = {
                field_input: category_id
            };
            if ($(".categories_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'sales/categorySalesReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#categoryreport_exportbtn').removeAttr('disabled') : $('#categoryreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'categoryreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_categoryreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.report-category-no-records').text('No Records on ' + dateRange);
                            $('.reportcategory_header').hide();
                            $('#reportcategory_img_hide, .report-category-no-records').show();
                        } else {
                            $('#reportcategory_img_hide, .report-category-no-records').hide();
                            $('.reportcategory_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_categoryreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_categoryreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="text-center">' + row.item_quantity + '</td> <td class="text-right">' + currency + '&nbsp;<span>' + row.sales_profit.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_avg + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_categoryreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var categoryreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.name;
                            var noofsold = val.item_quantity;
                            var profit = val.sales_profit;
                            var avgsale = val.sales_avg;
                            var total = val.total_amount;
                            categoryreport.push({Name: name, NoofSold: noofsold, Profit: profit, AvgSale: avgsale, Total: total});
                        });
                        PosnicPro.JSONToCSVConvertor(categoryreport, 'category-reports', true);
                        PosnicPro.categoryproductreport.categoryproductreportTable();
                        PosnicPro.categoryreport.categoryreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
                loader.find(".loadingSpinner:first").remove();
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".category_branch_value").focus();
        }
    },
    categoryreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.categoryreport.categoryreportTable(type);
    },
    categoryTableTabClick: function () {
        $('#change_category_view').data('id', 'tableView');
        PosnicPro.categoryreport.categoryreportTable();
    }
};

PosnicPro.categoryproductreport = {

    categoryproductreportTable: function (type) {
        var branchId = $(".category_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-category-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_category_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_categoryproductreport');
            if (type === 'categoryproductreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_categoryproductreport_per_page  option:selected').text());
            }

            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".category_branch_value").val()
            };
            let category_id = ($(".categories_input_id").val() !== '') ? $(".categories_input_id").val() : '';
            var field_input = {
                field_input: category_id
            };
            if ($(".categories_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'items/categoryItemsReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#categoryproductreport_exportbtn').removeAttr('disabled') : $('#categoryproductreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'categoryproductreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_categoryproductreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportcategorypro_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportcategoryproduct_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportcategoryproduct_img_hide,.reportcategoryproduct_norecord').show();

                        } else {
                            $('.reportcategoryproduct_norecord').empty();
                            $('#reportcategoryproduct_img_hide,.reportcategoryproduct_norecord').hide();
                            $('.reportcategorypro_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_categoryproductreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_categoryproductreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/categoryreport/' + row.category_id + '/product" ><i data-toggle="tooltip" class="table_model_item">' + row.category_name + '</i></a></td> <td class="text-center">' + row.item_count + '</td>  <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td></tr>';
                            $('#view_categoryproductreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var categoryproductreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            let category_name = val.category_name;
                            let noofproduct = val.item_count;
                            let total = val.selling_price;
                            categoryproductreport.push({CategoryName: category_name, NoofProduct: noofproduct, TotalAmount: total});
                        });
                        PosnicPro.JSONToCSVConvertor(categoryproductreport, 'category-product-reports', true);
                        PosnicPro.categoryproductreport.categoryproductreportTable();
                        PosnicPro.categoryreport.categoryreportTable();
                    }
                } else {
                    loader.find(".loadingSpinner:first").remove();
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".category_branch_value").focus();
        }
    },
    categoryproductreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.categoryproductreport.categoryproductreportTable(type);
    },
    categoryProductTabClick: function () {
        $('#change_category_view').data('id', 'productView');
        PosnicPro.categoryproductreport.categoryproductreportTable();
    }
};
PosnicPro.productdetails = {

    productdetailsTable: function (type) {

        PosnicPro.appendReportTableBody('productdetails');
        var table = $('#view_productdetails');
        var branch = $(".category_branch_value").val();
        var daterange = $(".view_category_report_daterange").val();
        var fields = daterange.split('-');
        if (type === 'categoryproductreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = parseInt($('#view_productdetails_per_page  option:selected').text());
        }
        let category_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            category_id: category_id[1],
            branch: branch,
            starting_date: fields[0],
            ending_date: fields[1]
        };
        var params = {
            url: 'items/categoryProductDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'categoryproductreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_productdetails_total,.product_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_productdetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_productdetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');

                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        var row = response.data.table.data.list[i];
                        var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        var updateDate = PosnicPro.convertDate(row.string_date);
                        var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td></tr>';
                        $('#view_productdetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }

                    $('.category_product_details_selling').html(response.data.total.total);
                    $('.category_product_details_count').html(response.data.total.count);
                    $('.category_product_view_name').html(response.data.total.name);
                } else {
                    var categoryreportexportdata = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        var date = PosnicPro.convertDate(val.string_date);
                        var name = val.name;
                        var total = val.selling_price;
                        categoryreportexportdata.push({ProductName: name, Date: date, Amount: total});

                    });
                    PosnicPro.JSONToCSVConvertor(categoryreportexportdata, response.data.total.name + '-category-based-product-reports', true);
                    PosnicPro.productdetails.productdetailsTable();
                }

            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewReportCategoryProductExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.productdetails.productdetailsTable(type);
    }
};

PosnicPro.categoryroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.categoryreport.categoryreportTable();
        } else {
            PosnicPro.categoryproductreport.categoryproductreportTable();
        }

    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/categoryreport') {
        var loader = $(".loader-category-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.categoryreport.categoryreportTable();
    }
});
