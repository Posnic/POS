/* global PosnicPro, jQuery */
(function ($) {
    'use strict';
    const reasons = ['Wrong method selected', 'Cash recorded as UPI', 'UPI recorded as cash',
        'Card recorded incorrectly', 'Mixed payment missed', 'Split amounts entered wrongly', 'Other reason'];
    const messages = [
        { label: 'Correct recorded bill', t: 'lang_paid_bill_review' },
        { label: 'Previously recorded', t: 'lang_paid_bill_previous' },
        { label: 'Corrected bill', t: 'lang_paid_bill_corrected' },
        { label: 'Already collected', t: 'lang_pc_already_collected' },
        { label: 'Amounts must equal the payment already collected.', t: 'lang_pc_amounts_must_equal_the_payment_already_collected_' },
        { label: 'Back', t: 'lang_pc_back' },
        { label: 'Cancel', t: 'lang_pc_cancel' },
        { label: 'Card recorded incorrectly', t: 'lang_pc_card_recorded_incorrectly' },
        { label: 'Cash recorded as UPI', t: 'lang_pc_cash_recorded_as_upi' },
        { label: 'Choose a different payment method or split.', t: 'lang_pc_choose_a_different_payment_method_or_split_' },
        { label: 'Choose a reason for the correction.', t: 'lang_pc_choose_a_reason_for_the_correction_' },
        { label: 'Close', t: 'lang_pc_close' },
        { label: 'Connection lost. Retry the same correction.', t: 'lang_pc_connection_lost_retry_the_same_correction_' },
        { label: 'Correct payment', t: 'lang_pc_correct_payment' },
        { label: 'Correct payment method', t: 'lang_pc_correct_payment_method' },
        { label: 'Correct the record only. No money is collected or refunded.', t: 'lang_pc_correct_the_record_only_no_money_is_collected_or_refunded_' },
        { label: 'Corrected payment', t: 'lang_pc_corrected_payment' },
        { label: 'Enter amounts for at least two methods.', t: 'lang_pc_enter_amounts_for_at_least_two_methods_' },
        { label: 'Enter valid payment amounts.', t: 'lang_pc_enter_valid_payment_amounts_' },
        { label: 'Left to allocate', t: 'lang_pc_left_to_allocate' },
        { label: 'Mixed', t: 'lang_pc_mixed' },
        { label: 'Mixed payment missed', t: 'lang_pc_mixed_payment_missed' },
        { label: 'Other reason', t: 'lang_pc_other_reason' },
        { label: 'Payment correction history', t: 'lang_pc_payment_correction_history' },
        { label: 'Payment correction saved.', t: 'lang_pc_payment_correction_saved_' },
        { label: 'Payment method', t: 'lang_pc_payment_method' },
        { label: 'Reason for correction', t: 'lang_pc_reason_for_correction' },
        { label: 'Recorded as', t: 'lang_pc_recorded_as' },
        { label: 'Review correction', t: 'lang_pc_review_correction' },
        { label: 'Save correction', t: 'lang_pc_save_correction' },
        { label: 'Split amounts entered wrongly', t: 'lang_pc_split_amounts_entered_wrongly' },
        { label: 'UPI recorded as cash', t: 'lang_pc_upi_recorded_as_cash' },
        { label: 'Wrong method selected', t: 'lang_pc_wrong_method_selected' }
    ];
    const t = text => { const entry = messages.find(m => m.label === text); return entry ? PosnicPro.i18n.t(entry.t, text) : text; };
    const esc = text => $('<span>').text(String(text == null ? '' : text)).html();
    function api(id, data) {
        return new Promise((resolve, reject) => {
            const fail = xhr => {
                let response = xhr.responseJSON;
                try { response = response || JSON.parse(xhr.responseText); } catch (_) { /* Network error */ }
                reject(new Error(response && (response.message || response.error?.message) || t('Connection lost. Retry the same correction.')));
            };
            if (data) PosnicPro.post({ url: 'sales/payment-correction/' + id, processData: false, data: JSON.stringify(data) }, resolve, fail);
            else PosnicPro.get({ url: 'sales/payment-correction/' + id }, resolve, fail);
        });
    }
    function open(id) {
        api(id).then(data => { if (!data.enabled) throw new Error(t('Enable payment corrections in Sale settings first.')); show(id, data); }).catch(error => PosnicPro.alert('error', error.message));
    }
    function show(id, data) {
        $('#payment-correction').remove();
        const factor = data.money.factor, digits = data.money.currencyDigits;
        const total = data.payments.reduce((n, r) => n + Math.round(r.amount * factor), 0);
        const money = n => (PosnicPro.local.get('currencySign') || '') + ' ' + (n / factor).toFixed(digits);
        const breakdown = rows => rows.map(r => esc(r.method) + ' ' + esc(money(Math.round(r.amount * factor)))).join(' + ');
        let selected = data.payments.length > 1 ? 'Mixed' : (data.methods.find(m => m.toLowerCase() === data.payments[0].method.toLowerCase()) || data.payments[0].method);
        let reason = '', request = null, busy = false;
        const amounts = Object.fromEntries(data.payments.map(r => [data.methods.find(m => m.toLowerCase() === r.method.toLowerCase()) || r.method, String(r.amount)]));
        const button = (label, attr) => '<button type="button" class="btn btn-outline-primary pc-choice" ' + attr + '>' + esc(t(label)) + '</button>';
        const $modal = $('<div id="payment-correction" class="modal fade" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="pc-title"><div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content">'
            + '<div class="modal-header"><div><h4 id="pc-title">' + esc(t('Correct payment method')) + '</h4><span>' + esc(data.bill) + '</span></div><button type="button" class="btn btn-light pc-close" data-dismiss="modal" aria-label="' + esc(t('Close')) + '">×</button></div>'
            + '<div class="modal-body"><p>' + esc(t('Already collected')) + ': <strong>' + esc(money(total)) + '</strong><br>' + esc(t('Recorded as')) + ': ' + breakdown(data.payments) + '</p>'
            + '<p class="text-muted">' + esc(t('Correct the record only. No money is collected or refunded.')) + '</p>'
            + '<div class="pc-edit"><h5>' + esc(t('Payment method')) + '</h5><div class="pc-buttons">'
            + data.methods.concat(data.methods.length > 1 ? ['Mixed'] : []).map((m, i) => button(m, 'data-method="' + i + '"')).join('') + '</div>'
            + '<div class="pc-amounts">' + data.methods.map((m, i) => '<label>' + esc(m) + '<input class="form-control" type="text" inputmode="decimal" data-amount="' + i + '" value="' + esc(amounts[m] || '') + '" placeholder="0" autocomplete="off"></label>').join('') + '</div>'
            + '<p class="pc-remaining" aria-live="polite"></p><h5>' + esc(t('Reason for correction')) + '</h5><div class="pc-buttons pc-reasons">'
            + reasons.map((r, i) => button(r, 'data-reason="' + i + '"')).join('') + '</div>'
            + '<label class="pc-other">' + esc(t('Other reason')) + '<textarea class="form-control" rows="3" maxlength="300"></textarea></label></div>'
            + '<div class="pc-review" hidden></div><p class="pc-error text-danger" role="alert"></p></div>'
            + '<div class="modal-footer"><button type="button" class="btn btn-light pc-back">' + esc(t('Back')) + '</button><button type="button" class="btn btn-light pc-cancel" data-dismiss="modal">' + esc(t('Cancel')) + '</button><button type="button" class="btn btn-primary pc-next">' + esc(t('Review correction')) + '</button><button type="button" class="btn btn-primary pc-save" hidden>' + esc(t('Save correction')) + '</button></div></div></div></div>');
        if (!$('#payment-correction-style').length) $('head').append('<style id="payment-correction-style">#payment-correction .btn{min-height:50px;min-width:50px;font-size:16px;white-space:normal}#payment-correction .pc-buttons{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 20px}#payment-correction .pc-choice{flex:1 0 130px;padding:12px 18px}#payment-correction .pc-reasons .pc-choice{flex:1 0 200px}#payment-correction .pc-amounts{display:flex;flex-wrap:wrap;gap:14px}#payment-correction .pc-amounts label{flex:1 0 140px}#payment-correction input{min-height:50px;font-size:18px}#payment-correction .modal-body{max-height:70vh;overflow:auto}#payment-correction .pc-other{width:100%}#payment-correction .pc-review{font-size:18px;line-height:1.7}#payment-correction [hidden]{display:none!important}</style>');
        $('body').append($modal);
        function values() {
            if (selected !== 'Mixed') return [{ method: selected, amount: total / factor }];
            return data.methods.map(method => {
                const raw = (amounts[method] || '').trim();
                const valid = new RegExp('^\\d+(?:\\.\\d{1,' + Math.max(1, digits) + '})?$').test(raw) && (digits || !raw.includes('.'));
                return { method, amount: raw === '' ? 0 : valid ? Number(raw) : NaN };
            }).filter(r => r.amount !== 0);
        }
        function validation() {
            const rows = values(), amount = rows.reduce((n, r) => n + Math.round(r.amount * factor), 0);
            if (!rows.length || !Number.isSafeInteger(amount) || rows.some(r => !Number.isFinite(r.amount) || r.amount <= 0)) return t('Enter valid payment amounts.');
            if (selected === 'Mixed' && rows.length < 2) return t('Enter amounts for at least two methods.');
            if (amount !== total) return t('Amounts must equal the payment already collected.');
            const canonical = list => JSON.stringify(list.map(r => [r.method.toLowerCase(), Math.round(r.amount * factor)]).sort());
            if (canonical(rows) === canonical(data.payments)) return t('Choose a different payment method or split.');
            if (!reason || (reason === 'Other reason' && $modal.find('textarea').val().trim().length < 3)) return t('Choose a reason for the correction.');
            return '';
        }
        function paint() {
            $modal.find('[data-method]').each(function () {
                const m = data.methods.concat(['Mixed'])[Number($(this).attr('data-method'))];
                $(this).toggleClass('active', m === selected).attr('aria-pressed', m === selected);
            });
            $modal.find('[data-reason]').each(function () {
                const active = reasons[Number($(this).attr('data-reason'))] === reason;
                $(this).toggleClass('active', active).attr('aria-pressed', active);
            });
            $modal.find('.pc-amounts').toggle(selected === 'Mixed');
            $modal.find('.pc-other').toggle(reason === 'Other reason');
            const entered = values().reduce((n,r) => n + Math.round(r.amount * factor), 0);
            $modal.find('.pc-remaining').text(selected === 'Mixed' && Number.isFinite(entered) ? t('Left to allocate') + ': ' + money(total - entered) : '');
            $modal.find('.pc-next').prop('disabled', !!validation());
        }
        $modal.on('click', '[data-method]', function () { selected = data.methods.concat(['Mixed'])[Number($(this).attr('data-method'))]; paint(); });
        $modal.on('click', '[data-reason]', function () { reason = reasons[Number($(this).attr('data-reason'))]; paint(); });
        $modal.on('input', '[data-amount]', function () { amounts[data.methods[Number($(this).attr('data-amount'))]] = $(this).val(); paint(); });
        $modal.on('input', 'textarea', paint);
        $modal.find('.pc-back').hide().on('click', () => {
            request = null;
            $modal.find('.pc-edit,.pc-next').show(); $modal.find('.pc-review,.pc-save').prop('hidden', true); $modal.find('.pc-back').hide();
        });
        $modal.find('.pc-next').on('click', () => {
            const error = validation(); if (error) { $modal.find('.pc-error').text(error); return; }
            request = { requestId: window.crypto.randomUUID(), revision: data.revision, payments: values(),
                reason: reason === 'Other reason' ? $modal.find('textarea').val().trim() : reason };
            $modal.find('.pc-review').html('<strong>' + esc(t('Corrected payment')) + '</strong><p>' + breakdown(request.payments) + '</p><strong>' + esc(t('Reason for correction')) + '</strong><p>' + esc(request.reason) + '</p>').prop('hidden', false);
            $modal.find('.pc-edit,.pc-next').hide(); $modal.find('.pc-back').show(); $modal.find('.pc-save').prop('hidden', false); $modal.find('.pc-error').text('');
        });
        $modal.find('.pc-save').on('click', async () => {
            if (busy || !request) return;
            busy = true; $modal.find('button').prop('disabled', true);
            try {
                await api(id, request);
                busy = false; $modal.modal('hide');
                PosnicPro.alert('success', t('Payment correction saved.'));
                if (PosnicPro.sales._correctionSaleId === id) PosnicPro.sales.openDoc(id);
            } catch (error) {
                $modal.find('.pc-error').text(error.message);
                // Keep the same id and payload on an uncertain retry.
                $modal.find('.pc-back').hide();
            } finally { busy = false; $modal.find('button').prop('disabled', false); }
        });
        $modal.on('hide.bs.modal', event => { if (busy) event.preventDefault(); });
        $modal.on('hidden.bs.modal', () => $modal.remove());
        paint(); $modal.modal({ backdrop: 'static', keyboard: false, show: true });
    }
    function attach(id, sale) {
        $('#sales_doc [data-paid-bill-history]').remove();
        if (sale.paid_bill_corrections && sale.paid_bill_corrections.length) {
            const $audit = $('<details class="card p-3 mb-3" data-paid-bill-history><summary></summary><div></div></details>');
            $audit.find('summary').text(t('Correct recorded bill'));
            sale.paid_bill_corrections.slice().reverse().forEach(entry => {
                $('<p class="mt-3 mb-0">').text(new Date(entry.at).toLocaleString() + ' · ' + entry.actor + ' · ' + entry.reason).appendTo($audit.find('div'));
                $('<p>').text(entry.before.sales_total + ' → ' + entry.after.sales_total + ' · ' + entry.after.payment_mode).appendTo($audit.find('div'));
            });
            $('#sales_doc .doc-scroll').prepend($audit);
        }
        $('#sales_doc [data-correct-payment]').remove();
        if (sale.payment_status !== 'Paid' || /cancel|return|refund/i.test(sale.sale_process || '')) return;
        api(id).then(data => {
            if (PosnicPro.sales._correctionSaleId !== id) return;
            if (data.enabled) $('<button type="button" class="dropdown-item" data-correct-payment data-module="sales" data-access="write">').text(t('Correct payment')).on('click', () => open(id)).appendTo('#sales_doc [data-sale-edit-actions]');
            if (data.history.length) {
                const $history = $('<details class="card p-3 mb-3"><summary></summary><div></div></details>');
                $history.find('summary').text(t('Payment correction history'));
                data.history.slice().reverse().forEach(entry => {
                    $('<p class="mt-3 mb-0">').text(new Date(entry.at).toLocaleString() + ' · ' + entry.actor + ' · ' + entry.reason).appendTo($history.find('div'));
                    $('<p>').text(entry.before.map(r => r.method + ' ' + r.amount).join(' + ') + ' → ' + entry.after.map(r => r.method + ' ' + r.amount).join(' + ')).appendTo($history.find('div'));
                });
                $('#sales_doc .doc-scroll').prepend($history);
            }
        }).catch(() => { /* Disabled or no write access: do not offer the workflow. */ });
    }
    function reviewBillEdit(before, after, save) {
        $('#paid-bill-review').remove();
        const $modal = $('<div id="paid-bill-review" class="modal fade" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="paid-bill-review-title"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h4 id="paid-bill-review-title"><lang class="lang_paid_bill_review">Correct recorded bill</lang></h4><button type="button" class="btn btn-light" data-dismiss="modal" aria-label="Close" data-t-aria-label="lang_close_title">×</button></div><div class="modal-body"><p><lang class="lang_paid_bill_no_movement">This changes a wrongly recorded bill and payment. No money is collected or refunded.</lang></p><p class="bill-before"></p><p class="bill-after"></p><p><lang class="lang_paid_bill_use_return">If the original money was actually collected, use Return items to record the refund instead.</lang></p><label for="paid-bill-reason"><lang class="lang_pc_reason_for_correction">Reason for correction</lang></label><textarea id="paid-bill-reason" class="form-control" rows="3" maxlength="300"></textarea></div><div class="modal-footer"><button type="button" class="btn btn-light" data-dismiss="modal"><lang class="lang_pc_cancel">Cancel</lang></button><button type="button" class="btn btn-primary" data-save-correction disabled><lang class="lang_pc_save_correction">Save correction</lang></button></div></div></div></div>');
        const money = amount => (PosnicPro.local.get('currencySign') || '') + ' ' + Number(amount).toFixed(2);
        $modal.find('.bill-before').text(t('Previously recorded') + ': ' + money(before.sales_total));
        $modal.find('.bill-after').text(t('Corrected bill') + ': ' + money(after.sales_total) + ' · ' + after.payment_mode);
        $modal.find('textarea').on('input', function () { $modal.find('[data-save-correction]').prop('disabled', $(this).val().trim().length < 3); });
        $modal.find('[data-save-correction]').one('click', function () {
            const reason = $modal.find('textarea').val().trim();
            if (reason.length < 3) return;
            $(this).prop('disabled', true);
            const request = { id: window.crypto.randomUUID(), reason, originalTotal: Number(before.sales_total), updatedAt: new Date(before.updated_date).toISOString() };
            $modal.modal('hide');
            save(request);
        });
        $modal.on('hidden.bs.modal', () => $modal.remove());
        $('body').append($modal); if (PosnicPro.i18n.apply) PosnicPro.i18n.apply($modal[0]); $modal.modal({backdrop:'static',keyboard:false,show:true});
    }
    window.PosnicPaymentCorrection = { open, attach, reviewBillEdit };
})(jQuery);
