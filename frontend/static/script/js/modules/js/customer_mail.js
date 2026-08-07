PosnicPro.customermail = {

    customerMailPrint: function () {
        let id = PosnicPro.getAllUrlParams().id;
        let params = {
            url: 'sales/getCustomerPrint',
            data: {customer_id: id}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {

                let data = response.data;
                let image_path = (data.branch_image !== "store.png") ? data.branch_image : 'static/images/default/' + data.branch_image;
                $('.branch_image').attr('src', image_path);
                $("#getCustomerMailId").val(id);
                $(".branch-name").html(data.branch_name);
                $(".branch-email").html(data.branch_email);
                $(".branch-phone").html(data.branch_phone);
                $(".branch-address").html(data.branch_address);
                $('.sales_id').html(data.sales_id);
                $('.customer_date_view').html(data.date);
                $('.customer_time_view').html(data.time);
                $('.customer_payment_mode_view').html(data.payment_mode);
                $('.customer_name_view').html(data.customer_name);
                $('.customer_phone_view').html(data.customer_phone);
                $('.customer_email_view').html(data.customer_email);
                $('.customer_address_view').html(data.customer_address);
                $('#barcodeValue').val(data.sales_id);
                PosnicPro.printBarcode();

                let discount = '--';
                if (data.discount > 0) {
                    discount = (data.discount).toFixed(2);
                } else {
                    $('#customer_discount_view').hide();
                }
                $('.customer_discount_view').html(discount);

                $('.customer_subtotal_view').html(data.branch_currency + '&nbsp;' + '' + data.sales_sub_total.toFixed(2));
                $('.customer_total_view').html(data.branch_currency + '&nbsp;' + '' + data.total_amount.toFixed(2));
                $('.customer_Credits_view').html(data.branch_currency + '&nbsp;' + '' + data.partial_balance.toFixed(2));
                $('.customer_BalanceDue_view').html(data.branch_currency + '&nbsp;' + '' + data.payment_pending.toFixed(2));
                $('.customer_PaymentStatus_view').html(data.payment_status);

                (typeof (data.payment_status) === "undefined" || data.payment_status === null || data.payment_status === 'Paid') ?
                        $('.customer_PaymentStatus_view').addClass('badge badge-success-inverse') :
                        $('.customer_PaymentStatus_view').addClass('badge badge-warning-inverse');
                (data.partial_check === "true") ? $('.partial-check-hide').show() : $('.partial-check-hide').hide();
                let length = data.total_items;
                var taxText = [];
                var taxCgstText = [];
                var qtyTotal = 0;
                var igst = 0;
                var cgst = 0;
                var itemTotalTax = 0;
                var itemPrintTaxDetails = [];
                for (var i = 0; i < length; i++) {
                    if (data.items[i].tax !== 0) {
                        tax = data.items[i].tax;
                        taxText.push(tax + '% &nbsp;');
                        taxCgstText.push(tax / 2 + '% &nbsp;');
                    }
                    igst += data.items[i].igst_tax;
                    cgst += data.items[i].cgst_tax;
                    let tax_type = data.items[i].tax_type;
                    let price;
                    if (tax_type === 'exclusive') {
                        price = data.items[i].item_price;
                    } else {
                        price = data.items[i].item_price / ((data.items[i].tax / 100) + 1);
                    }
                    qtyTotal += parseFloat(data.items[i].item_quantity);
                    let rowHTMLLine = ' <tr> ' +
                            '<td class="text-left">' + data.items[i].item_name + '</td>' +
                            '<td class="text-center">' + data.items[i].item_quantity + '</td>' +
                            '<td class="text-right">' + data.branch_currency + '&nbsp;' + (price * data.items[i].item_quantity).toFixed(2) + ' </td>' +
                            '</tr>';
                    $('#customer_item_list tbody').append(rowHTMLLine);

                    var discountVal = (data.items[i].item_discount > 0) ? data.items[i].item_discount : data.items[i].item_discount_percentage;
                    var discountSign = (data.items[i].item_discount > 0) ? data.branch_currency : '%';
                    if (discountSign === '%') {
                        var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (((price.toFixed(2)) * data.items[i].item_quantity) * (discountVal / 100)));
                    } else {
                        var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (discountVal * data.items[i].item_quantity));
                    }

                    if (data.items[i].tax_fields.length > 0) {
                        var taxItemLength = data.items[i].tax_fields.length;
                        for (var z = 0; z < taxItemLength; z++) {
                            var taxItem = data.items[i].tax_fields[z];
                            var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                            itemTotalTax += taxAmount;
                            itemPrintTaxDetails.push({
                                "tax_id": taxItem.tax_id.$oid,
                                "tax_name": taxItem.tax_name,
                                "tax_value": taxAmount
                            });
                        }
                    } else if (data.items[i].tax_fields.length === 0 && data.items[i].tax > 0) {
                        var taxAmount = (priceAmount / 100) * data.items[i].tax;
                        itemTotalTax += taxAmount;
                        itemPrintTaxDetails.push({
                            "tax_id": data.items[i].tax,
                            "tax_name": data.items[i].tax,
                            "tax_value": taxAmount
                        });
                    }
                }

                var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                $(taxPrintItemData).each(function (key, val) {
                    if (val.amount > 0) {
                        var rowHTMLTaxLine = '<p>' +
                                '<span class="lbl" style="display:none;">' + val.tax_id + '</span>' +
                                '<span class="lbl">' + val.tax_name + '</span>' +
                                '<span class="amt">' + data.branch_currency + '&nbsp;<span class="number">' + (val.amount).toFixed(2) + '</span></span>' +
                                '</p>';
                        $('#tax_details_customerprint').append(rowHTMLTaxLine);
                    }
                });

                $('.customer_itemlength_view').html(length);
                $('.customer_itemqty_view').html(qtyTotal);

                $('.customer_tax_print_hide').hide();
                $('#customer_tax_print_hide').hide();

                /* Indian gst calculation */
                if (data.gst === 'enable') {
                    $('.heading-tax-name').hide();
                    $('.customer_indian-gstr').show();
                    if (parseFloat(igst) > 0) {
                        $('.customer_hide-show-igst').show();
                        $('.customer_hide-show-scgst').hide();
                        $('.customer_gst-text-value').html(PosnicPro.removeDuplicates(taxText));
                        $('.print_igst_tax_view').html(data.branch_currency + '&nbsp;<span class="number">' + igst.toFixed(2) + '</span>');
                    } else if (parseFloat(cgst) > 0) {
                        $('.customer_hide-show-scgst').show();
                        $('.customer_hide-show-igst').hide();
                        $('.customer_cgst-text-value').html(PosnicPro.removeDuplicates(taxCgstText));
                        $('.print_csgst_tax_view').html(data.branch_currency + '&nbsp;<span class="number">' + cgst.toFixed(2) + '</span>');
                    } else {
                        $('.customer_indian-gstr').hide();
                    }
                } else {
                    $('.customer_indian-gstr').hide();
                    $('#customer_tax_print_hide').show();
                    $('.customer_tax_print_hide').show();
                }
                var tax = '--';
                if (data.tax !== 0 && data.tax !== '') {
                    tax = (data.tax).toFixed(2);
                } else {
                    $('.customer_indian-gstr,.customer_tax_print_hide,#customer_tax_value').hide();
                }
                $('.customer_tax_value').html(data.branch_currency + '&nbsp;' + '' + tax);

                let roundOffValue = data.round_off;
                let sign = roundOffValue >= 0 ? '+' : '-';
                $('#customer_roundoff_view').hide();
                if (roundOffValue !== 0) {
                    $('#customer_roundoff_view').show();
                    $('.customer_roundoff_view').html(data.branch_currency + '<span class="number">' + roundOffValue.toFixed(2));
                }

            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    }
};

