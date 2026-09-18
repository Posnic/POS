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

/*
 * ------------------------------------------------------------- THE LOGO
 *
 * A thermal printer has no notion of an image file. It lays down dots, and
 * the only way to put a logo on a roll is to hand it a bitmap: one bit per
 * dot, packed eight to a byte, as a GS v 0 raster command.
 *
 * So this is where the logo has to be prepared, not in the renderer. The
 * main process has no canvas, no image decoder and no idea what a PNG is;
 * the page that is about to print has all three, and already has the logo
 * on screen, decoded, in the print modal. Reported from a shop in Italy who
 * had Print Logo enabled and no logo on their roll - there was no code to
 * put one there.
 *
 * Dots, not pixels. A receipt printer is 203dpi, which is 8 dots per mm, so
 * the printable width is 576 dots at 80mm (72mm of paper) and 384 at 58mm
 * (48mm). Those are the same numbers as PosnicPro.PAPER.content, and the
 * same 12 dots per character that makes 48 and 32 columns.
 */
var DOTS = { '58': 384, '80': 576 };

/* About 30mm of roll. A logo taller than that is a poster, and the shop
   paid for the paper it is printed on. */
var LOGO_MAX_ROWS = 240;

/**
 * One bit per dot, MSB first, 1 = black, padded out to the full paper width.
 *
 * CENTRED IN THE BITMAP RATHER THAN BY THE PRINTER. `ESC a 1` centres text
 * on every printer and raster images on most of them, and "most" is not a
 * thing worth discovering on a shop counter. White padding either side costs
 * a few hundred bytes down a USB cable and is centred everywhere.
 */
function pack(ctx, dots, w, h, left) {
    var pixels = ctx.getImageData(0, 0, dots, h).data;

    /*
     * Floyd-Steinberg, because a threshold is not good enough here.
     * A logo is mostly flat colour with anti-aliased edges, and a hard cut
     * at 50% turns every gradient into a blob and every soft edge into a
     * staircase. Spreading the error is what makes a photograph or a
     * gradient read as itself in one bit.
     */
    var grey = new Float32Array(dots * h);
    for (var i = 0; i < dots * h; i++) {
        var o = i * 4;
        var a = pixels[o + 3] / 255;
        /* Over white: a transparent logo must not come out as a black box. */
        var r = pixels[o] * a + 255 * (1 - a);
        var g = pixels[o + 1] * a + 255 * (1 - a);
        var b = pixels[o + 2] * a + 255 * (1 - a);
        grey[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    var bytesPerRow = dots / 8;
    var out = new Uint8Array(bytesPerRow * h);
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < dots; x++) {
            var at = y * dots + x;
            var old = grey[at];
            var black = old < 128;
            /* Outside the logo is paper, and paper is never dithered. */
            if (x < left || x >= left + w) { black = false; }
            if (black) { out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7); }

            var err = old - (black ? 0 : 255);
            if (x + 1 < dots) grey[at + 1] += err * 7 / 16;
            if (y + 1 < h) {
                if (x > 0) grey[at + dots - 1] += err * 3 / 16;
                grey[at + dots] += err * 5 / 16;
                if (x + 1 < dots) grey[at + dots + 1] += err * 1 / 16;
            }
        }
    }

    var binary = "";
    for (var k = 0; k < out.length; k++) binary += String.fromCharCode(out[k]);
    return window.btoa(binary);
}

/**
 * The shop's logo as a raster, or null when there is not one to print.
 *
 * Read from the LIVE modal rather than from the HTML string receiptData is
 * given: an <img> in a detached div has not loaded yet, and drawing one is a
 * blank rectangle. The modal is on screen with the logo already decoded.
 */
/*
 * WHEN THE PAGE IS NOT ALLOWED TO LOOK.
 *
 * A canvas holding an image from another origin is TAINTED, and
 * getImageData throws rather than returning pixels. A shop whose logo
 * lives somewhere other than the dashboard - an S3 bucket, a CDN - hits
 * that, and so does a browser with no canvas at all.
 *
 * Those cases hand the SOURCE on instead of giving up. The main process
 * has no origin and no canvas, only a decoder, so the picture this page
 * was refused is simply a file there. See src/escpos-logo.js.
 *
 * Only when there is a logo to print. A shop with the switch off still
 * gets nothing, and nothing is fetched on its behalf.
 */
