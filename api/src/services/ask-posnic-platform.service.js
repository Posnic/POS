'use strict';

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { currentSecret } = require('../db/tenant-context');

const db = new BaseModel('ask_posnic_documents');
const now = () => new Date();
const clean = (value, max = 20000) =>
  String(value || '')
    .replace(/\0/g, '')
    .trim()
    .slice(0, max);
const {
  chunks,
  contextForChunk,
  normalizeQuestion,
  rank,
  privateCredentialQuestion,
} = require('./ask-posnic-retrieval');
const semantic = require('./ask-posnic-semantic.service');
const ownSemantic = require('./ask-posnic-own-key-semantic.service');
const retention = require('./ask-posnic-retention.service');
const pageMap = require('./knowledge-page-map');
const ACTION_TYPES = new Set([
  'purchase_order',
  'stock_count',
  'campaign',
  'sale_draft',
  'supplier_message',
]);
const MAX_ACTION_TOKEN = 2 * 1024 * 1024;

function scope(req) {
  const value = {
    license: String(
      req.tenantContext?.licenseId || req.user?.license || req.user?.license_id || ''
    ),
    branch_id: String(
      req.tenantContext?.branchId || req.session?.selectedBranchId || req.user?.branch_id || ''
    ),
    user_id: String(req.user?._id || req.user?.id || ''),
  };
  if (!value.license || !value.branch_id || !value.user_id)
    throw new Error('An authenticated shop, outlet and user are required.');
  return value;
}

async function collection(name) {
  return db.getCollection(name);
}

function documentText(value, limit, label) {
  const text = String(value || '')
    .replace(/\0/g, '')
    .trim();
  if (text.length > limit)
    throw new Error(
      `${label} exceeds ${limit.toLocaleString('en-US')} characters. Split the source before saving.`
    );
  return text;
}

