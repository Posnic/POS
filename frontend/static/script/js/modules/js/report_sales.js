PosnicPro.salereport = {
    showDataTablePage: function () {
        var loader = $(".loader-sale-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#salereport_new').show();
        $('#v-pills-report-tab,#viewsalereport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#sale-view-tab-line').hasClass('active')) {
            PosnicPro.salereport.saleTableTabClick();
        } else if ($('a#instant-tab-line').hasClass('active')) {
            PosnicPro.instantreport.instantTableTabClick();
        } else if ($('a#sale-summary-tab-line').hasClass('active')) {
            PosnicPro.salesummaryreport.saleSummaryTabClick();
        } else {
            PosnicPro.salegraphicalreport.saleGraphTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#sale-view-line, #instant-line, #sale-summary-line, #sale-graph-line').css('filter', 'blur(2px)');
            $('#salereport_exportbtn, #instantreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#sales_upgrade').show();
        } else {
            $('#sale-view-line, #instant-line, #sale-summary-line, #sale-graph-line').css('filter', 'none');
            $('#salereport_exportbtn, #instantreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#sales_upgrade').hide();
        }
    },
    salereportTable: function (type) {
        // Helper functions
        function trim(s) {
            return (s || '').replace(/^\s+|\s+$/g, '');
        }

        var branchId = String($(".sale_branch_value").val() || '');
        if (!branchId) {
            $(".sale_branch_value").focus();
            return;
        }

        var loader = $(".loader-sale-report");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        var daterange = String($(".view_sale_report_daterange").val() || '');
        var fields = daterange.indexOf(' - ') > -1 
            ? daterange.split(' - ') 
            : daterange.split('-');
        var startDate = trim(fields[0]);
        var endDate = trim(fields[1]);

        if (!startDate || !endDate) {
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert('error', 'Select a valid date range');
            return;
        }
        var table = $('#view_salereport');
        if (type === 'salereportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = parseInt($('#view_salereport_per_page  option:selected').text());
        }

        var data = {
            page: current_page,
            limit: per_page,
            starting_date: startDate,
            ending_date: endDate,
            branch: branchId
        };
        var params = {
            url: 'sales/salesReports',
            data: data
        };
        PosnicPro.get(params, function (response) {
            loader.find(".loadingSpinner:first").remove();
            if (response.type === 'success') {
                    (response.data.total > 0) ? $('#salereport_exportbtn').removeAttr('disabled') : $('#salereport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'salereportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_salereport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportsale_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportsale_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportsale_img_hide,.reportsale_norecord').show();

                        } else {
                            $('.reportsale_norecord').empty();
                            $('#reportsale_img_hide,.reportsale_norecord').hide();
                            $('.reportsale_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_salereport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_salereport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var updateDate = PosnicPro.convertDate(row.string_date);
                            var trow = '<tr><td><i class="exploder"><span class="feather icon-plus-circle"></span></i></td> <td scope="row">' + row_no + '</td>  <td><a href="#/salereport/' + row._id + '"><i data-toggle="tooltip" class="table_model_item mobile_tooltip" title="View Details">' + row.sales_id + '</i></a></td> <td class="export-date">' + updateDate + '</td> <td>' + row.customer_name + '</td> <td class="text-right"><a class="sale_color" href="tel:' + row.customer_phone + '">' + row.customer_phone + '</a></td> <td class="export-total-item text-center">' + row.number_of_items + '</td> <td class="export-price text-right">' + currency + '&nbsp;<span class="number">' + (row.extra_discount || 0) + '</span></td> <td class="export-price text-right">' + currency + '&nbsp;<span class="number">' + row.items_total + '</span></td> </tr><tr class="explode hide"><td style="background: #f9f8f8; display: none;"  colspan="12"><table class="table table-striped" cellspacing="0" width="100%" id="' + row._id + 'reportaction"><thead><tr><th>Item name</th><th class="text-center">SKU</th><th class="text-right">Price</th><th class="text-right">Qty</th><th class="text-right">Discount</th><th class="text-right">Tax [%]</th><th class="text-right">Total</th></tr></thead><tbody></tbody></table></td></tr>';
                            $('#view_salereport').children('tbody').append(trow);
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
                        var salesreportexportdata = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var date = val.string_date;
                            var id = val.sales_id;
                            var customer = val.customer_name;
                            var phone = val.customer_phone;
                            var totalitems = val.number_of_items;
                            var extraDiscount = parseFloat(val.extra_discount) || 0;
                            
                            $(data[key].items).each(function (key, value) {
                                var name = value.item_name;
                                var sku = value.barcode_id;
                                var quantity = value.item_quantity;
                                var discount = (value.item_discount > 0) ? value.item_discount : value.item_discount_percentage;
                                var discountSign = (value.item_discount > 0) ? currency : '%';
                                var tax_value = 0;
                                var discountValue = 0;
                                var discountDisplay = '0';

                                var price = parseFloat(value.item_price) || 0;
                                if (value.tax_type === 'inclusive') {
                                    price = value.item_price / ((value.tax / 100) + 1);
                                }

                                var updatePrice = 0;

                                if (discount > 0) {
                                    if (discountSign === '%') {
                                        discountValue = (price * discount / 100) * value.item_quantity;
                                        discountDisplay = discount + '% (' + discountValue.toFixed(2) + ')';
                                    } else {
                                        discountValue = discount * value.item_quantity;
                                        discountDisplay = currency + ' ' + discount + ' (' + discountValue.toFixed(2) + ')';
                                    }
                                    updatePrice = ((price * value.item_quantity) - discountValue).toFixed(2);
                                } else {
                                    updatePrice = (price * value.item_quantity).toFixed(2);
                                }

                                if (value.tax > 0) {
                                    tax_value = value.tax + '% (' + (updatePrice * (value.tax / 100)).toFixed(2) + ')';
                                }
                                var total = value.total_amount;
                                var itemsTotal = parseFloat(val.items_total) || 0;
                                salesreportexportdata.push({SalesId: id, Date: date, CustomerName: customer, CustomerPhone: phone, NoOfItems: totalitems, ItemName: name, SKU: sku, ItemPrice: price.toFixed(2), ItemQty: quantity, ItemDiscount: discountDisplay, ItemTax: tax_value, ItemTotal: total, ExtraDiscount: extraDiscount.toFixed(2), Total: itemsTotal.toFixed(2)});
                            });

                        });
                        PosnicPro.JSONToCSVConvertor(salesreportexportdata, 'sales-reports', true);
                        PosnicPro.instantreport.instantreportTable();
                        PosnicPro.salereport.salereportTable();
                    }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var response;
            try {
                response = jQuery.parseJSON(xhr.responseText || '{}');
            } catch (e) {
                response = { type: 'error', message: 'Request failed' };
            }
            PosnicPro.alert(response.type || 'error', response.message || 'Request failed');
        });
    },
    viewReportSaleExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.salereport.salereportTable(type);
    },
    saleTableTabClick: function () {
        $('#change_sale_view').data('id', 'tableView');
        $(".hide-sale-details").prop('disabled', false);
        PosnicPro.salereport.salereportTable();
    },
    showDetails: function (id) {
        PosnicPro.sales.view.viewSale(id);
        $('.mobile_tooltip').tooltip('hide');
    }
};

