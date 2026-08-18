PosnicPro.itemreport = {
    showDataTablePage: function () {
        var loader = $(".loader-item-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#itemreport_new,.item-report-item').show();
        $('#v-pills-report-tab,#viewitemreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#item-tab-line').hasClass('active')) {
            PosnicPro.itemreport.itemTableTabClick();
        } else if ($('a#item-expiry-line').hasClass('active')) {
            PosnicPro.itemexpiry.itemExpiryTabClick();
        } else if ($('a#item-stock-line').hasClass('active')) {
            PosnicPro.itemstock.itemstockTable();
        } else {
            PosnicPro.itemgraphicalreport.itemGraphTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#item-line, #item-graph-line, #item-expiry-date, #item-stock-date').css('filter', 'blur(2px)');
            $('#itemreport_exportbtn, #itemexpiry_exportbtn, #itemstock_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#items_upgrade').show();
        } else {
            $('#item-line, #item-graph-line, #item-expiry-date, #item-stock-date').css('filter', 'none');
            $('#itemreport_exportbtn,#itemexpiry_exportbtn, #itemstock_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#items_upgrade').hide();
        }
    },
    itemreportTable: function (type) {
        var branchId = $(".item_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-item-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('itemreport');
            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_itemreport');

            if (type === 'itemreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_itemreport_per_page  option:selected').text());
            }

            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".item_branch_value").val(),
                // Family view is a table-only READING rollup; the export
                // branch never sends it - exports stay per-item, always.
                group_by_family: (type !== 'itemreportexport' && $('#itemreport_group_family').is(':checked'))
                    ? 'true' : 'false'
            };
            var params = {
                url: 'sales/itemSalesReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#itemreport_exportbtn').removeAttr('disabled') : $('#itemreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'itemreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_itemreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportitem_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportitem_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportitem_img_hide,.reportitem_norecord').show();

                        } else {
                            $('.reportitem_norecord').empty();
                            $('#reportitem_img_hide,.reportitem_norecord').hide();
                            $('.reportitem_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_itemreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_itemreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var familyNote = (row.family_members > 1)
                                ? ' <small class="text-muted">(' + row.family_members + ' variants)</small>' : '';
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + familyNote + '</td> <td class="text-center">' + row.item_quantity + '</td> <td class="text-center">' + row.sales_count + '</td> <td class="text-right">' + currency + '&nbsp;<span>' + row.sales_profit.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_avg + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_itemreport').children('tbody').append(trow);
                        }
                        $('span.number').number(true, 2);
                    } else {
                        var itemreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.name;
                            var noofsold = val.item_quantity;
                            var noofsale = val.sales_count;
                            var profit = val.sales_profit;
                            var avgsale = val.sales_avg;
                            var total = val.total_amount;
                            itemreport.push({Itemname: name, NoofSold: noofsold, NoofSale: noofsale, Profit: profit, AvgSale: avgsale, Total: total});
                        });
                        PosnicPro.JSONToCSVConvertor(itemreport, 'item-reports', true);
                        PosnicPro.itemreport.itemreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemreportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemreport.itemreportTable(type);
    },
    itemTableTabClick: function () {
        $('#change_item_view').data('id', 'tableView');
        PosnicPro.itemreport.itemreportTable();
    }
};