PosnicPro.receiptLogo = function (paperWidth) {
    var handOn = null;
    try {
        var dots = DOTS[paperWidth] || DOTS['80'];
        var holder = document.querySelector('.print-modal-body .branch_image');
        if (!holder) return null;
        /* Print Logo off sets this to none, and on sets it to block. */
        if (holder.style.display === 'none') return null;

        var img = holder.querySelector('img');
        if (!img || !img.getAttribute('src')) return null;

        /* `src` is the resolved absolute URL; the attribute is whatever
           was typed. The main process needs the resolved one. */
        handOn = { src: img.src || img.getAttribute('src') };
        if (!img.complete || !img.naturalWidth || !img.naturalHeight) return handOn;

        /*
         * Never enlarged. A 120px logo stretched across 576 dots and then
         * dithered is mud, and a shop looking at it would think the printer
         * was broken rather than that their file is small. Small and sharp
         * is the better failure.
         */
        var scale = Math.min(dots / img.naturalWidth, LOGO_MAX_ROWS / img.naturalHeight, 1);
        var w = Math.max(8, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var left = Math.floor((dots - w) / 2);

        var canvas = document.createElement('canvas');
        canvas.width = dots;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        if (!ctx) return handOn;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dots, h);
        ctx.drawImage(img, left, 0, w, h);

        return { width: dots, height: h, data: pack(ctx, dots, w, h, left) };
    } catch (e) {
        /*
         * A tainted canvas lands here, which is the common case and not
         * an error: the main process can read what this page cannot, so
         * the source is handed on rather than the logo dropped.
         */
        console.warn('[Print] the page cannot read this logo, passing it on:', e.message);
        return handOn;
    }
};

    /**
     * The symbol this receipt is already showing.
     *
     * Read off the rendered total rather than out of a setting, like
     * everything else in this file. The template is filled as
     * `currency + " " + amount`, so the answer is in the markup that was
     * about to be printed, and a shop that changed its currency changed it
     * in one place.
     *
     * It matters because `num` keeps the digits and throws the rest away:
     * an A4 sheet read "\u20ac 8.00" while the roll read "8.00", on every
     * line, for a shop in Italy. A receipt that does not say which money it
     * counted is a worse receipt in every country that is not the one the
     * reader assumes.
     *
     * Only the total lines are asked. A quantity is a number with no
     * symbol, and reading one would answer "no currency" with confidence.
     */
    function currencyOf(candidates) {
        for (var i = 0; i < candidates.length; i++) {
            if (!candidates[i]) continue;
            var raw = clean(candidates[i].value);
            var at = raw.search(/\d/);
            if (at < 1) continue;
            /* Whatever sits in front of the number that is not a minus. */
            var symbol = raw.slice(0, at).replace(/[-\s]/g, '');
            if (symbol) return symbol;
        }
        return '';
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

        /*
         * WHAT THE SHOP ASKED TO HAVE PRINTED UNDER THE TOTAL.
         *
         * Three separate things end up down here, and only the first of them
         * was ever reaching an ESC/POS receipt:
         *
         *   .print-sale-notes  a note somebody typed on THIS sale
         *   .footer-content    the shop's own Footer Content, from Settings
         *   the brand URL      a switch on that same settings screen
         *
         * `.footer-content` is the slot BOTH stored templates carry, and the
         * settings load fills it on every page load - so the text is sitting
         * in the markup this function is handed, and nothing here looked at
         * it. A shop that typed a footer, saved it, watched it print on A4 and
         * then found "Thank you, please visit again" on the 80mm roll was
         * reading the renderer's default, which fires only when this comes
         * back empty. It came back empty every time.
         *
         * The brand URL is a different shape of the same miss: it is not in
         * this markup at all, because printView appends it AFTER the thermal
         * branch has already returned. Read from the setting instead, so the
         * two papers answer to one switch rather than to two code paths.
         *
         * Line breaks are kept. `clean` collapses all whitespace, which is
         * right for an amount and wrong for a four-line address - a shop that
         * laid its footer out over several lines gets those lines.
         */
        var footerLines = [];
        var notes = textOf($root.find('.print-sale-notes'));
        if (notes) footerLines.push(notes);

        $root.find('.footer-content').each(function () {
            String($(this).text() || '').split(String.fromCharCode(10)).forEach(function (line) {
                var t = clean(line);
                if (t) footerLines.push(t);
            });
        });

        // Outermost only: the template nests one .invoice-policy inside
        // another, and both carry the same text.
        $root.find('.invoice-policy').each(function () {
            if ($(this).parents('.invoice-policy').length) return;
            var t = clean($(this).text());
            if (t) footerLines.push(t);
        });

        /* The switch is written to local storage as a boolean by one path and
           as a string by another, so compare the string either becomes. */
        if (typeof PosnicPro !== 'undefined' && PosnicPro.local
            && String(PosnicPro.local.get('print_url')) === 'true') {
            footerLines.push(PosnicPro.BRAND_URL);
        }

        return {
            currency: currencyOf([total, subTotal, change]),
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
