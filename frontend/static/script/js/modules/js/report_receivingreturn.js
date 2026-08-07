PosnicPro.returnreceivingreport = {
    showModuleDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-returnreceivingreport-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.returnreceivingproductdetails.returnproductdetailsTable();
    },
    showDetails: function (id) {
        var loader = $(".loader-return-receiving_product");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.returnreceivingproductreport.viewReturnDetail(id);
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
        $('.page-title-box,#returnreceivingreport_new').show();
        $('#v-pills-report-tab,#viewreturnreceivingreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#return-receiving-tab-line').hasClass('active')) {
            PosnicPro.returnreceivingreport.returnTableTabClick();
        } else {
            PosnicPro.returnreceivingproductreport.returnProductTabClick();
        }
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#return-receiving-line,#return-receiving-product-line').css('filter', 'blur(2px)');
            $('#returnreport_exportbtn,#returnproductreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#return_receiving_upgrade').show();
        } else {
            $('#return-receiving-line,#return-receiving-product-line').css('filter', 'none');
            $('#returnreport_exportbtn,#instantreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#return_receiving_upgrade').hide();
        }
    },
    returnreceivingreportTable: function (type) {
        var branchId = $("#return_receiving_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-return-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('returnreceivingreport');
            var daterange = $(".view_return_receiving_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_returnreceivingreport');
            if (type === 'returnreceivingreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_returnreceivingreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#return_receiving_branch_value").val()
            };
            var params = {
                url: 'receivings/returnReceivingReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#returnreceivingreport_exportbtn').removeAttr('disabled') : $('#returnreceivingreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'returnreceivingreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_returnreceivingreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.report-purchase-etails-no-records').text('No Records on ' + dateRange);
                            $('.reportrepurchase_header').hide();
                            $('#reportrepurchase_img_hide').show();

                        } else {
                            $('#reportrepurchase_img_hide').hide();
                            $('.reportrepurchase_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_returnreceivingreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_returnreceivingreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/returnreceivingreport/' + row.id + '/details"><i data-toggle="tooltip" class="table_model_item">' + row.receiving_id + '</i></a></td> <td>' + row.date + '</td> <td>' + row.supplier_name + '</td> <td>' + row.payment_mode + '</td><td>' + row.count + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return + '</span></td></tr>';
                            $('#view_returnreceivingreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var returnreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {

                            let id = val.receiving_id;
                            let date = val.date;
                            let supplier = val.supplier_name;
                            let mode = val.payment_mode;
                            let count = val.count;
                            let amount = val.return;
                            returnreport.push({ReceivingId: id, Date: date, SupplierName: supplier, PaymentMethod: mode, NoofItem: count, ReturnAmount: amount});

                        });
                        PosnicPro.JSONToCSVConvertor(returnreport, 'return-reports', true);
                        PosnicPro.returnreceivingproductreport.returnreceivingproductreportTable();
                        PosnicPro.returnreceivingreport.returnreceivingreportTable();
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
            $("#return_receiving_branch_value").focus();
        }
    },
    returnReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.returnreceivingreport.returnreceivingreportTable(type);
    },
    returnTableTabClick: function () {
        $('#change_returnreceiving_view').data('id', 'tableView');
        PosnicPro.returnreceivingreport.returnreceivingreportTable();
    }
};