PosnicPro.itemexpiry = {
    expiredItemsReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemexpiry.itemexpiryTable(type);
    },
    itemexpiryTable: function (type) {
        var branchId = $(".item_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-item-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('itemexpiry'); // Assuming you have a function to append table body

            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_itemexpiry');

            if (type === 'itemexpiryexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_itemexpiry_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: branchId
            };

            var params = {
                url: 'sales/itemExpiryReportTable',
                data: data
            };

            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#itemexpiry_exportbtn').removeAttr('disabled') : $('#itemexpiry_exportbtn').attr('disabled', 'disabled');

                    if (type !== 'itemexpiryexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_itemexpiry_total').text(response.data.total);

                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            // No expired products: hide both the static header/pagination
                            // and the dynamic expiry header table so only the "No Records"
                            // message + illustration are visible.
                            $('.expiryreportitem_header').hide();
                            $('.view_itemexpiry_header').hide();
                            $('#view_expiryitemreport').hide();

                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.expiryreportitem_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#expiryreportitem_img_hide,.expiryreportitem_norecord').show();
                        } else {
                            // Data exists: show both headers/tables and hide the empty state.
                            $('.expiryreportitem_norecord').empty();
                            $('#expiryreportitem_img_hide,.expiryreportitem_norecord').hide();
                            $('.expiryreportitem_header').show();
                            $('.view_itemexpiry_header').show();
                            $('#view_expiryitemreport').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_itemexpiry_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_itemexpiry_page_perpage_total').text(page_totals + response.data.list.length);

                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.item_name + '</td> <td class="text-center">' + row.available_quantity + '</td> <td class="text-center">' + row.category_name + '</td> <td class="text-right">' + row.expiry_date + '</td></tr>';
                            $('#view_itemexpiry').children('tbody').append(trow);
                        }
                    } else {
                        PosnicPro.JSONToCSVConvertor(response.data.list, 'item-expiry-reports', true);
                        PosnicPro.itemexpiry.itemexpiryTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemExpiryTabClick: function () {
        $('#change_item_view').data('id', 'expiryView');
        PosnicPro.itemexpiry.itemexpiryTable();
    }
};

