PosnicPro.userreport = {
    showDataTablePage: function () {
        var loader = $(".loader-user-report,.loader-user-graph-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#userreport_new').show();
        $('#v-pills-report-tab,#viewuserreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        if ($('a#user-tab-line').hasClass('active')) {
            PosnicPro.userreport.userTableTabClick();
        } else if ($('a#user-status-tab-line').hasClass('active')) {
            PosnicPro.userstatusreport.userStatusTabClick();
        } else {
            PosnicPro.usergraphicalreport.userGraphTabClick();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#user-line, #user-status-line, #user-graph-line').css('filter', 'blur(2px)');
            $('#userreport_exportbtn,#userstatusreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#user_upgrade').show();
        } else {
            $('#user-line, #user-status-line, #user-graph-line').css('filter', 'none');
            $('#userreport_exportbtn,#userstatusreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#user_upgrade').hide();
        }
    },
    userreportTable: function (type) {
        var branchId = $(".user_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-user-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_user_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_userreport');
            if (type === 'userreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_userreport_per_page  option:selected').text());
            }

            let user_id = ($(".users_input_id").val() !== '') ? $(".users_input_id").val() : '';
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".user_branch_value").val(),
                field_input: user_id
            };
            var params = {
                url: 'sales/userReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#userreport_exportbtn').removeAttr('disabled') : $('#userreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'userreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_userreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportuser_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportuser_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportuser_img_hide,.reportuser_norecord').show();

                        } else {
                            $('.reportuser_norecord').empty();
                            $('#reportuser_img_hide,.reportuser_norecord').hide();
                            $('.reportuser_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_userreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_userreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.user_name + '</td> <td class="text-center">' + row.sales_count + '</td> <td class="text-right">-' + currency + '&nbsp;<span class="number">' + row.refund_payment + '</span></td> <td class="text-right">' + currency + '&nbsp;<span>' + row.sales_profit.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_avg + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_payment + '</span></td></tr>';
                            $('#view_userreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }
                    } else {
                        var userreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.user_name;
                            var totalsale = val.sales_count;
                            var total = val.sales_payment;
                            var refund = val.refund_payment;
                            var profit = val.sales_profit;
                            var avg = val.sales_avg;
                            userreport.push({UserName: name, NoofSale: totalsale, ReturnAmount: refund, Profit: profit, AvgSale: avg, TotalAmount: total});
                        });
                        PosnicPro.JSONToCSVConvertor(userreport, 'user-sales-reports', true);
                        PosnicPro.userstatusreport.userstatusreportTable();
                        PosnicPro.userreport.userreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".user_branch_value").focus();
        }
    },
    userreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.userreport.userreportTable(type);
    },
    userTableTabClick: function () {
        $('#change_user_view').data('id', 'tableView');
        PosnicPro.userreport.userreportTable();
    }
};
PosnicPro.userstatusreport = {
    userstatusreportTable: function (type) {
        var branchId = $(".user_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-user-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('staffactivity');
            var daterange = $(".view_user_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_userstatusreport');
            if (type === 'userstatusreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_userstatusreport_per_page  option:selected').text());
            }
            let user_id = ($(".users_input_id").val() !== '') ? $(".users_input_id").val() : '';
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".user_branch_value").val(),
                field_input: user_id
            };
            var params = {
                url: 'users/userstatusReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#userstatusreport_exportbtn').removeAttr('disabled') : $('#userstatusreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'userstatusreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_userstatusreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportuserstatus_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportuserstatus_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportuserstatus_img_hide,.reportuserstatus_norecord').show(); 

                        } else {
                            $('.reportuserstatus_norecord').empty();
                            $('#reportuserstatus_img_hide,.reportuserstatus_norecord').hide();
                            $('.reportuserstatus_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_userstatusreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_userstatusreport_page_perpage_total').text(page_totals + response.data.list.length);
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var updateDate = PosnicPro.convertDate(row.string_date);
                            var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.user_name + '</td> <td>' + updateDate + '</td><td>' + row.branch_name + '</td><td>' + row.ip + '</td><td>' + row.device + '</td><td>' + row.os + '</td><<td>' + row.browser + '</td>/tr>';
                            $('#view_userstatusreport').children('tbody').append(trow);
                        }
                    } else {
                        var userstatusreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            let name = val.user_name;
                            let date = val.string_date;
                            let ip = val.ip;
                            let device = val.device;
                            let os = val.os;
                            let browser = val.browser;
                            userstatusreport.push({UserName: name, Date: date, IpAddress: ip, Device: device, Os: os, Browser: browser});
                        });
                        PosnicPro.JSONToCSVConvertor(userstatusreport, 'user-status-reports', true);
                        PosnicPro.userstatusreport.userstatusreportTable();
                        PosnicPro.userreport.userreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".user_branch_value").focus();
        }
    },
    userstatusreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.userstatusreport.userstatusreportTable(type);
    },
    userStatusTabClick: function () {
        $('#change_user_view').data('id', 'statusView');
        PosnicPro.userstatusreport.userstatusreportTable();
    }
}
PosnicPro.usergraphicalreport = {
    showGraphReport: function (weekdata) {
        /* An empty chart draws as a grey rectangle that reads as a failure. */
        if (!weekdata || !weekdata.length) {
            PosnicPro.chart.empty('user-payment-report-amchart-circle-chart',
                'No user activity in the selected period');
            return;
        }
        am4core.ready(function () {
            // Themes begin
            am4core.useTheme(am4themes_animated);
            // Themes end

            // Create chart instance
            var chart = PosnicPro.chart.create("user-payment-report-amchart-circle-chart", am4charts.PieChart);
            if (!chart) return; // the panel is not on the page

            // Add data
            chart.data = weekdata;

            // Add and configure Series
            var pieSeries = chart.series.push(new am4charts.PieSeries());
            pieSeries.dataFields.value = "sales";
            pieSeries.dataFields.category = "week";
            pieSeries.innerRadius = am4core.percent(50);
            pieSeries.ticks.template.disabled = true;
            pieSeries.labels.template.disabled = true;

            var rgm = new am4core.RadialGradientModifier();
            rgm.brightnesses.push(-0.8, -0.8, -0.5, 0, -0.5);
            pieSeries.slices.template.fillModifier = rgm;
            pieSeries.slices.template.strokeModifier = rgm;
            pieSeries.slices.template.strokeOpacity = 0.4;
            pieSeries.slices.template.strokeWidth = 0;

            chart.legend = new am4charts.Legend();
            chart.legend.position = "right";
            chart.logo.disabled = true;

        }); // end am4core.ready()
    },
    graphicalReportUser: function () {
        var graphBranchId = $(".user_branch_value").val().toString();
        if (graphBranchId !== '') {
            var loader = $(".loader-user-graph-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var daterange = $(".view_user_report_daterange").val();
            var fields = daterange.split('-');
            let user_id = ($(".users_input_id").val() !== '') ? $(".users_input_id").val() : '';
            var data = {
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".user_branch_value").val(),
                field_input: user_id
            };
            var params = {
                url: 'sales/userGraphicalReports',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    var data = response.data;
                    PosnicPro.usergraphicalreport.showGraphReport(data);

                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".user_branch_value").focus();
        }
    },
    userGraphTabClick: function () {
        $('#change_user_view').data('id', 'graphicalView');
        PosnicPro.usergraphicalreport.graphicalReportUser();
    }
};

PosnicPro.userroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.userreport.userreportTable();
        } else if (type === 'graphicalView') {
            PosnicPro.usergraphicalreport.graphicalReportUser();
        } else {
            PosnicPro.userstatusreport.userstatusreportTable();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/userreport') {
        var loader = $(".loader-user-report,.loader-user-graph-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.userreport.userreportTable();
    }
});