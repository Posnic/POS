PosnicPro.kioskreport = {
    showDataTablePage: function () {
        var loader = $(".loader-kiosk-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#kioskreport_new').show();
        $('#v-pills-report-tab,#viewkioskreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#kiosk-view-tab-line').hasClass('active')) {
            PosnicPro.kioskreport.kioskTableTabClick();
        } else if ($('a#kiosk-summary-tab-line').hasClass('active')) {
            PosnicPro.kiosksummaryreport.kioskSummaryTabClick();
        } else {
            PosnicPro.kioskgraphicalreport.kioskGraphTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#kiosk-view-line, #kiosk-summary-line, #kiosk-graph-line').css('filter', 'blur(2px)');
            $('#kioskreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#kiosks_upgrade').show();
        } else {
            $('#kiosk-view-line, #kiosk-summary-line, #kiosk-graph-line').css('filter', 'none');
            $('#kioskreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#kiosks_upgrade').hide();
        }
    },
    kioskreportTable: function (type) {

        var branchId = $(".kiosk_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-kiosk-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_kiosk_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_kioskreport');
            if (type === 'kioskreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_kioskreport_per_page  option:selected').text());
            }

            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".kiosk_branch_value").val(),
                kiosk_method: $("#kiosk_method").val()
            };
            var params = {
                url: 'sales/kioskReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#kioskreport_exportbtn').removeAttr('disabled') : $('#kioskreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'kioskreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_kioskreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportkiosk_header').hide();
                            /*
                             * #view_kiosks_daterange has never existed - the
                             * element on this page is #view_kiosk_report_daterange.
                             * The read returned undefined, so an empty kiosk
                             * report said "No Records on undefined" to the shop.
                             *
                             * The fallback is not belt-and-braces: this page can
                             * render before the picker has been given a tooltip
                             * title, and printing the word "undefined" at a
                             * customer is worse than saying nothing about dates.
                             */
                            let dateRange = $('#view_kiosk_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            let when = dateRange ? ' on ' + dateRange : '';
                            $('.reportkiosk_norecord').empty().append('<div class="text-center text-dark"> <p>No Records' + when + '</p></div>');
                            $('#reportkiosk_img_hide,.reportkiosk_norecord').show();

                        } else {
                            $('.reportkiosk_norecord').empty();
                            $('#reportkiosk_img_hide,.reportkiosk_norecord').hide();
                            $('.reportkiosk_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_kioskreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_kioskreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var updateDate = PosnicPro.convertDate(row.string_date);
                            var trow = '<tr><td><i class="exploder"><span class="feather icon-plus-circle"></span></i></td> <td scope="row">' + row_no + '</td>  <td><a href="#/kioskreport/' + row._id + '"><i data-toggle="tooltip" class="table_model_item mobile_tooltip" title="View Details">' + row.sales_id + '</i></a></td> <td class="export-date">' + updateDate + '</td> <td><a class="kiosk_color" href="tel:' + row.customer_phone + '">' + row.customer_phone + '</a></td> <td class="export-total-item text-center">' + row.number_of_items + '</td> <td>' + row.sale_method + '</td> <td>' + row.order + '</td>  <td class="export-price text-right">' + currency + '&nbsp;<span class="number">' + row.items_total + '</span></td> </tr><tr class="explode hide"><td style="background: #f9f8f8; display: none;"  colspan="12"><table class="table table-striped" cellspacing="0" width="100%" id="' + row._id + 'reportaction"><thead><tr><th>Item name</th><th class="text-center">SKU</th><th class="text-right">Price</th><th class="text-right">Qty</th><th class="text-right">Discount</th><th class="text-right">Tax [%]</th><th class="text-right">Total</th></tr></thead><tbody></tbody></table></td></tr>';
                            $('#view_kioskreport').children('tbody').append(trow);
                            for (var j = 0; j < row.items.length; j++) {
                                var val = row.items[j];
                                var discount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                                var discountSign = (val.item_discount > 0) ? currency : '%';
                                var price = val.item_price;
                                var tax_value = 0;
                                var discountValue = 0;
                                var discountDisplay = '0';

                                if (val.tax_type === 'inclusive') {
                                    price = val.item_price / ((val.tax / 100) + 1);
                                }

                                var discountValue = 0;
                                var discountDisplay = '0';
                                var updatePrice = 0;

                                if (discount > 0) {
                                    if (discountSign === '%') {
                                        discountValue = (price * discount / 100) * val.item_quantity;
                                        discountDisplay = discount + '% (' + discountValue.toFixed(2) + ')';
                                    } else {
                                        discountValue = discount * val.item_quantity;
                                        discountDisplay = '₹ ' + discount + ' (' + discountValue.toFixed(2) + ')';
                                    }
                                    updatePrice = ((price * val.item_quantity) - discountValue).toFixed(2);
                                } else {
                                    updatePrice = (price * val.item_quantity).toFixed(2);
                                }

                                if (val.tax > 0) {
                                    tax_value = val.tax + '% (' + (updatePrice * (val.tax / 100)).toFixed(2) + ')';
                                }

                                var lineitem = '<tr><td><tbody><tr style="border: 1px solid wheat;"><td class="export-item-name">' + val.item_name + '</td><td class="export-item-barcode-id text-center">' + val.barcode_id + '</td><td class="export-item-price text-right">' + currency + '&nbsp;<span class="number">' + price + '</span></td><td class="export-item-qty text-right">' + val.item_quantity + '</td><td class="export-item-discount-amount text-right">' + discountDisplay + '</td><td class="export-item-tax text-right">' + tax_value + '</td><td class="export-item-total text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span></td></tr></tbody></td></tr>';
                                $("#" + row._id + 'reportaction').children('tbody').append(lineitem);
                            }
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var kiosksreportexportdata = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var date = val.string_date;
                            var id = val.kiosks_id;
                            var type = val.sale_method;
                            var order = val.order;
                            var phone = val.customer_phone;
                            var totalitems = val.number_of_items;
                            var total = val.items_total;
                            $(data[key].items).each(function (key, value) {
                                var name = value.item_name;
                                var sku = value.barcode_id;
                                var quantity = value.item_quantity;
                                var discount = (value.item_discount > 0) ? value.item_discount : value.item_discount_percentage;
                                var discountSign = (value.item_discount > 0) ? currency : '%';
                                var tax_value = 0;
                                var discountValue = 0;
                                var discountDisplay = '0';

                                var price = value.item_price;
                                if (typeof price !== 'number') {
                                    price = parseFloat(price) || 0;
                                }
                                if (value.tax_type === 'inclusive') {
                                    price = price / ((value.tax / 100) + 1);
                                }

                                var discountValue = 0;
                                var discountDisplay = '0';
                                var updatePrice = 0;

                                if (discount > 0) {
                                    if (discountSign === '%') {
                                        discountValue = (price * discount / 100) * value.item_quantity;
                                        discountDisplay = discount + '% (' + discountValue.toFixed(2) + ')';
                                    } else {
                                        discountValue = discount * value.item_quantity;
                                        discountDisplay = '₹ ' + discount + ' (' + discountValue.toFixed(2) + ')';
                                    }
                                    updatePrice = ((price * value.item_quantity) - discountValue).toFixed(2);
                                } else {
                                    updatePrice = (price * value.item_quantity).toFixed(2);
                                }

                                if (value.tax > 0) {
                                    tax_value = value.tax + '% (' + (updatePrice * (value.tax / 100)).toFixed(2) + ')';
                                }
                                var total = value.total_amount;
                                kiosksreportexportdata.push({ kiosksId: id, Date: date, SaleType: type, OrderType: order, CustomerPhone: phone, NoOfItems: totalitems, ItemName: name, SKU: sku, ItemPrice: price.toFixed(2), ItemQty: quantity, ItemDiscount: discountDisplay, ItemTax: tax_value, ItemTotal: total });
                            });

                        });
                        PosnicPro.JSONToCSVConvertor(kiosksreportexportdata, 'kiosks-reports', true);
                        PosnicPro.kioskreport.kioskreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".kiosk_branch_value").focus();
        }
    },
    viewReportkioskExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.kioskreport.kioskreportTable(type);
    },
    kioskTableTabClick: function () {
        $('#change_kiosk_view').data('id', 'tableView');
        $(".hide-kiosk-details").prop('disabled', false);
        PosnicPro.kioskreport.kioskreportTable();
    },
    showDetails: function (id) {
        PosnicPro.sales.view.viewSale(id);
        $('.mobile_tooltip').tooltip('hide');
    }
};

