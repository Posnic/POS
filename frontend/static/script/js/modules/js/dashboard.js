PosnicPro.dashboard = {
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $("#dashboardModule a").addClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#dashboard').show();
        $('.fc-today-button').click();
        $('.dashboard_highlight').addClass('active');
        $('.fc-time').hide();
        $('#v-pills-dashboard-tab').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_dashboard').show();
        if (PosnicPro.local.get('hourAlertregister') === 'false' && PosnicPro.local.get('RegisterId') !== '') {
            PosnicPro.registers.registerCheckTime();
        }
        PosnicPro.local.set('hourAlertregister', 'true');

    },
    toggleFullScreen: function () {
        $('.add_new_tooltip').tooltip("hide");
        if ((document.fullScreenElement && document.fullScreenElement !== null) ||
                (!document.mozFullScreen && !document.webkitIsFullScreen)) {
            if (document.documentElement.requestFullScreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenminmise.svg');
                document.documentElement.requestFullScreen();
            } else if (document.documentElement.mozRequestFullScreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenminmise.svg');
                document.documentElement.mozRequestFullScreen();
            } else if (document.documentElement.msRequestFullscreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenminmise.svg');
                document.documentElement.msRequestFullscreen();
            } else if (document.documentElement.webkitRequestFullScreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenminmise.svg');
                document.documentElement.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
            }
        } else {
            if (document.cancelFullScreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenmaximise.svg');
                document.cancelFullScreen();
            } else if (document.mozCancelFullScreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenmaximise.svg');
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenmaximise.svg');
                document.msExitFullscreen();
            } else if (document.webkitCancelFullScreen) {
                jQuery('#fullscreen').attr('src', 'static/images/svg-icon/fullscreenmaximise.svg');
                document.webkitCancelFullScreen();
            }
        }

    },

    datePicker: function () {
        var listItem, applyClicked = false;
        var start = moment().startOf('month').startOf('day');
        var end = moment().endOf('day');
        var label = 'This Month';
        $('.daterange-timepicker span').html('<span>' + label + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="top" data-original-title="' + start.format('YYYY/MM/DD h:mm A') + ' - ' + end.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('.daterange-timepicker').val(start.format('YYYY/MM/DD h:mm A') + ' - ' + end.format('YYYY/MM/DD h:mm A'));
        $('.daterange-timepicker').daterangepicker({
            showDropdowns: true,
            alwaysShowCalendars: true,
            autoApply: false,
            autoUpdateInput: false,
            autoclose: false,
            timePicker: true,
            applyButtonClasses: "btn-success datePickerApplyClasses",
            locale: {
                "format": 'YYYY/MM/DD h:mm A',
                "applyLabel": "Choose",
                "cancelLabel": "Close",
                "customRangeLabel": "Custom"
            },
            startDate: moment().startOf('month').startOf('day'),
            endDate: moment().endOf('day'),
            maxDate: moment().endOf('day'),
            ranges: {
                'Today': [moment().startOf('day'), moment().endOf('day')],
                'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
                'Last 7 Days': [moment().subtract(6, 'days').startOf('day'), moment().endOf('day')],
                'Last 90 Days': [moment().subtract(89, 'days').startOf('day'), moment().endOf('day')],
                'This Month': [moment().startOf('month').startOf('day'), moment().endOf('month').endOf('day')],
                'Last Month': [moment().subtract(1, 'month').startOf('month').startOf('day'), moment().subtract(1, 'month').endOf('month').endOf('day')],
                'Last Year': [moment().subtract(1, 'year').add(1, 'day').startOf('day'), moment().endOf('day')],
                'Last 3 years': [moment().subtract(3, 'years').add(1, 'day').startOf('day'), moment().endOf('day')]

            },
            opens: 'right'
        });

        $('.daterange-timepicker').on('apply.daterangepicker', function (ev, picker) {
            if (listItem !== "Custom" && !applyClicked) {
                picker.show();
                applyClicked = false;
            } else {
                picker.hide();
                applyClicked = false;
                $('.daterange-timepicker span').html('<span>' + $('.ranges ul li.active').data('range-key') + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' + picker.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + picker.endDate.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
                $('.daterange-timepicker').val(picker.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + picker.endDate.format('YYYY/MM/DD h:mm A'));
            }

        });

        $(".datePickerApplyClasses").click(function () {
            applyClicked = true;
        });

        // daterangepicker All Time
        let listAllItem, applyAllClicked = false;
        let startAll = moment().subtract(10, 'years').startOf('month').startOf('day');
        let endAll = moment().endOf('day');
        let labelAll = 'All Time';
        $(".show-calendar").removeClass("gst_calender");
        $('.daterange-timepicker-all span').html('<span>' + labelAll + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="top" data-original-title="' + startAll.format('YYYY/MM/DD h:mm A') + ' - ' + endAll.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('.daterange-timepicker-all').val(startAll.format('YYYY/MM/DD h:mm A') + ' - ' + endAll.format('YYYY/MM/DD h:mm A'));
        $('.daterange-timepicker-all').daterangepicker({
            showDropdowns: true,
            alwaysShowCalendars: true,
            autoApply: false,
            autoUpdateInput: false,
            autoclose: false,
            timePicker: true,
            applyButtonClasses: "btn-success allTimedatePickerApplyClasses",
            locale: {
                "format": 'YYYY/MM/DD h:mm A',
                "applyLabel": "Choose",
                "cancelLabel": "Close",
                "customRangeLabel": "Custom"
            },
            startDate: startAll,
            endDate: endAll,
            maxDate: endAll,
            ranges: {
                'All Time': [moment().subtract(10, 'years').startOf('month').startOf('day'), moment().endOf('day')],
                'Today': [moment().startOf('day'), moment().endOf('day')],
                'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
                'Last 7 Days': [moment().subtract(6, 'days').startOf('day'), moment().endOf('day')],
                'Last 90 Days': [moment().subtract(89, 'days').startOf('day'), moment().endOf('day')],
                'This Month': [moment().startOf('month').startOf('day'), moment().endOf('month').endOf('day')],
                'Last Month': [moment().subtract(1, 'month').startOf('month').startOf('day'), moment().subtract(1, 'month').endOf('month').endOf('day')],
                'Last Year': [moment().subtract(1, 'year').add(1, 'day').startOf('day'), moment().endOf('day')],
                'Last 3 years': [moment().subtract(3, 'years').add(1, 'day').startOf('day'), moment().endOf('day')]

            },
            opens: 'right'
        });

        $('.daterange-timepicker-all').on('apply.daterangepicker', function (ev, pickerAll) {
            if (listAllItem !== "Custom" && !applyAllClicked) {
                pickerAll.show();
                applyAllClicked = false;
            } else {
                pickerAll.hide();
                applyAllClicked = false;
                $('.daterange-timepicker-all span').html('<span>' + $('.ranges ul li.active').data('range-key') + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' + pickerAll.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerAll.endDate.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
                $('.daterange-timepicker-all').val(pickerAll.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerAll.endDate.format('YYYY/MM/DD h:mm A'));
            }

        });

        $(".allTimedatePickerApplyClasses").click(function () {
            applyAllClicked = true;
        });

        let listAllItemreport, applyAllClickedreport = false;
        let startAllReport = moment().startOf('day');
        let endAllReport = moment().endOf('day');
        let labelAllReport = 'Today';
        $(".show-calendar").removeClass("gst_calender");
        $('#view_sale_report_daterange span').html('<span>' + labelAllReport + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="top" data-original-title="' + startAllReport.format('YYYY/MM/DD h:mm A') + ' - ' + endAllReport.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('#view_sale_report_daterange').val(startAllReport.format('YYYY/MM/DD h:mm A') + ' - ' + endAllReport.format('YYYY/MM/DD h:mm A'));
            $('#view_sale_report_daterange').daterangepicker({
                showDropdowns: true,
                alwaysShowCalendars: true,
                autoApply: false,
                autoUpdateInput: false,
                autoclose: false,
                timePicker: true, 
                applyButtonClasses: "btn-success allTimedatePickerApplyClasses",
                locale: {
                    format: 'YYYY/MM/DD h:mm A',
                    applyLabel: "Choose",
                    cancelLabel: "Close",
                    customRangeLabel: "Custom"
                },
                startDate: moment().startOf('day'),
                endDate: moment().endOf('day'),
                maxDate: moment().endOf('day'),
                ranges: {
                    'Today': [moment().startOf('day'), moment().endOf('day')],
                    'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
                    'This Month': [moment().startOf('month').startOf('day'), moment().endOf('month').endOf('day')],
                    'This Year': [moment().startOf('year').startOf('day'), moment().endOf('day')]
                },
                opens: 'right'
            });
        
            $('#view_sale_report_daterange').on('apply.daterangepicker', function (ev, pickerAll) {
                if (listAllItemreport !== "Custom" && !applyAllClickedreport) {
                    pickerAll.show();
                    applyAllClickedreport = false;
                } else {
                    pickerAll.hide();
                    applyAllClickedreport = false;
                    $('#view_sale_report_daterange span').html(
                        '<span>' + $('.ranges ul li.active').data('range-key') +
                        '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' +
                        pickerAll.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerAll.endDate.format('YYYY/MM/DD h:mm A') +
                        '"><i class="feather icon-help-circle setfeather_font"></i></span>'
                    );
                    $('#view_sale_report_daterange').val(
                        pickerAll.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerAll.endDate.format('YYYY/MM/DD h:mm A')
                    );
                }
            });
        
            $(".allTimedatePickerApplyClasses").click(function () {
                applyAllClickedreport = true;
            });
        
        // Daily Sale Report daterangepicker
        let listDailyItem, applyDailyClicked = false;
        let startDaily = moment().startOf('day');
        let endDaily = moment().endOf('day');
        let labelDaily = 'Today';
        $('#view_dailysale_report_daterange span').html('<span>' + labelDaily + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="top" data-original-title="' + startDaily.format('YYYY/MM/DD h:mm A') + ' - ' + endDaily.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('#view_dailysale_report_daterange').val(startDaily.format('YYYY/MM/DD h:mm A') + ' - ' + endDaily.format('YYYY/MM/DD h:mm A'));
        $('#view_dailysale_report_daterange').daterangepicker({
            showDropdowns: true,
            alwaysShowCalendars: true,
            autoApply: false,
            autoUpdateInput: false,
            autoclose: false,
            timePicker: true,
            applyButtonClasses: "btn-success dailyDatePickerApplyClasses",
            locale: {
                format: 'YYYY/MM/DD h:mm A',
                applyLabel: "Choose",
                cancelLabel: "Close",
                customRangeLabel: "Custom"
            },
            startDate: moment().startOf('day'),
            endDate: moment().endOf('day'),
            maxDate: moment().endOf('day'),
            ranges: {
                'Today': [moment().startOf('day'), moment().endOf('day')],
                'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
                'This Month': [moment().startOf('month').startOf('day'), moment().endOf('month').endOf('day')],
                'This Year': [moment().startOf('year').startOf('day'), moment().endOf('day')]
            },
            opens: 'right'
        });

        $('#view_dailysale_report_daterange').on('apply.daterangepicker', function (ev, pickerDaily) {
            if (listDailyItem !== "Custom" && !applyDailyClicked) {
                pickerDaily.show();
                applyDailyClicked = false;
            } else {
                pickerDaily.hide();
                applyDailyClicked = false;
                $('#view_dailysale_report_daterange span').html(
                    '<span>' + $('.ranges ul li.active').data('range-key') +
                    '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' +
                    pickerDaily.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerDaily.endDate.format('YYYY/MM/DD h:mm A') +
                    '"><i class="feather icon-help-circle setfeather_font"></i></span>'
                );
                $('#view_dailysale_report_daterange').val(
                    pickerDaily.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerDaily.endDate.format('YYYY/MM/DD h:mm A')
                );
            }
        });

        $(".dailyDatePickerApplyClasses").click(function () {
            applyDailyClicked = true;
        });

        // KOT Report daterangepicker
        let listKotItem, applyKotClicked = false;
        let startKot = moment().startOf('day');
        let endKot = moment().endOf('day');
        let labelKot = 'Today';
        $('#view_kot_report_daterange span').html('<span>' + labelKot + '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="top" data-original-title="' + startKot.format('YYYY/MM/DD h:mm A') + ' - ' + endKot.format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('#view_kot_report_daterange').val(startKot.format('YYYY/MM/DD h:mm A') + ' - ' + endKot.format('YYYY/MM/DD h:mm A'));
        $('#view_kot_report_daterange').daterangepicker({
            showDropdowns: true,
            alwaysShowCalendars: true,
            autoApply: false,
            autoUpdateInput: false,
            autoclose: false,
            timePicker: true,
            applyButtonClasses: "btn-success kotDatePickerApplyClasses",
            locale: {
                format: 'YYYY/MM/DD h:mm A',
                applyLabel: "Choose",
                cancelLabel: "Close",
                customRangeLabel: "Custom"
            },
            startDate: moment().startOf('day'),
            endDate: moment().endOf('day'),
            maxDate: moment().endOf('day'),
            ranges: {
                'Today': [moment().startOf('day'), moment().endOf('day')],
                'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
                'This Month': [moment().startOf('month').startOf('day'), moment().endOf('month').endOf('day')],
                'This Year': [moment().startOf('year').startOf('day'), moment().endOf('day')]
            },
            opens: 'right'
        });

        $('#view_kot_report_daterange').on('apply.daterangepicker', function (ev, pickerKot) {
            if (listKotItem !== "Custom" && !applyKotClicked) {
                pickerKot.show();
                applyKotClicked = false;
            } else {
                pickerKot.hide();
                applyKotClicked = false;
                $('#view_kot_report_daterange span').html(
                    '<span>' + $('.ranges ul li.active').data('range-key') +
                    '</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' +
                    pickerKot.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerKot.endDate.format('YYYY/MM/DD h:mm A') +
                    '"><i class="feather icon-help-circle setfeather_font"></i></span>'
                );
                $('#view_kot_report_daterange').val(
                    pickerKot.startDate.format('YYYY/MM/DD h:mm A') + ' - ' + pickerKot.endDate.format('YYYY/MM/DD h:mm A')
                );
            }
        });

        $(".kotDatePickerApplyClasses").click(function () {
            applyKotClicked = true;
        });

    },

    /*
     * REMOVED 2026-08-21: getDashboardTotalAmounts and smallChartsData -
     * 147 lines that could not run (defined, never called, wrote to ids the
     * markup no longer had).
     *
     * REMOVED 2026-08-26, owner order "delete all chart related code":
     * getDashboardSalesPaymentModeData (the apex donut - its
     * #apex-circle-chart container was already gone from the markup),
     * getDashboardSalesPurchase and salesPurchaseGraphData (the amCharts
     * sales/purchase bars - no caller anywhere). The SERVER endpoints
     * dashboard/getDashboardPaymentModeData, dashboard/getDashboardSalesPurchase
     * and dashboard/getDashboardTotalAmounts stay: routed, modelled and
     * tested, and this repo is not the only possible caller.
     */

    getDashboardTopPerformers: function (filter) {
        var params = {
            url: 'dashboard/getDashboardTopPerformers',
            data: {
                filter: filter
            },
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $('#top_performer_name,#top_performer_email,#top_performer_designation').html('');
                $('#top_performer_sales_amount,#top_performer_sales_count').html('0');
                $('#top_performer_name').html(data.user_name);
                $('#top_performer_email').html(data.email);
                $('#top_performer_designation').html(data.user_type);
                $('#top_performer_sales_count').html(data.sales_count);
                $('#top_performer_sales_amount').number(data.sales_amount, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    getDashboardBestSellingProducts: function (filter) {
        var params = {
            url: 'dashboard/getDashboardBestSellingProducts',
            data: {
                filter: filter
            },
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data.best_selling_products;
                $("#tblBestSellingProducts").children('tbody').text('');
                if (Array.isArray(data) && data.length) {
                    var html = "";
                    var currency = PosnicPro.local.get('currencySign');
                    for (var b = 0; b < data.length; b++)
                    {
                        html = html + "<tr>";

                        html = html + "<td width='5%'>" + (b + 1) + "</td>";
                        html = html + "<td width='65%'>" + data[b]['item_name'] + "</td>";
                        html = html + "<td width='10%'>" + data[b]['total_qty'] + "</td>";
                        html = html + "<td width='20%'>" + currency + "&nbsp;<span class='number'>" + data[b]['total_amount'] + "</span></td>";

                        html = html + "</tr>";
                        $('.BestSellingitem').show();
                    }
                    $("#tblBestSellingProducts tbody").append(html);
                } else {
                    /* One branch. The two halves differed only in the words -
                       now a key - and in a column-span that does nothing to a
                       tbody, so keeping it for both changes neither. */
                    $("#tblBestSellingProducts tbody")
                        .text(PosnicPro.i18n.t('lang_empty_product_details', 'Your product details are empty'))
                        .css({"color": "#2554C7", "column-span": "4"});
                    $('.BestSellingitem').css('display', 'none');
                }
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    getDashboardExpiredProducts: function (filter) {
        var params = {
            url: 'dashboard/getDashboardExpiredProducts',
            data: {
                filter: filter
            },
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data.expired_stock_items;
                $("#expired_stock_table").children('tbody').text('');
                if (Array.isArray(data) && data.length) {
                    var html = "";
                    for (var b = 0; b < data.length; b++)
                    {
                        html = html + "<tr>";

                        html = html + "<td width='5%'>" + (b + 1) + "</td>";
                        html = html + "<td width='65%'>" + data[b]['item_name'] + "</td>";
                        html = html + "<td width='65%'>" + data[b]['quantity'] + "</td>";
                        html = html + "<td width='10%'>" + data[b]['expiry_date'] + "</td>";

                        html = html + "</tr>";
                        $('.Expireditem').show();
                    }
                    $("#expired_stock_table tbody").append(html);
                } else {
                    /* Same collapse as Best Selling above, for the same
                       reason: only the words differed. */
                    $("#expired_stock_table tbody")
                        .text(PosnicPro.i18n.t('lang_empty_product_details', 'Your product details are empty'))
                        .css({"color": "#2554C7", "column-span": "4"});
                    $('.Expireditem').css('display', 'none');
                }
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    getDashboardPendingActivities: function (filter) {
        var params = {
            url: 'dashboard/getPendingActivities',
            data: {
                filter: filter
            }
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $("#lstRecentActivities").text('');
                $("#OutstandingCustomersView").html('');
                if (Array.isArray(data) && data.length) {
                    var html = "";
                    var OutstandingCustomersView = "";
                    let outstandingCustomersModal = "";
                    var currency = PosnicPro.local.get('currencySign');
                    for (var r = 0; r < data.length; r++)
                    {
                        html = html + "<li class='media'>";
                        html = html + "<span class='mr-3 action-icon'> " + (r + 1) + " </span>";
                        html = html + "<div class='media-body'>";
                        html = html + "<h5 class='action-title badge badge-info-inverse font-14 py-2 px-3 mb-2 mr-1'>" + data[r]['name'] + "</h5>";
                        html = html + "<p class='my-3 font-15'>Wallet Balance :<span class='text-dark'>" + currency + "&nbsp;" + data[r]['wallet'].toFixed(2) + "</span></p>";
                        html = html + "<p class='my-3 font-15'>Partial sales Balance :<span class='text-dark'>" + currency + "&nbsp; -" + data[r]['pending'].toFixed(2) + "</span></p>";
                        html = html + "<p class='my-3 font-15'>Overall Due Balance :<span class='text-danger'>" + currency + "&nbsp; -" + data[r]['due'].toFixed(2) + "</span></p>";
                        html = html + "</div>";
                        html = html + "</li>";
                        if (r < 5) {
                            OutstandingCustomersView = OutstandingCustomersView + "<div class='customer-card'>";
                            OutstandingCustomersView = OutstandingCustomersView + "<span class='customer-name'>" + data[r]['name'] + "</span>";
                            OutstandingCustomersView = OutstandingCustomersView + "<div>";
                            OutstandingCustomersView = OutstandingCustomersView + "<p class='balance-text'> Wallet Balance: <strong class='positive-balance'>" + currency + "&nbsp;" + data[r]['wallet'].toFixed(2) + "</strong></p>";
                            OutstandingCustomersView = OutstandingCustomersView + "<p class='balance-text'>Partial Sales Balance: <strong class='negative-balance'>" + currency + "&nbsp; -" + data[r]['pending'].toFixed(2) + "</strong></p>";
                            OutstandingCustomersView = OutstandingCustomersView + "<p class='balance-text'>Overall Due Balance: <strong class='negative-balance'>" + currency + "&nbsp; -" + data[r]['due'].toFixed(2) + "</strong></p>";
                            OutstandingCustomersView = OutstandingCustomersView + "</div>";
                            OutstandingCustomersView = OutstandingCustomersView + "</div>";
                            outstandingCustomersModal = data[r]['outstandingCustomersModal'];
                        }
                    }
                    $("#lstRecentActivities").append(html);
                    $("#OutstandingCustomersView").append(OutstandingCustomersView);
                    // Check if outstanding customer modal was already shown in this session
                    let outstandingModalShown = PosnicPro.local.get('outstandingModalShown');
                    if (outstandingCustomersModal === false && !outstandingModalShown) {
                        $('#outstandingCustomersModal').modal('show');
                        // Mark that modal was shown in this session
                        PosnicPro.local.set('outstandingModalShown', 'true');
                    } else {
                        $("#outstandingCustomersModal").modal('hide');
                    }
                } else {
                    $("#lstRecentActivities").text('Outstanding customer details are empty');
                    $("#lstRecentActivities").css({"color": "#2554C7"});
                }
                $('span.number').number(true, 2);

            } else {
                PosnicPro.alert(response.type, response.message);
            }
            $(".loader-login").find(".loadingSpinner:first").remove();
            return false;
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },


    /*
     * REMOVED 2026-08-21: getDashboardCurrentWish.
     *
     * This one was not merely dead - it ran. It fired on every document.ready,
     * fetched dashboard/getDashboardCurrentWish, and wrote the greeting into
     * #current_wish and the daily quote into #current_quote. Neither element
     * has existed since the dashboard was redesigned, so the whole response was
     * discarded: one round trip per page load for nothing.
     *
     * And its failure path was worse than its success path. A non-success
     * response called PosnicPro.alert, so an endpoint having a bad day put an
     * error toast on screen about a feature the user cannot see.
     *
     * The server endpoint is left in place, as with getDashboardTotalAmounts.
     * If the greeting is wanted back, the markup is what has to return - the
     * fetch was never the missing part.
     */

    //Day, Week, Month, Year
    /*
     * The profit summary for the selected period: what came in, what the goods
     * cost, what else was spent, and what is left. The server does the sums off
     * the cost recorded on each sale, so the margin is real, not estimated.
     */
    getProfitSummary: function (filter) {
        // The card is removed by ACL for users without financial access; if it
        // is not on the page there is nothing to fill, and no reason to ask the
        // server for figures they are not allowed to see.
        if (!$('#profit_net').length) { return; }
        var params = { url: 'dashboard/getProfitSummary', data: { filter: filter } };
        PosnicPro.get(params, function (response) {
            if (response.type !== 'success') { return; }
            var d = response.data || {};
            var cur = PosnicPro.local.get('currencySign') || '';
            var money = function (v) {
                return cur + ' ' + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            };
            var period = filter || 'month';

            $('#profit_revenue').text(money(d.revenue));
            $('#profit_cogs').text(money(d.cogs));
            $('#profit_gross').text(money(d.gross_profit));
            $('#profit_expenses').text(money(d.expenses));

            var net = Number(d.net_profit) || 0;
            $('#profit_net').text(money(net))
                .removeClass('text-success text-danger')
                .addClass(net >= 0 ? 'text-success' : 'text-danger');
            $('#profit_margin').text((Number(d.margin_percent) || 0) + '% margin');
            $('#profit_period_label').text('(' + period + ')');
            $('#profit_sales_count').text((d.sales_count || 0) + ' sale' + (d.sales_count === 1 ? '' : 's'));
            $('#profit_cashflow_note').text(
                ' Stock bought this ' + period + ': ' + money(d.purchases) +
                '. Cash in minus out: ' + money(d.cash_flow) + '.'
            );
        }, function () { });
    },

    // Currency comes from the shop's own setting, never a hard-coded symbol -
    // an INR shop must never see a dollar sign, least of all if the API fails.
    money: function (v) {
        var cur = PosnicPro.local.get('currencySign') || '';
        return cur + ' ' + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    /*
     * The whole dashboard, from one request.
     *
     * Every user lands here first, so it now makes a single call and renders
     * from that - no eight-request burst, no heavy chart libraries. It shows a
     * quiet loading state first and never leaves a stale or invented number on
     * screen: if the call fails, the figures fall back to a dash, not a made-up
     * amount in the wrong currency.
     */
    periodLabel: function (filter) {
        return { day: 'Today', week: 'This Week', month: 'This Month', year: 'This Year' }[filter] || 'Today';
    },

    // Time-of-day greeting, worked out on the client so it costs no request.
    greeting: function () {
        var h = new Date().getHours();
        var wish = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : h < 21 ? 'Good Evening' : 'Good Night';
        // Greet the logged-in USER by first name, not the shop/branch name.
        var name = (PosnicPro.local.get('userfirstname') || PosnicPro.local.get('username') || '').trim();
        $('#dashboard_greeting').text(wish + (name ? ', ' + name : ''));
    },

    // Keep the dashboard on one screen. When nobody owes money the Customer Dues
    // card is sized to match Best Sellers beside it (instead of standing tall and
    // empty and forcing a page scroll); when there are real dues, it grows to fit.
    syncDuesHeight: function () {
        var dues = $('#lstRecentActivities').closest('.card');
        var best = $('#tblBestSellingProducts').closest('.card');
        if (!dues.length || !best.length) { return; }
        var hasData = $('#lstRecentActivities > li').not('.text-muted').length > 0;
        dues.css('height', hasData ? 'auto' : best.outerHeight() + 'px');
    },

    KPI_IDS: '#kpi_sales,#kpi_purchase,#kpi_expenses,#kpi_tax,#kpi_upi,#kpi_cash',

    loadOverview: function (filter) {
        PosnicPro.dashboard.greeting();
        $(PosnicPro.dashboard.KPI_IDS).text('…');
        $('#kpi_period_label').text('(' + PosnicPro.dashboard.periodLabel(filter) + ')');

        PosnicPro.get({ url: 'dashboard/getOverview', data: { filter: filter } }, function (response) {
            /* crash-hunt probe gate: skippable render */
            if (window.__posnicSkip === 'overview' || window.__posnicSkip === 'all') { return; }
            if (response.type !== 'success' || !response.data) {
                $(PosnicPro.dashboard.KPI_IDS).html('&mdash;');
                return;
            }
            var d = response.data;
            var m = PosnicPro.dashboard.money;
            var k = d.kpis;
            if (k) {
                $('#kpi_sales').html(m(k.total_sales));
                $('#kpi_purchase').html(m(k.total_purchase));
                $('#kpi_expenses').html(m(k.total_expenses));
                $('#kpi_tax').html(m(k.total_tax));
                $('#kpi_upi').html(m(k.total_upi));
                $('#kpi_cash').html(m(k.total_cash));
            } else {
                // No financial layer for this user - the tiles are ACL-removed
                // anyway; leave nothing behind if the block is somehow present.
                $(PosnicPro.dashboard.KPI_IDS).html('&mdash;');
            }

            PosnicPro.dashboard.renderBestSellers(d.topItems || []);
            PosnicPro.dashboard.renderProfit(d.profit, filter);
            // Let the layout settle, then match the empty dues card to Best Sellers.
            setTimeout(function () { PosnicPro.dashboard.syncDuesHeight(); }, 60);
        }, function () {
            $(PosnicPro.dashboard.KPI_IDS).html('&mdash;');
        });
    },

    renderBestSellers: function (items) {
        var esc = function (v) { return $('<div>').text(v == null ? '' : v).html(); };
        var tbody = $('#tblBestSellingProducts tbody');
        if (!tbody.length) { return; }
        if (!items.length) {
            tbody.html('<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">No sales in this period</td></tr>');
            return;
        }
        var html = '';
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            html += '<tr><td>' + (i + 1) + '</td><td>' + esc(it.item_name) + '</td><td>' + (it.total_qty || 0) + '</td><td>' + PosnicPro.dashboard.money(it.total_amount) + '</td></tr>';
        }
        tbody.html(html);
    },

    /* renderPaymentMix removed with the chart purge - no caller and no
       #apex-circle-chart container anywhere in the markup. */

    renderProfit: function (profit, filter) {
        if (!$('#profit_net').length) { return; } // hidden for non-financial users
        if (!profit) { return; }
        var money = PosnicPro.dashboard.money;
        $('#profit_revenue').html(money(profit.revenue));
        $('#profit_cogs').html(money(profit.cogs));
        $('#profit_gross').html(money(profit.gross_profit));
        $('#profit_expenses').html(money(profit.expenses));
        $('#profit_margin').text((Number(profit.margin_percent) || 0) + '% margin');
        $('#profit_period_label').text('(' + PosnicPro.dashboard.periodLabel(filter) + ')');
        $('#profit_sales_count').text((profit.sales_count || 0) + ' sale' + (profit.sales_count === 1 ? '' : 's'));

        // Profit is only as honest as the cost data behind it. When cost prices
        // are missing or implausible (cost above sales), show the figure as an
        // estimate - not a confident green profit or an alarming red loss - and
        // say plainly what to fix, so a data gap never reads as a real loss.
        var reliable = profit.cost_reliable !== false;
        var netEl = $('#profit_net').removeClass('text-success text-danger text-muted');
        if (reliable) {
            var net = Number(profit.net_profit) || 0;
            netEl.attr('title', '').html(money(net)).addClass(net >= 0 ? 'text-success' : 'text-danger');
            $('#profit_gross').attr('title', '').html(money(profit.gross_profit));
            $('#profit_cashflow_note').text(' Stock bought this ' + (filter || 'period') + ': ' + money(profit.purchases) + '. Cash in minus out: ' + money(profit.cash_flow) + '.');
        } else {
            // Profit that cannot be worked out honestly is shown as N/A, never as
            // a number - a missing purchase price must never read as a real loss.
            // Hovering the figure says why (some items have no purchase price).
            var why = Number(profit.cost_missing_sales) > 0
                ? profit.cost_missing_sales + ' of ' + (profit.sales_count || 0) + " sales include items with no purchase price recorded, so profit can't be worked out yet."
                : "The recorded cost is higher than sales - check the items' cost (company) prices.";
            netEl.attr('title', why).html('N/A').addClass('text-muted');
            $('#profit_gross').attr('title', why).html('N/A');
            $('#profit_cashflow_note').text('⚠ ' + why);
        }
    },

    activeInActiveFilterButtons: function (filter, obj) {
        var arrBtns = ['btnDashboardCountYear', 'btnDashboardCountMonth', 'btnDashboardCountWeek', 'btnDashboardCountDay'];

        for (var i = 0; i < arrBtns.length; i++)
        {
            $("#" + arrBtns[i]).removeClass("active");
        }
        $("#" + obj.id).addClass("active");
        /*
         * The module gates, again, here.
         *
         * applyModuleSidebar runs at login and after a modules save, but the
         * dashboard's own markup is fetched when its route opens - after that
         * has already run. Without this the Customer Dues panel would appear
         * for a shop with credit switched off until something else happened to
         * re-apply the gates.
         */
        if (PosnicPro.applyModuleSidebar) { PosnicPro.applyModuleSidebar(); }

        // One request for the whole dashboard - see loadOverview.
        PosnicPro.dashboard.loadOverview(filter);
    },
    outstandingCustomerViewAllClick: function () {
        $("#outstandingCustomersModal").modal('hide');
        window.location.href = "#/customerreport";
        $("#customer-tab-line").trigger("click");
        // Delay to ensure the first tab function executes before the second one
        setTimeout(function () {
            $("#customer-outstanding-tab-line").trigger("click");
        }, 500); // Adjust delay (1000ms = 1s) if needed
    }
};
$(document).ready(function () {
    /* The label is the language's own name. Nothing stored means nothing
       chosen yet; buildLanguageMenu settles it once the shipped list is in.
       It is NOT written back here: a stored value looks exactly like a
       choice, and would stop the first-run detection from ever running. */
    $('.select_language').html(PosnicPro.local.get('language') || 'English');
});

/* Type sizes and spacing a language needs, settled here rather than by
   loading a different page. Tamil runs long in the sidebar and report tabs. */
function posnicLanguageStyling(code) {
    $('.report_tab_font').toggleClass('tamil_font14', code === 'ta');
    $('.vertical-menu').toggleClass('tamil_verticalmenu', code === 'ta');
    $('.top_sales_tamil').toggleClass('card_tamil_padding', code === 'ta');
    $('.tamil_qty').toggleClass('sales_tamil_padding', code === 'ta');
    $('.discount_tamil_right').toggleClass('pull-right', code !== 'ta');
}

/*
 * Build the language menu from what the build actually shipped.
 *
 * Every language used to need its own hand-written <a> in header.html. Now the
 * list comes from languages/index.json, so adding one is a file and a line of
 * config - never markup.
 *
 * The menu keeps its English entry if this fails: an unreadable list should
 * cost the OTHER languages, never leave a shop with no way to choose at all.
 */
(function buildLanguageMenu() {
    var menu = document.getElementById('change_language');
    if (!menu || typeof fetch !== 'function') return;
    fetch('languages/index.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (list) {
            if (!Array.isArray(list) || !list.length) return;
            menu.innerHTML = list.map(function (l) {
                /*
                 * An unreviewed language says so. "beta" is the one word every
                 * script here reads, and the tooltip carries the number a
                 * translator wants to see move. This honesty is what lets
                 * every language ship: the shopkeeper knows what they are
                 * picking, and every missing word is still English.
                 */
                var note = l.reviewed === false
                    ? ' <small class="text-muted lang-beta">beta</small>' : '';
                var title = typeof l.coverage === 'number'
                    ? ' title="' + l.coverage + '% translated'
                        + (l.reviewed === false ? ', not yet reviewed by a speaker' : '') + '"'
                    : '';
                /*
                 * The NAME is isolated with <bdi>, not the row. dir="rtl" on the
                 * anchor mirrored the whole entry - flag on the right, "beta"
                 * before the name - in a menu every other row reads left to
                 * right. <bdi> lets Arabic shape and order its own letters and
                 * leaves the row alone.
                 */
                return '<a class="dropdown-item" href="javascript:void(0)" data-code="' + l.code + '"'
                    + ' data-value="' + l.name + '"' + title + '>'
                    + '<i class="flag flag-icon-' + (l.flag || 'us') + ' flag-icon-squared"></i> '
                    + '<bdi>' + l.name + '</bdi>' + note + '</a>';
            }).join('');

            /* The label and the type sizes follow the SETTLED language - after
               the first-run detection in PosnicPro.i18n has had its say. */
            PosnicPro.i18n.ready.then(function () {
                var current = PosnicPro.i18n.code();
                var entry = null;
                for (var i = 0; i < list.length; i++) {
                    if (list[i].code === current) entry = list[i];
                }
                if (entry) {
                    $('.select_language').html(entry.name);
                    PosnicPro.local.set('language', entry.name);
                }
                posnicLanguageStyling(current);
            });
        })
        .catch(function () { /* the English entry in the markup stands */ });
}());

$('#change_language').on('click', 'a', function () {
    var nav_language = $(this).data('value');
    var nav_id = $(this).data('code');

    // Persist selected language for subsequent loads, and say so in the
    // header now: there is no navigation any more to redraw the label.
    PosnicPro.local.set('language', nav_language);
    $('.select_language').html(nav_language);

    /*
     * No navigation. There used to be a page per language, so switching meant
     * loading ta_dashboard.html and losing everything on screen. There is one
     * page now: change() records the code, fetches that language's words and
     * redraws in place, which is both simpler and instant.
     *
     * The menu carries the code itself now. A filename is still tolerated so a
     * cached older header cannot break the switcher on the first load after an
     * update.
     */
    var code = /^[a-z]{2}$/.test(nav_id) ? nav_id
        : (/^([a-z]{2})_/.test(nav_id) ? nav_id.slice(0, 2) : 'en');
    PosnicPro.i18n.change(code).then(function () { posnicLanguageStyling(code); });
});
jQuery(document).ready(function () {
    console.log('WORKING');
    /* Tamil needs its own type sizes and menu spacing. Asked of the language,
       not of the URL - the filename stops being the language as soon as the
       HTML is no longer built per language. */
    if (PosnicPro.i18n.is('ta')) {
        $('.report_tab_font').addClass('tamil_font14');
        $('.vertical-menu').addClass('tamil_verticalmenu');
        $('.top_sales_tamil').addClass('card_tamil_padding');
        $('.tamil_qty').addClass('sales_tamil_padding');
        $('.discount_tamil_right').removeClass('pull-right');
    } else {
        $('.tamil_qty').removeClass('sales_tamil_padding');
        $('.top_sales_tamil').removeClass('card_tamil_padding');

    }
});

//   customer tab

$('#customerdisplay').click(function () {
    PosnicPro.HideSideBarModal();
    $('#image_sidebar_customsdetails,#image_sidebar_customsearch').hide();
    $('#image_sidebar_customview').show();
});
$('#view_customersearch').click(function () {
    PosnicPro.HideSideBarModal();
    $('#image_sidebar_customview,#image_sidebar_customsdetails').hide();
    $('#image_sidebar_customsearch').show();
});
$('#dashboard_page').click(function () {
    let objDay = document.getElementById('btnDashboardCountDay');
    PosnicPro.dashboard.activeInActiveFilterButtons('day', objDay);
});
var _duesResizeTimer;
$(window).on('resize', function () {
    // Debounced: run once after resize settles, not on every frame - reading
    // outerHeight() mid-drag forced a full reflow and made resizing janky.
    clearTimeout(_duesResizeTimer);
    _duesResizeTimer = setTimeout(function () {
        if (PosnicPro.dashboard && PosnicPro.dashboard.syncDuesHeight) PosnicPro.dashboard.syncDuesHeight();
    }, 150);
});
/* -- Sweet Alert - Warning -- */
$("#logout").on("click", function () {
    // Check if user has session filter permission
    var isSessionFilterUser = false;
    if (typeof PosnicPro !== 'undefined' && PosnicPro.userACL && PosnicPro.userACL.sales && PosnicPro.userACL.sales.session_filter === true) {
        isSessionFilterUser = true;
    }
    
    // Set different messages for session filter users vs regular users
    var title, text;
    if (isSessionFilterUser) {
        title = 'Are you sure want to logout?';
        text = 'Session filter will be deactivated and your old details will not be available until next login.';
    } else {
        title = 'Are you sure want to logout?';
        text = '';
    }
    
    swal({
        title: title,
        text: text,
        showCancelButton: true,
        confirmButtonClass: 'btn btn-primary',
        cancelButtonClass: 'btn btn-danger m-l-10',
        confirmButtonText: 'Yes',
        cancelButtonText: 'No'
    }).then(function () {
        PosnicPro.users.logoutCheck();
    }, function () {});
});

/*
 * Setup checklist (Lightspeed study LS1). Cards come from LIVE server-side
 * checks - the strip disappears the moment reality changes, and Dismiss is
 * a per-browser choice, never a stored "done" that can lie.
 */
PosnicPro.dashboard.SETUP_CARDS = {
    /* {branch} resolves to THIS till's branch at render - the outlet card
       lands on the outlet's own edit page, not on a settings section that
       no longer exists ("#/settings/branches" was the broken page the owner
       walked into from the desktop). */
    outlet: { label: 'Set up your outlet info', hint: 'Address and phone print on receipts', hash: '#/branches/{branch}/edit' },
    items: { label: 'Add your first items', hint: 'Or import them from a file', hash: '#/items/new' },
    receipt: { label: 'Add your logo', hint: 'It shows on receipts and the dashboard', hash: '#/branches/{branch}/edit' },
    employees: { label: 'Add your employees', hint: 'Each gets their own login and role', hash: '#/users' },
    taxes: { label: 'Set up taxes', hint: 'Rates apply to every sale automatically', hash: '#/settings/taxmodule' }
};
PosnicPro.dashboard.loadSetupChecklist = function () {
    if (PosnicPro.local.get('setup_checklist_dismissed') === 'true') { return; }
    PosnicPro.get({ url: 'dashboard/setupChecklist', data: '' }, function (response) {
        var checks = (response && response.data && response.data.checks) || [];
        var undone = checks.filter(function (c) { return !c.done; });
        if (!undone.length) { $('#setup_checklist_strip').hide(); return; }
        var branchId = PosnicPro.local.get('branch_id_set') || '';
        var html = undone.map(function (c) {
            var card = PosnicPro.dashboard.SETUP_CARDS[c.key];
            if (!card) { return ''; }
            var hash = branchId
                ? card.hash.replace('{branch}', branchId)
                : card.hash.replace('/{branch}/edit', '');
            return '<a href="' + hash + '" class="border rounded p-2 d-block" style="min-width:180px;text-decoration:none;">' +
                '<div style="font-weight:600;font-size:.85rem;"><i class="feather icon-circle mr-1"></i>' + card.label + '</div>' +
                '<small class="text-muted">' + card.hint + '</small>' +
                '</a>';
        }).join('');
        $('#setup_checklist_cards').html(html);
        $('#setup_checklist_strip').show();
    }, function () { /* the dashboard must never break over a nicety */ });
};
PosnicPro.dashboard.dismissSetupChecklist = function () {
    PosnicPro.local.set('setup_checklist_dismissed', 'true');
    $('#setup_checklist_strip').hide();
};
$(document).ready(function () {
    setTimeout(function () { PosnicPro.dashboard.loadSetupChecklist(); }, 1800);
});
