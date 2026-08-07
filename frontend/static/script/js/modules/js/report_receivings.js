PosnicPro.receivingreport = {
    showDataTablePage: function () {
        var loader = $(".loader-receiving-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#receivingreport_new').show();
        $('#v-pills-report-tab,#viewreceivingreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#receiving-tab-line').hasClass('active')) {
            PosnicPro.receivingreport.receivingTableTabClick();
        } else {
            PosnicPro.receivinggraphicalreport.receivingGraphTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#receiving-line, #receiving-graph-line').css('filter', 'blur(2px)');
            $('#receivingreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#receiving_upgrade').show();
        } else {
            $('#receiving-line, #receiving-graph-line').css('filter', 'none');
            $('#receivingreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#receiving_upgrade').hide();
        }
    },
    receivingreportTable: function (type) {
        PosnicPro.appendReportTableBody('receivingreport');
        var branchId = $(".receiving_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-receiving-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            $("#Receiving_detailed_report_selecter").hide();
            $("#receivingexport").show();
            var daterange = $(".view_receiving_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_receivingreport');

            if (type === 'receivingreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_receivingreport_per_page  option:selected').text());
            }

            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".receiving_branch_value").val()
            };
            var params = {
                url: 'receivings/receivingReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#receivingreport_exportbtn').removeAttr('disabled') : $('#receivingreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'receivingreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_receivingreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportpurchase_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportpurchase_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                            $('#reportpurchase_img_hide,.reportpurchase_norecord').show();

                        } else {
                            $('.reportpurchase_norecord').empty();
                            $('#reportpurchase_img_hide,.reportpurchase_norecord').hide();
                            $('.reportpurchase_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_receivingreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_receivingreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var updateDate = PosnicPro.convertDate(row.string_date);
                            var trow = '<tr><td><i class="exploder"><span class="feather icon-plus-circle"></span></i></td> <td scope="row">' + row_no + '</td>  <td><a href="#/receivingreport/' + row._id + '" ><i data-toggle="tooltip" class="table_model_item mobile_tooltip" title="View Details">' + row.receiving_id + '</i></a></td> <td class="export-date">' + updateDate + '</td> <td>' + row.supplier_name + '</td> <td class="text-right"><a class="sale_color" href="tel:' + row.supplier_phone + '">' + row.supplier_phone + '</a></td> <td class="export-total-item text-center">' + row.items.length + '</td> <td class="export-price text-right">' + currency + '&nbsp;<span class="number">' + row.items_total + '</span></td></tr><tr class="explode hide"><td style="background: #f9f8f8; display: none;" colspan="12"><table class="table table-striped" cellspacing="0" width="100%" id="receiving_report_' + row._id + '"><thead><tr><th>Item name</th><th class="text-center">SKU</th><th class="text-right">Price</th><th class="text-right">Qty</th><th class="text-right">Tax [%]</th><th class="text-right">Total</th></tr></thead><tbody></tbody></table></td></tr>';
                            $('#view_receivingreport').children('tbody').append(trow);
                            //var amount = 0;
                            var lineitem = '';
                            var tax_value = 0;
                            for (var j = 0; j < row.items.length; j++) {
                                var val = row.items[j];
                                //amount += val.total_amount;
                                var tax_type = val.tax_type;
                                if (tax_type === 'exclusive') {
                                    var price = val.item_price;
                                } else {
                                    var price = val.item_price / ((val.tax / 100) + 1);
                                }

                                if (val.tax > 0) {
                                    tax_value = val.tax + '% (' + ((price * val.item_quantity) * (val.tax / 100)).toFixed(2) + ')';
                                }
                                lineitem += '<tr style="border: 1px solid wheat;"><td class="export-item-name">' + val.item_name + '</td><td class="export-item-barcode-id text-center">' + val.barcode_id + '</td><td class="export-item-price text-right">' + currency + '&nbsp;<span class="number">' + price + '</span></td><td class="export-item-qty text-right">' + val.item_quantity + '</td><td class="export-item-tax text-right">' + tax_value + '</td><td class="export-item-total text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span></td></tr></tbody>';
                                $("#receiving_report_" + row._id).children('tbody').append(lineitem);
                            }
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var receivingreportexportdata = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var id = val.receiving_id;
                            var date = val.string_date;
                            var suppliername = val.supplier_name;
                            var supplierphone = val.supplier_phone;
                            var totalitem = val.total_items;
//                            receivingreportexportdata.push({ReceivingId: id, Date: date, SupplierName: name, SupplierPhone: phone, ReceivingStatus: status, NoOfItems: totalitem, TotalAmount: price});
                            $(data[key].items).each(function (key, value) {
                                var name = value.item_name;
                                var sku = value.barcode_id;
                                var quantity = value.item_quantity;
                                var discount_amount = value.item_discount;
                                var discount_percentage = value.item_discount_percentage;
                                var tax = value.tax;
                                var price;
                                var tax_value = 0;
                                if (value.tax_type === 'exclusive') {
                                    price = value.item_price;
                                } else {
                                    price = value.item_price / ((tax / 100) + 1);
                                }
                                if (value.tax > 0) {
                                    tax_value = tax + '% (' + ((price * quantity) * (tax / 100)).toFixed(2) + ')';
                                }
                                var total = value.total_amount;
                                receivingreportexportdata.push({ReceivingId: id, Date: date, SupplierName: suppliername, SupplierPhone: supplierphone, NoOfItems: val.items.length, ItemName: name, SKU: sku, ItemPrice: price.toFixed(2), ItemQty: quantity, ItemDiscountAmount: discount_amount, ItemDiscountPercentage: discount_percentage, ItemTax: tax_value, ItemTotal: total});
                            });
                        });

                        PosnicPro.JSONToCSVConvertor(receivingreportexportdata, 'receiving-reports', true);
                        PosnicPro.receivingreport.receivingreportTable();
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
            $(".receiving_branch_value").focus();
        }
    },
    receivingreportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.receivingreport.receivingreportTable(type);
    },
    receivingTableTabClick: function () {
        $('#change_receiving_view').data('id', 'tableView');
        PosnicPro.receivingreport.receivingreportTable();
    }
};

