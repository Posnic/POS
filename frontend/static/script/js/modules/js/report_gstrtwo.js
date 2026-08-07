PosnicPro.gstrTwo = {
    gstrJson: function () {
        var tbl = $('.inward_supply_two');
        var tblhead = $(tbl).find('thead');
        var subTableId = ["gstrtwo_receiving_item"];
        var JObjectArray = [];
        $.each($(subTableId), function (i, j) {
            var tblbody = $(tbl).find('tbody#' + j);
            var header = [];
            $.each($(tblhead).find('tr>th>span'), function (i, j) {
                header.push($(j).text())
            })
            $.each($(tblbody).find('tr'), function (key, value)
            {
                var jObject = {};
                for (var x = 0; x < header.length; x++)
                {
                    jObject[header[x]] = $(this).find('td>span').eq(x).text()
                }

                var ItemArray = {};
                var year = $('.from-year').html();
                var toyear = $('.to-year').html();
                var month = $('.from-month').html();
                var tomonth = $('.to-month').html();
                ItemArray = {
                    fromyear: year,
                    toyear: toyear,
                    frommonth: month,
                    tomonth: tomonth,
                    b2b: jObject
                }
                JObjectArray.push(ItemArray)

            });
        });

        var tbltwo = $('.return_purchase_two');
        var tblheadtwo = $(tbltwo).find('thead');
        var subTableIdtwo = ["gstrtwo_receiving_return_item"];
        var JObjectArraytwo = [];
        $.each($(subTableIdtwo), function (i, j) {
            var tblbodytwo = $(tbltwo).find('tbody#' + j);
            var headertwo = [];
            $.each($(tblheadtwo).find('tr>th>span'), function (i, j) {
                headertwo.push($(j).text())
            })
            $.each($(tblbodytwo).find('tr'), function (key, value)
            {
                var jObjecttwo = {};
                for (var x = 0; x < headertwo.length; x++)
                {
                    jObjecttwo[headertwo[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    cdn: jObjecttwo
                }
                JObjectArraytwo.push(ItemArray)

            });
        });

        var tblthree = $('.inter_intra_supply');
        var tblheadthree = $(tblthree).find('thead');
        var subTableIdthree = ["inter_intra_supplyinfo"];
        var JObjectArraythree = [];
        $.each($(subTableIdthree), function (i, j) {
            var tblbodythree = $(tblthree).find('tbody#' + j);
            var headerthree = [];
            $.each($(tblheadthree).find('tr>th>span'), function (i, j) {
                headerthree.push($(j).text())
            })
            $.each($(tblbodythree).find('tr'), function (key, value)
            {
                var jObjectthree = {};
                for (var x = 0; x < headerthree.length; x++)
                {
                    jObjectthree[headerthree[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    nil_supplies: jObjectthree
                }
                JObjectArraythree.push(ItemArray)
            });
        });

        var tblfour = $('.hsnwise_purchase_two');
        var tblheadfour = $(tblfour).find('thead');
        var subTableIdfour = ["gstrtwo_receiving_hsn_item"];
        var JObjectArrayfour = [];
        $.each($(subTableIdfour), function (i, j) {
            var tblbodyfour = $(tblfour).find('tbody#' + j);
            var headerfour = [];
            $.each($(tblheadfour).find('tr>th>span'), function (i, j) {
                headerfour.push($(j).text())
            })
            $.each($(tblbodyfour).find('tr'), function (key, value)
            {
                var jObjectfour = {};
                for (var x = 0; x < headerfour.length; x++)
                {
                    jObjectfour[headerfour[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    hsn: jObjectfour
                }
                JObjectArrayfour.push(ItemArray)

            });
        });

        var gstr_twoarray = [];
        gstr_twoarray.push(JObjectArray, JObjectArraytwo, JObjectArraythree, JObjectArrayfour);
        //Generate a file name
        var fileName = 'gstr2';
        //Initialize file format you want csv or xls
        var uri = 'data:text/csv;charset=utf-8,' + escape(JSON.stringify(gstr_twoarray));
        var link = document.createElement("a");
        link.href = uri;
        link.style = "visibility:hidden";
        link.download = fileName + ".json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
    showDataTablePage: function () {
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#gstr_two').show();
        $('#v-pills-report-tab,#gstrtwo_report_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        var timeZone = PosnicPro.local.get('timezone');
        var dateTime = new Date();
        var currentDateTimeCentralTimeZone = new Date(dateTime.toLocaleString('en-US', {timeZone: timeZone}));

        $('#gst_form_two_daterange_one').datepicker({
            language: 'en',
            dateFormat: 'MM-yyyy',
            autoClose: true,
            minView: 'months',
            view: 'months'
        });
        $('#gst_form_two_daterange_two').datepicker({
            language: 'en',
            dateFormat: 'MM-yyyy',
            autoClose: true,
            minView: 'months',
            view: 'months'
        });
        var date_string = moment(currentDateTimeCentralTimeZone, "YYYY/MM/DD").format("MMMM-YYYY");
        $("#gst_form_two_daterange_one,#gst_form_two_daterange_two").val(date_string);

        //call get receiving details
        PosnicPro.gstrTwo.gsttworeportTable();

    },
    gsttworeportTable: function () {
        var loader = $(".loader-gstr-two");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var dateOne = $("#gst_form_two_daterange_one").val();
        var date_string_one = moment(dateOne, "MMMM-YYYY").format("MM/" + 1 + "/YYYY");
        var dateTwo = $("#gst_form_two_daterange_two").val();
        var date_string_two = moment(dateTwo, "MMMM-YYYY").format("MM/" + 31 + "/YYYY");
        var data = {
            starting_date: date_string_one,
            ending_date: date_string_two
        };
        var params = {
            url: 'receivings/gstTwoReportTable',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                var data = response.data.data;
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

                //3 form table
                var data = response.data;
                $('#gstrtwo_receiving_item').html('');
                $('#gstrtwo_receiving_footer_item').html('');
                var item_footer_total = 0;
                var item_footer_subtotal = 0;
                var item_footer_igsttotal = 0;
                var item_footer_cgsttotal = 0;
                var item_footer_sgsttotal = 0;
                for (var i = 0; i < data.sales_data.length; i++) {
                    var row = data.sales_data[i];
                    if (row.supplier_gst_type === 'regular') {
                        item_footer_total += row.item_total;
                        item_footer_subtotal += row.item_subtotal;
                        item_footer_igsttotal += row.item_igst_tax;
                        item_footer_cgsttotal += row.item_cgst_tax;
                        item_footer_sgsttotal += row.item_sgst_tax;
                        var trow = '<tr>' +
                                '<td><span>' + row.item_supplier_gst_number + '</span></td>' +
                                '<td><span>' + row.item_receiving_id + '</span></td>' +
                                '<td><span>' + row.item_date + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_total + '</span></td>' +
                                '<td class="text-right"><span class="number">' + row.item_tax + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_subtotal + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_igst_tax + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_cgst_tax + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_sgst_tax + '</span></td>' +
                                '<td class="text-right"><span>0.00</span></td>' +
                                '<td><span>' + row.item_supplier_state + '</span></td>' +
                                '<td><span>input</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_igst_tax + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_cgst_tax + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.item_sgst_tax + '</span></td>' +
                                '<td class="text-right"><span>0.00</span></td>' +
                                '</tr>';
                        $('#gstrtwo_receiving_item').append(trow);
                    }
                }
                $('.receiving_footer_total_amount').html(currency + '&nbsp;<span class="number">' + item_footer_total + '</span>');
                $('.receiving_footer_total_subtotal').html(currency + '&nbsp;<span class="number">' + item_footer_subtotal + '</span>');
                $('.receiving_footer_total_igst').html(currency + '&nbsp;<span class="number">' + item_footer_igsttotal + '</span>');
                $('.receiving_footer_total_cgst').html(currency + '&nbsp;<span class="number">' + item_footer_cgsttotal + '</span>');
                $('.receiving_footer_total_sgst').html(currency + '&nbsp;<span class="number">' + item_footer_sgsttotal + '</span>');


                //6 return detail table
                var data = response.data;
                $('#gstrtwo_receiving_return_item').html('');
                $('#gstrtwo_receiving_footer_returnitem').html('');
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
                    var trow = '<tr>' +
                            '<td><span>33HYUUYIUY56YI</span></td>' +
                            '<td><span>' + row.return_receiving_id + '</span></td>' +
                            '<td><span>' + row.return_receiving_date + '</span></td>' +
                            '<td><span>33HYUUYIUY56YI</span></td>' +
                            '<td><span>' + row.return_id + '</span></td>' +
                            '<td><span>' + row.return_date + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_total + '</span></td>' +
                            '<td class="text-right"><span class="number">' + row.return_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_subtotal + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_igst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_cgst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_sgst_tax + '</span></td>' +
                            '<td class="text-right"><span>0.00</span></td>' +
                            '<td><span>' + row.return_supplier_state + '</span></td>' +
                            '<td>input</td></span>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_igst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_cgst_tax + '</span></td>' +
                            '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.return_sgst_tax + '</span></td>' +
                            '<td class="text-right"><span>0.00</span></td>' +
                            '</tr>';
                    $("#gstrtwo_receiving_return_item").append(trow);
                }
                $('.return_receiving_footer_total_amount').html(currency + '&nbsp;<span class="number">' + return_footer_total + '</span>');
                $('.return_receiving_footer_total_subtotal').html(currency + '&nbsp;<span class="number">' + return_footer_subtotal + '</span>');
                $('.return_receiving_footer_total_igst').html(currency + '&nbsp;<span class="number">' + return_footer_igsttotal + '</span>');
                $('.return_receiving_footer_total_cgst').html(currency + '&nbsp;<span class="number">' + return_footer_cgsttotal + '</span>');
                $('.return_receiving_footer_total_sgst').html(currency + '&nbsp;<span class="number">' + return_footer_sgsttotal + '</span>');

                //7 table
                var inter_composite_total = 0;
                var intra_composite_total = 0;
                for (var j = 0; j < data.sales_data.length; j++) {
                    var row = data.sales_data[j];
                    if (row.supplier_gst_type === 'composite') {
                        var branch_state = $("#setting_state").val();
                        if (row.item_supplier_state === branch_state) {
                            inter_composite_total += row.item_total;
                        } else {
                            intra_composite_total += row.item_total;
                        }
                    }
                }
                $('#receiving_intra_state_composite').html(currency + '&nbsp;<span class="number">' + inter_composite_total + '</span>');
                $('#receiving_inter_state_composite').html(currency + '&nbsp;<span class="number">' + intra_composite_total + '</span>');

                //hsn product table
                $('#gstrtwo_receiving_hsn_item').html('');
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
                            '<td>' + (i + 1) + '</td>' +
                            '<td></td>' +
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
                    $("#gstrtwo_receiving_hsn_item").append(trow);
                }
                $('.hsn_total_qty').text(hsn_footer_qty);
                $('.hsn_total_amount').html(currency + '&nbsp;<span class="number">' + hsn_footer_total + '</span>');
                $('.hsn_total_subtotal').html(currency + '&nbsp;<span class="number">' + hsn_footer_subtotal + '</span>');
                $('.hsn_total_igst').html(currency + '&nbsp;<span class="number">' + hsn_footer_igsttotal + '</span>');
                $('.hsn_total_cgst').html(currency + '&nbsp;<span class="number">' + hsn_footer_cgsttotal + '</span>');
                $('.hsn_total_sgst').html(currency + '&nbsp;<span class="number">' + hsn_footer_sgsttotal + '</span>');

                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });

    }

};