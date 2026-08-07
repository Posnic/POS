PosnicPro.gstrThree = {

    gstrJson: function () {
        var tbl = $('.outward_sales');
        var tblhead = $(tbl).find('thead');
        var subTableId = ["gstrthree_sale_outward"];
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
                var month = $('.from-month').html();

                ItemArray = {
                    fromyear: year,
                    frommonth: month,
                    osup_detail: jObject
                }
                JObjectArray.push(ItemArray)
            });
        });

        var tbltwo = $('.outward_sales');
        var tblheadtwo = $(tbltwo).find('thead');
        var subTableIdtwo = ["gstrthree_sale_nilrate"];
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
                    osup_nil_exmp: jObjecttwo
                }
                JObjectArraytwo.push(ItemArray)
            });
        });

        var tblsix = $('.interstate_sale_three');
        var tblheadsix = $(tblsix).find('thead');
        var subTableIdsix = ["gstrthree_sale_interstate_sales"];
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
                    inter_sup: jObjectsix
                }
                JObjectArraysix.push(ItemArray)
            });
        });

        var tblfive = $('.interstate_sale_three');
        var tblheadfive = $(tblfive).find('thead');
        var subTableIdfive = ["gstrthree_sale_interstate_composite"];
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
                    inter_comp: jObjectfive
                }
                JObjectArrayfive.push(ItemArray)
            });
        });


        var tblthree = $('.purchase_info_three');
        var tblheadthree = $(tblthree).find('thead');
        var subTableIdthree = ["purchase_detail_total"];
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
                jObjectthree['type'] = 'oth';

                var ItemArray = {};
                ItemArray = {
                    itc_avl: jObjectthree
                }
                JObjectArraythree.push(ItemArray)
            });
        });

        var tblfour = $('.purchase_info_three');
        var tblheadfour = $(tblfour).find('thead');
        var subTableIdfour = ["purchase_net_itc"];
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
                    itc_net: jObjectfour
                }
                JObjectArrayfour.push(ItemArray)
            });
        });

        var tblseven = $('.inter_intra_sales');
        var tblheadseven = $(tblseven).find('thead');
        var subTableIdseven = ["inter_intra_sale_info"];
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
                ItemArray = {
                    in_sup_comp: jObjectseven
                }
                JObjectArrayseven.push(ItemArray)

            });
        });



        var gstr_threearray = [];
        gstr_threearray.push(JObjectArray, JObjectArraytwo, JObjectArraysix, JObjectArrayfive, JObjectArraythree, JObjectArrayfour, JObjectArrayseven);

        //Generate a file name
        var fileName = 'gstr3';
        //Initialize file format you want csv or xls
        var uri = 'data:text/csv;charset=utf-8,' + escape(JSON.stringify(gstr_threearray));
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
        $('.page-title-box,#gstr_three').show();
        $('#v-pills-report-tab,#gstrthree_report_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        var timeZone = PosnicPro.local.get('timezone');
        var dateTime = new Date();
        var currentDateTimeCentralTimeZone = new Date(dateTime.toLocaleString('en-US', {timeZone: timeZone}));

        $('#gst_form_three_daterange_one').datepicker({
            language: 'en',
            dateFormat: 'MM-yyyy',
            autoClose: true,
            minView: 'months',
            view: 'months'

        });
        $('#gst_form_three_daterange_two').datepicker({
            language: 'en',
            dateFormat: 'MM-yyyy',
            autoClose: true,
            minView: 'months',
            view: 'months'
        });
        var date_string = moment(currentDateTimeCentralTimeZone, "YYYY/MM/DD").format("MMMM-YYYY");
        $("#gst_form_three_daterange_one,#gst_form_three_daterange_two").val(date_string);

        PosnicPro.gstrThree.gstthreereportTable();
    },
    gstthreereportTable: function () {
        var loader = $(".loader-gstr-three");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var dateOne = $("#gst_form_three_daterange_one").val();
        var date_string_one = moment(dateOne, "MMMM-YYYY").format("MM/" + 1 + "/YYYY");
        var dateTwo = $("#gst_form_three_daterange_two").val();
        var date_string_two = moment(dateTwo, "MMMM-YYYY").format("MM/" + 31 + "/YYYY");
        var data = {
            starting_date: date_string_one,
            ending_date: date_string_two
        };
        var params = {
            url: 'sales/gstThreeReportTable',
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
                var currency = PosnicPro.local.get('currencySign');
                var gstn_number = $('#branch_gstin_number').val();
                $(".company_gstin").html(gstn_number);
                var data = response.data;
                $('#gstrthree_sale_item').children('tbody').text('');

                $('#saletax_amount').html(currency + '&nbsp;<span class="number">' + data.sub_amount + '</span>');
                $('#sale_igst').html(currency + '&nbsp;<span class="number">' + data.igst + '</span>');
                $('#sale_cgst').html(currency + '&nbsp;<span class="number">' + data.cgst + '</span>');
                $('#sale_sgst').html(currency + '&nbsp;<span class="number">' + data.sgst + '</span>');

                $('#taxnil_amount').html(currency + '&nbsp;<span class="number">' + data.salestax_subamount + '</span>');
                $('#taxnil_igst').html(currency + '&nbsp;<span class="number">' + data.salestax_igst + '</span>');
                $('#taxnil_cgst').html(currency + '&nbsp;<span class="number">' + data.salestax_cgst + '</span>');
                $('#taxnil_sgst').html(currency + '&nbsp;<span class="number">' + data.salestax_sgst + '</span>');


                $('#purchase_igst,#netitc_igst').html(currency + '&nbsp;<span class="number">' + data.purchasetax_igst + '</span>');
                $('#purchase_cgst,#netitc_cgst').html(currency + '&nbsp;<span class="number">' + data.purchasetax_cgst + '</span>');
                $('#purchase_sgst,#netitc_sgst').html(currency + '&nbsp;<span class="number">' + data.purchasetax_sgst + '</span>');


                //  Interstate unregister,composite sales list
                $('#gstrthree_sale_interstate_sales').html('');
                $('#gstrthree_sale_interstate_composite').html('');
                for (var i = 0; i < data.sales_interdata.length; i++) {
                    var row = data.sales_interdata[i];
                    if (row.customer_gsttype === 'consumer') {
                        var trow = '<tr>' +
                                '<td></td>' +
                                '<td><span>' + row.customer_state + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.taxable_total + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_igst + '</span></td>' +
                                '</tr>';
                        $("#gstrthree_sale_interstate_sales").append(trow);
                    } else if (row.customer_gsttype === 'composite') {
                        var trow = '<tr>' +
                                '<td></td>' +
                                '<td><span>' + row.customer_state + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.taxable_total.toFixed(2) + '</span></td>' +
                                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_igst.toFixed(2) + '</span></td>' +
                                '</tr>';
                        $("#gstrthree_sale_interstate_composite").append(trow);

                    }
                }

                // Interstate unregister,composite purchase list

                $('#interstate_value').html(currency + '&nbsp;<span class="number">' + data.purchase_interstatedata + '</span>');

                // Intrastate unregister,composite purchase list

                $('#intrastate_value').html(currency + '&nbsp;<span class="number">' + data.intra_state_purchase + '</span>');
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });

    }

};