PosnicPro.kotreport = {

    showDataTablePage: function () {

        if (PosnicPro.dashboard && typeof PosnicPro.dashboard.datePicker === 'function') {

            PosnicPro.dashboard.datePicker();

        }

        // Set KOT Reports default date range to "Today"

        var startToday = moment().startOf('day');

        var endToday = moment().endOf('day');

        $('.view_kot_report_daterange span').html('<span>Today</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="top" data-original-title="' + startToday.format('YYYY/MM/DD h:mm A') + ' - ' + endToday.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');

        $('.view_kot_report_daterange').val(startToday.format('YYYY/MM/DD h:mm A') + ' - ' + endToday.format('YYYY/MM/DD h:mm A'));

        PosnicPro.HideSideBarModal();

        $(".vertical-layout").removeClass("toggle-menu");

        $(".vertical-menu li a").removeClass("active");

        $('.dropdown-item').removeClass('active');

        $('.page_loader,#osk-container').hide();

        $('.page-title-box,#kotreport_new').show();

        $('#v-pills-report-tab,#viewkotreport_page').addClass('active');

        $('#v-pills-report').addClass('show active');

        $('.hide_date_filetr,.hide_value_filetr').hide();





        // When navigating to KOT Reports from the sidebar, immediately

        // trigger the same loader-based data load behaviour as other

        // reports (e.g. Sale Reports). This runs the common KOT filter

        // apply logic, which shows the loading spinner inside the

        // KOT Itemwise and Discount report containers while data is

        // fetched.

        if (PosnicPro.kotitemreport && typeof PosnicPro.kotitemreport.applyFilter === 'function') {

            var table = $('#view_kotitemreport');

            table.data('current_page', 1);



            var attempts = 0;

            var maxAttempts = 20;

            var delayMs = 150;



            function ensureKotBranchAndLoad() {

                var branchVal = $('.kot_branch_value').val() || [];

                var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

                if ((branchVal.length > 0 && branchVal[0] !== '') || fallbackBranch) {

                    // As soon as branch is available, start loading the
                    // Tablewise tables list so the table filter options
                    // are fetched in the background when KOT Reports opens.
                    if (PosnicPro.kotitemreport && typeof PosnicPro.kotitemreport.loadTablewiseTables === 'function') {
                        PosnicPro.kotitemreport.loadTablewiseTables();
                    }

                    // Load data for the currently active tab

                    // Check if Sales Summary tab is active (it's the default active tab)

                    if ($('#kot-sales-summary-tab').hasClass('active') || $('#kot-sales-summary').hasClass('show active')) {

                        // If Sales Summary tab is active, load its data automatically

                        PosnicPro.kotitemreport.salesSummaryTable();

                    } else if ($('#kot-itemwise-tab').hasClass('active')) {

                        // If Itemwise tab is active, load itemwise report data

                        PosnicPro.kotitemreport.applyFilter();

                    } else if ($('#kot-cancellation-tab').hasClass('active')) {

                        // If Cancellation tab is active, load cancellation data

                        PosnicPro.kotitemreport.cancellationSummaryTable();

                    } else if ($('#kot-tablewise-tab').hasClass('active')) {

                        // If Tablewise tab is active, run the tablewise filter.
                        // The table list is already loading in the background.

                        PosnicPro.kotitemreport.applyTablewiseReportFilter();

                    } else {

                        // Default: Sales Summary is the first tab, so load it

                        PosnicPro.kotitemreport.salesSummaryTable();

                    }

                    return;

                }

                if (attempts < maxAttempts) {

                    attempts += 1;

                    setTimeout(ensureKotBranchAndLoad, delayMs);

                }

            }



            ensureKotBranchAndLoad();

        }



    }

};



$(document).ready(function () {

    var hash = window.location.hash.slice(1);

    if (hash === '/kotreport') {

        PosnicPro.kotreport.showDataTablePage();

    }

});



// Alias object for Sales Summary pagination routing

PosnicPro.kotsalessummary = {

    kotsalessummaryTable: function () {

        PosnicPro.kotitemreport.salesSummaryTable();

    }

};



// Alias object for Cancellation Report pagination routing

PosnicPro.kotcancellation = {

    kotcancellationTable: function () {

        PosnicPro.kotitemreport.cancellationSummaryTable();

    }

};



PosnicPro.kotitemreport = {

    kotitemreportTable: function (type) {

        var selectedBranches = $(".kot_branch_value").val() || [];

        var branchIdStr = selectedBranches.toString();

        if (!branchIdStr) {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                selectedBranches = [fallbackBranch];

                branchIdStr = fallbackBranch;

            }

        }

        if (branchIdStr !== '') {

            var loader = $(".loader-kot-itemwise-report");

            loader.find(".loadingSpinner:first").remove();

            $("<div class='loadingSpinner'></div>").appendTo(loader);



            var daterange = $(".view_kot_report_daterange").val();

            var fields = (daterange || '').split('-');



            var table = $('#view_kotitemreport');



            var current_page, per_page;

            if (type === 'kotitemreportexport') {

                per_page = table.data('total');

                current_page = 1;

            } else {

                current_page = table.data('current_page') || 1;

                per_page = parseInt($('#view_kotitemreport_per_page option:selected').text());

            }



            var data = {

                page: current_page,

                limit: per_page,

                starting_date: (fields[0] || '').trim(),

                ending_date: (fields[1] || '').trim(),

                branch: selectedBranches

            };



            var params = { url: 'sales/itemSalesReportTable', data: data };



            PosnicPro.get(params, function (response) {

                loader.find(".loadingSpinner:first").remove();



                if (response.type === 'success') {

                    table.data('total', response.data.total);

                    table.data('total_pages', response.data.total_pages);

                    table.data('current_page', response.data.current_page);

                    table.data('per_page', response.data.per_page);



                    PosnicPro.paging(response.data.total_pages, response.data.current_page);



                    table.children('tbody').text('');

                    $('#view_kotitemreport_total').text(response.data.total);



                    var rowTotal = response.data.total;

                    if (rowTotal === 0) {

                        var kotItemDateTooltip = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title');

                        var kotItemDateValue = $('.view_kot_report_daterange').val();

                        var kotItemDateText = kotItemDateTooltip || kotItemDateValue || '';

                        var kotItemMsg = kotItemDateText ? ('No Records on ' + kotItemDateText) : 'No Records';



                        table.hide();

                        $('.kotitemreport_header').hide();

                        $('.kotitemreport_norecord').empty().append('<div class="text-center text-dark"><p>' + kotItemMsg + '</p></div>');

                        $('#kotitemreport_img_hide,.kotitemreport_norecord').show();



                        $('#view_kotitemreport_page_total').text(0);

                        $('#view_kotitemreport_page_perpage_total').text(0);

                        $('#view_kotitemreport_total').text(0);

                    } else {

                        table.show();

                        $('.kotitemreport_norecord').empty();

                        $('#kotitemreport_img_hide,.kotitemreport_norecord').hide();

                        $('.kotitemreport_header').show();



                        var row_start = (table.data('current_page') - 1) * table.data('per_page') + 1;

                        $('#view_kotitemreport_page_total').text(row_start);



                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');

                        $('#view_kotitemreport_page_perpage_total').text(page_totals + response.data.list.length);

                    }



                    for (var i = 0; i < response.data.list.length; i++) {

                        var row = response.data.list[i];

                        var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;



                        var trow =

                            '<tr>' +

                            '<td>' + row_no + '</td>' +

                            '<td>' + (row.name || '') + '</td>' +

                            '<td class="text-center">' + (row.sales_count || 0) + '</td>' +

                            '</tr>';



                        table.children('tbody').append(trow);

                    }



                    // If export type, trigger CSV export after data is rendered

                    if (type === 'kotitemreportexport') {

                        PosnicPro.kotitemreport.exportItemwiseToCSV();

                    }

                } else {

                    PosnicPro.alert(response.type, response.message);

                }

            }, function (xhr) {

                loader.find(".loadingSpinner:first").remove();

                var res = jQuery.parseJSON(xhr.responseText);

                PosnicPro.alert(res.type, res.message);

            });



        } else {

            $(".kot_branch_value").focus();

        }

    },



    itemTableTabClick: function () {

        $('.kot_table_filter_container').hide();



        var table = $('#view_kotitemreport');

        table.data('current_page', 1);

        PosnicPro.kotitemreport.kotitemreportTable();

    },



    exportItemwise: function (index) {

        var type = $(index).data('id');

        var table = $('#view_kotitemreport');

        var originalPage = table.data('current_page') || 1;

        var originalPerPage = table.data('per_page') || 5;



        // Load all data for export

        PosnicPro.kotitemreport.kotitemreportTable(type);



        // After export completes, restore original pagination

        setTimeout(function () {

            table.data('current_page', originalPage);

            table.data('per_page', originalPerPage);

            PosnicPro.kotitemreport.kotitemreportTable();

        }, 500);

    },



    exportItemwiseToCSV: function () {

        var csv = 'Item Name,Sales Count\n';



        var rows = [];

        $('#view_kotitemreport tbody tr').each(function () {

            var cells = $(this).find('td');

            if (cells.length >= 3) {

                var itemName = $(cells[1]).text().trim();

                var salesCount = $(cells[2]).text().trim();



                rows.push({

                    itemName: itemName,

                    salesCount: salesCount

                });

            }

        });



        $.each(rows, function (i, row) {

            csv += row.itemName + ',';

            csv += row.salesCount + '\n';

        });



        var blob = new Blob([csv], { type: 'text/csv' });

        var link = document.createElement('a');

        link.href = window.URL.createObjectURL(blob);

        link.download = 'KOT_Itemwise_Sale_' + moment().format('YYYY-MM-DD') + '.csv';

        link.click();

    },



    applyFilter: function () {

        // When Tablewise Report tab is active, run the dedicated

        // table-wise filter (date range + branch + selected tables).

        if ($('#kot-tablewise-tab').hasClass('active')) {

            PosnicPro.kotitemreport.applyTablewiseReportFilter();

            return;

        }



        if ($('#kot-itemwise-tab').hasClass('active')) {

            $('#view_kotitemreport').data('current_page', 1);

            PosnicPro.kotitemreport.kotitemreportTable();

            return;

        }



        if ($('#kot-discount-tab').hasClass('active')) {

            $('#view_kotdiscountreport').data('current_page', 1);

            PosnicPro.kotdiscountreport.kotdiscountreportTable();

            return;

        }



        if ($('#kot-open-item-tab').hasClass('active')) {

            $('#view_kotopenitemreport').data('current_page', 1);

            PosnicPro.kotopenitemreport.kotopenitemreportTable();

            return;

        }



        if ($('#kot-cancellation-tab').hasClass('active')) {

            $('#view_kotcancellation').data('current_page', 1);

            PosnicPro.kotitemreport.cancellationSummaryTable();

            return;

        }



        // Default fallthrough for sales summary or other tabs

        if ($('#kot-sales-summary-tab').hasClass('active')) {

            $('#view_kotsalessummary').data('current_page', 1);

            PosnicPro.kotitemreport.salesSummaryTable();

            return;

        }

    },



    salesSummaryTabClick: function () {

        $('.kot_table_filter_container').hide();

        // Clear any residual content from the table

        $('#view_kotsalessummary tbody').empty();

        $('#view_kotsalessummary tbody').html('');

        PosnicPro.kotitemreport.salesSummaryTable();

    },



    tablewiseTabClick: function () {

        // When Tablewise Report tab is selected, show the table list

        // search box in the filter bar and ensure the available tables

        // for the current branch/date are already being loaded.

        $('.kot_table_filter_container').show();

        // Clear any previous tablewise content

        $('#kot-tablewise-right').empty();

        // Auto-load today's data for all tables when tab is clicked

        PosnicPro.kotitemreport.applyTablewiseReportFilter();

    },



    cancellationSummaryTabClick: function () {

        $('.kot_table_filter_container').hide();

        // Clear any residual content from the table

        $('#view_kotcancellation tbody').empty();

        $('#view_kotcancellation tbody').html('');

        PosnicPro.kotitemreport.cancellationSummaryTable();

    },



    // Apply Tablewise Report filter: date range + branch + selected tables

    // and render a table of KOT sales data in the Tablewise tab with expandable rows.

    applyTablewiseReportFilter: function () {

        var branchVal = $(".kot_branch_value").val() || [];

        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                branchVal = [fallbackBranch];

            }

        }



        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            $(".kot_branch_value").focus();

            return;

        }



        var loader = $(".loader-kot-tablewise-report");

        loader.find(".loadingSpinner:first").remove();

        $("<div class='loadingSpinner'></div>").appendTo(loader);



        var daterange = $(".view_kot_report_daterange").val();

        var fields = (daterange || '').split('-');



        var data = {

            starting_date: (fields[0] || '').trim(),

            ending_date: (fields[1] || '').trim(),

            branch: branchVal[0]

        };



        var right = $('#kot-tablewise-right');

        right.empty();



        var selectedTables = $('#kot_tablewise_table_value').val() || [];

        

        // Filter out empty string (All option) from selected tables

        var filteredTables = selectedTables.filter(function(t) { return t !== ''; });



        var detailParams = {

            url: 'sales/kotTablewiseDetails',

            data: {

                starting_date: data.starting_date,

                ending_date: data.ending_date,

                branch: data.branch,

                'tables': filteredTables

            }

        };



        PosnicPro.get(detailParams, function (detailRes) {

            loader.find('.loadingSpinner:first').remove();



            if (detailRes.type !== 'success') {

                right.append('<div class="text-center text-dark mt-4">No Records</div>');

                return;

            }



            var detailData = (detailRes.data && detailRes.data.list) ? detailRes.data.list : [];

            if (!detailData || detailData.length === 0) {

                right.append('<div class="text-center text-dark mt-4">No Records</div>');

                return;

            }



            var dCurrency = PosnicPro.local.get('currencySign') || '';

            

            // Group data by table number

            var tableGroups = {};

            for (var di = 0; di < detailData.length; di++) {

                var dr = detailData[di] || {};



                var sno = di + 1;

                var tableNumber = dr.table_number || '';

                

                // Skip TA table

                if (tableNumber === 'TA' || tableNumber.toUpperCase() === 'TA') {

                    continue;

                }

                

                var salesId = dr.sales_id || '';

                var dateStr = dr.string_date || '';

                var itemName = dr.item_name || '';



                var qty = parseFloat(dr.qty);

                if (!isFinite(qty)) { qty = 0; }



                var amount = parseFloat(dr.amount);

                if (!isFinite(amount)) { amount = 0; }



                var tax = parseFloat(dr.tax);

                if (!isFinite(tax)) { tax = 0; }



                var disc = parseFloat(dr.discount);

                if (!isFinite(disc)) { disc = 0; }



                var extraDisc = parseFloat(dr.extra_discount);

                if (!isFinite(extraDisc)) { extraDisc = 0; }



                var total = parseFloat(dr.total);

                if (!isFinite(total)) { total = 0; }

                

                // Group by table number

                if (!tableGroups[tableNumber]) {

                    tableGroups[tableNumber] = {

                        items: [],

                        salesExtraDiscounts: {},  // Track extra discount per sale

                        salesRoundOff: {},        // Track round-off per sale

                        totalRoundOff: 0,

                        totalQty: 0,

                        totalAmount: 0,

                        totalTax: 0,

                        totalDiscount: 0,

                        totalExtraDiscount: 0,

                        totalTotal: 0

                    };

                }

                

                tableGroups[tableNumber].items.push(dr);

                tableGroups[tableNumber].totalQty += qty;

                tableGroups[tableNumber].totalAmount += (amount * qty);

                tableGroups[tableNumber].totalTax += tax;

                tableGroups[tableNumber].totalDiscount += disc;

                

                // Track extra discount per sale to avoid double counting

                if (salesId && extraDisc > 0) {

                    if (!tableGroups[tableNumber].salesExtraDiscounts[salesId]) {

                        tableGroups[tableNumber].salesExtraDiscounts[salesId] = extraDisc;

                        tableGroups[tableNumber].totalExtraDiscount += extraDisc;

                    }

                }



                // Track round-off per sale once

                var roundOffVal = parseFloat(dr.round_off_total);

                if (!isFinite(roundOffVal)) {

                    roundOffVal = 0;

                }

                if (salesId && roundOffVal !== 0) {

                    if (!tableGroups[tableNumber].salesRoundOff[salesId]) {

                        tableGroups[tableNumber].salesRoundOff[salesId] = true;

                        tableGroups[tableNumber].totalRoundOff += roundOffVal;

                    }

                }

                

                tableGroups[tableNumber].totalTotal += total;

            }

            

            // Build expandable table HTML

            var tableRowsHtml = '';

            var sno = 1;

            

            for (var tableNo in tableGroups) {

                var tableData = tableGroups[tableNo];

                var tableId = 'tablewise_' + tableNo.replace(/[^a-zA-Z0-9]/g, '_');

                

                // Main row for table summary

                // Calculate final table total after subtracting extra discounts

                var netTotal = tableData.totalTotal - tableData.totalExtraDiscount;

                if (!isFinite(netTotal)) {

                    netTotal = 0;

                }

                if (netTotal < 0) {

                    netTotal = 0;

                }

                tableData.netTotal = netTotal;



                // Use totalAmount which is the sum of all item amounts (price * qty)

                var amountWithoutTax = tableData.totalAmount;

                if (!isFinite(amountWithoutTax)) {

                    amountWithoutTax = 0;

                }

                if (amountWithoutTax < 0) {

                    amountWithoutTax = 0;

                }



                tableRowsHtml += '<tr class="tablewise-main-row">';

                tableRowsHtml += '<td class="text-center expand-cell" data-toggle="collapse" data-target="#' + tableId + '">';

                tableRowsHtml += '<i class="feather icon-plus-circle"></i></td>';

                tableRowsHtml += '<td class="text-center">' + sno++ + '</td>';

                tableRowsHtml += '<td class="text-center">' + tableNo + '</td>';

                // Calculate subtotal: Amount - Discount + Tax

                var subtotal = amountWithoutTax - tableData.totalDiscount + tableData.totalTax;

                if (!isFinite(subtotal)) { subtotal = 0; }

                

                tableRowsHtml += '<td class="text-right">' + dCurrency + ' ' + amountWithoutTax.toFixed(2) + '</td>';

                tableRowsHtml += '<td class="text-right">' + (tableData.totalDiscount > 0.005 ? dCurrency + ' ' + tableData.totalDiscount.toFixed(2) : '-') + '</td>';

                tableRowsHtml += '<td class="text-right">' + (tableData.totalTax > 0.005 ? dCurrency + ' ' + tableData.totalTax.toFixed(2) : '-') + '</td>';

                tableRowsHtml += '<td class="text-right">' + dCurrency + ' ' + subtotal.toFixed(2) + '</td>';

                tableRowsHtml += '<td class="text-right">' + (tableData.totalExtraDiscount > 0.005 ? dCurrency + ' ' + tableData.totalExtraDiscount.toFixed(2) : '-') + '</td>';

                tableRowsHtml += '<td class="text-right">' + dCurrency + ' ' + netTotal.toFixed(2) + '</td>';

                tableRowsHtml += '</tr>';

                

                // Details row (hidden by default)

                tableRowsHtml += '<tr class="collapse tablewise-details-row" id="' + tableId + '">';

                tableRowsHtml += '<td colspan="9" style="padding: 0; background-color: var(--theme-body-bg);">';

                

                // Inner table for items

                tableRowsHtml += '<div style="padding: 10px;">';

                tableRowsHtml += '<table class="table table-sm table-bordered" style="margin: 0; background-color: var(--theme-card-bg);">';

                tableRowsHtml += '<thead><tr>';

                tableRowsHtml += '<th class="text-center" style="width: 60px;">S.No</th>';

                tableRowsHtml += '<th class="text-center">Date</th>';

                tableRowsHtml += '<th class="text-center">Sale ID</th>';

                tableRowsHtml += '<th class="text-left">Item Name</th>';

                tableRowsHtml += '<th class="text-center">Qty</th>';

                tableRowsHtml += '<th class="text-right">Amount</th>';

                tableRowsHtml += '<th class="text-right">Discount</th>';

                tableRowsHtml += '<th class="text-right">Tax</th>';

                tableRowsHtml += '<th class="text-right">Extra Discount</th>';

                tableRowsHtml += '<th class="text-center">Pax</th>';

                tableRowsHtml += '<th class="text-right">Total Amount</th>';

                tableRowsHtml += '</tr></thead><tbody>';

                

                // Add item rows - group by sale ID to show sale-level info once per sale

                var salesGroups = {};

                for (var ii = 0; ii < tableData.items.length; ii++) {

                    var item = tableData.items[ii];

                    var salesId = item.sales_id || '';

                    if (!salesGroups[salesId]) {

                        salesGroups[salesId] = [];

                    }

                    salesGroups[salesId].push(item);

                }

                

                var saleSno = 1;

                for (var saleId in salesGroups) {

                    if (!salesGroups.hasOwnProperty(saleId)) {

                        continue;

                    }

                    var saleItems = salesGroups[saleId];

                    if (!saleItems || !saleItems.length) {

                        continue;

                    }



                    var rowSpan = saleItems.length;

                    var firstItem = saleItems[0];

                    var saleDate = firstItem.string_date || '';

                    var saleDisplayId = firstItem.sales_id || '';

                    var salePax = parseFloat(firstItem.pax || firstItem.person_count || 0);

                    var salePaxDisplay = (isFinite(salePax) && salePax > 0) ? salePax : '';



                    var saleExtraDiscount = 0;

                    if (tableData.salesExtraDiscounts && tableData.salesExtraDiscounts[saleId]) {

                        saleExtraDiscount = parseFloat(tableData.salesExtraDiscounts[saleId]) || 0;

                    } else {

                        saleExtraDiscount = parseFloat(firstItem.extra_discount) || 0;

                    }



                    var saleTotalAmount = parseFloat(firstItem.sales_total);

                    if (!isFinite(saleTotalAmount) || saleTotalAmount <= 0) {

                        saleTotalAmount = 0;

                        for (var siTotal = 0; siTotal < saleItems.length; siTotal++) {

                            saleTotalAmount += parseFloat(saleItems[siTotal].total) || 0;

                        }

                    }



                    for (var si = 0; si < saleItems.length; si++) {

                        var item = saleItems[si];

                        var itemQty = parseFloat(item.qty) || 0;

                        var itemAmount = parseFloat(item.amount) || 0;

                        var itemDisc = parseFloat(item.discount) || 0;

                        var itemTax = parseFloat(item.tax) || 0;

                        var itemTotal = parseFloat(item.total) || 0;



                        tableRowsHtml += '<tr>';

                        if (si === 0) {

                            tableRowsHtml += '<td class="text-center" rowspan="' + rowSpan + '">' + (saleSno++) + '</td>';

                            tableRowsHtml += '<td class="text-center" rowspan="' + rowSpan + '">' + saleDate + '</td>';

                            tableRowsHtml += '<td class="text-center" rowspan="' + rowSpan + '">' + saleDisplayId + '</td>';

                        }

                        tableRowsHtml += '<td class="text-left">' + (item.item_name || '') + '</td>';

                        tableRowsHtml += '<td class="text-center">' + itemQty + '</td>';

                        tableRowsHtml += '<td class="text-right">' + dCurrency + ' ' + itemAmount.toFixed(2) + '</td>';

                        tableRowsHtml += '<td class="text-right">' + (itemDisc > 0.005 ? dCurrency + ' ' + itemDisc.toFixed(2) : '-') + '</td>';

                        tableRowsHtml += '<td class="text-right">' + (itemTax > 0.005 ? dCurrency + ' ' + itemTax.toFixed(2) : '-') + '</td>';

                        if (si === 0) {

                            tableRowsHtml += '<td class="text-right" rowspan="' + rowSpan + '">' + (saleExtraDiscount > 0.005 ? dCurrency + ' ' + saleExtraDiscount.toFixed(2) : '-') + '</td>';

                            tableRowsHtml += '<td class="text-center" rowspan="' + rowSpan + '">' + salePaxDisplay + '</td>';

                            tableRowsHtml += '<td class="text-right" rowspan="' + rowSpan + '">' + dCurrency + ' ' + saleTotalAmount.toFixed(2) + '</td>';

                        }

                        tableRowsHtml += '</tr>';

                    }

                }



                tableRowsHtml += '</tbody></table>';

                tableRowsHtml += '</div>';

                tableRowsHtml += '</td></tr>';

            }

            

            if (!tableRowsHtml) {

                right.append('<div class="text-center text-dark mt-4">No Records</div>');

                return;

            }



            // Calculate grand totals

            var grandTotalAmount = 0;

            var grandTotalTax = 0;

            var grandTotalDiscount = 0;

            var grandTotalExtraDiscount = 0;

            var grandTotal = 0;

            var grandTotalRoundOff = 0;

            

            for (var tbl in tableGroups) {

                grandTotalAmount += tableGroups[tbl].totalAmount;

                grandTotalTax += tableGroups[tbl].totalTax;

                grandTotalDiscount += tableGroups[tbl].totalDiscount;

                grandTotalExtraDiscount += tableGroups[tbl].totalExtraDiscount;

                grandTotalRoundOff += tableGroups[tbl].totalRoundOff;

                var tblNet = tableGroups[tbl].netTotal;

                if (!isFinite(tblNet)) {

                    tblNet = tableGroups[tbl].totalTotal - tableGroups[tbl].totalExtraDiscount;

                }

                grandTotal += (isFinite(tblNet) ? tblNet : 0);

            }

            

            // Use grandTotalAmount which is the sum of all item amounts (price * qty)

            var grandTotalWithoutTax = grandTotalAmount;

            if (!isFinite(grandTotalWithoutTax)) {

                grandTotalWithoutTax = 0;

            }



            // Add CSS for expand/collapse icons

            var styleHtml = '<style>' +

                '.tablewise-main-row { cursor: pointer; }' +

                '.tablewise-main-row:hover { background-color: #f5f5f5; }' +

                '.expand-cell { width: 40px; }' +

                '.expand-cell i { transition: transform 0.2s; }' +

                '.tablewise-main-row.expanded .expand-cell i { transform: rotate(90deg); }' +

                '.tablewise-details-row td { border: none !important; }' +

                '</style>';

            

            var detailTableHtml = styleHtml +

                '<div class="table-responsive mt-4">' +

                '<table class="table table-bordered" id="kot_tablewise_items_details">' +

                '<thead>' +

                '<tr>' +

                '<th style="width: 40px;"></th>' +

                '<th class="text-center" style="width:60px;">S.No</th>' +

                '<th class="text-center">Table No</th>' +

                '<th class="text-right">Amount</th>' +

                '<th class="text-right">Discount</th>' +

                '<th class="text-right">Tax</th>' +

                '<th class="text-right">Total</th>' +

                '<th class="text-right">Extra Discount</th>' +

                '<th class="text-right">Total Amount</th>' +

                '</tr>' +

                '</thead>' +

                '<tbody>' +

                tableRowsHtml +

                '</tbody>' +

                '<tfoot>' +

                '<tr class="font-weight-bold">' +

                '<td colspan="3" class="text-right">Total</td>' +

                '<td class="text-right">' + dCurrency + ' ' + grandTotalWithoutTax.toFixed(2) + '</td>' +

                '<td class="text-right">' + (grandTotalDiscount > 0.005 ? dCurrency + ' ' + grandTotalDiscount.toFixed(2) : '-') + '</td>' +

                '<td class="text-right">' + (grandTotalTax > 0.005 ? dCurrency + ' ' + grandTotalTax.toFixed(2) : '-') + '</td>' +

                '<td class="text-right">' + dCurrency + ' ' + (grandTotalWithoutTax - grandTotalDiscount + grandTotalTax).toFixed(2) + '</td>' +

                '<td class="text-right">' + (grandTotalExtraDiscount > 0.005 ? dCurrency + ' ' + grandTotalExtraDiscount.toFixed(2) : '-') + '</td>' +

                '<td class="text-right">' + dCurrency + ' ' + grandTotal.toFixed(2) + '</td>' +

                '</tr>' +

                '</tfoot>' +

                '</table>' +

                '</div>';



            right.append(detailTableHtml);

            

            // Add click handler for expand/collapse

            $(document).on('click', '.tablewise-main-row .expand-cell', function(e) {

                e.stopPropagation();

                var $row = $(this).closest('.tablewise-main-row');

                var $icon = $(this).find('i');

                

                if ($icon.hasClass('icon-plus-circle')) {

                    $icon.removeClass('icon-plus-circle').addClass('icon-minus-circle');

                    $row.addClass('expanded');

                } else {

                    $icon.removeClass('icon-minus-circle').addClass('icon-plus-circle');

                    $row.removeClass('expanded');

                }

            });

        }, function (xhr) {

            loader.find('.loadingSpinner:first').remove();

            right.append('<div class="text-center text-dark mt-4">No Records</div>');

        });

    },



    loadTablewiseTables: function () {

        var branchVal = $(".kot_branch_value").val() || [];

        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                branchVal = [fallbackBranch];

            }

        }



        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            $(".kot_branch_value").focus();

            return;

        }



        var loader = $(".loader-kot-tablewise-report");

        loader.find(".loadingSpinner:first").remove();

        $("<div class='loadingSpinner'></div>").appendTo(loader);



        var daterange = $(".view_kot_report_daterange").val();

        var fields = (daterange || '').split('-');



        var data = {

            starting_date: (fields[0] || '').trim(),

            ending_date: (fields[1] || '').trim(),

            branch: branchVal[0]

        };



        var configuredTableNumbers = [];

        var select = $('#kot_tablewise_table_value');

        var currentKey = data.starting_date + '|' + data.ending_date + '|' + data.branch;

        var lastKey = select.data('tablewiseLoadKey') || '';

        var inProgress = !!select.data('tablewiseLoading');

        if (inProgress && lastKey === currentKey) {

            // Same branch/date is already loading; avoid duplicate API calls.

            return;

        }

        select.data('tablewiseLoading', true);

        select.data('tablewiseLoadKey', currentKey);

        // Disable while loading to avoid user interaction on stale list
        select.prop('disabled', true);

        select.find('option').not('.alltable_name').remove();

        var finishLoading = function () {

            select.data('tablewiseLoading', false);

            select.prop('disabled', false);

        };



        var buildTablewiseSelect = function (tableSummary) {

            // Preserve the "All" option, rebuild the rest

            select.find('option').not('.alltable_name').remove();



            var seen = {};

            var i;



            // 1) Add all configured table values from Settings -> Tables list

            for (i = 0; i < configuredTableNumbers.length; i++) {

                var cfgNum = (configuredTableNumbers[i] || '').toString().trim();

                if (!cfgNum) {

                    continue;

                }

                var cfgKey = cfgNum.toLowerCase();

                if (seen[cfgKey]) {

                    continue;

                }

                seen[cfgKey] = true;



                select.append($('<option></option>').attr('value', cfgNum).text(cfgNum));

            }



            // 2) Add any additional table numbers that appear in KOT sales

            for (i = 0; i < tableSummary.length; i++) {

                var row = tableSummary[i] || {};

                var tableNumber = (row.table_number || row.name || '').toString().trim();

                if (!tableNumber) {

                    continue;

                }



                var key = tableNumber.toLowerCase();

                if (seen[key]) {

                    continue;

                }

                seen[key] = true;



                select.append($('<option></option>').attr('value', tableNumber).text(tableNumber));

            }



            // Reset selection so user can pick from fresh list

            select.val('').trigger('change');



            // Refresh Select2 to show the newly added options

            if (select.hasClass('select2-hidden-accessible')) {

                select.select2('destroy').select2();

            }



            // Function to fix Select2 container height

            var fixSelect2Height = function() {

                select.next('.select2-container').find('.select2-selection--multiple').css({

                    'min-height': '38px',

                    'height': 'auto',

                    'overflow': 'visible'

                });

            };



            // Apply fix immediately

            setTimeout(fixSelect2Height, 100);



            // Initialize previous values tracking

            select.data('prevValues', ['']);



            // Add event handler for All selection logic

            select.off('change.tableAllLogic').on('change.tableAllLogic', function() {

                var $this = $(this);

                var selectedValues = $this.val() || [];

                var hasAll = selectedValues.indexOf('') !== -1;

                var hasIndividual = selectedValues.length > 0 && selectedValues.some(function(v) { return v !== ''; });

                // If both "All" and individual tables are selected

                if (hasAll && hasIndividual) {

                    // Check which was selected last by comparing with previous state

                    var prevValues = $this.data('prevValues') || [];

                    var prevHasAll = prevValues.indexOf('') !== -1;

                    // Prevent infinite loop

                    $this.off('change.tableAllLogic');

                    if (!prevHasAll && hasAll) {

                        // "All" was just selected, remove all individual selections

                        $this.val(['']);

                    } else {

                        // Individual table was just selected, remove "All"

                        var newValues = selectedValues.filter(function(v) { return v !== ''; });

                        $this.val(newValues);

                    }

                    // Re-attach handler and trigger change

                    $this.on('change.tableAllLogic', arguments.callee);

                    $this.trigger('change.select2');

                }

                // Store current values for next comparison

                $this.data('prevValues', $this.val() || []);

                // Fix height after selection change

                setTimeout(fixSelect2Height, 50);

            });

            finishLoading();

        };



        // Helper to actually load sales data and merge with configured tables

        var loadFromSales = function () {

            var params = { url: 'sales/dailySalesReports', data: data };

            PosnicPro.get(params, function (response) {

                loader.find(".loadingSpinner:first").remove();

                if (response.type !== 'success') {

                    finishLoading();

                    PosnicPro.alert(response.type, response.message);

                    return;

                }

                var tableSummary = response.data.table_summary || [];

                buildTablewiseSelect(tableSummary);

            }, function (xhr) {

                loader.find(".loadingSpinner:first").remove();

                finishLoading();

                var res = jQuery.parseJSON(xhr.responseText);

                PosnicPro.alert(res.type, res.message);

            });

        };



        var cfgParams = { url: 'setting/getTableOrderAll' };

        PosnicPro.get(cfgParams, function (cfgResponse) {

            if (cfgResponse) {

                var cfgRaw = cfgResponse.data;

                var cfgData = [];

                if ($.isArray(cfgRaw)) {

                    cfgData = cfgRaw;

                } else if (cfgRaw && $.isArray(cfgRaw.list)) {

                    cfgData = cfgRaw.list;

                } else if (cfgRaw && $.isArray(cfgRaw.tableorder_values)) {

                    cfgData = cfgRaw.tableorder_values;

                } else if ($.isArray(cfgResponse.list)) {

                    cfgData = cfgResponse.list;

                } else if ($.isArray(cfgResponse.tableorder_values)) {

                    cfgData = cfgResponse.tableorder_values;

                }

                for (var c = 0; c < cfgData.length; c++) {

                    var row = cfgData[c] || {};

                    var val = (row.tableorder_value || row.value || row.name || '').toString().trim();

                    if (val) {

                        configuredTableNumbers.push(val);

                    }

                }

            }

            // Immediately build dropdown using configured tables so user

            // sees table numbers without waiting for sales data.

            buildTablewiseSelect([]);

            // After config tables are loaded (or if call fails silently),

            // load sales data and merge both sources.

            loadFromSales();

        }, function () {

            // If the table-order settings API fails, still proceed with

            // whatever tables we can discover from sales.

            loadFromSales();

        });

    },



    salesSummaryTable: function (callback) {

        var branchVal = $(".kot_branch_value").val() || [];

        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                branchVal = [fallbackBranch];

            }

        }

        if (branchVal && branchVal.length > 0 && branchVal[0] !== '') {

            var loader = $(".loader-kot-sales-summary");

            loader.find(".loadingSpinner:first").remove();

            $("<div class='loadingSpinner'></div>").appendTo(loader);



            var daterange = $(".view_kot_report_daterange").val();

            var fields = (daterange || '').split('-');



            var fromLabel = (fields[0] || '').trim();

            var toLabel = (fields[1] || '').trim();

            $('#kotsales_fromdate').text(fromLabel);

            $('#kotsales_todate').text(toLabel);



            var table = $('#view_kotsalessummary');

            var exportAll = table.data('export_all') === true;

            var current_page = 1; // pagination disabled for KOT Sales Summary



            var data = {

                starting_date: fromLabel,

                ending_date: toLabel,

                branch: branchVal[0]

            };



            var params = { url: 'sales/dailySalesReports', data: data };



            PosnicPro.get(params, function (response) {

                loader.find(".loadingSpinner:first").remove();



                if (response.type === 'success') {

                    table.children('tbody').empty();

                    table.find('tbody').html('');



                    var tableSummary = response.data.table_summary || [];

                    var total = tableSummary.length;



                    // Disable pagination: show all rows in a single page

                    var per_page = total || 0;

                    var total_pages = total > 0 ? 1 : 0;



                    // Overall totals for with-tax / without-tax

                    var totalWithTaxAll = 0;

                    var taxTotalFromTables = 0;

                    var hasPerTableTax = false;

                    var totalDiscountAll = 0;

                    var totalWithoutTaxAll = 0;

                    var totalItemDiscountAll = 0;

                    var totalExtraDiscountAll = 0;

                    var totalQtyAll = 0;

                    var totalPaxAll = 0;



                    for (var tw = 0; tw < tableSummary.length; tw++) {

                        var tsRow = tableSummary[tw] || {};

                        var rowAmt = parseFloat(tsRow.total_amount);

                        if (!isFinite(rowAmt)) {

                            rowAmt = 0;

                        }

                        totalWithTaxAll += rowAmt;



                        // Prefer exact per-table tax if backend provides it

                        var perTableTax = parseFloat(tsRow.tax_amount);

                        if (isFinite(perTableTax) && perTableTax >= 0) {

                            hasPerTableTax = true;

                            taxTotalFromTables += perTableTax;

                        } else {

                            perTableTax = 0;

                        }



                        // Use backend-provided amount_without_tax when available so that

                        //   Sub Total - Discount = Amount (Without Tax)

                        // and

                        //   Amount (Without Tax) + Tax + Round Off = Grand Total.

                        var perTableWithoutTax = parseFloat(tsRow.amount_without_tax);

                        var perTableRoundOff = parseFloat(tsRow.round_off_total);

                        if (!isFinite(perTableRoundOff)) {

                            perTableRoundOff = 0;

                        }



                        if (!isFinite(perTableWithoutTax)) {

                            // Fallback if older backend doesn't send amount_without_tax

                            perTableWithoutTax = rowAmt - perTableTax - perTableRoundOff;

                        }

                        if (!isFinite(perTableWithoutTax) || perTableWithoutTax < 0) {

                            perTableWithoutTax = 0;

                        }

                        totalWithoutTaxAll += perTableWithoutTax;



                        // Sum per-table discount when backend provides it. We

                        // support multiple possible field names so existing

                        // APIs keep working.

                        var tableDiscount = parseFloat(

                            (typeof tsRow.discount_amount !== 'undefined' ? tsRow.discount_amount :

                                (typeof tsRow.total_discount !== 'undefined' ? tsRow.total_discount :

                                    (typeof tsRow.discount !== 'undefined' ? tsRow.discount : 0)))

                        );

                        if (!isFinite(tableDiscount) || tableDiscount < 0) {

                            tableDiscount = 0;

                        }

                        totalDiscountAll += tableDiscount;



                        // Track split of item-level vs extra (bill-level) discount per table when available

                        var itemDiscVal = parseFloat(tsRow.item_discount_amount);

                        if (!isFinite(itemDiscVal) || itemDiscVal < 0) {

                            itemDiscVal = 0;

                        }



                        var extraDiscVal = parseFloat(tsRow.extra_discount_amount);

                        if (!isFinite(extraDiscVal) || extraDiscVal < 0) {

                            // Fallback: derive extra discount as remainder when backend did not split

                            extraDiscVal = Math.max(0, tableDiscount - itemDiscVal);

                        }



                        totalItemDiscountAll += itemDiscVal;

                        totalExtraDiscountAll += extraDiscVal;



                        // Aggregate per-table quantity when backend provides it.

                        var rawTableQtyAll = null;

                        if (tsRow.table_qty != null) {

                            rawTableQtyAll = tsRow.table_qty;

                        } else if (tsRow.total_qty != null) {

                            rawTableQtyAll = tsRow.total_qty;

                        } else if (tsRow.total_quantity != null) {

                            rawTableQtyAll = tsRow.total_quantity;

                        } else if (tsRow.qty != null) {

                            rawTableQtyAll = tsRow.qty;

                        } else if (tsRow.quantity != null) {

                            rawTableQtyAll = tsRow.quantity;

                        }



                        var tableQtyAll = parseFloat(rawTableQtyAll);

                        if (!isFinite(tableQtyAll) || tableQtyAll < 0) {

                            tableQtyAll = 0;

                        }

                        totalQtyAll += tableQtyAll;



                        // Aggregate per-table pax when backend provides it.

                        var rawTablePaxAll = null;

                        if (tsRow.table_pax != null) {

                            rawTablePaxAll = tsRow.table_pax;

                        } else if (tsRow.pax != null) {

                            rawTablePaxAll = tsRow.pax;

                        } else if (tsRow.person_count != null) {

                            rawTablePaxAll = tsRow.person_count;

                        }



                        var tablePaxAll = parseFloat(rawTablePaxAll);

                        if (!isFinite(tablePaxAll) || tablePaxAll < 0) {

                            tablePaxAll = 0;

                        }

                        if (tablePaxAll > 0) {

                            totalPaxAll += tablePaxAll;

                        }

                    }



                    // Fallback tax total if table-level tax is missing. In normal

                    // flow, hasPerTableTax will be true and we will use

                    // taxTotalFromTables which is the sum of per-table tax_amount.

                    var taxDetails = response.data.tax_details || [];

                    var taxTotalFromDetails = 0;

                    for (var tx = 0; tx < taxDetails.length; tx++) {

                        var taxAmt = parseFloat(taxDetails[tx].total_tax);

                        if (!isFinite(taxAmt)) {

                            taxAmt = 0;

                        }

                        taxTotalFromDetails += taxAmt;

                    }



                    var taxTotalAll = hasPerTableTax ? taxTotalFromTables : taxTotalFromDetails;



                    // When backend doesn't return per-table tax/without-tax values,

                    // we may need to derive per-row values. To avoid assigning tax to

                    // tables that actually have no tax, only apply proportional

                    // distribution when there is exactly one table row. For multiple

                    // tables, keep per-row tax at 0 and show only the overall tax in

                    // the summary row.

                    var withoutTaxRatio = 0;

                    if (!hasPerTableTax && total === 1 && totalWithTaxAll > 0 && totalWithoutTaxAll > 0) {

                        withoutTaxRatio = totalWithoutTaxAll / totalWithTaxAll;

                    }



                    // Store basic metadata (used by export code)

                    table.data('total', total);

                    table.data('total_pages', total_pages);

                    table.data('current_page', current_page);

                    table.data('per_page', per_page);



                    if (total === 0) {

                        var kotDateRangeTooltip = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title');

                        var kotDateRangeValue = $('.view_kot_report_daterange').val();

                        var kotDateRangeText = kotDateRangeTooltip || kotDateRangeValue || '';

                        var kotsalesMsg = kotDateRangeText ? ('No table-wise KOT records on ' + kotDateRangeText) : 'No table-wise KOT records';



                        // Ensure table is completely empty and show a friendly

                        // message, but keep the overall KOT header/actions and

                        // the Tender / Order Type summaries controlled only by

                        // their own data.

                        table.children('tbody').empty();

                        table.find('tbody').html('');

                        table.hide();

                        $('.kotsalessummary_header, .kotsalessummary_actions').hide();



                        // Hide the small date range row ("From :" / "To :") that sits

                        // above the table when there are no KOT records.

                        $('.kotsalessummary_daterange_row').hide();



                        $('.kotsalessummary_norecord').empty().append('<div class="text-center text-dark"><p>' + kotsalesMsg + '</p></div>');

                        $('#kotsalessummary_img_hide,.kotsalessummary_norecord').show();



                        $('#view_kotsalessummary_page_total').text(0);

                        $('#view_kotsalessummary_page_perpage_total').text(0);

                        $('#view_kotsalessummary_total').text(0);



                        var zeroCurrency = (PosnicPro.local.get('currencySign') || '') + ' 0.00';

                        $('#view_kotsalessummary_total_without_tax').text(zeroCurrency);

                        $('#view_kotsalessummary_total_tax').text(zeroCurrency);

                        $('#view_kotsalessummary_total_discount').text(zeroCurrency);

                        $('#view_kotsalessummary_total_with_tax').text(zeroCurrency);



                        // When there are no KOT table rows, completely hide and

                        // clear the Payment Method Summary and Order Type

                        // Summary so that only the no-records message + image

                        // are visible.

                        $('.kotsalestender_container').hide();

                        $('.kotsalesdine_container').hide();



                        var $tenderTable = $('#view_kotsalestender');

                        $tenderTable.children('tbody').empty();

                        $('#view_kotsalestender_total').text('');



                        var $dineTable = $('#view_kotsalesdine');

                        $dineTable.children('tbody').empty();

                        $('#view_kotsalesdine_count_total').text('');

                        $('#view_kotsalesdine_pax_total').text('');

                        $('#view_kotsalesdine_amount_total').text('');



                        // Early exit for empty state: do not attempt to render

                        // any further summary tables in this case.

                        if (typeof callback === 'function') {

                            callback();

                        }

                        return;

                    } else {

                        $('.kotsalessummary_norecord').empty();

                        $('#kotsalessummary_img_hide,.kotsalessummary_norecord').hide();

                        $('.kotsalessummary_header, .kotsalessummary_actions').show();



                        // Restore the date range row when there is at least one

                        // KOT table row.

                        $('.kotsalessummary_daterange_row').show();



                        table.show();



                        // Render all rows without pagination

                        var startIndex = total > 0 ? 1 : 0;

                        var paginatedData = tableSummary;



                        var currencySign = PosnicPro.local.get('currencySign') || '';



                        for (var i = 0; i < paginatedData.length; i++) {

                            var row = paginatedData[i];

                            var row_no = startIndex + i;



                            // Get payment modes for this specific table. Prefer detailed

                            // method+amount strings when the backend provides them.

                            var paymentModesWithAmounts = row.payment_modes_with_amounts || [];

                            var paymentModes = row.payment_modes || [];

                            var paymentTypes = 'N/A';



                            // Show each settlement type on its own line inside the cell

                            // so values like "Upi \u20b9 80.00, Amazonpay \u20b9 400.00" become

                            // a vertically split list instead of a single long string.

                            if (paymentModesWithAmounts && paymentModesWithAmounts.length > 0) {

                                paymentTypes = paymentModesWithAmounts.join('<br>');

                            } else if (paymentModes && paymentModes.length > 0) {

                                paymentTypes = paymentModes.join('<br>');

                            }



                            // Per-row tax / without-tax values

                            var rowTotalWithTax = parseFloat(row.total_amount);

                            if (!isFinite(rowTotalWithTax)) {

                                rowTotalWithTax = 0;

                            }



                            var rowTax = 0;

                            var rowWithoutTax = rowTotalWithTax;



                            // Prefer exact backend-provided fields if available

                            var explicitRowTax = parseFloat(row.tax_amount);

                            var explicitRowWithoutTax = parseFloat(row.amount_without_tax);



                            var hasExplicitTax = isFinite(explicitRowTax) && explicitRowTax >= 0;

                            var hasExplicitWithoutTax = isFinite(explicitRowWithoutTax) && explicitRowWithoutTax >= 0;



                            if (hasExplicitTax && hasExplicitWithoutTax) {

                                rowTax = explicitRowTax;

                                rowWithoutTax = explicitRowWithoutTax;

                            } else if (hasExplicitTax) {

                                rowTax = explicitRowTax;

                                rowWithoutTax = rowTotalWithTax - rowTax;

                            } else if (hasExplicitWithoutTax) {

                                rowWithoutTax = explicitRowWithoutTax;

                                rowTax = rowTotalWithTax - rowWithoutTax;

                            } else if (withoutTaxRatio > 0) {

                                // Backend did not provide per-table amounts and we have a

                                // single-row case with known overall totals. Allocate tax

                                // proportionally only in this scenario.

                                rowWithoutTax = rowTotalWithTax * withoutTaxRatio;

                                rowTax = rowTotalWithTax - rowWithoutTax;

                            }



                            if (!isFinite(rowTax) || rowTax < 0) {

                                rowTax = 0;

                            }

                            if (!isFinite(rowWithoutTax) || rowWithoutTax < 0) {

                                rowWithoutTax = 0;

                            }



                            // Format display values. Tax / Discount columns should show '-' when there is no value.

                            var displayWithoutTax = currencySign + ' ' + rowWithoutTax.toFixed(2);

                            var displayTax = (Math.abs(rowTax) > 0.005)

                                ? (currencySign + ' ' + rowTax.toFixed(2))

                                : '-';



                            // Per-row discount: use the table-wise discount

                            // fields returned by DailySalesReportPage when

                            // available (discount_amount / total_discount /

                            // discount). This keeps the KOT Sales Summary in

                            // sync with the KOT Discount Report and the

                            // individual Sale Details.

                            var rowDiscount = parseFloat(

                                (typeof row.discount_amount !== 'undefined' ? row.discount_amount :

                                    (typeof row.total_discount !== 'undefined' ? row.total_discount :

                                        (typeof row.discount !== 'undefined' ? row.discount : 0)))

                            );



                            if (!isFinite(rowDiscount) || rowDiscount < 0) {

                                rowDiscount = 0;

                            }



                            // Split per-row discount into item vs extra when backend provides it

                            var itemDiscount = parseFloat(row.item_discount_amount);

                            if (!isFinite(itemDiscount) || itemDiscount < 0) {

                                itemDiscount = 0;

                            }



                            var extraDiscount = parseFloat(row.extra_discount_amount);

                            if (!isFinite(extraDiscount) || extraDiscount < 0) {

                                extraDiscount = Math.max(0, rowDiscount - itemDiscount);

                            }



                            var displayItemDiscount = (Math.abs(itemDiscount) > 0.005)

                                ? (currencySign + ' ' + itemDiscount.toFixed(2))

                                : '-';



                            var displayExtraDiscount = (Math.abs(extraDiscount) > 0.005)

                                ? (currencySign + ' ' + extraDiscount.toFixed(2))

                                : '-';

                            var displayWithTax = currencySign + ' ' + rowTotalWithTax.toFixed(2);

                            

                            // Per-table quantity and pax

                            var rawTableQty = null;

                            if (row.table_qty != null) {

                                rawTableQty = row.table_qty;

                            } else if (row.total_qty != null) {

                                rawTableQty = row.total_qty;

                            } else if (row.total_quantity != null) {

                                rawTableQty = row.total_quantity;

                            } else if (row.qty != null) {

                                rawTableQty = row.qty;

                            } else if (row.quantity != null) {

                                rawTableQty = row.quantity;

                            }



                            var tableQty = parseFloat(rawTableQty);

                            if (!isFinite(tableQty) || tableQty < 0) {

                                tableQty = 0;

                            }

                            var displayQty = tableQty > 0 ? tableQty : '';



                            var rawTablePax = null;

                            if (row.table_pax != null) {

                                rawTablePax = row.table_pax;

                            } else if (row.pax != null) {

                                rawTablePax = row.pax;

                            } else if (row.person_count != null) {

                                rawTablePax = row.person_count;

                            }



                            var tablePax = parseFloat(rawTablePax);

                            if (!isFinite(tablePax) || tablePax < 0) {

                                tablePax = 0;

                            }

                            var displayPax = tablePax > 0 ? tablePax : '';



                            // Column order: [expand], #, Table No, Qty, Amount, Discount,

                            // Tax, Extra Discount, Pax, Total Amount

                            var roundOff = parseFloat(row.round_off_total);

                            if (!isFinite(roundOff)) {

                                roundOff = 0;

                            }

                            var displayRoundOff = currencySign + ' ' + roundOff.toFixed(2);



                            var tableNumber = (row.table_number || row.name || '');



                            var mainRowHtml =

                                '<tr class="kotsales-main-row">' +

                                '<td class="text-center align-middle">' +

                                '<a href="javascript:void(0);" class="kotsales-expand-toggle" title="View Details">' +

                                '<i class="fa fa-plus-circle"></i>' +

                                '</a>' +

                                '</td>' +

                                '<td>' + row_no + '</td>' +

                                '<td>' + tableNumber + '</td>' +

                                '<td class="text-center">' + displayQty + '</td>' +

                                '<td class="text-right">' + displayWithoutTax + '</td>' +

                                '<td class="text-right">' + displayItemDiscount + '</td>' +

                                '<td class="text-right">' + displayTax + '</td>' +

                                '<td class="text-right">' + displayExtraDiscount + '</td>' +

                                '<td class="text-center">' + displayPax + '</td>' +

                                '<td class="text-right">' + displayWithTax + '</td>' +

                                '</tr>';



                            var paymentTypesAttr = (paymentTypes || '').replace(/"/g, '&quot;');



                            var detailsInnerHtml =

                                '<div class="card mb-0" style="background-color: var(--theme-card-bg); border-color: var(--theme-border-color);">' +

                                '<div class="card-body p-2" style="font-size:12px;">' +

                                '<div class="kotsales-details-items-container" data-table-number="' + tableNumber + '" data-loaded="0" data-payment-html="' + paymentTypesAttr + '">' +

                                '<div class="text-muted small">Loading details...</div>' +

                                '</div>' +

                                '</div>' +

                                '</div>';



                            var detailsRowHtml =

                                '<tr class="kotsales-details-row" style="display:none;">' +

                                '<td colspan="10">' + detailsInnerHtml + '</td>' +

                                '</tr>';



                            table.children('tbody').append(mainRowHtml + detailsRowHtml);

                        }



                        // Overall totals (for entire date range, not just current page)

                        var totalWithoutTaxText = currencySign + ' ' + totalWithoutTaxAll.toFixed(2);

                        var taxTotalText = currencySign + ' ' + taxTotalAll.toFixed(2);

                        var totalDiscountText = currencySign + ' ' + totalDiscountAll.toFixed(2);

                        var totalItemDiscountText = currencySign + ' ' + totalItemDiscountAll.toFixed(2);

                        var totalExtraDiscountText = currencySign + ' ' + totalExtraDiscountAll.toFixed(2);

                        var totalWithTaxText = currencySign + ' ' + totalWithTaxAll.toFixed(2);

                        var totalQtyText = totalQtyAll > 0 ? totalQtyAll : '';

                        var totalPaxText = totalPaxAll > 0 ? totalPaxAll : '';



                        // Add a summary row at the bottom of the table matching the new column order

                        var summaryRow =

                            '<tr class="font-weight-bold">' +

                            '<td></td>' +

                            '<td></td>' +

                            '<td class="text-center">Total</td>' +

                            '<td class="text-center">' + totalQtyText + '</td>' +

                            '<td class="text-right">' + totalWithoutTaxText + '</td>' +

                            '<td class="text-right">' + totalItemDiscountText + '</td>' +

                            '<td class="text-right">' + taxTotalText + '</td>' +

                            '<td class="text-right">' + totalExtraDiscountText + '</td>' +

                            '<td class="text-center">' + totalPaxText + '</td>' +

                            '<td class="text-right">' + totalWithTaxText + '</td>' +

                            '</tr>';



                        table.children('tbody').append(summaryRow);



                        // Bind expand/collapse handlers for the details rows,

                        // and lazy-load per-table detailed items when first expanded.

                        table.off('click.kotsalesExpand', '.kotsales-expand-toggle');

                        table.on('click.kotsalesExpand', '.kotsales-expand-toggle', function () {

                            var $icon = $(this).find('i');

                            var $mainRow = $(this).closest('tr');

                            var $detailsRow = $mainRow.next('.kotsales-details-row');



                            if ($detailsRow.is(':visible')) {

                                $detailsRow.hide();

                                $icon.removeClass('fa-minus-circle').addClass('fa-plus-circle');

                                return;

                            }



                            $detailsRow.show();

                            $icon.removeClass('fa-plus-circle').addClass('fa-minus-circle');



                            var $itemsContainer = $detailsRow.find('.kotsales-details-items-container');

                            if (!$itemsContainer.length) {

                                return;

                            }



                            if ($itemsContainer.data('loaded') === 1) {

                                return;

                            }



                            var tableNumber = ($itemsContainer.data('table-number') || '').toString();

                            if (!tableNumber) {

                                return;

                            }



                            var detailParams = {

                                url: 'sales/kotTablewiseDetails',

                                data: {

                                    starting_date: data.starting_date,

                                    ending_date: data.ending_date,

                                    branch: data.branch,

                                    'tables': [tableNumber]

                                }

                            };



                            $itemsContainer.html('<div class="text-muted small">Loading details...</div>');



                            PosnicPro.get(detailParams, function (detailRes) {

                                if (detailRes.type !== 'success') {

                                    $itemsContainer.html('<div class="text-danger small">Details not available</div>');

                                    return;

                                }



                                var detailData = (detailRes.data && detailRes.data.list) ? detailRes.data.list : [];

                                if (!detailData || detailData.length === 0) {

                                    $itemsContainer.html('<div class="text-muted small">No item details</div>');

                                    return;

                                }



                                var dCurrency = PosnicPro.local.get('currencySign') || '';

                                var detailRowsHtml = '';

                                var totalQtyForTable = 0;

                                var totalAmountForTableFormula = 0;



                                // Group consecutive rows by sales_id so we can use rowspan

                                // for common sale-level fields (Date, Sale ID, Extra Discount,

                                // Pax and Payment Type).

                                var groupedBySale = [];

                                var currentGroup = null;

                                for (var di = 0; di < detailData.length; di++) {

                                    var gdr = detailData[di] || {};

                                    var gSaleId = gdr.sales_id || '';



                                    if (!currentGroup || currentGroup.saleId !== gSaleId) {

                                        currentGroup = { saleId: gSaleId, rows: [] };

                                        groupedBySale.push(currentGroup);

                                    }

                                    currentGroup.rows.push(gdr);

                                }



                                var snoCounter = 1;



                                for (var gi = 0; gi < groupedBySale.length; gi++) {

                                    var group = groupedBySale[gi];

                                    var saleId = group.saleId || '';

                                    var rows = group.rows || [];

                                    if (!rows.length) {

                                        continue;

                                    }



                                    var rowspan = rows.length;

                                    var first = rows[0] || {};



                                    var dateStrCommon = first.string_date || '';

                                    var extraDiscCommon = parseFloat(first.extra_discount);

                                    if (!isFinite(extraDiscCommon)) { extraDiscCommon = 0; }



                                    var paxCommon = parseInt(first.pax, 10);

                                    if (!isFinite(paxCommon) || paxCommon <= 0) { paxCommon = ''; }



                                    var saleTotalCommon = parseFloat(first.sales_total);

                                    if (!isFinite(saleTotalCommon) || saleTotalCommon < 0) { saleTotalCommon = 0; }



                                    // Build payment text once per sale (multi-payment or payment_mode)

                                    var salePaymentText = '';

                                    var rawMultiCommon = first.multi_payment;

                                    var multiObjCommon = null;

                                    if (rawMultiCommon) {

                                        if (typeof rawMultiCommon === 'string') {

                                            try {

                                                var parsedCommon = JSON.parse(rawMultiCommon);

                                                if (parsedCommon && typeof parsedCommon === 'object') {

                                                    multiObjCommon = parsedCommon;

                                                }

                                            } catch (e1) {}

                                        } else if (typeof rawMultiCommon === 'object') {

                                            multiObjCommon = rawMultiCommon;

                                        }

                                    }



                                    if (multiObjCommon && !Array.isArray(multiObjCommon)) {

                                        var linesCommon = [];

                                        for (var methodCommon in multiObjCommon) {

                                            if (!Object.prototype.hasOwnProperty.call(multiObjCommon, methodCommon)) {

                                                continue;

                                            }

                                            var mAmtCommon = parseFloat(multiObjCommon[methodCommon]);

                                            if (!isFinite(mAmtCommon) || mAmtCommon <= 0) {

                                                continue;

                                            }

                                            var labelCommon = (methodCommon || '').toString().trim() || 'N/A';

                                            linesCommon.push(labelCommon + ' ' + dCurrency + ' ' + mAmtCommon.toFixed(2));

                                        }

                                        if (linesCommon.length > 0) {

                                            salePaymentText = linesCommon.join('<br>');

                                        }

                                    }



                                    if (!salePaymentText) {

                                        var pmodeCommon = (first.payment_mode || '').toString().trim();

                                        if (pmodeCommon && saleTotalCommon > 0) {

                                            salePaymentText = pmodeCommon + ' ' + dCurrency + ' ' + saleTotalCommon.toFixed(2);

                                        }

                                    }



                                    var displayExtraDiscCommon = (Math.abs(extraDiscCommon) > 0.005)

                                        ? ('-' + dCurrency + ' ' + extraDiscCommon.toFixed(2))

                                        : '-';



                                    // First, compute the sum of per-item line totals for this sale:

                                    //   line total = Amount - Discount + Tax

                                    var saleLineTotalSum = 0;

                                    for (var ci = 0; ci < rows.length; ci++) {

                                        var cRow = rows[ci] || {};

                                        var cAmount = parseFloat(cRow.amount);

                                        if (!isFinite(cAmount)) { cAmount = 0; }

                                        var cTax = parseFloat(cRow.tax);

                                        if (!isFinite(cTax)) { cTax = 0; }

                                        var cDisc = parseFloat(cRow.discount);

                                        if (!isFinite(cDisc)) { cDisc = 0; }



                                        var cLineTotal = cAmount - cDisc + cTax;

                                        if (!isFinite(cLineTotal)) { cLineTotal = 0; }

                                        cLineTotal = Math.round(cLineTotal * 100) / 100;

                                        saleLineTotalSum += cLineTotal;

                                    }



                                    // Final sale Total Amount for this sale:

                                    //   (sum of line totals for all items) - Extra Discount

                                    var saleFinalTotal = saleLineTotalSum - extraDiscCommon;

                                    if (!isFinite(saleFinalTotal)) { saleFinalTotal = 0; }

                                    saleFinalTotal = Math.round(saleFinalTotal * 100) / 100;

                                    totalAmountForTableFormula += saleFinalTotal;

                                    var displaySaleTotal = dCurrency + ' ' + saleFinalTotal.toFixed(2);



                                    for (var ri = 0; ri < rows.length; ri++) {

                                        var dr = rows[ri] || {};



                                        var sno = snoCounter++;

                                        var itemName = dr.item_name || '';



                                        var qty = parseFloat(dr.qty);

                                        if (!isFinite(qty)) { qty = 0; }

                                        totalQtyForTable += qty;



                                        var amount = parseFloat(dr.amount);

                                        if (!isFinite(amount)) { amount = 0; }



                                        var tax = parseFloat(dr.tax);

                                        if (!isFinite(tax)) { tax = 0; }



                                        var disc = parseFloat(dr.discount);

                                        if (!isFinite(disc)) { disc = 0; }



                                        var displayAmount = dCurrency + ' ' + amount.toFixed(2);

                                        var displayTax = (Math.abs(tax) > 0.005)

                                            ? (dCurrency + ' ' + tax.toFixed(2))

                                            : '-';

                                        var displayDisc = (Math.abs(disc) > 0.005)

                                            ? ('-' + dCurrency + ' ' + disc.toFixed(2))

                                            : '-';



                                        var isFirstRowForSale = (ri === 0);



                                        detailRowsHtml += '<tr>';

                                        // S.No is always per-item

                                        detailRowsHtml += '<td class="text-center">' + sno + '</td>';



                                        if (isFirstRowForSale) {

                                            // Date and Sale ID once per sale with rowspan

                                            detailRowsHtml += '<td class="text-left" rowspan="' + rowspan + '">' + (dateStrCommon || '') + '</td>';

                                            detailRowsHtml += '<td class="text-left" rowspan="' + rowspan + '">' + (saleId || '') + '</td>';

                                        }



                                        // Item-specific columns

                                        detailRowsHtml += '<td class="text-left">' + itemName + '</td>';

                                        detailRowsHtml += '<td class="text-center">' + qty + '</td>';

                                        detailRowsHtml += '<td class="text-right">' + displayAmount + '</td>';

                                        detailRowsHtml += '<td class="text-right">' + displayDisc + '</td>';

                                        detailRowsHtml += '<td class="text-right">' + displayTax + '</td>';



                                        if (isFirstRowForSale) {

                                            // Extra Discount, Pax, Payment Type, and final Total Amount

                                            // once per sale with rowspan

                                            detailRowsHtml += '<td class="text-right" rowspan="' + rowspan + '">' + displayExtraDiscCommon + '</td>';

                                            detailRowsHtml += '<td class="text-center" rowspan="' + rowspan + '">' + (paxCommon !== '' ? paxCommon : '') + '</td>';

                                            detailRowsHtml += '<td class="text-left" rowspan="' + rowspan + '">' + salePaymentText + '</td>';

                                            detailRowsHtml += '<td class="text-right" rowspan="' + rowspan + '">' + displaySaleTotal + '</td>';

                                        }



                                        detailRowsHtml += '</tr>';

                                    }

                                }



                                // If we could not build any detail rows, show a friendly message

                                if (!detailRowsHtml) {

                                    $itemsContainer.html('<div class="text-muted small">No item details</div>');

                                    return;

                                }



                                // Update the main summary row's Qty cell so that it matches

                                // the sum of item quantities shown in the expanded table.

                                if (totalQtyForTable > 0) {

                                    // Qty column is the 4th data cell in the main row:

                                    // [0]=expand, [1]=#, [2]=Table No, [3]=Qty, ...

                                    var $qtyCell = $mainRow.find('td').eq(3);

                                    $qtyCell.text(totalQtyForTable);



                                    // Recompute overall Total Qty across all tables by summing

                                    // the Qty column of each main summary row.

                                    var totalQtyFromRows = 0;

                                    table.find('tr.kotsales-main-row').each(function () {

                                        var txt = $(this).find('td').eq(3).text().replace(/,/g, '').trim();

                                        var q = parseFloat(txt);

                                        if (isFinite(q) && q > 0) {

                                            totalQtyFromRows += q;

                                        }

                                    });



                                    // The bottom summary row is the last row in tbody and has

                                    // the same column layout as the main rows. Update its Qty cell.

                                    var $summaryRow = table.find('tbody tr').last();

                                    var $summaryQtyCell = $summaryRow.find('td').eq(3);

                                    if (totalQtyFromRows > 0) {

                                        $summaryQtyCell.text(totalQtyFromRows);

                                    } else {

                                        $summaryQtyCell.text('');

                                    }

                                }



                                // Update the main summary row's Total Amount cell so that it

                                // equals the sum of item Total Amounts inside the expanded

                                // table for this table number.

                                if (!isFinite(totalAmountForTableFormula)) {

                                    totalAmountForTableFormula = 0;

                                }

                                var roundedTableTotal = Math.round(totalAmountForTableFormula * 100) / 100;

                                if (roundedTableTotal < 0) {

                                    roundedTableTotal = 0;

                                }

                                var displayTableTotal = dCurrency + ' ' + roundedTableTotal.toFixed(2);

                                // Total Amount column is the 10th cell in the main row:

                                // [0]=expand, [1]=#, [2]=Table No, [3]=Qty, [4]=Amount,

                                // [5]=Discount, [6]=Tax, [7]=Extra Discount, [8]=Pax,

                                // [9]=Total Amount

                                var $totalAmountCell = $mainRow.find('td').eq(9);



                                var detailTableHtml = '' +

                                    '<div class="table-responsive mt-3">' +

                                    '<table class="table table-bordered table-sm mb-0" style="font-size:12px; background-color: var(--theme-card-bg);" width="100%" id="kotsales_summary_items_' + tableNumber + '">' +

                                    '<thead>' +

                                    '<tr>' +

                                    '<th class="text-center" style="width:60px;">S.No</th>' +

                                    '<th class="text-left" style="width:120px;">Date</th>' +

                                    '<th class="text-left" style="width:60px;">Sale ID</th>' +

                                    '<th class="text-left" style="width:60px;">Item Name</th>' +

                                    '<th class="text-center" style="width:80px;">Qty</th>' +

                                    '<th class="text-right" style="width:120px;">Amount</th>' +

                                    '<th class="text-right" style="width:120px;">Discount</th>' +

                                    '<th class="text-right" style="width:120px;">Tax</th>' +

                                    '<th class="text-right" style="width:120px;">Extra Discount</th>' +

                                    '<th class="text-center" style="width:80px;">Pax</th>' +

                                    '<th class="text-left">Payment Type</th>' +

                                    '<th class="text-right" style="width:120px;">Total Amount</th>' +

                                    '</tr>' +

                                    '</thead>' +

                                    '<tbody>' +

                                    detailRowsHtml +

                                    '</tbody>' +

                                    '</table>' +

                                    '</div>';



                                $itemsContainer.html(detailTableHtml);

                                $itemsContainer.data('loaded', 1);

                            }, function () {

                                $itemsContainer.html('<div class="text-danger small">Failed to load details</div>');

                            });

                        });



                        // Also write overall totals into the footer spans

                        $('#view_kotsalessummary_total_without_tax').text(totalWithoutTaxText);

                        $('#view_kotsalessummary_total_tax').text(taxTotalText);

                        $('#view_kotsalessummary_total_discount').text(totalDiscountText);

                        $('#view_kotsalessummary_total_with_tax').text(totalWithTaxText);



                        // ---------------- Tender Summary (payment_details) ----------------

                        var tenderDetails = response.data.payment_details || [];

                        var tenderContainer = $('.kotsalestender_container');

                        var tenderTable = $('#view_kotsalestender');

                        var tenderBody = tenderTable.children('tbody');

                        tenderBody.text('');



                        // If there are no KOT table rows for this date (total === 0),

                        // hide the tender summary even if the backend happens to

                        // return non-empty payment_details.

                        if (!tenderDetails || tenderDetails.length === 0 || total === 0) {

                            tenderContainer.hide();

                        } else {

                            tenderContainer.show();



                            // Group by payment_mode case-insensitively so 'Upi' and 'upi' are combined.

                            var grouped = {};

                            var order = [];

                            for (var pdx = 0; pdx < tenderDetails.length; pdx++) {

                                var pm = tenderDetails[pdx] || {};

                                var rawMode = (pm.payment_mode || '').toString();

                                var trimmedMode = rawMode.replace(/^\s+|\s+$/g, '');

                                var key = trimmedMode.toLowerCase();

                                var amt = parseFloat(pm.sale_payment);

                                if (!isFinite(amt)) {

                                    amt = 0;

                                }



                                if (!grouped[key]) {

                                    grouped[key] = {

                                        label: trimmedMode || 'Unknown',

                                        amount: 0

                                    };

                                    order.push(key);

                                }

                                grouped[key].amount += amt;

                            }



                            var tenderTotal = 0;

                            for (var gi = 0; gi < order.length; gi++) {

                                var gkey = order[gi];

                                var entry = grouped[gkey];

                                var label = entry.label;

                                var amtTotal = entry.amount;

                                tenderTotal += amtTotal;



                                var rowHtml =

                                    '<tr>' +

                                    '<td class="text-center">' + (gi + 1) + '</td>' +

                                    '<td class="text-left">' + label + '</td>' +

                                    '<td class="text-right">' + currencySign + ' ' + amtTotal.toFixed(2) + '</td>' +

                                    '</tr>';



                                tenderBody.append(rowHtml);

                            }



                            var tenderTotalText = currencySign + ' ' + tenderTotal.toFixed(2);

                            $('#view_kotsalestender_total').text(tenderTotalText);

                        }



                        // ---------------- Dine Type / Order Type Summary (dine_details) ----------------

                        var dineDetails = response.data.dine_details || [];

                        var dineContainer = $('.kotsalesdine_container');

                        var dineTable = $('#view_kotsalesdine');

                        var dineBody = dineTable.children('tbody');

                        dineBody.text('');



                        // Similarly, if there are no KOT table rows (total === 0),

                        // suppress the order type summary even when dine_details

                        // contains historical aggregates.

                        if (!dineDetails || dineDetails.length === 0 || total === 0) {

                            dineContainer.hide();

                        } else {

                            dineContainer.show();



                            var dineCountTotal = 0;

                            var dinePaxTotal = 0;

                            var dineAmountTotal = 0;



                            for (var d = 0; d < dineDetails.length; d++) {

                                var dRow = dineDetails[d] || {};

                                var dType = (dRow.dine_type || 'Unknown').toString();



                                var dCount = parseFloat(dRow.dine_count);

                                if (!isFinite(dCount) || dCount < 0) {

                                    dCount = 0;

                                }



                                // Support different backend field names for pax

                                var rawPax = null;

                                if (dRow.dine_pax != null) {

                                    rawPax = dRow.dine_pax;

                                } else if (dRow.pax != null) {

                                    rawPax = dRow.pax;

                                } else if (dRow.person_count != null) {

                                    rawPax = dRow.person_count;

                                }



                                var dPax = parseFloat(rawPax);

                                if (!isFinite(dPax) || dPax < 0) {

                                    dPax = 0;

                                }



                                var dAmount = parseFloat(dRow.dine_amount);

                                if (!isFinite(dAmount)) {

                                    dAmount = 0;

                                }



                                dineCountTotal += dCount;

                                dineAmountTotal += dAmount;



                                var displayPax = '';

                                if (dPax > 0) {

                                    dinePaxTotal += dPax;

                                    displayPax = dPax;

                                }



                                var displayAmount = currencySign + ' ' + dAmount.toFixed(2);



                                var dineRowHtml =

                                    '<tr>' +

                                    '<td class="text-center">' + (d + 1) + '</td>' +

                                    '<td class="text-left">' + dType + '</td>' +

                                    '<td class="text-center">' + dCount + '</td>' +

                                    '<td class="text-center">' + displayPax + '</td>' +

                                    '<td class="text-right">' + displayAmount + '</td>' +

                                    '</tr>';



                                dineBody.append(dineRowHtml);

                            }



                            // Update footer totals

                            $('#view_kotsalesdine_count_total').text(dineCountTotal);

                            $('#view_kotsalesdine_pax_total').text(dinePaxTotal > 0 ? dinePaxTotal : '');

                            $('#view_kotsalesdine_amount_total').text(currencySign + ' ' + dineAmountTotal.toFixed(2));



                            // Show/hide Pax column depending on whether we have any positive pax

                            var $paxCells = $('#view_kotsalesdine thead th:nth-child(4),' +

                                '#view_kotsalesdine tbody td:nth-child(4),' +

                                '#view_kotsalesdine tfoot td:nth-child(4)');

                            if (dinePaxTotal > 0) {

                                $paxCells.show();

                            } else {

                                $paxCells.hide();

                            }

                        }

                    }



                    // Call callback if provided

                    if (typeof callback === 'function') {

                        callback();

                    }

                } else {

                    PosnicPro.alert(response.type, response.message);

                }

            }, function (xhr) {

                loader.find(".loadingSpinner:first").remove();

                var res = jQuery.parseJSON(xhr.responseText);

                PosnicPro.alert(res.type, res.message);

            });



        } else {

            $(".kot_branch_value").focus();

        }

    },



    exportSalesSummary: function (index) {

        var type = $(index).data('id');

        var table = $('#view_kotsalessummary');

        var originalPage = table.data('current_page') || 1;

        var originalPerPage = table.data('per_page') || 5;



        // Enable export-all mode and reset to first page

        table.data('export_all', true);

        table.data('current_page', 1);



        // Use callback to ensure data is loaded before export

        PosnicPro.kotitemreport.salesSummaryTable(function () {

            // Export CSV after all data is loaded

            PosnicPro.kotitemreport.exportSalesSummaryToCSV();



            // Restore original pagination and disable export-all mode

            setTimeout(function () {

                table.data('export_all', false);

                table.data('current_page', originalPage);

                table.data('per_page', originalPerPage);

                PosnicPro.kotitemreport.salesSummaryTable();

            }, 100);

        });

    },



    exportSalesSummaryToCSV: function () {

        // Prepend UTF-8 BOM so Excel correctly renders Unicode currency symbols

        // First section column order: Table No, Qty, Amount, Discount, Tax, Extra Discount, Pax, Total Amount

        var csv = '\uFEFFTable No,Qty,Amount,Discount,Tax,Extra Discount,Pax,Total Amount\n';

        var currency = PosnicPro.local.get('currencySign') || '';



        // Basic CSV escaping to keep columns aligned when values contain commas or quotes

        var escapeCsv = function (value) {

            if (value === null || typeof value === 'undefined') {

                return '';

            }

            var str = String(value);

            if (str.indexOf('"') !== -1) {

                str = str.replace(/"/g, '""');

            }

            if (/[",\n\r]/.test(str)) {

                str = '"' + str + '"';

            }

            return str;

        };



        // ---------------- Main KOT Sales Summary rows ----------------

        var rows = [];

        $('#view_kotsalessummary tbody tr').each(function () {

            var cells = $(this).find('td');

            // Main data rows have expand cell + 9 data cells (total 10)

            if (cells.length >= 10) {

                // Skip summary row (identified by empty serial column in second cell)

                var serial = $(cells[1]).text().trim();

                if (!serial) {

                    return;

                }



                // Match the display order: [expand], #, Table No, Qty, Amount, Discount, Tax, Extra Discount, Pax, Total Amount

                var tableNo = $(cells[2]).text().trim();

                var qty = $(cells[3]).text().trim();

                var amountWithoutTax = $(cells[4]).text().trim().replace(currency, '').replace(/\s/g, '');

                var discount = $(cells[5]).text().trim().replace(currency, '').replace(/\s/g, '');

                var tax = $(cells[6]).text().trim().replace(currency, '').replace(/\s/g, '');

                var extraDiscount = $(cells[7]).text().trim().replace(currency, '').replace(/\s/g, '');

                var pax = $(cells[8]).text().trim();

                var totalWithTax = $(cells[9]).text().trim().replace(currency, '').replace(/\s/g, '');



                rows.push({

                    tableNo: tableNo,

                    qty: qty,

                    amountWithoutTax: amountWithoutTax,

                    discount: discount,

                    tax: tax,

                    extraDiscount: extraDiscount,

                    pax: pax,

                    totalWithTax: totalWithTax

                });

            }

        });



        $.each(rows, function (i, row) {

            csv += escapeCsv(row.tableNo) + ',';

            csv += escapeCsv(row.qty) + ',';

            csv += escapeCsv(currency + ' ' + row.amountWithoutTax) + ',';

            csv += escapeCsv(currency + ' ' + row.discount) + ',';

            csv += escapeCsv(currency + ' ' + row.tax) + ',';

            csv += escapeCsv(currency + ' ' + row.extraDiscount) + ',';

            csv += escapeCsv(row.pax) + ',';

            csv += escapeCsv(currency + ' ' + row.totalWithTax) + '\n';

        });



        // Collect unique table numbers for details export

        var tableNos = [];

        var tableNoMap = {};

        $.each(rows, function (i, row) {

            var key = (row.tableNo || '').toString();

            if (key && !tableNoMap[key]) {

                tableNoMap[key] = true;

                tableNos.push(key);

            }

        });



        // Pre-read Tender and Dine Type summary rows; these will be appended

        // after the Details section (if any).

        var tenderRows = [];

        $('#view_kotsalestender tbody tr').each(function () {

            var cells = $(this).find('td');

            if (cells.length >= 3) {

                var sno = $(cells[0]).text().trim();

                var tenderType = $(cells[1]).text().trim();

                var amount = $(cells[2]).text().trim().replace(currency, '').replace(/\s/g, '');



                if (!sno && !tenderType && !amount) {

                    return;

                }



                tenderRows.push({

                    sno: sno,

                    tenderType: tenderType,

                    amount: amount

                });

            }

        });



        var dineRows = [];

        $('#view_kotsalesdine tbody tr').each(function () {

            var cells = $(this).find('td');

            if (cells.length >= 5) {

                var sno = $(cells[0]).text().trim();

                var dineType = $(cells[1]).text().trim();

                var count = $(cells[2]).text().trim();

                var pax = $(cells[3]).text().trim();

                var amount = $(cells[4]).text().trim().replace(currency, '').replace(/\s/g, '');



                if (!sno && !dineType && !count && !pax && !amount) {

                    return;

                }



                dineRows.push({

                    sno: sno,

                    dineType: dineType,

                    count: count,

                    pax: pax,

                    amount: amount

                });

            }

        });



        var dineCountTotalSpan = $('#view_kotsalesdine_count_total').text().trim();

        var dinePaxTotalSpan = $('#view_kotsalesdine_pax_total').text().trim();

        var dineAmountTotalSpan = $('#view_kotsalesdine_amount_total').text().trim();

        var tenderTotalSpan = $('#view_kotsalestender_total').text().trim();



        // Helper to append Tender and Dine Type sections to the CSV

        var appendTenderAndDineSections = function () {

            if (tenderRows.length > 0) {

                // Blank line to separate sections

                csv += '\n';

                // Header for Tender Summary section

                csv += 'S.No,Tender Type,Amount\n';



                $.each(tenderRows, function (i, row) {

                    csv += escapeCsv(row.sno) + ',';

                    csv += escapeCsv(row.tenderType) + ',';

                    csv += escapeCsv(currency + ' ' + row.amount) + '\n';

                });



                // Append total row from footer span if available

                if (tenderTotalSpan) {

                    var totalAmount = tenderTotalSpan.replace(currency, '').replace(/\s/g, '');

                    csv += ',Total,' + escapeCsv(currency + ' ' + totalAmount) + '\n';

                }

            }



            if (dineRows.length > 0) {

                // Blank line to separate sections

                csv += '\n';

                // Header for Dine Type Summary section

                csv += 'S.No,Dine Type,Count,Pax,Amount\n';



                $.each(dineRows, function (i, row) {

                    csv += escapeCsv(row.sno) + ',';

                    csv += escapeCsv(row.dineType) + ',';

                    csv += escapeCsv(row.count) + ',';

                    csv += escapeCsv(row.pax) + ',';

                    csv += escapeCsv(currency + ' ' + row.amount) + '\n';

                });



                // Append total row from footer spans if available

                if (dineCountTotalSpan || dinePaxTotalSpan || dineAmountTotalSpan) {

                    var dineTotalAmount = dineAmountTotalSpan.replace(currency, '').replace(/\s/g, '');

                    csv += ',Total,' + escapeCsv(dineCountTotalSpan) + ',' + escapeCsv(dinePaxTotalSpan) + ',' + escapeCsv(currency + ' ' + dineTotalAmount) + '\n';

                }

            }

        };



        // ---------------- Details Section (expanded inner table) ----------------

        // We fetch item-level details for each table using the same

        // kotTablewiseDetails API that powers the on-screen expansion.



        // Determine date range and branch based on current KOT filter

        var branchVal = $(".kot_branch_value").val() || [];

        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                branchVal = [fallbackBranch];

            }

        }



        var daterange = $(".view_kot_report_daterange").val();

        var fields = (daterange || '').split('-');

        var startingDate = (fields[0] || '').trim();

        var endingDate = (fields[1] || '').trim();



        var hasDetailsHeader = false;



        var finalizeAndDownload = function () {

            // After details (if any), append Tender and Dine summaries

            appendTenderAndDineSections();



            var blob = new Blob([csv], { type: 'text/csv' });

            var link = document.createElement('a');

            link.href = window.URL.createObjectURL(blob);

            link.download = 'KOT_Sales_Summary_' + moment().format('YYYY-MM-DD') + '.csv';

            link.click();

        };



        // If we cannot determine branch or there are no table rows, just

        // append Tender/Dine sections and finish.

        if (!branchVal || branchVal.length === 0 || !branchVal[0] || tableNos.length === 0) {

            appendTenderAndDineSections();

            var blobNoDetails = new Blob([csv], { type: 'text/csv' });

            var linkNoDetails = document.createElement('a');

            linkNoDetails.href = window.URL.createObjectURL(blobNoDetails);

            linkNoDetails.download = 'KOT_Sales_Summary_' + moment().format('YYYY-MM-DD') + '.csv';

            linkNoDetails.click();

            return;

        }



        var branchId = branchVal[0];



        var processNextTable = function (index) {

            if (index >= tableNos.length) {

                finalizeAndDownload();

                return;

            }



            var tableNumber = tableNos[index];



            // Look up the payment summary HTML that we already rendered for

            // this table and convert it to plain text for CSV.

            var paymentHtml = '';

            var $paymentSource = $('.kotsales-details-items-container[data-table-number="' + tableNumber + '"]').first();

            if ($paymentSource.length) {

                paymentHtml = $paymentSource.data('payment-html') || '';

            }

            var paymentText = paymentHtml

                .replace(/<br\s*\/?\s*>/gi, ' | ')

                .replace(/\s+/g, ' ')

                .trim();



            var detailParams = {

                url: 'sales/kotTablewiseDetails',

                data: {

                    starting_date: startingDate,

                    ending_date: endingDate,

                    branch: branchId,

                    'tables': [tableNumber]

                }

            };



            PosnicPro.get(detailParams, function (detailRes) {

                if (detailRes.type === 'success') {

                    var detailData = (detailRes.data && detailRes.data.list) ? detailRes.data.list : [];

                    if (detailData && detailData.length > 0) {

                        if (!hasDetailsHeader) {

                            // Blank line then Details section header

                            csv += '\n';

                            csv += 'Table No,S.No,Date,Sale ID,Item Name,Qty,Amount,Discount,Tax,Extra Discount,Pax,Payment Type,Total Amount\n';

                            hasDetailsHeader = true;

                        }



                        var lastSaleIdForDetails = null;

                        for (var di = 0; di < detailData.length; di++) {

                            var dr = detailData[di] || {};



                            var saleId = dr.sales_id || '';

                            var isFirstRowForSale = saleId && saleId !== lastSaleIdForDetails;

                            if (isFirstRowForSale) {

                                lastSaleIdForDetails = saleId;

                            }



                            var snoCell = isFirstRowForSale ? (di + 1) : '';

                            var dateCell = isFirstRowForSale ? (dr.string_date || '') : '';

                            var saleIdCell = isFirstRowForSale ? saleId : '';

                            var itemName = dr.item_name || '';



                            var qtyVal = parseFloat(dr.qty);

                            if (!isFinite(qtyVal)) { qtyVal = 0; }



                            var amountVal = parseFloat(dr.amount);

                            if (!isFinite(amountVal)) { amountVal = 0; }



                            var taxVal = parseFloat(dr.tax);

                            if (!isFinite(taxVal)) { taxVal = 0; }



                            var discVal = parseFloat(dr.discount);

                            if (!isFinite(discVal)) { discVal = 0; }



                            var extraDiscVal = parseFloat(dr.extra_discount);

                            if (!isFinite(extraDiscVal)) { extraDiscVal = 0; }



                            var totalVal = parseFloat(dr.total);

                            if (!isFinite(totalVal)) { totalVal = 0; }



                            var paxRaw = parseInt(dr.pax, 10);

                            var paxCell = (isFinite(paxRaw) && paxRaw > 0) ? paxRaw : '';



                            var paymentCell = isFirstRowForSale ? paymentText : '';



                            csv += escapeCsv(tableNumber) + ',';

                            csv += escapeCsv(snoCell) + ',';

                            csv += escapeCsv(dateCell) + ',';

                            csv += escapeCsv(saleIdCell) + ',';

                            csv += escapeCsv(itemName) + ',';

                            csv += escapeCsv(qtyVal) + ',';

                            csv += escapeCsv(currency + ' ' + amountVal.toFixed(2)) + ',';

                            csv += escapeCsv(currency + ' ' + discVal.toFixed(2)) + ',';

                            csv += escapeCsv(currency + ' ' + taxVal.toFixed(2)) + ',';

                            csv += escapeCsv(currency + ' ' + extraDiscVal.toFixed(2)) + ',';

                            csv += escapeCsv(paxCell) + ',';

                            csv += escapeCsv(paymentCell) + ',';

                            csv += escapeCsv(currency + ' ' + totalVal.toFixed(2)) + '\n';

                        }

                    }

                }



                // Move on to the next table even if this one failed

                processNextTable(index + 1);

            }, function () {

                // On error, skip details for this table and continue

                processNextTable(index + 1);

            });

        };



        // Start fetching details sequentially per table

        processNextTable(0);

    },



    kotSalesSummaryPdf: function () {

        // Branch: use currently selected KOT branch, falling back to default branch

        var branches = ($('.kot_branch_value').val() || []);

        var branchId = '';

        if (branches && branches.length > 0 && branches[0] !== '') {

            branchId = String(branches[0]);

        } else if (PosnicPro.local && typeof PosnicPro.local.get === 'function') {

            branchId = PosnicPro.local.get('branch_id_set') || '';

        }



        if (!branchId) {

            $('.kot_branch_value').focus();

            return false;

        }



        // Date range: use the same raw value that drives the on-screen

        // KOT Sales Summary table so that UI and PDF always use identical

        // filters. Only fall back to the tooltip text if the input is

        // empty (for older themes or edge cases).

        var rawRange = ($('.view_kot_report_daterange').val() || '').trim();

        var daterangeText = rawRange;

        if (!daterangeText) {

            daterangeText = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title') || '';

        }



        // Label like "Today" / "All Time" for the PDF type parameter

        var typeLabel = $('#view_kot_report_daterange span span:first').text() || '';

        typeLabel = $.trim(typeLabel);



        var fields = daterangeText.split(' - ');

        if (fields.length !== 2) {

            fields = daterangeText.split('-');

        }



        var startingDate = (fields[0] || '').replace(/\//g, '/').trim();

        var endingDate = (fields[1] || '').replace(/\//g, '/').trim();



        if (!startingDate || !endingDate) {

            PosnicPro.alert('error', 'Select a valid date range');

            return false;

        }



        // Reuse the existing dailyReportPdf backend endpoint so that

        // KOT Sales Summary can download the same style PDF report.

        var url = API_URL +

            'sales/dailyReportPdf?branch=' + encodeURIComponent(branchId) +

            '&type=' + encodeURIComponent(typeLabel) +

            '&starting_date=' + encodeURIComponent(startingDate) +

            '&ending_date=' + encodeURIComponent(endingDate) +

            '&source=kot';



        // Instead of just opening the PDF in a new tab, load it into a

        // hidden iframe and trigger the browser's print dialog directly.

        // This follows the same pattern as other print flows in the app

        // (e.g. registers.js), but uses the PDF URL as the iframe src.

        var iframeId = 'kot_sales_summary_print_iframe';

        var $iframe = $('#' + iframeId);

        if ($iframe.length === 0) {

            $iframe = $('<iframe />', {

                id: iframeId,

                name: iframeId,

                css: {

                    position: 'absolute',

                    top: '-1000000px',

                    left: '-1000000px',

                    width: 0,

                    height: 0,

                    border: 0

                }

            });

            $('body').append($iframe);

        }



        // Ensure we don't stack multiple load handlers

        $iframe.off('load.kotSalesSummaryPrint').on('load.kotSalesSummaryPrint', function () {

            try {

                var frameWindow = this.contentWindow || this;

                frameWindow.focus();

                frameWindow.print();

            } catch (e) {

                // Fallback: if anything goes wrong, open the PDF in a new tab.

                window.open(url, '_blank');

            }

        });



        // Setting the src will start loading the PDF and eventually fire the

        // load event above, which triggers print.

        $iframe.attr('src', url);

    },



    kotSalesSummaryPdfSummary: function () {

        // Branch: use currently selected KOT branch, falling back to default branch

        var branches = ($('.kot_branch_value').val() || []);

        var branchId = '';

        if (branches && branches.length > 0 && branches[0] !== '') {

            branchId = String(branches[0]);

        } else if (PosnicPro.local && typeof PosnicPro.local.get === 'function') {

            branchId = PosnicPro.local.get('branch_id_set') || '';

        }



        if (!branchId) {

            $('.kot_branch_value').focus();

            return false;

        }



        // Date range: use the same raw value that drives the on-screen

        // KOT Sales Summary table so that UI and PDF always use identical

        // filters.

        var rawRange = ($('.view_kot_report_daterange').val() || '').trim();

        var daterangeText = rawRange;

        if (!daterangeText) {

            daterangeText = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title') || '';

        }



        // Label like "Today" / "All Time" for the PDF type parameter

        var typeLabel = $('#view_kot_report_daterange span span:first').text() || '';

        typeLabel = $.trim(typeLabel);



        var fields = daterangeText.split(' - ');

        if (fields.length !== 2) {

            fields = daterangeText.split('-');

        }



        var startingDate = (fields[0] || '').replace(/\//g, '/').trim();

        var endingDate = (fields[1] || '').replace(/\//g, '/').trim();



        if (!startingDate || !endingDate) {

            PosnicPro.alert('error', 'Select a valid date range');

            return false;

        }



        // Use the same endpoint but add summary_mode=1 parameter

        var url = API_URL +

            'sales/dailyReportPdf?branch=' + encodeURIComponent(branchId) +

            '&type=' + encodeURIComponent(typeLabel) +

            '&starting_date=' + encodeURIComponent(startingDate) +

            '&ending_date=' + encodeURIComponent(endingDate) +

            '&source=kot' +

            '&summary_mode=1';



        // Load PDF into hidden iframe and trigger print

        var iframeId = 'kot_sales_summary_print_iframe';

        var $iframe = $('#' + iframeId);

        if ($iframe.length === 0) {

            $iframe = $('<iframe />', {

                id: iframeId,

                name: iframeId,

                css: {

                    position: 'absolute',

                    top: '-1000000px',

                    left: '-1000000px',

                    width: 0,

                    height: 0,

                    border: 0

                }

            });

            $('body').append($iframe);

        }



        // Ensure we don't stack multiple load handlers

        $iframe.off('load.kotSalesSummaryPrint').on('load.kotSalesSummaryPrint', function () {

            try {

                var frameWindow = this.contentWindow || this;

                frameWindow.focus();

                frameWindow.print();

            } catch (e) {

                // Fallback: if anything goes wrong, open the PDF in a new tab.

                window.open(url, '_blank');

            }

        });



        // Setting the src will start loading the PDF and eventually fire the

        // load event above, which triggers print.

        $iframe.attr('src', url);

    },



    cancellationSummaryTable: function (callback) {

        var branchVal = $(".kot_branch_value").val() || [];

        if (!branchVal || branchVal.length === 0 || branchVal[0] === '') {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                branchVal = [fallbackBranch];

            }

        }

        if (branchVal && branchVal.length > 0 && branchVal[0] !== '') {

            var loader = $(".loader-kot-cancellation");

            loader.find(".loadingSpinner:first").remove();

            $("<div class='loadingSpinner'></div>").appendTo(loader);



            var daterange = $(".view_kot_report_daterange").val();

            var fields = (daterange || '').split('-');



            var table = $('#view_kotcancellation');

            var current_page = table.data('current_page') || 1;

            var exportAll = table.data('export_all') === true;

            // Always prefer the current dropdown selection for page size,

            // falling back to the stored value or default of 5.

            var per_page = parseInt($('#view_kotcancellation_per_page').val(), 10) || table.data('per_page') || 5;



            var data = {

                starting_date: (fields[0] || '').trim(),

                ending_date: (fields[1] || '').trim(),

                branch: branchVal[0]

            };



            var params = { url: 'sales/dailySalesReports', data: data };



            PosnicPro.get(params, function (response) {

                loader.find(".loadingSpinner:first").remove();



                if (response.type === 'success') {

                    table.children('tbody').text('');



                    var cancellationSummary = response.data.cancellation_summary || [];

                    var total = cancellationSummary.length;



                    // In export-all mode, override pagination so that all

                    // cancellation rows are included on a single page.

                    if (exportAll) {

                        current_page = 1;

                        per_page = total || per_page;

                    }



                    var total_pages = Math.ceil(total / per_page);



                    // Store pagination data

                    table.data('total', total);

                    table.data('total_pages', total_pages);

                    table.data('current_page', current_page);

                    table.data('per_page', per_page);



                    // Update paging UI

                    if (typeof PosnicPro.paging === 'function') {

                        PosnicPro.paging(total_pages, current_page);

                    }



                    if (total === 0) {

                        var kotCancelDateTooltip = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title');

                        var kotCancelDateValue = $('.view_kot_report_daterange').val();

                        var kotCancelDateText = kotCancelDateTooltip || kotCancelDateValue || '';

                        var cancelMsg = kotCancelDateText ? ('No Cancellations on ' + kotCancelDateText) : 'No Cancellations';



                        $('.kotcancellation_norecord').empty().append('<div class="text-center text-dark"><p>' + cancelMsg + '</p></div>');

                        $('#kotcancellation_img_hide,.kotcancellation_norecord').show();

                        $('.kotcancellation_header').hide();

                        table.hide();



                        $('#view_kotcancellation_page_total').text(0);

                        $('#view_kotcancellation_page_perpage_total').text(0);

                        $('#view_kotcancellation_total').text(0);

                    } else {

                        $('.kotcancellation_norecord').empty();

                        $('#kotcancellation_img_hide,.kotcancellation_norecord').hide();

                        $('.kotcancellation_header').show();

                        table.show();



                        // Calculate pagination range

                        var startIndex = (current_page - 1) * per_page + 1;

                        var endIndex = Math.min(startIndex + per_page - 1, total);



                        // Update pagination display

                        $('#view_kotcancellation_page_total').text(startIndex);

                        $('#view_kotcancellation_page_perpage_total').text(endIndex);

                        $('#view_kotcancellation_total').text(total);



                        // Render paginated data

                        var paginatedData = cancellationSummary.slice(startIndex - 1, endIndex);



                        for (var i = 0; i < paginatedData.length; i++) {

                            var row = paginatedData[i];

                            var row_no = startIndex + i;



                            var currencySign = PosnicPro.local.get('currencySign') || '';



                            var trow =

                                '<tr>' +

                                '<td>' + row_no + '</td>' +

                                '<td>' + (row.table_number || '') + '</td>' +

                                '<td>' + (row.item_name || '') + '</td>' +

                                '<td class="text-center">' + (row.cancel_count || 0) + '</td>' +

                                '<td class="text-right">' + currencySign + ' ' + (row.cancel_amount || 0).toFixed(2) + '</td>' +

                                '</tr>';



                            table.children('tbody').append(trow);

                        }

                    }



                    // Call callback if provided

                    if (typeof callback === 'function') {

                        callback();

                    }

                } else {

                    PosnicPro.alert(response.type, response.message);

                }

            }, function (xhr) {

                loader.find(".loadingSpinner:first").remove();

                var res = jQuery.parseJSON(xhr.responseText);

                PosnicPro.alert(res.type, res.message);

            });



        } else {

            $(".kot_branch_value").focus();

        }

    },



    exportCancellation: function (index) {

        var type = $(index).data('id');

        var table = $('#view_kotcancellation');

        var originalPage = table.data('current_page') || 1;

        var originalPerPage = table.data('per_page') || 5;

        var originalExportAll = table.data('export_all') === true;



        // Enable export-all mode and reset to first page so that

        // cancellationSummaryTable renders all rows on a single page.

        table.data('export_all', true);

        table.data('current_page', 1);



        // Use callback to ensure data is loaded before export

        PosnicPro.kotitemreport.cancellationSummaryTable(function () {

            // Export CSV after all data is loaded

            PosnicPro.kotitemreport.exportCancellationToCSV();



            // Restore original pagination and export-all flag

            setTimeout(function () {

                table.data('export_all', originalExportAll);

                table.data('current_page', originalPage);

                table.data('per_page', originalPerPage);

                PosnicPro.kotitemreport.cancellationSummaryTable();

            }, 100);

        });

    },



    exportCancellationToCSV: function () {

        var csv = 'Table No,Item Name,Cancel Count,Cancel Amount\n';

        var currency = PosnicPro.local.get('currencySign') || '';



        var rows = [];

        $('#view_kotcancellation tbody tr').each(function () {

            var cells = $(this).find('td');

            if (cells.length >= 5) {

                var tableNo = $(cells[1]).text().trim();

                var itemName = $(cells[2]).text().trim();

                var cancelCount = $(cells[3]).text().trim();

                var cancelAmount = $(cells[4]).text().trim().replace(currency, '').replace(/\s/g, '');



                rows.push({

                    tableNo: tableNo,

                    itemName: itemName,

                    cancelCount: cancelCount,

                    cancelAmount: cancelAmount

                });

            }

        });



        $.each(rows, function (i, row) {

            csv += row.tableNo + ',';

            csv += row.itemName + ',';

            csv += row.cancelCount + ',';

            csv += currency + ' ' + row.cancelAmount + '\n';

        });



        var blob = new Blob([csv], { type: 'text/csv' });

        var link = document.createElement('a');

        link.href = window.URL.createObjectURL(blob);

        link.download = 'KOT_Cancellation_Report_' + moment().format('YYYY-MM-DD') + '.csv';

        link.click();

    }

};



PosnicPro.kotopenitemreport = {

    kotopenitemreportTable: function (type) {

        var selectedBranches = $(".kot_branch_value").val() || [];

        var branchIdStr = selectedBranches.toString();

        if (!branchIdStr) {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                selectedBranches = [fallbackBranch];

                branchIdStr = fallbackBranch;

            }

        }

        if (branchIdStr === '') {

            $(".kot_branch_value").focus();

            return;

        }



        var loader = $(".loader-kot-openitem-report");

        loader.find(".loadingSpinner:first").remove();

        $("<div class='loadingSpinner'></div>").appendTo(loader);



        var daterange = $(".view_kot_report_daterange").val();

        var fields = (daterange || '').split('-');



        var table = $('#view_kotopenitemreport');



        var current_page, per_page;

        current_page = table.data('current_page') || 1;

        per_page = parseInt($('#view_kotopenitemreport_per_page option:selected').text());



        var data = {

            page: current_page,

            limit: per_page,

            starting_date: (fields[0] || '').trim(),

            ending_date: (fields[1] || '').trim(),

            branch: selectedBranches

        };



        var params = { url: 'sales/instantSalesReports', data: data };



        PosnicPro.get(params, function (response) {

            if (response.type !== 'success') {

                loader.find(".loadingSpinner:first").remove();

                PosnicPro.alert(response.type, response.message);

                return;

            }



            table.data('total', response.data.total);

            table.data('total_pages', response.data.total_pages);

            table.data('current_page', response.data.current_page);

            table.data('per_page', response.data.per_page);



            PosnicPro.paging(response.data.total_pages, response.data.current_page);



            $('#view_kotopenitemreport_total').text(response.data.total);



            table.children('tbody').text('');



            var instantItems = response.data.list || [];



            if (instantItems.length === 0) {

                var kotOpenDateTooltip = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title');

                var kotOpenDateValue = $('.view_kot_report_daterange').val();

                var kotOpenDateText = kotOpenDateTooltip || kotOpenDateValue || '';

                var kotOpenMsg = kotOpenDateText ? ('No Open Items on ' + kotOpenDateText) : 'No Open Items';



                table.hide();

                $('.kotopenitemreport_header').hide();

                $('.kotopenitemreport_norecord').empty().append('<div class="text-center text-dark"><p>' + kotOpenMsg + '</p></div>');

                $('#kotopenitemreport_img_hide,.kotopenitemreport_norecord').show();



                $('#view_kotopenitemreport_page_total').text(0);

                $('#view_kotopenitemreport_page_perpage_total').text(0);

                $('#view_kotopenitemreport_total').text(0);



                loader.find(".loadingSpinner:first").remove();

                return;

            }



            // When data is present, ensure table and headers are visible and nodata blocks are hidden

            table.show();

            $('.kotopenitemreport_header').show();

            $('.kotopenitemreport_norecord').empty();

            $('#kotopenitemreport_img_hide,.kotopenitemreport_norecord').hide();



            var row_start = (table.data('current_page') - 1) * table.data('per_page') + 1;

            $('#view_kotopenitemreport_page_total').text(row_start);



            var page_totals = (table.data('current_page') - 1) * table.data('per_page');

            $('#view_kotopenitemreport_page_perpage_total').text(page_totals + instantItems.length);



            var currency = PosnicPro.local.get('currencySign');



            // Render instant items directly from backend response

            for (var i = 0; i < instantItems.length; i++) {

                var item = instantItems[i];

                var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;



                var trow =

                    '<tr>' +

                    '<td>' + row_no + '</td>' +

                    '<td>' + (item.item_name || '') + '</td>' +

                    '<td class="text-center">' + (item.item_quantity || 0) + '</td>' +

                    '<td class="text-right">' + currency + '&nbsp;<span class="number">' + (item.total_amount || 0) + '</span></td>' +

                    '</tr>';



                table.children('tbody').append(trow);

            }



            $('span.number').number(true, 2);

            loader.find(".loadingSpinner:first").remove();



        }, function (xhr) {

            loader.find(".loadingSpinner:first").remove();

            var res = jQuery.parseJSON(xhr.responseText);

            PosnicPro.alert(res.type, res.message);

        });

    },



    itemTableTabClick: function () {

        $('.kot_table_filter_container').hide();



        var table = $('#view_kotopenitemreport');

        table.data('current_page', 1);

        PosnicPro.kotopenitemreport.kotopenitemreportTable();

    },



    exportOpenItem: function (index) {

        var type = $(index).data('id');

        var table = $('#view_kotopenitemreport');

        var originalPage = table.data('current_page') || 1;

        var originalPerPage = table.data('per_page') || 5;

        var totalRecords = table.data('total') || 0;



        if (totalRecords === 0) {

            PosnicPro.alert('info', 'No records to export');

            return;

        }



        // Fetch all data for export

        var branchId = $(".kot_branch_value").val();

        var daterange = $(".view_kot_report_daterange").val();

        var fields = (daterange || '').split('-');



        var data = {

            page: 1,

            limit: totalRecords,

            starting_date: (fields[0] || '').trim(),

            ending_date: (fields[1] || '').trim(),

            branch: branchId

        };



        var params = { url: 'sales/instantSalesReports', data: data };



        PosnicPro.get(params, function (response) {

            if (response.type === 'success') {

                var allItems = response.data.list || [];

                PosnicPro.kotopenitemreport.exportOpenItemToCSV(allItems);



                // Restore original pagination

                setTimeout(function () {

                    table.data('current_page', originalPage);

                    table.data('per_page', originalPerPage);

                    PosnicPro.kotopenitemreport.kotopenitemreportTable();

                }, 100);

            } else {

                PosnicPro.alert(response.type, response.message);

            }

        }, function (xhr) {

            var res = jQuery.parseJSON(xhr.responseText);

            PosnicPro.alert(res.type, res.message);

        });

    },



    exportOpenItemToCSV: function (items) {

        var csv = 'Item Name,Quantity,Amount\n';

        var currency = PosnicPro.local.get('currencySign') || '';



        $.each(items, function (i, item) {

            csv += (item.item_name || '') + ',';

            csv += (item.item_quantity || 0) + ',';

            csv += currency + ' ' + (item.total_amount || 0) + '\n';

        });



        var blob = new Blob([csv], { type: 'text/csv' });

        var link = document.createElement('a');

        link.href = window.URL.createObjectURL(blob);

        link.download = 'KOT_Open_Item_' + moment().format('YYYY-MM-DD') + '.csv';

        link.click();

    }

};



PosnicPro.kotdiscountreport = {

    kotdiscountreportTable: function (type) {

        var selectedBranches = ($('.kot_branch_value').val() || []);

        var branchIdStr = selectedBranches.toString();

        if (!branchIdStr) {

            var fallbackBranch = (PosnicPro.local && typeof PosnicPro.local.get === 'function') ? (PosnicPro.local.get('branch_id_set') || '') : '';

            if (fallbackBranch) {

                selectedBranches = [fallbackBranch];

                branchIdStr = fallbackBranch;

            }

        }

        if (branchIdStr !== '') {

            var loader = $('.loader-kot-discount-report');

            loader.find('.loadingSpinner:first').remove();

            $("<div class='loadingSpinner'></div>").appendTo(loader);



            var daterange = String($('.view_kot_report_daterange').val() || '');

            var fields = daterange.split('-');



            var table = $('#view_kotdiscountreport');



            var current_page, per_page;

            if (type === 'kotdiscountreportexport') {

                per_page = table.data('total') || 0;

                current_page = 1;

            } else {

                current_page = table.data('current_page') || 1;

                per_page = parseInt($('#view_kotdiscountreport_per_page option:selected').text(), 10) || 5;

            }



            var data = {

                page: current_page,

                limit: per_page,

                starting_date: (fields[0] || '').trim(),

                ending_date: (fields[1] || '').trim(),

                branch: selectedBranches

            };



            var params = { url: 'sales/kotDiscountReports', data: data };



            PosnicPro.get(params, function (response) {

                loader.find('.loadingSpinner:first').remove();



                if (response.type === 'success') {

                    var d = response.data || {};

                    table.data('total', d.total || 0);

                    table.data('total_pages', d.total_pages || 0);

                    table.data('current_page', d.current_page || 1);

                    table.data('per_page', d.per_page || per_page);



                    if (typeof PosnicPro.paging === 'function') {

                        PosnicPro.paging(table.data('total_pages'), table.data('current_page'));

                    }



                    table.children('tbody').text('');



                    var rowTotal = d.total || 0;



                    if (rowTotal === 0) {

                        var kotDiscDateTooltip = $('#view_kot_report_daterange span span[data-toggle="tooltip"]').attr('data-original-title');

                        var kotDiscDateValue = $('.view_kot_report_daterange').val();

                        var kotDiscDateText = kotDiscDateTooltip || kotDiscDateValue || '';

                        var kotDiscMsg = kotDiscDateText ? ('No Discounts on ' + kotDiscDateText) : 'No Discounts';



                        $('.kotdiscountreport_norecord').empty().append('<div class="text-center text-dark"><p>' + kotDiscMsg + '</p></div>');

                        $('#kotdiscountreport_img_hide,.kotdiscountreport_norecord').show();

                        $('.kotdiscount_header').hide();

                        table.hide();



                        $('#view_kotdiscountreport_total').text(0);

                        $('#view_kotdiscountreport_total_bills').text(0);

                        $('#view_kotdiscountreport_page_total').text(0);

                        $('#view_kotdiscountreport_page_perpage_total').text(0);

                        $('#view_kotdiscountreport_discount_sum').text('');

                        return;

                    }



                    // Data exists: show table/header and hide nodata blocks

                    $('.kotdiscountreport_norecord').empty();

                    $('#kotdiscountreport_img_hide,.kotdiscountreport_norecord').hide();

                    $('.kotdiscount_header').show();

                    table.show();



                    $('#view_kotdiscountreport_total').text(rowTotal);

                    $('#view_kotdiscountreport_total_bills').text(rowTotal);



                    var startIndex = 0;

                    var endIndex = 0;

                    if (rowTotal > 0) {

                        startIndex = (table.data('current_page') - 1) * table.data('per_page') + 1;

                        endIndex = startIndex + (Array.isArray(d.list) ? d.list.length : 0) - 1;

                    }



                    $('#view_kotdiscountreport_page_total').text(startIndex);

                    $('#view_kotdiscountreport_page_perpage_total').text(endIndex);



                    var list = d.list || [];

                    var currency = PosnicPro.local && PosnicPro.local.get ? (PosnicPro.local.get('currencySign') || '') : '';

                    var discountSum = 0;

                    

                    // Get totals from API response

                    var totals = d.totals || {};

                    var totalAmountSum = totals.total_amount || 0;

                    var totalDiscountSum = totals.total_discount_price || 0;

                    var totalNetAmountSum = totals.total_net_amount || 0;

                    var totalCount = totals.total_count || 0;



                    for (var i = 0; i < list.length; i++) {

                        var row = list[i] || {};

                        var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;



                        var kotNo = row.kot_no || row.sales_id || '';

                        var dateTime = row.string_date || '';

                        var tableNumber = row.table_number || '';



                        var discountAmount = row.total_discount || 0; // total discount in currency

                        var netAmount = row.net_amount || row.sales_total || 0;

                        var totalBefore = row.total_amount || (netAmount + discountAmount); // Use total_amount from API

                        var computedPct = totalBefore > 0 ? (discountAmount * 100 / totalBefore) : 0;



                        // Detect raw percentage from extra_discount fields when discount type is percent

                        var rawPercent = null;

                        if (row.extra_discount_type === 'percent') {

                            var pctVal;

                            if (typeof row.extra_discount_value !== 'undefined' && row.extra_discount_value !== null && row.extra_discount_value !== '') {

                                pctVal = row.extra_discount_value;

                            } else if (typeof row.extra_discount !== 'undefined' && row.extra_discount !== null && row.extra_discount !== '') {

                                pctVal = row.extra_discount;

                            }

                            if (typeof pctVal !== 'undefined') {

                                rawPercent = parseFloat(pctVal);

                            }

                        }



                        var hasItemPercent = parseInt(row.has_item_percent || 0, 10);

                        var hasPercent = (row.extra_discount_type === 'percent' && rawPercent !== null) || (hasItemPercent > 0);



                        // Show Discount Percentage only when sale used percentage discount (bill or item); otherwise '-'

                        var discountPctCell;

                        if (hasPercent) {

                            var displayPct = rawPercent !== null ? rawPercent : computedPct;

                            discountPctCell = '<td class="text-right"><span class="number">' + displayPct + '</span>%</td>';

                        } else {

                            discountPctCell = '<td class="text-right">-</td>';

                        }



                        // Show Discount (amount) only when sale used pure amount / item discounts (no percentage); otherwise '-'

                        var discountCell;

                        if (!hasPercent && discountAmount > 0) {

                            discountCell = '<td class="text-right">' + currency + '&nbsp;<span class="number">' + discountAmount + '</span></td>';

                        } else {

                            discountCell = '<td class="text-right">-</td>';

                        }



                        // Discount Price column: always show total discount in currency (combined item + bill)

                        var discountPriceCell = '<td class="text-right">' + currency + '&nbsp;<span class="number">' + discountAmount + '</span></td>';



                        var trow =

                            '<tr>' +

                            '<td>' + row_no + '</td>' +

                            '<td>' + kotNo + '</td>' +

                            '<td>' + dateTime + '</td>' +

                            '<td class="text-center">' + tableNumber + '</td>' +

                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + totalBefore + '</span></td>' +

                            discountPctCell +

                            discountCell +

                            discountPriceCell +

                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + netAmount + '</span></td>' +

                            '</tr>';



                        table.children('tbody').append(trow);

                        discountSum += discountAmount;

                    }



                    // Add summary rows with totals from API response

                    if (rowTotal > 0) {

                        var summaryRow =

                            '<tr class="font-weight-bold">' +

                            '<td colspan="4" class="text-right">Total</td>' +

                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + totalAmountSum.toFixed(2) + '</span></td>' +

                            '<td colspan="2"></td>' +

                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + totalDiscountSum.toFixed(2) + '</span></td>' +

                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + totalNetAmountSum.toFixed(2) + '</span></td>' +

                            '</tr>';



                        table.children('tbody').append(summaryRow);

                    }



                    var discountTotalText = '';

                    if (rowTotal > 0) {

                        var formattedSum = discountSum.toFixed(2);

                        discountTotalText = currency ? (currency + ' ' + formattedSum) : formattedSum;

                    }

                    $('#view_kotdiscountreport_discount_sum').text(discountTotalText);



                    if (typeof $('span.number').number === 'function') {

                        $('span.number').number(true, 2);

                    }



                    // If export type, trigger CSV export after data is rendered

                    if (type === 'kotdiscountreportexport') {

                        PosnicPro.kotdiscountreport.exportDiscountToCSV();

                    }

                } else {

                    PosnicPro.alert(response.type, response.message);

                }

            }, function (xhr) {

                loader.find('.loadingSpinner:first').remove();

                try {

                    var res = jQuery.parseJSON(xhr.responseText);

                    PosnicPro.alert(res.type, res.message);

                } catch (e) {

                    PosnicPro.alert('error', 'Unable to load KOT discount report');

                }

            });



        } else {

            $('.kot_branch_value').focus();

        }

    },



    exportDiscount: function (index) {

        var type = $(index).data('id');

        var table = $('#view_kotdiscountreport');

        var originalPage = table.data('current_page') || 1;

        var originalPerPage = table.data('per_page') || 5;



        // Load all data for export

        PosnicPro.kotdiscountreport.kotdiscountreportTable(type);



        // After export completes, restore original pagination

        setTimeout(function () {

            table.data('current_page', originalPage);

            table.data('per_page', originalPerPage);

            PosnicPro.kotdiscountreport.kotdiscountreportTable();

        }, 500);

    },



    exportDiscountToCSV: function () {

        var csv = 'ID,Date,Table,Total,Discount Percentage,Discount,Discount Price,Net Amount\n';

        var currency = PosnicPro.local && PosnicPro.local.get ? (PosnicPro.local.get('currencySign') || '') : '';



        var escapeCsv = function (value) {

            if (value === null || typeof value === 'undefined') {

                return '';

            }

            var str = String(value);

            if (str.indexOf('"') !== -1) {

                str = str.replace(/"/g, '""');

            }

            if (/[",\n\r]/.test(str)) {

                str = '"' + str + '"';

            }

            return str;

        };



        var rows = [];

        $('#view_kotdiscountreport tbody tr').each(function () {

            var cells = $(this).find('td');

            if (cells.length >= 9) {

                var serial = $(cells[0]).text().trim();

                // Skip summary rows which have empty serial column

                if (!serial) {

                    return;

                }



                var id = $(cells[1]).text().trim();

                var date = $(cells[2]).text().trim();

                var tableNo = $(cells[3]).text().trim();

                var total = $(cells[4]).text().trim();

                var discountPct = $(cells[5]).text().trim();

                var discount = $(cells[6]).text().trim();

                var discountPrice = $(cells[7]).text().trim();

                var netAmount = $(cells[8]).text().trim();



                rows.push({

                    id: id,

                    date: date,

                    tableNo: tableNo,

                    total: total,

                    discountPct: discountPct,

                    discount: discount,

                    discountPrice: discountPrice,

                    netAmount: netAmount

                });

            }

        });



        $.each(rows, function (i, row) {

            csv += escapeCsv(row.id) + ',';

            csv += escapeCsv(row.date) + ',';

            csv += escapeCsv(row.tableNo) + ',';

            csv += escapeCsv(row.total) + ',';

            csv += escapeCsv(row.discountPct) + ',';

            csv += escapeCsv(row.discount) + ',';

            csv += escapeCsv(row.discountPrice) + ',';

            csv += escapeCsv(row.netAmount) + '\n';

        });



        var blob = new Blob([csv], { type: 'text/csv' });

        var link = document.createElement('a');

        link.href = window.URL.createObjectURL(blob);

        link.download = 'KOT_Discount_Report_' + moment().format('YYYY-MM-DD') + '.csv';

        link.click();

    },



    discountTableTabClick: function () {

        $('.kot_table_filter_container').hide();

        var table = $('#view_kotdiscountreport');

        table.data('current_page', 1);

        PosnicPro.kotdiscountreport.kotdiscountreportTable();



    }

};

