PosnicPro.registerreport = {
    showModuleDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-register-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.registerreport.registerdetailsTable();
    },
    showDataTablePage: function () {
        var loader = $(".loader-register-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#registerreport_new').show();
        $('#v-pills-report-tab,#viewregisterreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#register-tab-line').hasClass('active')) {
            PosnicPro.registerreport.registerTableTabClick();
        } else {
            PosnicPro.registerproductreport.registerProductTabClick();
        }
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#register-line').css('filter', 'blur(2px)');
            $('#registerreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#register_upgrade').show();
        } else {
            $('#register-line').css('filter', 'none');
            $('#registerreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#register_upgrade').hide();
        }
    },
    registerreportTable: function (type) {
        var registerId = $("#register_report_value").val() ? $("#register_report_value").val().toString() : '';
        if (registerId !== '') {
            var loader = $(".loader-register-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('registerreport');
            var daterange = $(".view_register_report_daterange").val();
            $('.view_registerreport_date_filter_value').html('<span class="field-value-color"><lang class="lang_date_range">Date Range</lang></span> ' + ' : ' + daterange + '').addClass('date-filter-border').show();
            var fields = daterange.split('-');
            var table = $('#view_registerreport');
            if (type === 'registerreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = table.data('per_page');
            }
            var registerDetail = $("#register_report_value").select2("data");
            var register_value = registerDetail[0].element.attributes['data-register-id'].value;
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                register: register_value
            };
            var params = {
                url: 'registers/registerReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#registerreport_exportbtn').removeAttr('disabled') : $('#registerreport_exportbtn').attr('disabled', 'disabled');
                    let countedAmount = 0;
                    if (response.data.list && response.data.list[0] && response.data.list[0].countedAmount) {
                        $(response.data.list[0].countedAmount).each(function (key, val) {
                            countedAmount += val.value;
                        });
                    }
                    if (type !== 'registerreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_registerreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportregister_header').hide();
                            $('.reportregister_norecord').empty().append('<div class="text-center text-dark"> <p><lang class="lang_no_records">No Records </lang></p></div>');
                            $('#reportregister_img_hide,.reportregister_norecord').show();
                        } else {
                            $('.reportregister_norecord').empty();
                            $('#reportregister_img_hide,.reportregister_norecord').hide();
                            $('.reportregister_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_registerreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_registerreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        var payment_detail = response.data.data;
                        var pendingtotal = 0;
                        var total = 0;
                        for (var j = 0; j < payment_detail.length; j++) {
                            if (payment_detail[j].payment_mode === 'Pending') {
                                pendingtotal += payment_detail[j].sale_total;
                            }
                            total += payment_detail[j].sale_total;
                        }
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var openDate = PosnicPro.convertDate(row.open_date);
                            var closeDate = 'N/A';
                            if (row.close_date) {
                                closeDate = PosnicPro.convertDate(row.close_date);
                            }
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/registerreport/' + row.id + '/details"><i data-toggle="tooltip" class="table_model_item">' + row.register_name + '</i></a></td> <td>' + openDate + '</td> <td>' + closeDate + '</td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.opening_float + '</span></td><td class="text-right">' + currency + '&nbsp;<span class="number">' + row.register_amount + '</span></td></tr>';
                            $('#view_registerreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var registerreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.register_name;
                            var openDate = PosnicPro.convertDate(val.open_date);
                            var closeDate = 'N/A';
                            if (val.close_date) {
                                closeDate = PosnicPro.convertDate(val.close_date);
                            }
                            var float = val.opening_float;
                            var amount = val.register_amount;
                            registerreport.push({RegisterName: name, OpenDate: openDate, CloseDate: closeDate, FloatAmount: float, RegisterAmount: amount});
                        });
                        PosnicPro.JSONToCSVConvertor(registerreport, 'register-reports', true);
                        PosnicPro.registerreport.registerreportTable();
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
            $("#register_report_value").focus();
        }
    },
    registerReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.registerreport.registerreportTable(type);
    },
    registerdetailsTable: function (id) {
        PosnicPro.appendReportTableBody('registerdetails');
        var table = $('#view_registerdetails');
        var current_page = table.data('current_page');
        var per_page = table.data('per_page');
        var data = {
            page: current_page,
            limit: per_page,
            id: PosnicPro.record_id
        };
        var params = {
            url: 'registers/registerSaleDetails',
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
                $('#view_registerdetails_total,.register_details_noofsale').text(response.data.total);
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_registerdetails_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_registerdetails_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');
                $('.register_view_user').html(response.data.details.current_user);
                $('.register_view_name').html(response.data.details.register_name);
                $('.register_view_branch').html(response.data.details.branch_name);
                $('.register_view_opening').html(response.data.details.register_opendate);
                $('.register_view_closing').html(response.data.details.register_closedate);
                $('.register_view_status').html(response.data.details.register_status);
                $('#register_payment_mode').children('tbody').text('');

                // Build Payment Tally dynamically
                $('#view_payment_tally_tbody').empty();
                if (response.data.paymentTally) {
                    // Parse payment tally to extract unique payment methods
                    var paymentMethods = {};
                    $.each(response.data.paymentTally, function(key, value) {
                        // Extract method name from keys like "cash-expected-amount", "card-counted-amount"
                        var parts = key.split('-');
                        if (parts.length >= 2) {
                            var method = parts[0]; // cash, card, upi, etc.
                            var type = parts[1]; // expected, counted, difference
                            
                            if (!paymentMethods[method]) {
                                paymentMethods[method] = {};
                            }
                            paymentMethods[method][type] = value;
                        }
                    });
                    
                    // Build rows for each payment method
                    $.each(paymentMethods, function(method, amounts) {
                        var displayName = method.charAt(0).toUpperCase() + method.slice(1);
                        if (method.toLowerCase() === 'cash') {
                            displayName = 'Cash(net cash payment)';
                        }
                        
                        var expectedAmount = amounts.expected || 0;
                        var countedAmount = amounts.counted || 0;
                        var difference = amounts.difference || 0;
                        
                        var trow = '<tr>' +
                            '<td>' + displayName + '</td>' +
                            '<td>' + currency + '' + expectedAmount.toFixed(2) + '</td>' +
                            '<td>' + currency + '' + countedAmount.toFixed(2) + '</td>' +
                            '<td>' + currency + '' + difference.toFixed(2) + '</td>' +
                            '</tr>';
                        
                        $('#view_payment_tally_tbody').append(trow);
                    });
                }

                $('#view_registerdetails').children('tbody').text('');
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.sale_id + '</td> <td>' + row.date + '</td> <td>' + row.register_paymentmode + '</td> <td class="text-right">' + currency + '' + row.register_return_total.toFixed(2) + '</td><td class="text-right">' + currency + '' + row.register_amount.toFixed(2) + '</td></tr>';
                    $('#view_registerdetails').children('tbody').append(trow);
                }
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    registerTableTabClick: function () {
        $('#change_register_view').data('id', 'tableView');
        PosnicPro.registerreport.registerreportTable();
    }
};

