PosnicPro.customerview = {

    // Track previous items to detect changes
    previousItemsHash: null,
    isEmptyStateShown: false,

    // Generate hash for quick comparison
    generateItemsHash: function(items) {
        if (!items || items.length === 0) return '';
        return JSON.stringify(items.map(function(item) {
            return {
                name: item.name,
                qty: item.qty,
                price: item.price,
                total: item.total
            };
        }));
    },

    customer_display_update: function () {

        db.customerDisplay.get('1').then(function (data) {
            $(data.customer).each(function (key, val) {
                $(".customer-name").text(val.name);
                $(".customer-phone").text(val.phone);
                if (val.phone !== '') {
                    $("#show_customer_phone").show();
                } else {
                    $("#show_customer_phone").hide();
                }
                $(".customer-email").text(val.email);
                $(".customer-address").text(val.address);
            });
        });

        db.customerDisplay.get('2').then(function (data) {
            $(data.branch).each(function (key, val) {
                $(".branch-name").text(val.name);
                $(".branch-email").text(val.email);
                $(".branch-phone").text(val.phone);
                $(".branch-address").text(val.address);
                var image_path = (val.image !== "store.png") ? val.image : 'static/images/default/store.png';
                $('#image_previewing').attr('src', image_path);
            });
        });

        db.customerDisplay.get('3').then(function (data) {
            $(data.tender).each(function (key, val) {
                $(".sales_subtotal").number(val.subtotal, 2);
                $(".sales_total").number(val.total, 2);
                $(".tax_value").number(val.tax, 2);
                $(".discount_value").number(val.discount, 2);
                // Extra discount display
                var extraDisc = parseFloat(val.extra_discount) || 0;
                if (extraDisc > 0) {
                    $(".extra_discount_row").show();
                    $(".extra_discount_value").number(extraDisc, 2);
                    $(".extra_discount_sign").html('');
                    if (val.grand_total) {
                        $(".sales_total").number(val.grand_total, 2);
                    }
                } else {
                    $(".extra_discount_row").hide();
                }
            });
        }).catch(function () {
            // Only render empty state once to prevent blink
            if (!PosnicPro.customerview.isEmptyStateShown) {
                $('#list_linelitem').html('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_sale_empty">Sale Order Empty</lang></p></div><img loading="lazy" decoding="async" src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
                var imgHeight = $(window).height() - 200;
                $('.sales-cart-image').height(imgHeight);
                PosnicPro.customerview.isEmptyStateShown = true;
            }
            $(".sales_subtotal").number(0.00);
            $(".sales_total").number(0.00);
            $(".tax_value").number(0.00);
            $(".discount_value").number(0.00);
            $(".extra_discount_row").hide();
            $(".extra_discount_value").number(0.00);
        });


        db.customerDisplay.where('get').equals('yes').toArray(function (data) {
            // Collect all items from data
            var allItems = [];
            for (var i = 0; i < data.length; i++) {
                if (data[i].items) {
                    allItems = allItems.concat(data[i].items);
                }
            }
            
            // Check if items actually changed
            var currentHash = PosnicPro.customerview.generateItemsHash(allItems);
            if (currentHash === PosnicPro.customerview.previousItemsHash) {
                // No changes - skip update to prevent blink
                return;
            }
            PosnicPro.customerview.previousItemsHash = currentHash;
            
            // Show empty state if no items
            if (allItems.length === 0) {
                if (!PosnicPro.customerview.isEmptyStateShown) {
                    var container = document.getElementById('list_linelitem');
                    if (container) {
                        container.innerHTML = '<div class="text-center text-dark" style="padding: 40px;"><p style="font-size: 18px; margin-bottom: 20px;"><strong><lang class="lang_sale_empty">Sale Order Empty</lang></strong></p><img loading="lazy" decoding="async" src="static/images/general/wallet.svg" class="img-fluid" style="opacity: 0.4; max-width: 300px;" alt="wallet"></div>';
                        PosnicPro.customerview.isEmptyStateShown = true;
                    }
                }
                return;
            }
            
            PosnicPro.customerview.isEmptyStateShown = false; // Reset empty state flag
            
            // Only update if data changed
            var container = document.getElementById('list_linelitem');
            if (!container) {
                var newDiv = document.createElement("div");
                newDiv.id = "list_linelitem";
                var element = document.getElementById("list_linelitem_parent");
                element.appendChild(newDiv);
                container = newDiv;
            }
            
            // Clear and rebuild (but only when data changed)
            container.innerHTML = '';
            
            var itemIndex = 0;
            for (var i = 0; i < data.length; i++) {
                var fragment = document.createDocumentFragment();
                $(data[i].items).each(function (key, val) {
                    itemIndex++;
                    var currency = PosnicPro.local.get('currencySign');
                    $('.current-currency').text(currency);
                    var name = String(val.name || '');
                    var matches = name.match(/\b(\w)/g);
                    var joinLetter = matches ? matches.join('') : '';
                    var $card = $('<div class="card m-b-20"><div class="card-body"><div class="table-responsive"><table class="table table-borderless mb-0"><tbody><tr></tr></tbody></table></div></div></div>');
                    var $row = $card.find('tr');
                    $('<td><h5 class="my-0 font-13"></h5></td>').find('h5').text(itemIndex).end().appendTo($row);
                    $('<td><span class="action-icon badge badge-primary-inverse rounded-circle"></span></td>')
                        .find('span').text(joinLetter.substring(0, 3)).end().appendTo($row);
                    $('<td><h5 class="mt-0 font-13 view_item_Name"></h5></td>').find('h5').text(name).end().appendTo($row);

                    var addValueCell = function (labelClass, label, value, withCurrency) {
                        var $cell = $('<td><p class="mb-1 font-14 font-dark"><lang></lang></p><h5 class="mt-0 mb-0 font-13"></h5></td>');
                        $cell.find('lang').addClass(labelClass).text(label);
                        var $value = $cell.find('h5');
                        if (withCurrency) {
                            $value.text(currency + '\u00a0');
                            $('<span class="number"></span>').text(value).appendTo($value);
                        } else {
                            $value.text(value);
                        }
                        $cell.appendTo($row);
                    };

                    addValueCell('lang_price_title', 'Price', val.price, true);
                    addValueCell('lang_qty_title', 'Qty', val.qty, false);
                    addValueCell('lang_discount_title', 'Discount', val.discount, false);
                    addValueCell('lang_module_tax', 'Tax', val.tax, false);
                    addValueCell('lang_total_title', 'Total', val.total, true);
                    fragment.appendChild($card[0]);
                });
                container.appendChild(fragment);
            }
            $('span.number').number(true, 2);
        });
    }

};


$(document).ready(function () {
    db.customerPlan.get('1').then(function (data) {
        if(data.read ===  false) {
            swal({
                title: PosnicPro.i18n.t('lang_you_are_unauthorized', 'You are Unauthorized'),
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
    $('.branch_hide').hide();
    if (typeof PosnicPro.themeManager !== 'undefined') {
        PosnicPro.themeManager.init();
        window.addEventListener('storage', function (e) {
            if (e.key === 'posnic_theme_settings') {
                PosnicPro.themeManager.init();
            }
        });
    }
    qrCodeUpdate();
    PosnicPro.customerview.customer_display_update();

    // The clock is the only thing that needs a timer.
    setInterval(function () {
        var timeZone = PosnicPro.timeZone();
        var currentDateTimeCentralTimeZone = moment(new Date()).tz(timeZone).format('YYYY/MM/DD hh:mm:ss A');
        $('.custom_view_date').html(currentDateTimeCentralTimeZone);
    }, 1000);

    /*
     * Pushed, not polled (S4 v2). The till's writes to the customerDisplay
     * store broadcast on this channel (see the wrapper in PosnicPro.js), so
     * the display re-renders when something changed instead of re-reading
     * IndexedDB every 500ms forever. The debounce coalesces a burst of cart
     * writes into one paint; the slow interval is a safety net for a missed
     * message - or the whole mechanism, on a browser without the channel.
     */
    var renderQueued = null;
    function renderSoon() {
        clearTimeout(renderQueued);
        renderQueued = setTimeout(function () {
            PosnicPro.customerview.customer_display_update();
            qrCodeUpdate();
        }, 120);
    }
    var hasChannel = false;
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            new BroadcastChannel('posnic-customer-display').onmessage = renderSoon;
            hasChannel = true;
        } catch (e) { /* poll fallback below */ }
    }
    setInterval(renderSoon, hasChannel ? 10000 : 2000);
});
$(window).resize(function () {
    var height = $(window).height() - 130;
    $('#list_linelitem_parent,#branch_customer_view_details,#customer_view_details').height(height);
    $('#list_linelitem_parent,#branch_customer_view_details,#customer_view_details').css({ 'max-height': height, overflow: 'auto' });
});
$(window).trigger('resize');

function qrCodeUpdate() {
    db.customerDisplay.get('4').then(function (data) {
        $(data.qrdata).each(function (key, val) {
            if (val.status === 'yes') {
                $('.branch_qr').hide();
                $('.branch_hide').show();
                var loader = $(".loader-qrview");
                $("<div class='loadingSpinner'></div>").appendTo(loader);
                $('#QR_image_previewing').attr('src', val.image_url);
                $('.amount-customer').html(val.amount);
                PosnicPro.customerview.customer_display_update();
                var qrRecord = [];
                qrRecord.push({ amount: val.amount, image_url: val.image_url, status: 'no' });
                db.customerDisplay.put({ id: '4', 'clear': 'yes', 'get': 'no', qrdata: qrRecord });
                setTimeout(function () {
                    loader.find(".loadingSpinner:first").remove();
                }, 3000);
            }
        });
    }).catch(function () {
        $('#QR_image_previewing').attr('src', '');
        $('.amount-customer').html('');
        $('.branch_qr').show();
        $('.branch_hide').hide();
    });
}
