PosnicPro.returnreport = {
    showModuleDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-returnreport-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.returnproductdetails.returnproductdetailsTable();
    },
    showDetails: function (id) {
        var loader = $(".loader-return-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.returnproductreport.viewReturnDetail(id);
    },
    showDataTablePage: function () {
        var loader = $(".loader-return-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#returnreport_new').show();
        $('#v-pills-report-tab,#viewreturnsalereport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#return-tab-line').hasClass('active')) {
            PosnicPro.returnreport.returnTableTabClick();
        } else {
            PosnicPro.returnproductreport.returnProductTabClick();
        }
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#return-line, #return-product-line').css('filter', 'blur(2px)');
            $('#returnreport_exportbtn,#returnproductreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#salesreturn_upgrade').show();
        } else {
            $('#return-line, #return-product-line').css('filter', 'none');
            $('#returnreport_exportbtn,#instantreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#salesreturn_upgrade').hide();
        }
    },
    returnreportTable: function (type) {
        var branchId = $("#return_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-return-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('returnreport');
            var daterange = $(".view_return_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_returnreport');
            if (type === 'returnreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_returnreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#return_branch_value").val()
            };
            var params = {
                url: 'sales/returnSalesReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#returnreport_exportbtn').removeAttr('disabled') : $('#returnreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'returnreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_returnreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.report-sales-details-no-records').text('No Records on ' + dateRange);
                            $('.reportresale_header').hide();
                            $('#reportresale_img_hide, .report-sales-details-no-records').show();

                        } else {
                            $('#reportresale_img_hide, .report-sales-details-no-records').hide();
                            $('.reportresale_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_returnreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_returnreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/returnreport/' + row.id + '/details"><i data-toggle="tooltip" class="table_model_item">' + row.sale_id + '</i></a></td> <td>' + row.date + '</td> <td>' + row.customer_name + '</td> <td>' + row.payment_mode + '</td><td>' + row.count + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return + '</span></td></tr>';
                            $('#view_returnreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var returnreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {

                            let id = val.sale_id;
                            let date = val.date;
                            let customer = val.customer_name;
                            let mode = val.payment_mode;
                            let count = val.count;
                            let amount = val.return;
                            returnreport.push({SalesId: id, Date: date, CustomerName: customer, PaymentMethod: mode, NoofItem: count, ReturnAmount: amount});

                        });
                        PosnicPro.JSONToCSVConvertor(returnreport, 'return-reports', true);
                        PosnicPro.returnproductreport.returnproductreportTable();
                        PosnicPro.returnreport.returnreportTable();
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
            $("#return_branch_value").focus();
        }
    },
    returnReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.returnreport.returnreportTable(type);
    },
    returnTableTabClick: function () {
        $('#change_return_view').data('id', 'tableView');
        PosnicPro.returnreport.returnreportTable();
    }
};