PosnicPro.itemstock = {
    stockItemsReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemstock.itemstockTable(type);
    },
    itemstockTable: function (type) {
        var branchId = $(".item_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-item-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('itemstock'); // Assuming you have a function to append table body

            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_itemstock');

            if (type === 'itemstockexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_itemstock_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: branchId
            };

            var params = {
                url: 'items/itemStockReportTable',
                data: data
            };

            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#itemstock_exportbtn').removeAttr('disabled') : $('#itemstock_exportbtn').attr('disabled', 'disabled');

                    if (type !== 'itemstockexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_itemstock_total').text(response.data.total);

                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.stockreportitem_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.stockreportitem_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                            $('#stockreportitem_img_hide,.stockreportitem_norecord').show();
                        } else {
                            $('.stockreportitem_norecord').empty();
                            $('#stockreportitem_img_hide,.stockreportitem_norecord').hide();
                            $('.stockreportitem_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_itemstock_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_itemstock_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="text-center">' + row.available_quantity + '</td> <td class="text-right">' + currency + '&nbsp;' + row.company_price.toFixed(2) + '</td> <td class="text-right">' + currency + '&nbsp;' + row.company_total.toFixed(2) + '</td><td class="text-right">' + currency + '&nbsp;' + row.selling_price.toFixed(2) + '</td><td class="text-right">' + currency + '&nbsp;' + row.selling_total.toFixed(2) + '</td></tr>';
                            $('#view_itemstock').children('tbody').append(trow);
                        }
                        $('.item_stock_company').text(response.data.company_total.toFixed(2));
                        $('.item_stock_selling').text(response.data.selling_total.toFixed(2));
                    } else {
                        PosnicPro.JSONToCSVConvertor(response.data.list, 'item-stock-reports', true);
                        PosnicPro.itemstock.itemstockTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemStockTabClick: function () {
        $('#change_item_view').data('id', 'stockView');
        PosnicPro.itemstock.itemstockTable();
    }
};

PosnicPro.itemgraphicalreport = {
    CHART_ID: "report-items-apex-circle-chart",

    showGraphReport: function (data) {

        /* No sales in the range, or a caller with nothing to draw yet. Either
           way there is no chart to make - see PosnicPro.chart. */
        if (!data || !data.length) {
            PosnicPro.chart.empty(PosnicPro.itemgraphicalreport.CHART_ID,
                'No sales in the selected period');
            return;
        }

        am4core.ready(function () {

// Themes begin
            am4core.useTheme(am4themes_animated);
// Themes end

// Create chart instance
            var chart = PosnicPro.chart.create(PosnicPro.itemgraphicalreport.CHART_ID, am4charts.XYChart);
            if (!chart) return; // the tab is not on the page
            chart.responsive.enabled = true;


            chart.data = data;
            chart.logo.disabled = true;
// Create axes
            var categoryAxis = chart.yAxes.push(new am4charts.CategoryAxis());
            categoryAxis.dataFields.category = "name";
            categoryAxis.renderer.grid.template.location = 0;
            categoryAxis.renderer.minGridDistance = 10;
            categoryAxis.interpolationDuration = 2000;

            var valueAxis = chart.xAxes.push(new am4charts.ValueAxis());
            valueAxis.tooltip.disabled = true;

// Create series
            function createSeries(field, name) {
                var series = chart.series.push(new am4charts.ColumnSeries());
                series.dataFields.valueX = "amount";
                series.dataFields.categoryY = "name";
                series.columns.template.tooltipText = "[bold]{amount}[/]";
                series.columns.template.cursorOverStyle = am4core.MouseCursorStyle.pointer;

                var hs = series.columns.template.states.create("hover");
                hs.properties.fillOpacity = 0.7;

                var columnTemplate = series.columns.template;
                columnTemplate.maxX = 0;
                columnTemplate.draggable = true;

                columnTemplate.events.on("dragstart", function (ev) {
                    var dataItem = ev.target.dataItem;

                    var axislabelItem = categoryAxis.dataItemsByCategory.getKey(
                            dataItem.categoryY
                            )._label;
                    axislabelItem.isMeasured = false;
                    axislabelItem.minX = axislabelItem.pixelX;
                    axislabelItem.maxX = axislabelItem.pixelX;

                    axislabelItem.dragStart(ev.target.interactions.downPointers.getIndex(0));
                    axislabelItem.dragStart(ev.pointer);
                });
                columnTemplate.events.on("dragstop", function (ev) {
                    var dataItem = ev.target.dataItem;
                    var axislabelItem = categoryAxis.dataItemsByCategory.getKey(
                            dataItem.categoryY
                            )._label;
                    axislabelItem.dragStop();
                    handleDragStop(ev);
                });
            }
            createSeries("amount", "Amount");

            function handleDragStop(ev) {
                data = [];
                chart.series.each(function (series) {
                    if (series instanceof am4charts.ColumnSeries) {
                        series.dataItems.values.sort(compare);

                        var indexes = {};
                        series.dataItems.each(function (seriesItem, index) {
                            indexes[seriesItem.categoryY] = index;
                        });

                        categoryAxis.dataItems.values.sort(function (a, b) {
                            var ai = indexes[a.category];
                            var bi = indexes[b.category];
                            if (ai == bi) {
                                return 0;
                            } else if (ai < bi) {
                                return -1;
                            } else {
                                return 1;
                            }
                        });

                        var i = 0;
                        categoryAxis.dataItems.each(function (dataItem) {
                            dataItem._index = i;
                            i++;
                        });

                        categoryAxis.validateDataItems();
                        series.validateDataItems();
                    }
                });
            }

            function compare(a, b) {
                if (a.column.pixelY < b.column.pixelY) {
                    return 1;
                }
                if (a.column.pixelY > b.column.pixelY) {
                    return -1;
                }
                return 0;
            }

            // Enable chart cursor
            chart.cursor = new am4charts.XYCursor();
            chart.cursor.behavior = "panZoom";

            // Add scrollbar
            chart.scrollbarX = new am4core.Scrollbar();
            //  chart.scrollbarY = new am4core.Scrollbar();

        }); // end am4core.ready()

    },
    graphicalReportItem: function () {
        var grapgBranchId = $(".item_branch_value").val().toString();
        if (grapgBranchId !== '') {
            var loader = $(".loader-item-graph-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".item_branch_value").val()
            };
            var params = {
                url: 'sales/itemGraphicalReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    var data = response.data;
                    PosnicPro.itemgraphicalreport.showGraphReport(data);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemGraphTabClick: function () {
        $('#change_item_view').data('id', 'graphView');
        /* graphicalReportItem() fetches and then renders. The bare
           showGraphReport() that used to follow rendered a second chart, with
           no data, onto the same div - which is what broke this tab. */
        PosnicPro.itemgraphicalreport.graphicalReportItem();
    }
};

PosnicPro.itemroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.itemreport.itemreportTable();
        } else if (type === 'expiryView') {
            PosnicPro.itemexpiry.itemexpiryTable();
        } else if (type === 'stockView') {
            PosnicPro.itemstock.itemstockTable();
        } else {
            PosnicPro.itemgraphicalreport.graphicalReportItem();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/itemreport') {
        var loader = $(".loader-item-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.itemreport.itemreportTable();
    }
});

