/*
 * Read a receipt back out of the HTML that was about to be printed.
 *
 * The desktop app prints receipts as ESC/POS rather than as a page, which needs
 * the sale as data, not as markup. Every caller of printView already builds the
 * receipt into .print-modal-body and hands over its HTML, and there are
 * seventeen of them, so rather than change all seventeen this reads the values
 * back out of that markup.
 *
 * That sounds fragile and would be, except the markup is not incidental: it is
 * the shop's configured receipt template (branch.thermal_body_print), whose
 * class names are the contract between the template and the code that fills it
 * in. sales_view.js writes into .invoice-content-heading and .item-total; this
 * reads from the same places.
 *
 * Reading the rendered receipt has one property that passing a sale object
 * would not: whatever the shop turned off in Config is already gone. The
 * visibility toggles run before the HTML is taken, and they use jQuery's
 * hide(), which writes an inline display:none. So the extractor drops hidden
 * elements and inherits every print setting for free, including settings added
 * after this was written.
 */
(function () {
    'use strict';

    // &nbsp; is U+00A0, which is not matched by \s in older engines and would
    // otherwise survive into the middle of an amount.
    function clean(s) {
        return String(s == null ? '' : s)
            .replace(/ /g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function textOf($el) {
        return $el && $el.length ? clean($el.first().text()) : '';
    }

    /*
     * A number, from a cell that also holds a currency symbol.
     *
     * Amounts print as "Rs. 1,234.50" or "₹&nbsp;1,234.50" depending on the
     * shop's currency setting, and the thousands separator has to go before
     * parseFloat sees it or 1,234.50 becomes 1.
     */
    function amountOf($el) {
        var t = textOf($el);
        if (!t) return null;
        var m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    }

    /*
     * Everything the shop chose not to print.
     *
     * jQuery's hide() writes display:none inline, so it survives into the HTML
     * string; a class-based rule in print.css would not, but the template does
     * not hide anything that way.
     */
    function dropHidden($root) {
        $root.find('[style]').each(function () {
            var style = (this.getAttribute('style') || '').replace(/\s+/g, '');
            if (style.indexOf('display:none') !== -1) {
                $(this).remove();
            }
        });
        return $root;
    }

    /*
     * Label/value rows from the totals block.
     *
     * The template gives label and value the same class, invoice-footer-value,
     * and distinguishes them only by position: the label sits in the wide
     * column and the value in the narrow one. So a row with two of them is a
     * pair, in that order. Rows carrying only a heading are spacers.
     *
     * Rows whose value is empty are dropped. The template ships more rows than
     * any one sale uses - credit, balance, round off, four kinds of tax - and
     * the ones that do not apply are simply never filled in.
     */
    function footerPairs($root) {
        var pairs = [];
        $root.find('.row').each(function () {
            var $row = $(this);
            // Only leaf rows: a row containing rows would double-count.
            if ($row.find('.row').length) return;
            /*
             * The sale notes and the policy block are laid out with the same
             * classes as a total - a heading above a value - but they are
             * prose, not a figure. Read as a pair they would print as
             * "SALE NOTES        deliver on Tuesday" with the note shoved
             * against the right margin, and then print again at the foot.
             */
            if ($row.find('.print-sale-notes, .invoice-policy').length) return;
            var $vals = $row.find('.invoice-footer-value, .invoice-footer-valuew');
            if ($vals.length < 2) return;
            var label = clean($vals.eq(0).text());
            var value = clean($vals.eq(1).text());
            if (!label || !value) return;
            pairs.push({ label: label.replace(/\s*:\s*$/, ''), value: value });
        });
        return pairs;
    }

    /*
     * The line items.
     *
     * sales_view.js appends one .receipt-row-item-holder per item, each with a
     * name, a quantity and an amount. Falling back to .invoice-content-heading
     * covers templates predating that class, where the row was a bare .row.
     */
    function items($root) {
        var out = [];
        var $rows = $root.find('.receipt-row-item-holder');
        if (!$rows.length) {
            $rows = $root.find('.invoice-content-heading').closest('.row');
        }
        $rows.each(function () {
            var $r = $(this);
            var name = textOf($r.find('.invoice-content-heading'));
            if (!name) return;
            var qty = textOf($r.find('.item-qty'));
            var amount = amountOf($r.find('.item-total'));
            out.push({ name: name, qty: qty || '1', amount: amount == null ? 0 : amount });
        });
        return out;
    }

    /*
     * One of the footer pairs, by label, removed from the list as it is taken.
     *
     * Taking means the caller can lay the well-known totals out deliberately -
     * subtotal, then tax, then a ruled TOTAL - and print whatever is left
     * underneath without repeating any of it. A shop that added its own row to
     * the template still gets it printed, just not in a place this code had to
     * know about in advance.
     */
    function take(pairs, patterns) {
        for (var i = 0; i < pairs.length; i++) {
            for (var j = 0; j < patterns.length; j++) {
                if (patterns[j].test(pairs[i].label)) {
                    return pairs.splice(i, 1)[0];
                }
            }
        }
        return null;
    }

    function num(pair) {
        if (!pair) return null;
        var m = String(pair.value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    }

    PosnicPro.receiptData = function (html) {
        var $root = dropHidden($('<div></div>').html(html));

        var pairs = footerPairs($root);

        // The well-known totals, in the order a receipt reads.
        var total = take(pairs, [/^total$/i, /grand total/i, /^net\b/i]);
        var subTotal = take(pairs, [/sub\s*total/i]);
        var discount = take(pairs, [/discount/i]);
        var roundOff = take(pairs, [/round/i]);
        var change = take(pairs, [/change/i]);

        // Tax rows are whatever names the shop's tax setup produced: CGST and
        // SGST, IGST, VAT, or a bare percentage. They keep their labels.
        var taxes = [];
        for (var i = pairs.length - 1; i >= 0; i--) {
            if (/gst|vat|tax|cess|^\d+(\.\d+)?%/i.test(pairs[i].label)) {
                taxes.unshift(pairs.splice(i, 1)[0]);
            }
        }

        var phone = textOf($root.find('.print_store_telephone'));
        var altPhone = textOf($root.find('.print_store_alternativephone'));

        var address = [];
        $root.find('.print_store_address').each(function () {
            var t = clean($(this).text());
            if (t) address.push(t);
        });

        /*
         * Who the sale was for.
         *
         * A walk-in customer has no name, and printing an empty "Customer:"
         * line looks like the receipt failed rather than like there was nobody
         * to name.
         */
        var customer = [];
        ['.print-name', '.print-phone', '.print-address', '.print-email'].forEach(function (sel) {
            var t = textOf($root.find(sel));
            if (t) customer.push(t);
        });

        var footerLines = [];
        var notes = textOf($root.find('.print-sale-notes'));
        if (notes) footerLines.push(notes);
        // Outermost only: the template nests one .invoice-policy inside
        // another, and both carry the same text.
        $root.find('.invoice-policy').each(function () {
            if ($(this).parents('.invoice-policy').length) return;
            var t = clean($(this).text());
            if (t) footerLines.push(t);
        });

        return {
            storeName: textOf($root.find('.print_store_name')),
            storeAddress: address.join('\n'),
            storePhone: [phone, altPhone].filter(Boolean).join(' / '),
            storeEmail: textOf($root.find('.print_store_email')),
            gstin: textOf($root.find('.print_store_gst')).replace(/^GST(IN)?\s*:?\s*/i, ''),

            title: textOf($root.find('.print-custom-title')) || textOf($root.find('.print-title')),
            billNo: textOf($root.find('.print_view_id')),
            date: textOf($root.find('.print_date')),
            customer: customer,

            items: items($root),

            subTotal: num(subTotal),
            taxes: taxes.map(function (p) { return { label: p.label, amount: num(p) }; }),
            discount: num(discount),
            roundOff: num(roundOff),
            total: num(total),
            change: num(change),

            // Anything the template carried that is not a total: payment mode,
            // balance, item count, and any row this shop added itself.
            extras: pairs,

            footer: footerLines.join('\n')
        };
    };
}());
