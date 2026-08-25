PosnicPro.expenses = {
    expenseAction: 'add',
    showAdd: function () {
        var loader = $(".loader-expense");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.HideSideBarModal();
        PosnicPro.showAddModal('expense');
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-manage-tab,.expenses_new_shortcut').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.vertical-menu li a#view_expenses_page').addClass('active');
        $('#expense_reset').show();
        $('.expense_edit_reset').hide();
        $('.add_new_tooltip').tooltip("hide");
        $('#expenses_id').val('');
        $('#expenses_date').addClass('commonDate');
        $('#expenses_date').removeClass('commonEditDate');
        if (PosnicPro.expenses.expenseAction === 'edit') {
            PosnicPro.expenses.expenseClearForm();
        }
        PosnicPro.expenses.expenseAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-category");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('expenses');
        PosnicPro.expenses.editExpenses(id);
        $('#v-pills-manage').addClass('show active');
        $('#expense_reset').hide();
        $('.expense_edit_reset').show();
        $('.expense_edit_reset').attr("id", id);
        $('#expenses_date').removeClass('commonDate');
        $('#expenses_date').addClass('commonEditDate');
        PosnicPro.expenses.expenseAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'expenses');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-expense");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('expenses');
        PosnicPro.expenses.viewExpenses(id);
    },
    expensesTable: function () {
        var loader = $(".loader-table-expense");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('expenses');
        var table = $('#view_expenses');
        var params = {
            url: 'expenses',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_expenses_per_page  option:selected').text()),
                filters: table.data('filters')
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#view_expenses_total').text(response.data.total);
                table.data('total', response.data.total);
                table.data('total_pages', response.data.total_pages);
                table.data('current_page', response.data.current_page);
                table.data('per_page', response.data.per_page);
                PosnicPro.paging(response.data.total_pages, response.data.current_page);
                table.children('tbody').text('');
                $('#view_expenses_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.expense_header').hide();
                    $('#expense_img_hide').show();

                } else {
                    $('#expense_img_hide').hide();
                    $('.expense_header').show();
                }
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_expenses_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_expenses_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "expense" data-access = "read" href="#/expenses/' + row._id + '" data-id="expenses/' + row._id + '" data-toggle="tooltip" title="View Expense" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "expense" data-access = "write" href="#/expenses/' + row._id + '/edit" data-id="expenses/' + row._id + '/edit" data-toggle="tooltip" title="Edit Expense" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>' +
                            '<a data-module = "expense" data-access = "delete" href="#/expenses/' + row._id + '/delete" data-id="expenses/' + row._id + '/delete" data-toggle="tooltip" title="Delete Expense" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';
                    var trow = '<tr class="pipeline"><th><input type="checkbox" class="expenses-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'expenses\');"></th> <th scope="row" data-label="#">' + row_no + '</th><td class="text-right" data-label="Amount">' + currency + '&nbsp;<span class="number">' + row.amount + '</span></td><td data-label="Type">' + (row.type === 'credit' ? 'Money In' : row.type === 'debit' ? 'Money Out' : (row.type || '')) + '</td><td data-label="Category">' + row.category + '</td><td data-label="Approved by">' + row.approvedby + '</td><td data-label="Note">' + (row.description || '') + '</td>' +
                            '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';
                    $('#view_expenses').children('tbody').append(trow);
                }
                $('span.number').number(true, 2);
                $(document).ready(function () {
                    for (var i = 0; i < response.data.list.length; i++) {
                        $('#onclick-toolbar_' + i).toolbar({
                            content: '#onclick-toolbar-options_' + i,
                            event: 'click',
                            style: 'primary',
                            hideOnClick: true
                        });
                        $('#onclick-toolbar_' + i).on('toolbarItemClick', function (event, element) {
                            hasher.setHash($(element).data('id'));
                            $(this).trigger('click');
                            $('.mobile_tooltip').tooltip('hide');
                        });
                    }
                });
                if (response.data.last_created_id) {
                    $('#last_created_expense').attr('href', '#/expenses/' + response.data.last_created_id);
                    $('#show_last_created_expense').show();
                }
                PosnicPro.setSelectedCheckbox(PosnicPro["expenses_checkbox"], 'expenses');
                PosnicPro.ACLForModule('expense');
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    // Cash Book lives under Config > Modules now (user call).
    showDataTablePage: function () {
        PosnicPro.settings.showDataTablePage();
        $('#v-pills-cashbook-tab').click();
        PosnicPro.expenses.paneInit();
    },
    paneInit: function () {
        var loader = $(".loader-table-expense");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        $('#expenses_new,#expenses_view').modal('hide');
        PosnicPro.expenses.expensesTable('expenses');
    },
    /*This expenses Function Used To Add & Edit */
    expenses: function () {
        if ($('#expenses_amount').val() !== '') {
            var loader = $(".loader-expense");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var method = 'POST';
            var url = 'expenses';
            PosnicPro.action = 'add';
            if ($('#expenses_id').val() !== '') {
                PosnicPro.action = 'edit';
                method = 'PUT';
                url += '/' + $('#expenses_id').val();
            }
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(PosnicPro.getFormData($('#expenses_add_list_form')))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {
                    $("#expenses_add_list_form").trigger('reset');
                    $('#show_last_created_expense').show();
                    var expenseId = (typeof response.data === 'object' && response.data.id) ? response.data.id : response.data;
                    var path = '#/expenses/' + expenseId;
                    $('#last_created_expense').attr('href', path);
                    PosnicPro.commonDate();
                    if (PosnicPro.action === 'edit') {
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-expense").removeClass("sidebarshow");
                        hasher.setHash('expenses');
                    }
                    PosnicPro.expenses.expensesTable('expenses');
                    loader.find(".loadingSpinner:first").remove();
                    PosnicPro.alert(response.type, response.message);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    /*Display the expense details*/
    viewExpenses: function (id) {
        var loader = $(".loader-view-expense");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('expenses/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.expenses.viewExpensesData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewExpensesData: function (response) {
        $('#expenses_view').modal('show');
        var data = response.data;

        $.each(data, function (key, val) {
            if (val === '') {
                $('#expenses_view_' + key).html('');
            } else {
                $('#expenses_view_' + key).html(val);
            }
        });

        var updateDate = PosnicPro.convertDate(data.date);
        $('#expenses_view_date').html(updateDate);
        $('#expenses_view_amount').number(data.amount, 2);
        // Show the money direction in shopkeeper terms, not raw credit/debit.
        $('#expenses_view_type').html(
            data.type === 'credit' ? 'Money In' : data.type === 'debit' ? 'Money Out' : (data.type || '')
        );
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#expenses_view_created_date').html(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#expenses_view_updated_date').html(updateUpdateDate);

    },
    /*Edit the expenses details*/
    editExpenses: function (id) {
        var loader = $(".loader-expense");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-expense").addClass("sidebarshow");
        var params = {
            url: 'expenses/getExpenseDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#expenses_new').modal('show');
                var data = response.data;
                PosnicPro.record_id = id;
                PosnicPro.commonEditDate(data.date);
                $('#expenses_id').val(PosnicPro.record_id);
                $('#expenses_amount').val(data.amount);
                $('#expenses_tax').val(data.tax);
                $("#expenses_type").val(data.type).change();
                $('#expenses_category').val(data.category);
                $('#expenses_recipientname').val(data.recipientname);
                $('#expenses_approvedby').val(data.approvedby);
                $('#expenses_expensesnote').val(data.description);
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#expenses_title').text('திருத்தப்பட்ட') : $('#expenses_title').text('Edit');
//                $('#expenses_button_title').text('Update');
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#expenses_button_title').text('புதுப்பி') : $('#expenses_button_title').text('Update');

                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                $('#addExpenses').modal('show');
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        PosnicPro.expenses.editExpenses(id);
    },
    addExpensesButton: function () {
        var loader = $(".loader-expense");
        loader.find(".loadingSpinner:first").remove();
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#expenses_title').text('புதிய') : $('#expenses_title').text('Add');
//        $('#expenses_button_title').text('Save');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#expenses_button_title').text('சேமி') : $('#expenses_button_title').text('Save');

        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#expenses_id').val('');
        $('#expenses_new .alert').remove();
        $('#expenses_date').addClass('commonDate');
        $('#expenses_date').removeClass('commonEditDate');
        PosnicPro.commonDate();
        $('#show_last_created_expense').hide();
    },
    exportExpense: function () {
        PosnicPro.exportTableData(PosnicPro.expenses_checkbox, 'expenses');
    },
    deleteSelectedExpense: function () {
        PosnicPro.deleteTableData(PosnicPro.expenses_checkbox, 'expenses');
    },
    expenseClearForm: function () {
        $('#expenses_add_list_form')[0].reset();
        $('#expenses_expensesnote').html('');
        $('.error_expense').css('display', 'none');
        PosnicPro.commonDate();
    },
    validForm: function () {
        // validate signup form on keyup and submit
        $("#expenses_add_list_form").validate({
            errorClass: 'error error_expense',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                date: {
                    required: true,
                    date: true,
                    expenseDate: true
                },
                amount: {
                    required: true,
                    minlength: 1,
                    maxlength: 10
                },
                type: {
                    required: true
                },
                category: {
                    minlength: 3,
                    maxlength: 20
                },
                recipientname: {
                    minlength: 3,
                    maxlength: 20
                },
                approvedby: {
                    minlength: 3,
                    maxlength: 20
                },
                description: {
                    required: true,
                    minlength: 3,
                    maxlength: 500
                }

            },
            messages: {
                date: {
                    required: "Choose a date",
                    commonDate: "Enter a valid date"
                },
                amount: {
                    required: "Enter the expense amount",
                    minlength: "Expenses amount must be at least 1 characters",
                    maxlength: "Expenses amount should not be more than 10 characters"
                },
                type: {
                    required: "Choose expenses type"
                },
                category: {
                    required: "Enter the category name",
                    minlength: "Category name must be at least 3 characters",
                    maxlength: "Category name should not be more than 20 characters"
                },
                recipientname: {
                    required: "Enter the recipient name",
                    minlength: "Recipient name must be at least 3 characters",
                    maxlength: "Recipient name should not be more than 20 characters"
                },
                approvedby: {
                    required: "Fill this in",
                    minlength: "This field must be at least 3 characters",
                    maxlength: "This field should not be more than 20 characters"
                },
                description: {
                    required: "Enter a note for this expense",
                    minlength: "Expenses note must be at least 3 characters",
                    maxlength: "Expense note is too Long !"
                }
            }
        });
        $("#expenses_new").on('shown.bs.modal', function () {
            $(this).find('#expenses_amount').focus();
        });
        jQuery.validator.addMethod("expenseDate", function (value, element) {
            return this.optional(element) || moment(value, 'YYYY/MM/DD LT').isValid();
        }, "Use the date format");
        $("#expenses_add_list_form").submit(function (event) {
            event.preventDefault();
            if ($('#expenses_add_list_form').valid()) {            // checks form for validity
                PosnicPro.expenses.expenses();
            }
        });
    }
};

$("#expenseSubmitForm").one('click', function () {
    PosnicPro.expenses.validForm();
});

/*end*/

