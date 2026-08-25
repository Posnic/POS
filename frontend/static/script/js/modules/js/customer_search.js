PosnicPro.customersearch = {
    productListFunction: function () {
        var loader = $(".loader-customer-search");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var range = $('#range-slider').val();
        var fields = range.split(';');
        var perpage = $('#view_customersearch_page_total').html();
        var filter_value = $('#filter_customer_search').val();

        var data = {
            page: perpage,
            limit: "52",
            filter: filter_value,
            starting_price: (typeof fields[0] === 'undefined' || fields[0] === '') ? 0 : fields[0],
            ending_price: (typeof fields[1] === 'undefined' || fields[1] === '') ? 500000 : fields[1]
        };
        var params = {
            url: 'items/itemSearchTable',
            data: data
        };
        PosnicPro.get(params, function (response) {
            loader.find(".loadingSpinner:first").remove();
            if (response.type === 'success') {
                var currencySign = PosnicPro.local.get('currencySign');
                var getItemdata = response.data.list;
                $('#view_customersearch_total').html(response.data.total);
                $('#view_customersearch_total_pages').val(response.data.total_pages);
                $('#view_customersearch_page_total').html(response.data.current_page);
                $('#view_customersearch_page_perpage_total').html(response.data.per_page);

                if (getItemdata && getItemdata.length > 0) {
                    var app = '';

                    for (var i = 0; i < getItemdata.length; i++) {

                        var list_item_name = getItemdata[i]['item_name'];
                        var image_path = (getItemdata[i]['image'] !== "item.svg") ? getItemdata[i]['image'] : 'static/images/default/item.svg';

                        var price = 0;
                        let sellingPrice = getItemdata[i]['selling_price'];
                        let discountAmount = getItemdata[i]['discount_amount'];
                        let discountPercentage = getItemdata[i]['discount_percentage'];
                        let tax = getItemdata[i]['tax'];
                        let taxType = getItemdata[i]['tax_type'];
                        let taxPrice = (sellingPrice * tax) / (100 + tax);
                        var inclusive_price = sellingPrice - taxPrice.toFixed(2);
                        if (discountAmount > 0 && tax > 0) {
                            var discountValue = 0;
                            if (taxType === 'exclusive') {
                                discountValue = sellingPrice - discountAmount;
                            } else {
                                discountValue = inclusive_price - discountAmount;
                            }
                            price = discountValue + (tax / 100) * discountValue;

                        } else if (discountPercentage > 0 && tax > 0) {
                            var discountValue = 0;
                            var taxValue = 0;
                            if (taxType === 'exclusive') {
                                discountValue = (sellingPrice * (discountPercentage / 100));
                                taxValue = sellingPrice - discountValue;
                            } else {
                                discountValue = (inclusive_price * (discountPercentage / 100));
                                taxValue = inclusive_price - discountValue;
                            }
                            price = taxValue + (tax / 100) * taxValue;
                        } else if (discountAmount > 0) {
                            price = sellingPrice - discountAmount;
                        } else if (discountPercentage > 0) {
                            price = sellingPrice - (sellingPrice * (discountPercentage / 100));
                        } else if (tax > 0) {
                            if (taxType === 'exclusive') {
                                price = sellingPrice + (sellingPrice * tax / 100);
                            } else {
                                price = inclusive_price + (inclusive_price / 100) * tax;
                            }
                        } else {
                            price = getItemdata[i]['selling_price'];
                        }
                        var sellingPriceList = '<strike class="text_light_cl"><sub><span class="text_light_cl">' + currencySign + '&nbsp;</span><span class="number text_light_cl">' + getItemdata[i]['selling_price'] + '</span></sub></strike></span>';
                        if (sellingPrice.toFixed(2) === price.toFixed(2)) {
                            sellingPriceList = '<span style="display:none;"></span>';
                        }

                        app = app + '<div class="col-lg-6 col-xl-3">' +
                                '<div class="product-bar m-b-30">' +
                                '<div class="product-head">' +
                                '<a href="javascript:void(0);" id="' + getItemdata[i]['_id'] + '" onclick="return PosnicPro.customersearch.viewCustomerViewItem(this.id);"><img src="' + image_path + '" class="img-fluid" alt="product"></a>' +
                                '</div>' +
                                '<div class="product-body py-3">' +
                                '<div class="row align-items-center">' +
                                '<div class="col-12">' +
                                '<div class="d-inline-block">' +
                                '<span class="text-uppercase font-12 f-w-6">' + getItemdata[i]['category_name'] + '</span>' +
                                '</div>' +
                                '<div class="d-inline-block float-right">' +
                                '<i class="feather icon-star text-warning"></i>' +
                                '<i class="feather icon-star text-warning"></i>' +
                                '<i class="feather icon-star text-warning"></i>' +
                                '<i class="feather icon-star"></i>' +
                                '<i class="feather icon-star"></i>' +
                                '</div>' +
                                '</div>' +
                                '</div>' +
                                '<div class="row align-items-center">' +
                                '<div class="col-12">' +
                                '<h6 class="mt-1 mb-3">' + list_item_name + '</h6>' +
                                '</div>' +
                                '</div>' +
                                '<div class="row align-items-center">' +
                                '<div class="col-6">' +
                                '<div class="text-left">' +
                                '<h5 class="f-w-7 mb-0">' + sellingPriceList + '<h5 class="f-w-7 mb-0"><sup class="font-14 text_dark_cl">' + currencySign + '</sup><span class="discount_total text_dark_cl number">' + price.toFixed(2) + '</span></h5>' +
                                '</div>' +
                                '</div>' +
                                '<div class="col-6">' +
                                '<div class="text-right">' +
                                '<button type="button" class="btn btn-primary-rgba font-18" id="' + getItemdata[i]['_id'] + '" onclick="return PosnicPro.customersearch.viewCustomerViewItem(this.id);" aria-label="View details"><i class="fa fa-eye"></i></button>' +
                                '</div>' +
                                '</div>' +
                                '</div>' +
                                '</div>' +
                                '</div>' +
                                '</div>';

                    }
                    $('#list-item').html(app);
                } else {
                    app = "<div class='row'></div><div class='row'></div><div class='col-lg-12 col-xl-12 text-center text-dark'><p>There are no items available ...!!!</p></div>";
                    $('#list-item').html(app);
                }
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
            return false;
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewCustomerViewItem: function (id) {
        $('#view_item_details').modal('show');
        $('#item_view_discriptions,#item_view_discription').html('');
        var loader = $(".loader-customer-search-view");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('items/' + id, function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                data = response.data;
                $('.show-branch-list').html('');
                $.each(data.branch_access, function (key, val) {
                    var html = '<a href="javascript:void(0)" id="' + val.branch_id.$oid + '" class="btn btn-primary-rgba font-17" onclick="PosnicPro.customersearch.getBranchDetails(this.id);">' + val.branch_name + '</a>';
                    $('.show-branch-list').append(html);
                });
                $('#customer_item_name').text(data.name);
                let price = 0;
                let sellingPrice = data.selling_price;
                let discountAmount = data.discount_amount;
                let discountPercentage = data.discount_percentage;
                let tax = data.tax;
                let taxType = data.tax_type;
                let taxPrice = (sellingPrice * tax) / (100 + tax);
                var inclusive_price = sellingPrice - taxPrice.toFixed(2);
                if (discountAmount > 0 && tax > 0) {
                    var discountValue = 0;
                    if (taxType === 'exclusive') {
                        discountValue = sellingPrice - discountAmount;
                    } else {
                        discountValue = inclusive_price - discountAmount;
                    }
                    price = discountValue + (tax / 100) * discountValue;

                } else if (discountPercentage > 0 && tax > 0) {
                    var discountValue = 0;
                    var taxValue = 0;
                    if (taxType === 'exclusive') {
                        discountValue = (sellingPrice * (discountPercentage / 100));
                        taxValue = sellingPrice - discountValue;
                    } else {
                        discountValue = (inclusive_price * (discountPercentage / 100));
                        taxValue = inclusive_price - discountValue;
                    }
                    price = taxValue + (tax / 100) * taxValue;
                } else if (discountAmount > 0) {
                    price = sellingPrice - discountAmount;
                } else if (discountPercentage > 0) {
                    price = sellingPrice - (sellingPrice * (discountPercentage / 100));
                } else if (tax > 0) {
                    if (taxType === 'exclusive') {
                        price = sellingPrice + (sellingPrice * tax / 100);
                    } else {
                        price = inclusive_price + (inclusive_price / 100) * tax;
                    }
                } else {
                    price = data.selling_price;
                }
                $('.hide-total-customer-search').show();
                if (sellingPrice.toFixed(2) === price.toFixed(2)) {
                    $('.hide-total-customer-search').hide();
                }
                var currency = PosnicPro.local.get('currencySign');
                $('.current-currency').html(currency);
                $('#item_view_sellingprice').number(sellingPrice, 2);
                $('#item_view_sellingprice_discount').number(price, 2);
                if (data.available_quantity !== 0) {
                    $('#available_stock_display').show();
                    $('#no_stock_display').hide();
                } else {
                    $('#no_stock_display').show();
                    $('#available_stock_display').hide();
                }
                var image_path = (data.image !== "item.svg") ? data.image : 'static/images/default/item.svg';
                $('.customer_image_view').attr('src', image_path);
                $('#item_view_category').text(data.category_name);
                $('#item_view_discription').append(data.description);
                var htmlView = $('#item_view_discription').text();
                $('#item_view_discriptions').html(htmlView);

                //preview for image
                var myobjFor = document.getElementById("item_display_preview_for");
                myobjFor.remove();
                var newDivFor = document.createElement("div");
                newDivFor.id = "item_display_preview_for";
                newDivFor.className = 'product-slider-box product-box-for';
                var elementFor = document.getElementById("item_display_preview_for_parent");
                elementFor.appendChild(newDivFor);

                //preview for image
                var myobjNav = document.getElementById("item_display_preview_nav");
                myobjNav.remove();
                var newDivNav = document.createElement("div");
                newDivNav.id = "item_display_preview_nav";
                newDivNav.className = 'product-slider-box product-box-nav';
                var elementNav = document.getElementById("item_display_preview_nav_parent");
                elementNav.appendChild(newDivNav);

                $('#item_display_preview_for,#item_display_preview_nav').html('');
                $.each(data.multi_image, function (key, val) {

                    var image_path = val.name;
                    var image_effect_for = '<div class="product-preview">' +
                            '<img src="' + image_path + '" class="img-fluid" style="height:270px" alt="Product">' +
                            '</div>';
                    $('#item_display_preview_for').append(image_effect_for);
                    var image_effect_nav = '<div class="product-preview">' +
                            '<img src="' + image_path + '" class="img-fluid" style="height:30px;width:75px" alt="Product">' +
                            '</div>';
                    $('#item_display_preview_nav').append(image_effect_nav);

                });
                if (data.multi_image.length === 0) {
                    var image_path = 'static/images/default/item.svg';
                    var image_effect_for = '<div class="product-preview">' +
                            '<img src="' + image_path + '" class="img-fluid" style="height:270px" alt="Product">' +
                            '</div>';
                    $('#item_display_preview_for').append(image_effect_for);
                }
                $('.product-box-for').slick({
                    slidesToShow: 1,
                    slidesToScroll: 1,
                    arrows: false,
                    fade: true,
                    centerMode: true,
                    draggable: false,
                    asNavFor: '.product-box-nav',
                    focusOnChange: true,
                    autoplay: false,
                });
                $('.product-box-nav').slick({
                    slidesToShow: 4,
                    slidesToScroll: 1,
                    asNavFor: '.product-box-for',
                    dots: false,
                    arrows: false,
                    centerMode: true,
                    draggable: false,
                    focusOnSelect: true,
                    autoplay: false,
                    autoplaySpeed: 3000,
                    responsive: [
                        {
                            breakpoint: 768,
                            settings: {
                                slidesToShow: 3
                            }
                        },
                        {
                            breakpoint: 480,
                            settings: {
                                slidesToShow: 2
                            }
                        }
                    ]
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    getBranchDetails: function (id) {
        var loader = $(".loader-branch-search-view");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('branches/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $('.search-branch-no').html(data.branch_no);
                $('.search-branch-name').html(data.branch_name);
                $('.search-branch-address').html(data.store_address);
                $('.search-branch-mobile').html(data.store_telephone);
                $('.search-branch-email').html(data.store_email);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    nextPage: function () {
        var current_page = $('#view_customersearch_page_total').html();
        var total_pages = $('#view_customersearch_total_pages').val();
        if ((parseInt(current_page) + 1) <= parseInt(total_pages)) {
            $('#view_customersearch_page_total').html(parseInt(current_page) + 1);
            PosnicPro.customersearch.productListFunction();
        } else if (current_page === 1) {
            $('.next').attr("disabled", false).css({cursor: 'pointer', color: '#212529'});
        } else {
            $('.next').attr("disabled", true).css({cursor: 'not-allowed', color: '#d8d3d3'});
        }
    },
    previousPage: function () {
        var current_page = $('#view_customersearch_page_total').html();
        if (parseInt(current_page) - 1 >= 1) {
            $('#view_customersearch_page_total').html(parseInt(current_page) - 1);
            PosnicPro.customersearch.productListFunction();
        } else if (current_page === 1) {
            $('.previous').attr("disabled", false).css({cursor: 'pointer', color: '#212529'});
        } else {
            $('.previous').attr("disabled", true).css({cursor: 'not-allowed', color: '#d8d3d3'});
        }
    },
};
$(function () {
    $('#sales_new_item_name').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            var result = {};
            var suggestions = [];
            let params = {
                url: 'items/getCustomerSearchItemsAjaxList',
                data: 'query=' + query
            };
            PosnicPro.get(params, function (response) {
                suggestions: $.map(response.suggestions, function (dataItem) {
                    suggestions.push({"value": dataItem.item_name, "data": dataItem});
                });
                result["suggestions"] = suggestions;
                done(result);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        },
        onSelect: function (suggestion) {

            var currencySign = PosnicPro.local.get('currencySign');
            var image_path = (suggestion.data.image !== "item.svg") ? suggestion.data.image : 'static/images/default/item.svg';

            var price = 0;
            let sellingPrice = suggestion.data.selling_price;
            let discountAmount = suggestion.data.discount_amount;
            let discountPercentage = suggestion.data.discount_percentage;
            let tax = suggestion.data.tax;
            let taxType = suggestion.data.tax_type;
            let taxPrice = (sellingPrice * tax) / (100 + tax);
            var inclusive_price = sellingPrice - taxPrice.toFixed(2);
            if (discountAmount > 0 && tax > 0) {
                var discountValue = 0;
                if (taxType === 'exclusive') {
                    discountValue = sellingPrice - discountAmount;
                } else {
                    discountValue = inclusive_price - discountAmount;
                }
                price = discountValue + (tax / 100) * discountValue;

            } else if (discountPercentage > 0 && tax > 0) {
                var discountValue = 0;
                var taxValue = 0;
                if (taxType === 'exclusive') {
                    discountValue = (sellingPrice * (discountPercentage / 100));
                    taxValue = sellingPrice - discountValue;
                } else {
                    discountValue = (inclusive_price * (discountPercentage / 100));
                    taxValue = inclusive_price - discountValue;
                }
                price = taxValue + (tax / 100) * taxValue;
            } else if (discountAmount > 0) {
                price = sellingPrice - discountAmount;
            } else if (discountPercentage > 0) {
                price = sellingPrice - (sellingPrice * (discountPercentage / 100));
            } else if (tax > 0) {
                if (taxType === 'exclusive') {
                    price = sellingPrice + (sellingPrice * tax / 100);
                } else {
                    price = inclusive_price + (inclusive_price / 100) * tax;
                }
            } else {
                price = suggestion.data.selling_price;
            }
            var sellingPriceList = '<strike class="text_light_cl"><sub><span class="text_light_cl">' + currencySign + '&nbsp;</span><span class="number text_light_cl">' + suggestion.data.selling_price + '</span></sub></strike></span>';
            if (sellingPrice.toFixed(2) === price.toFixed(2)) {
                sellingPriceList = '<span style="display:none;"></span>';
            }

            var listItem = '<div class="col-lg-6 col-xl-3">' +
                    '<div class="product-bar m-b-30">' +
                    '<div class="product-head">' +
                    '<a href="javascript:void(0);" id="' + suggestion.data.item_id + '" onclick="return PosnicPro.customersearch.viewCustomerViewItem(this.id);"><img src="' + image_path + '" class="img-fluid" alt="product"></a>' +
                    '</div>' +
                    '<div class="product-body py-3">' +
                    '<div class="row align-items-center">' +
                    '<div class="col-12">' +
                    '<div class="d-inline-block">' +
                    '<span class="text-uppercase font-12 f-w-6">' + suggestion.data.category_name + '</span>' +
                    '</div>' +
                    '<div class="d-inline-block float-right">' +
                    '<i class="feather icon-star text-warning"></i>' +
                    '<i class="feather icon-star text-warning"></i>' +
                    '<i class="feather icon-star text-warning"></i>' +
                    '<i class="feather icon-star"></i>' +
                    '<i class="feather icon-star"></i>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '<div class="row align-items-center">' +
                    '<div class="col-12">' +
                    '<h6 class="mt-1 mb-3">' + suggestion.data.item_name + '</h6>' +
                    '</div>' +
                    '</div>' +
                    '<div class="row align-items-center">' +
                    '<div class="col-6">' +
                    '<div class="text-left">' +
                    '<h5 class="f-w-7 mb-0">' + sellingPriceList + '<h5 class="f-w-7 mb-0"><sup class="font-14 text_dark_cl">' + currencySign + '</sup><span class="discount_total text_dark_cl number">' + price.toFixed(2) + '</span></h5>' +
                    '</div>' +
                    '</div>' +
                    '<div class="col-6">' +
                    '<div class="text-right">' +
                    '<button type="button" class="btn btn-primary-rgba font-18" id="' + suggestion.data.item_id + '" onclick="return PosnicPro.customersearch.viewCustomerViewItem(this.id);" aria-label="View details"><i class="fa fa-eye"></i></button>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            $('#list-item').html(listItem);
            $('#sales_new_item_name').val('').focus();
            $('span.number').number(true, 2);
        },
        autoSelectFirst: true,
        transformResult: function (response) {
            return {
                suggestions: $.map(response.suggestions, function (dataItem) {
                    return {
                        value: dataItem.item_name,
                        data: dataItem
                    };
                })
            };
        },
        formatResult: function (suggestion, currentValue) {
            var data = suggestion.data.image;
            var price = 0;
            var currency = PosnicPro.local.get('currencySign');
            if (suggestion.data === -1 || typeof suggestion.price === undefined) {
                data = "item.svg";
                price = "";
                currency = '';
            }
            let sellingPrice = suggestion.data.selling_price;
            let discountAmount = suggestion.data.discount_amount;
            let discountPercentage = suggestion.data.discount_percentage;
            let tax = suggestion.data.tax;
            let taxType = suggestion.data.tax_type;
            let taxPrice = (sellingPrice * tax) / (100 + tax);
            var inclusive_price = sellingPrice - taxPrice.toFixed(2);
            if (discountAmount > 0 && tax > 0) {
                var discountValue = 0;
                if (taxType === 'exclusive') {
                    discountValue = sellingPrice - discountAmount;
                } else {
                    discountValue = inclusive_price - discountAmount;
                }
                price = discountValue + (tax / 100) * discountValue;

            } else if (discountPercentage > 0 && tax > 0) {
                var discountValue = 0;
                var taxValue = 0;
                if (taxType === 'exclusive') {
                    discountValue = (sellingPrice * (discountPercentage / 100));
                    taxValue = sellingPrice - discountValue;
                } else {
                    discountValue = (inclusive_price * (discountPercentage / 100));
                    taxValue = inclusive_price - discountValue;
                }
                price = taxValue + (tax / 100) * taxValue;
            } else if (discountAmount > 0) {
                price = sellingPrice - discountAmount;
            } else if (discountPercentage > 0) {
                price = sellingPrice - (sellingPrice * (discountPercentage / 100));
            } else if (tax > 0) {
                if (taxType === 'exclusive') {
                    price = sellingPrice + (sellingPrice * tax / 100);
                } else {
                    price = inclusive_price + (inclusive_price / 100) * tax;
                }
            } else {
                price = suggestion.data.selling_price;
            }
            var final_price = '<span class="suggestion-price pull-right">' + currency + '&nbsp;' + price.toFixed(2) + '</span>';
            var del_price = '<div class="pull-right font-12" style="margin-top:-20px;"><del>' + currency + '&nbsp;' + sellingPrice.toFixed(2) + '</del></div>';

            if (sellingPrice.toFixed(2) === price.toFixed(2)) {
                del_price = '<span style="display:none;"></span>';
            }

            var action = '' + final_price + '' +
                    '' + del_price + '';
            var image_path = (data !== "item.svg") ? data : 'static/images/default/item.svg';
            return '<img src="' + image_path + '" height="40" width="40" style="border-radius: 25%;" /> ' +
                    '<div class="suggestion-name">' +
                    $.Autocomplete.formatResult(suggestion, currentValue) +
                    '</div><span>' + action + '</span>';
        }
    });
});

$('#filter_customer_search').change(function () {
    $('#view_customersearch_page_total').html('1');
    PosnicPro.customersearch.productListFunction();
});

$(document).ready(function () {
    db.customerPlan.get('1').then(function (data) {
        if(data.read ===  false) {
            swal({
                title: 'You are Unauthorized',
                showCancelButton: true,
                confirmButtonClass: 'btn btn-outline-primary',
                cancelButtonClass: 'btn btn-outline-danger m-l-10',
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
            }).then(function () {
          }, function () {});
        }
    }).catch(function () {
    });
    if (typeof PosnicPro.themeManager !== 'undefined') {
        PosnicPro.themeManager.init();
        window.addEventListener('storage', function (e) {
            if (e.key === 'posnic_theme_settings') {
                PosnicPro.themeManager.init();
            }
        });
    }
    $("#range-slider").ionRangeSlider({
        type: "double",
        skin: "flat",
        grid: true,
        min: 0,
        max: 1000000,
        from: 0,
        to: 500000,
        prefix: "$",
        onStart: function () {
            $('#view_customersearch_page_total').html('1');
            PosnicPro.customersearch.productListFunction();
        },
        onFinish: function () {
            $('#view_customersearch_page_total').html('1');
            PosnicPro.customersearch.productListFunction();
        }
    });
});

