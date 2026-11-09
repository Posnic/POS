PosnicPro.receivingreport = {
    showDataTablePage: function () {
        var host = $('#purchase-report-search');
        if (!host.find('.lf-search-bar').length) {
            var supplier = $('#purchase-report-supplier');
            PosnicPro.listFilter.reportPopup(host, $('#purchase-report-filters'), supplier, host.find('button'));
            function selectSupplier(id, name) {
                if (!id && supplier.val()) return;
                if (!id && !supplier.data('partyId')) return;
                supplier.data({partyId: id, partyLabel: name}).trigger('supplierSelected');
            }
            PosnicPro.listFilter.entityPicker(supplier, 'suppliers', selectSupplier);
            supplier.on('input', function () { if (!this.value) selectSupplier('', ''); });
        }
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
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#receiving-line, #receiving-graph-line').css('filter', 'blur(2px)');
            $('#receiving_upgrade').show();
        } else {
            $('#receiving-line, #receiving-graph-line').css('filter', 'none');
            $('#receiving_upgrade').hide();
        }
    },
    receivingreportTable: function () {
        PosnicPro.appendReportTableBody('receivingreport');
        var branchId = $(".receiving_branch_value").val().toString();
        $('#purchase-report-summary').prop('hidden', true);
        $('#receivingreport_new .report-export-bar button').prop('disabled', true);
        if (branchId !== '') {
            var loader = $(".loader-receiving-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            $("#Receiving_detailed_report_selecter").hide();
            $("#receivingexport").show();
            var daterange = $(".view_receiving_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_receivingreport');

            var current_page = table.data('current_page');
            var per_page = parseInt($('#view_receivingreport_per_page option:selected').text(), 10);

            var supplierLabel = $('#purchase-report-supplier').data('partyLabel') || 'All suppliers';
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".receiving_branch_value").val(),
                supplierId: $('#purchase-report-supplier').data('partyId'),
                sort: $('#purchase-report-sort').val()
            };
            var params = {
                url: 'receivings/receivingReportTable',
                data: data
            };
            var requestTag = (table.data('filterRequest') || 0) + 1;
            if (requestTag) table.data('filterRequest', requestTag);
            PosnicPro.get(params, function (response) {
                if (requestTag && table.data('filterRequest') !== requestTag) {
                    loader.find('.loadingSpinner:first').remove();
                    return;
                }
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var summary = response.data.summary;
                    var money = function (amount) { return PosnicPro.local.get('currencySign') + ' ' + $.number(amount, 2); };
                    var hasPayment = !summary.count || summary.count > summary.unknown;
                    var values = [supplierLabel,
                        summary.count, money(summary.purchased), hasPayment ? money(summary.paid) : '\u2014',
                        hasPayment ? money(summary.outstanding) : '\u2014', summary.unknown];
                    var summaryRow = $('#purchase-report-summary tbody tr').empty();
                    values.forEach(function (value) { $('<td>').text(value).appendTo(summaryRow); });
                    $('#purchase-report-summary').prop('hidden', false);
                    $('#receivingreport_new .report-export-bar button').prop('disabled', false);
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
                        let dateRange = daterange;
                        PosnicPro.renderNoRecords('.reportpurchase_norecord', 'No Records on ' + dateRange);
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
                        var trow = '<tr><td><i class="exploder"><span class="feather icon-plus-circle"></span></i></td> <td scope="row">' + row_no + '</td>  <td><a href="#/receivingreport/' + row._id + '" ><i data-toggle="tooltip" class="table_model_item mobile_tooltip" title="View Details" data-t-title="lang_view_details_2">' + row.receiving_id + '</i></a></td> <td class="export-date">' + updateDate + '</td> <td>' + row.supplier_name + '</td> <td class="text-right"><a class="sale_color" href="tel:' + row.supplier_phone + '">' + row.supplier_phone + '</a></td> <td class="export-total-item text-center">' + row.items.length + '</td> <td class="export-price text-right">' + currency + '&nbsp;<span class="number">' + row.items_total + '</span></td></tr><tr class="explode hide" data-export-skip><td style="background: #f9f8f8; display: none;" colspan="12"><table class="table table-striped" cellspacing="0" width="100%" id="receiving_report_' + row._id + '"><thead><tr><th><lang class="lang_item_name">Item name</lang></th><th class="text-center"><lang class="lang_sku_title">SKU</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th><th class="text-right"><lang class="lang_qty_title">Qty</lang></th><th class="text-right">Tax [%]</th><th class="text-right"><lang class="lang_total_title">Total</lang></th></tr></thead><tbody></tbody></table></td></tr>';
                        $('#view_receivingreport').children('tbody').append(trow);
                        for (var j = 0; j < row.items.length; j++) {
                            var val = row.items[j];

                            var taxRate = Number(val.tax ?? val.tax_rate ?? 0);

                            var tax_value = 0;

                            var tax_type = val.tax_type;
                            if (tax_type === 'exclusive') {
                                var price = val.item_price;
                            } else {
                                var price = val.item_price / ((taxRate / 100) + 1);
                            }

                            if (taxRate > 0) {
                                tax_value = taxRate + '% (' + ((price * val.item_quantity) * (taxRate / 100)).toFixed(2) + ')';
                            }
                            var lineitem = '<tr style="border: 1px solid wheat;"><td class="export-item-name">' + val.item_name + '</td><td class="export-item-barcode-id text-center">' + (val.barcode_id || val.sku || '&mdash;') + '</td><td class="export-item-price text-right">' + currency + '&nbsp;<span class="number">' + price + '</span></td><td class="export-item-qty text-right">' + val.item_quantity + '</td><td class="export-item-tax text-right">' + tax_value + '</td><td class="export-item-total text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span></td></tr>';
                            $("#receiving_report_" + row._id).children('tbody').append(lineitem);
                        }
                        $('span.number').number(true, 2);
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
    receivingTableTabClick: function () {
        $('#change_receiving_view').data('id', 'tableView');
        PosnicPro.receivingreport.receivingreportTable();
    }
};



PosnicPro.receivingroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.receivingreport.receivingreportTable();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/receivingreport') {
        var loader = $(".loader-receiving-report");
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

(function () {
    var pending;
    $(document).on('supplierSelected', '#purchase-report-supplier', reload).on('change', '#purchase-report-sort', reload);
    function reload() {
        $('#view_receiving_report_daterange').triggerHandler('reportPeriodChanged');
        $('#receivingreport_new .report-export-bar button').prop('disabled', true);
        clearTimeout(pending);
        pending=setTimeout(function(){
            if (!$('#receivingreport_new').is(':visible')) return;
            $('#view_receivingreport').data('current_page',1);
            PosnicPro.receivingreport.receivingreportTable();
        },220);
    }
})();
