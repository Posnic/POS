PosnicPro.customerreport = {
    showDataTablePage: function () {
        var loader = $(".loader-customer-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item,#v-pills-customer').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#customerreport_new').show();
        $('#v-pills-report-tab,#viewcustomerreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#customer-tab-line').hasClass('active')) {
            PosnicPro.customerreport.customerTableTabClick();
        } else {
            PosnicPro.customeroutstandingreport.customeroutstandingTableTabClick();
        }
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#customer-line, #customer-graph-line, #customer-outstanding-line').css('filter', 'blur(2px)');
            $('#customerreport_exportbtn, #customeroutstandingreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#customer_upgrade').show();
        } else {
            $('#customer-line, #customer-graph-line, #customer-outstanding-line').css('filter', 'none');
            $('#customerreport_exportbtn, #customeroutstandingreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#customer_upgrade').hide();
        }
    },
    customerreportTable: function (type) {
        $('#customerreport_daterange').removeClass('flatpickr-disabled');
        var branchId = $(".customer_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-customer-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('customerreport');
            var daterange = $(".view_customer_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_customerreport');

            if (type === 'customerreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_customerreport_per_page  option:selected').text());
            }

            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".customer_branch_value").val()
            };
            let customer_id = ($(".customers_input_id").val() !== '') ? $(".customers_input_id").val() : '';
            var field_input = {
                field_input: customer_id
            };
            if ($(".customers_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'sales/customerSalesReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#customerreport_exportbtn').removeAttr('disabled') : $('#customerreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'customerreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_customerreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportcustomer_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportcustomer_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                            $('#reportcustomer_img_hide,.reportcustomer_norecord').show();

                        } else {
                            $('.reportcustomer_norecord').empty();
                            $('#reportcustomer_img_hide,.reportcustomer_norecord').hide();
                            $('.reportcustomer_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_customerreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_customerreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                            // Compute net average purchase using
                            // (total purchase - return amount) / no. of purchase
                            var netSalesAmount = row.sales_payment - row.refund_payment;
                            var avgPurchase = row.sales_count > 0 ? netSalesAmount / row.sales_count : 0;

                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.customer_name + '</td> <td>' + row.customer_phone + '</td> <td class="text-center">' + row.sales_count + '</td> <td class="text-right">-' + currency + '&nbsp;<span class="number">' + row.refund_payment + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + avgPurchase + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_payment + '</span></td></tr>';

                            $('#view_customerreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var customerreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.customer_name;
                            var phone = val.customer_phone;
                            var totalitems = val.sales_count;
                            var total = val.sales_payment;
                            var returnAmount = val.refund_payment;

                            // Match on-screen Avg.Purchase formula:
                            // (total purchase - return) / no. of purchase
                            var netSalesAmount = total - returnAmount;
                            var averageSale = totalitems > 0 ? netSalesAmount / totalitems : 0;

                            customerreport.push({CustomerName: name, CustomerPhone: phone, NoofPurchase: totalitems, return: returnAmount, AvgPurchase: averageSale, TotalPurchase: total});
                        });
                        PosnicPro.JSONToCSVConvertor(customerreport, 'customer-reports', true);
                        PosnicPro.customerreport.customerreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".customer_branch_value").focus();
        }
    },
    customerReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.customerreport.customerreportTable(type);
    },
    customerTableTabClick: function () {
        $('#change_customer_view').data('id', 'tableView');
        PosnicPro.customerreport.customerreportTable();
    },
    showDetails: function (id) {
        var loader = $(".loader-view-customer");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('customers');
        PosnicPro.customers.viewCustomer(id);
        $('.mobile_tooltip').tooltip('hide');
    }
};


