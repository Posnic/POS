/* Signed sales-workspace extensions operate on the current sale in a dialog.
 * No browser session or privileged API is passed into the extension frame. */
(function () {
  'use strict';
  var selected = null, dialog = null;
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
  function close() { if (dialog) dialog.remove(); dialog=null; PosnicPro.extensions.closeEmbedded(); }
  function open(action, page) {
    if (!selected || dialog) return;
    try {
      if (!/^#\/?sales\/new(?:$|\?)/.test(location.hash) || PosnicPro.sales.SaleAction !== 'add') throw Error('Open a new sale to use these actions.');
      var lines = page ? [] : cart();
      if (!page && !lines.length) throw Error('Add at least one product.');
      // Preserve exact cart ownership until the host confirms its durable basket.
      var before = JSON.stringify(lines), transferred=false;
      dialog=document.createElement('section'); dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Sale actions');dialog.setAttribute('aria-modal','true');
      dialog.style.cssText='position:fixed;inset:3vh 3vw;z-index:10550;background:white;color:#172b4d;border:2px solid #ddd;box-shadow:0 0 0 100vmax #0008;border-radius:10px;padding:12px;overflow:auto';
      var back=document.createElement('button');back.type='button';back.className='btn btn-secondary';back.textContent='Back to sale';
      // Closing a payment preparation leaves its persisted basket in Adjust Basket.
      back.onclick=close;
      var content=document.createElement('div');content.textContent='Loading sale actions…';dialog.append(back,content);document.body.append(dialog);
      PosnicPro.HideSideBarModal();
      PosnicPro.extensions.showDetails(selected.id, {container:content,workspace:{action:action,page:page,lines:lines,customer:String($('#sales_new_customer_name').val()||'Walk-in customer').slice(0,120)},onBusy:function(busy){back.disabled=busy;},onCommand:function(result){
        if (!transferred && lines.length && result && result.basketId) {
          transferred=true;
          if (JSON.stringify(cart())===before) PosnicPro.sales.clear.cartItems(false);
        }
      }});
    } catch (error) { PosnicPro.alert('error',error.message); }
  }
  function strip(folderOnly) {
    var el=document.createElement('div');el.className='sale-extension-actions';el.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:10px 0';
    var actions=folderOnly ? [['Adjust Basket','review'],['Completed Sales / Receipts','sales'],['Daily / Monthly Report','reports']] : [['Cash Pay','cash'],['Card Pay','card'],['Confirm Sale','confirm'],['Adjust Stock','adjust'],['Hold / Next customer','next'],['Print transaction','print']];
    actions.forEach(function(pair){var b=document.createElement('button');b.type='button';b.textContent=pair[0];b.className='btn '+(pair[1]==='adjust'?'btn-danger':'btn-primary');b.onclick=function(){if(folderOnly)return open(null,pair[1]);var action=pair[1];if(action==='confirm')action=String($('#payment_id .payment_mode:checked').attr('id')||'Cash').toLowerCase()==='card'?'card':'cash';open(action);};el.append(b);});return el;
  }
  function render() {
    if (!selected) return;
    var sale=document.getElementById('sales_new');
    if(sale && !sale.querySelector('.sale-extension-folders')) {var folders=strip(true);folders.classList.add('sale-extension-folders');(sale.querySelector('#sale-header-actions')||sale.querySelector('.contentbar')||sale).append(folders);}
    var pay=document.getElementById('sales_save_button');
    if(pay && !document.getElementById('sale-extension-checkout')) {var controls=strip(false);controls.id='sale-extension-checkout';var totals=document.getElementById('paymentdisplay');(totals||pay.parentElement).before(controls);}
    var payment=document.getElementById('payment_id');
    if(payment && !document.getElementById('sale-extension-payment')) {var controls=strip(false);controls.id='sale-extension-payment';payment.after(controls);}
    var visible=/^#\/?sales\/new(?:$|\?)/.test(location.hash) && PosnicPro.sales?.SaleAction==='add';
    document.querySelectorAll('.sale-extension-actions').forEach(function(el){el.hidden=!visible;el.style.display=visible?'flex':'none';});
  }
  PosnicPro.saleExtensions={active:function(){return Boolean(selected) && /^#\/?sales\/new(?:$|\?)/.test(location.hash) && PosnicPro.sales.SaleAction==='add';},configure:function(extensions){selected=extensions.find(function(e){return e.enabled!==false&&e.salesWorkspace===true;})||null;render();},open:open};
  // Tender and sales modules are inserted/rebuilt asynchronously by the host.
  var queued=false;
  new MutationObserver(function(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;render();});}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',function(event){if(PosnicPro.saleExtensions.active() && event.target.closest('#holdSaleButton')){event.preventDefault();event.stopImmediatePropagation();open('next');}},true);
  window.addEventListener('hashchange',function(){if(dialog)close();render();});
})();
