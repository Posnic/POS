PosnicPro.supplierreport = {
    showModuleProductDetails: function (id) {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-supplierreport-details").addClass("sidebarview");
        PosnicPro.record_id = id;
        PosnicPro.supplierproductdetails.supplierproductdetailsTable();
    },
    showDataTablePage: function () {
        var loader = $(".loader-supplier-report,.loader-supplier-graph-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#supplierreport_new').show();
        $(".graphical-supplier-hide").removeAttr('disabled');
        $('#v-pills-report-tab,#viewsupplierreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#supplier-tab-line').hasClass('active')) {
            PosnicPro.supplierreport.supplierTableTabClick();
        } else if ($('a#supplier-product-tab-line').hasClass('active')) {
            PosnicPro.supplierproductreport.supplierProductTabClick();
        } else if ($('a#supplier-sale-tab-line').hasClass('active')) {
            PosnicPro.suppliersalereport.supplierSaleTabClick();
        } else {
            PosnicPro.suppliergraphicalreport.supplierGraphTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#supplier-line, #supplier-product-line,#supplier-sale-line, #supplier-graph-line').css('filter', 'blur(2px)');
            $('#supplierreport_exportbtn,#supplierproductreport_exportbtn,#suppliersalereport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#supplier_upgrade').show();
        } else {
            $('#supplier-line, #supplier-product-line,#supplier-sale-line, #supplier-graph-line').css('filter', 'none');
            $('#supplierreport_exportbtn,#supplierproductreport_exportbtn,#suppliersalereport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#supplier_upgrade').hide();
        }
    },
    supplierreportTable: function (type) {
        var branchId = $(".supplier_branch_value").val().toString();
        PosnicPro.appendReportTableBody('supplierreport');
        if (branchId !== '') {
            var loader = $(".loader-supplier-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_supplier_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_supplierreport');
            if (type === 'supplierreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_supplierreport_per_page  option:selected').text());
            }
            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".supplier_branch_value").val()
            };
            let supplier_id = ($(".suppliers_input_id").val() !== '') ? $(".suppliers_input_id").val() : '';
            var field_input = {
                field_input: supplier_id
            };
            if ($(".suppliers_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'receivings/supplierReceivingReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#supplierreport_exportbtn').removeAttr('disabled') : $('#supplierreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'supplierreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_supplierreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportsupplier_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportsupplier_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportsupplier_img_hide,.reportsupplier_norecord').show();

                        } else {
                            $('.reportsupplier_norecord').empty();
                            $('#reportsupplier_img_hide,.reportsupplier_norecord').hide();
                            $('.reportsupplier_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_supplierreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_supplierreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.supplier_name + '</td> <td>' + row.supplier_phone + '</td> <td class="text-center">' + row.receiving_count + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.receiving_avg + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.receiving_payment + '</span></td></tr>';
                            $('#view_supplierreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var supplierreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.supplier_name;
                            var phone = val.supplier_phone;
                            var totalitems = val.receiving_count;
                            var total = val.receiving_payment;
                            var average = val.receiving_avg;
                            supplierreport.push({SupplierName: name, SupplierPhone: phone, NoofSale: totalitems, AvgSale: average, TotalAmount: total});
                        });
                        PosnicPro.JSONToCSVConvertor(supplierreport, 'supplier-reports', true);
                        PosnicPro.supplierreport.supplierreportTable();
                        PosnicPro.suppliersalereport.suppliersalereportTable();
                        PosnicPro.supplierproductreport.supplierproductreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".supplier_branch_value").focus();
        }
    },
    supplierreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.supplierreport.supplierreportTable(type);
    },
    supplierTableTabClick: function () {
        $('#change_supplier_view').data('id', 'tableView');
        $(".graphical-supplier-hide").removeAttr('disabled');
        PosnicPro.supplierreport.supplierreportTable();
    }
};