async function saveDocument(req, input) {
  const s = scope(req);
  const title = documentText(input.title, 200, 'Document title');
  const content = documentText(input.content, 200000, 'Document text');
  const kind = ['faq', 'markdown', 'pdf', 'release_note'].includes(input.kind)
    ? input.kind
    : 'markdown';
  if (!title || !content) throw new Error('Title and extracted document text are required.');
  const docs = await collection('ask_posnic_documents');
  const doc = {
    ...s,
    title,
    kind,
    content,
    ...(kind === 'pdf' && input.page_map
      ? { page_map: pageMap.validate(content, input.page_map) }
      : {}),
    revision: clean(input.revision, 80) || new Date().toISOString(),
    visibility: input.visibility === 'internal' ? 'internal' : 'customer',
    status: input.status === 'published' ? 'published' : 'draft',
    chunks: chunks(content),
    created_at: now(),
    updated_at: now(),
  };
  doc.semantic_source_hash = semantic.sourceHash(doc);
  doc.own_semantic_source_hash = ownSemantic.sourceHash(doc);
  const result = await docs.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function listDocuments(req, includeDrafts = false) {
  const s = scope(req);
  const filter = {
    license: s.license,
    ...(includeDrafts ? {} : { status: 'published', visibility: 'customer' }),
  };
  return (await collection('ask_posnic_documents'))
    .find(filter, {
      projection: {
        content: 0,
        chunks: 0,
        page_map: 0,
        'semantic.keys': 0,
        'semantic.claim': 0,
        'semantic.previous': 0,
        'semantic.chunk_hashes': 0,
        'semantic.execution_owner': 0,
        'semantic.operation': 0,
        'own_semantic.keys': 0,
        'own_semantic.claim': 0,
        'own_semantic.execution_owner': 0,
        'own_semantic.operation': 0,
      },
    })
    .sort({ updated_at: -1 })
    .limit(200)
    .toArray();
}

async function getDocument(req, id, options = {}) {
  if (!ObjectId.isValid(String(id))) return null;
  const doc = await (
    await collection('ask_posnic_documents')
  ).findOne(
    {
      _id: new ObjectId(String(id)),
      license: scope(req).license,
      status: 'published',
      visibility: 'customer',
    },
    { projection: { title: 1, revision: 1, content: 1, kind: 1, page_map: 1 } }
  );
  if (!doc || (options.revision !== undefined && String(options.revision) !== String(doc.revision)))
    return null;
  const chunk =
    typeof options.chunk === 'string' && /^\d+$/.test(options.chunk)
      ? Number(options.chunk)
      : options.chunk;
  const pages = pageMap.forChunk(doc, chunk);
  const sections = pages.length
    ? doc.page_map.spans
        .filter((span) => pages.includes(span.page))
        .map((span) => ({ page: span.page, text: doc.content.slice(span.start, span.end) }))
    : [];
  return { ...doc, ...(sections.length ? { pages, sections } : {}) };
}

async function setDocumentStatus(req, id, status) {
  if (!['draft', 'published', 'retired'].includes(status))
    throw new Error('Invalid document status.');
  const s = scope(req);
  const result = await (
    await collection('ask_posnic_documents')
  ).findOneAndUpdate(
    { _id: new ObjectId(id), license: s.license },
    { $set: { status, updated_at: now(), published_at: status === 'published' ? now() : null } },
    { returnDocument: 'after', projection: { content: 0, chunks: 0 } }
  );
  if (!result) throw new Error('Document not found.');
  if (status === 'published')
    await (
      await collection('ask_posnic_documents')
    ).updateOne(
      {
        _id: result._id,
        license: s.license,
        'semantic.state': { $nin: ['processing', 'needs_review'] },
      },
      { $set: { 'semantic.state': 'pending' }, $unset: { 'semantic.retry_at': '' } }
    );
  if (status === 'published')
    await (
      await collection('ask_posnic_documents')
    ).updateOne(
      {
        _id: result._id,
        license: s.license,
        'own_semantic.state': { $nin: ['processing', 'needs_review'] },
      },
      { $set: { 'own_semantic.state': 'pending' }, $unset: { 'own_semantic.retry_at': '' } }
    );
  return result;
}

async function importBundle(req, bundle) {
  if (bundle?.schema !== 'posnic.ask-knowledge.v1' || !Array.isArray(bundle.documents))
    throw new Error('This is not a Posnic knowledge bundle.');
  if (bundle.documents.length > 500)
    throw new Error('A knowledge bundle supports up to 500 published documents.');
  // Validate the complete input before any revision is imported or retired.
  for (const source of bundle.documents) {
    if (!source || typeof source !== 'object')
      throw new Error('The knowledge bundle contains an invalid source.');
    documentText(source.title, 200, 'Document title');
    documentText(source.content, 200000, 'Document text');
    documentText(source.seriesId, 250, 'Source identifier');
    documentText(source.version || source.revision, 80, 'Source revision');
    if (source.page_map)
      pageMap.validate(documentText(source.content, 200000, 'Document text'), source.page_map);
  }
  const snapshot = bundle.snapshot === true && bundle.source === 'posnic-intranet';
  if (
    snapshot &&
    bundle.documents.some(
      (doc) =>
        !doc.seriesId ||
        !doc.title ||
        !doc.content ||
        doc.visibility !== 'customer' ||
        doc.status !== 'published'
    )
  )
    throw new Error('The published knowledge snapshot is incomplete.');
  const s = scope(req);
  const docs = await collection('ask_posnic_documents');
  await docs.createIndex(
    { license: 1, central_id: 1, revision: 1 },
    { unique: true, partialFilterExpression: { central_id: { $type: 'string' } } }
  );
  let imported = 0;
  for (const source of bundle.documents.slice(0, 500)) {
    const title = clean(source.title, 200);
    const content = clean(source.content, 200000);
    const centralId = clean(source.seriesId || title, 250);
    if (!title || !content || source.visibility !== 'customer' || source.status !== 'published')
      continue;
    const revision = clean(String(source.version || source.revision || 1), 80);
    const semanticSourceHash = semantic.sourceHash({ title, content, revision });
    const ownSourceHash = ownSemantic.sourceHash({ title, content, revision });
    await docs.updateOne(
      { license: s.license, central_id: centralId, revision },
      {
        $set: {
          ...s,
          origin: 'posnic-intranet',
          title,
          content,
          page_map: source.kind === 'pdf' ? pageMap.validate(content, source.page_map) : null,
          kind: ['faq', 'markdown', 'pdf', 'release_note'].includes(source.kind)
            ? source.kind
            : 'markdown',
          revision,
          visibility: 'customer',
          status: 'published',
          chunks: chunks(content),
          semantic_source_hash: semanticSourceHash,
          own_semantic_source_hash: ownSourceHash,
          updated_at: now(),
          published_at: now(),
        },
        $setOnInsert: { created_at: now() },
      },
      { upsert: true }
    );
    await docs.updateMany(
      {
        license: s.license,
        central_id: centralId,
        revision: { $ne: revision },
        status: 'published',
      },
      { $set: { status: 'retired', updated_at: now() } }
    );
    imported += 1;
  }
  if (snapshot)
    await docs.updateMany(
      {
        license: s.license,
        origin: 'posnic-intranet',
        central_id: { $nin: bundle.documents.map((doc) => clean(doc.seriesId, 250)) },
        status: 'published',
      },
      { $set: { status: 'retired', updated_at: now() } }
    );
  await audit(req, 'knowledge_bundle_imported', {
    imported,
    exported_at: clean(bundle.exportedAt, 80),
  });
  return { imported };
}

async function retrieve(req, question, limit = 3) {
  const s = scope(req);
  if (privateCredentialQuestion(question)) return [];
  const docs = await (
    await collection('ask_posnic_documents')
  )
    .find({ license: s.license, status: 'published', visibility: 'customer' })
    .limit(500)
    .toArray();
  const lexical = rank(docs, question, limit);
  if (lexical[0]?.exact) return lexical.slice(0, 1);
  try {
    const database = await BaseModel.getDb(),
      context = { licenseId: s.license, branchId: s.branch_id };
    const ai = require('./ai.service');
    const engine = ai.modeFor(await ai.settingsFor(context)) === 'own_key' ? ownSemantic : semantic;
    const matches = await engine.retrieve(database, s.license, question, context);
    return semantic.merge(lexical, matches, limit);
  } catch (_error) {
    return lexical;
  }
}

async function saveMessage(req, conversationId, role, payload) {
  const s = scope(req);
  const preferences = await getPreferences(req);
  if (preferences.store_conversations === false) return String(conversationId || '');
  const conversations = await collection('ask_posnic_conversations');
  const id = /^[a-f0-9]{24}$/i.test(String(conversationId || ''))
    ? new ObjectId(conversationId)
    : new ObjectId();
  await conversations.updateOne(
    { _id: id, ...s },
    {
      $setOnInsert: { ...s, created_at: now() },
      $set: { updated_at: now() },
      $push: { messages: { $each: [{ role, payload, at: now() }], $slice: -100 } },
    },
    { upsert: true }
  );
  return String(id);
}

async function currentMatches(req, matches) {
  const s = scope(req),
    documents = await collection('ask_posnic_documents'),
    kept = [];
  for (const match of matches) {
    if (!ObjectId.isValid(match.document_id)) continue;
    const doc = await documents.findOne({
      _id: new ObjectId(match.document_id),
      license: s.license,
      status: 'published',
      visibility: 'customer',
    });
    if (
      !doc ||
      String(doc.revision || doc.version || 1) !== String(match.revision) ||
      doc.title !== match.title
    )
      continue;
    const text = match.exact ? doc.content : (doc.chunks || chunks(doc.content))[match.chunk];
    if (
      typeof text === 'string' &&
      text.includes(match.text) &&
      (!match.context || contextForChunk(doc, match.chunk) === match.context)
    )
      kept.push({ ...match, pages: pageMap.forChunk(doc, match.chunk) });
  }
  return kept;
}

async function getPreferences(req) {
  const s = scope(req);
  const row = await (await collection('ask_posnic_preferences')).findOne({ license: s.license });
  return {
    help_enabled: row?.help_enabled !== false,
    insights_enabled: row?.insights_enabled !== false,
    actions_enabled: row?.actions_enabled !== false,
    store_conversations: row?.store_conversations !== false,
    retention_days: retention.daysFor(row),
    own_key_semantic: row?.own_key_semantic === true,
    own_key_semantic_budget: Number(row?.own_key_semantic_budget) || 1,
    default_period: PERIOD_VALUE(row?.default_period, 'today'),
    response_language: clean(row?.response_language, 20) || 'auto',
    help_instructions: clean(row?.help_instructions, 2000),
    roles: row?.roles && typeof row.roles === 'object' ? row.roles : {},
    allowed_actions: Array.isArray(row?.allowed_actions)
      ? row.allowed_actions
      : ['purchase_order', 'stock_count', 'campaign', 'sale_draft', 'supplier_message'],
  };
}

function PERIOD_VALUE(value, fallback) {
  return ['today', 'yesterday', 'week', 'month', 'year'].includes(value) ? value : fallback;
}

const CAPABILITIES = ['help', 'insights', 'actions'];
const ROLES = ['owner', 'admin', 'super_admin', 'manager', 'cashier', 'staff'];

function normalizeRoles(input) {
  const source = input && typeof input === 'object' ? input : {};
  return CAPABILITIES.reduce((result, capability) => {
    if (!Array.isArray(source[capability])) return result;
    const normalized = [
      ...new Set(
        source[capability]
          .map((role) => clean(role, 30).toLowerCase())
          .filter((role) => ROLES.includes(role))
      ),
    ];
    if (source[capability].length && !normalized.length)
      throw new Error(`Choose a valid role for ${capability}.`);
    result[capability] = normalized;
    return result;
  }, {});
}

async function savePreferences(req, input) {
  const s = scope(req);
  // Older clients omit this field; saving another setting must not shorten it.
  const existing = await (
    await collection('ask_posnic_preferences')
  ).findOne({ license: s.license });
  const retentionDays =
    input.retention_days === undefined ? retention.daysFor(existing) : input.retention_days;
  if (!retention.DAYS.includes(retentionDays))
    throw new Error('Choose a retention period of 7, 30, 90 or 365 days.');
  const boolean = (key, fallback = true) =>
    typeof input[key] === 'boolean' ? input[key] : fallback;
  const semanticBudget =
    input.own_key_semantic_budget == null ? 1 : Number(input.own_key_semantic_budget);
  if (!Number.isFinite(semanticBudget) || semanticBudget < 0.01 || semanticBudget > 10000)
    throw new Error(
      'Choose a monthly knowledge-search budget between 0.01 and 10,000 in the outlet currency.'
    );
  const value = {
    help_enabled: boolean('help_enabled'),
    insights_enabled: boolean('insights_enabled'),
    actions_enabled: boolean('actions_enabled'),
    store_conversations: boolean('store_conversations'),
    default_period: PERIOD_VALUE(input.default_period, 'today'),
    retention_days: retentionDays,
    own_key_semantic: boolean('own_key_semantic', false),
    own_key_semantic_budget: semanticBudget,
    response_language: clean(input.response_language, 20) || 'auto',
    roles: normalizeRoles(input.roles),
    help_instructions: clean(input.help_instructions, 2000),
    allowed_actions: Array.isArray(input.allowed_actions)
      ? input.allowed_actions.filter((type) =>
          ['purchase_order', 'stock_count', 'campaign', 'sale_draft', 'supplier_message'].includes(
            type
          )
        )
      : ['purchase_order', 'stock_count', 'campaign', 'sale_draft', 'supplier_message'],
    updated_at: now(),
    updated_by: s.user_id,
  };
  await (
    await collection('ask_posnic_preferences')
  ).updateOne(
    { license: s.license },
    { $set: value, $setOnInsert: { created_at: now() } },
    { upsert: true }
  );
  return value;
}

function capabilityAllowed(preferences, capability, user) {
  if (preferences[`${capability}_enabled`] === false) return false;
  const configured = preferences.roles?.[capability];
  if (!Array.isArray(configured) || !configured.length) return true;
  const role = String(user?.role || user?.usertype || '').toLowerCase();
  return configured.map((entry) => String(entry).toLowerCase()).includes(role);
}

async function history(req) {
  const s = scope(req);
  const cutoff = retention.cutoffFor(await getPreferences(req));
  const rows = await (
    await collection('ask_posnic_conversations')
  )
    .find(
      { ...s, messages: { $elemMatch: { at: { $type: 'date', $gte: cutoff } } } },
      { projection: { messages: { $slice: -100 } } }
    )
    .sort({ updated_at: -1 })
    .limit(20)
    .toArray();
  return rows
    .map((row) => ({
      ...row,
      messages: (row.messages || [])
        .filter((message) => retention.isCurrent(message, cutoff))
        .slice(-20),
    }))
    .filter((row) => row.messages.length);
}

async function deleteHistory(req) {
  const s = scope(req);
  const conversations = await (await collection('ask_posnic_conversations')).deleteMany(s);
  const feedback = await (await collection('ask_posnic_feedback')).deleteMany(s);
  return { deletedCount: conversations.deletedCount, feedbackDeletedCount: feedback.deletedCount };
}

function signingKey() {
  const key = currentSecret(
    'SESSION_SECRET',
    process.env.ASK_POSNIC_ACTION_SECRET || process.env.SESSION_SECRET
  );
  if (!key) throw new Error('Configure an action signing secret before using Ask Posnic actions.');
  return key;
}

function sign(value) {
  return crypto.createHmac('sha256', signingKey()).update(value).digest('base64url');
}

async function createDraft(req, type, payload) {
  if (!ACTION_TYPES.has(type)) throw new Error('That action is not supported.');
  const s = scope(req);
  const nonce = crypto.randomBytes(16).toString('hex');
  const expires = Date.now() + 10 * 60 * 1000;
  const body = Buffer.from(JSON.stringify({ ...s, type, payload, nonce, expires })).toString(
    'base64url'
  );
  const token = `${body}.${sign(body)}`;
  if (token.length > MAX_ACTION_TOKEN) throw new Error('Split this action into smaller drafts.');
  const result = await (
    await collection('ask_posnic_action_drafts')
  ).insertOne({
    ...s,
    type,
    payload,
    nonce,
    expires_at: new Date(expires),
    status: 'pending',
    created_at: now(),
  });
  return { id: String(result.insertedId), type, payload, token, expires_at: new Date(expires) };
}

async function confirmDraft(req, token, execute) {
  if (typeof token !== 'string' || token.length > MAX_ACTION_TOKEN)
    throw new Error('Invalid action confirmation.');
  const [body, signature, extra] = token.split('.');
  if (
    !body ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/.test(body) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature || '')
  )
    throw new Error('Invalid action confirmation.');
  const expected = sign(body);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    throw new Error('Invalid action confirmation.');
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid action confirmation.');
  }
  if (
    !decoded ||
    Array.isArray(decoded) ||
    typeof decoded.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/.test(decoded.nonce) ||
    !ACTION_TYPES.has(decoded.type) ||
    !Number.isSafeInteger(decoded.expires)
  )
    throw new Error('Invalid action confirmation.');
  const s = scope(req);
  if (decoded.expires < Date.now()) throw new Error('This action draft has expired.');
  if (
    decoded.license !== s.license ||
    decoded.branch_id !== s.branch_id ||
    decoded.user_id !== s.user_id
  )
    throw new Error('This action belongs to a different account or outlet.');
  const drafts = await collection('ask_posnic_action_drafts');
  const result = await drafts.findOneAndUpdate(
    {
      license: s.license,
      branch_id: s.branch_id,
      user_id: s.user_id,
      nonce: { $eq: decoded.nonce },
      type: { $eq: decoded.type },
      expires_at: { $gt: now() },
      status: 'pending',
    },
    {
      $set: {
        status: 'executing',
        confirmed_at: now(),
        execution_owner: require('./ask-posnic-execution-owner').current(),
      },
    },
    { returnDocument: 'after' }
  );
  if (!result) throw new Error('This action was already used or cancelled.');
  try {
    let payload = result.payload;
    if (result.resume_steps) {
      const saved = await savedActionRecords(result, s);
      const remaining = require('./ask-posnic-action-identity')
        .records(result)
        .filter((ref) => !saved.some((row) => row.step === ref.step))
        .map((ref) => ref.step);
      if (JSON.stringify(remaining) !== JSON.stringify(result.resume_steps))
        throw new Error(
          'Saved orders changed since the recovery review. Review the remaining orders again.'
        );
      if (result.type === 'purchase_order')
        payload = { ...payload, orders: result.resume_steps.map((step) => payload.orders[step]) };
    }
    const output =
      typeof execute === 'function' ? await execute(result.type, payload, result) : null;
    await drafts.updateOne(
      { _id: result._id, status: 'executing' },
      { $set: { status: 'completed', completed_at: now(), output } }
    );
    // The durable action row remains authoritative if the audit projection fails.
    await projectCompletedAction(req, result, output).catch(() => {});
    return { id: String(result._id), type: result.type, status: 'completed', payload, output };
  } catch (error) {
    await drafts
      .updateOne(
        { _id: result._id, status: 'executing' },
        { $set: { status: 'needs_review', failed_at: now(), error: clean(error.message, 300) } }
      )
      .catch(() => {});
    await audit(req, 'action_failed', {
      type: decoded.type,
      draft_id: String(result._id),
      error: clean(error.message, 300),
    }).catch(() => {});
    throw error;
  }
}