PosnicPro.instantreport = {
    instantreportTable: function (type) {
        var branchId = $(".sale_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-instant-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_sale_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_instantreport');
            if (type === 'instantreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_instantreport_per_page  option:selected').text());
            }

            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".sale_branch_value").val()
            };
            var params = {
                url: 'sales/instantSalesReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#instantreport_exportbtn').removeAttr('disabled') : $('#instantreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'instantreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_instantreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportsale_instheader').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportinstance_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                            $('#reportinstance_img_hide,.reportinstance_norecord').show();

                        } else {
                            $('.reportinstance_norecord').empty();
                            $('#reportinstance_img_hide,.reportinstance_norecord').hide();
                            $('.reportsale_instheader').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_instantreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_instantreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td><td><a href="#/instantreport/' + row._id + '/details"><i data-toggle="tooltip" class="table_model_item mobile_tooltip" title="View Details">' + row.sales_id + '<i></a></td> <td>' + row.date + '</td> <td>' + row.customer_name + '</td> <td>' + row.user_name + '</td> <td class="text-center">' + row.total_qty + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_instantreport').children('tbody').append(trow);
                        }
                        $('span.number').number(true, 2);
                    } else {
                        var receivingreportexportdata = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var id = val.sales_id;
                            var date = val.date;
                            var customer = val.customer_name;
                            var user = val.user_name;
                            var qty = val.total_qty;
                            var amount = val.total_amount;
                            receivingreportexportdata.push({SalesId: id, Date: date, CustomerName: customer, UserName: user, TotalQty: qty, TotalAmount: amount});
                        });

                        PosnicPro.JSONToCSVConvertor(receivingreportexportdata, 'instant-reports', true);
                        PosnicPro.instantreport.instantreportTable();
                        PosnicPro.salereport.salereportTable();
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
            $(".sale_branch_value").focus();
        }
    },
    instantreportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.instantreport.instantreportTable(type);
    },
    instantTableTabClick: function () {
        $('#change_sale_view').data('id', 'instantView');
        $(".hide-sale-details").prop('disabled', true);
        PosnicPro.instantreport.instantreportTable();
    },
    showModuleDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-instant-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.instantdetails.instantdetailsTable();
        $('.mobile_tooltip').tooltip('hide');
    },
    showDataTablePage: function () {
        hasher.setHash('salereport');
    }
};

