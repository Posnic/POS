$.validator.addMethod("strong_password", function (value, element) {
    let password = value;
    if (!(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[@#$!%*?&])(.{5,20}$)/.test(password))) {
        return false;
    }
    return true;
}, function (value, element) {
    let password = $(element).val();
    if (!(/^(.{5,20}$)/.test(password))) {
        return 'Password must be between 5 to 20 characters long.';
    } else if (!(/^(?=.*[A-Z])/.test(password))) {
        return 'Password must contain at least one uppercase.';
    } else if (!(/^(?=.*[a-z])/.test(password))) {
        return 'Password must contain at least one lowercase.';
    } else if (!(/^(?=.*[0-9])/.test(password))) {
        return 'Password must contain at least one digit.';
    } else if (!(/^(?=.*[@#$!%*?&])/.test(password))) {
        return "Password must contain special characters from @#$!%*?&.";
    }
    return false;
});

jQuery.validator.addMethod("emailExt", function (value, element, param) {
    return value.match(/^([\w-\.]+@([\w-]+\.)+[\w-]{2,4})?$/);
}, 'please enter a valid email');

jQuery.validator.addMethod("city", function (city_name, element) {
    city_name = city_name.replace(/\s+/g, "");
    return this.optional(element) || city_name.match(/^[a-zA-Z0-9-\s]+$/);
}, "Please Enter a Valid City Name");

jQuery.validator.addMethod("cname", function (value, element) {
    if ((/[*|\":<>[\]{}`\\'\/;@&#!]/.test(value))) {
        return false;
    }
    return true;
}, "Please Enter a Valid Name");
jQuery.validator.addMethod("username", function (value, element) {
    return this.optional(element) || /^[\w-]+$/i.test(value);
}, "Please use only letters, dashes,numbers, and underscores");

$(".new-show_hide_password").on('click', function (event) {
    event.preventDefault();
    if ($('#new_password').attr("type") === "text") {
        $('#new_password').attr('type', 'password');
        $('.new-show_hide_password i').addClass("fa-eye-slash").removeClass("fa-eye");
    } else {
        $('#new_password').attr('type', 'text');
        $('.new-show_hide_password i').removeClass("fa-eye-slash").addClass("fa-eye");
    }
});
$(".confirm-show_hide_password").on('click', function (event) {
    event.preventDefault();
    if ($('#confirm_password').attr("type") === "text") {
        $('#confirm_password').attr('type', 'password');
        $('.confirm-show_hide_password i').addClass("fa-eye-slash").removeClass("fa-eye");
    } else {
        $('#confirm_password').attr('type', 'text');
        $('.confirm-show_hide_password i').removeClass("fa-eye-slash").addClass("fa-eye");
    }
});
$(".current-show_hide_password").on('click', function (event) {
    event.preventDefault();
    if ($('#old_password,#password').attr("type") === "text") {
        $('#old_password,#password').attr('type', 'password');
        $('.current-show_hide_password i').addClass("fa-eye-slash").removeClass("fa-eye");
    } else {
        $('#old_password,#password').attr('type', 'text');
        $('.current-show_hide_password i').removeClass("fa-eye-slash").addClass("fa-eye");
    }
});