PosnicPro.kioskgraphicalreport = {
    graphicalReportkiosk: function () {
        var graphBranchId = $(".kiosk_branch_value").val().toString();
        if (graphBranchId !== '') {
            var loader = $(".loader-kiosks-graph-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_kiosk_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".kiosk_branch_value").val(),
                kiosk_method: $("#kiosk_method").val()
            };
            var params = {
                url: 'sales/kiosksGraphicalReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data;
                    PosnicPro.kioskgraphicalreport.showChartJs(data);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".kiosk_branch_value").focus();
        }
    },
    showChartJs: function (data) {
        // Convert labels to timestamped data points
        var cashSeries = [];
        var upiSeries = [];

        for (var i = 0; i < data.labels.length; i++) {
            cashSeries.push({
                x: new Date(data.labels[i]).getTime(),
                y: data.cash[i]
            });
            upiSeries.push({
                x: new Date(data.labels[i]).getTime(),
                y: data.upi[i]
            });
        }

        // Main area chart
        var mainChartOptions = {
            chart: {
                id: 'main-chart',
                type: 'area',
                height: 350,
                toolbar: { show: true },
                zoom: { enabled: false }
            },
            colors: ['#ff6f61', '#007bff'],
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth', width: 2 },
            xaxis: {
                type: 'datetime',
                title: { text: 'Date & Time' },
                labels: {
                    rotate: -45,
                    datetimeFormatter: {
                        year: 'yyyy',
                        month: "MMM 'yy",
                        day: 'dd MMM',
                        hour: 'dd MMM, hh:mm TT' // ✅ Show full date + time
                    },
                    format: 'dd MMM, hh:mm TT' // ✅ Ensure x-axis shows full datetime
                }
            },
            tooltip: {
                x: {
                    format: 'dd MMM yyyy, hh:mm TT' // ✅ Tooltip format
                },
                y: {
                    formatter: function (val) {
                        return '₹ ' + val.toFixed(2);
                    }
                }
            },            
            series: [
                { name: 'Cash', data: cashSeries },
                { name: 'UPI / QR', data: upiSeries }
            ]
        };

        // Range slider mini chart
        var rangeSliderOptions = {
            chart: {
                id: 'slider-chart',
                height: 130,
                type: 'area',
                brush: {
                    target: 'main-chart',
                    enabled: true
                },
                selection: {
                    enabled: true,
                    xaxis: {
                        min: cashSeries.length > 0 ? cashSeries[0].x : new Date().getTime(),
                        max: cashSeries.length > 5 ? cashSeries[5].x : new Date().getTime() + 3600000
                    }
                }
            },
            colors: ['#d1d1d1'],
            series: [{ name: 'Cash', data: cashSeries }],
            xaxis: {
                type: 'datetime',
                labels: { show: false },
                tooltip: { enabled: false }
            },
            yaxis: { labels: { show: false } }
        };

        // Clear and render charts
        $("#kiosks-report-apex-line-chart").html('');
        $("#kiosks-report-apex-range-slider").html('');

        /* Owner's rule: no charts on mobile at all - see
           PosnicPro.chart.disabledHere. The graph tab says so instead. */
        if (PosnicPro.chart.disabledHere()) {
            $("#kiosks-report-apex-line-chart").html(
                '<div class="chart-empty-state"><i class="icon-bar-chart"></i>' +
                '<p>Charts are shown on the desktop version</p></div>');
            return;
        }

        PosnicPro.lazy.load('apexcharts').then(function () {
            var line = document.querySelector("#kiosks-report-apex-line-chart");
            var slider = document.querySelector("#kiosks-report-apex-range-slider");
            if (line) new ApexCharts(line, mainChartOptions).render();
            if (slider) new ApexCharts(slider, rangeSliderOptions).render();
        });

    },
    kioskGraphTabClick: function () {
        $('#change_kiosk_view').data('id', 'graphView');
        $(".hide-kiosk-details").prop('disabled', true);
        PosnicPro.kioskgraphicalreport.graphicalReportkiosk();
    }
};