PosnicPro.returnreceivingproductreport = {
    viewReturnDetail: function (id) {
        var loader = $(".loader-return-receiving_product");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#return_receiving_product_view').modal('show');
        var data = {
            id: id
        };
        var params = {
            url: 'receivings/returnReceivingProductView',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                $('.tax-print-hideshow,.discount-print-hideshow').hide();
                $('#return_receiving_product_table tbody').children("tr").remove();
                var data = response.data;
                $(data).each(function (key, val) {
                    var timeStamp_value = parseInt(val.return_date.$date.$numberLong);
                    var timeZone = PosnicPro.local.get('timezone');
                    var updateDate = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
                    $('#return_receiving_product_id_view').html(val.return_id);
                    $('#return_receiving_product_date_view').html(updateDate);
                    $('#return_receiving_product_supplier_name_view').html(val.supplier_name);
                    $('#return_receiving_product_supplier_phone_view').html(val.supplier_phone);
                    $('#return_receiving_product_supplier_email_view').html(val.supplier_email);
                    $('#return_receiving_product_supplier_address_view').html(val.supplier_address);
                    $('#return_receiving_product_payment_mode_view').html(val.payment_mode);


                    var tax_type = val.tax_type;
                    if (tax_type === 'exclusive') {
                        var price = val.item_price;
                    } else {
                        var price = val.item_price / ((val.tax / 100) + 1);
                    }
                    var currency = PosnicPro.local.get('currencySign');

                    var addrowHTMLLine = ' <tr id="return_col"> ' +
                            '<td data-toggle="tooltip" title="' + val.item_name + '">' + val.item_name + '</td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + price + '</span> </td>' +
                            '<td class="text-center">' + val.item_quantity + '</td>' +
                            '<td class="text-right">' + val.tax + '% </td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span> </td>' +
                            '</tr>';
                    $('#return_receiving_product_table tbody').append(addrowHTMLLine);
                    $('span.number').number(true, 2);
                    $('.discount-print-hideshow,.tax-print-hideshow').hide();
                    if (val.receiving_tax > 0) {
                        $('.tax-print-hideshow').show();
                        $('#return_receiving_product_tax_view').number(val.receiving_tax, 2);
                    }

                    if (val.receiving_discount > 0) {
                        $('.discount-print-hideshow').show();
                        $('#receiving_return_discount_value').number(val.receiving_discount, 2);
                    }
                    $('#return_receiving_product_subtotal_amount_view').number(val.subtotal, 2);
                    $('#return_receiving_product_total_amount_view').number(val.finaltotal, 2);


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
    returnreceivingproductreportTable: function (type) {
        var branchId = $("#return_receiving_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-return-receiving-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_return_receiving_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_returnreceivingproductreport');
            if (type === 'returnreceivingproductreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_returnreceivingproductreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#return_receiving_branch_value").val()
            };
            var params = {
                url: 'receivings/productBasedReceivingReturnDetails',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#returnreceivingproductreport_exportbtn').removeAttr('disabled') : $('#returnreceivingproductreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'returnreceivingproductreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_returnreceivingproductreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportrepurchasepro_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportreproductpurchase_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportreproductpurchase_img_hide,.reportreproductpurchase_norecord').show();

                        } else {
                            $('.reportreproductpurchase_norecord').empty();
                            $('#reportreproductpurchase_img_hide,.reportreproductpurchase_norecord').hide();
                            $('.reportrepurchasepro_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_returnreceivingproductreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_returnreceivingproductreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/returnreceivingreport/' + row.return_id + '"><i data-toggle="tooltip" class="table_model_item">' + row.return_id + '</i></a></td><td>' + row.return_date + '</td><td>' + row.name + '</td><td>' + row.supplier_name + '</td> <td class="text-center">' + row.item_quantity + '</td>  <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_returnreceivingproductreport').children('tbody').append(trow);
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
                        PosnicPro.returnreceivingproductreport.returnreceivingproductreportTable();
                        PosnicPro.returnreceivingreport.returnreceivingreportTable();
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
            $("#return_receiving_branch_value").focus();
        }
    },
    returnproductreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.returnreceivingproductreport.returnreceivingproductreportTable(type);
    },
    returnProductTabClick: function () {
        $('#change_returnreceiving_view').data('id', 'returnView');
        PosnicPro.returnreceivingproductreport.returnreceivingproductreportTable();
    }
};

PosnicPro.returnreceivingproductdetails = {

    returnproductdetailsTable: function () {

        PosnicPro.appendReportTableBody('returndetails');
        var table = $('#view_returnreceivingproductdetails');
        var current_page = table.data('current_page');
        var per_page = table.data('per_page');
        var branch = $("#return_receiving_branch_value").val();
        let receiving_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            receiving_id: receiving_id[1],
            branch: branch
        };
        var params = {
            url: 'receivings/returnReceivingProductDetails',
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
                $('#view_returnreceivingproductdetails_total,.product_details_noofsale').text(response.data.total);
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_returnreceivingproductdetails_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_returnreceivingproductdetails_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');

                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + row.item_quantity + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                    $('#view_returnreceivingproductdetails').children('tbody').append(trow);
                    $('span.number').number(true, 2);
                }

                $('.return_receiving_product_view_name').html(response.data.custom_details.receiving_id);
                $('.branch_view_name_return_receiving').text(response.data.custom_details.branch_name);
                $('.user_view_name_return_receiving').text(response.data.custom_details.user_name);
                $('.supplier_view_name_return_receiving').text(response.data.custom_details.supplier_name);
                $('#supplier_view_address_return_receiving,#supplier_view_phone_return_receiving,#supplier_view_email_return_receiving').hide();
                if (response.data.custom_details.supplier_phone !== '') {
                    $('#supplier_view_phone_return_receiving').show();
                    $('.supplier_view_phone_return_receiving').text(response.data.custom_details.supplier_phone);
                    $('.supplier_view_phone_icon_return_receiving').attr('href', 'tel:' + response.data.custom_details.supplier_phone);
                } else if (response.data.custom_details.supplier_email !== '') {
                    $('#supplier_view_email_return_receiving').show();
                    $('.supplier_view_email_return_receiving').text(response.data.custom_details.supplier_email);
                    $('.supplier_view_email_icon_return_receiving').attr('href', 'mailto:' + response.data.custom_details.supplier_email);
                } else {
                    $('.supplier_view_address_return_receiving').text(response.data.custom_details.supplier_address);
                    $('#supplier_view_address_return_receiving').show();
                }

            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

PosnicPro.returnreceivingroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.returnreceivingreport.returnreceivingreportTable();
        } else {
            PosnicPro.returnreceivingproductreport.returnreceivingproductreportTable();
        }

    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/returnreceivingreport') {
        var loader = $(".loader-return-report,.loader-return-receiving-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.returnreceivingreport.returnreceivingreportTable();
    }
});