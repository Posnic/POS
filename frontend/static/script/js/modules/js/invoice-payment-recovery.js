"use strict";
(function () {
    const P = PosnicPro, invoices = P.invoices;
    const originalOpen = invoices.payOpen;
    let store, view = null, sequence = 0;
    const t = (key, fallback) => P.i18n.t(key, fallback);
    function requests() {
        if (!store) store = createInvoicePaymentRequests({storage:localStorage, locks:navigator.locks, randomUUID:()=>crypto.randomUUID()});
        return store;
    }
    function scope(inv) {
        return {licenseId:String(inv.license || ''), branchId:String(inv.branch_id || ''), userId:String(P.local.get('userid') || ''), invoiceId:String(inv._id || '')};
    }
    function current(candidate) {
        return view === candidate && invoices._current && JSON.stringify(scope(invoices._current)) === JSON.stringify(candidate.scope);
    }
    function inputs(disabled) { $('#ie_pay_amount,#ie_pay_method,#ie_pay_reference,#ie_pay_confirm').prop('disabled',disabled); }
    function failure() {
        inputs(true);
        P.alert('error',t('lang_payment_storage_review','The saved payment request needs review. No new payment was sent.'));
    }
    function render(candidate, message, action) {
        if (!current(candidate)) return;
        inputs(true); $('#invoices_pay_strip').show(); $('#ie_payment_recovery').remove();
        const panel=$('<div>').attr('id','ie_payment_recovery').addClass('border rounded p-3 mt-2');
        panel.append($('<strong>').text(t('lang_check_this_payment','Check this payment')),
            $('<p>').addClass('mt-2').text(candidate.record.request.amount+' · '+candidate.record.request.method),
            $('<p>').text(candidate.record.request.reference),
            $('<p>').attr('role','status').text(message));
        const checkButton=$('<button>').attr('type','button').addClass('btn btn-sm btn-light border mr-2')
            .text(t('lang_check_saved_payment','Check saved result')).prop('disabled',candidate.busy).on('click',()=>check(candidate));
        panel.append(checkButton);
        if (action) panel.append($('<button>').attr({type:'button','data-module':'sales','data-access':'write'})
            .addClass('btn btn-sm btn-success').text(action==='retry'?t('lang_retry_original_payment','Retry original request'):t('lang_finish_original_payment','Finish original payment'))
            .prop('disabled',candidate.busy).on('click',()=>send(candidate,action)));
        $('#invoices_pay_strip').append(panel); P.ACLForModule('sales');
    }
    const uncertain=()=>t('lang_payment_result_unknown','No confirmed result yet. Check before trying again.');
    function held(candidate) {
        const record=requests().load(candidate.scope);
        if (!record || record.request.commandId !== candidate.record.request.commandId) throw new Error('Request changed');
        return record;
    }
    function check(candidate) {
        if (!current(candidate) || candidate.busy) return;
        try { held(candidate); } catch { failure(); return; }
        candidate.busy=true; const ticket=++sequence;
        render(candidate,t('lang_checking_payment','Checking saved payment…'));
        P.get({url:'invoices/'+encodeURIComponent(candidate.scope.invoiceId)+'/payment-requests/'+candidate.record.request.commandId,data:{}},async function(response){
            if (!current(candidate)||ticket!==sequence) return;
            candidate.busy=false;
            const status=response && response.type==='success' && response.data;
            if (!status || status.commandId!==candidate.record.request.commandId) { render(candidate,uncertain()); return; }
            if (status.state==='saved' && status.releasePending===false) {
                try {
                    await requests().complete(candidate.scope,candidate.record.request.commandId,status);
                    if (!current(candidate)) return;
                    view=null; $('#ie_payment_recovery').remove(); inputs(false); $('#invoices_pay_strip').hide();
                    P.alert('success',t('lang_payment_saved_confirmed','Payment recorded. No further payment is needed.'));
                    invoices.showDetails(candidate.scope.invoiceId); invoices.load(true); invoices.loadSummary();
                } catch { if(current(candidate)) failure(); }
                return;
            }
            if ((status.state==='pending'||status.state==='saved') && status.canRecover===true) {
                render(candidate,t('lang_payment_original_unfinished','The original payment is unfinished. Continue with the same amount and method.'),'recover');
            } else if (status.state==='absent') {
                render(candidate,t('lang_payment_original_absent','This server has not recorded the request. Retry only the unchanged original.'),'retry');
            } else render(candidate,t('lang_payment_original_review','This payment needs review. Keep the saved request and check again.'));
        },function(){if(current(candidate)&&ticket===sequence){candidate.busy=false;render(candidate,uncertain());}});
    }
    function send(candidate,action) {
        if (!current(candidate)||candidate.busy) return;
        let record;try{record=held(candidate);}catch{failure();return;}
        candidate.busy=true; ++sequence; render(candidate,t('lang_payment_working','Saving the original payment…'));
        const base='invoices/'+encodeURIComponent(candidate.scope.invoiceId);
        P.post({url:action==='recover'?base+'/payment-requests/'+record.request.commandId+'/recover':base+'/payment',
            data:JSON.stringify(action==='recover'?{confirmed:true}:record.request)},function(response){
            if(!current(candidate))return; candidate.busy=false;
            if(response && response.type==='success')check(candidate);else render(candidate,uncertain());
        },function(){if(current(candidate)){candidate.busy=false;render(candidate,uncertain());}});
    }
    function reopen(inv) {
        ++sequence; view=null; $('#ie_payment_recovery').remove(); inputs(false);
        try {
            const record=requests().load(scope(inv));if(!record)return false;
            view={scope:scope(inv),record,busy:false};
            $('#ie_pay_amount').val(record.request.amount);$('#ie_pay_method').val(record.request.method);$('#ie_pay_reference').val(record.request.reference);
            render(view,uncertain()); return true;
        }catch{failure();return true;}
    }
    invoices.paymentRecovery={reopen};
    invoices.payOpen=function(){const inv=invoices._current;if(!inv)return;if(!reopen(inv))originalOpen.call(invoices);};
    invoices.payConfirm=async function(){
        const inv=invoices._current;if(!inv)return;
        if(view){render(view,uncertain());return;}
        const amount=String($('#ie_pay_amount').val());
        const due=Number(inv.sale_id?inv.balance:inv.total);
        if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(amount)||!(Number(amount)>0)||
           (Number.isFinite(due)&&Number(amount)>due)) {
            P.alert('warning',t('lang_payment_amount_due','Enter an amount greater than zero and no more than the invoice balance.'));return;
        }
        const capturedScope=scope(inv);inputs(true);
        try {
            const result=await requests().prepare(capturedScope,{amount:String($('#ie_pay_amount').val()),method:$('#ie_pay_method').val(),reference:$('#ie_pay_reference').val()});
            if(!invoices._current||JSON.stringify(scope(invoices._current))!==JSON.stringify(capturedScope))return;
            view={scope:capturedScope,record:result.record,busy:false};
            if(result.created)send(view,'retry');else render(view,uncertain());
        }catch{failure();}
    };
    addEventListener('storage',function(event){
        if(event.key && event.key.startsWith('posnic:invoice-payment:v1:') && invoices._current)reopen(invoices._current);
    });
})();