$(document).ready(function () {
    PosnicPro.customermail.customerMailPrint();
});

$("#downloadPDF").click(function () {
    const {jsPDF} = window.jspdf;

    const receiptElement = document.getElementById("receipt");

    // Higher render scale = sharper output. Factor in the device pixel ratio so
    // it stays crisp on hi-dpi screens; floor at 3 and cap at 4 to keep memory
    // and file size reasonable.
    const scale = Math.min(4, Math.max(3, (window.devicePixelRatio || 1) * 2));

    html2canvas(receiptElement, {
        scale: scale,
        useCORS: true, // Ensures cross-origin images work
        backgroundColor: "#ffffff", // solid white, no transparency artifacts
        width: receiptElement.scrollWidth,   // capture full content width (no right-edge clipping)
        height: receiptElement.scrollHeight,
        windowWidth: receiptElement.scrollWidth,
        logging: false
    }).then(canvas => {
        const imgData = canvas.toDataURL("image/png"); // PNG = lossless

        // Set PDF dimensions. The receipt keeps its 80mm width; a left margin is
        // added to the PDF only (the on-screen receipt is unaffected).
        const contentWidth = 80; // receipt width in mm
        const leftMarginMm = 60 * 25.4 / 96; // 60px -> ~15.88mm at 96dpi
        const pageWidth = contentWidth + leftMarginMm;
        const pdfHeight = (canvas.height * contentWidth) / canvas.width; // keep aspect ratio

        const pdf = new jsPDF({
            unit: "mm",
            format: [pageWidth, pdfHeight],
            compress: false // keep the receipt image at full quality
        });

        // Offset by the left margin; "NONE" = no re-compression -> max sharpness
        pdf.addImage(imgData, "PNG", leftMarginMm, 0, contentWidth, pdfHeight, undefined, "NONE");
        let saleId = $('.sales_id').html();
        pdf.save(saleId + ".pdf");
    });
});