async function savedActionRecords(draft, s) {
  const refs = require('./ask-posnic-action-identity').records(draft);
  const wall = {
    license: new ObjectId(s.license),
    branch_id: new ObjectId(s.branch_id),
    ask_posnic_action_id: String(draft._id),
  };
  const saved = [];
  for (const ref of refs) {
    const row = await (
      await collection(ref.collection)
    ).findOne(
      { _id: ref.id, ...wall, ask_posnic_step: ref.step },
      { projection: { _id: 1, po_id: 1, quote_id: 1 } }
    );
    if (row)
      saved.push({
        id: String(row._id),
        step: ref.step,
        ...(row.po_id ? { po_id: row.po_id } : {}),
        ...(row.quote_id ? { quote_id: row.quote_id } : {}),
      });
  }
  return saved;
}

async function resumeDraft(req, id, validate) {
  if (!/^[a-f0-9]{24}$/i.test(String(id || ''))) throw new Error('Action not found.');
  const s = scope(req),
    drafts = await collection('ask_posnic_action_drafts');
  const draft = await drafts.findOne({ _id: new ObjectId(id), ...s });
  // Executing workers may still write. Elapsed time alone cannot prove they
  // stopped, so only a recorded failure can release a batch for another review.
  if (
    !draft ||
    !(draft.status === 'needs_review' || (draft.status === 'pending' && draft.resume_steps))
  )
    throw new Error('This action is not available for recovery review.');
  const saved = await savedActionRecords(draft, s);
  const remaining = require('./ask-posnic-action-identity')
    .records(draft)
    .filter((ref) => !saved.some((row) => row.step === ref.step))
    .map((ref) => ref.step);
  if (!remaining.length)
    throw new Error('All records are already saved; refresh the action status.');
  const payload =
    draft.type === 'purchase_order'
      ? { ...draft.payload, orders: remaining.map((step) => draft.payload.orders[step]) }
      : draft.payload;
  await validate(payload, draft.type);
  const nonce = crypto.randomBytes(16).toString('hex'),
    expires = Date.now() + 10 * 60 * 1000;
  const body = Buffer.from(
    JSON.stringify({ ...s, type: draft.type, payload, resume_steps: remaining, nonce, expires })
  ).toString('base64url');
  const token = `${body}.${sign(body)}`;
  if (token.length > MAX_ACTION_TOKEN) throw new Error('Split this action into smaller drafts.');
  const updated = await drafts.updateOne(
    { _id: draft._id, ...s, status: draft.status, nonce: draft.nonce },
    {
      $set: {
        nonce,
        expires_at: new Date(expires),
        status: 'pending',
        resume_steps: remaining,
        reviewed_saved: saved,
        reviewed_at: now(),
      },
    }
  );
  if (updated.modifiedCount !== 1) throw new Error('This batch changed. Check its status again.');
  await audit(req, 'action_recovery_review', { draft_id: id, saved, remaining }).catch(() => {});
  return {
    id,
    type: draft.type,
    payload,
    token,
    expires_at: new Date(expires),
    recovery: { saved, remaining: remaining.length },
  };
}

