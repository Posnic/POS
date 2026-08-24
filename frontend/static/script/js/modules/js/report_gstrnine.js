PosnicPro.gstrNine = {
    gstrJson: function () {
        var tbl = $('.unregister_sale_nine');
        var tblhead = $(tbl).find('thead');
        var subTableId = ["sales_gst_nine"];
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
                ItemArray = {
                    fromyear: year,
                    toyear: toyear,
                    in_out_supply: jObject
                }
                JObjectArray.push(ItemArray)
            });
        });

        var tbltwo = $('.unregister_sale_nine');
        var tblheadtwo = $(tbltwo).find('thead');
        var subTableIdtwo = ["sales_subtotal"];
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
                    osup_subtot: jObjecttwo
                }
                JObjectArraytwo.push(ItemArray)
            });
        });

        var tblthree = $('.unregister_sale_nine');
        var tblheadthree = $(tblthree).find('thead');
        var subTableIdthree = ["sales_supplieradvance"];
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
                    osup_advance: jObjectthree
                }
                JObjectArraythree.push(ItemArray)
            });
        });

        var tblfour = $('.zero_ratesale_nine');
        var tblheadfour = $(tblfour).find('thead');
        var subTableIdfour = ["zero_rate_tbody"];
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
                    osup_nill: jObjectfour
                }
                JObjectArrayfour.push(ItemArray)
            });
        });

        var tblfive = $('.zero_ratesale_nine');
        var tblheadfive = $(tblfive).find('thead');
        var subTableIdfive = ["outward_sale_subtotal"];
        var JObjectArrayfive = [];
        $.each($(subTableIdfive), function (i, j) {
            var tblbodyfive = $(tblfive).find('tbody#' + j);
            var headerfive = [];
            $.each($(tblheadfive).find('tr>th>span'), function (i, j) {
                headerfive.push($(j).text())
            })
            $.each($(tblbodyfive).find('tr'), function (key, value)
            {
                var jObjectfive = {};
                for (var x = 0; x < headerfive.length; x++)
                {
                    jObjectfive[headerfive[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    outward_subtot: jObjectfive
                }
                JObjectArrayfive.push(ItemArray)
            });
        });

        var tblsix = $('.zero_ratesale_nine');
        var tblheadsix = $(tblsix).find('thead');
        var subTableIdsix = ["outward_sale_turnover"];
        var JObjectArraysix = [];
        $.each($(subTableIdsix), function (i, j) {
            var tblbodysix = $(tblsix).find('tbody#' + j);
            var headersix = [];
            $.each($(tblheadsix).find('tr>th>span'), function (i, j) {
                headersix.push($(j).text())
            })
            $.each($(tblbodysix).find('tr'), function (key, value)
            {
                var jObjectsix = {};
                for (var x = 0; x < headersix.length; x++)
                {
                    jObjectsix[headersix[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    osup_turnover: jObjectsix
                }
                JObjectArraysix.push(ItemArray)
            });
        });

        var tblseven = $('.outward_supply_nine');
        var tblheadseven = $(tblseven).find('thead');
        var subTableIdseven = ["outward_info_nine"];
        var JObjectArrayseven = [];
        $.each($(subTableIdseven), function (i, j) {
            var tblbodyseven = $(tblseven).find('tbody#' + j);
            var headerseven = [];
            $.each($(tblheadseven).find('tr>th>span'), function (i, j) {
                headerseven.push($(j).text())
            })
            $.each($(tblbodyseven).find('tr'), function (key, value)
            {
                var jObjectseven = {};
                for (var x = 0; x < headerseven.length; x++)
                {
                    jObjectseven[headerseven[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                var itc_avail = {};
                ItemArray = {
                    "itc_avail" : {
                        isup_oth_input: jObjectseven
                    }
                }
                JObjectArrayseven.push(ItemArray)
            });
        });

        var tbleight = $('.outward_supply_nine');
        var tblheadeight = $(tbleight).find('thead');
        var subTableIdeight = ["outward_info_subtotal"];
        var JObjectArrayeight = [];
        $.each($(subTableIdeight), function (i, j) {
            var tblbodyeight = $(tbleight).find('tbody#' + j);
            var headereight = [];
            $.each($(tblheadeight).find('tr>th>span'), function (i, j) {
                headereight.push($(j).text())
            })
            $.each($(tblbodyeight).find('tr'), function (key, value)
            {
                var jObjecteight = {};
                for (var x = 0; x < headereight.length; x++)
                {
                    jObjecteight[headereight[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                var itc_avail = {};
                ItemArray = {
                    "itc_avail" : {
                        isup_subtot: jObjecteight
                    }
                }
                JObjectArrayeight.push(ItemArray)
            });
        });

        var tblnine = $('.supplier_composite_nine');
        var tblheadnine = $(tblnine).find('thead');
        var subTableIdnine = ["compsite_taxPayer_nine"];
        var JObjectArraynine = [];
        $.each($(subTableIdnine), function (i, j) {
            var tblbodynine = $(tblnine).find('tbody#' + j);
            var headernine = [];
            $.each($(tblheadnine).find('tr>th>span'), function (i, j) {
                headernine.push($(j).text())
            })
            $.each($(tblbodynine).find('tr'), function (key, value)
            {
                var jObjectnine = {};
                for (var x = 0; x < headernine.length; x++)
                {
                    jObjectnine[headernine[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    sup_rec_composite: jObjectnine
                }
                JObjectArraynine.push(ItemArray)
            });
        });


        var tblten = $('.hsn_supply_outward');
        var tblheadten = $(tblten).find('thead');
        var subTableIdten = ["hsnwise_info"];
        var JObjectArrayten = [];
        $.each($(subTableIdten), function (i, j) {
            var tblbodyten = $(tblten).find('tbody#' + j);
            var headerten = [];
            $.each($(tblheadten).find('tr>th>span'), function (i, j) {
                headerten.push($(j).text())
            })
            $.each($(tblbodyten).find('tr'), function (key, value)
            {
                var jObjectten = {};
                for (var x = 0; x < headerten.length; x++)
                {
                    jObjectten[headerten[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    hsn_outward: jObjectten
                }
                JObjectArrayten.push(ItemArray)
            });
        });

        var tbleleven = $('.hsn_supply_inward');
        var tblheadeleven = $(tbleleven).find('thead');
        var subTableIdelevne = ["hsn_purchase_nine"];
        var JObjectArrayeleven = [];
        $.each($(subTableIdelevne), function (i, j) {
            var tblbodyeleven = $(tbleleven).find('tbody#' + j);
            var headerteleven = [];
            $.each($(tblheadeleven).find('tr>th>span'), function (i, j) {
                headerteleven.push($(j).text())
            })
            $.each($(tblbodyeleven).find('tr'), function (key, value)
            {
                var jObjecteleven = {};
                for (var x = 0; x < headerteleven.length; x++)
                {
                    jObjecteleven[headerteleven[x]] = $(this).find('td>span').eq(x).text()
                }
                var ItemArray = {};
                ItemArray = {
                    hsn_inward_sup: jObjecteleven
                }
                JObjectArrayeleven.push(ItemArray)
            });
        });

        var gstr_ninearray = [];
        gstr_ninearray.push(JObjectArray, JObjectArraytwo, JObjectArraythree, JObjectArrayfour, JObjectArrayfive, JObjectArraysix, JObjectArrayseven, JObjectArrayeight, JObjectArraynine, JObjectArrayten, JObjectArrayeleven);

        //Generate a file name
        var fileName = 'gstr9';
        //Initialize file format you want csv or xls
        var uri = 'data:text/csv;charset=utf-8,' + escape(JSON.stringify(gstr_ninearray));
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
        $('.page-title-box,#gstrNine').show();
        $('#v-pills-report-tab,#gstrnine_report_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        var timeZone = PosnicPro.timeZone();
        var dateTime = new Date();
        var currentDateTimeCentralTimeZone = new Date(dateTime.toLocaleString('en-US', {timeZone: timeZone}));
        $('#gst_form_nine_daterange_one').datepicker({
            language: 'en',
            dateFormat: 'yyyy',
            autoClose: true,
            minView: 'years',
            view: 'years'
        });
        $('#gst_form_nine_daterange_two').datepicker({
            language: 'en',
            dateFormat: 'yyyy',
            autoClose: true,
            minView: 'years',
            view: 'years'
        });
        var date_string = moment(currentDateTimeCentralTimeZone, "YYYY/MM/DD").format("YYYY");
        $("#gst_form_nine_daterange_one,#gst_form_nine_daterange_two").val(date_string);
        PosnicPro.gstrNine.gstnineReportTable();
    },

    gstnineReportTable: function () {
        var loader = $(".loader-gstr-nine");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var dateOne = $("#gst_form_nine_daterange_one").val();
        var date_string_one = moment(dateOne, "YYYY").format("MM/" + 1 + "/YYYY");
        var dateTwo = $("#gst_form_nine_daterange_two").val();
        var date_string_two = moment(dateTwo, "YYYY").format(12 + "/" + 31 + "/YYYY");
        var data = {
            starting_date: date_string_one,
            ending_date: date_string_two
        };
        var params = {
            url: 'receivings/gstNineReportTable',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                $('.from-year').html(dateOne);
                $('.to-year').html(dateTwo);

                $(".legal-name").html(PosnicPro.local.get('branchname'));
                var currency = PosnicPro.local.get('currencySign');
                var gstn_number = $('#branch_gstin_number').val();
                $(".company_gstin").html(gstn_number);


                var data = response.data;
                var total_subamount = (data.sub_amount + data.sale_sub_amount).toFixed(2);
                var total_igst = (data.igst + data.sale_igst).toFixed(2);
                var total_cgst = (data.cgst + data.sale_cgst).toFixed(2);
                var total_sgst = (data.sgst + data.sale_sgst).toFixed(2);

                //Unregister sales details

                $('#saletunreg_amount').html(currency + '&nbsp;<span class="number">' + data.sub_amount + '</span>');
                $('#saletunreg_igst').html(currency + '&nbsp;<span class="number">' + data.igst + '</span>');
                $('#saletunreg_cgst').html(currency + '&nbsp;<span class="number">' + data.cgst + '</span>');
                $('#saletunreg_sgst').html(currency + '&nbsp;<span class="number">' + data.sgst + '</span>');

                //Register,Composite sales details

                $('#salereg_amount').html(currency + '&nbsp;<span class="number">' + data.sale_sub_amount + '</span>');
                $('#salereg_igst').html(currency + '&nbsp;<span class="number">' + data.sale_igst + '</span>');
                $('#salereg_cgst').html(currency + '&nbsp;<span class="number">' + data.sale_cgst + '</span>');
                $('#salereg_sgst').html(currency + '&nbsp;<span class="number">' + data.sale_sgst + '</span>');

                //Total amount  sales details of cloumn 4)H

                $('#total_amount').html(currency + '&nbsp;<span class="number">' + total_subamount + '</span>');
                $('#total_igst').html(currency + '&nbsp;<span class="number">' + total_igst + '</span>');
                $('#total_cgst').html(currency + '&nbsp;<span class="number">' + total_cgst + '</span>');
                $('#total_sgst').html(currency + '&nbsp;<span class="number">' + total_sgst + '</span>');

                //Total amount  sales details of cloumn 4)N

                $('#supplier_tax_amount').html(currency + '&nbsp;<span class="number">' + total_subamount + '</span>');
                $('#supplier_tax_igst').html(currency + '&nbsp;<span class="number">' + total_igst + '</span>');
                $('#supplier_tax_cgst').html(currency + '&nbsp;<span class="number">' + total_cgst + '</span>');
                $('#supplier_tax_sgst').html(currency + '&nbsp;<span class="number">' + total_sgst + '</span>');

                //Total turn over tax amount  sales details of cloumn 5)N

                $('#turnover_amount').html(currency + '&nbsp;<span class="number">' + total_subamount + '</span>');
                $('#turnover_igst').html(currency + '&nbsp;<span class="number">' + total_igst + '</span>');
                $('#turnover_cgst').html(currency + '&nbsp;<span class="number">' + total_cgst + '</span>');
                $('#turnover_sgst').html(currency + '&nbsp;<span class="number">' + total_sgst + '</span>');

                //HSN Wise Summary of outward supplies of cloumn 17

                $('#hsn_total_amount').html(currency + '&nbsp;<span class="number">' + total_subamount + '</span>');
                $('#hsn_igst').html(currency + '&nbsp;<span class="number">' + total_igst + '</span>');
                $('#hsn_cgst').html(currency + '&nbsp;<span class="number">' + total_cgst + '</span>');
                $('#hsn_sgst').html(currency + '&nbsp;<span class="number">' + total_sgst + '</span>');
                $('.hsn_empty').html('-');
                $('.hsn_empty_zero').html(currency + '0.00');


                //tax value 0 sales value of column 5 E

                $('#zerosale_amount').html(currency + '&nbsp;<span class="number">' + data.zero_sub_amount + '</span>');
                $('#zerosale_igst').html(currency + '&nbsp;<span class="number">' + data.zero_igst + '</span>');
                $('#zerosale_cgst').html(currency + '&nbsp;<span class="number">' + data.zero_cgst + '</span>');
                $('#zerosale_sgst').html(currency + '&nbsp;<span class="number">' + data.zero_sgst + '</span>');

                //subtotal sales value of column 5 G

                $('.zerosubtotal_amount').html(currency + '&nbsp;<span class="number">' + data.zero_sub_amount + '</span>');
                $('.zerosubtotal_igst').html(currency + '&nbsp;<span class="number">' + data.zero_igst + '</span>');
                $('.zerosubtotal_cgst').html(currency + '&nbsp;<span class="number">' + data.zero_cgst + '</span>');
                $('.zerosubtotal_sgst').html(currency + '&nbsp;<span class="number">' + data.zero_sgst + '</span>');

                var total_turnover_amount = (data.sub_amount + data.sale_sub_amount + data.zero_sub_amount).toFixed(2);
                var total_turnover_cgst = (data.cgst + data.sale_cgst + data.zero_cgst).toFixed(2);
                var total_turnover_sgst = (data.sgst + data.sale_sgst + data.zero_sgst).toFixed(2);
                var total_turnover_igst = (data.igst + data.sale_igst + data.zero_igst).toFixed(2);

                //Turnover sales value of column 5 N

                $('#turnover_amount').html(currency + '&nbsp;<span class="number">' + total_turnover_amount + '</span>');
                $('#turnover_igst').html(currency + '&nbsp;<span class="number">' + total_turnover_igst + '</span>');
                $('#turnover_cgst').html(currency + '&nbsp;<span class="number">' + total_turnover_cgst + '</span>');
                $('#turnover_sgst').html(currency + '&nbsp;<span class="number">' + total_turnover_sgst + '</span>');

                //Purchase register detail of column 6 B

                $('.purchasereg_cgst').html(currency + '&nbsp;<span class="number">' + data.purchase_cgst + '</span>');
                $('.purchasereg_sgst').html(currency + '&nbsp;<span class="number">' + data.purchase_sgst + '</span>');
                $('.purchasereg_igst').html(currency + '&nbsp;<span class="number">' + data.purchase_igst + '</span>');

                // composite purchase of column 16 A
                $('#composite_subtotal').html(currency + '&nbsp;<span class="number">' + data.composite_subtotal + '</span>');

                //HSN Wise Summary of inward supplies of cloumn 18

                $('#purchasehsn_total_amount').html(currency + '&nbsp;<span class="number">' + data.purchase_subamount + '</span>');
                $('#purchasehsn_igst').html(currency + '&nbsp;<span class="number">' + data.purchase_igst + '</span>');
                $('#purchasehsn_cgst').html(currency + '&nbsp;<span class="number">' + data.purchase_cgst + '</span>');
                $('#purchasehsn_sgst').html(currency + '&nbsp;<span class="number">' + data.purchase_sgst + '</span>');

                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });

    }


};
