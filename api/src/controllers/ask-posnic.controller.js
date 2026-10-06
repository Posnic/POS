'use strict';

const dashboardController = require('./dashboard.controller');
const sessionFilterUtil = require('../utils/session-filter.util');
const assistant = require('../services/ask-posnic.service');
const conversation = require('../services/ask-posnic-conversation');
const platform = require('../services/ask-posnic-platform.service');
const ai = require('../services/ai.service');
const PurchaseOrderRepository = require('../repositories/purchase-order.repository');
const InventoryCountRepository = require('../repositories/inventory-count.repository');
const InvoiceRepository = require('../repositories/invoice.repository');
const knowledgeDocument = require('../services/knowledge-document.service');
const managedCredits = require('../services/managed-ai-credits.service');
const schedules = require('../services/ask-posnic-schedule.service');
const CampaignService = require('../services/campaign.service');
const scheduleRunner = require('../services/ask-posnic-runner.service');
const outletInsights = require('../services/ask-posnic-outlet-insights.service');
const reorder = require('../services/ask-posnic-reorder.service');
const { excerptAnswer } = require('../services/ask-posnic-retrieval');

function requireReorderAccess(req, preferences) {
  if (
    !dashboardController.canSeeFinancials(req.user) ||
    req.user?.access?.sales?.session_filter === true ||
    !platform.capabilityAllowed(preferences, 'insights', req.user)
  )
    throw Object.assign(
      new Error(
        'Reorder planning requires Insights and financial access without a single-session restriction.'
      ),
      { statusCode: 403 }
    );
}

function isOwner(req) {
  return [req.user?.role, req.user?.usertype].some((role) =>
    ['owner', 'admin', 'super_admin'].includes(String(role || '').toLowerCase())
  );
}

function canPrepare(req, type) {
  if (type === 'insights') return dashboardController.canSeeFinancials(req.user);
  if (isOwner(req)) return true;
  if (['purchase_order', 'supplier_message'].includes(type))
    return req.user?.access?.receiving?.write === true;
  if (type === 'stock_count') return req.user?.access?.item?.write === true;
  if (type === 'campaign') return req.user?.access?.branch?.write === true;
  if (['sale_draft', 'sale_checkout'].includes(type))
    return (
      req.user?.access?.sale?.write !== false &&
      req.user?.access?.sales?.write !== false &&
      (req.user?.access?.sale?.write === true || req.user?.access?.sales?.write === true)
    );
  return false;
}

function aiContext(req) {
  const value = platform.scope(req);
  return { branchId: value.branch_id, licenseId: value.license };
}

function scheduleContext(req) {
  const value = platform.scope(req);
  return {
    licenseId: value.license,
    branchId: value.branch_id,
    userId: value.user_id,
    timezone: req.user?.settings?.time_zone || 'UTC',
  };
}

class AskPosnicController {
  async recoveryStatus(req, res) {
    if (!isOwner(req))
      return res.status(403).json({ type: 'error', message: 'Owner access is required.' });
    const data = await require('../services/ask-posnic-recovery.service').inspect(
      await require('../models/base.model').getDb(),
      aiContext(req)
    );
    // Shop owners see actionable summaries, never server process identities,
    // claim tokens, prompts, provider keys or another user's draft payload.
    const rows = [
      ...data.actions.map((row) => ({
        id: String(row._id),
        type: 'Action draft',
        label: row.type.replace(/_/g, ' '),
        action_type: row.type,
        can_review: row.user_id === platform.scope(req).user_id,
        state: row.status,
      })),
      ...data.documents.map((row) => ({
        id: String(row._id),
        type: 'Knowledge indexing',
        label: row.title,
        state: [row.semantic?.state, row.own_semantic?.state]
          .filter((state) => ['processing', 'needs_review'].includes(state))
          .join(', '),
      })),
      ...data.schedules.map((row) => ({
        id: String(row._id),
        type: 'Scheduled report',
        label: row.report,
        state: row.last_status || 'running',
      })),
      ...data.holds.map((row) => ({
        id: row.id,
        type: 'AI usage reservation',
        label: row.model,
        state: row.state,
      })),
    ];
    return res.json({
      type: 'success',
      data: { rows, limit_per_category: data.limit_per_category },
    });
  }

  async resumeSchedule(req, res) {
    if (!isOwner(req))
      return res.status(403).json({ type: 'error', message: 'Owner access is required.' });
    const context = scheduleContext(req);
    const row = (await schedules.list(context)).find(
      (entry) => String(entry._id) === req.params.id
    );
    if (!row || row.enabled || row.last_status !== 'reviewed' || row.running_at)
      return res.status(400).json({
        type: 'error',
        message: 'Operator review must finish before resuming this schedule.',
      });
    const saved = await schedules.save(context, { ...row, id: req.params.id, enabled: true });
    return res.json({
      type: 'success',
      message: 'Future scheduled deliveries resumed.',
      data: saved,
    });
  }