PosnicPro.returnproductreport = {
    viewReturnDetail: function (id) {
        var loader = $(".loader-return-product");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#return_product_view').modal('show');
        var data = {
            id: id
        };
        var params = {
            url: 'sales/returnProductView',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                $('.tax-print-hideshow,.discount-print-hideshow').hide();
                $('#return_product_table tbody').children("tr").remove();
                var data = response.data;
                $(data).each(function (key, val) {
                    var timeStamp_value = parseInt(val.return_date.$date.$numberLong);
                    var timeZone = PosnicPro.timeZone();
                    var updateDate = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
                    $('#return_product_id_view').html(val.return_id);
                    $('#return_product_date_view').html(updateDate);
                    $('#return_product_customer_name_view').html(val.customer_name);
                    $('#return_product_customer_phone_view').html(val.customer_phone);
                    $('#return_product_customer_email_view').html(val.customer_email);
                    $('#return_product_customer_address_view').html(val.customer_address);
                    $('#return_product_payment_mode_view').html(val.payment_mode);


                    var tax_type = val.tax_type;
                    if (tax_type === 'exclusive') {
                        var price = val.item_price;
                    } else {
                        var price = val.item_price / ((val.tax / 100) + 1);
                    }
                    var currency = PosnicPro.local.get('currencySign');
                    var discount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                    var discountSign = (val.item_discount > 0) ? currency : '%';

                    if (discountSign === '%') {
                        var discount_percentage = '' + discount + ' ' + discountSign + '';
                    } else {
                        var discount_percentage = '' + discountSign + ' ' + discount + '';
                    }
                    var addrowHTMLLine = ' <tr id="return_col"> ' +
                            '<td data-toggle="tooltip" title="' + val.item_name + '">' + val.item_name + '</td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + price + ' </span></td>' +
                            '<td class="text-center">' + val.item_quantity + '</td>' +
                            '<td class="text-right">' + discount_percentage + '</td>' +
                            '<td class="text-right">' + val.tax + '% </td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + ' </span></td>' +
                            '</tr>';
                    $('#return_product_table tbody').append(addrowHTMLLine);
                    $('span.number').number(true, 2);
                    $('.discount-print-hideshow,.tax-print-hideshow').hide();
                    if (val.sale_tax > 0) {
                        $('.tax-print-hideshow').show();
                        $('#return_product_tax_view').number(val.sale_tax, 2);
                    }

                    if (val.sale_discount > 0) {
                        $('.discount-print-hideshow').show();
                        $('.sales-return-discount-value').number(val.sale_discount, 2);
                    }
                    $('#return_product_subtotal_amount_view').number(val.subtotal, 2);
                    $('#return_product_total_amount_view').number(val.finaltotal, 2);

                });
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    returnproductreportTable: function (type) {
        var branchId = $("#return_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-return-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_return_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_returnproductreport');
            if (type === 'returnproductreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_returnproductreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#return_branch_value").val()
            };
            var params = {
                url: 'sales/productBasedReturnDetails',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#returnproductreport_exportbtn').removeAttr('disabled') : $('#returnproductreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'returnproductreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_returnproductreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportresalepro_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportreproduct_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportreproduct_img_hide,.reportreproduct_norecord').show();

                        } else {
                            $('.reportreproduct_norecord').empty();
                            $('#reportreproduct_img_hide,.reportreproduct_norecord').hide();
                            $('.reportresalepro_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_returnproductreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_returnproductreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/returnreport/' + row.return_id + '"><i data-toggle="tooltip" class="table_model_item">' + row.return_id + '</i></a></td><td>' + row.return_date + '</td><td>' + row.name + '</td><td>' + row.supplier_name + '</td> <td class="text-center">' + row.item_quantity + '</td>  <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_returnproductreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var returnproductreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var id = val.return_id;
                            var date = val.return_date;
                            var name = val.name;
                            var supplier = val.supplier_name;
                            var noofreturn = val.item_quantity;
                            var total = val.total_amount;
                            returnproductreport.push({ReturnId: id, Date: date, ItemName: name, SupplierName: supplier, NoofReturn: noofreturn, ReturnTotal: total});
                        });
                        PosnicPro.JSONToCSVConvertor(returnproductreport, 'return-product-reports', true);
                        PosnicPro.returnproductreport.returnproductreportTable();
                        PosnicPro.returnreport.returnreportTable();
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
            $("#return_branch_value").focus();
        }
    },
    returnproductreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.returnproductreport.returnproductreportTable(type);
    },
    returnProductTabClick: function () {
        $('#change_return_view').data('id', 'returnView');
        PosnicPro.returnproductreport.returnproductreportTable();
    }
};

PosnicPro.returnproductdetails = {

    returnproductdetailsTable: function () {

        PosnicPro.appendReportTableBody('returndetails');
        var table = $('#view_returnproductdetails');
        var current_page = table.data('current_page');
        var per_page = table.data('per_page');
        var branch = $("#return_branch_value").val();
        let sales_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            sales_id: sales_id[1],
            branch: branch
        };
        var params = {
            url: 'sales/returnProductDetails',
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
                $('#view_returnproductdetails_total,.product_details_noofsale').text(response.data.total);
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_returnproductdetails_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_returnproductdetails_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');

                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + row.item_quantity + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                    $('#view_returnproductdetails').children('tbody').append(trow);
                    $('span.number').number(true, 2);
                }

                $('.return_product_view_name').html(response.data.custom_details.sales_id);
                $('.branch_view_name_return').text(response.data.custom_details.branch_name);
                $('.user_view_name_return').text(response.data.custom_details.user_name);
                $('.customer_view_name_return').text(response.data.custom_details.customer_name);
                $('#customer_view_address_return,#customer_view_phone_return,#customer_view_email_return').hide();
                if (response.data.custom_details.customer_phone !== '') {
                    $('#customer_view_phone_return').show();
                    $('.customer_view_phone_return').text(response.data.custom_details.customer_phone);
                    $('.customer_view_phone_icon_return').attr('href', 'tel:' + response.data.custom_details.customer_phone);
                } else if (response.data.custom_details.customer_email !== '') {
                    $('#customer_view_email_return').show();
                    $('.customer_view_email_return').text(response.data.custom_details.customer_email);
                    $('.customer_view_email_icon_return').attr('href', 'mailto:' + response.data.custom_details.customer_email);
                } else {
                    $('.customer_view_address_return').text(response.data.custom_details.customer_address);
                    $('#customer_view_address_return').show();
                }

            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

PosnicPro.returnroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.returnreport.returnreportTable();
        } else {
            PosnicPro.returnproductreport.returnproductreportTable();
        }

    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/returnreport') {
        var loader = $(".loader-return-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.returnreport.returnreportTable();
    }
});