PosnicPro.registerproductreport = {
    registerproductreportTable: function (type) {
        let loader = $(".loader-table-register");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var registerId = $("#register_report_value").val() ? $("#register_report_value").val().toString() : '';
        if (registerId !== '') {
            var daterange = $(".view_register_report_daterange").val();
            var fields = daterange.split('-');
            var registerDetail = $("#register_report_value").select2("data");
            var register_value = registerDetail[0].element.attributes['data-register-id'].value;
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                register: register_value
            };
            var params = {
                url: 'registers/getRegisterReportDetails',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    var currency = PosnicPro.local.get('currencySign');
                    $('.clear_register_text').html('');
                    $('.clear_register_value').html(currency + '&nbsp;<span class="number">0.00</span>');
                    const commonData = response.data.common_details;
                    if (commonData.length === 0) {
                        $('.register_details').hide();
                        $('#no_ecords_img').show();
                    } else {
                        $('#no_ecords_img').hide();
                        $('.register_details').show();
                    }
                    let opening = parseFloat(commonData.opening_float);
                    let branch_name = commonData.branch_name;
                    let register_name = commonData.register_name;
                    let opendate = commonData.starting_date;
                    let closedate = commonData.close_date;
                    $("#register_report_branch").html(branch_name);
                    $("#register_report_register").html(register_name);
                    $("#register_report_opendate").html(opendate ? opendate.toLocaleUpperCase() : '');
                    $("#register_report_closedate").html(closedate ? closedate.toLocaleUpperCase() : '');
                    $("#register_report_opening").html(currency + '&nbsp;<span class="number">' + opening + '</span>');
                    var cashData = response.data.cash_details;
                    var cashin = 0;
                    var cashout = 0;
                    for (var i = 0; i < cashData.length; i++) {
                        cashin += cashData[i].cashin_amount;
                        cashout += cashData[i].cashout_amount;
                        $("#register_report_cashin").html(currency + '&nbsp;<span class="number">' + cashData[i].cashin_amount + '</span>');
                        $("#register_report_cashout").html(currency + '&nbsp;<span class="number">' + cashData[i].cashout_amount + '</span>');
                    }
                    var saleData = response.data.sale_details;
                    var refund = 0;
                    var count = 0;
                    var total = 0;
                    var pendingtotal = 0;
                    let cash = 0;
                    let card = 0;
                    let cheque = 0;
                    for (var j = 0; j < saleData.length; j++) {
                        refund += saleData[j].return_total;
                        count += saleData[j].count;
                        total += saleData[j].sale_total;
                        if (saleData[j].payment_mode === 'Cash') {
                            cash = saleData[j].sale_total;
                            $("#register_report_cash").html(currency + '&nbsp;<span class="number">' + saleData[j].sale_total + '</span>');
                        } else if (saleData[j].payment_mode === 'Cheque') {
                            card = saleData[j].sale_total;
                            $("#register_report_cheque").html(currency + '&nbsp;<span class="number">' + saleData[j].sale_total + '</span>');
                        } else if (saleData[j].payment_mode === 'CreditCard') {
                            cheque = saleData[j].sale_total;
                            $("#register_report_card").html(currency + '&nbsp;<span class="number">' + saleData[j].sale_total + '</span>');
                        }
                        if (saleData[j].payment_mode === 'Pending') {
                            let pending_data = saleData[j].sale_total;
                            pendingtotal += saleData[j].sale_total;
                        }

                    }
                    let payment_report = parseFloat(total) + parseFloat(refund);
                    let recive_payement = parseFloat(payment_report) - parseFloat(pendingtotal);
                    let total_amount = parseFloat(total) - parseFloat(pendingtotal);
                    let payment_data = parseFloat(total_amount) + parseFloat(opening) + parseFloat(cashin);
                    let expectedval_data = parseFloat(payment_data) - parseFloat(cashout);
                    let counted_amount = commonData.counted_amount;
                    let difference = counted_amount - expectedval_data;
                    $("#register_report_expected").html(currency + '&nbsp;<span class="number">' + expectedval_data + '</span>');
                    $("#register_report_actual").html(currency + '&nbsp;<span class="number">' + counted_amount + '</span>');
                    $("#register_report_difference").html(currency + '&nbsp;' + parseFloat(difference) + '');
                    $("#register_report_transaction").html(count);
                    $("#register_report_totalamount").html(currency + '&nbsp;<span class="number">' + total + '</span>');
                    $("#register_report_recived").html(currency + '&nbsp;<span class="number">' + recive_payement + '</span>');
                    $("#register_report_refunds").html(currency + '&nbsp;<span class="number">' + refund + '</span>');
                    let netsale = parseFloat(recive_payement) - parseFloat(refund);
                    $("#register_report_netsale").html(currency + '&nbsp;<span class="number">' + netsale + '</span>');
                    $('span.number').number(true, 2);

                    if (type === 'CSV') {
                        let csv = [];
                        csv.push({
                            "branchName": branch_name,
                            "registerName": register_name,
                            "openDate": opendate,
                            "closeDate": closedate,
                            "startingAmount": opening,
                            "cashIn": cashin,
                            "cashOut": cashout,
                            "expectedAmount": expectedval_data,
                            "actualAmount": counted_amount,
                            "difference": difference,
                            "cash": cash,
                            "cheque": cheque,
                            "card": card,
                            "no.of.transaction": count,
                            "totalSale": total,
                            "paymentReceived": recive_payement,
                            "refund": refund,
                            "netSale": netsale
                        });
                        PosnicPro.JSONToCSVConvertor(csv, 'CSV', true);
                    }

                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    registerProductTabClick: function () {
        $('#change_register_view').data('id', 'productView');
    },
    registerReportCsv: function () {
        PosnicPro.registerproductreport.registerproductreportTable("CSV");
    },
    registerReportPdf: function () {
        var registerId = $("#register_report_value").val() ? $("#register_report_value").val().toString() : '';
        if (registerId !== '') {
            var daterange = $(".view_register_report_daterange").val();
            var fields = daterange.split('-');
            var registerDetail = $("#register_report_value").select2("data");
            var register_value = registerDetail[0].element.attributes['data-register-id'].value;
            window.open(API_URL + 'registers/getRegisterReportPdfDetails?starting_date=' + fields[0] + '&ending_date=' + fields[1] + '&register=' + register_value, "_blank");
            hasher.setHash('registerreport');
        }
    }
};

PosnicPro.registerroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.registerreport.registerreportTable();
        } else {
            PosnicPro.registerproductreport.registerproductreportTable();
        }
    },
    registerLoad: function () {
        let loader = $(".loader-table-register");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('users/getUserRegisterList', function (response) {
            if (response.type === 'success') {
                var data = response.data;
                var registerOption = [];
                $.each(data, function (index, value) {
                    registerOption += '<option value="' + value.register_id + '" data-register-name="' + value.register_name + '" data-register-id="' + value.register_id + '" >' + value.register_name + '</option>';
                });
                $('#register_report_value').html(registerOption);
                $("#register_report_value option[value='" + PosnicPro.local.get('RegisterId') + "']").prop("selected", true);
                PosnicPro.registerreport.registerreportTable();
                PosnicPro.registerproductreport.registerproductreportTable();
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    }
};

PosnicPro.registerdetails = {
    registerdetailsTable: function () {
        PosnicPro.registerreport.registerdetailsTable();
    }
};

$(document).ready(function () {
    PosnicPro.registerroot.registerLoad();
});