PosnicPro.instantdetails = {

    instantdetailsTable: function () {
        PosnicPro.appendReportTableBody('returndetails');
        var table = $('#view_instantdetails');
        var current_page = table.data('current_page');
        var per_page = table.data('per_page');

        var data = {
            page: current_page,
            limit: per_page,
            instant_id: PosnicPro.record_id,
            branch: $(".sale_branch_value").val()
        };
        var params = {
            url: 'sales/instantSaleDetails',
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
                $('#view_instantdetails_total').text(response.data.total);
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_instantdetails_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_instantdetails_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');
                var tot = 0;
                var qty = 0;
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    tot += row.total_amount;
                    qty += row.item_quantity;
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + row.item_quantity + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                    $('#view_instantdetails').children('tbody').append(trow);
                    $('.instant_view_name').html(row.sales_id);
                }
                $('span.number').number(true, 2);

                $('.instantcurrency_symbol').html(currency);
                $('.instant_details_totalsale').html(tot.toFixed(2));
                $('.instant_details_noofsale').html(qty);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

PosnicPro.salegraphicalreport = {
    graphicalReportSale: function () {
        var graphBranchId = $(".sale_branch_value").val().toString();
        if (graphBranchId !== '') {
            var loader = $(".loader-sales-graph-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_sale_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".sale_branch_value").val()
            };
            var params = {
                url: 'sales/salesGraphicalReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data;
                    PosnicPro.salegraphicalreport.showChartJs(data);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".sale_branch_value").focus();
        }
    },
    showChartJs: function (data) {

        /* An empty chart draws as a grey rectangle that reads as a failure. */
        if (!data || !data.length) {
            PosnicPro.chart.empty('sales-report-apex-circle-chart',
                'No sales in the selected period');
            return;
        }

        am4core.ready(function () {

// Themes begin
            am4core.useTheme(am4themes_animated);
// Themes end

// Create chart instance
            var chart = PosnicPro.chart.create("sales-report-apex-circle-chart", am4charts.XYChart);
            if (!chart) return; // the panel is not on the page

// Add data
            chart.data = data;
            chart.logo.disabled = true;

// Create axes
            var dateAxis = chart.xAxes.push(new am4charts.DateAxis());
            dateAxis.tooltip.disabled = true;
            var valueAxis1 = chart.yAxes.push(new am4charts.ValueAxis());
            valueAxis1.title.text = "Sales";

            var valueAxis2 = chart.yAxes.push(new am4charts.ValueAxis());

// Create series

            let currency = PosnicPro.local.get('currencySign');
            var series1 = chart.series.push(new am4charts.ColumnSeries());
            series1.dataFields.valueY = "sales";
            series1.dataFields.dateX = "date";
            series1.yAxis = valueAxis1;
            series1.name = "Sale";
            series1.tooltipText = "{name}\n[bold font-size: 20]" + currency + "\t{valueY}[/]";
            series1.fill = am4core.color("#67b7dc");
            series1.strokeWidth = 0;
            series1.clustered = false;
            series1.columns.template.width = am4core.percent(50);

            var series2 = chart.series.push(new am4charts.ColumnSeries());
            series2.dataFields.valueY = "avg";
            series2.dataFields.dateX = "date";
            series2.yAxis = valueAxis1;
            series2.name = "Avg Sale";
            series2.tooltipText = "{name}\n[bold font-size: 20]" + currency + "\t{valueY}[/]";
            series2.fill = am4core.color("#fd9c35");
            series2.strokeWidth = 0;
            series2.clustered = false;
            series2.columns.template.width = am4core.percent(80);
            series2.toBack();

            var series3 = chart.series.push(new am4charts.ColumnSeries());
            series3.dataFields.valueY = "profit";
            series3.dataFields.dateX = "date";
            series3.yAxis = valueAxis1;
            series3.name = "Profit";
            series3.tooltipText = "{name}\n[bold font-size: 20]" + currency + "\t{valueY}[/]";
            series3.fill = am4core.color("#83cc8e");
            series3.strokeWidth = 0;
            series3.clustered = false;
            series3.columns.template.width = am4core.percent(20);
            series3.toFront();

// Add cursor
            chart.cursor = new am4charts.XYCursor();

// Add legend
            chart.legend = new am4charts.Legend();
            chart.legend.position = "top";

// Add scrollbar
            chart.scrollbarX = new am4charts.XYChartScrollbar();
            chart.scrollbarX.series.push(series1);
            chart.scrollbarX.series.push(series3);
            chart.scrollbarX.parent = chart.bottomAxesContainer;

        }); // end am4core.ready()
    },
    saleGraphTabClick: function () {
        $('#change_sale_view').data('id', 'graphView');
        $(".hide-sale-details").prop('disabled', true);
        PosnicPro.salegraphicalreport.graphicalReportSale();
    }
};

PosnicPro.salesummaryreport = {
    summaryreportTable: function () {
        var BranchId = $(".sale_branch_value").val().toString();
        if (BranchId !== '') {
            var loader = $(".loader-summary-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_sale_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".sale_branch_value").val()
            };
            var params = {
                url: 'sales/salesSummaryReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data;
                    $('#sale_summary_discounts').html(data.discounts.toFixed(2));
                    $('#sale_summary_profit').html(data.gross_profit.toFixed(2));
                    $('#sale_summary_refund').html(data.refunds.toFixed(2));
                    $('#sale_summary_companyprice').html(data.cogs.toFixed(2));

                    $('#sale_summary_excltaxval').html(data.sales_exclude_tax.toFixed(2));
                    $('#sale_summary_incltaxval').html(data.sales_include_tax.toFixed(2));
                    $('#sale_summary_netsale').html(data.net_sales.toFixed(2));
                    $('#sale_summary_netsaletax').html(data.net_sales_tax.toFixed(2));

                    // Order Type summary (Dine-in vs Take away)
                    var orderTypeSummary = data.order_type_summary || [];
                    var dineInTotal = 0, dineInCount = 0;
                    var takeAwayTotal = 0, takeAwayCount = 0;

                    for (var i = 0; i < orderTypeSummary.length; i++) {
                        var row = orderTypeSummary[i] || {};
                        var type = (row.dine_type || '').trim();
                        var total = parseFloat(row.total_sales || 0) || 0;
                        var count = parseInt(row.sale_count || 0, 10) || 0;

                        if (type === 'Take away') {
                            takeAwayTotal += total;
                            takeAwayCount += count;
                        } else {
                            // Treat everything else as Dine-in (default)
                            dineInTotal += total;
                            dineInCount += count;
                        }
                    }

                    $('#sale_summary_dinein_total').html(dineInTotal.toFixed(2));
                    $('#sale_summary_dinein_count').html(dineInCount);
                    $('#sale_summary_takeaway_total').html(takeAwayTotal.toFixed(2));
                    $('#sale_summary_takeaway_count').html(takeAwayCount);

                    // Respect table order setting: hide Order Type cards when table order is OFF
                    var tableOptionsEnabled = (PosnicPro.local.get('table_options') === 'enable');
                    var dineInCard = $('#sale_summary_dinein_total').closest('.card');
                    var takeAwayCard = $('#sale_summary_takeaway_total').closest('.card');
                    if (tableOptionsEnabled) {
                        dineInCard.show();
                        takeAwayCard.show();
                    } else {
                        dineInCard.hide();
                        takeAwayCard.hide();
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
    saleSummaryTabClick: function () {
        $('#change_sale_view').data('id', 'summaryView');
        $(".hide-sale-details").prop('disabled', true);
        PosnicPro.salesummaryreport.summaryreportTable();
    }
};



$(document).ready(function () {
  setTimeout(function () {
    var fullHash = window.location.hash;
    var hash = fullHash.replace(/^#\/?/, "");
    if (hash === "quickreport") {
      var loader = $(".loader-dailysale-report");
      loader.find(".loadingSpinner:first").remove();
      $("#view_sale_report_daterange")
        .data("daterangepicker")
        .setStartDate(moment().startOf("day"));
      $("#view_sale_report_daterange")
        .data("daterangepicker")
        .setEndDate(moment().endOf("day"));
      $("#view_sale_report_daterange span").html(
        '<span>Today</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' +
          moment().startOf("day").format("YYYY/MM/DD h:mm A") +
          " - " +
          moment().endOf("day").format("YYYY/MM/DD h:mm A") +
          '"><i class="feather icon-help-circle setfeather_font"></i></span>'
      );
      $("#view_sale_report_daterange").val(
        moment().startOf("day").format("YYYY/MM/DD h:mm A") +
          " - " +
          moment().endOf("day").format("YYYY/MM/DD h:mm A")
      );

      PosnicPro.quickreport.salereportTable();
    }
  }, 3000);
});


PosnicPro.saleroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.salereport.salereportTable();
        } else if (type === 'instantView') {
            PosnicPro.instantreport.instantreportTable();
        } else if (type === 'summaryView') {
            PosnicPro.salesummaryreport.summaryreportTable();
        } else {
            PosnicPro.salegraphicalreport.graphicalReportSale();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/salereport') {
        var loader = $(".loader-sale-report,.loader-instant-report,.loader-sales-graph-report,.loader-summary-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.salereport.salereportTable();
    }
});
//table collapse
$(document).on("click", "#view_salereport tbody tr td .exploder", function () {
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

