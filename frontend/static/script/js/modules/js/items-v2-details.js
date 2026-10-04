(function (root) {
    'use strict';
    function list(value) { return Array.from(new Set(String(value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean))); }
    function combinations(first, second) {
        var a = list(first), b = list(second);
        return b.length ? a.flatMap(function (x) { return b.map(function (y) { return x + ' / ' + y; }); }) : a;
    }
    function validGtin(value) {
        var code = String(value || '').replace(/[\s-]/g, '');
        if (!code) return true;
        if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
        var sum = 0;
        for (var i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(code[i]) * weight;
        return (10 - sum % 10) % 10 === Number(code.at(-1));
    }
    if (typeof module === 'object' && module.exports) { module.exports = { list: list, combinations: combinations, validGtin: validGtin }; return; }
    var P = root.PosnicPro, photos = [], reading = 0, generation = 0, initialized = false, variants = [], signature = '', caps = {};
    var nutrients = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sat_fat_g', 'fibre_g', 'sugar_g', 'sodium_mg'];
    var foodTags = ['gluten_free', 'dairy_free', 'lactose_free', 'nut_free', 'organic', 'no_added_sugar'];
    var marks = ['signature', 'chefs_pick', 'house_special', 'new'];
    function el(id) { return document.getElementById('iv2-' + id); }
    function val(id) { return el(id).value.trim(); }
    function checked(id) { return el(id).checked; }
    function option(id) { return el(id).selectedOptions[0]; }
    function selected(id) { return Array.from(el(id).selectedOptions).map(function (o) { return o.value; }).filter(Boolean); }
    function label(key, fallback) { return P.i18n.t(key, fallback); }
    function error(message, field) { return { error: message, field: 'iv2-' + field }; }
    function report(message) { el('error').textContent = message; el('error').hidden = false; }
    function number(id) { return val(id) === '' ? undefined : Number(val(id)); }
    function notify() { el('form').dispatchEvent(new Event('input', { bubbles: true })); }
    function button(text, action) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'iv2-secondary'; b.textContent = text; b.onclick = action; return b;
    }
    function fill(id, rows, get) {
        var select = el(id), before = select.value;
        rows.forEach(function (row) { var data = get(row); if (!data.id) return; var o = new Option(data.name, data.id); o.dataset.name = data.name; o.dataset.unit = data.unit || ''; select.add(o); });
        if (before) select.value = before;
    }
    function requestOptions(id, url, get) {
        var select = el(id); select.disabled = true;
        P.get({ url: url, data: url==='items'?{page:1,limit:500}:'query=&branch=' + encodeURIComponent(P.local.get('branch_id_set') || '') }, function (r) {
            select.disabled = false; fill(id, r && (r.suggestions || r.data && r.data.list) || [], get);
        }, function () {
            select.disabled = false;
            var retry = button(label('lang_desktop_retry', 'Try again'), function () { retry.remove(); requestOptions(id, url, get); });
            retry.title = label('lang_could_not_load_the_list', 'Could not load the list'); select.after(retry);
        });
    }
    function photoPicker() {
        var box = el('photo-list'); box.replaceChildren();
        photos.forEach(function (photo, i) {
            var tile = document.createElement('div'); tile.className = 'iv2-photo';
            var img = document.createElement('img'); img.src = photo.preview; img.alt = photo.name; tile.appendChild(img);
            var cover = button(photo.cover === 'yes' ? label('lang_cover_image', 'Cover image') : label('lang_choose_cover', 'Choose cover'), function () {
                photos.forEach(function (p) { p.cover = 'no'; }); photo.cover = 'yes'; photoPicker(); notify();
            }); cover.setAttribute('aria-pressed', String(photo.cover === 'yes')); tile.appendChild(cover);
            tile.appendChild(button(label('lang_remove', 'Remove'), function () {
                photos.splice(i, 1); if (photos.length && !photos.some(function (p) { return p.cover === 'yes'; })) photos[0].cover = 'yes';
                photoPicker(); notify();
            })); box.appendChild(tile);
        });
        document.querySelectorAll('#iv2-variant-rows [data-field="photo"]').forEach(function (select) {
            var previous = select.value; select.replaceChildren(new Option(label('lang_default', 'Default'), ''));
            photos.forEach(function (p) { select.add(new Option(p.name, p.name)); }); select.value = previous;
        });
    }
    function readPhotos(event) {
        var files = Array.from(event.target.files), token = generation;
        if (photos.length + reading + files.length > 12) { report(label('lang_you_can_upload_up_to_12_files', 'You can upload up to 12 files.')); event.target.value = ''; return; }
        if (files.some(function (f) { return !/^image\/(png|jpeg|gif|bmp)$/.test(f.type) || f.size > 5242880; })) {
            report('Choose PNG, JPEG, GIF or BMP images under 5 MB each.'); event.target.value = ''; return;
        }
        files.forEach(function (file) {
            reading++;
            var reader = new FileReader();
            reader.onload = function () {
                if (token !== generation) return;
                var name = file.name, n = 2;
                while (photos.some(function (p) { return p.name === name; })) name = n++ + '-' + file.name;
                photos.push({ name: name, size: file.size, data: String(reader.result).split(',')[1], preview: reader.result, cover: photos.length ? 'no' : 'yes' });
                reading--; photoPicker(); notify();
            };
            reader.onerror = function () { if (token === generation) { reading--; report('Could not read ' + file.name + '. Please choose it again.'); } };
            reader.readAsDataURL(file);
        }); event.target.value = '';
    }
    function variantFields() {
        return [['selling_price','Selling price','number'],['available_quantity','Opening stock','number'],['sku_id','SKU','text'],['barcode_id','Barcode','text'],['gtin','GTIN / EAN','text'],['company_price','Cost price','number'],['mrp_price','M.R.P','number'],['position','Item Position','number'],['discount_amount','Discount amount','number'],['discount_percentage','Discount percentage','number']];
    }
    function captureVariants() {
        document.querySelectorAll('#iv2-variant-rows .iv2-variant').forEach(function (card, i) {
            card.querySelectorAll('[data-field]').forEach(function (input) { variants[i][input.dataset.field] = input.value; });
        });
    }
    function variantSignature() { return JSON.stringify([val('axis1'),val('values1'),val('axis2'),val('values2')]); }
    function generate() {
        var names = combinations(val('values1'), val('axis2') ? val('values2') : '');
        if (!val('axis1') || names.length < 2 || names.length > 50 || (val('axis2') && !list(val('values2')).length)) {
            report('Enter a variant name and comma-separated values. Create between 2 and 50 combinations.'); return;
        }
        captureVariants(); var previous = new Map(variants.map(function (r) { return [r.variant_value, r]; }));
        variants = names.map(function (name) { return previous.get(name) || { variant_value: name, selling_price: val('price'), available_quantity: '0', company_price: val('cost'), mrp_price: val('mrp'), position: val('position'), discount_amount: val('discount-type') === 'amount' ? val('discount') : '', discount_percentage: val('discount-type') === 'percentage' ? val('discount') : '' }; });
        signature = variantSignature(); var box = el('variant-rows'); box.replaceChildren();
        variants.forEach(function (row, i) {
            var card = document.createElement('div'); card.className = 'iv2-variant'; var heading = document.createElement('h3'); heading.textContent = row.variant_value; card.appendChild(heading);
            var grid = document.createElement('div'); grid.className = 'iv2-grid';
            variantFields().forEach(function (spec) {
                var wrap = document.createElement('div'), lab = document.createElement('label'), input = document.createElement('input');
                input.id = 'iv2-variant-' + i + '-' + spec[0]; lab.htmlFor = input.id; lab.textContent = spec[1]; input.dataset.field = spec[0]; input.type = spec[2];
                if (spec[2] === 'number') { input.min = '0'; input.step = 'any'; }
                if (spec[0] === 'discount_percentage') input.max = '100';
                input.value = row[spec[0]] || ''; wrap.append(lab, input); grid.appendChild(wrap);
            });
            var unitWrap=document.createElement('div'), unitLabel=document.createElement('label'), unitPick=el('unit').cloneNode(true);
            unitPick.id='iv2-variant-'+i+'-unit';unitPick.dataset.field='unit_id';unitPick.disabled=false;unitPick.value=row.unit_id||val('unit');unitLabel.htmlFor=unitPick.id;unitLabel.textContent=label('lang_item_units','Item Units');unitWrap.append(unitLabel,unitPick);grid.appendChild(unitWrap);
            var photoWrap=document.createElement('div');
            var lab = document.createElement('label'); lab.textContent = label('lang_photos', 'Photos');
            var pick = document.createElement('select'); pick.dataset.field = 'photo'; pick.id = 'iv2-variant-' + i + '-photo'; lab.htmlFor = pick.id; photoWrap.append(lab,pick);grid.appendChild(photoWrap);
            card.appendChild(grid); box.appendChild(card);
        }); photoPicker();
        document.querySelectorAll('#iv2-variant-rows [data-field="photo"]').forEach(function(pick,i){pick.value=variants[i].photo||'';}); notify();
    }
    function isFamily() { return checked('has-variants') && document.querySelector('#items_v2 [name="iv2-kind"]:checked').value !== 'service'; }
    function validate() {
        var invalid = document.querySelector('#iv2-fields input:invalid, #iv2-fields select:invalid, #iv2-fields textarea:invalid');
        if (invalid) return { error: invalid.validationMessage, field: invalid.id };
        if (reading) return error('Wait for the selected photos to finish loading.', 'photos');
        if (!P.itemTranslationsV2.ready()) return error(label('lang_item_ai_finish', 'Wait for the suggestion, then keep or cancel it before saving.'), 'item_translation_ai');
        if (val('pack-size') && !(Number(val('pack-size')) > 0)) return error('Units per pack must be greater than zero.', 'pack-size');
        if (val('expiry') && val('mfg') && val('expiry') < val('mfg')) return error('Expiry date must not be earlier than manufacture date.', 'expiry');
        if (!validGtin(val('gtin')) && !isFamily()) return error('Enter a valid GTIN with a matching check digit.', 'gtin');
        if (isFamily()) {
            captureVariants();
            if (variants.length < 2 || variantSignature() !== signature) return error('Generate the variants after choosing their names and values.', 'values1');
            var codes = new Set();
            for (var i=0;i<variants.length;i++) {
                var row=variants[i];
                if (!validGtin(row.gtin)) return error('Enter a valid GTIN for ' + row.variant_value + '.', 'variant-'+i+'-gtin');
                for (var code of [row.barcode_id, row.gtin].filter(Boolean)) {
                    if (codes.has(code)) return error('Each variant needs its own barcode or GTIN.', 'variant-'+i+'-barcode_id');
                }
                [row.barcode_id,row.gtin].filter(Boolean).forEach(function (code) { codes.add(code); });
            }
        }
        return null;
    }
    function upload() {
        var pending=photos.filter(function(p){return !p.uploaded;});
        if(!pending.length)return Promise.resolve();
        return new Promise(function(resolve,reject){
            P.post({url:'items/uploadItemMultiImage',data:JSON.stringify({items_image:pending.map(function(p){return {name:p.name,size:p.size,data:p.data,cover:p.cover};})})},function(r){
                if(!r||r.type!=='success'||!Array.isArray(r.data)||r.data.length!==pending.length||r.data.some(function(p){return !p.name;})){reject(new Error(r&&r.message||'Image upload failed. Your item has not been saved.'));return;}
                pending.forEach(function(p,i){p.uploaded=r.data[i].name;});resolve();
            },function(){reject(new Error('Image upload failed. Your entries are still here. Please try again.'));});
        });
    }
    function data() {
        var u = option('unit'), supplier = option('supplier'), auto = checked('auto-tile') && P.autoTile ? P.autoTile(val('name')) : null;
        var out = { mrp_price: Number(val('mrp')), reorder_point: number('reorder'), unit_id: val('unit') === 'qty' ? '' : val('unit'), unit: u && u.dataset.unit || 'qty', supplier_id: val('supplier'), supplier_name: supplier && supplier.dataset.name || '',
            open_price: checked('open-price'), service_unit: val('service-unit'), item_weight_machine_based: caps.weight && checked('weight'),
            discount_amount: val('discount-type') === 'amount' ? Number(val('discount')) : 0, discount_percentage: val('discount-type') === 'percentage' ? Number(val('discount')) : 0,
            plu_code: val('plu'), gtin: val('gtin'), barcodes: list(val('alt-barcodes')), purchase_unit: val('purchase-unit'), conversion_factor: number('pack-size'), brand: val('brand'), tags: list(val('tags')), position: Number(val('position')),
            items_mfg_date: val('mfg'), items_expiry_date: val('expiry'), icon: val('icon'), tile_color: auto ? auto.color : val('tile-color'), tile_shape: auto ? auto.shape : val('tile-shape'),
            image: photos.map(function (p) { return { name:p.uploaded||p.name, size:p.size, cover:p.cover }; }), cover_image: (function(){var p=photos.find(function(p){return p.cover==='yes';});return p?(p.uploaded||p.name):'item.svg';}()), channel_off: selected('channel-off') };
        Object.assign(out, P.itemTranslationsV2.data());
        if (caps.tax && val('hsn')) Object.assign(out, { tax_method: 'hsn', hsn_code: val('hsn'), hsn_description: val('hsn-description'), tax: Number(val('hsn-rate')), tax_id: '', tax_name: '' });
        if (caps.restaurant && document.querySelector('#items_v2 [name="iv2-kind"]:checked').value !== 'service') {
            out.prep_minutes = Number(val('prep-minutes')); out.prep_note = val('prep-note'); out.goes_with = selected('goes-with'); out.nutrition = {};
            nutrients.forEach(function (n) { if (val('n-'+n)) out.nutrition[n]=Number(val('n-'+n)); });
            out.food_tags=foodTags.filter(function (k) {return checked('food-'+k);}); out.menu_marks=marks.filter(function (k) {return checked('mark-'+k);}); out.spice_choice=checked('spice');
        }
        return out;
    }
    function family(shared) {
        captureVariants(); return { variant_axis: [val('axis1'),val('axis2')].filter(Boolean).join(' / '), variant_parent_name: shared.name, items: variants.map(function (row) {
            var image=photos.find(function (p) {return p.name===row.photo;});
            var r=Object.assign({},shared,row,{name:shared.name+' / '+row.variant_value,barcodes:[],plu_code:'',sku_id:row.sku_id||'',barcode_id:row.barcode_id||'',gtin:row.gtin||'',available_quantity:shared.inventory?Number(row.available_quantity):0});
            var unitOption=Array.from(el('unit').options).find(function(o){return o.value===row.unit_id;});
            r.unit_id=row.unit_id==='qty'?'':row.unit_id||shared.unit_id;r.unit=unitOption&&unitOption.dataset.unit||shared.unit;
            r.translations=(shared.translations||[]).map(function (t) {return Object.assign({},t,{name:t.name?t.name+' / '+row.variant_value:''});});
            if(image) {r.image=[{name:image.uploaded||image.name,size:image.size,cover:'yes'}];r.cover_image=image.uploaded||image.name;}
            delete r.photo; return r;
        }) };
    }
    function status() {
        captureVariants(); return { family: isFamily(), openPrice: checked('open-price'), prices: variants.map(function(r){return Number(r.selling_price);}), quantities: variants.map(function(r){return Number(r.available_quantity);}), hsn: caps.tax && !!val('hsn'), tax: Number(val('hsn-rate')), discount: Number(val('discount')), discountType: val('discount-type') };
    }
    function update(capabilities, kind) {
        caps=capabilities;
        el('food-extra').hidden=!caps.restaurant || kind==='service'; el('tax-extra').hidden=!caps.tax;
        el('service-unit').parentElement.hidden=kind!=='service'; el('variants').hidden=kind==='service'; el('variant-editor').hidden=!isFamily();
        ['food-extra','tax-extra','variants'].forEach(function(id){el(id).querySelectorAll('input,select,textarea,button').forEach(function(input){input.disabled=el(id).hidden;});});
        ['reorder','purchase-unit','pack-size','weight'].forEach(function(id){el(id).closest(id==='weight'?'label':'div').hidden=kind==='service';});
        ['plu','sku','barcode','gtin','alt-barcodes','same-sku'].forEach(function(id){el(id).disabled=isFamily();});
        el('variant-editor').querySelectorAll('input,select,button').forEach(function(input){input.disabled=!isFamily();});
        el('weight').closest('label').hidden=!caps.weight || kind==='service';
        el('weight').disabled=!caps.weight || kind==='service';
        el('discount').max=val('discount-type')==='percentage'?'100':'';
        el('tile-color').disabled=checked('auto-tile'); el('tile-shape').disabled=checked('auto-tile');
        if(checked('same-sku')&&!isFamily())el('barcode').value=val('sku');
        el('barcode').readOnly=checked('same-sku');
        var preview=document.querySelector('#items_v2 .iv2-item-icon');
        preview.textContent=val('icon')||'▦';
        preview.style.background=checked('auto-tile')&&P.autoTile?P.autoTile(val('name')).color:val('tile-color');preview.style.color='white';
    }
    function reset() {generation++;reading=0;photos=[];variants=[];signature='';el('variant-rows').replaceChildren();el('auto-tile').checked=true;photoPicker();P.itemTranslationsV2.reset();}
    function init() {
        if(initialized)return;initialized=true;
        el('photos').addEventListener('change',readPhotos);
        var palette=document.createElement('div');palette.className='iv2-icon-palette';
        ['📦','👕','👟','👜','📱','📚','🧴','✂️','🔧','☕','🍵','🍛','🍜','🍕','🥪','🥗','🍰','🍨','🥤','💧'].forEach(function(icon){var pick=button(icon,function(){el('icon').value=icon;notify();});pick.setAttribute('aria-label',icon);palette.appendChild(pick);});el('icon').after(palette);
        el('form').addEventListener('click',function(e){var target=e.target.closest('[data-iv2-advanced]');if(target&&target.dataset.iv2Advanced==='generate')generate();});
        requestOptions('unit','setting/getUnitAjaxList',function(r){return {id:r.unit_id,name:r.unit_name,unit:r.unit_value};});
        requestOptions('supplier','suppliers/getSuppliersAjaxList',function(r){return {id:r.id,name:r.name};});
        requestOptions('goes-with','items',function(r){return {id:r.id||r._id,name:r.name||r.value};});
        var channels=P.itemChannels;
        if(channels) {
            var live=channels.liveChannels();fill('channel-off',channels.CHANNELS.filter(function(c){return live.includes(c.id);}),function(c){return {id:c.id,name:channels.labelFor(c)};});
            P.get({url:'settings/group/channels',data:{}},function(r){var values=r&&r.data&&r.data.values||{};fill('channel-off',(values.sales_channel_partners||[]).filter(function(p){return p.enabled!==false&&live.includes(p.channel||'marketplace');}),function(p){return {id:p.id,name:p.label||p.id};});},function(){});
        }
        reset();
    }
    P.itemsV2Details={init:init,reset:reset,upload:upload,data:data,validate:validate,update:update,status:status,family:family};
}(typeof window==='undefined'?globalThis:window));
