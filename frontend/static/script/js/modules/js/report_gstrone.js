PosnicPro.gstrOne = {
    /*
     * GSTR-1 export for the government offline tool.
     *
     * Three things the tool rejected before: the filing period was
     * hardcoded to August 2023 no matter which month you picked, the file
     * went out as text/csv through escape() (which mangles anything
     * non-ASCII in a customer name), and it downloaded even with no GSTIN
     * and no rows - a file the tool refuses, discovered at filing time.
     */
    gstrJson: function () {
        var loader = $(".loader-gstr-one");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var dateOne = $("#gst_form_one_daterange_one").val();
        var date_string_one = moment(dateOne, "MMMM-YYYY").format("MM/" + 1 + "/YYYY");
        var dateTwo = $("#gst_form_one_daterange_two").val();
        var date_string_two = moment(dateTwo, "MMMM-YYYY").endOf('month').format("MM/DD/YYYY");
        var gstn_number = $.trim($('#branch_gstin_number').val() || '');
        if (!gstn_number) {
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert('error', 'Add your shop GSTIN in Settings before exporting - the filing tool rejects a file without it.');
            return;
        }
        var data = {
            starting_date: date_string_one,
            ending_date: date_string_two
        };
        var params = {
            url: 'sales/gstOneReportTableJson',
            data: data
        };
        PosnicPro.get(params, function (response) {
            loader.find(".loadingSpinner:first").remove();
            if (response.type !== 'success') {
                PosnicPro.alert('error', response.message || 'Could not build the GSTR-1 file');
                return;
            }
            var rows = response.data || [];
            if (!rows.length) {
                PosnicPro.alert('warning', 'No B2B invoices in this period - nothing to file.');
                return;
            }
            var gstArray = {
                gstin: gstn_number,
                // filing period is MMYYYY of the month actually chosen
                fp: moment(dateOne, "MMMM-YYYY").format("MMYYYY"),
                b2b: rows
            };
            var blob = new Blob([JSON.stringify(gstArray)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.style = "visibility:hidden";
            link.download = 'gstr1-' + moment(dateOne, "MMMM-YYYY").format("MMYYYY") + '.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            var invoiceCount = 0;
            rows.forEach(function (r) { invoiceCount += (r.inv || []).length; });
            PosnicPro.alert('success', invoiceCount + ' invoice(s) for ' + rows.length + ' GSTIN(s) exported');
        }, function () {
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert('error', 'Could not build the GSTR-1 file');
        });
    },

    showDataTablePage: function () {
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#gstr_one').show();
        $('#v-pills-report-tab,#gstrone_report_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        var timeZone = PosnicPro.timeZone();
        var dateTime = new Date();
        var currentDateTimeCentralTimeZone = new Date(dateTime.toLocaleString('en-US', {timeZone: timeZone}));

        $('#gst_form_one_daterange_one').datepicker({
            language: 'en',
            dateFormat: 'MM-yyyy',
            autoClose: true,
            minView: 'months',
            view: 'months'
        });
        $('#gst_form_one_daterange_two').datepicker({
            language: 'en',
            dateFormat: 'MM-yyyy',
            autoClose: true,
            minView: 'months',
            view: 'months'
        });
        var date_string = moment(currentDateTimeCentralTimeZone, "YYYY/MM/DD").format("MMMM-YYYY");
        $("#gst_form_one_daterange_one,#gst_form_one_daterange_two").val(date_string);

        //call get sales details
        PosnicPro.gstrOne.gstonereportTable();
    },
    gstonereportTable: function () {
        var loader = $(".loader-gstr-one");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var dateOne = $("#gst_form_one_daterange_one").val();
        var date_string_one = moment(dateOne, "MMMM-YYYY").format("MM/" + 1 + "/YYYY");
        var dateTwo = $("#gst_form_one_daterange_two").val();
        // endOf('month'), not a hardcoded 31: "02/31/YYYY" is not a date -
        // JS rolled it into March and the report quietly ran long.
        var date_string_two = moment(dateTwo, "MMMM-YYYY").endOf('month').format("MM/DD/YYYY");
        var data = {
            starting_date: date_string_one,
            ending_date: date_string_two
        };
        var params = {
            url: 'sales/gstOneReportTable',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();

                var one = dateOne.split('-');
                $('.from-month').html(one[0]);
                $('.from-year').html(one[1]);
                var two = dateTwo.split('-');
                $('.to-month').html(two[0]);
                $('.to-year').html(two[1]);
                $(".legal-name").html(PosnicPro.local.get('branchname'));
                var gstn_number = $('#branch_gstin_number').val();
                $(".company_gstin").html(gstn_number);
                var currency = PosnicPro.local.get('currencySign');

                //4a item detail table
                var data = response.data;
                $('#gstrone_sale_item').html('');
                $('#gstrone_sale_footer_item').html('');
                var item_footer_total = 0;
                var item_footer_subtotal = 0;
                var item_footer_igsttotal = 0;
                var item_footer_cgsttotal = 0;
                var item_footer_sgsttotal = 0;
                for (var i = 0; i < data.sales_data.length; i++) {
                    var row = data.sales_data[i];
                    item_footer_total += row.item_total;
                    item_footer_subtotal += row.item_subtotal;
                    item_footer_igsttotal += row.item_igst_tax;
                    item_footer_cgsttotal += row.item_cgst_tax;
                    item_footer_sgsttotal += row.item_sgst_tax;
                    var trow = '<tr>' +
                            '<td><span>' + row.item_customer_gst_number + '</td></span>' +
                            '<td><span>' + row.item_sales_id + '</td></span>' +
                            '<td><span>' + row.item_date + '</td></span>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_total + '</span></td>' +
                            '<td class="text-right"><span class="number">' + row.item_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_subtotal + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_igst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_cgst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_sgst_tax + '</span></td>' +
                            '<td class="text-right"><span>0.00</td></span>' +
                            '<td>' + row.item_customer_state + '</td></span>' +
                            '</tr>';
                    $('#gstrone_sale_item').append(trow);
                }
                $('.sale_footer_total_amount').html(currency + '&nbsp;<span class="number">' + item_footer_total + '</span>');
                $('.sale_footer_total_subtotal').html(currency + '&nbsp;<span class="number">' + item_footer_subtotal + '</span>');
                $('.sale_footer_total_igst').html(currency + '&nbsp;<span class="number">' + item_footer_igsttotal + '</span>');
                $('.sale_footer_total_cgst').html(currency + '&nbsp;<span class="number">' + item_footer_cgsttotal + '</span>');
                $('.sale_footer_total_sgst').html(currency + '&nbsp;<span class="number">' + item_footer_sgsttotal + '</span>');


                //9b return detail table
                var data = response.data;
                $('#gstrone_sale_return_item').html('');
                $('#gstrone_sale_footer_returnitem').html('');
                var return_footer_total = 0;
                var return_footer_subtotal = 0;
                var return_footer_igsttotal = 0;
                var return_footer_cgsttotal = 0;
                var return_footer_sgsttotal = 0;
                for (var i = 0; i < data.returns_data.length; i++) {
                    var row = data.returns_data[i];
                    return_footer_total += row.return_total;
                    return_footer_subtotal += row.return_subtotal;
                    return_footer_igsttotal += row.return_igst_tax;
                    return_footer_cgsttotal += row.return_cgst_tax;
                    return_footer_sgsttotal += row.return_sgst_tax;
                    // the customer's real GSTIN, not the placeholder string
                    // that shipped in both of these columns
                    var returnCtin = row.return_customer_gst_number || '';
                    var trow = '<tr>' +
                            '<td><span>' + returnCtin + '</td></span>' +
                            '<td><span>' + row.return_sales_id + '</span></td>' +
                            '<td><span>' + row.return_sales_date + '</span></td>' +
                            '<td><span>' + returnCtin + '</span></td>' +
                            '<td><span>' + row.return_id + '</span></td>' +
                            '<td><span>' + row.return_date + '</span></td>' +
                            '<td></td>' +
                            '<td></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_total + '</span></td>' +
                            '<td class="text-right"><span class="number">' + row.return_tax.toFixed(2) + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_subtotal + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_igst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_cgst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_sgst_tax.toFixed(2) + '</span></td>' +
                            '<td class="text-right"><span>0.00</span></td>' +
                            '<td><span>' + row.return_customer_state + '</span></td>' +
                            '</tr>';
                    $("#gstrone_sale_return_item").append(trow);

                }
                $('.return_footer_total_amount').html(currency + '&nbsp;<span class="number">' + return_footer_total + '</span>');
                $('.return_footer_total_subtotal').html(currency + '&nbsp;<span class="number">' + return_footer_subtotal + '</span>');
                $('.return_footer_total_igst').html(currency + '&nbsp;<span class="number">' + return_footer_igsttotal + '</span>');
                $('.return_footer_total_cgst').html(currency + '&nbsp;<span class="number">' + return_footer_cgsttotal + '</span>');
                $('.return_footer_total_sgst').html(currency + '&nbsp;<span class="number">' + return_footer_sgsttotal + '</span>');


                //hsn product table
                $('#gstrone_sale_hsn_item').html('');
                var hsn_footer_qty = 0;
                var hsn_footer_total = 0;
                var hsn_footer_subtotal = 0;
                var hsn_footer_igsttotal = 0;
                var hsn_footer_cgsttotal = 0;
                var hsn_footer_sgsttotal = 0;
                for (var i = 0; i < data.product_data.length; i++) {
                    var row = data.product_data[i];
                    hsn_footer_qty += row.product_qty;
                    hsn_footer_total += row.product_total;
                    hsn_footer_subtotal += row.product_subtotal;
                    hsn_footer_igsttotal += row.product_igst;
                    hsn_footer_cgsttotal += row.product_cgst;
                    hsn_footer_sgsttotal += row.product_sgst;
                    var trow = '<tr>' +
                            '<td><span>' + (i + 1) + '</span></td>' +
                            '<td><span>' + row.product_hsn + '</span></td>' +
                            '<td><span>' + row.product_name + '</span></td>' +
                            '<td></td>' +
                            '<td class="text-right"><span>' + row.product_qty + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.product_total + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.product_subtotal + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.product_igst + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.product_cgst + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.product_sgst + '</span></td>' +
                            '<td class="text-right"><span>0.00</span></td>' +
                            '</tr>';
                    $("#gstrone_sale_hsn_item").append(trow);
                }
                $('.hsn_total_qty').text(hsn_footer_qty);
                $('.hsn_total_amount').html(currency + '&nbsp;<span class="number">' + hsn_footer_total + '</span>');
                $('.hsn_total_subtotal').html(currency + '&nbsp;<span class="number">' + hsn_footer_subtotal + '</span>');
                $('.hsn_total_igst').html(currency + '&nbsp;<span class="number">' + hsn_footer_igsttotal + '</span>');
                $('.hsn_total_cgst').html(currency + '&nbsp;<span class="number">' + hsn_footer_cgsttotal + '</span>');
                $('.hsn_total_sgst').html(currency + '&nbsp;<span class="number">' + hsn_footer_sgsttotal + '</span>');


                //    Interstate unregister  sales list 7 b
                $('#gstrone_sale_interstate_sales').html('');
                $('#gstrone_sale_InterstateSales_json').html('');
                var taxableValue = 0;
                var inteGrated = 0;
                var centralTax = 0;
                var stateTax = 0;
                for (var i = 0; i < data.intersales_data.length; i++) {
                    var row = data.intersales_data[i];
                    var trow = '<tr>' +
                            '<tr>' +
                            '<td>7B (1). Place of Supply (Name of State)</td>' +
                            '<td colspan="5">' + row.customer_state + '</td>' +
                            '</tr>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_subtotal + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_igst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_cgst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_sgst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + 0.00 + '</span></td>'
                    '</tr>';

                    var trow_json = '<tr>' +
                            '<td colspan="5" ><span>' + row.customer_state + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_tax.toFixed(2) + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_subtotal.toFixed(2) + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_igst_tax.toFixed(2) + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_cgst_tax.toFixed(2) + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_sgst_tax.toFixed(2) + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + 0.00 + '</span></td>' +
                            '</tr>';
                    $("#gstrone_sale_interstate_sales").append(trow);
                    $("#gstrone_sale_InterstateSales_json").append(trow_json);

                    taxableValue += row.item_subtotal;
                    inteGrated += row.item_igst_tax;
                    centralTax += row.item_cgst_tax;
                    stateTax += row.item_sgst_tax;
                    $('.taxableValue').html(currency + '&nbsp;<span class="number">' + taxableValue + '</span>');
                    $('.inteGrated').html(currency + '&nbsp;<span class="number">' + inteGrated + '</span>');
                    $('.centralTax').html(currency + '&nbsp;<span class="number">' + centralTax + '</span>');
                    $('.stateTax').html(currency + '&nbsp;<span class="number">' + stateTax + '</span>');

                }
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });

    }

};
