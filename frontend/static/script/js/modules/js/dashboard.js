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
                var chart = new ApexCharts(chartContainer, options);
                chart.render();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    getDashboardTotalAmounts: function (filter) {
        var params = {
            url: 'dashboard/getDashboardTotalAmounts',
            data: {
                filter: filter
            }
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                // sales count
                $('#dashboard_sales_count').html(data.total_data.Total_Sales_Amount);
                $('#dashboard_purchase_count').html(data.total_data.Total_Purchase_Amount);
                $('#dashboard_return_count').html(data.total_data.Total_Return_Amount);
                $('#dashboard_return_purchase_count').html(data.total_data.Total_returnpurchase_Amount);


                // Getting sum of array
                var sales_total = data.list_data.sales_y_axis.reduce(function (a, b) {
                    return a + b;
                }, 0);
                var purchase_total = data.list_data.purchase_y_axis.reduce(function (a, b) {
                    return a + b;
                }, 0);
                var return_total = data.list_data.return_y_axis.reduce(function (a, b) {
                    return a + b;
                }, 0);
                var return_purchase_total = data.list_data.purchasereturn_y_axis.reduce(function (a, b) {
                    return a + b;
                }, 0);

                $('#dashboard_sales_amount').number(sales_total, 2);
                $('#dashboard_purchase_amount').number(purchase_total, 2);
                $('#dashboard_return_amount').number(return_total, 2);
                $('#dashboard_return_purchases_amount').number(return_purchase_total, 2);

                var chart_data = new Array();
                //For Sales
                chart_data['color_code'] = "#506fe4";
                chart_data['chart_name'] = "Sales";
                chart_data['chart_id'] = "apex-line-chart-sales";
                chart_data['arrX'] = data.list_data.sales_x_axis;
                chart_data['arrY'] = data.list_data.sales_y_axis;
                PosnicPro.dashboard.smallChartsData(chart_data);

                //For Purchase
                chart_data['color_code'] = "#43d187";
                chart_data['chart_name'] = "Purchase";
                chart_data['chart_id'] = "apex-line-chart-purchase";
                chart_data['arrX'] = data.list_data.purchase_x_axis;
                chart_data['arrY'] = data.list_data.purchase_y_axis;
                PosnicPro.dashboard.smallChartsData(chart_data);

                //For Return
                chart_data['color_code'] = "#506fe4";
                chart_data['chart_name'] = "Return";
                chart_data['chart_id'] = "apex-line-chart-return";
                chart_data['arrX'] = data.list_data.return_x_axis;
                chart_data['arrY'] = data.list_data.return_y_axis;
                PosnicPro.dashboard.smallChartsData(chart_data);

                //For Purchase Return
                chart_data['color_code'] = "#506fe4";
                chart_data['chart_name'] = "Return Purchase";
                chart_data['chart_id'] = "apex-line-chart-purchasereturn";
                chart_data['arrX'] = data.list_data.purchasereturn_x_axis;
                chart_data['arrY'] = data.list_data.purchasereturn_y_axis;
                PosnicPro.dashboard.smallChartsData(chart_data);

            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

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

            // Create chart instance
            PosnicPro.dashboard.sales_purchase_chart = PosnicPro.chart.create("chartdiv", am4charts.XYChart3D);
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

            // Create series
            var series = PosnicPro.dashboard.sales_purchase_chart.series.push(new am4charts.ColumnSeries3D());
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

            var paretoSeries = PosnicPro.dashboard.sales_purchase_chart.series.push(new am4charts.ColumnSeries3D())
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

    smallChartsData: function (data) {
        var myobj = document.getElementById(data['chart_id']);
        myobj.remove();

        var newDiv = document.createElement("div");
        newDiv.id = data['chart_id'];
        var element = document.getElementById(data['chart_id'] + "-parent");
        element.appendChild(newDiv);

        var options = {
            chart: {
                height: 50,
                type: 'line',
                sparkline: {
                    enabled: true
                },
                toolbar: {
                    show: false
                },
                zoom: {
                    enabled: false
                }
            },
            colors: [data['color_code']],
            series: [{
                    name: data['chart_name'],
                    data: data['arrY']
                }],
            dataLabels: {
                enabled: false
            },
            stroke: {
                curve: 'smooth',
                width: 2
            },
            grid: {
                row: {
                    colors: ['transparent', 'transparent'], opacity: .2
                },
                borderColor: 'transparent'
            },
            yaxis: {
                min: 0
            },
            xaxis: {
                categories: data['arrX'],
                axisBorder: {
                    show: true,
                    color: 'rgba(0,0,0,0.05)'
                },
                axisTicks: {
                    show: true,
                    color: 'rgba(0,0,0,0.05)'
                }
            }
        }
        // Same guard as the payment-mode chart: this can be called after the
        // operator has left the dashboard, and rendering into a missing
        // container throws on offsetWidth.
        var salesChartEl = document.querySelector("#" + data['chart_id']);
        if (!salesChartEl) {
            return;
        }
        var sales_chart = new ApexCharts(salesChartEl, options);
        sales_chart.render();
    },

    getDashboardCurrentWish: function () {
        var params = {
            url: 'dashboard/getDashboardCurrentWish'
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                //Set Good morning, noon etc
                var nav_href = PosnicPro.local.get('language_herf');
                $.each(response.data.quotes, function (index, val) {
                    if (val.id == response.data.current_date)
                    {
                        if (nav_href !== 'dashboard.html') {
                            $("#current_wish").html('வணக்கம்...');
                            $("#current_quote").html(val.tamilquote);
                        } else {
                            $("#current_wish").html(response.data.current_wish);
                            $("#current_quote").html(val.quote);
                        }
                    }
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    //Day, Week, Month, Year
    /*
     * The profit summary for the selected period: what came in, what the goods
     * cost, what else was spent, and what is left. The server does the sums off
     * the cost recorded on each sale, so the margin is real, not estimated.
     */
    getProfitSummary: function (filter) {
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

    activeInActiveFilterButtons: function (filter, obj) {
        var arrBtns = ['btnDashboardCountYear', 'btnDashboardCountMonth', 'btnDashboardCountWeek', 'btnDashboardCountDay'];

        for (var i = 0; i < arrBtns.length; i++)
        {
            $("#" + arrBtns[i]).removeClass("active");
        }
        $("#" + obj.id).addClass("active");
        //Call All other corresponding Functions
        PosnicPro.dashboard.getProfitSummary(filter);
        PosnicPro.dashboard.getDashboardSalesPaymentModeData(filter);
        PosnicPro.dashboard.getDashboardTotalAmounts(filter);
        PosnicPro.dashboard.getDashboardSalesPurchase(filter);
        PosnicPro.dashboard.getDashboardTopPerformers(filter);
        PosnicPro.dashboard.getDashboardBestSellingProducts(filter);
        PosnicPro.dashboard.getDashboardExpiredProducts(filter);
        PosnicPro.dashboard.getDashboardPendingActivities(filter);
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
    PosnicPro.dashboard.getDashboardCurrentWish();
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
    let objMonth = document.getElementById('btnDashboardCountMonth');
    PosnicPro.dashboard.activeInActiveFilterButtons('month', objMonth);
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
        confirmButtonClass: 'btn btn-outline-primary',
        cancelButtonClass: 'btn btn-outline-danger m-l-10',
        confirmButtonText: 'Yes',
        cancelButtonText: 'No'
    }).then(function () {
        PosnicPro.users.logoutCheck();
    }, function () {});
});
