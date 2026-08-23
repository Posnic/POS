function notification_clear() {
    $('.low_item_stock_count').text('');
    $('#stockcountmessage').hide()
}

function date_time() {
    setInterval(function () {
        var momentNow = moment();
        $('#dashboard_date').html(momentNow.format('MMMM DD YYYY') + ' ' + momentNow.format('hh:mm:ss A'))
    }, 100);
}

$('input[name="chkSelectOneRow"]').on('click', function () {
    $(this).closest('tr').toggleClass('dangerzoneBgColor', $(this).is(':checked'))
});
$("#checkall").click(function () {
    if (this.checked) {
        $('.dangerzone').each(function () {
            this.checked = !0
        });
        $('.dangerzone').closest('tr').toggleClass('dangerzoneBgColor', this.checked);
        $('.delete_single').attr('disabled', !0)
    } else {
        $('.dangerzone').each(function () {
            this.checked = !1
        });
        $('.dangerzone').closest('tr').toggleClass('dangerzoneBgColor', this.checked);
        $('.delete_single').attr('disabled', !1)
    }
});
$(function () {
    PosnicPro.getBranchDropdownOption();
    PosnicPro.getBranchTaxList();
});
$(document).ready(function () {
    (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
    $('#v-pills-offline-tab,#v-pills-mail-tab,#v-pills-sms-tab,#v-pills-erase-tab,#v-pills-api-tab').remove();
    if (PosnicPro.local.get('usertype') !== 'super_admin') {
        $('#v-pills-store-tab').removeClass('active');
        $('#v-pills-store').removeClass('show active');
        $('#v-pills-taxmodule-tab').addClass('active');
        $('#v-pills-taxmodule').addClass('show active');
    }

    $("#default_customer").change("change", function () {
        var id = $('#customers_default_value').val();
        var params = {
            url: 'setting/updateCustomerSettings',
            data: {id: id}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $('#sales_new_customer_name').val(data.name);
                $('#sales_new_customer_address').val(data.address);
                $('#sales_new_customer_phone').val(data.phone);
                $('#sales_new_customer_email').val(data.email);
                $('#sales_new_customer_state').val(data.state);
                $('#sales_new_customer_country').val(data.country)
            } else {
                PosnicPro.alert(response.type, response.message)
            }
        })
    });
    $("#default_supplier").change("change", function () {
        var id = $('#suppliers_default_value').val();
        var params = {
            url: 'setting/updateSupplierSettings',
            data: {id: id}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $('#receiving_add_supplier_name').val(data.name);
                $('#receiving_add_supplier_phone').val(data.phone);
                $('#receiving_add_supplier_email').val(data.email);
                $('#receiving_add_supplier_address').val(data.address)
            } else {
                PosnicPro.alert(response.type, response.message)
            }
        })
    });
    $("#Reset").click(function () {
        var params = {
            url: 'setting/forgotPassword',
            data: {email: $("#email").val()}
        };
        PosnicPro.post(params, function (response) {
            PosnicPro.alert('success', 'Your password is reset')
        });
    });
    setLocalValue();
});

$(document).on('click', '#receiving_discount_amount,#receiving_discount_percentage,#receiving_tax,.quantity-text', function () {
    PosnicPro.selectAllText(jQuery(this))
});

$('.load-branch').on("select2:select", function (e) {
    var data = e.params.data.text;
    var value = $('.load-branch').children("option").val();

    var selectall = $("<option></option>").attr("value", value).attr("name", 'selectall').text('selectall');
    var removeall = $("<option></option>").attr("value", value).attr("name", 'removeall').text('removeall');

    if (data === 'selectall') {
        $('.load-branch').children("option[value='" + value + "']").remove();
        $(".load-branch > option").prop("selected", true);
        $('.load-branch')
                .prepend(selectall);
        $('.load-branch')
                .prepend(removeall);
        $('.load-branch').trigger("change");
    }
    if (data === 'removeall') {
        $('.load-branch').children("option[value='" + value + "']").remove();
        $(".load-branch > option").prop("selected", false);
        $('.load-branch')
                .prepend(removeall);
        $('.load-branch')
                .prepend(selectall);
        $('.load-branch').trigger("change");
    }

});

$('.vertical-menu').on('click', 'li a', function () {
    $('.vertical-menu li a.active').removeClass('active');
    $(this).addClass('active');
});

$('.close_on_esc').on('hidden.bs.modal', function () {
    var patt = /^[a-f\d]{24}$/i;
    var parts = currentHash.split('/');
    if (typeof parts[1] !== 'undefined' && patt.test(parts[1]) === true) {
        hasher.changed.active = false; //disable changed signal
        (PosnicPro.sales.recentSaleAction === true) ? hasher.setHash('sales/new') : hasher.setHash(parts[0]);
        hasher.changed.active = true; //re-enable signal
    } else if (currentHash === 'sales/new' || currentHash === 'receivings/new') {
        hasher.changed.active = false; //disable changed signal
        hasher.setHash(currentHash); //set hash without dispatching changed signal
        hasher.changed.active = true; //re-enable signal
    } else if (parts[1] === 'new' || parts[1] === 'tax' || parts[1] === 'taxgroup' || parts[1] === 'payment' || parts[0] === 'returnreport' || parts[0] === 'returnreceivingreport') {
        hasher.changed.active = false; //disable changed signal
        hasher.setHash(parts[0]); //set hash without dispatching changed signal
        hasher.changed.active = true; //re-enable signal
    } else if (parts[1] === 'transaction') {
        window.history.back();
    }
});
$('#change_password').click(function () {
    $('#password_new').modal('show');
    $('#old_password,#new_password,#confirm_password').val('');
    $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
});
$('#change_profile').click(function () {
    $('#profile_new').modal('show');
});

