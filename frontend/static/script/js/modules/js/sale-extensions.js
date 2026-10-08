/* Signed sales-workspace extensions operate on the current sale in a dialog.
 * No browser session or privileged API is passed into the extension frame. */
(function () {
  'use strict';
  var selected = null, dialog = null, resumeContext = null, restoring = false;
  var icons = {cash:'<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',card:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 15h4"/>',box:'<path d="m12 2 10 5v10l-10 5-10-5V7Zm0 10v10M2 7l10 5 10-5M7 4.5l10 5"/>',pause:'<rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/>',printer:'<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6ZM17 12h.01"/>'};
  function icon(name) { var span=document.createElement('span');span.setAttribute('aria-hidden','true');span.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(icons[name]||'')+'</svg>';return span; }
  var css=document.createElement('style');css.textContent=`
  #sales_new.touch-extension #instance-view{display:flex;flex-direction:column;height:var(--sale-pane-height,70vh);min-height:420px;background:#fff;border:1px solid #dce4ed;border-radius:12px;padding:12px;box-shadow:0 2px 8px #18385808}
  #sales_new.touch-extension #viewtest{background:#fff;border-radius:8px}
  #sales_new.touch-extension #sales_new_items_table{background:#fff}
  #sales_new.touch-extension #sales_new_items_table tbody td{border-bottom:1px solid #edf1f5}
  #sales_new.touch-extension #paymentdisplay{border-top:1px solid #dce4ed;padding-top:8px}
  #sales_new.touch-extension #viewtest{flex:1 1 auto;min-height:90px;overflow:auto;margin-bottom:8px}
  #sales_new.touch-extension #sales_table,#sales_new.touch-extension #sales_table>.table-responsive{height:auto!important;max-height:none!important;overflow:visible}
  #sales_new.touch-extension .sales-cart-image{height:100px!important;width:auto!important;display:block;margin:auto}
  #sales_new.touch-extension #sales_new_items_table thead{position:sticky;top:0;background:#f5f7fa;z-index:1}
  #sales_new.touch-extension #paymentdisplay{flex:0 0 auto;display:grid;grid-template-columns:1fr 1fr}
  #sales_new.touch-extension #paymentdisplay tbody,#sales_new.touch-extension #paymentdisplay tr{display:contents}
  #sales_new.touch-extension #paymentdisplay #payment_note{grid-column:1/-1;max-width:none;border-bottom:1px solid #e0e6ed}
  #sales_new.touch-extension #paymentdisplay .sale-actionbar{display:flex;flex-wrap:wrap;gap:5px}
  #sales_new.touch-extension #paymentdisplay #return_discount{grid-column:auto}
  #sales_new.touch-extension #paymentdisplay #pay_hide,#sales_new.touch-extension #paymentdisplay #pay_total_hide{background:#edf5ff;padding:8px}
  #sales_new.touch-extension #paymentdisplay td{padding:6px 8px;width:auto!important;height:auto!important;min-height:32px;line-height:1.4}
  #sales_new.touch-extension #edit_style_button{display:none!important}
  #sales_new.touch-extension #payment_note{max-width:280px}
  #sales_new.touch-extension #pay_total_hide{font-size:26px;font-weight:700;color:#066bca!important}
  #sales_new.touch-extension #pay_hide{font-size:17px}
  #sales_new.touch-extension #sale-extension-checkout{flex:none;gap:10px!important;margin:10px 0 0!important}
  #sales_new.touch-extension #sale-extension-checkout button{min-height:58px!important;display:flex;align-items:center;justify-content:center;gap:12px;font-size:17px;font-weight:600;border-radius:8px;padding:10px}
  #sales_new.touch-extension #sale-extension-checkout .btn-secondary{background:#fff;color:#17548d;border:1px solid #cbdbea}
  #sales_new.touch-extension #sale-extension-checkout .sale-clear{color:#b3293e;background:#fff;border:1px solid #e6cbd1}
  #sales_new.touch-extension #sales_new_items_table .input-group button,#sales_new.touch-extension #sales_new_items_table .input-group input{min-height:48px;min-width:44px}
  #sales_new.touch-extension #sales_new_items_table .button_qty_check{min-height:48px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}
  #sales_new.touch-extension #sales_new_items_table .button_qty_check i{margin:0!important}
  #sales_new.touch-extension #sales_new_items_table .sale-line-act{min-width:44px;min-height:48px;display:inline-flex;align-items:center;justify-content:center}
  #sales_new.touch-extension #sales_new_items_table td:last-of-type a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:48px}
  #sales_new.touch-extension #sales_new_productList,#sales_new.touch-extension #sales_new_categoryList{max-height:calc(var(--sale-pane-height,70vh) - 100px)!important;overflow:auto}
  .sale-extension-back{width:48px;height:48px;min-width:48px;padding:0!important;border:1px solid #dce4ed!important;border-radius:8px;background:#f5f8fc!important;color:#17548d!important;font-size:28px;line-height:1;display:flex;align-items:center;justify-content:center}
  .sale-extension-back:hover{background:#e9f2ff!important;border-color:#8eb9e6!important}
  .sale-extension-back:focus-visible{outline:3px solid #066bca;outline-offset:2px}
  @media(min-width:768px) and (max-height:800px){
   #sales_new.touch-extension #sales_new_items_table th{padding:6px 8px}
   #sales_new.touch-extension #sales_new_items_table td{padding:4px 8px}
   #sales_new.touch-extension #paymentdisplay td{padding:4px 8px;min-height:28px}
   #sales_new.touch-extension #sale-extension-checkout{gap:8px!important}
   #sales_new.touch-extension #sale-extension-checkout button{min-height:52px!important;padding:8px}
  }
  @media(max-width:1400px){
   #sales_new.touch-extension #sales_new_items_table th:nth-child(3),#sales_new.touch-extension #sales_new_items_table th:nth-child(5),#sales_new.touch-extension #sales_new_items_table th:nth-child(6),#sales_new.touch-extension #sales_new_items_table td[name="addSalesLineItemUnit"],#sales_new.touch-extension #sales_new_items_table td[id^="addSalesLineItemDiscountprint_"],#sales_new.touch-extension #sales_new_items_table td[name="addSalesLineItemTax"]{display:none}
   #sales_new.touch-extension #sales_new_items_table td[id^="addSalesLineItemName_"]{min-width:100px;width:auto!important}
  }
  @media(max-width:767px){#sales_new.touch-extension #instance-view{height:auto;min-height:0}#sales_new.touch-extension #viewtest{max-height:38vh}#sales_new.touch-extension #sale-extension-checkout{position:sticky;bottom:0;background:#f5f7fa;padding:10px 0;z-index:2}}
  `;document.head.append(css);
  function cart() {
    return Array.from(document.querySelectorAll('#sales_new_items_table tbody tr')).map(function (row) {
      var item = row.querySelector('[id^="addSalesLineItemId_"]');
      if (!item) return null;
      var id = item.textContent.trim();
      var read = function (prefix) { var node = document.getElementById(prefix + id); return node ? (node.value === undefined ? node.textContent : node.value) : ''; };
      var quantity = Number(read('touchsale_item_qty'));
      var total = Number(read('addSalesLineTotal_').replace(/,/g, ''));
      var price = Number(read('saleInlineItemPrice_'));
      if (!/^[a-f0-9]{24}$/i.test(id) || !(quantity > 0) || !Number.isFinite(price) || !Number.isFinite(total)) throw Error('Review the product price and quantity before continuing.');
      return {productId:id, quantityMilli:Math.round(quantity*1000), sellingPrice:price, expectedLineMinor:Math.round(total*100), priceMinor:Math.round(total / quantity * 100), description:read('addSalesLineItemName_')};
    }).filter(Boolean);
  }
  function notice(message) {
    document.getElementById('sale-extension-notice')?.remove();
    if(typeof message!=='string' || !message.trim())return;
    var escaped=message.slice(0,300).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    PosnicPro.alert('success',escaped,3500);
  }
  function refreshStock() {
    if(!PosnicPro.sales.loadBillingCatalogue)return;
    var branch=String(PosnicPro.local?.get('branch_id_set')||'');
    PosnicPro.sales.loadBillingCatalogue(function(response){
      if(branch!==String(PosnicPro.local?.get('branch_id_set')||'') || !active())return;
      if(response?.type!=='success'){PosnicPro.alert('error','Stock display could not refresh. Refresh Sales before checking availability.');return;}
      var items=new Map(),families={};
      response.data.forEach(function(item){items.set(String(item.id||item.item_id),item);if(item.variant_group_id)(families[item.variant_group_id]||(families[item.variant_group_id]=[])).push(item);});
      if(PosnicPro.sales.itemsMenu)PosnicPro.sales.itemsMenu._families=families;
      document.querySelectorAll('#sales_new .wsk-cp').forEach(function(tile){
        var rows=tile.dataset.variantGroup?families[tile.dataset.variantGroup]:[items.get(tile.id)];
        if(!rows || !rows[0])return;
        var tracked=rows.filter(function(r){return r.track_inventory===true || r.track_inventory==='true';}),stock=tile.querySelector('.wsk-cp-stock');
        if(stock)stock.textContent=tracked.length?tracked.reduce(function(sum,r){return sum+(Number(r.available_quantity)||0);},0)+' in stock':'';
      });
    },true);
  }
  function confirmClear() {
    if(document.getElementById('sale-clear-dialog') || dialog || !cart().length)return;
    var before=JSON.stringify(cart()), modal=document.createElement('dialog');modal.id='sale-clear-dialog';modal.setAttribute('aria-labelledby','sale-clear-title');
    modal.style.cssText='width:min(520px,94vw);border:0;border-radius:12px;padding:24px;color:#172b4d;box-shadow:0 16px 60px #0004';
    modal.innerHTML='<h2 id="sale-clear-title">Clear this sale?</h2><p>Remove all items from the current sale. Saved held baskets will remain available.</p><footer style="display:flex;gap:12px;margin-top:24px"><button type="button" class="btn btn-secondary" autofocus>Keep sale</button><button type="button" class="btn btn-danger">Clear sale</button></footer>';
    modal.querySelectorAll('button').forEach(function(b){b.style.cssText='flex:1;min-height:52px;font-size:16px;border-radius:8px';});
    function dismiss(){modal.close();modal.remove();document.getElementById('sales_new_item_name')?.focus({preventScroll:true});}
    modal.querySelector('.btn-secondary').onclick=dismiss;modal.addEventListener('cancel',function(e){e.preventDefault();dismiss();});
    modal.querySelector('.btn-danger').onclick=function(){if(JSON.stringify(cart())!==before){dismiss();PosnicPro.alert('error','The sale changed. Review it before clearing.');return;}resumeContext=null;PosnicPro.sales.clear.cartItems(false);dismiss();notice('Sale cleared. Ready for the next customer.');};
    document.body.append(modal);modal.showModal();
  }
  function close(result) { if (dialog) { dialog.remove(); dialog=null; PosnicPro.extensions.closeEmbedded();
    if (/^#\/?sales\/new(?:$|\?)/.test(location.hash)) {
      var scanner = document.getElementById('sales_new_item_name');
      if (scanner && !scanner.disabled && scanner.getClientRects().length) scanner.focus({preventScroll:true});
    }
    if(result && typeof result.message==='string')notice(result.message);
  } }
  function open(action, page) {
    if (!selected || dialog) return;
    try {
      if (!/^#\/?sales\/new(?:$|\?)/.test(location.hash) || PosnicPro.sales.SaleAction !== 'add') throw Error('Open a new sale to use these actions.');
      var lines = page ? [] : cart();
      if (!page && !lines.length) throw Error('Add at least one product.');
      // Preserve exact cart ownership until the host confirms its durable basket.
      var before = JSON.stringify(lines), transferred=false;
      var compact = !page && selected.salesWorkspace.policies?.compactCheckout === true;
      dialog=document.createElement('section'); dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Sale actions');dialog.setAttribute('aria-modal','true');
      dialog.style.cssText='position:fixed;inset:3vh 3vw;z-index:10550;background:white;color:#172b4d;border:2px solid #ddd;box-shadow:0 0 0 100vmax #0008;border-radius:10px;padding:12px;overflow:auto';
      if (compact) { dialog.dataset.presentation='compact'; dialog.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(620px,94vw);max-height:94vh;z-index:10550;background:white;color:#172b4d;box-shadow:0 0 0 100vmax #0008;border-radius:10px;padding:16px;overflow:auto'; }
      notice('');
      var header=document.createElement('div');header.style.cssText='display:flex;justify-content:flex-end;margin-bottom:8px';
      var back=document.createElement('button');back.type='button';back.className='btn sale-extension-back';back.innerHTML='<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';back.setAttribute('aria-label','Close and return to sale');back.title='Close and return to sale. Any pending payment stays saved.';
      // Closing leaves any persisted extension transaction available in its own workflow.
      back.onclick=function(){close();};
      var content=document.createElement('div');content.textContent='Loading sale actions…';header.append(back);dialog.append(header,content);document.body.append(dialog);
      PosnicPro.HideSideBarModal();
      PosnicPro.extensions.showDetails(selected.id, {container:content,onClose:close,workspace:{version:1,presentation:compact?'compact':'workspace',action:action,page:page,lines:lines,context:!page?resumeContext:null,tender:String($('#payment_id .payment_mode:checked').attr('id')||'Cash').toLowerCase(),customer:String($('#sales_new_customer_name').val()||'Walk-in customer').slice(0,120)},onBusy:function(busy){back.disabled=busy;},onCommand:function(result,commandType){
        if(result)refreshStock();
        if (!transferred && lines.length && result && selected.salesWorkspace.clearCartOn?.includes(commandType)) {
          transferred=true;
          resumeContext=null;
          if (JSON.stringify(cart())===before) PosnicPro.sales.clear.cartItems(false);
        }
      }});
    } catch (error) { PosnicPro.alert('error',error.message); }
  }
  function strip(placement) {
    var el=document.createElement('div');el.className='sale-extension-actions';el.dataset.placement=placement;el.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:10px 0';
    if(placement==='sale') { el.style.gridTemplateColumns='repeat(2,minmax(0,1fr))'; }
    var controls=selected.salesWorkspace.controls.filter(function(c){return c.placements.includes(placement);});
    controls.forEach(function(c){
      var b=document.createElement('button');b.type='button';b.textContent=c.label;b.dataset.extensionControl=c.id;b.className='btn btn-'+c.tone;
      if(c.icon)b.prepend(icon(c.icon));
      b.style.minHeight='44px';b.style.whiteSpace='normal';b.onclick=function(){open(c.action,c.page);};el.append(b);
    });
    if(placement==='sale' && selected.salesWorkspace.policies?.touchCheckout){var clear=document.createElement('button');clear.type='button';clear.className='btn sale-clear';clear.textContent='Clear sale';clear.onclick=confirmClear;el.append(clear);}
    if(placement==='sale' && el.children.length%2===1)el.lastElementChild.style.gridColumn='1 / -1';return el;
  }
  function render() {
    var sale=document.getElementById('sales_new');
    if(resumeContext && !dialog && !restoring && !document.querySelector('#sales_new_items_table [id^="addSalesLineItemId_"]'))resumeContext=null;
    var visible=Boolean(selected) && /^#\/?sales\/new(?:$|\?)/.test(location.hash) && PosnicPro.sales?.SaleAction==='add';
    sale?.classList.toggle('touch-extension',visible && selected.salesWorkspace.policies?.touchCheckout===true);
    if (!selected) return;
    if(sale && !sale.querySelector('.sale-extension-folders')) {var folders=strip('header');folders.classList.add('sale-extension-folders');(sale.querySelector('#sale-header-actions')||sale.querySelector('.contentbar')||sale).append(folders);}
    var pay=document.getElementById('sales_save_button');
    if(pay && !document.getElementById('sale-extension-checkout')) {var controls=strip('sale');controls.id='sale-extension-checkout';var totals=document.getElementById('paymentdisplay');if(selected.salesWorkspace.policies?.touchCheckout && totals)totals.after(controls);else (totals||pay.parentElement).before(controls);}
    var payment=document.getElementById('payment_id');
    if(payment && selected.salesWorkspace.controls.some(function(c){return c.placements.includes('payment');}) && !document.getElementById('sale-extension-payment')) {var controls=strip('payment');controls.id='sale-extension-payment';payment.after(controls);}
    document.querySelectorAll('.sale-extension-actions').forEach(function(el){el.hidden=!visible;el.style.display=visible?(el.dataset.placement==='sale'?'grid':'flex'):'none';});
    var pane=document.getElementById('instance-view');if(visible && pane)sale.style.setProperty('--sale-pane-height',Math.max(420,window.innerHeight-(pane.getBoundingClientRect().top+window.scrollY)-16)+'px');
  }
  function active(){return Boolean(selected) && /^#\/?sales\/new(?:$|\?)/.test(location.hash) && PosnicPro.sales.SaleAction==='add';}
  PosnicPro.saleExtensions={active:active,policy:function(name){return active() && selected.salesWorkspace.policies?.[name]===true;},dispatch:function(event){
    var action=active() && selected.salesWorkspace.events?.[event];if(!action)return false;open(action);return true;
  },configure:function(extensions){
    // More than one owner must never silently redirect checkout to the first.
    var owners=extensions.filter(function(e){return e.enabled!==false && e.salesWorkspace?.version===1 && Array.isArray(e.salesWorkspace.controls);});
    var next=owners.length===1 ? owners[0] : null;
    if(JSON.stringify(selected)!==JSON.stringify(next)){close();resumeContext=null;document.querySelectorAll('.sale-extension-actions').forEach(function(el){el.remove();});}
    selected=next;render();
    if(owners.length>1)PosnicPro.alert('error', PosnicPro.i18n.t('lang_multiple_extensions_request_the_sales_work', 'Multiple extensions request the sales workspace. Enable only one sales workspace provider.'));
  },open:open,restore:async function(id,input,branch){
    if(!selected || selected.id!==id || restoring)throw Error('This extension cannot open Sales.');
    input=input||{};var lines=input.lines||[];
    if(!Array.isArray(lines)||lines.length>200||lines.some(function(l){return !/^[a-f0-9]{24}$/i.test(l.productId)||!Number.isSafeInteger(l.quantityMilli)||l.quantityMilli<=0||!Number.isFinite(l.sellingPrice)||l.sellingPrice<0;}))throw Error('Invalid saved sale.');
    if(lines.length && cart().length)throw Error('Hold or clear the current sale before opening another basket.');
    if(input.context && JSON.stringify(input.context).length>1024)throw Error('Invalid sale context.');
    restoring=true;
    try{
      var response=lines.length?await new Promise(function(resolve){PosnicPro.sales.loadBillingCatalogue(resolve,true);}):{type:'success',data:[]};
      if(response.type!=='success')throw Error('Products could not be loaded. Try again.');
      if(branch!==String(PosnicPro.local.get('branch_id_set')||'') || (lines.length && cart().length) || selected?.id!==id)throw Error('The shop or current sale changed. Try again.');
      var items=lines.map(function(line){var item=response.data.find(function(p){return String(p.id||p.item_id)===line.productId;});if(!item)throw Error('A saved product is unavailable. Review the basket before resuming.');return Object.assign({},item,{available_quantity:Number(item.available_quantity)||0,id:line.productId,item_quantity:line.quantityMilli/1000,selling_price:line.sellingPrice,mrp_price:line.sellingPrice,discount_amount:0,discount_percentage:0,_modifiersResolved:true,_priceAsked:true});});
      if(!/^#\/?sales\/new(?:$|\?)/.test(location.hash)){
        location.hash='#/sales/new';
        await new Promise(function(resolve,reject){var until=Date.now()+8000;function ready(){var scanner=document.getElementById('sales_new_item_name');if(scanner?.getClientRects().length && PosnicPro.sales.SaleAction==='add')return resolve();if(Date.now()>until)return reject(Error('Open Sales and try resuming again.'));setTimeout(ready,50);}setTimeout(ready,50);});
      }
      if(branch!==String(PosnicPro.local.get('branch_id_set')||'') || (lines.length && cart().length) || selected?.id!==id)throw Error('The shop or current sale changed. Try again.');
      items.forEach(function(item){PosnicPro.sales.addSalesLineItems(item);});
      if(lines.length)resumeContext=input.context||null;
      if(input.customer)$('#sales_new_customer_name').val(String(input.customer).slice(0,120));
      document.getElementById('sales_new_item_name')?.focus();
      setTimeout(close,0);
      return {opened:true};
    }finally{restoring=false;}
  }};
  // Tender and sales modules are inserted/rebuilt asynchronously by the host.
  var queued=false;
  new MutationObserver(function(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;render();});}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',function(event){if(event.target.closest('#holdSaleButton') && PosnicPro.saleExtensions.dispatch('hold')){event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('hashchange',function(){if(dialog)close();document.getElementById('sale-clear-dialog')?.remove();notice('');render();});
  window.addEventListener('resize',render);
})();