async function actionOutcome(req, id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id || ''))) return null;
  const s = scope(req);
  const drafts = await collection('ask_posnic_action_drafts');
  const draft = await drafts.findOne({ _id: new ObjectId(id), ...s });
  if (!draft) return null;
  const refs = require('./ask-posnic-action-identity').records(draft);
  const saved = await savedActionRecords(draft, s);
  const allSaved = saved.length === refs.length;
  let status = draft.status;
  if (allSaved && ['executing', 'needs_review'].includes(status)) {
    status = 'completed';
    await drafts.updateOne(
      { _id: draft._id, status: { $in: ['executing', 'needs_review'] } },
      { $set: { status, completed_at: now(), recovered_records: saved } }
    );
    await audit(req, 'action_recovered', { draft_id: id, type: draft.type, saved }).catch(() => {});
  } else if (saved.length && !allSaved && status !== 'pending') status = 'partial';
  else if (status === 'executing' && Date.now() - new Date(draft.confirmed_at).getTime() > 120000)
    status = 'needs_review';
  if (status === 'completed')
    await projectCompletedAction(req, draft, draft.output || { records: saved }).catch(() => {});
  const resumable =
    !allSaved &&
    (draft.status === 'needs_review' ||
      (draft.status === 'pending' && Boolean(draft.resume_steps)));
  return {
    id,
    type: draft.type,
    status,
    saved,
    expected: refs.length,
    remaining: refs.length - saved.length,
    resumable,
  };
}