$("#branch_name").click(function () {
    $('.change_branch').addClass('show');
    return false;
});

//To validate the numeric value Not allow alphapet and special characters
$(".allow_decimal").on("input", function (evt) {
    var self = $(this);
    self.val(self.val().replace(/[^0-9\.]/g, ''));
    if ((evt.which !== 46 || self.val().indexOf('.') !== -1) && (evt.which < 48 || evt.which > 57)) {
        evt.preventDefault();
    }
});

$(".click-action-button").click(function () {
    $(".show-button-action").toggle();
    $(".hide-button-action").toggle();
    ($(".show-button-action").css("display") === "none")
            ? $(".click-action-button").removeClass("click-action-buttons")
            : $(".click-action-button").addClass("click-action-buttons");
});
$('[data-toggle="tooltip"]').on('click', function () {
    $(this).tooltip('hide');
});

function setLocalValue() {
    $("body").tooltip({'delay': {show: 250, hide: 0}, selector: '[data-toggle="tooltip"]', container: 'body', placement: "top", trigger: 'hover'});
    $(".select2").select2();
    /*
     * The header showed a literal "null null".
     *
     * localStorage.getItem returns null for a key that was never written, and
     * `null + ' ' + null` is the string "null null". Only loginCheck writes
     * these two, so every other way into the app - shadow login above all, which
     * is how support looks at a shop - arrived with neither set and printed it
     * to the top of every screen.
     *
     * Filtered and fallen back, the way PosnicPro.js already builds this name:
     * a username or an email address is a worse greeting than a real name and a
     * far better one than "null null".
     */
    var users_name = [
        PosnicPro.local.get('userfirstname'),
        PosnicPro.local.get('userlastname')
    ].filter(function (part) {
        /* The string "null" and the string "undefined" get here too: local.set
           stringifies whatever it is given, so a missing field in a login
           response is stored as those words rather than skipped. */
        var v = $.trim(String(part == null ? '' : part));
        return v && v !== 'null' && v !== 'undefined';
    }).join(' ')
        || PosnicPro.local.get('username')
        || '';
    $(".user-name").html(users_name).val(users_name);

    $("#search_register_id").val(PosnicPro.local.get('registerId'));
    $("#search_register_name").val(PosnicPro.local.get('registerName'));
    $(".branch-name").html(PosnicPro.local.get('branchname'));

    var storedUserImage = PosnicPro.local.get('userimage');
    var storedBranchImage = PosnicPro.local.get('branchimage');
    var defaultUserImage = 'static/images/default/user.svg';
    var user_image_path = defaultUserImage;

    // Treat legacy localhost:5000 URLs as invalid so we don't keep
    // pointing at a non-existent host after port changes.
    if (storedUserImage && storedUserImage.indexOf('localhost:5000') !== -1) {
        storedUserImage = '';
    }

    // 1) Prefer an explicit user profile image when it is set and not
    //    the default placeholder value.
    if (storedUserImage && storedUserImage !== 'user.svg' && storedUserImage !== 'null' && storedUserImage !== 'undefined') {
        user_image_path = storedUserImage;
    // 2) Otherwise, fall back to the current branch logo so that the
    //    header avatar reflects the store profile image updated from
    //    Settings.
    } else if (storedBranchImage && storedBranchImage !== 'store.png' && storedBranchImage !== 'null' && storedBranchImage !== 'undefined') {
        user_image_path = storedBranchImage;
    }

    $("#user-image").attr('src', user_image_path);

    $('.user-id').val(PosnicPro.local.get('sid'));

}
function keyboard_view() {
    if (PosnicPro.local.get('keyboard_view') === 'true') {
        $('.osk-trigger').onScreenKeyboard({'draggable': !0, 'rewireReturn': 'search', 'rewireTab': !0});
        $('.keyboard-numinput').keypad({
            prompt: '',
            keypadOnly: !1,
            layout: ['789' + $.keypad.CLOSE, '456' + $.keypad.CLEAR, '123' + '.0']
        });
    } else {
        $('#osk-container').css("visibility", "hidden");
    }
}
$(document).on('click', '.select2-selection--single', function (e) {
    $('.select2-search__field').focus();
});
//To validate the numeric value Not allow alphapet and special characters
$(".allow_phone_validate").on("input", function (evt) {
    var self = $(this);
    self.val(self.val().replace(/[^0-9\.+]/g, ''));
    if ((evt.which !== 46 || self.val().indexOf('.') !== -1) && (evt.which < 48 || evt.which > 57)) {
        evt.preventDefault();
    }
});