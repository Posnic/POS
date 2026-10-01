/* Durable submission records. Callers must save before sending and reconcile
 * uncertain responses with the original request, never a reconstructed cart. */
(function (root) {
    'use strict';
    function create(storage, getScope, translate) {
        var t = translate || function (key, fallback) { return fallback; };
        var prefix = 'posnic.order-journal.v1:';
        function owner() {
            var scope = getScope();
            if (!scope || !scope.server || !scope.branch || !scope.user) throw new Error(t('lang_submission_sign_in', 'Sign in before saving an order.'));
            return JSON.stringify([String(scope.server), String(scope.branch), String(scope.user)]);
        }
        function key(scope, id) { return prefix + scope + ':' + encodeURIComponent(id); }
        function body(value) {
            var result = JSON.parse(JSON.stringify(value));
            // Approval credentials must be obtained again when retrying later.
            delete result.approval_token;
            delete result.approval_tokens;
            return result;
        }
        function canonical(value) {
            if (Array.isArray(value)) return value.map(canonical);
            if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(function (name) { return [name, canonical(value[name])]; }));
            return value;
        }
        function read(scope, id) {
            var raw = storage.getItem(key(scope, id));
            if (!raw) return null;
            var entry = JSON.parse(raw);
            if (entry.version !== 1 || entry.owner !== scope || entry.id !== id ||
                entry.payload.idempotencyKey !== id || !['pending', 'confirmed', 'rejected'].includes(entry.state)) {
                throw new Error(t('lang_submission_unreadable', 'The saved order could not be read.'));
            }
            return entry;
        }
        function save(payload) {
            var scope = owner(), id = payload && payload.idempotencyKey;
            if (typeof id !== 'string' || !id.trim()) throw new Error(t('lang_submission_id_required', 'An order request ID is required.'));
            var clean = body(payload), existing = read(scope, id);
            if (existing) {
                if (JSON.stringify(canonical(existing.payload)) !== JSON.stringify(canonical(clean))) {
                    throw new Error(t('lang_submission_resolve_first', 'Resolve the previous submission before sending changes.'));
                }
                return existing;
            }
            var entry = { version: 1, owner: scope, id: id, state: 'pending', createdAt: Date.now(), payload: clean };
            storage.setItem(key(scope, id), JSON.stringify(entry));
            return entry;
        }
        function pending() {
            var scope = owner(), starts = prefix + scope + ':', entries = [];
            for (var index = 0; index < storage.length; index++) {
                var name = storage.key(index);
                if (!name || !name.startsWith(starts)) continue;
                var entry = read(scope, decodeURIComponent(name.slice(starts.length)));
                if (entry && entry.state === 'pending') entries.push(entry);
            }
            return entries.sort(function (a, b) { return a.createdAt - b.createdAt; });
        }
        function confirm(entry, response) {
            var scope = owner();
            if (scope !== entry.owner) throw new Error(t('lang_submission_sign_in', 'Sign in before saving an order.'));
            var saved = read(scope, entry.id);
            var saleId = response && response.data && (response.data._id || response.data.sales_id);
            if (!saved || !saleId || response.type !== 'success') throw new Error(t('lang_submission_confirmation_required', 'Order confirmation is required.'));
            // Keep a confirmed marker if removal fails. It must never be offered
            // as an unsent order after the server has acknowledged it.
            saved.state = 'confirmed'; saved.saleId = String(saleId);
            storage.setItem(key(scope, entry.id), JSON.stringify(saved));
            try { storage.removeItem(key(scope, entry.id)); } catch (error) { /* confirmed marker remains */ }
        }
        function reject(entry, response) {
            var outcome = response && response.data;
            if (!entry || !response || response.type !== 'error' || !outcome ||
                outcome.submission_outcome !== 'not_saved' || outcome.request_id !== entry.id) return false;
            var scope = owner();
            if (scope !== entry.owner) throw new Error(t('lang_submission_sign_in', 'Sign in before saving an order.'));
            var saved = read(scope, entry.id);
            if (!saved || saved.state !== 'pending') return false;
            // Retain the rejected payload for diagnosis; never call it a sale.
            saved.state = 'rejected'; saved.rejection = response.message;
            storage.setItem(key(scope, entry.id), JSON.stringify(saved));
            return true;
        }
        return { save: save, pending: pending, confirm: confirm, reject: reject };
    }
    if (typeof module === 'object' && module.exports) module.exports = { create: create };
    else root.PosnicOrderJournal = { create: create };
})(typeof window === 'undefined' ? globalThis : window);