async function projectCompletedAction(req, draft, output) {
  // A stable audit ID lets status reads repair a missing audit entry exactly once.
  const result = await (
    await collection('ask_posnic_audit')
  ).updateOne(
    { _id: `action_confirmed:${draft._id}` },
    {
      $setOnInsert: {
        ...scope(req),
        event: 'action_confirmed',
        at: draft.completed_at || now(),
        detail: { type: draft.type, draft_id: String(draft._id), output },
      },
    },
    { upsert: true }
  );
  if (result?.upsertedCount === 1)
    void require('./ask-posnic-metrics.service').record(
      { licenseId: scope(req).license },
      'quality',
      { actions_confirmed: 1 }
    );
}

async function audit(req, event, detail) {
  const s = scope(req);
  await (await collection('ask_posnic_audit')).insertOne({ ...s, event, detail, at: now() });
  const counter =
    event === 'answer_feedback' && ['helpful', 'not_helpful'].includes(detail?.rating)
      ? detail.rating
      : null;
  if (counter)
    void require('./ask-posnic-metrics.service').record({ licenseId: s.license }, 'quality', {
      [counter]: 1,
    });
}

async function listAudit(req) {
  const s = scope(req);
  return (await collection('ask_posnic_audit'))
    .find({ license: s.license }, { projection: { 'detail.token': 0, 'detail.key': 0 } })
    .sort({ at: -1 })
    .limit(100)
    .toArray();
}

