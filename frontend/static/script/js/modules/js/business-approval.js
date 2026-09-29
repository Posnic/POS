(function () {
    'use strict';
    var active = null;
    var api = PosnicPro.businessApproval = {};
    function request(method, path, body) {
        return new Promise(function (resolve, reject) {
            PosnicPro[method]({ url: 'sales/business-decisions' + path, data: body ? JSON.stringify(body) : undefined, timeout: 20000 },
                function (response) { resolve(response.data); }, function (xhr) { reject(xhr); });
        });
    }
    function errorText(error) {
        var body = error && error.responseJSON;
        if (!body && error && error.responseText) { try { body = JSON.parse(error.responseText); } catch (_) {} }
        var code = body && body.error && body.error.code;
        if (code === 'decision_revision_changed' || code === 'bill_changed') return PosnicPro.i18n.t('lang_business_bill_changed', 'The bill has changed. Cancel this request and review the updated bill before asking again.');
        if (code === 'unsupported_discount_combination' || code === 'unsupported_discount_currency') return PosnicPro.i18n.t('lang_business_unsupported_bill', 'This bill needs an on-site manager. Remote approval is not available for this combination yet.');
        if (error && (error.status === 401 || error.status === 403)) return PosnicPro.i18n.t('lang_business_access_changed', 'Your access has changed. Sign in again and check this request before continuing.');
        return PosnicPro.i18n.t('lang_business_status_unconfirmed', 'We could not confirm the current status. Keep this bill pending and check again. Do not create a second sale.');
    }
    function release() {
        PosnicPro.sales.submissionInProgress = false;
        $('#save_btn').prop('disabled', false);
        $('#save_submit').removeClass('disabled');
        $('.loadingSpinner').remove();
    }
    function eligible(data) {
        return data && Number(data.extra_discount) > 0 && Array.isArray(data.items) && data.items.length <= 100 &&
            !data._id && !data.sales_id && (!data.sale_process || /^(Add|add)$/.test(data.sale_process)) &&
            String(data.unpaid) !== 'true' && String(data.partial_check) !== 'true' && !!data.payment_mode &&
            !data.coupon_code && !(Number(data.redeem_points) > 0) && !(Number(data.loyalty_redeem_points) > 0) &&
            !(Number(data.tip_amount) > 0) && !data.items.some(function (item) {
                return ['sale_inline_discount_value', 'sale_inline_discount_pervalue', 'item_discount', 'item_discount_percentage', 'discount_amount', 'discount_percentage']
                    .some(function (field) { return Number(item[field]) > 0; });
            });
    }
    function storageKey(capabilities) {
        return 'posnic_business_approval:' + API_URL + ':' + capabilities.branchId + ':' + capabilities.requesterId;
    }
    function stored(key) {
        try {
            var ref = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (ref && /^[A-Za-z0-9_-]{16,128}$/.test(ref.operationId) &&
                (ref.requestId === null || /^[a-f\d]{24}$/.test(ref.requestId))) return ref;
        } catch (_) {}
        return null;
    }
    function remember(flow) {
        // References only: no credentials, customer details, bill lines or reason.
        sessionStorage.setItem(flow.key, JSON.stringify(flow.reference));
    }
    function element(tag, text, className) {
        var node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function close(flow) {
        if (active !== flow || flow.busy) return;
        clearTimeout(flow.timer);
        flow.dialog.close(); flow.dialog.remove(); active = null;
        release();
        if (flow.focus && flow.focus.isConnected) flow.focus.focus();
    }
    function button(flow, label, action, primary) {
        var node = element('button', label, primary ? 'business-approval-primary' : 'business-approval-secondary');
        node.type = 'button'; node.disabled = flow.busy;
        node.addEventListener('click', action);
        flow.actions.appendChild(node);
        return node;
    }
    function money(record, field) {
        try { return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: record.summary.currency }).format(record.summary[field] / Math.pow(10, record.summary.currencyDigits)); }
        catch (_) { return record.summary.currency + ' ' + (record.summary[field] / Math.pow(10, record.summary.currencyDigits)).toFixed(record.summary.currencyDigits); }
    }
    function validRecord(flow, record) {
        var summary = record && record.summary;
        if (!record || !/^[a-f\d]{24}$/.test(record.id || '') || record.operationId !== flow.reference.operationId ||
            (flow.reference.requestId && record.id !== flow.reference.requestId) ||
            record.branchId !== flow.scope.branchId || record.requesterId !== flow.scope.requesterId ||
            ['pending', 'approved', 'declined', 'cancelled', 'expired', 'applying', 'applied'].indexOf(record.state) === -1 ||
            !Number.isFinite(Date.parse(record.expiresAt)) || !summary || summary.currencyDigits !== 2 ||
            !/^[A-Z]{3}$/.test(summary.currency || '') || typeof summary.reason !== 'string' ||
            !['beforeDiscountMinor', 'discountMinor', 'payableMinor'].every(function (field) { return Number.isSafeInteger(summary[field]) && summary[field] >= 0; }) ||
            !Number.isInteger(summary.roundingMinor) || Math.abs(summary.roundingMinor) > 100 ||
            BigInt(summary.payableMinor) !== BigInt(summary.beforeDiscountMinor) - BigInt(summary.discountMinor) + BigInt(summary.roundingMinor)) return false;
        return !record.checkout || (['not_started', 'reconciling', 'saved', 'applied'].indexOf(record.checkout.state) !== -1 &&
            (['saved', 'applied'].indexOf(record.checkout.state) === -1 ? record.checkout.saleId === null : /^[a-f\d]{24}$/.test(record.checkout.saleId || '')));
    }
    function render(flow) {
        if (active !== flow) return;
        flow.actions.replaceChildren(); flow.details.replaceChildren();
        flow.dialog.setAttribute('aria-busy', String(flow.busy));
        flow.closeButton.disabled = flow.busy;
        flow.reason.hidden = !!flow.reference || flow.recoveryOnly;
        flow.reasonLabel.hidden = !!flow.reference || flow.recoveryOnly;
        flow.error.textContent = flow.errorMessage || '';
        if (flow.recoveryMode) { renderRecoveries(flow); return; }
        var record = flow.record;
        var checkout = record && record.checkout;
        var saved = checkout && (checkout.state === 'saved' || checkout.state === 'applied');
        var title = PosnicPro.i18n.t('lang_business_ask_owner', 'Ask an owner');
        var message = PosnicPro.i18n.t('lang_business_request_explanation', 'Send this bill and a short reason to an owner in Posnic Business. Approval applies only to this exact bill.');
        if (flow.reference) {
            title = PosnicPro.i18n.t('lang_business_waiting_owner', 'Waiting for an owner');
            message = PosnicPro.i18n.t('lang_business_keep_pending', 'Keep the bill pending. You can save it after an owner approves.');
            if (!record) {
                title = PosnicPro.i18n.t('lang_business_checking_request', 'Checking your request');
                message = PosnicPro.i18n.t('lang_business_request_unknown', 'The request may still be on its way. Check its status before starting another request.');
            } else if (saved) {
                title = PosnicPro.i18n.t('lang_business_bill_saved', 'Bill saved');
                message = checkout.state === 'applied' ? PosnicPro.i18n.t('lang_business_receipt_confirmed', 'The receipt is confirmed. Recover the saved bill to finish this screen.') : PosnicPro.i18n.t('lang_business_receipt_sync_pending', 'The sale is saved on this till. Cloud confirmation is still pending. Do not charge the customer again.');
            } else if (record.state === 'approved' && (!checkout || checkout.state !== 'reconciling')) {
                title = PosnicPro.i18n.t('lang_business_approved_ready', 'Approved, ready to save');
                message = PosnicPro.i18n.t('lang_business_approved_not_saved', 'Approval is confirmed. The sale has not been saved yet. Review the amount, then save this bill.');
            } else if (record.state === 'applying' || record.state === 'applied' || (checkout && checkout.state === 'reconciling')) {
                title = PosnicPro.i18n.t('lang_business_checking_receipt', 'Checking the sale receipt');
                message = PosnicPro.i18n.t('lang_business_receipt_unknown', 'The save attempt is being checked. Do not charge again or create another sale. Check saved sales or ask the owner for help if this does not resolve.');
            } else if (['declined', 'cancelled', 'expired'].indexOf(record.state) !== -1) {
                title = record.state === 'declined' ? PosnicPro.i18n.t('lang_business_request_declined', 'Request declined') : record.state === 'cancelled' ? PosnicPro.i18n.t('lang_business_request_cancelled', 'Request cancelled') : PosnicPro.i18n.t('lang_business_request_expired', 'Request expired');
                message = PosnicPro.i18n.t('lang_business_review_bill_again', 'This request cannot be used. Return to the bill and review the discount before asking again.');
            }
        }
        if (flow.saving) { title = PosnicPro.i18n.t('lang_business_saving_bill', 'Saving the approved bill'); message = PosnicPro.i18n.t('lang_business_saving_once', 'Please wait while this till saves the bill and records its approval.'); }
        if (flow.recoveryOnly) message = recoveryHelp();
        flow.title.textContent = title; flow.message.textContent = message;
        if (record) {
            [[PosnicPro.i18n.t('lang_business_before_discount', 'Before discount'), 'beforeDiscountMinor'], [PosnicPro.i18n.t('lang_business_discount', 'Discount'), 'discountMinor'], [PosnicPro.i18n.t('lang_business_customer_pays', 'Customer pays'), 'payableMinor']].forEach(function (entry) {
                var row = element('div', '', 'business-approval-amount');
                row.append(element('span', entry[0]), element('strong', money(record, entry[1]))); flow.details.appendChild(row);
            });
            flow.details.appendChild(element('p', record.summary.reason, 'business-approval-reason'));
            if (flow.recoveryOnly) {
                flow.details.appendChild(element('p', PosnicPro.i18n.t('lang_reference_title', 'Reference') + ': ' + record.id, 'business-approval-reason'));
                if (saved) flow.details.appendChild(element('p', PosnicPro.i18n.t('lang_sale_id', 'Sale Id') + ': ' + checkout.saleId, 'business-approval-reason'));
            }
            var expiry = new Date(record.expiresAt);
            if (['pending', 'approved'].indexOf(record.state) !== -1) flow.details.appendChild(element('p', PosnicPro.i18n.t('lang_business_valid_until', 'Valid until') + ' ' + expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'business-approval-meta'));
        }
        if (!flow.reference) {
            if (flow.scope.recoveryVersion === 1) button(flow, recoveryTitle(), function () { loadRecoveries(flow); });
            var send = button(flow, PosnicPro.i18n.t('lang_business_send_request', 'Send request'), function () { sendRequest(flow); }, true);
            send.disabled = flow.busy || !flow.reason.value.trim();
            button(flow, PosnicPro.i18n.t('lang_business_use_manager_pin', 'Use manager PIN'), function () { close(flow); flow.local(); });
        } else {
            if (!flow.recoveryOnly && (saved || (record && record.state === 'approved' && (!checkout || checkout.state !== 'reconciling')))) button(flow, saved ? PosnicPro.i18n.t('lang_business_recover_bill', 'Recover saved bill') : PosnicPro.i18n.t('lang_business_save_approved_bill', 'Save approved bill'), function () { save(flow); }, true);
            button(flow, PosnicPro.i18n.t('lang_business_check_status', 'Check status'), function () { refresh(flow); });
            if (!flow.recoveryOnly && record && (!checkout || checkout.state === 'not_started') && ['pending', 'approved'].indexOf(record.state) !== -1) button(flow, PosnicPro.i18n.t('lang_business_cancel_request', 'Cancel request'), function () { cancel(flow); });
            if (flow.recoveryOnly) button(flow, recoveryTitle(), function () { loadRecoveries(flow); });
            if (!flow.recoveryOnly && record && ['declined', 'cancelled', 'expired'].indexOf(record.state) !== -1) button(flow, PosnicPro.i18n.t('lang_business_back_to_bill', 'Back to bill'), function () { try { sessionStorage.removeItem(flow.key); } catch (_) {} close(flow); });
        }
    }
    function recoveryTitle() { return PosnicPro.i18n.t('lang_business_recovery_list', 'Earlier checkout attempts'); }
    function recoveryHelp() { return PosnicPro.i18n.t('lang_business_recovery_help', 'Review only. Check saved sales with the owner before taking any payment. These references do not authorize another sale.'); }
    function renderRecoveries(flow) {
        flow.title.textContent = recoveryTitle(); flow.message.textContent = recoveryHelp();
        var page = flow.recoveryPage;
        if (page && !page.references.length) flow.details.appendChild(element('p', PosnicPro.i18n.t('lang_business_recovery_empty', 'No unconfirmed checkout references on this page.')));
        if (page) page.references.forEach(function (row) {
            var label = new Date(row.startedAt).toLocaleString(document.documentElement.lang || 'en') + ' · ' + (row.requestId || row.operationId).slice(-8);
            var item = button(flow, label, function () { selectRecovery(flow, row); });
            item.classList.add('business-approval-recovery-row'); item.dir = 'auto';
        });
        button(flow, PosnicPro.i18n.t('lang_business_check_status', 'Check status'), function () { loadRecoveries(flow, flow.recoveryCursor); });
        if (page && page.nextCursor) button(flow, PosnicPro.i18n.t('lang_business_recovery_next', 'More references'), function () { loadRecoveries(flow, page.nextCursor); });
    }
    async function loadRecoveries(flow, cursor) {
        if (active !== flow || flow.busy || flow.scope.recoveryVersion !== 1) return;
        clearTimeout(flow.timer); flow.recoveryOnly = true; flow.recoveryMode = true; flow.recoveryPage = null;
        flow.reference = null; flow.record = null; flow.errorMessage = ''; flow.recoveryCursor = cursor;
        flow.busy = true; render(flow);
        try {
            var query = flow.scope.requestRecovery === true ? '?requests=1' : '';
            if (cursor) query += (query ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor);
            var page = await request('get', '/recoveries' + query);
            var cursorPattern = flow.scope.requestRecovery === true ? /^(?:[a-f\d]{64}|requests(?::(?:[a-f\d]{24}|[a-f\d]{64}))?)$/ : /^[a-f\d]{64}$/;
            if (!page || !Array.isArray(page.references) || page.references.length > 20 ||
                (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !cursorPattern.test(page.nextCursor) || page.nextCursor === cursor)) ||
                page.references.some(function (row) {
                    if (!row || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt))) return true;
                    var known = typeof row.requestId === 'string' && /^[a-f\d]{24}$/.test(row.requestId);
                    var operation = typeof row.operationId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(row.operationId);
                    return (!known && !(flow.scope.requestRecovery === true && row.requestId === null && operation)) ||
                        (row.operationId !== undefined && !operation);
                }) ||
                new Set(page.references.map(function (row) { return row.requestId ? 'request:' + row.requestId : 'operation:' + row.operationId; })).size !== page.references.length) throw new Error('invalid_recovery_page');
            flow.recoveryPage = page;
        } catch (error) { flow.errorMessage = errorText(error); }
        finally { flow.busy = false; render(flow); if (active === flow) flow.title.focus(); }
    }
    async function selectRecovery(flow, reference) {
        if (active !== flow || flow.busy || !flow.recoveryMode) return;
        flow.busy = true; flow.errorMessage = ''; render(flow);
        try {
            var record = await request('get', reference.requestId ? '/' + reference.requestId : '/operation/' + reference.operationId);
            if (!record && reference.requestId === null) {
                flow.reference = { requestId: null, operationId: reference.operationId };
                flow.record = null; flow.recoveryMode = false;
                flow.errorMessage = errorText(null);
                return;
            }
            if (!record || typeof record.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(record.operationId)) throw new Error('invalid_recovery_record');
            flow.reference = { requestId: reference.requestId, operationId: reference.operationId || record.operationId };
            if (!validRecord(flow, record)) throw new Error('mismatched_request');
            flow.reference.requestId = record.id;
            flow.record = record; flow.recoveryMode = false;
        } catch (error) { flow.reference = null; flow.record = null; flow.errorMessage = errorText(error); }
        finally { flow.busy = false; render(flow); if (active === flow) flow.title.focus(); schedule(flow); }
    }
    function schedule(flow) {
        clearTimeout(flow.timer);
        if (active === flow && flow.reference && !flow.busy && (!flow.record || ['pending', 'applying'].indexOf(flow.record.state) !== -1 || (flow.record.checkout && flow.record.checkout.state === 'reconciling'))) {
            flow.timer = setTimeout(function () { if (!document.hidden) refresh(flow); else schedule(flow); }, 15000);
        }
    }
    async function refresh(flow) {
        if (active !== flow || flow.busy || !flow.reference) return;
        clearTimeout(flow.timer); flow.busy = true; render(flow);
        try {
            var record = await request('get', flow.reference.requestId ? '/' + flow.reference.requestId : '/operation/' + flow.reference.operationId);
            if (active !== flow) return;
            if (record && !validRecord(flow, record)) throw new Error('mismatched_request');
            flow.record = record;
            if (record) { flow.reference.requestId = record.id; if (!flow.recoveryOnly) remember(flow); }
            flow.errorMessage = '';
        } catch (error) { flow.record = null; flow.errorMessage = errorText(error); }
        finally { flow.busy = false; render(flow); schedule(flow); }
    }
    async function sendRequest(flow) {
        if (active !== flow || flow.busy || flow.recoveryOnly || flow.reference || !flow.reason.value.trim()) return;
        flow.busy = true;
        var persisted = false;
        try {
            var operationId = window.crypto.randomUUID();
            flow.reference = { operationId: operationId, requestId: null };
            remember(flow); // Persist before the first write can leave this page.
            persisted = true;
            flow.payload.billing_transaction_id = operationId;
            render(flow);
            var record = await request('post', '', { sale: flow.payload, reason: flow.reason.value.trim() });
            if (!validRecord(flow, record)) throw new Error('mismatched_request');
            flow.record = record;
            flow.reference.requestId = flow.record.id; remember(flow);
        } catch (error) {
            if (!persisted) { flow.reference = null; flow.errorMessage = PosnicPro.i18n.t('lang_business_reference_storage_failed', 'This browser cannot keep the approval reference. Use a manager PIN or enable session storage before sending a request.'); }
            else flow.errorMessage = errorText(error);
        }
        finally { flow.busy = false; render(flow); schedule(flow); }
    }
    async function cancel(flow) {
        if (active !== flow || flow.busy || flow.recoveryOnly || !flow.record) return;
        clearTimeout(flow.timer); flow.busy = true; render(flow);
        try { var record = await request('post', '/' + flow.record.id + '/cancel', {}); if (!validRecord(flow, record)) throw new Error('mismatched_request'); flow.record = record; flow.errorMessage = ''; }
        catch (error) { flow.errorMessage = errorText(error); }
        finally { flow.busy = false; render(flow); schedule(flow); }
    }
    function save(flow) {
        if (active !== flow || flow.busy || flow.recoveryOnly || !flow.record) return;
        if (flow.record.checkout && flow.record.checkout.state === 'reconciling') return;
        if (flow.record.state !== 'approved' && (!flow.record.checkout || ['saved', 'applied'].indexOf(flow.record.checkout.state) === -1)) return;
        clearTimeout(flow.timer); flow.busy = true; flow.saving = true; flow.errorMessage = '';
        flow.payload.billing_transaction_id = flow.reference.operationId;
        flow.payload.business_decision_id = flow.record.id;
        flow.params.data = JSON.stringify(flow.payload);
        flow.params.timeout = 20000;
        render(flow); flow.proceed();
    }
    function open(capabilities, params, data, proceed, local) {
        if (active) { release(); active.dialog.focus(); return; }
        var dialog = element('dialog', '', 'business-approval-dialog');
        dialog.setAttribute('aria-labelledby', 'business-approval-title');
        dialog.setAttribute('aria-describedby', 'business-approval-message');
        var title = element('h2'); title.id = 'business-approval-title'; title.tabIndex = -1;
        var message = element('p', '', 'business-approval-message'); message.id = 'business-approval-message';
        message.setAttribute('aria-live', 'polite');
        var closeButton = element('button', '×', 'business-approval-close'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', PosnicPro.i18n.t('lang_close', 'Close'));
        var reasonLabel = element('label', PosnicPro.i18n.t('lang_business_reason_label', 'Why is this discount needed?')); reasonLabel.htmlFor = 'business-approval-reason';
        var reason = element('textarea'); reason.id = 'business-approval-reason'; reason.maxLength = 500; reason.rows = 3; reason.value = String(data.discount_description || '').slice(0, 500);
        var details = element('div', '', 'business-approval-details'), error = element('p', '', 'business-approval-error'); error.setAttribute('role', 'alert');
        var actions = element('div', '', 'business-approval-actions');
        dialog.append(closeButton, element('p', 'POSNIC BUSINESS', 'business-approval-eyebrow'), title, message, details, reasonLabel, reason, error, actions);
        var key = storageKey(capabilities);
        var flow = active = { dialog: dialog, title: title, message: message, closeButton: closeButton, reason: reason, reasonLabel: reasonLabel, details: details, error: error, actions: actions,
            key: key, scope: capabilities, reference: stored(key), payload: data, params: params, proceed: proceed, local: local, busy: false, focus: document.activeElement };
        closeButton.addEventListener('click', function () { close(flow); });
        dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(flow); });
        reason.addEventListener('input', function () { render(flow); });
        document.body.appendChild(dialog); render(flow); dialog.showModal();
        if (flow.reference) refresh(flow); else reason.focus();
    }
    api.hasPending = function () {
        try { for (var n = 0; n < sessionStorage.length; n++) if (sessionStorage.key(n).indexOf('posnic_business_approval:' + API_URL + ':') === 0) return true; } catch (_) {}
        return false;
    };
    api.offer = async function (params, proceed, local, onlyExisting) {
        var data; try { data = JSON.parse(params.data); } catch (_) { local(); return; }
        try {
            var capabilities = await request('get', '/capabilities');
            var existing = capabilities && stored(storageKey(capabilities));
            if (onlyExisting && !existing) { local(); return; }
            if (!existing && (!capabilities || !capabilities.enabled || capabilities.currencyDigits !== 2 || !eligible(data))) { local(); return; }
            open(capabilities, params, data, proceed, local);
        } catch (error) { release(); PosnicPro.alert('error', errorText(error)); }
    };
    api.editOrLocal = async function (openEditor, local) {
        if (PosnicPro.sales.SaleAction !== 'add' || PosnicPro.sales.saleProcess === 'KOT') { local(); return; }
        try {
            var capabilities = await request('get', '/capabilities');
            if (capabilities && capabilities.enabled && capabilities.currencyDigits === 2) { openEditor(); return; }
        } catch (_) {}
        local();
    };
    api.saved = function () {
        if (!active || !active.saving) return;
        try { sessionStorage.removeItem(active.key); } catch (_) {}
        active.busy = false; active.saving = false; close(active);
    };
    api.failed = function (xhr) {
        if (!active || !active.saving) return false;
        var flow = active; flow.saving = false; flow.busy = false; flow.record = null; flow.errorMessage = errorText(xhr);
        release(); render(flow); schedule(flow); return true;
    };
    api.eligible = eligible;
}());
