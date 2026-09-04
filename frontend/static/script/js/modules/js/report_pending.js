PosnicPro.pendingreport = {
    showModuleSalesDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-pendingreport-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.pendingproductdetails.pendingproductdetailsTable();
    },
    showModuleReceivingsDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-pendingreceivingreport-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.pendingreceivingproductdetails.pendingreceivingproductdetailsTable();
    },
    showDataTablePage: function () {
        var loader = $(".loader-pending-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#pendingreport_new').show();
        $('#v-pills-report-tab,#viewcuspendingreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#pending-tab-line').hasClass('active')) {
            PosnicPro.pendingreport.pendingTableTabClick();
        } else if ($('a#pending-receiving-tab-line').hasClass('active')) {
            PosnicPro.pendingreceivingreport.pendingreceivingTableTabClick();
        } else if ($('a#pending-customer-tab-line').hasClass('active')) {
            PosnicPro.pendingcustomerreport.pendingcustomerTableTabClick();
        } else if ($('a#pending-customercategory-tab-line').hasClass('active')) {
            PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryTableTabClick();
        } else {
            PosnicPro.pendingsupplierreport.pendingsupplierTableTabClick();
        }
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#pending-line,#pending-receiving-line,#pending-customer-line,#pending-customercategory-line').css('filter', 'blur(2px)');
            $('#pendingreport_exportbtn,#pendingreceivingreport_exportbtn,#pendingcustomerreport_exportbtn,#pendingcustomercategoryreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#pending_upgrade').show();
        } else {
            $('#pending-line,#pending-receiving-line,#pending-customer-line,#pending-customercategory-line').css('filter', 'none');
            $('#pendingreport_exportbtn,#pendingreceivingreport_exportbtn,#pendingcustomerreport_exportbtn,#pendingcustomercategoryreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#pending_upgrade').hide();
        }
    },
    pendingreportTable: function (type) {
        var branchId = $("#pending_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-pending-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('pendingreport');
            var daterange = $(".view_pending_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_pendingreport');
            if (type === 'pendingreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_pendingreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#pending_branch_value").val()
            };
            var params = {
                url: 'sales/pendingSalesReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#pendingreport_exportbtn').removeAttr('disabled') : $('#pendingreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'pendingreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_pendingreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.report-partialy-paid-sales-details-no-records').text('No Records on ' + dateRange);
                            $('.reportpending_header').hide();
                            $('#reportpending_img_hide, .report-partialy-paid-sales-details-no-records').show();

                        } else {
                            $('#reportpending_img_hide, .report-partialy-paid-sales-details-no-records').hide();
                            $('.reportpending_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_pendingreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_pendingreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/pendingreport/' + row.id + '/sales"><i data-toggle="tooltip" class="table_model_item">' + row.sale_id + '</i></a></td> <td>' + row.date + '</td> <td class="text-center">' + row.number_of_items + '</td>\n\
                                             <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.pending_amount + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.partial_amount + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.due_amount + '</td></tr>';
                            $('#view_pendingreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var pendingreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var id = val.sale_id;
                            var date = val.date;
                            var customer = val.customer_name;
                            var phone = val.customer_phone;
                            var count = val.number_of_items;
                            var amount = val.pending_amount;
                            var patialy = val.partial_amount;
                            var due = val.due_amount;
                            pendingreport.push({SalesId: id, Date: date, CustomerName: customer, CustomerPhone: phone, NoofProduct: count, TotalAmount: amount, PartialAmount: patialy, DueAmount: due});
                        });
                        PosnicPro.JSONToCSVConvertor(pendingreport, 'pending-reports', true);
                        PosnicPro.pendingreport.pendingreportTable();
                        PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
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
            $("#pending_branch_value").focus();
        }
    },
    pendingReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.pendingreport.pendingreportTable(type);
    },
    pendingTableTabClick: function () {
        $('#change_pending_view').data('id', 'tableView');
        PosnicPro.pendingreport.pendingreportTable();
    }
};