  async status(req, res) {
    const [configuration, usage, preferences, enabled] = await Promise.all([
      ai.settingsFor(aiContext(req)),
      platform.usage(req),
      platform.getPreferences(req),
      require('../services/ask-posnic-feature').enabled(aiContext(req)),
    ]);
    const aiMode = ai.modeFor(configuration);
    let billingUnavailable = false;
    const managed =
      aiMode === 'managed'
        ? await managedCredits.status(aiContext(req)).catch(() => {
            billingUnavailable = true;
            return null;
          })
        : null;
    const ownSearch =
      isOwner(req) && aiMode === 'own_key' && preferences.own_key_semantic === true
        ? await require('../services/ask-posnic-own-key-embedding.service').status(
            aiContext(req),
            preferences.own_key_semantic_budget
          )
        : null;
    return res.json({
      type: 'success',
      message: enabled ? 'Ask Posnic is available' : 'Ask Posnic is off',
      data: {
        enabled,
        mode: aiMode === 'managed' ? 'managed' : aiMode === 'own_key' ? 'own_key' : 'direct',
        capabilities: [
          'sales',
          'profit',
          'tax',
          'payment_mix',
          'top_items',
          'slow_items',
          'no_sale_items',
          'category_performance',
          'customer_segments',
          'promotion_performance',
          'reorder_suggestions',
          'outlet_comparison',
          'comparison',
          'hourly_sales',
          'daily_sales',
          'receivables',
          'low_stock',
          'product_help',
          'knowledge_search',
          'action_drafts',
        ],
        actions: 'confirmed_drafts',
        usage,
        managed,
        own_key_search: ownSearch,
        billing_unavailable: billingUnavailable,
        billing_url:
          isOwner(req) && process.env.ASK_POSNIC_BILLING_URL
            ? 'https://www.posnic.com/account#managed-ai'
            : null,
        admin: isOwner(req),
        preferences,
        feature_catalog: require('../services/ask-posnic-feature-catalog').catalog(
          preferences,
          req.user,
          (type) => canPrepare(req, type),
          platform.capabilityAllowed
        ),
        can_supplier_messages:
          platform.capabilityAllowed(preferences, 'actions', req.user) &&
          preferences.allowed_actions.includes('supplier_message') &&
          canPrepare(req, 'supplier_message'),
        scope: platform.scope(req),
      },
    });
  }