PosnicPro.receivinggraphicalreport = {
    showDataTablePage: function () {
        var loader = $(".loader-receiving-graph-report");
        loader.find(".loadingSpinner:first").remove();
        $('.page_loader,#osk-container,.graphical-report-receiving').hide();
        $('.page-title-box,#receivingreport_new').show();
        $('#receiving_graph_nodata').hide();
        $('#v-pills-report-tab').addClass('active');
        $('#v-pills-report').addClass('show active');
    },
    showGraphReport: function (data) {

        // If there is no data, hide charts and show "No Records" state
        var hasData = Array.isArray(data) && data.length > 0;
        if (!hasData) {
            var dateRange = $('.view_receiving_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title') ||
                $('.view_receiving_report_daterange span').text();
            var noRecordText = dateRange ? 'No Records on ' + dateRange : 'No Records';
            $('#receiving_graph_nodata .m-t-10').html('<p>' + noRecordText + '</p>');
            $('.graphical-report-receiving').hide();
            $('#receiving_graph_nodata').show();
            return;
        }

        $('.graphical-report-receiving').show();
        $('#receiving_graph_nodata').hide();

        am4core.ready(function () {

// Themes begin
            am4core.useTheme(am4themes_animated);
// Themes end

            var chart = PosnicPro.chart.create("receiving-received-report-apex-circle-chart", am4charts.XYChart);
            if (!chart) return; // the panel is not on the page

            chart.data = data;
            chart.logo.disabled = true;

// Create axes
            var dateAxis = chart.xAxes.push(new am4charts.DateAxis());
            dateAxis.renderer.minGridDistance = 60;

            var valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

// Create series
            var series = chart.series.push(new am4charts.LineSeries());
            series.name = "Received";
            series.dataFields.valueY = "receiving_payment_received";
            series.dataFields.dateX = "date_received";
            series.tooltipText = "{valueY.value}";
            series.fill = am4core.color("#28a745");
            series.stroke = am4core.color("#28a745");

            series.tooltip.pointerOrientation = "vertical";

            chart.cursor = new am4charts.XYCursor();
            chart.cursor.snapToSeries = series;
            chart.cursor.xAxis = dateAxis;

            chart.scrollbarX = new am4core.Scrollbar();

            let topContainer = chart.chartContainer.createChild(am4core.Container);
            topContainer.layout = "absolute";
            topContainer.toBack();
            topContainer.paddingBottom = 15;
            topContainer.width = am4core.percent(100);

            let axisTitle = topContainer.createChild(am4core.Label);
            axisTitle.text = "Value";
            axisTitle.fontWeight = 600;
            axisTitle.align = "left";
            axisTitle.paddingLeft = 10;

            let dateTitle = topContainer.createChild(am4core.Label);
            dateTitle.text = "RECEIVED - PURCHASE";
            dateTitle.fontWeight = 600;
            dateTitle.align = "right";

        }); // end am4core.ready()

        am4core.ready(function () {

// Themes begin
            am4core.useTheme(am4themes_animated);
// Themes end

            var chart = PosnicPro.chart.create("receiving-open-report-apex-circle-chart", am4charts.XYChart);
            if (!chart) return; // the panel is not on the page

            chart.data = data;
            chart.logo.disabled = true;

// Create axes
            var dateAxis = chart.xAxes.push(new am4charts.DateAxis());
            dateAxis.renderer.minGridDistance = 60;

            var valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

// Create series
            var series = chart.series.push(new am4charts.LineSeries());
            series.name = "Open";
            series.dataFields.valueY = "receiving_payment_open";
            series.dataFields.dateX = "date_open";
            series.tooltipText = "{valueY.value}";
            series.fill = am4core.color("#e59165");
            series.stroke = am4core.color("#e59165");

            series.tooltip.pointerOrientation = "vertical";

            chart.cursor = new am4charts.XYCursor();
            chart.cursor.snapToSeries = series;
            chart.cursor.xAxis = dateAxis;

            chart.scrollbarX = new am4core.Scrollbar();

            let topContainer = chart.chartContainer.createChild(am4core.Container);
            topContainer.layout = "absolute";
            topContainer.toBack();
            topContainer.paddingBottom = 15;
            topContainer.width = am4core.percent(100);

            let axisTitle = topContainer.createChild(am4core.Label);
            axisTitle.text = "Value";
            axisTitle.fontWeight = 600;
            axisTitle.align = "left";
            axisTitle.paddingLeft = 10;

            let dateTitle = topContainer.createChild(am4core.Label);
            dateTitle.text = "OPEN - PURCHASE";
            dateTitle.fontWeight = 600;
            dateTitle.align = "right";

        }); // end am4core.ready()

    },

    graphicalReportReceiving: function () {
        var graphBranchId = $(".receiving_branch_value").val().toString();
        if (graphBranchId !== '') {
            var loader = $(".loader-receiving-graph-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_receiving_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".receiving_branch_value").val()
            };
            var params = {
                url: 'receivings/receivingsGraphicalReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data || [];
                    PosnicPro.receivinggraphicalreport.showGraphReport(data);
                } else {
                    // On error, also show the no-data state with filter-based text
                    var dateRange = $('.view_receiving_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title') ||
                        $('.view_receiving_report_daterange span').text();
                    var noRecordText = dateRange ? 'No Records on ' + dateRange : 'No Records';
                    $('#receiving_graph_nodata .m-t-10').html('<p>' + noRecordText + '</p>');
                    $('.graphical-report-receiving').hide();
                    $('#receiving_graph_nodata').show();
                    PosnicPro.alert(response.type, response.message);
                }

            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                var dateRange = $('.view_receiving_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title') ||
                    $('.view_receiving_report_daterange span').text();
                var noRecordText = dateRange ? 'No Records on ' + dateRange : 'No Records';
                $('#receiving_graph_nodata .m-t-10').html('<p>' + noRecordText + '</p>');
                $('.graphical-report-receiving').hide();
                $('#receiving_graph_nodata').show();
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".receiving_branch_value").focus();
        }
    },
    receivingGraphTabClick: function () {
        $('#change_receiving_view').data('id', 'graphView');
        /* The fetch renders when it returns; the bare call that used to follow
           put a second, dataless chart on the same div. */
        PosnicPro.receivinggraphicalreport.graphicalReportReceiving();
    }

};

PosnicPro.receivingroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.receivingreport.receivingreportTable();
        } else {
            PosnicPro.receivinggraphicalreport.graphicalReportReceiving();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/receivingreport') {
        var loader = $(".loader-receiving-report,.loader-receiving-graph-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.receivingreport.receivingreportTable();
    }
});
$(document).on("click", "#view_receivingreport tbody tr td .exploder", function () {
    $(this).children("span").toggleClass("feather icon-plus-circle feather icon-minus-circle");
    $(this).closest("tr").next("tr").toggleClass("hide");

    if ($(this).closest("tr").next("tr").hasClass("hide")) {
        $(this).closest("tr").next("tr").children("td").slideUp(100);
    } else {
        $(this).closest("tr").next("tr").children("td").slideDown(100);
    }
});
