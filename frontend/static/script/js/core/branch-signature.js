/* One signature per branch, shared by receipt layouts, invoices and quotations. */
(function () {
    'use strict';
    var serial = 0, revisions = {};
    function source(value) { return window.PosnicReceiptDesign.image(value) ? value : ''; }
    function activeBranch() { return String(PosnicPro.local.get('branch_id_set') || ''); }
    function sync(branchId, value) {
        value = source(value);
        if (String(branchId) === activeBranch()) {
            PosnicPro.local.set('quotesignature', value);
            $('#quote_default_signature').val(value);
            $('#quote_signature_thumb').attr('src', value).toggle(!!value);
            $('#quote_signature_clear').toggle(!!value);
            if (PosnicPro.quotes && PosnicPro.quotes._ed) { PosnicPro.quotes._edSigSync(); PosnicPro.quotes.edRecalc(); }
            if (PosnicPro.invoices && PosnicPro.invoices._ed) PosnicPro.invoices.edRecalc();
        }
        $(window).trigger('posnic:signature-saved', [{ branchId: String(branchId), signature: value }]);
        return value;
    }
    function request(method, branchId, value) {
        return new Promise(function (resolve, reject) {
            if (!/^[a-f0-9]{24}$/i.test(String(branchId))) { reject(new Error(PosnicPro.i18n.t('lang_signature_branch_required', 'Select a branch before uploading a signature.'))); return; }
            var args = { url: 'branches/' + branchId + '/signature' };
            var revision = revisions[branchId] || 0;
            if (method === 'put') { revision++; revisions[branchId] = revision; }
            if (method === 'put') args.data = JSON.stringify({ signature: value });
            PosnicPro[method](args, function (res) {
                if (res.type !== 'success' || !res.data) { reject(new Error(res.message || PosnicPro.i18n.t('lang_could_not_save_the_signature', 'Could not save the signature'))); return; }
                // An older read must not resurrect an image replaced or removed meanwhile.
                if ((revisions[branchId] || 0) === revision) sync(branchId, res.data.signature);
                resolve(source(res.data.signature));
            }, function () { reject(new Error(PosnicPro.i18n.t('lang_signature_connection_error', 'Could not update the signature. Check your connection and try again.'))); });
        });
    }
    function readFile(file) {
        return new Promise(function (resolve, reject) {
            var message = PosnicPro.i18n.t('lang_signature_image_hint', 'Use a PNG, JPEG or WebP image up to 5 MB. A transparent PNG works best.');
            if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { reject(new Error(message)); return; }
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error(message)); };
            reader.onload = function () {
                var image = new Image();
                image.onerror = function () { reject(new Error(message)); };
                image.onload = function () {
                    try {
                        var scale = Math.min(1, 768 / image.width, 256 / image.height);
                        var canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(image.width * scale));
                        canvas.height = Math.max(1, Math.round(image.height * scale));
                        // Keep transparent ink on paper; do not add a background.
                        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                        var value = canvas.toDataURL('image/png');
                        if (!source(value)) throw new Error(message);
                        resolve(value);
                    } catch (error) { reject(new Error(message)); }
                };
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }
    function mount(element, options) {
        var host = $(element), branchId = String(options.branchId || ''), token = {};
        if (!host.length) return;
        var id = 'branch-signature-file-' + (++serial), value = source(options.source);
        host.data('signature-token', token).addClass('branch-signature-control').attr('data-signature-branch', branchId);
        host.empty().append(
            $('<p class="branch-signature-help">').text(PosnicPro.i18n.t('lang_signature_shared_hint', "Shared by this branch's receipts, invoices and quotations. Uploads and removals save immediately.")),
            $('<img class="branch-signature-preview">').attr('alt', PosnicPro.i18n.t('lang_authorised_signatory', 'Authorised signatory')),
            $('<label>').attr('for', id).text(PosnicPro.i18n.t('lang_upload_signature', 'Upload signature')),
            $('<input type="file" class="branch-signature-file" accept="image/png,image/jpeg,image/webp">').attr('id', id),
            $('<small>').text(PosnicPro.i18n.t('lang_signature_image_hint', 'Use a PNG, JPEG or WebP image up to 5 MB. A transparent PNG works best.')),
            $('<button type="button" class="btn btn-sm btn-outline-secondary branch-signature-remove">').text(PosnicPro.i18n.t('lang_remove_signature', 'Remove signature')),
            $('<span class="branch-signature-status" role="status" aria-live="polite">')
        );
        function current() { return host.data('signature-token') === token; }
        function display(next) {
            value = source(next);
            host.find('.branch-signature-preview').attr('src', value || '').toggle(!!value);
            host.find('.branch-signature-remove').toggle(!!value);
        }
        function busy(on) { if (current()) host.find('input,button').prop('disabled', on); }
        function status(message) { if (current()) host.find('.branch-signature-status').text(message); }
        function persist(next) {
            return request('put', branchId, next).then(function () {
                status(PosnicPro.i18n.t('lang_signature_saved_shared', 'Signature saved for this branch.'));
            });
        }
        display(value);
        host.off('.branchSignature').on('change.branchSignature', '.branch-signature-file', function () {
            var file = this.files && this.files[0];
            if (!file) return;
            busy(true); status(PosnicPro.i18n.t('lang_saving', 'Saving ...'));
            readFile(file).then(persist).catch(function (error) { status(error.message); }).finally(function () {
                if (current()) host.find('input[type=file]').val('');
                busy(false);
            });
        }).on('click.branchSignature', '.branch-signature-remove', function () {
            busy(true); status(PosnicPro.i18n.t('lang_saving', 'Saving ...'));
            persist('').catch(function (error) { status(error.message); }).finally(function () { busy(false); });
        }).on('signature:display.branchSignature', function (_event, next) { display(next); });
        busy(true);
        request('get', branchId).catch(function (error) { status(error.message); }).finally(function () { busy(false); });
    }
    $(window).on('posnic:signature-saved.branchSignature', function (_event, data) {
        $('.branch-signature-control').each(function () {
            if ($(this).attr('data-signature-branch') === data.branchId) $(this).triggerHandler('signature:display', [data.signature]);
        });
    });
    PosnicPro.branchSignature = { mount: mount, readFile: readFile, sync: sync, source: source, activeBranch: activeBranch,
        current: function () { return source(PosnicPro.local.get('quotesignature')); },
        save: function (branchId, value) { return request('put', branchId, value); } };
}());