  async ask(req, res) {
    try {
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      if (!question || question.length > 1000) {
        return res
          .status(400)
          .json({ type: 'error', message: 'Enter a question up to 1,000 characters.', data: null });
      }

      const preferences = await platform.getPreferences(req);
      const followup = conversation.needsContext(question)
        ? conversation.resolve(
            question,
            await platform.previousAnswer(req, req.body?.conversation_id)
          )
        : {};
      const intent = followup.intent || assistant.intentFrom(question);
      const period =
        followup.period ||
        assistant.periodFrom(question, req.body?.period, preferences.default_period);
      const capability = intent.endsWith('_action')
        ? 'actions'
        : ['receipt_help', 'offline_help', 'refund_help', 'features_help', 'unknown'].includes(
              intent
            )
          ? 'help'
          : 'insights';
      if (!platform.capabilityAllowed(preferences, capability, req.user))
        return res.status(403).json({
          type: 'error',
          message: `Ask Posnic ${capability} are not enabled for your role.`,
          data: null,
        });
      const conversationId = await platform.saveMessage(req, req.body?.conversation_id, 'user', {
        question,
      });
      if (
        followup.clarification ||
        /^\s*(?:hi|hello|hey|good morning|good evening)[!.?\s]*$/i.test(question)
      ) {
        const response = followup.clarification
          ? { answer: followup.clarification, suggestions: followup.suggestions }
          : conversation.fallback(question);
        const data = {
          ...response,
          intent: 'clarification',
          mode: 'direct',
          conversation_id: conversationId,
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        return res.json({ type: 'success', message: 'Next step', data });
      }
      const help = assistant.answerHelp(intent);
      if (intent === 'features_help') {
        const rows = require('../services/ask-posnic-feature-catalog').catalog(
          preferences,
          req.user,
          (type) => canPrepare(req, type),
          platform.capabilityAllowed
        );
        const groups = [...new Set(rows.map((row) => row.group))];
        const data = {
          intent,
          conversation_id: conversationId,
          mode: 'direct',
          source: 'Posnic feature catalog',
          answer:
            groups
              .map(
                (group) =>
                  group +
                  ': ' +
                  rows
                    .filter((row) => row.group === group)
                    .map((row) => row.name)
                    .join(', ')
              )
              .join('\n\n') +
            '\n\nAvailable AI actions: ' +
            rows
              .filter((row) => row.mode === 'action' && row.enabled)
              .map((row) => row.name)
              .join(', ') +
            '. Other operations use their module pages. Normal Posnic permissions and enabled features apply.',
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        return res.json({ type: 'success', message: 'Posnic capabilities', data });
      }
      if (
        [
          'purchase_order_action',
          'stock_count_action',
          'campaign_action',
          'sale_draft_action',
          'sale_checkout_action',
          'supplier_message_action',
        ].includes(intent)
      ) {
        const actionType = intent.replace('_action', '');
        if (!preferences.allowed_actions.includes(actionType) || !canPrepare(req, actionType))
          return res.status(403).json({
            type: 'error',
            message:
              'This action is not enabled for your account. Ask an owner to review Ask Posnic Access & actions and your normal module permissions.',
            data: null,
          });
        const descriptions = {
          purchase_order:
            'I can prepare purchase-order drafts from low-stock items, grouped by supplier.',
          stock_count: 'I can prepare a stock-count worksheet from the current inventory.',
          campaign:
            'I can prepare a customer campaign draft. You will review its channel, audience, and message before anything is sent.',
          sale_draft:
            'I can prepare a sales draft using catalog prices and tax. After your review it is saved as a draft quotation, ready to open and convert in the normal sale workflow. No stock or payment changes at this step.',
          sale_checkout:
            'I can prepare that basket from this outlet’s catalog. Review the items, then choose the payment method in checkout to complete the sale and print its receipt.',
          supplier_message:
            'Choose a purchase order to prepare a supplier message about availability or remaining delivery quantities. Review and confirm to save the text in Ask Posnic. You can then copy it into your normal messaging workflow.',
        };
        const labels = {
          purchase_order: 'Review purchase order drafts',
          stock_count: 'Review stock count draft',
          campaign: 'Prepare campaign draft',
          sale_draft: 'Prepare sales draft',
          sale_checkout: 'Review sale and checkout',
          supplier_message: 'Prepare supplier message',
        };
        const data = {
          intent,
          period,
          answer: descriptions[actionType],
          metrics: [],
          mode: 'direct',
          conversation_id: conversationId,
          action: { type: actionType, label: labels[actionType] },
          source:
            actionType === 'purchase_order'
              ? 'Live inventory and suppliers'
              : actionType === 'stock_count'
                ? 'Live inventory'
                : actionType === 'sale_draft'
                  ? 'Catalog and quotations'
                  : actionType === 'supplier_message'
                    ? 'Purchase orders'
                    : 'Campaign drafts',
        };
        if (actionType === 'sale_checkout') {
          data.action.lines_text = require('../services/ask-posnic-sale-request').linesFromQuestion(
            question
          );
          data.source = 'Current outlet catalog and checkout';
        }
        await platform.saveMessage(req, conversationId, 'assistant', data);
        return res.json({ type: 'success', message: 'Action available', data });
      }
      if (intent === 'unknown' || help) {
        await require('../services/ask-posnic-knowledge-sync.service')
          .sync(req)
          .catch(() => console.warn('[ask-posnic] published knowledge sync unavailable'));
        let matches = await platform.retrieve(req, question);
        let answer;
        let reason;
        let mode = 'retrieval';
        if (matches[0]?.exact) {
          answer = excerptAnswer(matches);
          mode = 'exact_faq';
        } else if (matches.length && (await ai.available(aiContext(req)))) {
          const generated = await require('../services/ask-posnic-grounding.service').answer(
            question,
            matches,
            preferences,
            aiContext(req)
          );
          reason = generated.reason;
          answer = generated.mode === 'refusal' ? null : generated.text;
          mode = generated.mode || 'retrieval';
        }
        const current = await platform.currentMatches(req, matches);
        if (current.length !== matches.length) {
          answer = null;
          mode = 'retrieval';
        }
        matches = current;
        // An explicitly irrelevant source must not become an answer just because
        // retrieval found a keyword match. Keep the evidence checks intact.
        if (reason === 'unsupported') matches = [];
        if (!answer && matches.length) answer = excerptAnswer(matches);
        if (!answer && help) {
          answer = help.answer;
          mode = 'direct';
        }
        const clarification = !answer ? conversation.fallback(question, reason) : null;
        if (clarification) {
          answer = clarification.answer;
          mode = 'clarification';
        }
        const data = {
          intent: 'help',
          period,
          answer,
          ...(clarification ? { suggestions: clarification.suggestions } : {}),
          metrics: [],
          mode,
          conversation_id: conversationId,
          verified: Boolean(matches.length || help),
          source: matches.length ? matches[0].title : help?.source || 'Ask Posnic capabilities',
          ...(!matches.length && help?.link ? { link: help.link } : {}),
          citations: matches.map((match) => ({
            document_id: match.document_id,
            title: match.title,
            revision: match.revision,
            chunk: match.chunk,
            ...(match.pages?.length ? { pages: match.pages } : {}),
          })),
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', {
          intent: 'help',
          mode,
          citations: data.citations,
          verified: data.verified,
        });
        return res.json({ type: 'success', message: 'Answer', data });
      }

      if (intent === 'receivables') {
        if (!dashboardController.canSeeFinancials(req.user))
          return res
            .status(403)
            .json({ type: 'error', message: 'Your role cannot view receivables.', data: null });
        const model = await dashboardController.ensureContext(req);
        const result = await new InvoiceRepository().summary({
          branchId: model.branchId,
          licenseId: model.licenseId,
        });
        if (!result.status) throw new Error(result.message);
        const summary = result.data;
        const data = {
          intent,
          period,
          answer: `${summary.owed_count} invoice${summary.owed_count === 1 ? '' : 's'} have ${Number(summary.owed_total).toFixed(2)} outstanding. ${summary.overdue_count} are overdue.`,
          metrics: [
            { label: 'Outstanding', value: Number(summary.owed_total).toFixed(2) },
            { label: 'Overdue', value: Number(summary.overdue_total).toFixed(2) },
            { label: 'Invoices', value: summary.owed_count },
          ],
          source: 'Invoice receivables',
          link: '#/invoices',
          mode: 'direct',
          conversation_id: conversationId,
          scope: {
            branch_id: String(model.branchId || ''),
            outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
            as_of: new Date().toISOString(),
          },
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', { intent, report: data.source });
        return res.json({ type: 'success', message: 'Answer', data });
      }

      const model = await dashboardController.ensureContext(req);
      if (intent === 'reorder_suggestions') {
        requireReorderAccess(req, preferences);
        const result = await reorder.read(model, reorder.options(req.body?.planning, question));
        const data = {
          intent,
          period: 'reorder_planning',
          ...reorder.answer(result),
          mode: 'direct',
          conversation_id: conversationId,
          scope: {
            branch_id: String(model.branchId),
            outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
            ...result.plan,
          },
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', { intent, plan: result.plan, report: data.source });
        return res.json({ type: 'success', message: 'Answer', data });
      }
      const range = assistant.dateRange(period, model.timeZone);
      if (intent === 'outlet_comparison') {
        const result = await outletInsights.read(req, range, model.timeZone);
        const data = {
          intent,
          period,
          ...outletInsights.answer(result, period),
          mode: 'direct',
          conversation_id: conversationId,
        };
        // Revalidate the entire outlet set before saving or returning money data.
        if (!outletInsights.canReadSaved(data, await outletInsights.historyAccess(req)))
          return res.status(403).json({
            type: 'error',
            message: 'Outlet access changed. Request the comparison again.',
            data: null,
          });
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', {
          intent,
          period,
          report: data.source,
          branch_ids: result.outlets.map((row) => row.branch_id),
        });
        return res.json({ type: 'success', message: 'Answer', data });
      }
      const filtered = await sessionFilterUtil.applySessionFilter(req, range);
      if (new Date(filtered.start_date) > new Date(filtered.end_date))
        return res.status(403).json({
          type: 'error',
          message: 'Your current session does not include that report period.',
          data: null,
        });
      if (intent === 'promotion_performance') {
        if (!dashboardController.canSeeFinancials(req.user))
          return res.status(403).json({
            type: 'error',
            message: 'Your role cannot view promotion totals.',
            data: null,
          });
        const promotions = require('../services/ask-posnic-promotion-insights.service');
        const result = await promotions.read(model, filtered);
        const data = {
          intent,
          period,
          ...promotions.answer(result, period),
          mode: 'direct',
          conversation_id: conversationId,
          scope: {
            branch_id: String(model.branchId),
            outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
            from: new Date(filtered.start_date).toISOString(),
            to: new Date(filtered.end_date).toISOString(),
          },
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', { intent, period, report: data.source });
        return res.json({ type: 'success', message: 'Answer', data });
      }
      if (
        ['slow_items', 'no_sale_items', 'category_performance', 'customer_segments'].includes(
          intent
        )
      ) {
        if (!dashboardController.canSeeFinancials(req.user))
          return res.status(403).json({
            type: 'error',
            message: 'Your role cannot view commerce insights.',
            data: null,
          });
        const insights = require('../services/ask-posnic-commerce-insights.service');
        const result = await insights.read(model, filtered, intent);
        const data = {
          intent,
          period,
          ...insights.answer(result, intent, period),
          mode: 'direct',
          conversation_id: conversationId,
          scope: {
            branch_id: String(model.branchId),
            outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
            from: new Date(filtered.start_date).toISOString(),
            to: new Date(filtered.end_date).toISOString(),
          },
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', { intent, period, report: data.source });
        return res.json({ type: 'success', message: 'Answer', data });
      }
      if (['hourly_sales', 'daily_sales'].includes(intent)) {
        if (!dashboardController.canSeeFinancials(req.user))
          return res.status(403).json({
            type: 'error',
            message: 'Your role cannot view sales trend totals.',
            data: null,
          });
        const trends = require('../services/ask-posnic-trends.service');
        const interval = intent === 'hourly_sales' ? 'hour' : 'day';
        const rows = await trends.read(model, filtered, interval);
        const data = {
          intent,
          period,
          ...trends.answer(rows, interval, period, model.timeZone),
          mode: 'direct',
          conversation_id: conversationId,
          scope: {
            branch_id: String(model.branchId),
            outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
            from: new Date(filtered.start_date).toISOString(),
            to: new Date(filtered.end_date).toISOString(),
            timezone: model.timeZone,
          },
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', { intent, period, report: data.source });
        return res.json({ type: 'success', message: 'Answer', data });
      }
      const result = await model.getOverviewModel(
        { starting_date: filtered.start_date, ending_date: filtered.end_date, filter: period },
        { financials: dashboardController.canSeeFinancials(req.user) }
      );
      if (!result?.status) throw new Error(result?.message || 'Could not load shop data');
      if (intent === 'comparison') {
        const compareProfit = /profit|margin/.test(question.toLowerCase());
        if (compareProfit && !dashboardController.canSeeFinancials(req.user))
          return res
            .status(403)
            .json({ type: 'error', message: 'Your role cannot view profit.', data: null });
        const currentStart = new Date(filtered.start_date);
        const currentEnd = new Date(filtered.end_date);
        const span = currentEnd.getTime() - currentStart.getTime();
        const previousEnd = new Date(currentStart.getTime() - 1);
        const previousStart = new Date(previousEnd.getTime() - span);
        const previous = await model.getOverviewModel(
          { starting_date: previousStart, ending_date: previousEnd, filter: 'comparison' },
          { financials: dashboardController.canSeeFinancials(req.user) }
        );
        if (!previous?.status) throw new Error('Could not load the previous report period.');
        const comparison = assistant.answerComparison(
          result.data,
          previous.data,
          compareProfit ? 'profit' : 'sales'
        );
        const data = {
          intent,
          period,
          ...comparison,
          link: '#/dashboard',
          mode: 'direct',
          conversation_id: conversationId,
          scope: {
            branch_id: String(model.branchId || ''),
            outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
            from: currentStart.toISOString(),
            to: currentEnd.toISOString(),
            previous_from: previousStart.toISOString(),
            previous_to: previousEnd.toISOString(),
          },
        };
        await platform.saveMessage(req, conversationId, 'assistant', data);
        await platform.audit(req, 'question', { intent, period, report: data.source });
        return res.json({ type: 'success', message: 'Answer', data });
      }
      const answer = assistant.answerOverview(intent, result.data, period);
      const data = {
        intent,
        period,
        ...answer,
        mode: 'direct',
        conversation_id: conversationId,
        scope: {
          branch_id: String(model.branchId || ''),
          outlet: req.tenantContext?.branchName || req.user?.branch_name || 'Current outlet',
          from: new Date(filtered.start_date).toISOString(),
          to: new Date(filtered.end_date).toISOString(),
        },
      };
      await platform.saveMessage(req, conversationId, 'assistant', data);
      await platform.audit(req, 'question', { intent, period, report: answer.source });
      return res.json({ type: 'success', message: 'Answer', data });
    } catch (error) {
      console.error('Ask Posnic error:', error);
      if ([400, 403].includes(error.statusCode))
        return res
          .status(error.statusCode)
          .json({ type: 'error', message: error.message, data: null });
      return res
        .status(500)
        .json({ type: 'error', message: 'Ask Posnic could not load the answer.', data: null });
    }
  }

  async documents(req, res) {
    try {
      return res.json({
        type: 'success',
        data: await platform.listDocuments(req, isOwner(req)),
        message: 'Knowledge documents',
      });
    } catch (error) {
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  async document(req, res) {
    const review = req.query?.review === '1' && isOwner(req);
    const preferences = await platform.getPreferences(req);
    if (!review && !platform.capabilityAllowed(preferences, 'help', req.user))
      return res
        .status(403)
        .json({ type: 'error', message: 'Help is not enabled for your role.', data: null });
    const data = await platform.getDocument(req, req.params.id, {
      revision: req.query?.revision,
      chunk: req.query?.chunk,
      review,
    });
    return res.status(data ? 200 : 404).json({
      type: data ? 'success' : 'error',
      message: data
        ? review
          ? 'Source review'
          : 'Published source'
        : 'Source is no longer available.',
      data,
    });
  }

  async addDocument(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    try {
      return res.status(201).json({
        type: 'success',
        data: await platform.saveDocument(req, req.body || {}),
        message: 'Knowledge document saved',
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async uploadDocument(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    try {
      const extracted = await knowledgeDocument.extract(req.file);
      const data = await platform.saveDocument(req, {
        title: req.body?.title || req.file?.originalname,
        revision: req.body?.revision,
        visibility: req.body?.visibility,
        status: 'draft',
        kind: req.body?.kind || extracted.kind,
        content: extracted.content,
        page_map: extracted.page_map,
      });
      return res.status(201).json({
        type: 'success',
        message: 'Document extracted and saved as a draft.',
        data: { ...data, pages: extracted.pages },
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async documentStatus(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    try {
      return res.json({
        type: 'success',
        data: await platform.setDocumentStatus(req, req.params.id, req.body?.status),
        message: 'Document updated',
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async importKnowledgeBundle(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    try {
      return res.json({
        type: 'success',
        data: await platform.importBundle(req, req.body),
        message: 'Published knowledge imported.',
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async history(req, res) {
    const [rows, preferences] = await Promise.all([
      platform.history(req),
      platform.getPreferences(req),
    ]);
    const financials = dashboardController.canSeeFinancials(req.user);
    const hasOutletHistory = rows.some((row) =>
      (row.messages || []).some((message) => message.payload?.intent === 'outlet_comparison')
    );
    const allowedOutlets = hasOutletHistory ? await outletInsights.historyAccess(req) : new Set();
    const data = rows.map((row) => ({
      ...row,
      messages: (row.messages || []).map((message) => {
        if (message.role !== 'assistant') return message;
        const intent = String(message.payload?.intent || '');
        const help = ['help', 'receipt_help', 'offline_help', 'refund_help'].includes(intent);
        const action = intent.endsWith('_action');
        const capability = help ? 'help' : action ? 'actions' : 'insights';
        const allowed =
          platform.capabilityAllowed(preferences, capability, req.user) &&
          (intent !== 'outlet_comparison' ||
            outletInsights.canReadSaved(message.payload, allowedOutlets)) &&
          (intent !== 'reorder_suggestions' || req.user?.access?.sales?.session_filter !== true) &&
          (help || (action ? canPrepare(req, intent.replace(/_action$/, '')) : financials));
        return allowed
          ? message
          : {
              role: message.role,
              at: message.at,
              payload: {
                intent: 'restricted',
                answer: 'This earlier response is unavailable with your current permissions.',
                metrics: [],
                mode: 'direct',
              },
            };
      }),
    }));
    return res.json({ type: 'success', data, message: 'Conversation history' });
  }

  async audit(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    return res.json({
      type: 'success',
      data: await platform.listAudit(req),
      message: 'Ask Posnic audit history',
    });
  }

  async deleteHistory(req, res) {
    await platform.deleteHistory(req);
    return res.json({ type: 'success', data: null, message: 'Conversations and feedback deleted' });
  }

  async feedback(req, res) {
    try {
      return res.status(201).json({
        type: 'success',
        data: await platform.saveFeedback(req, req.body || {}),
        message: 'Thanks for the feedback.',
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async previewSale(req, res) {
    const preferences = await platform.getPreferences(req);
    if (
      !platform.capabilityAllowed(preferences, 'actions', req.user) ||
      !preferences.allowed_actions.includes('sale_checkout') ||
      !canPrepare(req, 'sale_checkout')
    )
      return res.status(403).json({
        type: 'error',
        message: 'Sale checkout is not enabled for your account.',
        data: null,
      });
    try {
      const payload = await require('../services/ask-posnic-sale-draft.service').prepare(
        await dashboardController.ensureContext(req),
        { lines_text: req.body?.lines_text }
      );
      return res.json({
        type: 'success',
        message: 'Review the basket before checkout.',
        data: { payload, scope: platform.scope(req) },
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async createDraft(req, res) {
    const type = req.body?.type;
    const preferences = await platform.getPreferences(req);
    if (!platform.capabilityAllowed(preferences, 'actions', req.user))
      return res.status(403).json({
        type: 'error',
        message: 'Ask Posnic actions are not enabled for your role.',
        data: null,
      });
    if (!preferences.allowed_actions.includes(type))
      return res
        .status(403)
        .json({ type: 'error', message: 'That Ask Posnic action is disabled.', data: null });
    if (!canPrepare(req, type))
      return res
        .status(403)
        .json({ type: 'error', message: 'Your role cannot prepare that action.', data: null });
    let payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    try {
      if (type === 'purchase_order' && !['low_stock', 'demand'].includes(payload.source))
        throw new Error(
          'Purchase-order drafts must be prepared from current inventory or reorder suggestions.'
        );
      if (type === 'purchase_order' && payload.source === 'demand') {
        requireReorderAccess(req, preferences);
        payload = await reorder.prepare(await dashboardController.ensureContext(req), payload);
      }
      if (type === 'purchase_order' && payload.source === 'low_stock') {
        payload = await require('../services/ask-posnic-inventory-drafts.service').lowStock(
          await dashboardController.ensureContext(req)
        );
      } else if (type === 'stock_count') {
        payload = await require('../services/ask-posnic-inventory-drafts.service').stockCount(
          await dashboardController.ensureContext(req)
        );
      } else if (type === 'sale_draft') {
        payload = await require('../services/ask-posnic-sale-draft.service').prepare(
          await dashboardController.ensureContext(req),
          payload
        );
      } else if (type === 'supplier_message') {
        payload = await require('../services/ask-posnic-supplier-message.service').prepare(
          await dashboardController.ensureContext(req),
          payload
        );
      } else if (type === 'campaign') {
        payload = {
          name: String(payload.name || '')
            .trim()
            .slice(0, 120),
          channel: payload.channel === 'sms' ? 'sms' : 'whatsapp',
          message: String(payload.message || '')
            .trim()
            .slice(0, 1000),
          segment: { type: 'all' },
        };
        if (!payload.name || !payload.message)
          throw new Error('Campaign name and message are required.');
      }
      return res.status(201).json({
        type: 'success',
        data: await platform.createDraft(req, type, payload),
        message: 'Review this draft before confirming.',
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async confirmDraft(req, res) {
    try {
      const context = {
        branchId:
          req.tenantContext?.branchId || req.session?.selectedBranchId || req.user?.branch_id,
        branchName: req.tenantContext?.branchName || req.user?.branch_name || '',
        licenseId: req.tenantContext?.licenseId || req.user?.license || req.user?.license_id,
        userId: req.user?._id,
        userName: req.user?.username || req.user?.email || '',
      };
      const data = await platform.confirmDraft(
        req,
        req.body?.token,
        async (type, payload, draft) => {
          const actionContext = { ...context, askPosnicAction: { id: String(draft._id), step: 0 } };
          const preferences = await platform.getPreferences(req);
          if (!platform.capabilityAllowed(preferences, 'actions', req.user))
            throw new Error('Ask Posnic actions are not enabled for your role.');
          if (!preferences.allowed_actions.includes(type))
            throw new Error('That Ask Posnic action is disabled.');
          if (!canPrepare(req, type)) throw new Error('Your role cannot confirm that action.');
          if (type === 'purchase_order' && payload.source === 'demand')
            requireReorderAccess(req, preferences);
          if (['purchase_order', 'stock_count'].includes(type))
            await require('../services/ask-posnic-action-validation.service').validateInventory(
              type,
              payload,
              await dashboardController.ensureContext(req)
            );
          if (type === 'purchase_order') {
            const repository = new PurchaseOrderRepository();
            const created = [];
            for (const [index, order] of (payload.orders || []).entries()) {
              const step = draft.resume_steps ? draft.resume_steps[index] : index;
              const result = await repository.upsertOrder(
                {
                  ...order,
                  status: 'draft',
                  notes:
                    payload.source === 'demand'
                      ? 'Prepared from reorder planning review'
                      : 'Prepared from low-stock review',
                },
                '',
                { ...actionContext, askPosnicAction: { id: String(draft._id), step } }
              );
              if (!result.status)
                throw new Error(result.message || 'Could not create purchase order draft');
              created.push(result.data);
            }
            return {
              purchase_orders: created,
              skipped_without_supplier: payload.skipped_without_supplier || [],
            };
          }
          if (type === 'stock_count') {
            const repository = new InventoryCountRepository();
            const result = await repository.createDraft(
              { items: payload.items, scope: payload.scope, notes: 'Prepared by Ask Posnic' },
              actionContext
            );
            if (!result.status)
              throw new Error(result.message || 'Could not create stock count draft');
            return { stock_count: result.data };
          }
          if (type === 'campaign') {
            const result = await new CampaignService().save('', payload, actionContext);
            if (!result.status)
              throw new Error(result.message || 'Could not create campaign draft');
            return { campaign: result.data };
          }
          if (type === 'sale_draft') {
            await require('../services/ask-posnic-sale-draft.service').validate(
              await dashboardController.ensureContext(req),
              payload
            );
            const result = await new (require('../repositories/quote.repository'))().upsertQuote(
              payload,
              '',
              actionContext
            );
            if (!result.status) throw new Error(result.message || 'Could not create sales draft');
            return { quotation: result.data };
          }
          if (type === 'supplier_message') {
            const messages = require('../services/ask-posnic-supplier-message.service');
            await messages.validate(await dashboardController.ensureContext(req), payload);
            return { supplier_message: await messages.save(payload, actionContext) };
          }
          throw new Error('That action executor is not available.');
        }
      );
      return res.json({ type: 'success', data, message: 'Action draft created.' });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async actionOutcome(req, res) {
    const preferences = await platform.getPreferences(req);
    if (!platform.capabilityAllowed(preferences, 'actions', req.user))
      return res.status(403).json({
        type: 'error',
        message: 'Ask Posnic actions are not enabled for your role.',
        data: null,
      });
    const data = await platform.actionOutcome(req, req.params.id);
    if (!data)
      return res.status(404).json({ type: 'error', message: 'Action not found.', data: null });
    if (!canPrepare(req, data.type))
      return res
        .status(403)
        .json({ type: 'error', message: 'Your role cannot view that action.', data: null });
    return res.json({ type: 'success', message: 'Saved action status', data });
  }

  async resumeDraft(req, res) {
    const preferences = await platform.getPreferences(req);
    if (
      !platform.capabilityAllowed(preferences, 'actions', req.user) ||
      !preferences.allowed_actions.some((type) => canPrepare(req, type))
    )
      return res
        .status(403)
        .json({ type: 'error', message: 'Your role cannot recover action drafts.', data: null });
    try {
      const model = await dashboardController.ensureContext(req);
      const data = await platform.resumeDraft(req, req.params.id, (payload, type) => {
        if (!preferences.allowed_actions.includes(type) || !canPrepare(req, type))
          throw new Error('Your role cannot recover this action type.');
        if (type === 'purchase_order' && payload.source === 'demand')
          requireReorderAccess(req, preferences);
        if (['purchase_order', 'stock_count'].includes(type))
          return require('../services/ask-posnic-action-validation.service').validateInventory(
            type,
            payload,
            model
          );
        if (type === 'sale_draft')
          return require('../services/ask-posnic-sale-draft.service').validate(model, payload);
        if (type === 'supplier_message')
          return require('../services/ask-posnic-supplier-message.service').validate(
            model,
            payload
          );
      });
      return res
        .status(201)
        .json({ type: 'success', message: 'Review the remaining work before confirming.', data });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async supplierMessages(req, res) {
    const preferences = await platform.getPreferences(req);
    if (
      !platform.capabilityAllowed(preferences, 'actions', req.user) ||
      !preferences.allowed_actions.includes('supplier_message') ||
      !canPrepare(req, 'supplier_message')
    )
      return res.status(403).json({
        type: 'error',
        message: 'Your role cannot view supplier-message drafts.',
        data: null,
      });
    return res.json({
      type: 'success',
      message: 'Your saved supplier-message drafts',
      data: await require('../services/ask-posnic-supplier-message.service').list(req),
    });
  }

  async listSchedules(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    return res.json({
      type: 'success',
      message: 'Schedules',
      data: await schedules.list(scheduleContext(req)),
    });
  }

  async preferences(req, res) {
    return res.json({
      type: 'success',
      message: 'Ask Posnic preferences',
      data: await platform.getPreferences(req),
    });
  }

  async savePreferences(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    try {
      return res.json({
        type: 'success',
        message: 'Ask Posnic preferences saved.',
        data: await platform.savePreferences(req, req.body || {}),
      });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async saveSchedule(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    try {
      const context = scheduleContext(req);
      const data = await schedules.save(context, {
        ...(req.body || {}),
        timezone: req.body?.timezone || context.timezone,
      });
      return res.status(201).json({ type: 'success', message: 'Summary schedule saved.', data });
    } catch (error) {
      return res.status(400).json({ type: 'error', message: error.message, data: null });
    }
  }

  async removeSchedule(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    const removed = await schedules.remove(scheduleContext(req), req.params.id);
    return res.status(removed ? 200 : 404).json({
      type: removed ? 'success' : 'error',
      message: removed ? 'Schedule deleted.' : 'Schedule not found.',
      data: null,
    });
  }

  async runSchedules(req, res) {
    if (!isOwner(req))
      return res
        .status(403)
        .json({ type: 'error', message: 'Owner access is required.', data: null });
    const outcomes = await scheduleRunner.sweep({ context: scheduleContext(req) });
    return res.json({ type: 'success', message: 'Due schedules processed.', data: outcomes });
  }
}

module.exports = new AskPosnicController();
