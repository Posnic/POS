/* Review uncertain submissions using the original payload and request ID. */
(function () {
    'use strict';
    var busy = new Set(), dialog;
    function t(key, fallback) { return String(PosnicPro.i18n ? PosnicPro.i18n.t(key, fallback) : fallback).replace(/&nbsp;/g, ' '); }
    function node(tag, text, className) {
        var el = document.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (className) el.className = className;
        if (/^h[1-6]$/.test(tag)) el.style.color = 'inherit';
        if (tag === 'button') el.style.minHeight = '44px';
        if (tag === 'li') el.dir = 'auto';
        return el;
    }
    function entries() { return PosnicPro.sales.submissionJournal().pending(); }
    function identity(entry) { return entry.owner + ':' + entry.id; }
    function current(entry) {
        return entries().some(function (saved) { return saved.id === entry.id && saved.owner === entry.owner; });
    }
    function refresh() {
        var button = document.getElementById('desktop-pending-orders');
        if (!button) return;
        try {
            var count = entries().length;
            button.hidden = !count;
            button.textContent = t('lang_pending_submissions', 'Pending submissions') + ' (' + count + ')';
        } catch (error) {
            button.hidden = false;
            button.textContent = t('lang_pending_submissions', 'Pending submissions');
        }
    }
    function retry(entry) {
        var key = identity(entry);
        if (busy.has(key) || PosnicPro.sales.submissionInProgress) return;
        try {
            if (!current(entry)) throw new Error(t('lang_submission_original_account','Sign in to the original account and branch to retry this order.'));
            var params = {url:'sales', data:JSON.stringify(entry.payload)};
            PosnicPro.sales.guardDiscountApproval(params, function () {
                try {
                    // The account may have changed while approval was open.
                    if (!current(entry) || busy.has(key)) return;
                    PosnicPro.sales.submissionJournal().save(JSON.parse(params.data));
                    busy.add(key); render();
                    PosnicPro.post(params, function (response) {
                        try {
                            if (response.type !== 'success') throw new Error(response.message || t('lang_submission_save_failed','Could not save the order.'));
                            PosnicPro.sales.submissionJournal().confirm(entry, response);
                            PosnicPro.alert('success', response.message || t('lang_submission_saved','Order saved'));
                        } catch (error) { PosnicPro.alert('error', error.message); }
                        finally { busy.delete(key); render(); refresh(); }
                    }, function (xhr) {
                        try {
                            var response = xhr && xhr.responseJSON;
                            if (!response && xhr && xhr.responseText) response = JSON.parse(xhr.responseText);
                            if (PosnicPro.sales.submissionJournal().reject(entry, response)) PosnicPro.sales.resetOrderRequest();
                        } catch (error) { PosnicPro.alert('error', error.message); }
                        busy.delete(key); render(); refresh();
                    });
                } catch (error) { busy.delete(key); render(); PosnicPro.alert('error', error.message); }
            });
        } catch (error) { PosnicPro.alert('error', error.message); }
    }
    function render() {
        if (!dialog) return;
        dialog.replaceChildren();
        var heading=node('h4',t('lang_pending_submissions','Pending submissions'));
        heading.id='desktop-recovery-title';dialog.appendChild(heading);
        dialog.dir=document.documentElement.dir || 'ltr';
        dialog.appendChild(node('p',t('lang_review_pending_submissions','These orders may already be saved. Retry checks the original request without creating another order.'),'text-muted'));
        try {
            var saved=entries();
            if (!saved.length) dialog.appendChild(node('p',t('lang_no_pending_submissions','No pending submissions.')));
            saved.forEach(function(entry){
                var section=node('section',undefined,'border rounded p-3 mb-3');
                section.appendChild(node('h5',entry.payload.table_number ? t('lang_table','Table')+' '+entry.payload.table_number : t('lang_printsale','Sale')));
                section.appendChild(node('p',new Date(entry.createdAt).toLocaleString()));
                var list=node('ul');
                (entry.payload.items||[]).forEach(function(item){
                    list.appendChild(node('li',String(item.item_quantity||item.quantity||1)+' × '+String(item.item_name||item.name||item.item_id||'')+(item.item_description||item.item_note ? ' · '+String(item.item_description||item.item_note) : '')));
                });section.appendChild(list);
                section.appendChild(node('p',t('lang_total','Total')+': '+String(entry.payload.sales_total)));
                var send=node('button',t('lang_retry','Retry'),'btn btn-primary');send.type='button';send.disabled=busy.has(identity(entry));
                send.addEventListener('click',function(){retry(entry);});section.appendChild(send);dialog.appendChild(section);
            });
        } catch(error) { dialog.appendChild(node('p',error.message,'text-danger')); }
        var close=node('button',t('lang_close','Close'),'btn btn-secondary');close.type='button';close.addEventListener('click',function(){dialog.close();});dialog.appendChild(close);
    }
    function show() {
        if(!dialog){
            dialog=node('dialog');dialog.id='desktop-order-recovery';dialog.setAttribute('aria-labelledby','desktop-recovery-title');
            dialog.style.cssText='width: min(600px, calc(100% - 32px));max-height:85vh;overflow:auto;border:1px solid var(--theme-border-color,#adb5bd);color:var(--theme-text-primary,#222);background:var(--theme-card-bg,#fff);border-radius:12px;padding:24px;';
            document.body.appendChild(dialog);
        }
        render();if(!dialog.open)dialog.showModal();
    }
    PosnicPro.orderRecovery={refresh:refresh,show:show,retry:retry};
    $(function(){
        var title=document.querySelector('#sales_new .page-title');
        if(!title)return;
        var button=node('button','','btn btn-outline-secondary btn-sm');button.type='button';button.id='desktop-pending-orders';button.hidden=true;
        button.addEventListener('click',show);
        var actions=document.getElementById('sale-header-actions');
        if(actions)actions.insertBefore(button,actions.firstChild);else title.appendChild(button);
        refresh();
    });
    window.addEventListener('storage',function(){refresh();if(dialog && dialog.open)render();});
    window.addEventListener('hashchange',function(){if(dialog && dialog.open)dialog.close();refresh();});
})();
