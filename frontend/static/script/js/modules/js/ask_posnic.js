PosnicPro.askposnic = {
    conversationId: null,
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-dashboard-tab,#view_askposnic_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('.page-title-box,#askposnic').show();
    },
    showDataTablePage: function () {
        this.settingsOpen = false;
        this._chrome();
        this.bind();
        this.loadStatus();
    },
    showSettings: function () {
        if (this.settingsLoading) return;
        this.settingsLoading = true;
        this.settingsOpen = true;
        this.admin = false;
        $('#ask_posnic_admin').hide();
        $('#ask_settings_access').show().text(PosnicPro.i18n.t('lang_ask_checking_access', 'Checking access to Ask Posnic settings…'));
        this.bind();
        this.loadStatus();
    },
    settingsTab: function (key, focus) {
        if (!this.admin || ['general', 'knowledge', 'access', 'usage', 'schedules'].indexOf(key) === -1) return;
        this.activeSettingsTab = key;
        $('[data-ask-tab]').each(function () {
            var active = $(this).attr('data-ask-tab') === key;
            $(this).attr({ 'aria-selected': String(active), tabindex: active ? '0' : '-1' });
        });
        $('.ask-settings-panel').prop('hidden', true);
        $('#ask-settings-' + key).prop('hidden', false);
        if (focus) $('#ask-tab-' + key).trigger('focus');
        if (key === 'knowledge') this.loadDocuments();
        if (key === 'schedules') this.loadSchedules();
        if (key === 'usage') { PosnicPro.settings.ai.load(); this.loadAudit(); this.loadRecovery(); }
    },
    resetConversation: function () {
        this.conversationId = null;
        $('#ask_posnic_thread,#ask_history_list').empty();
        $('#ask_posnic_welcome').prop('hidden', false);
        $('#ask_history_panel').prop('hidden', true);
        $('#ask_load_history').attr('aria-expanded', 'false');
        $('#ask_posnic_question').val('').trigger('focus');
    },
    esc: function (value) { return $('<span>').text(value == null ? '' : value).html(); },
    add: function (kind, text, data) {
        var self = this;
        var details = '';
        if (data && data.metrics && data.metrics.length) {
            details = '<div class="ask-posnic-metrics">' + data.metrics.map(function (metric) {
                return '<span class="ask-posnic-metric"><strong>' + self.esc(metric.value) + '</strong>' + self.esc(metric.label) + '</span>';
            }).join('') + '</div>';
        }
        if (data && data.source) details += '<span class="ask-posnic-source">Source: ' + self.esc(data.source) + '</span>';
        if (data && data.scope) details += '<span class="ask-posnic-source">' + (Array.isArray(data.scope.outlets) ? 'Outlets: ' + self.esc(data.scope.outlets.map(function (row) { return row.outlet; }).join(', ')) : 'Outlet: ' + self.esc(data.scope.outlet || 'Current outlet')) + (data.scope.from ? ' · ' + self.esc(new Date(data.scope.from).toLocaleString()) + ' to ' + self.esc(new Date(data.scope.to).toLocaleString()) : '') + (data.scope.as_of ? ' · as of ' + self.esc(new Date(data.scope.as_of).toLocaleString()) : '') + '</span>';
        if (data && data.citations && data.citations.length) details += '<span class="ask-posnic-source">Sources: ' + data.citations.map(function (citation, index) { return '<button type="button" class="btn btn-sm btn-link ask-citation" data-id="' + self.esc(citation.document_id) + '" data-revision="' + self.esc(citation.revision) + '" data-chunk="' + self.esc(citation.chunk) + '">[' + (index + 1) + '] ' + self.esc(citation.title + ' · ' + citation.revision + (Array.isArray(citation.pages) && citation.pages.length ? ' · PDF ' + citation.pages.join(', ') : '')) + '</button>'; }).join(' ') + '</span>';
        if (data && data.link) details += '<a class="ask-posnic-source" href="' + self.esc(data.link) + '">Open source page</a>';
        if (data && data.intent === 'low_stock') details += '<button type="button" class="btn btn-sm btn-primary-rgba ask-posnic-action" id="ask_posnic_prepare_po"><lang class="lang_prepare_purchase_order_draft">Prepare purchase order draft</lang></button>';
        if (data && data.action) details += '<button type="button" class="btn btn-sm btn-primary-rgba ask-posnic-action ask-posnic-draft-action" data-action="' + self.esc(data.action.type) + '" data-source="' + self.esc(data.action.source || '') + '" data-lookback-days="' + self.esc(data.action.lookback_days || '') + '" data-coverage-days="' + self.esc(data.action.coverage_days || '') + '">' + self.esc(data.action.label) + '</button>';
        if (kind === 'answer' && data && data.intent) details += '<span class="ask-posnic-feedback"><button type="button" class="btn btn-sm btn-link ask-feedback" data-rating="helpful" data-intent="' + self.esc(data.intent) + '">Helpful</button><button type="button" class="btn btn-sm btn-link ask-feedback" data-rating="not_helpful" data-intent="' + self.esc(data.intent) + '">Not helpful</button></span>';
        $('#ask_posnic_thread').append('<div class="ask-posnic-message ' + kind + '">' + self.esc(text) + details + '</div>');
        $('#ask_posnic_welcome').prop('hidden', true);
        var node = $('#ask_posnic_thread')[0];
        if (node) node.scrollTop = node.scrollHeight;
    },
    ask: function (question) {
        var self = this;
        if (self.asking) return;
        self.asking = true;
        $('#ask_posnic_progress').prop('hidden', false);
        $('#ask_posnic_form button,#ask_new_conversation,#ask_load_history,#ask_delete_history,#ask_history_list button').prop('disabled', true);
        $('#ask_posnic_thread').attr('aria-busy', 'true');
        self.add('user', question);
        $('#ask_posnic_question').prop('disabled', true);
        PosnicPro.request({ url: 'ask-posnic/ask', method: 'POST', data: JSON.stringify({ question: question, conversation_id: self.conversationId }) }, function (response) {
            self.asking = false;
            self.finishQuestion();
            $('#ask_posnic_question').prop('disabled', false).focus();
            if (response && response.type === 'success' && response.data) { self.conversationId = response.data.conversation_id || self.conversationId; self.add('answer', response.data.answer, response.data); }
            else self.add('answer', response && response.message || 'I could not answer that question.');
        }, function (xhr) {
            self.asking = false;
            self.finishQuestion();
            $('#ask_posnic_question').prop('disabled', false).focus();
            var message = xhr && xhr.responseJSON && xhr.responseJSON.message;
            self.add('answer', message || 'I could not reach the shop data. Please try again.');
        });
    },
    finishQuestion: function () {
        $('#ask_posnic_progress').prop('hidden', true);
        $('#ask_posnic_form button,#ask_new_conversation,#ask_load_history,#ask_delete_history,#ask_history_list button').prop('disabled', false);
        $('#ask_posnic_thread').attr('aria-busy', 'false');
    },
    loadStatus: function () {
        var self = this;
        PosnicPro.get('ask-posnic/status', function (response) {
            var data = response && response.data;
            self.settingsLoading = false;
            if (!data) {
                $('#ask_posnic_admin').hide();
                $('#ask_settings_access').show().text(PosnicPro.i18n.t('lang_ask_settings_failed', 'Settings could not be loaded. Reopen this page to try again.'));
                return;
            }
            var scope = data.scope && data.scope.license + ':' + data.scope.branch_id + ':' + data.scope.user_id;
            if (self.scope && self.scope !== scope) { self.resetConversation(); $('#ask_supplier_messages').empty(); self.activeSettingsTab = 'general'; }
            self.scope = scope;
            $('#ask_posnic_status').text($('#branch_name option:selected').text() || PosnicPro.i18n.t('lang_live_shop_data', 'Live shop data'));
            var preferences = data.preferences || {};
            $('#ask_load_supplier_messages').toggle(data.can_supplier_messages === true);
            if (!data.can_supplier_messages) $('#ask_supplier_messages').empty();
            $('#ask_pref_help').prop('checked', preferences.help_enabled !== false);
            $('#ask_pref_insights').prop('checked', preferences.insights_enabled !== false);
            $('#ask_pref_actions').prop('checked', preferences.actions_enabled !== false);
            $('#ask_pref_history').prop('checked', preferences.store_conversations !== false);
            $('#ask_pref_retention').val(preferences.retention_days || 30);
            $('#ask_retention_summary').text(preferences.retention_days || 30);
            $('#ask_pref_own_semantic').prop('checked', preferences.own_key_semantic === true);
            $('#ask_pref_embedding_budget').val(preferences.own_key_semantic_budget || 1);
            $('#ask_pref_period').val(preferences.default_period || 'today');
            $('#ask_pref_language').val(preferences.response_language || 'auto');
            $('#ask_help_instructions').val(preferences.help_instructions || '');
            $('#ask_pref_action_roles').val((preferences.roles && preferences.roles.actions) || []);
            $('#ask_pref_help_roles').val((preferences.roles && preferences.roles.help) || []);
            $('#ask_pref_insight_roles').val((preferences.roles && preferences.roles.insights) || []);
            $('.ask-allowed-action').each(function () { $(this).prop('checked', (preferences.allowed_actions || []).indexOf($(this).val()) !== -1); });
            self.admin = data.admin === true;
            $('#ask_posnic_admin').toggle(self.admin && self.settingsOpen === true);
            $('#ask_settings_access').toggle(!self.admin).text(PosnicPro.i18n.t('lang_ask_owner_settings', 'Only shop owners and administrators can manage these settings.'));
            $('#ask_billing_link').toggle(!!data.billing_url && data.admin === true);
            $('#ask_billing_message').toggle(data.billing_unavailable === true);
            var usage = data.usage || {};
            $('#ask_posnic_usage').html([
                { label: PosnicPro.i18n.t('lang_questions', 'Questions'), value: usage.questions || 0 },
                { label: PosnicPro.i18n.t('lang_published_sources', 'Published sources'), value: usage.published_documents || 0 },
                { label: PosnicPro.i18n.t('lang_confirmed_drafts', 'Confirmed drafts'), value: usage.confirmed_actions || 0 },
                { label: PosnicPro.i18n.t('lang_unanswered', 'Unanswered'), value: usage.unanswered || 0 },
                data.managed ? { label: PosnicPro.i18n.t('lang_managed_allowance_remaining_estimate', 'Managed allowance remaining (estimate)'), value: (data.managed.currency || '') + ' ' + (Number(data.managed.remaining_minor || 0) / 100).toFixed(2) } : null,
                data.own_key_search ? { label: PosnicPro.i18n.t('lang_own_key_search_budget_remaining_estimate', 'Own-key search budget remaining (estimate)'), value: data.own_key_search.currency + ' ' + (Number(data.own_key_search.remaining_minor || 0) / 100).toFixed(4) } : null,
                data.own_key_search && data.own_key_search.pending_calls ? { label: PosnicPro.i18n.t('lang_search_calls_pending_settlement_or_review', 'Search calls pending settlement or review'), value: data.own_key_search.pending_calls } : null
            ].filter(Boolean).map(function (item) { return '<span class="ask-posnic-metric"><strong>' + self.esc(item.value) + '</strong>' + self.esc(item.label) + '</span>'; }).join(''));
            if (self.admin && self.settingsOpen) self.settingsTab(self.activeSettingsTab || 'general');
        }, function () {
            self.settingsLoading = false;
            $('#ask_posnic_admin').hide();
            $('#ask_settings_access').show().text(PosnicPro.i18n.t('lang_ask_settings_failed', 'Settings could not be loaded. Reopen this page to try again.'));
        });
    },
    loadDocuments: function () {
        var self = this;
        PosnicPro.get('ask-posnic/documents', function (response) {
            var docs = response && response.data || [];
            function render(rows) { return rows.length ? rows.map(function (doc) {
                var action = '<button class="btn btn-sm btn-outline-primary ask-doc-review" data-id="' + self.esc(doc._id) + '">' + PosnicPro.i18n.t('lang_review_title', 'Review') + '</button>';
                var searchState = doc.semantic && ({ ready: 'Semantic search ready', pending: 'Search indexing queued', processing: 'Search indexing in progress', needs_review: 'Search indexing needs operator review' })[doc.semantic.state];
                if ($('#ask_pref_own_semantic').is(':checked') && doc.own_semantic) searchState = ({ ready: 'Own-key search ready', pending: 'Own-key indexing queued', processing: 'Own-key indexing in progress', needs_review: 'Own-key indexing needs operator review' })[doc.own_semantic.state];
                return '<div class="ask-posnic-document"><div><strong>' + self.esc(doc.title) + '</strong><small>' + self.esc(doc.kind + ' · ' + doc.status + ' · ' + doc.revision) + '</small>' + (searchState ? '<small>' + self.esc(searchState) + '</small>' : '') + '</div>' + action + '</div>';
            }).join('') : '<p class="text-muted"><lang class="lang_no_knowledge_documents_yet">No knowledge documents yet.</lang></p>'; }
            $('#ask_posnic_documents').html(render(docs.filter(function (doc) { return doc.origin !== 'posnic-intranet'; })));
            $('#ask_posnic_shared_documents').html(render(docs.filter(function (doc) { return doc.origin === 'posnic-intranet'; })));
        });
    },
    loadSchedules: function () {
        var self = this;
        PosnicPro.get('ask-posnic/schedules', function (response) {
            var rows = response && response.data || [];
            $('#ask_posnic_schedules').html(rows.map(function (row) { return '<div class="ask-posnic-document"><div><strong>' + self.esc(row.report.replace('_', ' ')) + '</strong><small>' + self.esc(row.frequency + ' at ' + row.hour + ':00 · ' + row.timezone + ' · ' + (row.channel || 'email') + ' · ' + row.destination) + '</small><small>' + self.esc((row.enabled ? PosnicPro.i18n.t('lang_enabled', 'Enabled') : PosnicPro.i18n.t('lang_paused', 'Paused')) + ' · ' + (row.last_status || 'Waiting for first run') + (row.last_error ? ' · ' + row.last_error : '')) + '</small></div><div>' + (!row.enabled && row.last_status === 'reviewed' ? '<button class="btn btn-sm btn-outline-primary ask-schedule-resume" data-id="' + self.esc(row._id) + '">Resume future deliveries</button> ' : '') + '<button class="btn btn-sm btn-outline-danger ask-schedule-delete" data-id="' + self.esc(row._id) + '"' + (row.running_at || row.last_status === 'needs_review' ? ' disabled' : '') + '>Delete</button></div></div>'; }).join(''));
        });
    },
    loadAudit: function () {
        var self = this;
        PosnicPro.get('ask-posnic/audit', function (response) {
            var rows = response && response.data || [];
            $('#ask_posnic_audit').html(rows.slice(0, 20).map(function (row) { return '<div class="ask-posnic-document"><div><strong>' + self.esc(String(row.event || '').replace(/_/g, ' ')) + '</strong><small>' + self.esc(new Date(row.at).toLocaleString()) + '</small></div></div>'; }).join('') || '<p class="text-muted"><lang class="lang_no_activity_yet">No activity yet.</lang></p>');
        });
    },
    loadRecovery: function () {
        var self = this;
        PosnicPro.get('ask-posnic/recovery', function (response) {
            var rows = response && response.data && response.data.rows || [];
            $('#ask_posnic_recovery').html(rows.map(function (row) {
                return '<div class="ask-posnic-document"><div><strong>' + self.esc(row.type + ': ' + row.label) + '</strong><small>' + self.esc(row.state.replace(/_/g, ' ')) + '</small></div>' + (row.can_review ? '<button class="btn btn-sm btn-outline-primary ask-recovery-action" data-id="' + self.esc(row.id) + '" data-type="' + self.esc(row.action_type) + '">Review status</button>' : '') + '</div>';
            }).join('') || '<p class="text-muted"><lang class="lang_no_pending_work_or_recovery_reviews">No pending work or recovery reviews.</lang></p>');
        });
    },
    preparePurchaseOrder: function () {
        this.prepareAction('purchase_order');
    },
    actionLink: function (type) { return type === 'supplier_message' ? '#/askposnic' : type === 'sale_draft' ? '#/quotes' : type === 'stock_count' ? '#/inventorycounts' : type === 'campaign' ? '#/customers' : '#/purchaseorders'; },
    loadSupplierMessages: function () {
        var self = this;
        $('#ask_history_panel').prop('hidden', false);
        $('#ask_load_history').attr('aria-expanded', 'true');
        $('#ask_supplier_messages').empty();
        PosnicPro.request({ url: 'ask-posnic/supplier-messages', method: 'GET' }, function (response) {
            if (!response || !response.data) return PosnicPro.alert('error', response && response.message || 'Could not load supplier-message drafts.');
            var target = $('#ask_supplier_messages').empty();
            response.data.forEach(function (row) {
                var details = $('<details class="border rounded p-2 mb-2">').appendTo(target);
                $('<summary>').text(row.subject).appendTo(details);
                $('<p class="text-muted mt-2 mb-2">').text('Saved draft for ' + row.supplier_name + '. Check the current purchase order before sending.').appendTo(details);
                var body = $('<textarea class="form-control mb-2" rows="6" readonly aria-label="Saved supplier message" data-t-aria-label="lang_saved_supplier_message">').val(row.body).appendTo(details);
                $('<button type="button" class="btn btn-sm btn-outline-primary"><lang class="lang_copy_message">Copy message</lang></button>').on('click', function () {
                    var fallback = function () { body.trigger('focus').trigger('select'); PosnicPro.alert('info', PosnicPro.i18n.t('lang_message_selected_use_copy_to_copy_the_text', 'Message selected. Use Copy to copy the text.')); };
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(row.subject + '\n\n' + row.body).then(function () { PosnicPro.alert('success', PosnicPro.i18n.t('lang_message_copied', 'Message copied.')); }).catch(fallback);
                    else fallback();
                }).appendTo(details);
            });
            if (!response.data.length) target.text(PosnicPro.i18n.t('lang_no_saved_supplier_message_drafts_in_this_o', 'No saved supplier-message drafts in this outlet.'));
        }, function (xhr) { PosnicPro.alert('error', xhr && xhr.responseJSON && xhr.responseJSON.message || 'Could not load supplier-message drafts.'); });
    },
    prepareAction: function (type, campaignPayload) {
        var self = this;
        var payload = { source: type === 'purchase_order' ? 'low_stock' : 'inventory', period: 'today' };
        if (type === 'purchase_order' && campaignPayload && campaignPayload.source === 'demand') payload = { source: 'demand', lookback_days: campaignPayload.lookback_days, coverage_days: campaignPayload.coverage_days };
        if (type === 'campaign') {
            if (!campaignPayload) { $('#ask_campaign_modal').modal('show'); return; }
            payload = campaignPayload;
        }
        if (type === 'sale_draft') {
            if (!campaignPayload) { $('#ask_sale_modal').modal('show'); return; }
            payload = campaignPayload;
        }
        if (type === 'supplier_message') {
            if (!campaignPayload) { $('#ask_supplier_modal').modal('show'); return; }
            payload = campaignPayload;
        }
        PosnicPro.request({ url: 'ask-posnic/actions/draft', method: 'POST', data: JSON.stringify({ type: type, payload: payload }) }, function (response) {
            var draft = response && response.data;
            if (!draft) return PosnicPro.alert('error', response.message || 'Could not prepare the draft.');
            self.reviewDraft(draft);
        });
    },
    reviewDraft: function (draft) {
        var self = this;
        var payload = draft.payload || {};
        var html = '';
        var table = function (items, count) { return '<div class="table-responsive"><table class="table table-sm"><thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th>' + self.esc(count ? PosnicPro.i18n.t('lang_expected_quantity', 'Expected quantity') : PosnicPro.i18n.t('lang_order_quantity', 'Order quantity')) + '</th><th>' + self.esc(count ? PosnicPro.i18n.t('lang_unit_title', 'Unit') : PosnicPro.i18n.t('lang_unit_cost', 'Unit cost')) + '</th></tr></thead><tbody>' + items.map(function (item) { return '<tr><td>' + self.esc(item.item_name) + '</td><td>' + self.esc(count ? item.expected_quantity : item.qty_ordered) + '</td><td>' + self.esc(count ? item.unit : item.unit_cost) + '</td></tr>'; }).join('') + '</tbody></table></div>'; };
        if (draft.type === 'purchase_order') {
            html = (payload.orders || []).map(function (order) { return '<h6>' + self.esc(order.supplier_name) + '</h6>' + table(order.items || [], false); }).join('');
            if (payload.plan) html = '<p>Based on ' + self.esc(payload.plan.lookback_days) + ' complete days of sales, covering ' + self.esc(payload.plan.coverage_days) + ' days. Suggested quantities subtract current stock and open-order quantities. Review supplier lead times and pack sizes. The plan considers up to ' + self.esc(payload.planned_count) + ' of ' + self.esc(payload.eligible_count) + ' items needing stock.</p>' + html;
            else if (payload.notes) html = '<p>' + self.esc(payload.notes) + '</p>' + html;
            if (draft.recovery) html = '<p>Saved orders: ' + self.esc(draft.recovery.saved.length) + '. Remaining orders to review: ' + self.esc(draft.recovery.remaining) + '. Confirm only after reviewing the remaining orders below.</p>' + html;
            if ((payload.skipped_without_supplier || []).length) html += '<p>Missing supplier: ' + self.esc(payload.skipped_without_supplier.join(', ')) + '</p>';
        } else if (draft.type === 'stock_count') html = table(payload.items || [], true);
        else if (draft.type === 'sale_draft') html = '<h6>Sales draft for ' + self.esc(payload.customer_name) + '</h6><p><lang class="lang_saved_as_a_draft_quotation_review_and_conv">Saved as a draft quotation. Review and convert to a sale from Quotations.</lang></p><div class="table-responsive"><table class="table table-sm"><thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th><lang class="lang_quantity">Quantity</lang></th><th><lang class="lang_unit_price">Unit price</lang></th><th><lang class="lang_module_tax">Tax</lang></th></tr></thead><tbody>' + (payload.lines || []).map(function (line) { return '<tr><td>' + self.esc(line.item_name) + '</td><td>' + self.esc(line.qty) + '</td><td>' + self.esc(Number(line.unit_price).toFixed(2)) + '</td><td>' + self.esc(line.tax_value + '% ' + line.tax_type) + '</td></tr>'; }).join('') + '</tbody></table></div><p><strong>Total: ' + self.esc(Number(payload.total).toFixed(2)) + '</strong> · Tax: ' + self.esc(Number(payload.tax_total).toFixed(2)) + '</p><p class="text-muted"><lang class="lang_no_payment_or_stock_change_catalog_changes">No payment or stock change. Catalog changes require another review.</lang></p>';
        else if (draft.type === 'supplier_message') html = '<h6>' + self.esc(payload.subject) + '</h6><p>Supplier: ' + self.esc(payload.supplier_name) + '</p><p style="white-space:pre-wrap">' + self.esc(payload.body) + '</p><p class="text-muted"><lang class="lang_confirmation_saves_this_draft_for_copying">Confirmation saves this draft for copying from Ask Posnic.</lang></p>';
        else html = '<h6>' + self.esc(payload.name) + '</h6><p>Channel: ' + self.esc(payload.channel) + ' · Audience: opted-in customers</p><p style="white-space:pre-wrap">' + self.esc(payload.message) + '</p>';
        $('#ask_draft_content').html(html);
        $('#ask_draft_confirm').prop('disabled', false).off('click').on('click', function () {
            $(this).prop('disabled', true);
            PosnicPro.request({ url: 'ask-posnic/actions/confirm', method: 'POST', data: JSON.stringify({ token: draft.token }) }, function (response) {
                $('#ask_draft_modal').modal('hide');
                if (response && response.type === 'success') {
                    self.add('answer', draft.type === 'supplier_message' ? PosnicPro.i18n.t('lang_supplier_message_saved_open_my_supplier_me', 'Supplier message saved. Open My supplier-message drafts to copy it.') : PosnicPro.i18n.t('lang_draft_created_open_the_source_page_to_cont', 'Draft created. Open the source page to continue.'), { link: self.actionLink(draft.type), source: 'Confirmed action', metrics: response.data && response.data.output && response.data.output.quotation ? [{ label: PosnicPro.i18n.t('lang_draft_quotation', 'Draft quotation'), value: response.data.output.quotation.quote_id }] : [] });
                    if (draft.type === 'supplier_message') self.loadSupplierMessages();
                }
                else self.checkActionOutcome(draft, response.message);
            }, function (xhr) { $('#ask_draft_modal').modal('hide'); self.checkActionOutcome(draft, xhr && xhr.responseJSON && xhr.responseJSON.message); });
        });
        var modal = $('#ask_draft_modal');
        if (!modal.data('ask-events')) modal.data('ask-events', true)
            .on('hide.bs.modal', function () { modal.data('ask-closing', true); })
            .on('hidden.bs.modal', function () { modal.data('ask-closing', false); });
        // Recovery can return while the previous review is still fading out.
        // Wait for both the modal and its backdrop to finish closing.
        if (modal.data('ask-closing')) modal.one('hidden.bs.modal', function () { modal.modal('show'); });
        else modal.modal('show');
    },
    checkActionOutcome: function (draft, failureMessage) {
        var self = this;
        var link = self.actionLink(draft.type);
        PosnicPro.request({ url: 'ask-posnic/actions/' + encodeURIComponent(draft.id), method: 'GET' }, function (response) {
            var result = response && response.data;
            if (!result) return PosnicPro.alert('error', PosnicPro.i18n.t('lang_the_outcome_could_not_be_checked_open_the', 'The outcome could not be checked. Open the source page before preparing another draft.'));
            var message = result.status === 'completed' ? 'The draft was saved. Open the source page to continue.' : result.status === 'partial' ? result.saved.length + ' of ' + result.expected + ' drafts were saved before the interruption. Review those records before preparing the remaining work.' : 'The action has not been confirmed as saved. ' + (failureMessage || 'Check the source page before preparing another draft.');
            self.add('answer', message, { link: link, source: 'Saved action status', metrics: (result.saved || []).map(function (row) { return { label: PosnicPro.i18n.t('lang_saved_draft', 'Saved draft'), value: row.po_id || row.id }; }) });
            if (result.resumable) $('<button type="button" class="btn btn-sm btn-outline-primary mb-3"><lang class="lang_review_remaining_work">Review remaining work</lang></button>').on('click', function () {
                var button = $(this).prop('disabled', true);
                PosnicPro.request({ url: 'ask-posnic/actions/' + encodeURIComponent(draft.id) + '/resume', method: 'POST', data: '{}' }, function (review) {
                    button.prop('disabled', false);
                    if (review && review.data) self.reviewDraft(review.data);
                    else PosnicPro.alert('error', review && review.message || 'Could not prepare recovery review.');
                }, function (xhr) { button.prop('disabled', false); PosnicPro.alert('error', xhr && xhr.responseJSON && xhr.responseJSON.message || 'Could not prepare recovery review.'); });
            }).appendTo('#ask_posnic_thread');
        }, function () { self.add('answer', 'The outcome could not be checked. Open the source page before preparing another draft.', { link: link, source: 'Action needs review' }); });
    },
    bind: function () {
        var self = this;
        if ($('#ask_posnic_form').data('bound')) return;
        $('#ask_posnic_form').data('bound', true).on('submit', function (event) {
            event.preventDefault();
            var question = $('#ask_posnic_question').val().trim();
            if (!question) return;
            $('#ask_posnic_question').val('');
            self.ask(question);
        });
        $('#ask_posnic_suggestions').on('click', 'button', function () { self.ask($(this).data('question')); });
        $('#ask_new_conversation').on('click', function () { if (!self.asking) self.resetConversation(); });
        $('#ask_posnic_question').on('keydown', function (event) {
            if (event.key === 'Enter' && !event.shiftKey && !(event.originalEvent && event.originalEvent.isComposing)) { event.preventDefault(); $('#ask_posnic_form').trigger('submit'); }
        });
        $('[data-ask-tab]').on('click', function () { self.settingsTab($(this).attr('data-ask-tab')); }).on('keydown', function (event) {
            var tabs = $('[data-ask-tab]'), index = tabs.index(this);
            if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(event.key) === -1) return;
            event.preventDefault();
            index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            self.settingsTab(tabs.eq(index).attr('data-ask-tab'), true);
        });
        $('#ask_close_history').on('click', function () { $('#ask_history_panel').prop('hidden', true); $('#ask_load_history').attr('aria-expanded', 'false').trigger('focus'); });
        $('#ask_load_supplier_messages').on('click', function () { self.loadSupplierMessages(); });
        $('#ask_supplier_form').on('submit', function (event) {
            event.preventDefault();
            var payload = { purchase_order: $('#ask_supplier_po').val(), note: $('#ask_supplier_note').val() };
            $('#ask_supplier_modal').one('hidden.bs.modal', function () { self.prepareAction('supplier_message', payload); }).modal('hide');
        });
        $('#ask_load_history').on('click', function () {
            if (self.asking) return;
            var open = $('#ask_history_panel').prop('hidden');
            $('#ask_history_panel').prop('hidden', !open);
            $('#ask_load_history').attr('aria-expanded', String(open));
            if (!open) return;
            PosnicPro.get('ask-posnic/history', function (response) {
                var rows = response && response.data || [];
                $('#ask_history_list').empty();
                rows.forEach(function (row) {
                    var first = (row.messages || []).find(function (message) { return message.role === 'user'; });
                    $('<button type="button" class="btn btn-sm btn-outline-secondary mr-2 mb-2">').text(first && first.payload.question || 'Conversation').on('click', function () {
                        if (self.asking) return;
                        self.conversationId = row._id;
                        $('#ask_posnic_thread').empty();
                        (row.messages || []).forEach(function (message) { self.add(message.role === 'user' ? 'user' : 'answer', message.role === 'user' ? message.payload.question : message.payload.answer, message.role === 'user' ? null : message.payload); });
                        $('#ask_close_history').trigger('click');
                    }).appendTo('#ask_history_list');
                });
                if (!rows.length) $('#ask_history_list').text(PosnicPro.i18n.t('lang_no_stored_conversations_in_this_outlet', 'No stored conversations in this outlet.'));
            });
        });
        $('#ask_posnic_thread').on('click', '#ask_posnic_prepare_po', function () { self.preparePurchaseOrder(); });
        $('#ask_posnic_thread').on('click', '.ask-posnic-draft-action', function () { var button = $(this); self.prepareAction(button.data('action'), button.data('source') === 'demand' ? { source: 'demand', lookback_days: button.data('lookback-days'), coverage_days: button.data('coverage-days') } : undefined); });
        $('#ask_campaign_form').on('submit', function (event) {
            event.preventDefault();
            $('#ask_campaign_modal').modal('hide');
            self.prepareAction('campaign', { name: $('#ask_campaign_name').val(), message: $('#ask_campaign_message').val(), channel: $('#ask_campaign_channel').val() });
        });
        $('#ask_sale_form').on('submit', function (event) {
            event.preventDefault();
            $('#ask_sale_modal').modal('hide');
            self.prepareAction('sale_draft', { customer_name: $('#ask_sale_customer').val(), lines_text: $('#ask_sale_lines').val() });
        });
        $('#ask_posnic_thread').on('click', '.ask-citation', function () {
            var button = $(this);
            var request = self.sourceRequest = (self.sourceRequest || 0) + 1;
            $('#ask_source_publish').remove();
            var query = '?revision=' + encodeURIComponent(button.attr('data-revision')) + '&chunk=' + encodeURIComponent(button.attr('data-chunk'));
            PosnicPro.get('ask-posnic/documents/' + encodeURIComponent(button.data('id')) + query, function (response) {
                if (request !== self.sourceRequest) return;
                if (!response || !response.data) return PosnicPro.alert('error', response && response.message || 'Source is no longer available.');
                $('#ask_source_title').text(response.data.title + ' · ' + response.data.revision);
                $('#ask_source_content').text(response.data.sections && response.data.sections.length ? response.data.sections.map(function (section) { return 'PDF · ' + section.page + '\n\n' + section.text; }).join('\n\n────────\n\n') : response.data.content);
                $('#ask_source_modal').modal('show');
            });
        });
        $('#ask_posnic_thread').on('click', '.ask-feedback', function () {
            var button = $(this);
            PosnicPro.request({ url: 'ask-posnic/feedback', method: 'POST', data: JSON.stringify({ conversation_id: self.conversationId, intent: button.data('intent'), rating: button.data('rating') }) }, function (response) {
                if (response && response.type === 'success') button.closest('.ask-posnic-feedback').text(PosnicPro.i18n.t('lang_feedback_saved', 'Feedback saved'));
            });
        });
        $('#ask_posnic_document_form').on('submit', function (event) {
            event.preventDefault();
            PosnicPro.request({ url: 'ask-posnic/documents', method: 'POST', data: JSON.stringify({ title: $('#ask_doc_title').val(), kind: $('#ask_doc_kind').val(), content: $('#ask_doc_content').val() }) }, function (response) {
                if (response && response.type === 'success') { $('#ask_posnic_document_form')[0].reset(); $('#ask_source_editor').prop('open', false); self.loadDocuments(); PosnicPro.alert('success', PosnicPro.i18n.t('lang_knowledge_draft_saved', 'Knowledge draft saved.')); }
                else PosnicPro.alert('error', response.message || 'Could not save the document.');
            });
        });
        $('#ask_posnic_documents,#ask_posnic_shared_documents').on('click', '.ask-doc-review', function () {
            var id = $(this).attr('data-id');
            var request = self.sourceRequest = (self.sourceRequest || 0) + 1;
            $('#ask_source_publish').remove();
            PosnicPro.get('ask-posnic/documents/' + encodeURIComponent(id) + '?review=1', function (response) {
                if (request !== self.sourceRequest) return;
                if (!response || !response.data) return PosnicPro.alert('error', response && response.message || 'Source is no longer available.');
                var doc = response.data, status = doc.status === 'published' ? 'retired' : 'published';
                $('#ask_source_title').text(doc.title + ' · ' + doc.status + ' · ' + doc.revision);
                $('#ask_source_content').text(doc.content);
                $('<button type="button" id="ask_source_publish" class="btn btn-primary m-3">').text(status === 'published' ? PosnicPro.i18n.t('lang_publish_source', 'Publish source') : PosnicPro.i18n.t('lang_retire_source', 'Retire source')).on('click', function () {
                    var button = $(this).prop('disabled', true);
                    PosnicPro.request({ url: 'ask-posnic/documents/' + encodeURIComponent(id) + '/status', method: 'PATCH', data: JSON.stringify({ status: status }) }, function (result) {
                        button.prop('disabled', false);
                        if (result && result.type === 'success') { $('#ask_source_modal').modal('hide'); self.loadDocuments(); }
                        else PosnicPro.alert('error', result && result.message || 'Could not update the document.');
                    }, function () { button.prop('disabled', false); PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_update_the_document', 'Could not update the document.')); });
                }).appendTo('#ask_source_modal .modal-content');
                $('#ask_source_modal').modal('show');
            });
        });
        $('#ask_source_modal').on('hidden.bs.modal', function () { self.sourceRequest = (self.sourceRequest || 0) + 1; $('#ask_source_publish').remove(); });
        $('#ask_doc_upload').on('click', function () {
            var file = $('#ask_doc_file')[0] && $('#ask_doc_file')[0].files[0];
            if (!file) return PosnicPro.alert('error', PosnicPro.i18n.t('lang_choose_a_pdf_markdown_or_text_file', 'Choose a PDF, Markdown, or text file.'));
            var form = new FormData();
            form.append('file', file);
            form.append('title', file.name.replace(/\.[^.]+$/, ''));
            PosnicPro.request({ url: 'ask-posnic/documents/upload', method: 'POST', data: form, contentType: false, processData: false }, function (response) {
                if (response && response.type === 'success') { $('#ask_doc_file').val(''); $('#ask_source_editor').prop('open', false); self.loadDocuments(); PosnicPro.alert('success', response.message); }
                else PosnicPro.alert('error', response.message || 'Could not extract the document.');
            });
        });
        $('#ask_bundle_import').on('click', function () {
            var file = $('#ask_bundle_file')[0] && $('#ask_bundle_file')[0].files[0];
            if (!file) return PosnicPro.alert('error', PosnicPro.i18n.t('lang_choose_the_exported_json_bundle', 'Choose the exported JSON bundle.'));
            var reader = new FileReader();
            reader.onload = function () {
                var bundle;
                try { bundle = JSON.parse(reader.result); } catch (_error) { return PosnicPro.alert('error', PosnicPro.i18n.t('lang_that_file_is_not_valid_json', 'That file is not valid JSON.')); }
                PosnicPro.request({ url: 'ask-posnic/documents/import-bundle', method: 'POST', data: JSON.stringify(bundle) }, function (response) {
                    if (response && response.type === 'success') { $('#ask_bundle_file').val(''); self.loadDocuments(); PosnicPro.alert('success', response.data.imported + ' published sources imported.'); }
                    else PosnicPro.alert('error', response.message || 'Could not import the knowledge bundle.');
                });
            };
            reader.readAsText(file);
        });
        $('#ask_posnic_clear_history,#ask_delete_history').on('click', function () {
            if (!window.confirm(PosnicPro.i18n.t('lang_ask_delete_personal_confirm', 'Delete your Ask Posnic conversations and feedback for this outlet?'))) return;
            PosnicPro.request({ url: 'ask-posnic/history', method: 'DELETE' }, function (response) {
                if (response && response.type === 'success') { self.resetConversation(); PosnicPro.alert('success', PosnicPro.i18n.t('lang_ask_personal_deleted', 'Conversations and feedback deleted.')); }
            });
        });
        $('#ask_posnic_schedule_form').on('submit', function (event) {
            event.preventDefault();
            PosnicPro.request({ url: 'ask-posnic/schedules', method: 'POST', data: JSON.stringify({ report: $('#ask_schedule_report').val(), frequency: $('#ask_schedule_frequency').val(), hour: Number($('#ask_schedule_hour').val()), weekday: Number($('#ask_schedule_weekday').val()), timezone: $('#ask_schedule_timezone').val(), channel: $('#ask_schedule_channel').val(), destination: $('#ask_schedule_destination').val() }) }, function (response) {
                if (response && response.type === 'success') { $('#ask_schedule_editor').prop('open', false); self.loadSchedules(); PosnicPro.alert('success', response.message); }
                else PosnicPro.alert('error', response.message || 'Could not save the schedule.');
            });
        });
        $('#ask_posnic_preferences_form').on('submit', function (event) {
            event.preventDefault();
            PosnicPro.request({ url: 'ask-posnic/preferences', method: 'PUT', data: JSON.stringify({ own_key_semantic: $('#ask_pref_own_semantic').is(':checked'), own_key_semantic_budget: Number($('#ask_pref_embedding_budget').val()), help_enabled: $('#ask_pref_help').is(':checked'), insights_enabled: $('#ask_pref_insights').is(':checked'), actions_enabled: $('#ask_pref_actions').is(':checked'), store_conversations: $('#ask_pref_history').is(':checked'), retention_days: Number($('#ask_pref_retention').val()), default_period: $('#ask_pref_period').val(), response_language: $('#ask_pref_language').val(), help_instructions: $('#ask_help_instructions').val(), roles: { help: $('#ask_pref_help_roles').val() || [], insights: $('#ask_pref_insight_roles').val() || [], actions: $('#ask_pref_action_roles').val() || [] }, allowed_actions: $('.ask-allowed-action:checked').map(function () { return this.value; }).get() }) }, function (response) {
                if (response && response.type === 'success') { self.loadStatus(); PosnicPro.alert('success', response.message); }
                else PosnicPro.alert('error', response.message || 'Could not save Ask Posnic settings.');
            });
        });
        $('#ask_posnic_schedules').on('click', '.ask-schedule-delete', function () {
            PosnicPro.request({ url: 'ask-posnic/schedules/' + encodeURIComponent($(this).data('id')), method: 'DELETE' }, function (response) { if (response && response.type === 'success') self.loadSchedules(); });
        });
        $('#ask_posnic_schedules').on('click', '.ask-schedule-resume', function () {
            PosnicPro.request({ url: 'ask-posnic/schedules/' + encodeURIComponent($(this).data('id')) + '/resume', method: 'POST', data: '{}' }, function (response) {
                if (response && response.type === 'success') self.loadSchedules();
                else PosnicPro.alert('error', response && response.message || 'Could not resume the schedule.');
            });
        });
        $('#ask_posnic_recovery').on('click', '.ask-recovery-action', function () { self.checkActionOutcome({ id: $(this).data('id'), type: $(this).data('type') }); });
    }
};