PosnicPro.supplierproductreport = {

    supplierproductreportTable: function (type) {
        var branchId = $(".supplier_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-supplier-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_supplier_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_supplierproductreport');
            if (type === 'supplierproductreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_supplierproductreport_per_page  option:selected').text());
            }

            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".supplier_branch_value").val()
            };
            let supplier_id = ($(".suppliers_input_id").val() !== '') ? $(".suppliers_input_id").val() : '';
            var field_input = {
                field_input: supplier_id
            };
            if ($(".suppliers_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'items/supplierItemsReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#supplierproductreport_exportbtn').removeAttr('disabled') : $('#supplierproductreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'supplierproductreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_supplierproductreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportsupplierpro_header').hide();
                            $('#reportbaseproduct_img_hide,.reportsupplier_norecord').show();
                        } else {
                            $('#reportbaseproduct_img_hide').hide();
                            $('.reportsupplierpro_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_supplierproductreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_supplierproductreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td><a href="#/supplierreport/' + row.supplier_id + '/product" ><i data-toggle="tooltip" class="table_model_item">' + row.supplier_name + '</i></a></td> <td class="text-center">' + row.item_count + '</td>  <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td></tr>';
                            $('#view_supplierproductreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var supplierproductreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var supplier_name = val.supplier_name;
                            var noofproduct = val.item_count;
                            var supplier_name = val.supplier_name;
                            var total = val.selling_price;
                            supplierproductreport.push({SupplierName: supplier_name, NoofProduct: noofproduct, NoofSupplier: supplier_name, TotalSeillingAmount: total});
                        });
                        PosnicPro.JSONToCSVConvertor(supplierproductreport, 'supplier-product-reports', true);
                        PosnicPro.supplierproductreport.supplierproductreportTable();
                        PosnicPro.supplierreport.supplierreportTable();
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
            $(".supplier_branch_value").focus();
        }
    },
    supplierproductreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.supplierproductreport.supplierproductreportTable(type);
    },
    supplierProductTabClick: function () {
        $('#change_supplier_view').data('id', 'productView');
        $(".graphical-supplier-hide").removeAttr('disabled');
        PosnicPro.supplierproductreport.supplierproductreportTable();
    }
};

PosnicPro.suppliersalereport = {

    suppliersalereportTable: function (type) {
        var branchId = $(".supplier_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-supplier-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_supplier_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_suppliersalereport');
            if (type === 'suppliersalereportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_suppliersalereport_per_page  option:selected').text());
            }

            var dataValue = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".supplier_branch_value").val()
            };
            let supplier_id = ($(".suppliers_input_id").val() !== '') ? $(".suppliers_input_id").val() : '';
            var field_input = {
                field_input: supplier_id
            };
            if ($(".suppliers_input_id").val() !== '') {
                dataValue = Object.assign(dataValue, field_input);
            }
            var params = {
                url: 'sales/supplierSalesReportTable',
                data: dataValue
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#suppliersalereport_exportbtn').removeAttr('disabled') : $('#suppliersalereport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'suppliersalereportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_suppliersalereport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportsuppliersale_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportbasesale_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportbasesale_img_hide,.reportbasesale_norecord').show();

                        } else {
                            $('.reportbasesale_norecord').empty();
                            $('#reportbasesale_img_hide,.reportbasesale_norecord').hide();
                            $('.reportsuppliersale_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_suppliersalereport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_suppliersalereport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="text-center">' + row.item_quantity + '</td> <td class="text-center">' + row.sales_count + '</td> <td class="text-right">' + currency + '<span>' + row.sales_profit.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_avg + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_suppliersalereport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var suppliersalereport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var supplier_name = val.name;
                            var noofsale = val.sales_count;
                            var noofitemsold = val.item_quantity;
                            var profit = val.sales_profit;
                            var avg = val.sales_avg;
                            var total = val.total_amount;
                            suppliersalereport.push({SupplierName: supplier_name, NoofItemSold: noofitemsold, NoofSale: noofsale, Profit: profit, AvgSale: avg, TotalAmount: total});
                        });
                        PosnicPro.JSONToCSVConvertor(suppliersalereport, 'supplier-sale-reports', true);
                        PosnicPro.suppliersalereport.suppliersalereportTable();
                        PosnicPro.supplierproductreport.supplierproductreportTable();
                        PosnicPro.supplierreport.supplierreportTable();
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
            $(".supplier_branch_value").focus();
        }
    },
    suppliersalereportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.suppliersalereport.suppliersalereportTable(type);
    },
    supplierSaleTabClick: function () {
        $('#change_supplier_view').data('id', 'saleView');
        $(".graphical-supplier-hide").removeAttr('disabled');
        PosnicPro.suppliersalereport.suppliersalereportTable();
    }
};

