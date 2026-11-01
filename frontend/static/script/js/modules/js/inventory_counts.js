PosnicPro.inventorycounts = {
    esc: function (value) { return $('<span>').text(value == null ? '' : value).html(); },
    showDataTablePage: function () {
        this.leaveSection();
        $('#inventorycounts').removeClass('count-editing count-reviewing');
        this.detailRequest = (this.detailRequest || 0) + 1;
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_inventorycounts_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#inventorycounts').show();
        PosnicPro.ACLForModule('item');
        this.load();
    },
    load: function () {
        var self = this;
        PosnicPro.get('inventory-counts', function (response) {
            var rows = response && response.data || [];
            if (!rows.length) return $('#inventory_counts_list').html('<div class="text-center p-4"><lang class="lang_no_stock_count_drafts_yet">No stock-count drafts yet.</lang><p class="mt-3 mb-0">Saved count drafts appear here. Starting an audit or saving spoilage does not create a worksheet.</p></div>');
            $('#inventory_counts_list').html('<div class="table-responsive"><table class="table"><thead><tr><th><lang class="lang_created">Created</lang></th><th><lang class="lang_scope">Scope</lang></th><th><lang class="lang_userstatus">Status</lang></th><th></th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><td>' + self.esc(moment(row.created_at).format('LLL')) + '</td><td>' + self.esc(row.scope || 'all') + '</td><td><span class="badge badge-primary-inverse">' + self.esc(row.status) + '</span></td><td class="text-right"><button class="btn btn-sm btn-primary-rgba inventory-count-open" data-id="' + self.esc(row._id) + '">Review</button></td></tr>'; }).join('') + '</tbody></table></div>');
        });
    },
    open: function (id) {
        var self = this;
        PosnicPro.get('inventory-counts/' + encodeURIComponent(id), function (response) {
            var row = response && response.data;
            if (!row) return;
            $('#inventory_count_detail').show().html('<h5><lang class="lang_count_worksheet">Count worksheet</lang></h5><p class="text-muted">Expected quantities are a snapshot. Entering and applying counted quantities will remain a separate reviewed inventory operation.</p><div class="table-responsive"><table class="table table-sm"><thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th><lang class="lang_sku_title">SKU</lang></th><th class="text-right"><lang class="lang_expected">Expected</lang></th><th class="text-right"><lang class="lang_counted">Counted</lang></th></tr></thead><tbody>' + (row.items || []).map(function (item) { return '<tr><td>' + self.esc(item.item_name) + '</td><td>' + self.esc(item.barcode_id || '—') + '</td><td class="text-right">' + self.esc(item.expected_quantity) + ' ' + self.esc(item.unit) + '</td><td class="text-right">—</td></tr>'; }).join('') + '</tbody></table></div>');
            self.popup('inventory_count_detail','Count worksheet');
        });
    }
};
PosnicPro.inventorycounts.leaveSection = function () {
    $('#inventorycounts').removeClass('count-section').removeAttr('data-section');
    $('#inventory_section_host').hide();
    $('#inventorycounts .count-workspace').show();
};
PosnicPro.inventorycounts.mountSection = function (name) {
    var id=name==='logs'?'stocklogs':'lowstockitems';
    if(!$('#inventory_section_host').length) $('#inventorycounts > .contentbar').append('<div id="inventory_section_host"></div>');
    $('#'+id).appendTo('#inventory_section_host').show();
    $('#inventory_section_host').show();
    $('#inventorycounts').removeClass('count-editing count-reviewing').addClass('count-section').attr('data-section',name).show();
    $('#inventorycounts .count-workspace').hide();
    $('#v-pills-inventory-tab,#view_inventorycounts_page').addClass('active');
};
// Bootstrap's focus trap must yield while a child SweetAlert dialog owns focus.
PosnicPro.inventorycounts.dialog = async function(options) {
    var popup=$('#inventory_popup'), modal=popup.data('bs.modal'), trigger=document.activeElement;
    var nested=popup.hasClass('show') && modal;
    if(nested)$(document).off('focusin.bs.modal');
    try { return await swal(options); }
    finally {
        if(nested && popup.hasClass('show')) {
            if(typeof modal._enforceFocus==='function')modal._enforceFocus();
            if(trigger && trigger.isConnected)trigger.focus();
        }
    }
};
PosnicPro.inventorycounts.confirmLeave = async function(text) {
    var answer=await PosnicPro.inventorycounts.dialog({title:PosnicPro.i18n.t('lang_discard_unsaved_changes', 'Discard unsaved changes?'),text:text,type:'warning',showCancelButton:true,confirmButtonText:'Discard changes',cancelButtonText:'Keep editing',confirmButtonColor:'#c93d4b',cancelButtonColor:'#0968cb'});
    return !!answer && !answer.dismiss && answer.value!==false;
};
PosnicPro.inventorycounts.restorePopup = function() {
    var content=$('#inventory_popup .modal-body').children(), anchor=$('#inventory_popup_anchor');
    if(anchor.length){content.insertBefore(anchor).hide();anchor.remove();}
    if(content.attr('id')==='sp_detail')content.empty();
    $('#inventory_popup .modal-footer').empty();
};
PosnicPro.inventorycounts.closePopup = function() {
    this.restorePopup();
    if($.fn.modal)$('#inventory_popup').modal('hide');
};
PosnicPro.inventorycounts.popup = function(id,title) {
    var p=this, content=$('#'+id);
    if(!content.length)return;
    if(!$('#inventory_popup').length)$('body').append('<div id="inventory_popup" class="modal" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="inventory_popup_title"><div class="modal-dialog modal-xl" role="document"><div class="modal-content"><div class="modal-header"><h5 id="inventory_popup_title" class="modal-title"></h5><button type="button" class="close" data-dismiss="modal" aria-label="Close" data-t-aria-label="lang_close_title">&times;</button></div><div class="modal-body"></div><div class="modal-footer"><button class="btn btn-outline-secondary" data-dismiss="modal"><lang class="lang_close_title">Close</lang></button></div></div></div></div>');
    if(!content.closest('#inventory_popup').length){p.restorePopup();content.before('<span id="inventory_popup_anchor" hidden></span>');content.appendTo('#inventory_popup .modal-body').show();}
    $('#inventory_popup .modal-footer').html('<button class="btn btn-outline-secondary" data-dismiss="modal"><lang class="lang_close_title">Close</lang></button>');
    $('#inventory_popup_title').text(title);
    $('#inventory_popup').off('hide.bs.modal.inventory').on('hide.bs.modal.inventory',function(){p.restorePopup();});
    if($.fn.modal)$('#inventory_popup').modal('show');
};
PosnicPro.inventorycounts.navigate = async function(view) {
    var dirty=$('#sp_entry_rows tr').length || $('#audit_rows input').filter(function(){return this.value!=='';}).length;
    if(dirty && !await this.confirmLeave('Leave this entry? Unsaved quantities and reasons will be discarded.'))return;
    this.closePopup();$('#inventory_count_detail').empty();
    if(view==='overview')this.showDataTablePage();
    else if(view==='audit')this.startAudit();
    else if(view==='damage')this.openSpoilage();
    else if(view==='logs')PosnicPro.stocklogs.showDataTablePage();
    else if(view==='lowstock')PosnicPro.lowstockitems.showDataTablePage();
};
$(document).on('click', '.inventory-count-open', function () { PosnicPro.inventorycounts.open($(this).data('id')); });
// Mobile inventory shares the item ledger; reviewed operations are visible here.
PosnicPro.inventorycounts.operationLabel = function (mode) {
    var labels = {count:['lang_stock_counts','Stock Counts'],receive:['lang_receive','Receive'],damage:['lang_damage','Damage'],loss:['lang_loss','Loss']};
    var value = labels[mode]; return value ? PosnicPro.i18n.t(value[0],value[1]) : mode;
};
PosnicPro.inventorycounts.statusBadge = function (state) {
    var labels = {complete:['lang_completed','Completed'],cancelled:['lang_cancelled','Cancelled'],prepared:['lang_review_title','Review'],applying:['lang_processing_and_review','Processing and review'],conflict:['lang_review_changes','Review changes']};
    var value = labels[state], known = Object.prototype.hasOwnProperty.call(labels,state);
    return $('<span class="inventory-status">').addClass(known ? state : '').append($('<i aria-hidden="true" class="feather">').addClass(state === 'complete' ? 'icon-check-circle' : state === 'conflict' ? 'icon-alert-circle' : 'icon-clock')).append(document.createTextNode(value ? PosnicPro.i18n.t(value[0],value[1]) : state));
};
PosnicPro.inventorycounts.overviewTab = 'all';
PosnicPro.inventorycounts.selectOverviewTab = function (tab) {
    if(!['all','attention','complete','cancelled','worksheets'].includes(tab))return;
    this.overviewTab=tab;
    $('#count_overview_tabs button').each(function(){var active=$(this).attr('data-view')===tab;$(this).toggleClass('active',active).attr('aria-selected',String(active));});
    $('#inventory_counts_list,#count_worksheet_intro').toggle(tab==='worksheets');
    $('#mobile_inventory_operations').toggle(tab!=='worksheets');
    if(tab==='worksheets'){this.mobileRequest=(this.mobileRequest||0)+1;originalInventoryLoad.call(this);}
    else this.loadMobile();
};
PosnicPro.inventorycounts.setupOverviewTabs = function () {
    if($('#count_overview_tabs').length)return;
    var list=$('#inventory_counts_list');
    $(list.prevAll('h5,p').get().reverse()).wrapAll('<div id="count_worksheet_intro"></div>');
    $('#count_worksheet_intro p').text('Saved count drafts are worksheets for reference. Completed stock updates are shown in the Completed tab.');
    var tabs=$('<div id="count_overview_tabs" class="nav nav-tabs mb-3" role="tablist" aria-label="Inventory activity">');
    [['all','All activity'],['attention','Needs attention'],['complete','Completed'],['cancelled','Cancelled'],['worksheets','Saved worksheets']].forEach(function(t){$('<button type="button" class="nav-link" role="tab">').attr('data-view',t[0]).text(t[1]).appendTo(tabs);});
    var intro=$('#count_worksheet_intro');tabs.insertBefore(intro.length?intro:list);
};
$(document).on('click','#count_overview_tabs button',function(){PosnicPro.inventorycounts.selectOverviewTab($(this).attr('data-view'));});
PosnicPro.inventorycounts.loadMobile = function (after) {
    if(this.overviewTab==='worksheets')return;
    var self = this, branch = PosnicPro.local.get('branch_id_set'), ticket = self.mobileRequest = (self.mobileRequest || 0) + 1;
    if (!$('#mobile_inventory_operations').length) $('#inventory_counts_list').after('<section id="mobile_inventory_operations" class="inventory-panel"><div class="inventory-panel-header"><h5><i class="feather icon-smartphone" aria-hidden="true"></i><span>Inventory activity</span></h5><button class="btn btn-sm btn-outline-primary mobile-inventory-refresh"><i class="feather icon-refresh-cw" aria-hidden="true"></i><lang class="lang_wf_refresh">Refresh</lang></button></div><div id="mobile_inventory_rows" aria-live="polite"></div></section><div id="mobile_inventory_detail" tabindex="-1"></div>');
    $('#mobile_inventory_operations').show().attr('aria-busy','true');
    PosnicPro.get('mobile/v1/inventory/operations?' + (self.overviewTab && self.overviewTab!=='all'?'status='+encodeURIComponent(self.overviewTab)+'&':'') + (after ? 'after=' + encodeURIComponent(after) : ''), function (r) {
        if (ticket !== self.mobileRequest || branch !== PosnicPro.local.get('branch_id_set')) return;
        $('#mobile_inventory_operations').attr('aria-busy','false');
        var root = $('#mobile_inventory_rows');
        if (!Array.isArray(r.rows)) { if (!after) root.empty(); return $('<p class="inventory-empty" role="alert">').text(PosnicPro.i18n.t('lang_could_not_load_inventory_operations', 'Could not load inventory operations.')).appendTo(root); }
        if (!after) root.empty();
        root.find('.mobile-inventory-more').remove();
        if (!r.rows.length && !root.find('tbody tr').length) return root.html('<div class="inventory-empty">' + self.esc(self.overviewTab==='all'?'No inventory activity yet.':self.overviewTab==='complete'?'No completed entries yet.':self.overviewTab==='cancelled'?'No cancelled entries.':'Nothing needs attention. Completed entries are in the Completed tab.') + '</div>');
        if (!root.find('table').length) root.append('<div class="table-responsive"><table class="table inventory-table"><thead><tr><th><lang class="lang_activity_2">Activity</lang></th><th><lang class="lang_created">Created</lang></th><th class="text-right"><lang class="lang_items">Items</lang></th><th><lang class="lang_userstatus">Status</lang></th><th><span class="sr-only"><lang class="lang_review_title">Review</lang></span></th></tr></thead><tbody></tbody></table></div>');
        r.rows.forEach(function (row) {
            var tr = $('<tr>').appendTo(root.find('tbody')), icon = {count:'clipboard',receive:'truck',damage:'alert-triangle',loss:'minus-circle'}[row.mode] || 'package';
            var cell = $('<td>').appendTo(tr), operation = $('<div class="inventory-operation">').appendTo(cell);
            $('<span class="inventory-operation-icon" aria-hidden="true">').append($('<i class="feather">').addClass('icon-' + icon)).appendTo(operation);
            var description = $('<div>').appendTo(operation);
            $('<strong>').text(/^RV-SP-/.test(row.reason||'')?'Stock restored':/^SP-/.test(row.reason||'')?'Spoilage / damage':self.operationLabel(row.mode)).appendTo(description);
            if (row.reason) $('<small>').text(row.reason).appendTo(description);
            $('<td class="inventory-date">').text(row.createdAt && moment(row.createdAt).isValid() ? moment(row.createdAt).format('lll') : '—').appendTo(tr);
            $('<td class="text-right">').text((row.lines || []).length).appendTo(tr);
            $('<td>').append(self.statusBadge(row.state)).appendTo(tr);
            $('<td class="text-right">').append($('<button class="btn btn-sm btn-outline-primary mobile-inventory-open">').text(['complete','cancelled'].includes(row.state)?'View':'Review').append(' ').append($('<i class="feather icon-arrow-right" aria-hidden="true">')).attr('data-id', row.operationId)).appendTo(tr);
        });
        if (r.next) $('<button class="btn btn-sm btn-outline-primary mobile-inventory-more">').text(PosnicPro.i18n.t('lang_load_more', 'Load more')).attr('data-after', r.next).appendTo(root);
    });
};
PosnicPro.inventorycounts.openMobile = function (id) {
    var self = this, branch = PosnicPro.local.get('branch_id_set'), ticket = self.detailRequest = (self.detailRequest || 0) + 1;
    if (!$('#inventorycounts').hasClass('count-reviewing')) {
        self.reviewScroll = window.scrollY;
        self.reviewTrigger = $('.mobile-inventory-open').filter(function () { return $(this).attr('data-id') === id; })[0];
    }
    PosnicPro.get('mobile/v1/inventory/operations/' + encodeURIComponent(id), function (r) {
        if (ticket !== self.detailRequest || branch !== PosnicPro.local.get('branch_id_set')) return;
        var root = $('#mobile_inventory_detail').empty();
        self.popup('mobile_inventory_detail','Inventory operation');
        var header = $('<div class="inventory-panel-header">').appendTo(root);
        $('<button class="btn btn-sm btn-outline-secondary mobile-inventory-close">').append('<i class="feather icon-arrow-left" aria-hidden="true"></i>').append(document.createTextNode('Close')).appendTo(header);
        if (!r.operationId) { root.append($('<p role="alert">').text(PosnicPro.i18n.t('lang_could_not_load_operation', 'Could not load operation.'))); root[0].scrollIntoView({block:'start'}); root.trigger('focus'); return; }
        $('<h5>').text(self.operationLabel(r.mode)).append(self.statusBadge(r.state)).appendTo(header);
        $('<p>').text(r.reason).appendTo(root);
        var table = $('<table class="table inventory-table"><thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th><lang class="lang_expected">Expected</lang></th><th><lang class="lang_quantity">Quantity</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr></thead><tbody></tbody></table>').appendTo($('<div class="table-responsive">').appendTo(root));
        (r.lines || []).forEach(function (line) {
            var tr = $('<tr>').appendTo(table.find('tbody'));
            [line.name, line.expected / 1000, line.quantity / 1000, (r.applied || []).indexOf(line.itemId) >= 0 ? PosnicPro.i18n.t('lang_applied', 'Applied') : PosnicPro.i18n.t('lang_not_applied', 'Not applied')].forEach(function (value) { $('<td>').text(value).appendTo(tr); });
        });
        if (r.state === 'prepared' || r.state === 'applying') $('<button class="btn btn-primary mobile-inventory-confirm">').text(r.approvalRequired ? PosnicPro.i18n.t('lang_approve_stock_changes', 'Approve stock changes') : PosnicPro.i18n.t('lang_confirm_stock_changes', 'Confirm stock changes')).attr('data-id', id).appendTo(root);
        root.trigger('focus');
        if (r.state === 'conflict') {
            $('<p role="status">').text('Stock changed after this count was prepared. Recount the unresolved items using current stock, or cancel the remaining changes. Already applied rows will not be reversed.').appendTo(root);
            if (r.canRecount) $('<button class="btn btn-primary mr-2 mobile-inventory-recount">').text(PosnicPro.i18n.t('lang_recount_unresolved_items', 'Recount unresolved items')).on('click', function () { self.closePopup(); self.startAudit({ itemIds:r.lines.filter(function(l){return !(r.applied || []).includes(l.itemId);}).map(function(l){return l.itemId;}) }); }).appendTo(root);
            if (r.canCancel) $('<button class="btn btn-outline-danger mobile-inventory-cancel">').attr('data-id',id).text(PosnicPro.i18n.t('lang_cancel_remaining_changes', 'Cancel remaining changes')).appendTo(root);
            if (!r.canCancel && !r.canRecount) $('<p>').text(PosnicPro.i18n.t('lang_ask_a_user_with_stock_write_access_to_this', 'Ask a user with stock write access to this branch to resolve this entry.')).appendTo(root);
        }
        if (r.cancellation) $('<p>').text('Remaining changes cancelled by ' + r.cancellation.actor + ': ' + r.cancellation.reason + '. Previously applied rows remain applied.').appendTo(root);
    });
};
var originalInventoryLoad = PosnicPro.inventorycounts.load;
PosnicPro.inventorycounts.load = function () { this.setupOverviewTabs(); this.selectOverviewTab(this.overviewTab || 'all'); };
$(document).on('click', '.mobile-inventory-refresh', function () { PosnicPro.inventorycounts.loadMobile(); });
$(document).on('click', '.mobile-inventory-more', function () { PosnicPro.inventorycounts.loadMobile($(this).attr('data-after')); });
$(document).on('click', '.mobile-inventory-open', function () { PosnicPro.inventorycounts.openMobile($(this).attr('data-id')); });
$(document).on('click', '.mobile-inventory-cancel', async function () {
    var button=$(this), id=button.attr('data-id'), branch=PosnicPro.local.get('branch_id_set');
    var answer=await PosnicPro.inventorycounts.dialog({title:PosnicPro.i18n.t('lang_cancel_remaining_changes', 'Cancel remaining changes'),text:'Already applied stock changes will remain. Enter a reason; this entry stays in history.',input:'text',showCancelButton:true,confirmButtonText:'Cancel remaining changes',preConfirm:function(value){return String(value||'').trim() ? Promise.resolve(value) : Promise.reject('Enter a reason.');}});
    if (!answer || answer.dismiss || branch!==PosnicPro.local.get('branch_id_set')) return;
    var reason=typeof answer==='string'?answer:answer.value; if (!reason) return;
    button.prop('disabled',true);
    PosnicPro.post({url:'mobile/v1/inventory/operations/'+encodeURIComponent(id)+'/cancel',data:JSON.stringify({reason:reason})},function(r){
        button.prop('disabled',false); if(branch!==PosnicPro.local.get('branch_id_set'))return;
        if(!r.operationId || r.state!=='cancelled') return PosnicPro.alert('error',r.message||'Could not cancel. Refresh and try again.');
        PosnicPro.inventorycounts.openMobile(id); PosnicPro.inventorycounts.loadMobile();
    },function(xhr){button.prop('disabled',false);PosnicPro.alert('error',xhr.responseJSON?.message||'Could not cancel. Refresh and try again.');});
});
$(document).on('click', '.mobile-inventory-confirm', function () {
    var button = $(this).prop('disabled', true), id = button.attr('data-id');
    PosnicPro.post({url:'mobile/v1/inventory/operations/' + encodeURIComponent(id) + '/confirm',data:'{}'}, function (r) {
        button.prop('disabled', false);
        if (!r.operationId) { PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_confirm_check_permissions_and_re', 'Could not confirm. Check permissions and refresh the operation before retrying.')); return; }
        PosnicPro.inventorycounts.openMobile(id); PosnicPro.inventorycounts.loadMobile();
    }, function () { button.prop('disabled', false); PosnicPro.alert('error', PosnicPro.i18n.t('lang_connection_interrupted_refresh_to_check_th', 'Connection interrupted. Refresh to check the operation before retrying.')); });
});

$(document).on('click', '.mobile-inventory-close', function () {
    var p = PosnicPro.inventorycounts;
    p.closePopup();
    p.detailRequest = (p.detailRequest || 0) + 1;
    $('#inventorycounts').removeClass('count-reviewing');
    $('#mobile_inventory_detail').empty();
    if (p.reviewTrigger && p.reviewTrigger.isConnected) p.reviewTrigger.focus({preventScroll:true});
    window.scrollTo({top:p.reviewScroll || 0,behavior:'instant'});
});

// An audit replaces only explicitly entered counts. It uses the same durable,
// revision-checked operation and approval flow as the handset stock ledger.
// Stock audit uses the same revision-checked journal as inventory operations.
(function (p) {
    var activeBranch, branch, rows = [], branches = [], categories = [], sequence = 0, operationId, edits = {}, reasons = {}, reviewId, recountIds = null, auditPage = 1, auditPageSize = 25;
    function api(options) {
        return new Promise(function (resolve, reject) {
            PosnicPro.request(options, function (r) {
                if (r.type === 'error' || r.error) reject(new Error(r.message || r.error.message)); else resolve(r.data || r);
            }, function (xhr) { reject(new Error(xhr.responseJSON?.message || 'Could not complete this request. Refresh and retry.')); });
        });
    }
    function scope(url) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'targetBranchId=' + encodeURIComponent(branch); }
    function check() { if (activeBranch !== PosnicPro.local.get('branch_id_set')) throw new Error('Signed-in branch changed. Reopen stock adjustment.'); }
    function fail(e) {
        $('#audit_status').text(e.message).attr('role','alert').addClass('text-danger');
        if(typeof PosnicPro.alert==='function')PosnicPro.alert('error',e.message);
    }
    function invalidRow(id, field, message) {
        var matches=filtered(), index=matches.findIndex(function(r){return r.id===id;});
        if(index<0){$('#audit_search').val('');$('#audit_category').val('');matches=filtered();index=matches.findIndex(function(r){return r.id===id;});}
        auditPage=Math.floor(Math.max(0,index)/auditPageSize)+1;render();
        var input=$('#audit_rows .'+field).filter(function(){return $(this).attr('data-id')===id;}).first();
        input.addClass('is-invalid').attr('aria-invalid','true').attr('aria-describedby','audit_field_error');
        $('<div id="audit_field_error" class="invalid-feedback" role="alert">').text(message).insertAfter(input);
        if(input[0]){input[0].scrollIntoView({block:'center',behavior:'auto'});input.trigger('focus');}
        throw new Error(message);
    }
    function filtered() {
        var q = String($('#audit_search').val() || '').toLowerCase(), category = $('#audit_category').val();
        return rows.filter(function (r) { return (!recountIds || recountIds.includes(r.id)) && (!category || r.categoryId === category) && (r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)); });
    }
    function render() {
        var body = $('#audit_rows').empty();
        var matches = filtered(), pages = Math.max(1, Math.ceil(matches.length / auditPageSize));
        auditPage = Math.min(auditPage, pages);
        var offset = (auditPage - 1) * auditPageSize;
        matches.slice(offset, offset + auditPageSize).forEach(function (r) {
            var tr = $('<tr>').appendTo(body);
            [r.sku, r.name, r.unit, r.quantity == null ? 'Invalid stock' : (r.quantity / 1000).toFixed(3)].forEach(function (v) { $('<td>').text(v).appendTo(tr); });
            $('<td>').append($('<input class="form-control audit-new" type="number" min="0" step="0.001" placeholder="No change" data-t-placeholder="lang_no_change" style="width:110px">').attr('data-id', r.id).attr('aria-label', 'New stock for ' + r.name).val(edits[r.id] ?? '')).appendTo(tr);
            $('<td>').append($('<input class="form-control audit-reason" list="audit_reasons" placeholder="Choose or type" data-t-placeholder="lang_choose_or_type" maxlength="500" style="width:200px">').attr('data-id', r.id).attr('aria-label', 'Reason for ' + r.name).val(reasons[r.id] || '')).appendTo(tr);
        });
        $('#audit_page_info').text((matches.length ? offset + 1 : 0) + '–' + Math.min(offset + auditPageSize, matches.length) + ' of ' + matches.length + ' products · Page ' + auditPage + ' of ' + pages);
        $('#audit_prev').prop('disabled', auditPage <= 1);
        $('#audit_next').prop('disabled', auditPage >= pages);
    }
    async function load() {
        var ticket = ++sequence; auditPage = 1; rows = []; edits = {}; reasons = {}; operationId = null; reviewId = null;
        $('#audit_review_panel').empty(); $('#audit_status').text('Loading stock…');
        var after;
        do {
            var page = await api({ url: scope('inventory-counts/catalogue' + (after ? '?after=' + encodeURIComponent(after) : '')), method: 'GET' });
            if (ticket !== sequence) return; check(); rows = rows.concat(page.rows.filter(function (r) { return r.tracked; })); after = page.next;
            if (rows.length > 20000) throw new Error('This view supports up to 20,000 products.');
        } while (after);
        categories = []; after = null;
        do {
            var page = await api({ url: scope('inventory-counts/catalogue?kind=categories' + (after ? '&after=' + encodeURIComponent(after) : '')), method: 'GET' });
            if (ticket !== sequence) return; check(); categories = categories.concat(page.rows); after = page.next;
        } while (after);
        var category = $('#audit_category').empty().append($('<option value="">').text(PosnicPro.i18n.t('lang_all_categories', 'All categories')));
        categories.sort(function (a,b) { return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name); });
        categories.forEach(function (c) { category.append($('<option>').val(c.id).text(c.name)); });
        rows.sort(function (a,b) { return (categories.findIndex(function (c) { return c.id === a.categoryId; }) - categories.findIndex(function (c) { return c.id === b.categoryId; })) || a.sku.localeCompare(b.sku, undefined, { numeric: true }) || a.name.localeCompare(b.name); });
        render(); $('#audit_status').text('Blank = unchanged · 0 = no stock · reason required for each change');
    }
    p.startAudit = async function (options) {
        p.leaveSection();
        recountIds = options && Array.isArray(options.itemIds) ? options.itemIds : null;
        p.detailRequest=(p.detailRequest||0)+1;
        $('#inventorycounts').removeClass('count-reviewing').addClass('count-editing');
        activeBranch = branch = PosnicPro.local.get('branch_id_set'); auditPageSize=25;
        $('#inventory_count_detail').show().html('<div class="d-flex align-items-center justify-content-between mb-3" style="gap:12px"><h5 class="mb-0"><lang class="lang_stock_adjust_title">Stock adjustment</lang></h5><label class="mb-0 d-flex align-items-center" style="gap:8px">Branch <select id="audit_branch" class="form-control" style="width:170px" aria-label="Stock adjustment branch" data-t-aria-label="lang_stock_adjustment_branch"></select></label></div>' +
            '<div class="d-flex flex-wrap align-items-center mb-3" style="gap:8px"><input id="audit_search" class="form-control" style="width:220px;max-width:100%" placeholder="Search product / SKU" data-t-placeholder="lang_search_product_sku" aria-label="Search products" data-t-aria-label="lang_search_products"><select id="audit_category" class="form-control" style="width:190px" aria-label="Category" data-t-aria-label="lang_newcategory_title"><option value="" data-t="lang_all_categories">All categories</option></select><span class="flex-grow-1"></span><button class="btn btn-outline-primary" id="audit_download"><lang class="lang_excel">Excel</lang></button><button class="btn btn-outline-primary" id="audit_print"><lang class="lang_printed">Print</lang></button><button class="btn btn-outline-primary" id="audit_upload"><lang class="lang_upload">Upload</lang></button><input type="file" id="audit_file" accept=".xlsx,.csv" hidden></div>' +
            '<datalist id="audit_reasons"><option value="Monthly stock count"><option value="Damaged during handling"><option value="Spoilage / expired stock"><option value="Opening stock correction"><option value="Stock entry correction"></datalist>' +
            '<div class="table-responsive"><table class="table"><thead><tr><th><lang class="lang_sku_title">SKU</lang></th><th><lang class="lang_product">Product</lang></th><th><lang class="lang_unit_title">Unit</lang></th><th><lang class="lang_current_stock">Current stock</lang></th><th><lang class="lang_new_stock">New stock</lang></th><th><lang class="lang_stock_adjust_reason">Reason</lang></th></tr></thead><tbody id="audit_rows"></tbody></table></div><div class="d-flex justify-content-between align-items-center flex-wrap my-3" style="gap:12px"><label class="mb-0 d-flex align-items-center" style="gap:8px">Rows <select id="audit_page_size" class="form-control" aria-label="Rows per page" data-t-aria-label="lang_rows_per_page" style="width:85px"><option>25</option><option>50</option><option>100</option></select></label><span id="audit_page_info" role="status"></span><div><button id="audit_prev" class="btn btn-outline-primary"><lang class="lang_previous">Previous</lang></button> <button id="audit_next" class="btn btn-outline-primary"><lang class="lang_next">Next</lang></button></div></div><div class="d-flex justify-content-between align-items-center flex-wrap" style="gap:12px"><small id="audit_status" role="status"></small><button class="btn btn-primary" id="audit_review"><lang class="lang_review_changes">Review changes</lang></button></div><div id="audit_review_panel" class="mt-3"></div>');
        try {
            branches = await api({ url: 'items/priceSheet', method: 'POST', data: JSON.stringify({ action: 'branches' }) }); check();
            branches.forEach(function (b) { $('#audit_branch').append($('<option>').val(b.id).text(b.name)); }); $('#audit_branch').val(branch).prop('disabled', branches.length < 2);
            await load();
            if (recountIds) $('#audit_status').text('Unresolved items only. Stock refreshed; enter the actual count again. Previous quantities have not been copied. The old entry remains in history.');
        } catch (e) { fail(e); }
    };
    $(document).on('input', '.audit-new,.audit-reason', function () {
        ($(this).hasClass('audit-new') ? edits : reasons)[$(this).attr('data-id')] = this.value;
        $(this).removeClass('is-invalid').removeAttr('aria-invalid aria-describedby').siblings('.invalid-feedback').remove();
        $('#audit_status').removeClass('text-danger').attr('role','status');
        operationId = null; $('#audit_file').val(''); $('#audit_review_panel').empty();
    }).on('input', '#audit_search', function(){auditPage=1;render();}).on('change', '#audit_category', function(){auditPage=1;render();});
    $(document).on('change','#audit_page_size',function(){auditPageSize=Number(this.value);auditPage=1;render();}).on('click','#audit_prev',function(){auditPage=Math.max(1,auditPage-1);render();}).on('click','#audit_next',function(){auditPage++;render();});
    $(document).on('change', '#audit_branch', async function () {
        if (Object.values(edits).some(function (v) { return v !== ''; }) && !await p.confirmLeave('Discard unsaved stock counts and change branch?')) { $(this).val(branch); return; }
        branch = this.value; recountIds=null; $('#audit_file').val(''); try { await load(); } catch (e) { fail(e); }
    });
    function download(data) {
        var bytes = Uint8Array.from(atob(data.base64), function (v) { return v.charCodeAt(0); }), url = URL.createObjectURL(new Blob([bytes]));
        var a = document.createElement('a'); a.href = url; a.download = data.filename; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    $(document).on('click', '#audit_download', async function () {
        try { check(); var selected = branch, result = await api({ url: scope('inventory-counts/sheet?category=' + encodeURIComponent($('#audit_category').val() || '') + '&q=' + encodeURIComponent($('#audit_search').val() || '')), method: 'GET' }); check(); if (selected === branch) download(result); } catch (e) { fail(e); }
    }).on('click', '#audit_upload', function () { $('#audit_file').trigger('click'); }).on('change', '#audit_file', function () {
        operationId = null; $('#audit_review_panel').empty(); $('#audit_status').text(this.files[0] ? 'Selected ' + this.files[0].name + '. Review uses this file instead of online edits.' : 'No file selected.');
    });
    $(document).on('click', '#audit_print', function () {
        try { check(); } catch (e) { return fail(e); }
        var win = window.open('', '_blank'); if (!win) return fail(new Error('Allow the print window and retry.'));
        win.document.write('<!doctype html><title>Stock count worksheet</title><style>body{font:12px sans-serif}table{width:100%;border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}thead{display:table-header-group}</style><h1><lang class="lang_stock_count_worksheet">Stock count worksheet</lang></h1><p>' + p.esc(branches.find(function (b) { return b.id === branch; })?.name || branch) + ' · ' + p.esc(new Date().toLocaleString()) + '</p><table><thead><tr><th><lang class="lang_sku_title">SKU</lang></th><th><lang class="lang_product">Product</lang></th><th><lang class="lang_unit_title">Unit</lang></th><th><lang class="lang_current_stock">Current stock</lang></th><th><lang class="lang_new_stock">New stock</lang></th><th><lang class="lang_stock_adjust_reason">Reason</lang></th></tr></thead><tbody>' + filtered().map(function (r) { return '<tr>' + [r.sku,r.name,r.unit,r.quantity / 1000,'',''].map(function (v) { return '<td>' + p.esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
        win.document.close(); win.focus(); win.print();
    });
    function review(r) {
        reviewId = r.operationId;
        p.popup('audit_review_panel','Review stock adjustments');
        var complete=r.state==='complete';
        var panel = $('#audit_review_panel').empty().append($('<h5>').text(complete?'Stock adjustment completed':'Review stock adjustments'));
        if(complete){
            edits={};reasons={};operationId=null;$('#audit_file').val('');render();
            $('<div class="alert alert-success" role="status">').text('Stock updated successfully. No further approval is needed.').appendTo(panel);
            $('#audit_status').removeClass('text-danger').text('Stock adjustment saved. Continue counting or return to Overview.');
            var footer=$('#inventory_popup .modal-footer').empty();
            $('<button type="button" class="btn btn-outline-primary">').text('Back to overview').on('click',function(){p.closePopup();p.navigate('overview');}).appendTo(footer);
            $('<button type="button" class="btn btn-primary">').text('Continue counting').on('click',function(){p.closePopup();}).appendTo(footer);
            $('#inventory_popup').off('hidden.bs.modal.auditComplete').one('hidden.bs.modal.auditComplete',async function(){
                if(!$('#inventorycounts').hasClass('count-editing'))return;
                var previousPage=auditPage;
                try{await load();auditPage=previousPage;render();}catch(e){fail(e);}
            });
        }else $('<p class="text-muted">').text('Check the quantities below, then confirm to update stock.').appendTo(panel);
        var table = $('<table class="table"><thead><tr><th><lang class="lang_product">Product</lang></th><th><lang class="lang_current">Current</lang></th><th><lang class="lang_addvariant_title">New</lang></th><th><lang class="lang_stock_adjust_reason">Reason</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr></thead><tbody></tbody></table>').appendTo($('<div class="table-responsive">').appendTo(panel));
        r.lines.forEach(function (l) { var tr = $('<tr>').appendTo(table.find('tbody')); [l.name,l.expected / 1000,l.quantity / 1000,l.reason,r.applied.includes(l.itemId) ? 'Applied' : r.state].forEach(function (v) { $('<td>').text(v).appendTo(tr); }); });
        if (['prepared','applying'].includes(r.state)) panel.append($('<button id="audit_confirm" class="btn btn-primary">').text(r.approvalRequired ? PosnicPro.i18n.t('lang_approve_adjustments', 'Approve adjustments') : PosnicPro.i18n.t('lang_confirm_adjustments', 'Confirm adjustments')));
        panel.append(' ').append($('<button id="audit_report" class="btn btn-outline-primary">').text(PosnicPro.i18n.t('lang_download_results', 'Download results')));
        if (r.state === 'conflict') {
            panel.append($('<p role="alert">').text('Stock changed after counting. Recount unresolved items or cancel remaining changes. Already applied rows remain applied.'));
            $('<button class="btn btn-primary mr-2">').text(PosnicPro.i18n.t('lang_recount_unresolved_items', 'Recount unresolved items')).on('click',async function(){
                p.closePopup();recountIds=r.lines.filter(function(l){return !r.applied.includes(l.itemId);}).map(function(l){return l.itemId;});
                $('#audit_file').val(''); try {check();await load();$('#audit_status').text(PosnicPro.i18n.t('lang_stock_refreshed_enter_actual_counts_for_th', 'Stock refreshed. Enter actual counts for the unresolved items.'));}catch(e){fail(e);}
            }).appendTo(panel);
            $('<button class="btn btn-outline-danger">').text(PosnicPro.i18n.t('lang_cancel_remaining_changes', 'Cancel remaining changes')).on('click',async function(){
                var id=r.operationId, selectedBranch=branch, button=$(this);
                var answer=await PosnicPro.inventorycounts.dialog({title:PosnicPro.i18n.t('lang_cancel_remaining_changes', 'Cancel remaining changes'),text:'Applied rows remain applied. Enter a cancellation reason.',input:'text',showCancelButton:true,confirmButtonText:'Cancel remaining changes',preConfirm:function(v){return String(v||'').trim()?Promise.resolve(v):Promise.reject('Enter a reason.');}});
                if(!answer||answer.dismiss||branch!==selectedBranch)return;
                var reason=typeof answer==='string'?answer:answer.value;if(!reason)return;
                button.prop('disabled',true);
                try {check();var result=await api({url:scope('inventory-counts/audit/'+encodeURIComponent(id)+'/cancel'),method:'POST',data:JSON.stringify({reason:reason})});check();if(branch===selectedBranch){review(result);$('#audit_status').text(PosnicPro.i18n.t('lang_remaining_changes_cancelled_applied_rows_r', 'Remaining changes cancelled. Applied rows remain applied.'));}}catch(e){fail(e);}finally{button.prop('disabled',false);}
            }).appendTo(panel);
        }
    }
    $(document).on('click', '#audit_review', async function () {
        var button = $(this).prop('disabled', true), selected = branch;
        $('#audit_status').removeClass('text-danger').attr('role','status').text('Preparing review...');
        try {
            check(); operationId = operationId || ('audit_' + crypto.randomUUID()); var result, file = $('#audit_file')[0].files[0];
            if (file) {
                var form = new FormData(); form.append('file', file); form.append('id', operationId); form.append('reason', 'Stock adjustment');
                result = await api({ url: scope('inventory-counts/sheet'), method: 'POST', data: form, contentType: false, processData: false });
            } else {
                var lines = Object.keys(edits).filter(function (id) { return edits[id] !== ''; }).map(function (id) {
                    if (!/^\d+(\.\d{1,3})?$/.test(edits[id])) invalidRow(id,'audit-new','Enter non-negative stock with at most three decimals.');
                    if (!reasons[id]?.trim()) invalidRow(id,'audit-reason','Choose or type a reason for this stock change.');
                    var row = rows.find(function (r) { return r.id === id; });
                    return { itemId: id, quantity: Math.round(Number(edits[id]) * 1000), revision: row.revision, reason: reasons[id].trim() };
                });
                if (!lines.length || lines.length > 200) throw new Error('Review between 1 and 200 changes at a time.');
                result = await api({ url: scope('inventory-counts/audit'), method: 'POST', data: JSON.stringify({ id: operationId, mode: 'count', reason: 'Stock adjustment', lines: lines }) });
            }
            check(); if (selected !== branch) return; review(result); if(result.state!=='complete')$('#audit_status').text(PosnicPro.i18n.t('lang_prepared_for_review_stock_has_not_changed', 'Prepared for review. Stock has not changed.'));
        } catch (e) { fail(e); } finally { button.prop('disabled', false); }
    });
    $(document).on('click', '#audit_confirm', async function () {
        var button = $(this).prop('disabled', true), selected = branch;
        try { check(); var r = await api({ url: scope('inventory-counts/audit/' + encodeURIComponent(reviewId) + '/confirm'), method: 'POST', data: '{}' }); check(); if (selected === branch) { review(r); $('#audit_status').text(r.state === 'complete' ? PosnicPro.i18n.t('lang_stock_adjustment_saved', 'Stock adjustment saved.') : PosnicPro.i18n.t('lang_review_the_row_status_before_retrying', 'Review the row status before retrying.')); } }
        catch (e) { fail(e); } finally { button.prop('disabled', false); }
    }).on('click', '#audit_report', async function () {
        try { check(); var selected = branch, r = await api({ url: scope('inventory-counts/audit/' + encodeURIComponent(reviewId) + '/report'), method: 'GET' }); check(); if (selected === branch) download(r); } catch (e) { fail(e); }
    });
})(PosnicPro.inventorycounts);

// Spoilage is a separately approved stock movement, never a count overwrite.
(function (p) {
    var branch, signedBranch, info, catalogue=[], draft, selected=[], busy=false, next, generation=0, listScroll=0, listTrigger=null, productNext=null, productRequest=0, searchTimer, historyCursors=[null], historyPage=0;
    var labels={draft:'Not saved',pending:'Not saved',approving:'Saving',accepted:'Completed',rejected:'Rejected',conflict:'Stock conflict',reversed:'Undone — stock restored',reversal_pending:'Restoring stock'};
    function outcome(d){return d.state==='accepted'?(d.kind==='reversal'||/^RV-SP-/.test(d.reference||'')?'Completed — stock restored':'Completed — stock deducted'):(labels[d.state]||d.state);}
    function nextStep(d){return ['accepted','reversed','rejected'].includes(d.state)?'No action needed':d.state==='conflict'?'Open entry to resolve the stock conflict':d.state==='draft'?'Open entry to finish saving':'Open entry to check or retry';}
    function request(url,method,data) {
        if (signedBranch !== PosnicPro.local.get('branch_id_set')) return Promise.reject(new Error('Signed-in branch changed. Reopen Spoilage / damage.'));
        var token=generation;
        return new Promise(function(resolve,reject){PosnicPro.request({url:url+(url.indexOf('?')<0?'?':'&')+'targetBranchId='+encodeURIComponent(branch),method:method||'GET',data:data?JSON.stringify(data):undefined},function(r){
            if(token!==generation)return reject(new Error('Branch changed. Reopen the entry.'));
            if(r.type==='error'||r.error)return reject(new Error(r.message||'Request failed.'));resolve(r.data||r);
        },function(xhr){reject(new Error(xhr.responseJSON?.message||'Could not complete the request. Retry safely.'));});});
    }
    function error(e){$('#sp_status').text(e.message);}
    async function run(fn){if(busy)return;busy=true;$('#spoilage_panel button').prop('disabled',true);try{await fn();}catch(e){error(e);}finally{busy=false;$('#spoilage_panel button').prop('disabled',false);$('#sp_prev').prop('disabled',historyPage===0);$('#sp_more').prop('disabled',!next);}}
    function table(headers,rows){var wrap=$('<div class="table-responsive">'),t=$('<table class="table table-sm">').appendTo(wrap),h=$('<tr>').appendTo($('<thead>').appendTo(t)),b=$('<tbody>').appendTo(t);headers.forEach(function(v){$('<th>').text(v).appendTo(h);});rows.forEach(function(row){var tr=$('<tr>').appendTo(b);row.forEach(function(v){$('<td>').text(v==null?'—':v).appendTo(tr);});});return wrap;}
    function query(){return 'from='+encodeURIComponent($('#sp_from').val()||'')+'&to='+encodeURIComponent($('#sp_to').val()||'')+'&status='+encodeURIComponent($('#sp_state').val()||'')+'&q='+encodeURIComponent($('#sp_search').val()||'');}
    function download(r){var u=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.base64),function(v){return v.charCodeAt(0);})]));var a=document.createElement('a');a.href=u;a.download=r.filename;a.click();setTimeout(function(){URL.revokeObjectURL(u);},1000);}
    async function load(direction){
        if(direction==='next'&&next){historyCursors[historyPage+1]=next;historyPage++;}
        else if(direction==='prev')historyPage=Math.max(0,historyPage-1);
        else {historyCursors=[null];historyPage=0;}
        info=await request('inventory-counts/spoilage?'+query()+'&limit=25'+(historyCursors[historyPage]?'&after='+historyCursors[historyPage]:''));next=info.next;
        $('#sp_new').toggle(info.canWrite);
        var root=$('#sp_list').empty(), body=$('<tbody>');
        var grid=$('<table class="table"><thead><tr><th><lang class="lang_reference_title">Reference</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_userstatus">Status</lang></th><th><lang class="lang_entered_by">Entered by</lang></th><th>Next step</th><th></th></tr></thead></table>').append(body);
        $('<div class="table-responsive">').append(grid).appendTo(root);
        info.rows.forEach(function(d){var row=$('<tr>').appendTo(body);
            [d.reference,d.occurredOn,outcome(d),d.createdByName,nextStep(d)].forEach(function(v){$('<td>').text(v).appendTo(row);});
            $('<td class="text-right">').append($('<button class="btn btn-sm btn-outline-primary sp_open">').attr('data-id',d._id).text(PosnicPro.i18n.t('lang_view', 'View'))).appendTo(row);
        });
        if(!info.rows.length)root.html('<p class="p-3 text-muted"><lang class="lang_no_entries_match_these_filters">No entries match these filters.</lang></p>');
        $('#sp_page_info').text('Page '+(historyPage+1)+' · '+info.rows.length+' entries');
        $('#sp_prev').prop('hidden',false).prop('disabled',historyPage===0);
        $('#sp_more').prop('hidden',false).prop('disabled',!next);
        $('#sp_status').text(PosnicPro.i18n.t('lang_record_losses_review_saved_entries_or_expo', 'Record losses, review saved entries or export the filtered history.'));
    }
    p.openSpoilage=async function(){
        p.leaveSection();
        $('#inventorycounts').addClass('count-editing');
        generation++;signedBranch=branch=PosnicPro.local.get('branch_id_set');draft=null;selected=[];
        $('#inventory_count_detail').show().html('<section id="spoilage_panel"><div class="d-flex justify-content-between align-items-center mb-3"><h5 class="mb-0"><lang class="lang_spoilage_damage">Spoilage / damage</lang></h5><select id="sp_branch" aria-label="Spoilage branch" data-t-aria-label="lang_spoilage_branch" class="form-control" style="width:170px"></select></div><div class="d-flex flex-wrap align-items-center mb-3" style="gap:8px"><input id="sp_from" type="date" aria-label="From date" data-t-aria-label="lang_from_date" class="form-control" style="width:150px"><input id="sp_to" type="date" aria-label="To date" data-t-aria-label="lang_to_date" class="form-control" style="width:150px"><select id="sp_state" aria-label="Entry status" data-t-aria-label="lang_entry_status" class="form-control" style="width:170px"><option value="" data-t="lang_all_statuses">All statuses</option></select><input id="sp_search" aria-label="Find spoilage product" data-t-aria-label="lang_find_spoilage_product" placeholder="Product / SKU / reference" data-t-placeholder="lang_product_sku_reference" class="form-control" style="width:220px"><button id="sp_filter" class="btn btn-outline-primary"><lang class="lang_filter">Filter</lang></button><button id="sp_export" class="btn btn-outline-primary"><lang class="lang_excel">Excel</lang></button><button id="sp_new" class="btn btn-primary"><lang class="lang_new_entry_2">New entry</lang></button></div><small id="sp_status" role="status"></small><div id="sp_list" class="my-3"></div><div id="sp_paging" class="d-flex align-items-center justify-content-between"><span id="sp_page_info" role="status"></span><div><button id="sp_prev" class="btn btn-outline-primary"><lang class="lang_previous">Previous</lang></button> <button id="sp_more" class="btn btn-outline-primary"><lang class="lang_next">Next</lang></button></div></div><div id="sp_detail" class="mt-3"></div></section>');
        Object.keys(labels).forEach(function(k){$('#sp_state').append($('<option>').val(k).text(labels[k]));});
        try{var branches=await request('items/priceSheet','POST',{action:'branches'});branches.forEach(function(b){$('#sp_branch').append($('<option>').val(b.id).text(b.name));});$('#sp_branch').val(branch).prop('disabled',branches.length<2);await load();}catch(e){error(e);}
    };
    function collect(){
        selected.forEach(function(l){var tr=$('#sp_entry_rows tr[data-id="'+l.itemId+'"]');l.text=tr.find('.sp_qty').val();l.reason=tr.find('.sp_reason').val();l.remarks=tr.find('.sp_remarks').val();});
    }
    function renderEntryRows(){
        var body=$('#sp_entry_rows').empty();selected.forEach(function(l){var tr=$('<tr>').attr('data-id',l.itemId).appendTo(body);[l.name,l.unit,(l.available/1000).toFixed(3)].forEach(function(v){$('<td>').text(v).appendTo(tr);});
            $('<td>').append($('<input type="number" min="0.001" step="0.001" class="form-control sp_qty" style="width:120px">').attr('aria-label','Spoiled quantity for '+l.name).val(l.text??(l.quantity/1000||''))).appendTo(tr);
            var reason=$('<select class="form-control sp_reason" style="width:170px">').attr('aria-label','Reason for '+l.name);info.reasons.forEach(function(v){reason.append($('<option>').val(v).text(v));});reason.val(l.reason||'Spoilage');$('<td>').append(reason).appendTo(tr);
            $('<td>').append($('<input maxlength="500" class="form-control sp_remarks" placeholder="Optional details" data-t-placeholder="lang_optional_details" style="min-width:180px">').attr('aria-label','Remarks for '+l.name).val(l.remarks||'')).appendTo(tr);
            $('<td>').append($('<button class="btn btn-sm btn-outline-danger sp_remove">').attr('data-id',l.itemId).text(PosnicPro.i18n.t('lang_remove', 'Remove'))).appendTo(tr);
        });
    }
    async function matches(more){
        var ticket=++productRequest;
        $('#sp_product_status').text('Searching products…');
        try {
            var page=await request('inventory-counts/catalogue?tracked=true&limit=25&q='+encodeURIComponent($('#sp_product_search').val()||'')+'&category='+encodeURIComponent($('#sp_product_category').val()||'')+(more&&productNext?'&after='+encodeURIComponent(productNext):''));
            if(ticket!==productRequest||!$('#sp_product_results').length)return;
            catalogue=more?catalogue.concat(page.rows):page.rows;productNext=page.next;
            var root=$('#sp_product_results').empty();
            catalogue.forEach(function(r){
                var tr=$('<tr>').appendTo(root),added=selected.some(function(l){return l.itemId===r.id;});
                [r.sku||'—',r.name,r.unit,(r.quantity/1000).toFixed(3)].forEach(function(v){$('<td>').text(v).appendTo(tr);});
                $('<td>').append($('<button type="button" class="btn btn-sm btn-outline-primary sp_add_result">').attr('data-id',r.id).prop('disabled',added).text(added?'Added':'Add')).appendTo(tr);
            });
            $('#sp_product_more').prop('hidden',!productNext);
            $('#sp_product_status').text(catalogue.length?catalogue.length+' products shown · '+selected.length+' selected':'No matching products. Try a different name, SKU, barcode or category.');
        }catch(e){if(ticket===productRequest)$('#sp_product_status').text(e.message);}
    }
    async function editor(existing){
        generation++;
        p.closePopup();catalogue=[];productNext=null;productRequest++;
        draft=existing||{clientId:crypto.randomUUID(),revision:0,occurredOn:info.today};selected=existing?existing.lines.map(function(l){return Object.assign({},l,{text:(l.quantity/1000).toFixed(3)});}):[];
        $('#sp_detail').show().html(`
<h5><lang class="lang_new_spoilage_damage_entry">New spoilage / damage entry</lang></h5>
<div class="sp-entry-tools"><label>Date<input id="sp_date" type="date" class="form-control"></label><button id="sp_online" class="btn btn-outline-primary"><lang class="lang_add_products">Add products</lang></button><button id="sp_sheet_download" class="btn btn-outline-primary"><lang class="lang_download_excel">Download Excel</lang></button><button id="sp_sheet_upload" class="btn btn-outline-primary"><lang class="lang_upload_excel_csv">Upload Excel / CSV</lang></button><input id="sp_sheet_file" type="file" accept=".xlsx,.csv" hidden></div>
<p class="text-muted">Add products or upload a completed spoilage sheet. Review before saving; importing does not change stock.</p>
<div id="sp_picker" class="sp-picker" style="display:none"><div class="sp-picker-tools"><input id="sp_product_search" placeholder="Search name, SKU or barcode" data-t-placeholder="lang_search_name_sku_or_barcode" aria-label="Search products" data-t-aria-label="lang_search_products" class="form-control"><select id="sp_product_category" aria-label="Category" data-t-aria-label="lang_newcategory_title" class="form-control"><option value="" data-t="lang_all_categories">All categories</option></select><button id="sp_picker_close" class="btn btn-link"><lang class="lang_done_selecting">Done selecting</lang></button></div><div class="table-responsive sp-results"><table class="table table-sm"><thead><tr><th><lang class="lang_sku_title">SKU</lang></th><th><lang class="lang_product">Product</lang></th><th><lang class="lang_unit_title">Unit</lang></th><th><lang class="lang_available">Available</lang></th><th></th></tr></thead><tbody id="sp_product_results"></tbody></table></div><div class="sp-picker-tools"><small id="sp_product_status" role="status"></small><button id="sp_product_more" class="btn btn-outline-primary" hidden><lang class="lang_load_more">Load more</lang></button></div></div>
<h6 class="mt-3">Selected products · review quantities</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th><lang class="lang_product">Product</lang></th><th><lang class="lang_unit_title">Unit</lang></th><th><lang class="lang_available">Available</lang></th><th><lang class="lang_spoiled">Spoiled</lang></th><th><lang class="lang_stock_adjust_reason">Reason</lang></th><th><lang class="lang_remarks_optional">Remarks (optional)</lang></th><th></th></tr></thead><tbody id="sp_entry_rows"></tbody></table></div><p id="sp_import_status" role="status"></p><p class="text-muted"><lang class="lang_enter_the_quantity_lost_not_the_remaining">Enter the quantity lost, not the remaining stock.</lang></p><div class="d-flex" style="gap:8px"><button id="sp_save" class="btn btn-primary"><lang class="lang_save_update_stock">Save &amp; update stock</lang></button><button id="sp_close" class="btn btn-link"><lang class="lang_close_title">Close</lang></button></div>`);
        $('#sp_date').val(draft.occurredOn);renderEntryRows();
        var after; do {var page=await request('inventory-counts/catalogue?kind=categories'+(after?'&after='+after:''));page.rows.forEach(function(c){$('#sp_product_category').append($('<option>').val(c.id).text(c.name));});after=page.next;}while(after);
        await matches(false);
    }
    async function save(){
        collect();var payload={clientId:draft.clientId,revision:draft.revision,occurredOn:$('#sp_date').val(),lines:selected.map(function(l){if(!/^\d+(\.\d{1,3})?$/.test(String(l.text||'')))throw new Error('Enter a positive spoiled quantity with up to three decimals.');return {itemId:l.itemId,quantity:Math.round(Number(l.text)*1000),reason:l.reason,remarks:l.remarks};})};
        var saved=await request('inventory-counts/spoilage/record','POST',payload);draft=saved;
        await load();show(saved);
    }
    function show(d){
        draft=d;p.popup('sp_detail','Spoilage / damage details');var root=$('#sp_detail').empty();
        $('<button id="sp_back" class="btn btn-outline-secondary mb-3">').text(PosnicPro.i18n.t('lang_close_details', 'Close details')).appendTo(root);
        $('<h5>').text(d.reference+' · '+outcome(d)).appendTo(root);
        $('<p>').text(d.occurredOn+' · Entered by '+d.createdByName+' · '+new Date(d.created_date).toLocaleString()+(d.decisionByName?' · Reviewed by '+d.decisionByName:'' )).appendTo(root);
        if(!d.local)$('<p class="text-warning">').text('Read-only synced record. Review or correct this entry on the '+d.origin.toLowerCase()+' installation where it was created.').appendTo(root);
        if(d.lastError)$('<p class="text-danger">').text(d.lastError).appendTo(root);
        if(d.state==='accepted'){
            var success=$('<div class="alert alert-success" role="status">').appendTo(root);
            $('<strong class="d-block">').text(d.kind==='reversal'?'Completed — stock restored':'Completed — stock deducted').appendTo(success);
            $('<span>').text(d.kind==='reversal'?'The stock has been restored. No further action is needed.':'The spoiled quantities have been deducted from stock. You’re done — no approval is needed.').appendTo(success);
        }
        var footer=$('#inventory_popup .modal-footer').empty();
        if(d.canWrite&&d.state==='accepted')$('<button type="button" id="sp_another" class="btn btn-outline-primary">').text('Add another entry').appendTo(footer);
        $('<button type="button" id="sp_done" class="btn btn-primary">').text(d.state==='accepted'?'Done':'Close').appendTo(footer);
        var shell=root;
        var tabs=$('<div class="nav nav-tabs mb-3" role="tablist">').appendTo(shell);
        var detailsTab=$('<button type="button" id="sp_details_tab" class="nav-link active" role="tab" aria-selected="true" aria-controls="sp_details_panel">').text(PosnicPro.i18n.t('lang_item_details_title','Details')).appendTo(tabs);
        var auditTab=$('<button type="button" id="sp_audit_tab" class="nav-link" role="tab" aria-selected="false" aria-controls="sp_audit_panel">').text(PosnicPro.i18n.t('lang_audit_history','Audit history')).appendTo(tabs);
        root=$('<div id="sp_details_panel" role="tabpanel" aria-labelledby="sp_details_tab">').appendTo(shell);
        var auditPanel=$('<div id="sp_audit_panel" role="tabpanel" aria-labelledby="sp_audit_tab" hidden>').appendTo(shell),auditLoaded=false,auditLoading=false;
        async function selectTab(audit){
            detailsTab.toggleClass('active',!audit).attr('aria-selected',String(!audit));auditTab.toggleClass('active',audit).attr('aria-selected',String(audit));
            root.prop('hidden',audit);auditPanel.prop('hidden',!audit);
            if(!audit||auditLoaded||auditLoading)return;
            auditLoading=true;auditPanel.empty().attr('aria-busy','true').append($('<p role="status" class="text-muted">').text(PosnicPro.i18n.t('lang_loading','Loading...')));
            try{
                var history=await request('inventory-counts/spoilage/'+encodeURIComponent(d.id)+'?view=audit');
                if(!auditPanel[0].isConnected)return;
                auditPanel.empty();
                if((history.audit||[]).length)auditPanel.append(table(['Action','User','Time','Remarks'],history.audit.map(function(a){return [a.action,a.user,new Date(a.at).toLocaleString(),a.note];})));
                else auditPanel.append($('<p class="text-muted">').text(PosnicPro.i18n.t('lang_no_records','No Records')));
                auditLoaded=true;
            }catch(e){auditPanel.empty().append($('<p role="alert" class="text-danger">').text(e.message));}
            finally{auditLoading=false;auditPanel.attr('aria-busy','false');}
        }
        detailsTab.on('click',function(){selectTab(false);});auditTab.on('click',function(){selectTab(true);});
        tabs.on('keydown','button',function(e){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();var audit=this===detailsTab[0];(audit?auditTab:detailsTab).trigger('focus');selectTab(audit);}});
        root.append(table(['SKU','Product','Unit','Recorded','Applied','Estimated cost','Reason','Remarks'],d.lines.map(function(l){return [l.sku,l.name,l.unit,(l.quantity/1000).toFixed(3),(d.applied||[]).includes(l.itemId)?(l.quantity/1000).toFixed(3):'0.000',l.estimatedValue==null?'Unknown':l.estimatedValue.toFixed(2),l.reason,l.remarks];})));
        var known=d.lines.reduce(function(n,l){return n+(l.estimatedValue||0);},0),unknown=d.lines.filter(function(l){return l.estimatedValue==null;}).length;
        var quantities={};d.lines.forEach(function(l){quantities[l.unit]=(quantities[l.unit]||0)+l.quantity;});
        $('<p>').text('Recorded quantity: '+Object.keys(quantities).map(function(unit){return (quantities[unit]/1000).toFixed(3)+' '+unit;}).join(' · ')).appendTo(root);
        $('<p>').text('Estimated value at item cost: '+known.toFixed(2)+(unknown?' + '+unknown+' item(s) with unknown cost':'')+'. This is not sales revenue.').appendTo(root);
        var actions=$('<div class="d-flex flex-wrap" style="gap:8px">').appendTo(root);
        function button(id,text,css){$('<button>').attr('id',id).attr('class','btn '+(css||'btn-outline-primary')).text(text).appendTo(actions);}
        if(d.canEdit)button('sp_edit','Edit');
        if(d.canWrite&&['draft','pending','approving','conflict'].includes(d.state))button('sp_apply','Retry save','btn-primary');
        if(d.canWrite&&d.kind!=='reversal'&&['accepted','conflict','reversal_pending'].includes(d.state)&&(d.applied||[]).length){
            $('<span class="text-muted align-self-center">').text('Made a mistake?').appendTo(actions);
            button('sp_reverse','Undo stock deduction','btn-link');
        }

        root.attr('tabindex','-1');root[0].focus({preventScroll:true});
    }
    $(document).on('click','#sp_filter',function(){run(function(){return load();});}).on('click','#sp_more',function(){run(function(){return load('next');});})
    .on('click','#sp_prev',function(){run(function(){return load('prev');});})
    .on('change','#sp_branch',async function(){if($('#sp_entry_rows').length&&!await p.confirmLeave('Discard unsaved entry and change branch?')){$(this).val(branch);return;}branch=this.value;generation++;$('#sp_detail').empty();run(function(){return load();});})
    .on('click','#sp_new',function(){listScroll=window.scrollY;listTrigger=this;run(function(){return editor();});}).on('click','.sp_open',function(){var id=$(this).attr('data-id');listScroll=window.scrollY;listTrigger=this;run(async function(){show(await request('inventory-counts/spoilage/'+id+'?view=details'));});})
    .on('input','#sp_product_search',function(){clearTimeout(searchTimer);productRequest++;searchTimer=setTimeout(function(){matches(false);},250);})
    .on('change','#sp_product_category',function(){matches(false);})
    .on('click','#sp_product_more',function(){matches(true);})
    .on('click','#sp_online',function(){collect();p.popup('sp_picker','Add products');$('#sp_picker').show();$('#sp_product_search').trigger('focus');})
    .on('click','#sp_picker_close',function(){p.closePopup();$('#sp_picker').hide();$('#sp_entry_rows .sp_qty').filter(function(){return !this.value;}).first().trigger('focus');})
    .on('click','.sp_add_result',function(){collect();var id=$(this).attr('data-id'),r=catalogue.find(function(r){return r.id===id;});if(!r||selected.some(function(l){return l.itemId===id;}))return;if(selected.length>=200)return error(new Error('Use at most 200 products.'));selected.push({itemId:r.id,name:r.name,unit:r.unit,available:r.quantity,reason:'Spoilage',text:'',remarks:''});renderEntryRows();$(this).prop('disabled',true).text(PosnicPro.i18n.t('lang_added', 'Added'));$('#sp_product_status').text(catalogue.length+' products shown · '+selected.length+' selected');})
    .on('click','.sp_remove',function(){collect();var id=$(this).attr('data-id');selected=selected.filter(function(l){return l.itemId!==id;});renderEntryRows();$('.sp_add_result').filter(function(){return $(this).attr('data-id')===id;}).prop('disabled',false).text(PosnicPro.i18n.t('lang_nav_add', 'Add'));})
    .on('click','#sp_sheet_download',function(){run(async function(){download(await request('inventory-counts/spoilage-sheet?q='+encodeURIComponent($('#sp_product_search').val()||'')+'&category='+encodeURIComponent($('#sp_product_category').val()||'')));});})
    .on('click','#sp_sheet_upload',function(){$('#sp_sheet_file').trigger('click');})
    .on('change','#sp_sheet_file',async function(){
        var file=this.files[0];if(!file)return;
        if(selected.length&&!await p.confirmLeave('Replace selected rows with the uploaded sheet for review?')){this.value='';return;}
        var form=new FormData();form.append('file',file);var token=generation;
        $('#sp_save').prop('disabled',true);$('#sp_import_status').text('Checking sheet…');
        PosnicPro.request({url:'inventory-counts/spoilage-sheet?targetBranchId='+encodeURIComponent(branch),method:'POST',data:form,contentType:false,processData:false},function(r){
            if(token!==generation||!$('#sp_entry_rows').length)return;
            $('#sp_save').prop('disabled',false);if(r.type==='error'||r.error){$('#sp_import_status').text(r.message||'Could not check sheet.');return;}
            var data=r.data||r;selected=data.lines.map(function(l){return Object.assign({},l,{text:(l.quantity/1000).toFixed(3)});});renderEntryRows();$('#sp_picker').hide();$('#sp_import_status').text(selected.length+' rows ready for review. Stock has not changed. Check quantities, reasons and date, then Save & update stock.');
        },function(xhr){if(token===generation){$('#sp_save').prop('disabled',false);$('#sp_import_status').text(xhr.responseJSON?.message||'Could not check sheet.');}});
    })
    .on('click','#sp_another',function(){if(draft&&draft.canWrite&&draft.state==='accepted')run(function(){return editor();});})
    .on('click','#sp_save',function(){run(save);})
    .on('click','#sp_edit',function(){run(function(){return editor(draft);});})
    .on('click','#sp_apply',function(){run(async function(){show(await request('inventory-counts/spoilage/'+draft.id+'/apply','POST',{}));await load();});})
    .on('click','#sp_reverse',function(){run(async function(){
        var entryId=draft.id;
        var result=await PosnicPro.inventorycounts.dialog({title:PosnicPro.i18n.t('lang_undo_stock_deduction', 'Undo stock deduction'),text:'Enter a reason. The deducted stock will be restored.',input:'text',inputPlaceholder:'Reason for undoing this entry',showCancelButton:true,confirmButtonText:'Restore stock',preConfirm:function(note){
            note=String(note||'').trim();
            return note ? Promise.resolve(note) : Promise.reject('Enter a reason.');
        }});
        if(!result || result.dismiss)return;
        var note=typeof result==='string'?result:result.value;
        if(!note || !draft || draft.id!==entryId)return;
        show(await request('inventory-counts/spoilage/'+entryId+'/undo','POST',{note:note}));await load();
    });})
    .on('click','#sp_close,#sp_back,#sp_done',async function(){if($('#sp_entry_rows').length&&!await p.confirmLeave('Close without saving these edits?'))return;p.closePopup();generation++;productRequest++;$('#sp_detail').empty();if(listTrigger&&listTrigger.isConnected)listTrigger.focus({preventScroll:true});window.scrollTo({top:listScroll,behavior:'instant'});})
    .on('click','#sp_export',function(){run(async function(){download(await request('inventory-counts/spoilage/report?'+query()));});})
    ;
})(PosnicPro.inventorycounts);