PosnicPro.kiosksummaryreport = {
    summaryreportTable: function () {
        var BranchId = $(".kiosk_branch_value").val().toString();
        if (BranchId !== '') {
            var loader = $(".loader-summary-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_kiosk_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".kiosk_branch_value").val(),
                kiosk_method: $("#kiosk_method").val()
            };
            var params = {
                url: 'sales/kiosksSummaryReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data;
                    $('#kiosk_summary_discounts').html(data.discounts.toFixed(2));
                    $('#kiosk_summary_profit').html(data.gross_profit.toFixed(2));
                    $('#kiosk_summary_refund').html(data.refunds.toFixed(2));
                    $('#kiosk_summary_companyprice').html(data.cogs.toFixed(2));

                    $('#kiosk_summary_excltaxval').html(data.sales_exclude_tax.toFixed(2));
                    $('#kiosk_summary_incltaxval').html(data.sales_include_tax.toFixed(2));
                    $('#kiosk_summary_netkiosk').html(data.net_sales.toFixed(2));
                    $('#kiosk_summary_netkiosktax').html(data.net_sales_tax.toFixed(2));
                    // Handle payment_mode_totals display
                    if (data.payment_mode_totals) {
                        const paymentModes = data.payment_mode_totals;

                        // UPI / QR
                        if (paymentModes.Upi !== undefined) {
                            $('#kiosk_summary_qrprice').text(parseFloat(paymentModes.Upi).toFixed(2));
                        } else {
                            $('#kiosk_summary_qrprice').text("0.00");
                        }

                        // Cash
                        if (paymentModes.Cash !== undefined) {
                            $('#kiosk_summary_cashprice').text(parseFloat(paymentModes.Cash).toFixed(2));
                        } else {
                            $('#kiosk_summary_cashprice').text("0.00");
                        }
                    }

                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    kioskSummaryTabClick: function () {
        $('#change_kiosk_view').data('id', 'summaryView');
        $(".hide-kiosk-details").prop('disabled', true);
        PosnicPro.kiosksummaryreport.summaryreportTable();
    }
};

PosnicPro.kioskroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.kioskreport.kioskreportTable();
        } else if (type === 'summaryView') {
            PosnicPro.kiosksummaryreport.summaryreportTable();
        } else {
            PosnicPro.kioskgraphicalreport.graphicalReportkiosk();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/kioskreport') {
        var loader = $(".loader-kiosk-report,.loader-kiosks-graph-report,.loader-summary-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.kioskreport.kioskreportTable();
    }
});
//table collapse
$(document).on("click", "#view_kioskreport tbody tr td .exploder", function () {
    $('.mobile_tooltip').tooltip('hide');
    $(this).children("span").toggleClass("feather icon-plus-circle feather icon-minus-circle");
    $(this).closest("tr").next("tr").toggleClass("hide");

    if ($(this).closest("tr").next("tr").hasClass("hide")) {
        $(this).closest("tr").next("tr").children("td").slideUp(100);
    } else {
        $(this).closest("tr").next("tr").children("td").slideDown(100);
    }
});
//end

