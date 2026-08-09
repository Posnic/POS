PosnicPro.expensesreport = {
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        PosnicPro.dashboard.datePicker();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#expensesreport_new').show();
        $('#v-pills-report-tab,#viewexpensereport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        PosnicPro.expensesreport.expensesreportTable();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#expense-line').css('filter', 'blur(2px)');
            $('#expensesreport_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#expense_upgrade').show();
        } else {
            $('#expense-line').css('filter', 'none');
            $('#expensesreport_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#expense_upgrade').hide();
        }
    },
    expensesreportTable: function (type) {
        var branchId = $("#expenses_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-expenses-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('expensesreport');
            var daterange = $("#view_expenses_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_expensesreport');
            if (type === 'expensesreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_expensesreport_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $("#expenses_branch_value").val()
            };
            var params = {
                url: 'expenses/expensesReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                loader.find(".loadingSpinner:first").remove();
                if (response.type === 'success') {
                    (response.data.total > 0) ? $('#expensesreport_exportbtn').removeAttr('disabled') : $('#expensesreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'expensesreportexport') {
                        $('#view_expensesreport_total').text(response.data.total);
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_expensesreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportexpenses_header').hide();                             
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportexpenses_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                            $('#reportexpenses_img_hide,.reportexpenses_norecord').show();

                        } else {
                            $('.reportexpenses_norecord').empty();
                            $('#reportexpenses_img_hide,.reportexpenses_norecord').hide();
                            $('.reportexpenses_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_expensesreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_expensesreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                            var trow = '<tr> <th scope="row">' + row_no + '</th> <td class="export-amount">' + currency + '&nbsp;<span class="number">' + row.amount + '</span></td> <td class="export-expenses-type">' + row.type + '</td> <td class="export-expenses-category"><i>' + row.category + '</i></td> <td class="export-recipient">' + row.recipientname + '</td> <td class="export-approved">' + row.approvedby + '</td> <td class="export-note">' + (row.description || '') + '</td> </tr>';
                            $('#view_expensesreport').children('tbody').append(trow);
                            $('span.number').number(true, 2);
                        }

                    } else {

                        var expensereport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var category = val.category;
                            var type = val.type;
                            var recipient = val.recipientname;
                            var approved = val.approvedby;
                            var amount = val.amount;
                            var category = '<div><input type="text" value="' + val.category + '" /></div>',
                                    categoryObject = $('<div/>').html(category).contents();
                            var note = '<div><input type="text" value="' + val.description + '" /></div>',
                                    noteObject = $('<div/>').html(note).contents();

                            expensereport.push({Amount: amount, Type: type, Category: categoryObject.find('input').val(), RecipientName: recipient, ApprovedBy: approved, Description: noteObject.find('input').val()});
                        });
                        PosnicPro.JSONToCSVConvertor(expensereport, 'expense-reports', true);
                        PosnicPro.expensesreport.expensesreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $("#expenses_branch_value").focus();
        }
    },
    expensesReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.expensesreport.expensesreportTable(type);
    }
};

PosnicPro.expenseroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.expensesreport.expensesreportTable();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/expensesreport') {
        PosnicPro.expensesreport.expensesreportTable();
    }
});