PosnicPro.pendingproductdetails = {

    pendingproductdetailsTable: function () {

        PosnicPro.appendReportTableBody('returndetails');
        var table = $('#view_pendingproductdetails');
        var current_page = table.data('current_page');
        var per_page = table.data('per_page');
        var branch = $("#pending_branch_value").val();
        let sales_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            sales_id: sales_id[1],
            branch: branch
        };
        var params = {
            url: 'sales/pendingProductDetails',
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
                $('#view_pendingproductdetails_total,.product_details_noofsale').text(response.data.total);
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_pendingproductdetails_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_pendingproductdetails_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');

                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + row.item_quantity + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                    $('#view_pendingproductdetails').children('tbody').append(trow);
                    $('span.number').number(true, 2);
                }

                $('.pending_product_view_name').html(response.data.custom_details.sales_id);
                $('.branch_view_name_pending').text(response.data.custom_details.branch_name);
                $('.customer_view_name_pending').text(response.data.custom_details.customer_name);
                $('.customer_view_address_pending').text(response.data.custom_details.customer_address);
                $('.customer_view_phone_pending').text(response.data.custom_details.customer_phone);
                $('.customer_view_email_pending').text(response.data.custom_details.customer_email);
                if (response.data.custom_details.customer_phone !== '') {
                    $('.customer_view_phone_icon_pending').attr('href', 'tel:' + response.data.custom_details.customer_phone);
                    $('.customer_view_phone_icon_pending').show();
                } else {
                    $('.customer_view_phone_icon_pending').hide();
                }
                if (response.data.custom_details.customer_email !== '') {
                    $('.customer_view_email_icon_pending').attr('href', 'mailto:' + response.data.custom_details.customer_email);
                    $('.customer_view_email_icon_pending').show();
                } else {
                    $('.customer_view_email_icon_pending').hide();
                }

            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

PosnicPro.pendingreceivingreport = {
    pendingreceivingreportTable: function (type) {
        var branchId = $("#pending_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-pending-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('pendingreport');
            var daterange = $(".view_pending_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_pendingreceivingreport');
            if (type === 'pendingreceivingreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_pendingreceivingreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#pending_branch_value").val()
            };
            var params = {
                url: 'receivings/pendingReceivingReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#pendingreceivingreport_exportbtn').removeAttr('disabled') : $('#pendingreceivingreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'pendingreceivingreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_pendingreceivingreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportpendingrecev_header').hide();
                            $('#reportpendpurchase_img_hide').show();
                        } else {
                            $('#reportpendpurchase_img_hide').hide();
                            $('.reportpendingrecev_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_pendingreceivingreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_pendingreceivingreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/pendingreport/' + row.id + '/receivings"><i data-toggle="tooltip" class="table_model_item">' + row.receiving_id + '</i></a></td> <td>' + row.date + '</td> <td>' + row.supplier_name + '</td> <td>' + row.supplier_phone + '</td><td class="text-center">' + row.number_of_items + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.pending_amount + '</span></td></tr>';
                            $('#view_pendingreceivingreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var pendingreceivingreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var id = val.receiving_id;
                            var date = val.date;
                            var supplier = val.supplier_name;
                            var phone = val.supplier_phone;
                            var count = val.number_of_items;
                            var amount = val.pending_amount;
                            pendingreceivingreport.push({ReceivingId: id, Date: date, SupplierName: supplier, SupplierPhone: phone, NoofProduct: count, ReturnAmount: amount});
                        });
                        PosnicPro.JSONToCSVConvertor(pendingreceivingreport, 'pending-receiving-reports', true);
                        PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
                        PosnicPro.pendingreport.pendingreportTable();
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
            $("#pending_branch_value").focus();
        }
    },
    pendingreceivingReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.pendingreceivingreport.pendingreceivingreportTable(type);
    },
    pendingreceivingTableTabClick: function () {
        $('#change_pending_view').data('id', 'tableReceivingView');
        PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
    }
};

PosnicPro.pendingreceivingproductdetails = {

    pendingreceivingproductdetailsTable: function () {

        PosnicPro.appendReportTableBody('returndetails');
        var table = $('#view_pendingreceivingproductdetails');
        var current_page = table.data('current_page');
        var per_page = table.data('per_page');
        var branch = $("#pending_branch_value").val();
        let receiving_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            receiving_id: receiving_id[1],
            branch: branch
        };
        var params = {
            url: 'receivings/pendingReceivingProductDetails',
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
                $('#view_pendingreceivingproductdetails_total,.product_details_noofsale').text(response.data.total);
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_pendingreceivingproductdetails_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_pendingreceivingproductdetails_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');

                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + row.item_quantity + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                    $('#view_pendingreceivingproductdetails').children('tbody').append(trow);
                    $('span.number').number(true, 2);
                }

                $('.pending_product_view_name').html(response.data.custom_details.receiving_id);
                $('.branch_view_name_pending').text(response.data.custom_details.branch_name);
                $('.supplier_view_name_pending').text(response.data.custom_details.supplier_name);
                $('.supplier_view_address_pending').text(response.data.custom_details.supplier_address);
                $('.supplier_view_phone_pending').text(response.data.custom_details.supplier_phone);
                $('.supplier_view_email_pending').text(response.data.custom_details.supplier_email);
                if (response.data.custom_details.supplier_phone !== '') {
                    $('.supplier_view_phone_icon_pending').attr('href', 'tel:' + response.data.custom_details.supplier_phone);
                    $('.supplier_view_phone_icon_pending').show();
                } else {
                    $('.supplier_view_phone_icon_pending').hide();
                }
                if (response.data.custom_details.supplier_email !== '') {
                    $('.supplier_view_email_icon_pending').attr('href', 'mailto:' + response.data.custom_details.supplier_email);
                    $('.supplier_view_email_icon_pending').show();
                } else {
                    $('.supplier_view_email_icon_pending').hide();
                }

            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

PosnicPro.pendingcustomerreport = {
    pendingcustomerreportTable: function (type) {
        var branchId = $("#pending_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-pending-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_pending_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_pendingcustomerreport');
            if (type === 'pendingcustomerreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_pendingcustomerreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#pending_branch_value").val()
            };
            var params = {
                url: 'sales/pendingCustomerReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#pendingcustomerreport_exportbtn').removeAttr('disabled') : $('#pendingcustomerreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'pendingcustomerreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_pendingcustomerreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportpendingcust_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportpendcustomer_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportpendcustomer_img_hide,.reportpendcustomer_norecord').show();

                        } else {
                            $('.reportpendcustomer_norecord').empty();
                            $('#reportpendcustomer_img_hide,.reportpendcustomer_norecord').hide();
                            $('.reportpendingcust_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_pendingcustomerreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_pendingcustomerreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            let row = response.data.list[i];
                            let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.customer_name + '</td> \n\
                                             <td>' + row.customer_phone + '</td>\n\
                                             <td>' + row.referrer + '</td>\n\
                                             <td class="text-center">' + row.sales_count + '</td>\n\
                                             <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_payment + '</span></td>\n\
                                             <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.partial_balance + '</span></td>\n\
                                             <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.due_balance + '</span></td></tr>';
                            $('#view_pendingcustomerreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var pendingcustomerreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            let name = val.customer_name;
                            let phone = val.customer_phone;
                            let referrer = val.referrer;
                            let count = val.sales_count;
                            let amount = val.sales_payment;
                            let partial = val.partial_balance;
                            let due = val.due_balance;
                            pendingcustomerreport.push({CustomerName: name, CustomerPhone: phone, ReferredBy: referrer, NoofProduct: count, TotalAmount: amount, PartialyAmount: partial, DueAmount: due});
                        });
                        PosnicPro.JSONToCSVConvertor(pendingcustomerreport, 'pending-customer-reports', true);
                        PosnicPro.pendingcustomerreport.pendingcustomerreportTable();
                        PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryreportTable();
                        PosnicPro.pendingreport.pendingreportTable();
                        PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
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
            $("#pending_branch_value").focus();
        }
    },
    pendingcustomerReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.pendingcustomerreport.pendingcustomerreportTable(type);
    },
    pendingcustomerTableTabClick: function () {
        $('#change_pending_view').data('id', 'tableCustomerView');
        PosnicPro.pendingcustomerreport.pendingcustomerreportTable();
    }
};

PosnicPro.pendingsupplierreport = {
    pendingsupplierreportTable: function (type) {
        var branchId = $("#pending_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-pending-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_pending_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_pendingsupplierreport');
            if (type === 'pendingsupplierreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_pendingsupplierreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#pending_branch_value").val()
            };
            var params = {
                url: 'receivings/pendingSupplierReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#pendingsupplierreport_exportbtn').removeAttr('disabled') : $('#pendingsupplierreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'pendingsupplierreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_pendingsupplierreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportpendingsupply_header').hide();
                            $('.reportpendsupply_norecord').empty().append('<div class="text-center text-dark"> <p><lang class="lang_no_records">No Records </lang></p></div>');
                            $('#reportpendsupply_img_hide,.reportpendsupply_norecord').show();

                        } else {
                            $('.reportpendsupply_norecord').empty();
                            $('#reportpendsupply_img_hide,.reportpendsupply_norecord').hide();
                            $('.reportpendingsupply_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_pendingsupplierreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_pendingsupplierreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            let row = response.data.list[i];
                            let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.date + '</td> <td>' + row.supplier_name + '</td> <td>' + row.supplier_phone + '</td><td class="text-center">' + row.receiving_count + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.receiving_payment + '</span></td></tr>';
                            $('#view_pendingsupplierreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var pendingsupplierreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            let date = val.date;
                            let name = val.supplier_name;
                            let phone = val.supplier_phone;
                            let count = val.receiving_count;
                            let amount = val.receiving_payment;
                            pendingsupplierreport.push({Date: date, SupplierName: name, SupplierPhone: phone, NoofProduct: count, PendingAmount: amount});
                        });
                        PosnicPro.JSONToCSVConvertor(pendingsupplierreport, 'pending-supplier-reports', true);
                        PosnicPro.pendingsupplierreport.pendingsupplierreportTable();
                        PosnicPro.pendingcustomerreport.pendingcustomerreportTable();
                        PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryreportTable();
                        PosnicPro.pendingreport.pendingreportTable();
                        PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
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
            $("#pending_branch_value").focus();
        }
    },
    pendingsupplierReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.pendingsupplierreport.pendingsupplierreportTable(type);
    },
    pendingsupplierTableTabClick: function () {
        $('#change_pending_view').data('id', 'tableSupplierView');
        PosnicPro.pendingsupplierreport.pendingsupplierreportTable();
    }
};

PosnicPro.pendingcustomercategoryreport = {
    pendingcustomercategoryreportTable: function (type) {
        var branchId = $("#pending_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-pending-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_pending_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_pendingcustomercategoryreport');
            if (type === 'pendingcustomercategoryreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_pendingcustomercategoryreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#pending_branch_value").val()
            };
            var params = {
                url: 'sales/pendingCustomerCategoryReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#pendingcustomercategoryreport_exportbtn').removeAttr('disabled') : $('#pendingcustomercategoryreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'pendingcustomercategoryreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_pendingcustomercategoryreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportpendingcust_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportpendcustomercategory_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportpendcustomercategory_img_hide,.reportpendcustomercategory_norecord').show();

                        } else {
                            $('.reportpendcustomercategory_norecord').empty();
                            $('#reportpendcustomercategory_img_hide,.reportpendcustomercategory_norecord').hide();
                            $('.reportpendingcust_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_pendingcustomercategoryreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_pendingcustomercategoryreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            let row = response.data.list[i];
                            let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.category_name + '</td> <td class="text-center">' + row.sales_count + '</td>\n\
                                        <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_payment + '</span></td>\n\
                                        <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.partial_balance + '</span></td>\n\
                                        <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.due_balance + '</span></td></tr>';
                            $('#view_pendingcustomercategoryreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var pendingcustomercategoryreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            let name = val.category_name;
                            let count = val.sales_count;
                            let amount = val.sales_payment;
                            let partial = val.partial_balance;
                            let due = val.due_balance;
                            pendingcustomercategoryreport.push({CategoryName: name, NoofProduct: count, TotalAmount: amount, PartialyAmount: partial, DueAmount: due});
                        });
                        PosnicPro.JSONToCSVConvertor(pendingcustomercategoryreport, 'pending-customercategory-reports', true);
                        PosnicPro.pendingcustomerreport.pendingcustomerreportTable();
                        PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryreportTable();
                        PosnicPro.pendingreport.pendingreportTable();
                        PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
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
            $("#pending_branch_value").focus();
        }
    },
    pendingcustomercategoryReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryreportTable(type);
    },
    pendingcustomercategoryTableTabClick: function () {
        $('#change_pending_view').data('id', 'tableCustomerCategoryView');
        PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryreportTable();
    }
};

PosnicPro.pendingroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.pendingreport.pendingreportTable();
        } else if (type === 'tableReceivingView') {
            PosnicPro.pendingreceivingreport.pendingreceivingreportTable();
        } else if (type === 'tableCustomerView') {
            PosnicPro.pendingcustomerreport.pendingcustomerreportTable();
        } else if (type === 'tableCustomerCategoryView') {
            PosnicPro.pendingcustomercategoryreport.pendingcustomercategoryreportTable();
        } else {
            PosnicPro.pendingsupplierreport.pendingsupplierreportTable();
        }

    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/pendingreport') {
        var loader = $(".loader-pending-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.pendingreport.pendingreportTable();
    }
});