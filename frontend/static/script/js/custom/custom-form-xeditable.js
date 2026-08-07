/*
 ---------------------------------------
 : Custom - Form X-editable js :
 ---------------------------------------
 */
"use strict";
$(document).ready(function () {
    /* -- Form - X-editable -- */
    $.fn.editable.defaults.mode = 'popup';
    $.fn.editableform.buttons = '<button type="submit" class="btn btn-success editable-submit btn-sm"><i class="feather icon-check"></i></button><button type="button" class="btn btn-danger editable-cancel btn-sm"><i class="feather icon-x"></i></button>';

    $('#extraDisc').editable({
        mode: 'inline',
        type: 'number', // Input type
        tpl: '<input type="text" value="0.00" id="extraDisc" class="form-control form-control-sm small-input" min="0" step="any" style="width: 60px;"/>', // Template for input
        pk: 1, // Primary key (if needed for backend updates)
        placement: 'left', // Position of the editable input
        placeholder: 'Enter discount', // Placeholder text
        title: 'Enter extra discount', // Title displayed when editing
        inputclass: 'form-control form-control-sm', // Additional styling for input
        validate: function (value) {
            // Validation function
            if ($.trim(value) === '') {
                return 'Discount cannot be empty';
            }
            if (isNaN(value) || value < 0) {
                return 'Please enter a valid number';
            }
        },
        success: function (response, newValue) {
            $('#extraDisc').text(newValue);
            PosnicPro.sales.calculation.extraDiscoundCalculation();
        },
        error: function (response) {
            // Error callback in case of failure
            console.error('Error saving the discount:', response);
        }
    });

    // Listen for changes in the input field
    //    $(document).on('input', '#extraDisc', function () {
    //        let currentValue = $(this).val();
    //        $('#extraDisc').text(currentValue);
    //        PosnicPro.sales.calculation.extraDiscoundCalculation();
    //    });


    $('#payment_description').editable({
        type: 'textarea',
        tpl: '<textarea maxlength="500"></textarea>',
        pk: 1,
        placement: 'left',
        placeholder: 'Payment description here...',
        title: 'Enter comments',
        inputclass: 'form-control form-control-sm textarea-height',
        validate: function (value) {
            if (value.length > 500) {
                return 'Allowed 500 characters only';
            }
        },
        success: function (k, val) {
            $('#payment_description').val(val);
            $('#payment_description').text('');
            $('#payment_description').hide();
            if (val.length > 0) {
                $('#click_payment_description').css({ color: '#5fd799' });
            } else {
                $('#click_payment_description').css({ color: '#506fe4' });
            }

        }
    });
    $('#click_payment_description').click(function (e) {
        e.stopPropagation();
        e.preventDefault();
        $('#payment_description').text('');
        $('#payment_description').show();
        $('#payment_description').editable('toggle');
    });

    $('#sales_description').editable({
        type: 'textarea',
        tpl: '<textarea maxlength="500"></textarea>',
        pk: 1,
        placement: 'left',
        placeholder: 'Sale description here...',
        title: 'Enter comments',
        inputclass: 'form-control form-control-sm textarea-height',
        validate: function (value) {
            if (value.length > 500) {
                return 'Allowed 500 characters only';
            }
        },
        success: function (k, val) {
            $('#sales_description').val(val);
            $('#sales_description').text('');
            $('#sales_description').hide();
            if (val.length > 0) {
                $('#click_sales_description').css({ color: '#5fd799' });
            } else {
                $('#click_sales_description').css({ color: '#506fe4' });
            }
        }
    });
    $('#click_sales_description').click(function (e) {
        e.stopPropagation();
        e.preventDefault();
        $('#sales_description').text('');
        $('#sales_description').show();
        $('#sales_description').editable('toggle');
    });

    $('#discount_description').editable({
        type: 'textarea',
        tpl: '<textarea maxlength="2500" autofocus></textarea>',
        pk: 1,
        placement: 'left',
        placeholder: 'Discount description here...',
        title: 'Enter comments',
        inputclass: 'form-control form-control-sm textarea-height',
        emptytext: '',
        onblur: 'ignore',
        validate: function (value) {
            if (value.length > 2500) {
                return 'Allowed 2500 characters only';
            }
        },
        success: function (k, val) {
            $('#discount_description').val(val);
            $('#discount_description').text('');
            $('#discount_description').hide();
            if (val.length > 0) {
                $('#click_discount_description').css({ color: '#5fd799' });
            } else {
                $('#click_discount_description').css({ color: '#506fe4' });
            }
        }
    });

    $('#discount_description').on('shown', function () {
        var attempts = 0;
        var focusInterval = setInterval(function () {
            attempts++;
            try {
                var $input = $('.editable-container:visible textarea, .editable-container:visible input, .popover:visible textarea, .popover:visible input');
                if ($input.length) {
                    $input.first().focus();
                    var el = $input.get(0);

                    if (el && typeof el.value === 'string' && el.setSelectionRange) {
                        var len = el.value.length;
                        el.setSelectionRange(len, len);
                    }
                }
            } catch (ex) {
                // ignore and retry until attempts exhausted
            }
            if (attempts >= 10) {
                clearInterval(focusInterval);
            }
        }, 80);
    });

    $('#click_discount_description').click(function (e) {
        e.stopPropagation();
        e.preventDefault();

        $('#discount_description').text('');
        $('#discount_description').show();
        $('#discount_description').editable('toggle');

        // Ensure the Discount Note popup gets focus shortly after it opens
        setTimeout(function () {
            var $el = $('.editable-container:last textarea, .editable-container:last input');
            if ($el.length) {
                $el.focus();
            }
        }, 300);
    });

    $('#register_add_payment_description').editable({
        type: 'textarea',
        tpl: '<textarea maxlength="500"></textarea>',
        pk: 1,
        placement: 'left',
        placeholder: 'Sale description here...',
        title: 'Enter comments',
        inputclass: 'form-control form-control-sm textarea-height',
        validate: function (value) {
            if (value.length > 500) {
                return 'Allowed 500 characters only';
            }
        },
        success: function (k, val) {

            let countedCashData = {
                id: $('#reg_upd_id').val(),
                note: val
            };
            let params = {
                method: 'POST',
                url: 'registers/registerPaymentNote',
                data: JSON.stringify(Object.assign(countedCashData))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {
                    $('#register_add_payment_description').val(val);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    });

    $('#editableusername').editable({
        type: 'text',
        pk: 1,
        title: 'Enter firstname',
        inputclass: 'form-control form-control-sm',
        validate: function (value) {
            if (value.length > 50) {
                return 'Allowed 50 characters only';
            }
        },
        success: function (k, val) {
            $('#editableusername').val(val);
            $('#editableusername').text('');
        }
    });


    $('#editablelastname').editable({
        type: 'text',
        pk: 1,
        emptytext: '..',
        title: 'Enter lastname',
        inputclass: 'form-control form-control-sm',
        validate: function (value) {
            if (value.length > 50) {
                return 'Allowed 50 characters only';
            }
        },
        success: function (k, val) {
            $('#editablelastname').val(val);
            $('#editablelastname').text('');
        }
    });

    $('#counted_cash_amount').editable({
        type: 'text',
        pk: 1,
        emptytext: '..',
        title: 'Enter Counted Cash Amount',
        inputclass: 'form-control form-control-sm',
        validate: function (value) {
            if ($.trim(value) == '') {
                return 'Counted Cash Amount is required.';
            }
            if (($.isNumeric(value) == '')) {
                return 'Only numbers allowed';
            }
            if (value.length > 5) {
                return 'Allowed 5 digits only';
            }
        },
        success: function (k, val) {
            PosnicPro.registers.cashOnRegisterValueCheck(val)
            var countedCashData = {
                register_row_Id: $('#reg_upd_id').val(),
                countedAmount: parseFloat(val),
                payment_Type: 'cash'
            };
            var method = 'POST';
            var url = 'registers/registerCountedAmount';
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(Object.assign(countedCashData))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {

                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    });
    $('#counted_card_amount').editable({
        type: 'text',
        pk: 1,
        emptytext: '..',
        title: 'Enter lastname',
        inputclass: 'form-control form-control-sm',
        validate: function (value) {
            if ($.trim(value) == '') {
                return 'Counted Card Amount is required.';
            }
            if (($.isNumeric(value) == '')) {
                return 'Only numbers allowed';
            }
            if (value.length > 5) {
                return 'Allowed 5 digits only';
            }
        },
        success: function (k, val) {
            PosnicPro.registers.creditOnRegisterValueCheck(val)
            var countedCardData = {
                register_row_Id: $('#reg_upd_id').val(),
                countedAmount: parseFloat(val),
                payment_Type: 'card'
            };
            var method = 'POST';
            var url = 'registers/registerCountedAmount';
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(Object.assign(countedCardData))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {

                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });

        }
    });
    $('#counted_cheque_amount').editable({
        type: 'text',
        pk: 1,
        emptytext: '..',
        title: 'Enter lastname',
        inputclass: 'form-control form-control-sm',
        validate: function (value) {
            if ($.trim(value) == '') {
                return 'Counted cheque Amount is required.';
            }
            if (($.isNumeric(value) == '')) {
                return 'Only numbers allowed';
            }
            if (value.length > 5) {
                return 'Allowed 5 digits only';
            }
        },
        success: function (k, val) {
            PosnicPro.registers.chequeOnRegisterValueCheck(val)
            var countedChequeData = {
                register_row_Id: $('#reg_upd_id').val(),
                countedAmount: val,
                payment_Type: 'cheque'
            };
            var method = 'POST';
            var url = 'registers/registerCountedAmount';
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(Object.assign(countedChequeData))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {

                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    });
});