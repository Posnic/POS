PosnicPro.taxreport = {
    showDataTablePage: function () {
        var loader = $(".loader-tax-sales-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#taxdiscountreport_new').show();
        $('#v-pills-report-tab,#viewtaxdiscountreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        PosnicPro.taxreport.taxreportTable();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#tax-line').css('filter', 'blur(2px)');
            $('#taxreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#tax_upgrade').show();
        } else {
            $('#tax-line').css('filter', 'none');
            $('#taxreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#tax_upgrade').hide();
        }
    },
    taxreportTable: function (type) {
        var branchId = $(".tax_sales_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-tax-sales-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('taxsalesreport');
            var daterange = $(".view_tax_sales_report_daterange").val();
            var fields = daterange.split('-');
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".tax_sales_branch_value").val()
            };
            var params = {
                url: 'sales/taxSalesReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var datas = response.data.tax_details;
                    var itemTaxDetails = [];
                    for (var m = 0; m < datas.length; m++) {
                        $(datas[m]._id.items).each(function (key, val) {
                            var tax = val.tax;
                            var tax_type = val.tax_type;
                            if (tax_type === 'exclusive') {
                                var price = val.item_price;
                            } else {
                                var price = val.item_price / ((tax / 100) + 1);
                            }
                            var discount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                            var discountSign = (val.item_discount > 0) ? currency : '%';

                            if (discountSign === '%') {
                                var priceAmount = (((price.toFixed(2)) * val.item_quantity) - (((price.toFixed(2)) * val.item_quantity) * (discount / 100)));
                            } else {
                                var priceAmount = (((price.toFixed(2)) * val.item_quantity) - (discount * val.item_quantity));
                            }

                            if ((typeof (val.tax_fields) != "undefined" && val.tax_fields !== null)) {
                                var taxItemLength = val.tax_fields.length;
                                for (var z = 0; z < taxItemLength; z++) {
                                    var taxItem = val.tax_fields[z];
                                    var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                                    itemTaxDetails.push({
                                        "tax_id": taxItem.tax_id.$oid,
                                        "tax_name": taxItem.tax_name,
                                        "tax_value": taxAmount
                                    });
                                }
                            } else if (val.tax_fields === null && val.tax > 0) {
                                var taxAmount = (priceAmount / 100) * val.tax;
                                let taxName = val.tax_name;
                                let hsn_id = taxName.slice(4);
                                itemTaxDetails.push({
                                    "tax_id": hsn_id,
                                    "tax_name": taxName,
                                    "tax_value": taxAmount
                                });
                            }

                        });
                    }
                    if (type !== 'taxreportexport') {

                        var taxItemData = PosnicPro.nestedTaxCalculation(itemTaxDetails);
                        $('#view_taxreport tbody').children("tr").remove();
                        var currency = PosnicPro.local.get('currencySign');
                        $(taxItemData).each(function (key, val) {
                            if ((val.amount).toFixed(2) > 0.00) {
                                var rowHTMLTaxLine = ' <tr> ' +
                                        '    <td>' + (key + 1) + '</td>' +
                                        '    <td class="text-left">' + val.tax_name + '</td>' +
                                        '    <td class="text-right">' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                                        '</tr>';
                            }
                            $('#view_taxreport tbody').append(rowHTMLTaxLine);
                            $('span.number').number(true, 2);
                        });
                        if (Array.isArray(datas) && datas.length) {
                            $('.reporttax_norecord').empty();
                            $('#reporttax_img_hide,.reporttax_norecord').hide();
                            $('.reporttax_header').show();
                            $('#taxreport_exportbtn').removeAttr('disabled');
                        } else {
                            $('.reporttax_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reporttax_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reporttax_img_hide,.reporttax_norecord').show();
                            $('#taxreport_exportbtn').attr('disabled', 'disabled');
                        }
                    } else {
                        var salestaxreport = [];
                        var taxItemData = PosnicPro.nestedTaxCalculation(itemTaxDetails);
                        $('#view_taxreport tbody').children("tr").remove();
                        var currency = PosnicPro.local.get('currencySign');
                        $(taxItemData).each(function (key, val) {
                            if ((val.amount).toFixed(2) > 0.00) {
                                let name = val.tax_name;
                                let amount = val.amount;
                                salestaxreport.push({TaxName: name, Amount: amount.toFixed(2)});
                            }
                        });
                        PosnicPro.JSONToCSVConvertor(salestaxreport, 'sales-tax-discount-reports', true);
                        PosnicPro.taxreport.taxreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".tax_sales_branch_value").focus();
        }
    },
    taxSalesReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.taxreport.taxreportTable(type);
    }
};

PosnicPro.taxroot = {
    viewPage: function () {
        PosnicPro.taxreport.taxreportTable();
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/taxreport') {
        var loader = $(".loader-tax-sales-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.taxreport.taxreportTable();
    }
});