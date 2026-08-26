PosnicPro.dashboard = {
    sales_purchase_chart: '',
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

    getDashboardSalesPaymentModeData: function (filter) {
        let loader = $(".loader-login");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var params = {
            url: 'dashboard/getDashboardPaymentModeData',
            data: {
                filter: filter
            },
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;

                /*
                 * The payment data arrives asynchronously. If the operator has
                 * already left the dashboard for another screen, its
                 * #apex-circle-chart element is gone - and handing ApexCharts a
                 * null container is exactly what threw "Cannot read properties
                 * of null (reading 'offsetWidth')". There is nothing to draw
                 * into, so stop here rather than crash.
                 */
                var chartContainer = document.querySelector("#apex-circle-chart");
                if (!chartContainer) {
                    loader.find(".loadingSpinner:first").remove();
                    return;
                }
                /* Owner's rule: no charts on mobile at all - see
                   PosnicPro.chart.disabledHere. The donut is the note. */
                if (PosnicPro.chart.disabledHere()) {
                    loader.find(".loadingSpinner:first").remove();
                    chartContainer.innerHTML =
                        '<div class="chart-empty-state"><i class="icon-bar-chart"></i>' +
                        '<p>Charts are shown on the desktop version</p></div>';
                    return;
                }
                chartContainer.innerHTML = '';

                // Check if we have data to display
                if (!data.percentage_series || data.percentage_series.length === 0) {
                    chartContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #999;">No payment data available</div>';
                    loader.find(".loadingSpinner:first").remove();
                    return;
                }
                
                /* -- Apex Circle Chart -- */
                var options = {
                    chart: {
                        height: 300,
                        type: 'radialBar',
                        /* Same iOS rule as the amCharts guard: scrolling
                           collapses Safari's URL bar, each collapse is a
                           resize, and an animated redraw per resize is a
                           memory bill on a phone with no benefit. */
                        animations: {
                            enabled: !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches),
                        },
                        events: {
                            legendClick: function(chartContext, seriesIndex, config) {
                                // This will trigger the chart to update and show selected amount
                            }
                        }
                    },
                    plotOptions: {
                        radialBar: {
                            dataLabels: {
                                name: {
                                    fontSize: '14px',
                                    fontFamily: 'Mukta Vaani',
                                },
                                value: {
                                    fontSize: '12px',
                                    fontFamily: 'Mukta Vaani',
                                    formatter: function (val) {
                                        return parseFloat(val || 0).toFixed(2) + "%";
                                    }
                                },
                                total: {
                                    show: true,
                                    label: 'Total',
                                    formatter: function (w) {
                                        // Check if any series is selected/isolated
                                        var selectedSeries = w.globals.selectedDataPoints[0];
                                        if (selectedSeries && selectedSeries.length > 0) {
                                            // Show selected payment mode's amount
                                            var index = selectedSeries[0];
                                            var amount = data.paymode_data[index].amount || 0;
                                            var mode = data.pay_mode_series[index] || '';
                                            return mode + '\n₹' + amount.toFixed(2);
                                        } else {
                                            // Show total amount
                                            var totalAmount = data.total_amount || 0;
                                            return 'Total\n₹' + totalAmount.toFixed(2);
                                        }
                                    }
                                }
                            }
                        }
                    },
                    colors: ['#506fe4', '#43d187', '#f7bb4d', '#96a3b6', '#FF4560', '#775DD0', '#00E396',
                        '#FEB019', '#FF4560', '#775DD0'],
                    series: data.percentage_series,
                    labels: data.pay_mode_series,
                    legend: {
                        show: true,
                        position: 'bottom',
                        fontSize: '12px',
                        fontFamily: 'Mukta Vaani',
                        formatter: function(seriesName, opts) {
                            var index = opts.seriesIndex;
                            var amount = data.paymode_data[index].amount || 0;
                            var percentage = data.percentage_series[index] || 0;
                            return seriesName + ': ₹' + amount.toFixed(2) + ' (' + percentage.toFixed(2) + '%)';
                        }
                    },
                    tooltip: {
                        enabled: true,
                        fillSeriesColor: false,
                        y: {
                            formatter: function(val, opts) {
                                if (!opts || opts.seriesIndex === undefined) return '';
                                var index = opts.seriesIndex;
                                var amount = data.paymode_data[index] ? data.paymode_data[index].amount || 0 : 0;
                                var mode = data.pay_mode_series[index] || '';
                                var percentage = parseFloat(val || 0);
                                return mode + ': ₹' + amount.toFixed(2) + ' (' + percentage.toFixed(2) + '%)';
                            }
                        }
                    }
                };
                
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.lazy.load('apexcharts').then(function () {
                    // The operator may have left the dashboard while the
                    // library was fetched; rendering into a detached node
                    // throws on offsetWidth.
                    if (!chartContainer.isConnected) return;
                    var chart = new ApexCharts(chartContainer, options);
                    chart.render();
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    /*
     * REMOVED 2026-08-21: getDashboardTotalAmounts and smallChartsData.
     *
     * 147 lines that could not run. getDashboardTotalAmounts was defined and
     * never called - the only other mention of the name in the whole frontend
     * was its own url - and smallChartsData was called from nowhere else, so
     * both went together.
     *
     * Every id they wrote to had already been removed from the markup:
     * #dashboard_sales_count and its three siblings, #dashboard_sales_amount
     * and its three, and the four apex-line-chart-* containers. The dashboard
     * shows its numbers through the profit card now (#profit_revenue and
     * friends), which is live and tested.
     *
     * Worth deleting rather than leaving: smallChartsData opens with
     * `document.getElementById(id).remove()`, which throws on a missing
     * element. Anyone wiring this back up would get a TypeError, not a chart.
     *
     * The SERVER endpoint dashboard/getDashboardTotalAmounts is deliberately
     * left in place - it is routed, modelled and tested, and this repo is not
     * the only thing that can call it.
     */

    getDashboardSalesPurchase: function (filter) {
        var params = {
            url: 'dashboard/getDashboardSalesPurchase',
            data: {
                filter: filter
            }
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                PosnicPro.dashboard.salesPurchaseGraphData(data);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    salesPurchaseGraphData: function (sales_purchase_data) {
        //**** AM Charts - Sales Sample Data
        am4core.ready(function () {

            // Themes begin
            am4core.useTheme(am4themes_animated);
            // Themes end

            /*
             * The 3D chart is for desks; phones get the same chart flat.
             *
             * The owner's iPhone kept killing the tab while SCROLLING the
             * dashboard, and calming the theme and render queue was not
             * enough. ColumnSeries3D draws several SVG faces per column and
             * re-lays all of them out on every viewport resize - which iOS
             * fires continuously as the URL bar collapses under a scrolling
             * thumb. At phone size the depth effect is invisible anyway;
             * the flat twin carries the same data with a fraction of the
             * nodes. (The resize storm itself is stopped at
             * PosnicPro.chart.create for every chart on touch.)
             */
            var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

            // Create chart instance
            PosnicPro.dashboard.sales_purchase_chart = PosnicPro.chart.create(
                "chartdiv", coarse ? am4charts.XYChart : am4charts.XYChart3D);
            if (!PosnicPro.dashboard.sales_purchase_chart) return; // the panel is not on the page
            PosnicPro.dashboard.sales_purchase_chart.scrollbarX = new am4core.Scrollbar();

            // Add data
            PosnicPro.dashboard.sales_purchase_chart.data = sales_purchase_data;

            // Create axes
            var categoryAxis = PosnicPro.dashboard.sales_purchase_chart.xAxes.push(new am4charts.CategoryAxis());
            categoryAxis.dataFields.category = "month";
            categoryAxis.renderer.grid.template.location = 0;
            categoryAxis.renderer.minGridDistance = 60;
            categoryAxis.tooltip.disabled = true;

            var valueAxis = PosnicPro.dashboard.sales_purchase_chart.yAxes.push(new am4charts.ValueAxis());
            valueAxis.renderer.minWidth = 50;
            valueAxis.min = 0;
            valueAxis.cursorTooltipEnabled = false;

            // Create series - the flat twin on touch, see the chart comment
            var series = PosnicPro.dashboard.sales_purchase_chart.series.push(
                coarse ? new am4charts.ColumnSeries() : new am4charts.ColumnSeries3D());
            series.sequencedInterpolation = true;
            series.dataFields.valueY = "sales";
            series.dataFields.categoryX = "month";
            series.clustered = false;
            series.columns.template.tooltipText = "Sales: [{categoryX}: bold]{valueY}[/]";
            series.tooltip.background.cornerRadius = 20;
            series.columns.template.fillOpacity = 0.9;
            series.tooltip.pointerOrientation = "right";
            series.tooltipX = am4core.percent(100);

            // on hover, make corner radiuses bigger
            var hoverState = series.columns.template.column.states.create("hover");
            hoverState.properties.cornerRadiusTopLeft = 0;
            hoverState.properties.cornerRadiusTopRight = 0;
            hoverState.properties.fillOpacity = 1;

            // remove logo
            PosnicPro.dashboard.sales_purchase_chart.logo.disabled = true;

            series.columns.template.adapter.add("fill", function (fill, target) {
                return PosnicPro.dashboard.sales_purchase_chart.colors.getIndex(target.dataItem.index);
            });

            var paretoValueAxis = PosnicPro.dashboard.sales_purchase_chart.yAxes.push(new am4charts.ValueAxis());
            paretoValueAxis.renderer.opposite = true;
            paretoValueAxis.renderer.grid.template.disabled = true;
            paretoValueAxis.numberFormatter = new am4core.NumberFormatter();
            paretoValueAxis.cursorTooltipEnabled = false;

            var paretoSeries = PosnicPro.dashboard.sales_purchase_chart.series.push(
                coarse ? new am4charts.ColumnSeries() : new am4charts.ColumnSeries3D())
            paretoSeries.sequencedInterpolation = true;
            paretoSeries.dataFields.valueY = "purchase";
            paretoSeries.dataFields.categoryX = "month";
            paretoSeries.tooltipHTML = '<div style="margin-right:20px;"> Purchase: {valueY}</div>';
            paretoSeries.clustered = false;
            paretoSeries.columns.template.tooltipText = "Purchase: [{categoryX}: bold]{valueY}[/]";
            paretoSeries.tooltip.background.cornerRadius = 20;
            paretoSeries.columns.template.fillOpacity = 0.9;
            paretoSeries.tooltip.pointerOrientation = "left";
            paretoSeries.tooltipX = am4core.percent(0);

            // Cursor
            PosnicPro.dashboard.sales_purchase_chart.cursor = new am4charts.XYCursor();
            PosnicPro.dashboard.sales_purchase_chart.cursor.behavior = "panX";
        }); // end am4core.ready()
    },

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
                } else if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                    $("#tblBestSellingProducts tbody").text('உங்கள் தயாரிப்பு விவரங்கள் காலியாக உள்ளன.');
                    $("#tblBestSellingProducts tbody").css({"color": "#2554C7"});
                    $('.BestSellingitem').css('display', 'none');

                } else {
                    $("#tblBestSellingProducts tbody").text('Your product details are empty');
                    $("#tblBestSellingProducts tbody").css({"color": "#2554C7", "column-span": "4"});
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
                } else if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                    $("#expired_stock_table tbody").text('உங்கள் தயாரிப்பு விவரங்கள் காலியாக உள்ளன.');
                    $("#expired_stock_table tbody").css({"color": "#2554C7"});
                    $('.Expireditem').css('display', 'none');

                } else {
                    $("#expired_stock_table tbody").text('Your product details are empty');
                    $("#expired_stock_table tbody").css({"color": "#2554C7", "column-span": "4"});
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
            if (window.__posnicSkip === 'overview') { return; }
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

    // Light HTML bars instead of a chart library - the same information, none of
    // the megabytes. Rupee amounts only for a user allowed the financial layer.
    renderPaymentMix: function (mix, financials) {
        var box = $('#apex-circle-chart');
        if (!box.length) { return; }
        if (!mix.length) {
            box.html('<div class="text-center text-muted" style="padding:24px 8px;">No payments in this period</div>');
            return;
        }
        var esc = function (v) { return $('<div>').text(v == null ? '' : v).html(); };
        var colors = ['#506fe4', '#43d187', '#f7bb4d', '#96a3b6', '#FF4560', '#775DD0'];
        var html = '<div style="padding:10px 12px;">';
        for (var i = 0; i < mix.length; i++) {
            var m = mix[i];
            var pct = Number(m.pct) || 0;
            var right = financials && m.amount != null ? PosnicPro.dashboard.money(m.amount) : pct + '%';
            html += '<div style="margin-bottom:10px;">' +
                '<div style="display:flex; justify-content:space-between; font-size:13px;"><span>' + esc(m.mode) + '</span><span class="f-w-6">' + right + '</span></div>' +
                '<div style="height:6px; background:#eef0f3; border-radius:4px; overflow:hidden; margin-top:3px;"><div style="height:6px; width:' + pct + '%; background:' + colors[i % colors.length] + ';"></div></div>' +
                '</div>';
        }
        html += '</div>';
        box.html(html);
    },

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
$(document).ready(function (e) {
    var nav_lang = PosnicPro.local.get('language');
    $('.select_language').html(nav_lang);
    if ((nav_lang == null) || (nav_lang == '')) {
        $('.select_language').html('English');
        var nav_id = 'dashboard.html';
        PosnicPro.local.set('language_herf', nav_id);
    }

});
$('#change_language a').click(function () {
    var nav_language = $(this).data('value');
    var nav_id = $(this).data('id');

    // Persist selected language for subsequent loads
    PosnicPro.local.set('language', nav_language);
    PosnicPro.local.set('language_herf', nav_id);

    // Stay on the current host (localhost / custom domain / posnic.io) and
    // only swap the dashboard shell (dashboard.html <-> ta_dashboard.html),
    // preserving the current hash route (e.g. #/settings).
    var newPath = window.location.pathname.replace(/[^/]+$/, nav_id);
    window.location.href = newPath + window.location.hash;
});
jQuery(document).ready(function () {
    console.log('WORKING');
    var pathname = window.location.pathname.slice(1);
    if (pathname === 'ta_dashboard.html') {
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