PosnicPro.suppliergraphicalreport = {
    showGraphReport: function (categorydata) {

        /* An empty chart draws as a grey rectangle that reads as a failure. */
        if (!categorydata || !categorydata.length) {
            PosnicPro.chart.empty('supplier-report-apex-circle-chart',
                'No supplier purchases in the selected period');
            return;
        }

        am4core.ready(function () {

            // Themes begin
            am4core.useTheme(am4themes_animated);
            // Themes end
            if (!categorydata || Object.keys(categorydata).length === 0) {
                $("#supplier-report-apex-circle-chart").text("<p style='text-align: center;>No data available</p>");
                return;
            }

            var chart = PosnicPro.chart.create("supplier-report-apex-circle-chart", am4charts.XYChart);
            if (!chart) return; // the panel is not on the page
            chart.logo.disabled = true;
            // some extra padding for range labels
            chart.paddingBottom = 50;

            chart.cursor = new am4charts.XYCursor();
            chart.scrollbarX = new am4core.Scrollbar();

            // will use this to store colors of the same items
            var colors = {};

            var categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
            categoryAxis.dataFields.category = "category";
            categoryAxis.renderer.minGridDistance = 60;
            categoryAxis.renderer.grid.template.location = 0;
            categoryAxis.dataItems.template.text = "{realName}";
            categoryAxis.adapter.add("tooltipText", function (tooltipText, target) {
                return categoryAxis.tooltipDataItem.dataContext.realName;
            })

            var valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
            valueAxis.tooltip.disabled = true;
            valueAxis.min = 0;

            // single column series for all data
            var columnSeries = chart.series.push(new am4charts.ColumnSeries());
            columnSeries.columns.template.width = am4core.percent(80);
            columnSeries.tooltipText = "{provider}: {realName}, {valueY}";
            columnSeries.dataFields.categoryX = "category";
            columnSeries.dataFields.valueY = "value";

            // second value axis for quantity
            var valueAxis2 = chart.yAxes.push(new am4charts.ValueAxis());
            valueAxis2.renderer.opposite = true;
            valueAxis2.syncWithAxis = valueAxis;
            valueAxis2.tooltip.disabled = true;

            // quantity line series
            var lineSeries = chart.series.push(new am4charts.LineSeries());
            lineSeries.tooltipText = "{valueY}";
            lineSeries.dataFields.categoryX = "category";
            lineSeries.dataFields.valueY = "quantity";
            lineSeries.yAxis = valueAxis2;
            lineSeries.bullets.push(new am4charts.CircleBullet());
            lineSeries.stroke = chart.colors.getIndex(13);
            lineSeries.fill = lineSeries.stroke;
            lineSeries.strokeWidth = 2;
            lineSeries.snapTooltip = true;

            // when data validated, adjust location of data item based on count
            lineSeries.events.on("datavalidated", function () {
                lineSeries.dataItems.each(function (dataItem) {
                    // if count divides by two, location is 0 (on the grid)
                    if (dataItem.dataContext.count / 2 == Math.round(dataItem.dataContext.count / 2)) {
                        dataItem.setLocation("categoryX", 0);
                    }
                    // otherwise location is 0.5 (middle)
                    else {
                        dataItem.setLocation("categoryX", 0.5);
                    }
                })
            })
            // fill adapter, here we save color value to colors object so that each time the item has the same name, the same color is used
            columnSeries.columns.template.adapter.add("fill", function (fill, target) {
                var name = target.dataItem.dataContext.realName;
                if (!colors[name]) {
                    colors[name] = chart.colors.next();
                }
                target.stroke = colors[name];
                return colors[name];
            })

            var rangeTemplate = categoryAxis.axisRanges.template;
            rangeTemplate.tick.disabled = false;
            rangeTemplate.tick.location = 0;
            rangeTemplate.tick.strokeOpacity = 0.6;
            rangeTemplate.tick.length = 60;
            rangeTemplate.grid.strokeOpacity = 0.5;
            rangeTemplate.label.tooltip = new am4core.Tooltip();
            rangeTemplate.label.tooltip.dy = -10;
            rangeTemplate.label.cloneTooltip = false;

            ///// DATA
            var chartData = [];
            var data = categorydata;
            // process data ant prepare it for the chart
            for (var providerName in data) {
                var providerData = data[providerName];

                // add data of one provider to temp array
                var tempArray = [];
                var count = 0;
                // add items
                for (var itemName in providerData) {
                    if (itemName != "quantity") {
                        count++;
                        // we generate unique category for each column (providerName + "_" + itemName) and store realName
                        tempArray.push({category: providerName + "_" + itemName, realName: itemName, value: providerData[itemName], provider: providerName})
                    }
                }
                // sort temp array
                tempArray.sort(function (a, b) {
                    if (a.value > b.value) {
                        return 1;
                    } else if (a.value < b.value) {
                        return -1
                    } else {
                        return 0;
                    }
                })

                // push to the final data
                am4core.array.each(tempArray, function (item) {
                    chartData.push(item);
                })

                // create range (the additional label at the bottom)
                var range = categoryAxis.axisRanges.create();
                range.category = tempArray[0].category;
                range.endCategory = tempArray[tempArray.length - 1].category;
                range.label.text = tempArray[0].provider;
                range.label.dy = 30;
                range.label.truncate = true;
                range.label.fontWeight = "bold";
                range.label.tooltipText = tempArray[0].provider;

                range.label.adapter.add("maxWidth", function (maxWidth, target) {
                    var range = target.dataItem;
                    var startPosition = categoryAxis.categoryToPosition(range.category, 0);
                    var endPosition = categoryAxis.categoryToPosition(range.endCategory, 1);
                    var startX = categoryAxis.positionToCoordinate(startPosition);
                    var endX = categoryAxis.positionToCoordinate(endPosition);
                    return endX - startX;
                })
            }

            chart.data = chartData;
            // last tick
            var range = categoryAxis.axisRanges.create();
            range.category = chart.data[chart.data.length - 1].category;
            range.label.disabled = true;
            range.tick.location = 1;
            range.grid.location = 1;


        }); // end am4core.ready()

    },
    graphicalReportSupplier: function () {
        var graphBranchId = $(".supplier_branch_value").val().toString();
        if (graphBranchId !== '') {
            var loader = $(".loader-supplier-graph-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_supplier_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".supplier_branch_value").val()
            };
            var params = {
                url: 'suppliers/supplierGraphicalReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data;
                    if (typeof data !== 'undefined' && data !== '' && Object.keys(data).length > 0) {
                        PosnicPro.suppliergraphicalreport.showGraphReport(data);
                    } else {
                        $('#supplier-report-apex-circle-chart').html('<div class="col-sm-6 col-md-12 col-lg-12"><img src="static/images/general/nodata.svg" class="img-fluid" style="opacity: 0.6;width: 100%;height: 250px;" alt=""><div class="text-center text-dark"><p>No Records on undefined</p></div></div>');
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".supplier_branch_value").focus();
        }
    },
    supplierGraphTabClick: function () {
        $('#change_supplier_view').data('id', 'graphView');
        $(".graphical-supplier-hide").attr('disabled', 'disabled');
        PosnicPro.suppliergraphicalreport.graphicalReportSupplier();
    }
};

PosnicPro.supplierproductdetails = {

    supplierproductdetailsTable: function (type) {

        PosnicPro.appendReportTableBody('productdetails');
        var table = $('#view_supplierproductdetails');
        var branch = $(".supplier_branch_value").val();
        var daterange = $(".view_supplier_report_daterange").val();
        var fields = daterange.split('-');
        if (type === 'supplierproductreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = table.data('per_page');
        }
        let supplier_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            supplier_id: supplier_id[1],
            branch: branch,
            starting_date: fields[0],
            ending_date: fields[1]
        };
        var params = {
            url: 'items/supplierProductDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {

                if (type !== 'supplierproductreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_supplierproductdetails_total,.product_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_supplierproductdetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_supplierproductdetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');

                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        var row = response.data.table.data.list[i];
                        var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                        // Prefer backend-provided string_date; if missing, fall back to
                        // other date fields. Do NOT pass an empty value to convertDate,
                        // because moment("") will display the current time instead of
                        // the actual transaction date.
                        var rawDate = row.string_date || row.updated_date || row.created_date || row.date || '';
                        var updateDate = rawDate ? PosnicPro.convertDate(rawDate) : '';

                        var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.selling_price + '</span></td></tr>';
                        $('#view_supplierproductdetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }

                    $('.supplier_product_details_selling').html(response.data.total.total);
                    $('.supplier_product_details_count').html(response.data.total.count);
                    $('.supplier_product_view_name').html(response.data.total.name);

                } else {
                    var supplierreportexportdata = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        var rawDate = val.string_date || val.updated_date || val.created_date || val.date || '';
                        var date = rawDate ? PosnicPro.convertDate(rawDate) : '';
                        var name = val.name;
                        var total = val.selling_price;
                        supplierreportexportdata.push({ProductName: name, Date: date, Amount: total});

                    });
                    PosnicPro.JSONToCSVConvertor(supplierreportexportdata, response.data.total.name + '-supplier-based-product-reports', true);
                    PosnicPro.supplierproductdetails.supplierproductdetailsTable();
                }

            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewReportSupplierProductExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.supplierproductdetails.supplierproductdetailsTable(type);
    }
};

PosnicPro.supplierroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.supplierreport.supplierreportTable();
        } else if (type === 'productView') {
            PosnicPro.supplierproductreport.supplierproductreportTable();
        } else if (type === 'saleView') {
            PosnicPro.suppliersalereport.suppliersalereportTable();
        } else {
            PosnicPro.suppliergraphicalreport.graphicalReportSupplier();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/supplierreport') {
        var loader = $(".loader-supplier-report,.loader-supplier-graph-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.supplierreport.supplierreportTable();
    }
});