PosnicPro.customeroutstandingreport = {
    showDataTablePage: function () {
        var loader = $(".loader-customer-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#customerreport_new').show();
        $('#v-pills-report-tab,#viewcustomeroutstandingreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#customer-tab-line').hasClass('active')) {
            PosnicPro.customerreport.customerTableTabClick();
        } else {
            PosnicPro.customeroutstandingreport.customeroutstandingTableTabClick();
        }
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#customer-outstanding-line').css('filter', 'blur(2px)');
            $('#customeroutstandingreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#customer_upgrade').show();
        } else {
            $('#customer-outstanding-line').css('filter', 'none');
            $('#customeroutstandingreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#customer_upgrade').hide();
        }
    },
    customeroutstandingreportTable: function (type) {
        $('#customerreport_daterange').addClass('flatpickr-disabled');
        var branchId = $(".customer_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-customer-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('transactionreport');
            var daterange = $(".view_customer_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_customeroutstandingreport');

            if (type === 'customeroutstandingreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_customeroutstandingreport_per_page  option:selected').text());
            }

            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".customer_branch_value").val()
            };
            let customer_id = ($(".customers_input_id").val() !== '') ? $(".customers_input_id").val() : '';
            var field_input = {
                field_input: customer_id
            };
            if ($(".customers_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'customers/customerOutstandingReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#customeroutstandingreport_exportbtn').removeAttr('disabled') : $('#customeroutstandingreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'customeroutstandingreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_customeroutstandingreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportcustomeroutstanding_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportcustomeroutstanding_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                            $('#reportcustomeroutstanding_img_hide,.reportcustomeroutstanding_norecord').show();

                        } else {
                            $('.reportcustomeroutstanding_norecord').empty();
                            $('#reportcustomeroutstanding_img_hide,.reportcustomeroutstanding_norecord').hide();
                            $('.reportcustomeroutstanding_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_customeroutstandingreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_customeroutstandingreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        var pending = 0;
                        var due = 0;

                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            
                            // Check if customer is deleted - if deleted, show name as plain text, otherwise show as link
                            var customerNameCell = row.is_deleted || !row.id 
                                ? '<span class="text-muted" style="cursor: not-allowed; opacity: 0.6;" title="Customer Deleted">' + row.name + ' (Deleted)</span>'
                                : '<a href="#/customerreport/' + row.id + '"><i data-toggle="tooltip" class="table_model_item mobile_tooltip" title="View Details">' + row.name + '</i></a>';
                            
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + customerNameCell + '</td> <td class="text-right">' + currency + '&nbsp;<span>' + row.credit.toFixed(2) + '</td> <td class="text-right">' + currency + '&nbsp;<span>-' + row.debit.toFixed(2) + '</td> <td class="text-right">' + currency + '&nbsp;<span>' + row.wallet.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span>-' + row.pending.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span>-' + row.due.toFixed(2) + '</span></td></tr>';
                            due += row.due;
                            pending += row.pending;
                            $('#view_customeroutstandingreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                        $('.customer_outstanding_salepending').text('-' + pending.toFixed(2));
                        $('.customer_outstanding_overalldue').text('-' + due.toFixed(2));
                    } else {
                        var customeroutstandingreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            let name = val.name;
                            let credit = val.credit;
                            let debit = val.debit;
                            let wallet = val.wallet;
                            let pending = val.pending;
                            let due = val.due;
                            customeroutstandingreport.push({CustomerName: name, CustomerCredit: credit, CustomerDebit: debit, CustomerWallet: wallet, CustomerSalesPending: pending, CustomerDue: due});
                        });
                        PosnicPro.JSONToCSVConvertor(customeroutstandingreport, 'customeroutstanding-reports', true);
                        PosnicPro.customeroutstandingreport.customeroutstandingreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".customer_branch_value").focus();
        }
    },
    customeroutstandingReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.customeroutstandingreport.customeroutstandingreportTable(type);
    },
    customeroutstandingTableTabClick: function () {
        $('#change_customer_view').data('id', 'tableOutstandingView');
        PosnicPro.customeroutstandingreport.customeroutstandingreportTable();
    }
};

PosnicPro.customerroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.customerreport.customerreportTable();
        } else if (type === 'tableOutstandingView') {
            PosnicPro.customeroutstandingreport.customeroutstandingreportTable();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/customerreport') {
        PosnicPro.customerreport.customerreportTable();
    }
});