async function usage(req) {
  const s = scope(req);
  const cutoff = retention.cutoffFor(await getPreferences(req));
  const [questions, actions, documents, unanswered, feedback] = await Promise.all([
    (await collection('ask_posnic_audit')).countDocuments({
      license: s.license,
      event: 'question',
    }),
    (await collection('ask_posnic_audit')).countDocuments({
      license: s.license,
      event: 'action_confirmed',
    }),
    (await collection('ask_posnic_documents')).countDocuments({
      license: s.license,
      status: 'published',
    }),
    (await collection('ask_posnic_audit')).countDocuments({
      license: s.license,
      event: 'question',
      'detail.intent': 'help',
      'detail.verified': false,
    }),
    (await collection('ask_posnic_feedback')).countDocuments({
      license: s.license,
      at: { $type: 'date', $gte: cutoff },
    }),
  ]);
  return {
    questions,
    confirmed_actions: actions,
    published_documents: documents,
    unanswered,
    feedback,
  };
}

async function saveFeedback(req, input) {
  const s = scope(req);
  const rating =
    input?.rating === 'helpful' ? 'helpful' : input?.rating === 'not_helpful' ? 'not_helpful' : '';
  if (!rating) throw new Error('Choose helpful or not helpful.');
  const row = {
    ...s,
    conversation_id: clean(input.conversation_id, 40),
    intent: clean(input.intent, 50),
    rating,
    note: clean(input.note, 500),
    at: now(),
  };
  await (await collection('ask_posnic_feedback')).insertOne(row);
  await audit(req, 'answer_feedback', { intent: row.intent, rating });
  return { rating };
}

module.exports = {
  scope,
  saveDocument,
  getDocument,
  listDocuments,
  setDocumentStatus,
  importBundle,
  retrieve,
  currentMatches,
  saveMessage,
  history,
  deleteHistory,
  createDraft,
  resumeDraft,
  confirmDraft,
  actionOutcome,
  audit,
  listAudit,
  usage,
  saveFeedback,
  getPreferences,
  savePreferences,
  capabilityAllowed,
  normalizeRoles,
  normalizeQuestion,
};
