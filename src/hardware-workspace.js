'use strict';
/* Reorganize existing controls without replacing their IDs, events or IPC routes. */
(function () {
  const t = text => window.DisplayI18n ? window.DisplayI18n.t(text) : text;
  const at = id => document.getElementById(id);
  const make = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls || ''; if (text) { if(window.DisplayI18n) window.DisplayI18n.bind(el,text); else el.textContent=text; } return el; };
  const button = (text, fn) => { const b = make('button', 'btn', text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const panel = (title, nodes) => { const box = make('section', 'hw-panel'); if (title) box.append(make('h3', '', title)); nodes.filter(Boolean).forEach(n => box.append(n)); return box; };
  const details = (title, nodes) => { const el = make('details', 'hw-details'); el.append(make('summary', '', title)); nodes.filter(Boolean).forEach(n => el.append(n)); return el; };
  const shopButton = (label, section) => button(label, async () => {
    try { if (!await window.electronAPI.desktop.open('shop:' + section)) throw Error('Open the main Posnic window and sign in first.'); }
    catch (error) { window.alert(error.message || 'Could not open shop settings.'); }
  });
  function heading(id, title, subtitle) {
    const h = make('header', 'hw-heading'); h.append(make('h2', '', title), make('p', '', subtitle)); at(id).prepend(h);
  }
  function sections(host, groups) {
    const nav = make('div', 'hw-subnav'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Settings sections');
    const panes = groups.map(([title, nodes], index) => {
      const pane = make('section', 'hw-pane'); pane.id = host.id + '-section-' + index;
      pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', pane.id + '-tab'); pane.hidden = index !== 0;
      nodes.filter(Boolean).forEach(n => pane.append(n));
      const b = button(title, () => show(index)); b.id = pane.id + '-tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', pane.id); b.setAttribute('aria-selected', String(index === 0)); b.tabIndex = index === 0 ? 0 : -1; nav.append(b); return pane;
    });
    function show(index) { panes.forEach((p, i) => { p.hidden = i !== index; const b = nav.children[i]; b.setAttribute('aria-selected', String(i === index)); b.tabIndex = i === index ? 0 : -1; }); }
    nav.addEventListener('keydown', e => { const i = [...nav.children].indexOf(e.target); if (i < 0) return; const next = { ArrowRight: (i+1)%panes.length, ArrowLeft: (i+panes.length-1)%panes.length, Home:0, End:panes.length-1 }[e.key]; if(next!==undefined){e.preventDefault();show(next);nav.children[next].focus();} });
    host.append(nav, ...panes); return panes;
  }
  function outer(id, host) { let el = at(id); while (el && el.parentElement !== host) el = el.parentElement; return el; }
  const pages = [['receipt','Receipt printer','Checkout'],['cash','Cash drawer'],['weight','Weight machine'],['scanner','Barcode scanner'],['kot','Kitchen printing','Kitchen'],['screen','Kitchen Display'],['sound','Kitchen sound'],['mobile','Mobile devices','Connections']];
  const nav = document.querySelector('.tabs');
  pages.forEach(([key, title, group]) => { const b = nav.querySelector(`[onclick="switchTab('${key}')"]`); if(!b)return; if(group)nav.append(make('div','hw-nav-group',group)); b.textContent=t(title);nav.append(b); });
  document.body.classList.add('hardware-workspace');
  document.querySelector('.header h1').textContent='Hardware Manager';
  document.querySelector('.header p').textContent='Devices and connections on this computer';

  // Receipt setup stays short. History and recovery keep their existing handlers.
  heading('receiptTab','Receipt printer','Choose where receipts print and check a sample before service.');
  const receipt = at('receiptTab'), rnav = receipt.querySelector('.printer-nav');
  const history = make('section','printer-panel'); history.id='printer-panel-4';history.hidden=true;history.setAttribute('role','tabpanel');history.setAttribute('aria-labelledby','printer-nav-4');
  [outer('bpRows',at('printer-panel-0')),outer('rcptLogsTable',at('printer-panel-0'))].filter(Boolean).forEach(n=>history.append(n));
  const historyButton=button('Delivery history',()=>window.showPrinterPanel(4));historyButton.id='printer-nav-4';historyButton.setAttribute('role','tab');historyButton.setAttribute('aria-controls',history.id);historyButton.setAttribute('aria-selected','false');historyButton.tabIndex=-1;rnav.append(historyButton);receipt.append(history);
  at('printer-nav-0').textContent='Printer & paper';at('printer-nav-2').textContent='Recovery';
  at('printer-panel-0').append(panel('Receipt layout',[make('p','hw-note','Edit receipt content and paper layouts in the shop’s receipt designer.'),shopButton('Open receipt designer','print')]));
  const steps=document.querySelectorAll('#printerEnvironmentSteps');if(steps.length>1)steps[0].remove();
  const technical=at('wrHealth').parentElement;const technicalBox=details('Technical details',[]);technical.before(technicalBox);technicalBox.append(technical);

  // Cash drawer: connection, behaviour and a normal-sized test action.
  const cash=at('cashTab');const cpin=cash.querySelector('[name="cdPin"]').closest('div').parentElement;
  const auto=at('cdAutoOpen').parentElement;const test=at('cdOpenBtn');const save=cash.querySelector('[onclick="cdSaveConfig()"]');
  const printer=at('cdPrinterConfig');const cashStatus=at('cdStatus');
  cash.replaceChildren(cashStatus,panel('Drawer connection',[printer]),panel('When to open',[auto,details('Drawer connector',[cpin])]),panel('Test the drawer',[make('p','hw-note','Test only when the counter is attended.'),test]),panel('',[save]));
  test.textContent='Test open drawer';save.textContent='Save changes';save.classList.add('btn-primary');
  printer.querySelector('label').textContent='Connected through printer';printer.querySelector('button').textContent='Refresh printers';
  heading('cashTab','Cash drawer','Choose its printer connection and when the drawer opens.');
  heading('weightTab','Weight machine','Connect a scale and check its live reading before checkout.');
  at('portSelection').classList.add('hw-panel');at('connectedState').classList.add('hw-panel');
  const simulation=at('enableSimulation').closest('label');at('portSelection').append(details('Test without a device',[simulation]));
  at('listPortsBtn').textContent='Find weight machines';at('liveWeightDisplay').classList.add('hw-weight');

  const scanner=at('scannerTab');scanner.querySelector('h2').remove();
  const scannerHelp=scanner.querySelectorAll('.card')[1];const scannerHelpBox=details('Scanner troubleshooting',[]);scannerHelp.before(scannerHelpBox);scannerHelpBox.append(scannerHelp);
  heading('scannerTab','Barcode scanner','Scan a code here without adding it to a sale.');
  scanner.querySelector('.status').textContent='USB scanners usually need no setup. Connect the scanner, then try a scan.';
  scanner.querySelector('.card').classList.add('hw-panel');

  // Keep service controls visible, and put audit logs on their own page.
  const kot=at('kotTab');const setup=at('kotSetupCard');setup.classList.add('hw-panel');
  const api=at('kotApiUrl').closest('.form-group');setup.append(details('Print for another computer',[api]));
  const kotLogs=outer('kotLogsContainer',kot), receiptLogs=outer('rlTable',kot), live=outer('kotLiveStatus',kot), action=outer('kotStartBtn',kot);
  const banner=at('kotConnectedBanner'), status=at('kotStatusBar'), shadow=at('kotShadowCard');
  const sleepNote=[...kot.children].find(n=>n.tagName==='P');
  const help=panel('Printing stops or a ticket is missing',[make('p','hw-note','Check delivery history before sending another copy. A software submission does not confirm paper came out.'),button('Open printer recovery',()=>{window.switchTab('receipt');window.showPrinterPanel(2);}),details('Computer sleep during service',[sleepNote]),shadow]);
  setup.append(panel('Item routing',[make('p','hw-note','Manage the shop’s kitchen and item routing in Restaurant settings.'),shopButton('Open restaurant printing','tableorder')]));
  [setup,kotLogs,receiptLogs,live,action,banner,status].filter(Boolean).forEach(n=>n.remove());
  sections(kot,[['Printers & service',[status,banner,setup,action]],['Delivery history',[kotLogs,receiptLogs]],['Troubleshooting',[help,live]]]);
  heading('kotTab','Kitchen printing','Manage printers without losing track of ticket deliveries.');

  const screen=at('screenTab');screen.querySelector('h2').remove();const screenHelp=screen.querySelector('.card');const screenHelpBox=details('Screen size and viewing distance',[]);screenHelp.before(screenHelpBox);screenHelpBox.append(screenHelp);
  screen.querySelector('.status').textContent=t('Preview changes here, then save them to the selected kitchen display.');
  heading('screenTab','Kitchen Display','View-only HDMI screen. Staff update orders from Captain. Saved displays reconnect automatically when Windows detects them.');
  const screenSaveStatus=at('screenSaveStatus')||make('div','hw-note');screenSaveStatus.id='screenSaveStatus';screenSaveStatus.setAttribute('role','status');screen.querySelector('.hw-heading').after(screenSaveStatus);

  const mobile=at('mobileTab');const network=outer('mobileApiUrl',mobile), devices=outer('deviceTableBody',mobile), blocked=outer('blockedDeviceBody',mobile), login=outer('loginLogBody',mobile);
  [network,devices,blocked,login].forEach(n=>{n.classList.add('hw-panel');n.remove();});
  const clear=network.querySelector('[onclick="clearMobileData()"]');if(clear)login.append(clear);
  const connect=panel('Connect a Captain phone',[make('h3','','1. Join the shop Wi-Fi'),make('p','hw-note','Connect the phone to the same network as this computer.'),make('h3','','2. Open the Captain app'),make('p','hw-note','Use the shop address below. Pair and approve phones in Settings → Captain App → Handsets.'),network]);
  const pairing=make('div','hw-action-row');pairing.append(shopButton('Pair or approve a phone','captainapp'),shopButton('Manage Captain devices','devices'));connect.prepend(pairing);
  devices.prepend(shopButton('Manage paired phones','devices'));
  network.querySelector('#mobileServerStatus').textContent='Local address';
  sections(mobile,[['Connected devices',[devices]],['Connect a phone',[connect]],['Access & activity',[blocked,login]]]);
  heading('mobileTab','Mobile devices','View connections, connect a phone and manage blocked devices.');
  mobile.querySelector('.hw-heading').append(at('mobileRefreshBtn'));

  // Avoid fixed colour/size decorations on static controls; keep visibility and layout.
  document.querySelectorAll('.content [style]').forEach(el=>{
    if(el.closest('#blockConfirmModal,#kotDeleteConfirmModal,#kotDetailModal'))return;
    ['color','background','background-color','background-image','box-shadow','font-family','font-size','font-weight','letter-spacing','text-transform'].forEach(p=>el.style.removeProperty(p));
  });
  document.querySelectorAll('.content .btn').forEach(b=>{b.style.removeProperty('padding');b.style.removeProperty('flex');});
  document.querySelectorAll('#cashTab [style]').forEach(el=>{['padding','margin','min-width','border','border-radius'].forEach(p=>el.style.removeProperty(p));});
  document.querySelectorAll('.content table').forEach(table=>{table.classList.add('hw-table');table.parentElement.classList.add('hw-table-scroll');});
  document.querySelectorAll('.tab-content input:not([type="checkbox"]):not([type="radio"]),.tab-content select').forEach(el=>{
    if(el.labels?.length||el.hasAttribute('aria-label'))return;
    const label=el.parentElement.querySelector('label');if(label&&el.id)label.htmlFor=el.id;
  });

  // New display cards are drawn after list/config IPC responses.
  function decorateScreen(display) {
    const id=String(display.id), enabled=at('use-'+id);if(!enabled)return;
    const card=enabled.closest('.card');if(!card||card.dataset.workspace)return;card.dataset.workspace='true';card.classList.add('hw-screen-card');card.style.removeProperty('opacity');
    // Enabling is a draft change, just like every other field. Only Save configures a real display.
    enabled.removeAttribute('onchange');
    const actions=card.lastElementChild;actions.classList.add('hw-screen-actions');
    const info=card.firstElementChild;const options=card.querySelector('details');
    const layout=make('div','hw-screen-fields'), flow=make('div','hw-screen-fields'), connection=make('div','hw-screen-fields');
    const move=(keys,target)=>keys.forEach(key=>{const el=at(key+'-'+id);if(!el)return;let wrapper=el.closest('label');if(!wrapper||wrapper.contains(enabled))wrapper=el.parentElement; if(wrapper.tagName==='SELECT'||wrapper===card)wrapper=el; if(wrapper.parentElement?.firstElementChild?.tagName==='LABEL'&&wrapper.parentElement!==card&&wrapper.parentElement.childElementCount<=3)wrapper=wrapper.parentElement;target.append(wrapper);});
    // Numeric helper fields have a separate label, value row and hint; move the whole field container.
    const numeric=(keys,target)=>keys.forEach(key=>{const el=at(key+'-'+id);if(el)target.append(el.parentElement.parentElement);});
    move(['portrait'],layout);
    const textLabel=make('label','','Text size');const textSize=make('select','');textSize.id='hw-text-size-'+id;
    [['0','Auto (recommended)'],['32','Standard'],['40','Large'],['52','Extra large'],['custom','Custom']].forEach(([value,label])=>{const option=make('option','',label);option.value=value;textSize.append(option);});
    const savedFont=String(Number(at('font-px-'+id)?.value)||0);textSize.value=['0','32','40','52'].includes(savedFont)?savedFont:'custom';
    textLabel.append(textSize);layout.append(textLabel);
    const advancedLayout=make('details','');advancedLayout.append(make('summary','','Advanced layout'));
    numeric(['visible-dishes','font-px'],advancedLayout);move(['glow','table-only'],advancedLayout);layout.append(advancedLayout);
    textSize.addEventListener('change',()=>{if(textSize.value==='custom'){advancedLayout.open=true;at('font-px-'+id).focus();}else at('font-px-'+id).value=textSize.value;});
    layout.append(button('Use recommended layout',()=>{
      at('portrait-'+id).value='0';at('font-px-'+id).value='0';at('visible-dishes-'+id).value='0';at('table-only-'+id).checked=false;textSize.value='0';
      ['t','i','n','a'].forEach(key=>{if(at(key+'-'+id))at(key+'-'+id).checked=true;});
      at('order-sort-'+id).value='oldest';advancedLayout.open=false;
      card.dispatchEvent(new Event('change',{bubbles:true}));
    }));
    layout.append(make('p','hw-note','Auto fits complete orders and turns pages when the screen is full. Save to apply.'));
    move(['order-sort'],flow);numeric(['cancel-seconds'],flow);move(['cancel-pulse'],flow);
    numeric(['diag'],layout);layout.insertBefore(layout.lastElementChild,advancedLayout);move(['branch'],connection);numeric(['dist','arc','safe'],connection);
    const measure=at('w-'+id);if(measure)connection.append(measure.parentElement.parentElement);
    if(options)flow.append(options);
    const estimate=[...card.children].find(el=>el.textContent.startsWith('Automatic layout estimate:'));if(estimate)connection.append(estimate);
    const primaryWarning=[...card.children].find(el=>el.textContent.startsWith('This is the screen the till'));if(primaryWarning)connection.prepend(primaryWarning);
    const controls=make('div','hw-screen-controls');controls.id='hw-screen-'+id;sections(controls,[['Layout',[layout]],['Order flow',[flow]],['Screen setup',[connection]]]);
    const preview=make('div','hw-screen-preview');preview.append(make('h3','','Live preview'),make('p','hw-note','Sample orders · scaled to this display'));
    const orientationLabel=make('label','hw-preview-scenario','Preview orientation');const orientation=make('select','');orientation.id='hw-preview-orientation-'+id;
    [['actual','Connected display'],['portrait','Portrait (vertical)'],['landscape','Landscape (horizontal)']].forEach(([value,label])=>{const option=make('option','',label);option.value=value;orientation.append(option);});orientationLabel.append(orientation);const previewFormat=make('div','hw-preview-format');preview.append(previewFormat);previewFormat.append(orientationLabel);
    orientation.addEventListener('change',event=>{event.stopPropagation();update();});
    const resolutionLabel=make('label','hw-preview-scenario','Preview resolution');const resolution=make('select','');resolution.id='hw-preview-resolution-'+id;
    [['actual','Connected display'],['1920x1080','Full HD · 1920 × 1080'],['2560x1440','QHD · 2560 × 1440'],['3840x2160','4K · 3840 × 2160']].forEach(([value,label])=>{const option=make('option','',label);option.value=value;resolution.append(option);});resolutionLabel.append(resolution);previewFormat.append(resolutionLabel);
    resolution.addEventListener('change',event=>{event.stopPropagation();update();});
    const scenarioLabel=make('label','hw-preview-scenario','Sample service');const scenario=make('select','');[['busy','10 orders · 6 items each'],['added','10 orders · later additions'],['new','3 short orders'],['ready','Item ready'],['cancelled','Cancelled order']].forEach(([value,label])=>{const option=make('option','',label);option.value=value;scenario.append(option);});scenarioLabel.append(scenario);preview.append(scenarioLabel);scenario.addEventListener('change',event=>{event.stopPropagation();update();});
    const viewport=make('div','hw-preview-viewport');const frame=make('iframe','');frame.title='Kitchen screen live preview';frame.setAttribute('sandbox','allow-scripts');frame.src='kitchen-screen.html?hardwarePreview=1';viewport.append(frame);preview.append(viewport);
    const summary=make('p','hw-note');preview.append(summary);
    const expand=button('Enlarge preview',()=>{card.classList.toggle('hw-preview-expanded');expand.textContent=card.classList.contains('hw-preview-expanded')?'Back to settings':'Enlarge preview';update();});preview.append(expand);
    const body=make('div','hw-screen-grid');body.append(controls,preview);
    card.replaceChildren(info,body,actions);
    const status=make('span','hw-note');status.setAttribute('role','status');actions.append(status);
    const number=(key,fallback)=>{const value=Number(at(key+'-'+id)?.value);return Number.isFinite(value)?value:fallback;};
    function update(){
      const cfg={...display.config};const keys={viewingDistanceM:'dist',diagonalInches:'diag',targetArcmin:'arc',safeAreaPercent:'safe',portraitColumns:'portrait',visibleDishesPerBox:'visible-dishes',fontSizePx:'font-px',cancelledDisplaySeconds:'cancel-seconds',pageDwellSeconds:'dwell',amberAfterMin:'amber',redAfterMin:'red',pulseAfterMin:'pulse'};
      Object.entries(keys).forEach(([key,prefix])=>cfg[key]=number(prefix,cfg[key]));
      Object.entries({tableOnly:'table-only',showTable:'t',showItems:'i',showItemNotes:'n',showAge:'a',textGlow:'glow',cancelledPulse:'cancel-pulse',pulseAlerts:'pulse-on'}).forEach(([key,prefix])=>cfg[key]=at(prefix+'-'+id)?.checked??cfg[key]);
      cfg.orderSort=at('order-sort-'+id)?.value||'oldest';
      const dpi=Number(display.scaleFactor)||1;let width=Math.round((Number(display.widthPx)||1920)/dpi),height=Math.round((Number(display.heightPx)||1080)/dpi);
      if(resolution.value!=='actual')[width,height]=resolution.value.split('x').map(Number);
      if(orientation.value==='portrait')[width,height]=[Math.min(width,height),Math.max(width,height)];
      if(orientation.value==='landscape')[width,height]=[Math.max(width,height),Math.min(width,height)];
      const fit=window.PosnicScreenFit.fit({widthPx:width,heightPx:height,diagonalInches:cfg.diagonalInches,distanceM:cfg.viewingDistanceM,targetArcmin:cfg.targetArcmin,safeArea:cfg.safeAreaPercent/100});
      cfg._previewScenario=scenario.value;cfg._fit=fit;cfg._feedStatus='Sample orders';cfg.name='Kitchen preview';cfg.setupMode=false;
      viewport.style.width=Math.min(preview.clientWidth||360,(card.classList.contains('hw-preview-expanded')?720:420)*width/height)+'px';
      const scale=Math.min(1,(viewport.clientWidth||360)/width);frame.style.width=width+'px';frame.style.height=height+'px';frame.style.transform='scale('+scale+')';viewport.style.height=(height*scale)+'px';
      frame.contentWindow?.postMessage({type:'posnic-hardware-preview',config:cfg},'*');
      const diagonal=Number(cfg.diagonalInches)||32,unit=diagonal*2.54/Math.hypot(width,height);
      summary.textContent=diagonal+'″ · '+Math.round(width*unit)+' × '+Math.round(height*unit)+' cm screen area · '+width+' × '+height+'. Scaled preview; rotate the actual display in Windows display settings.';
    }
    frame.addEventListener('load',update);card.addEventListener('input',()=>{card.dataset.unsaved='true';status.textContent='Unsaved changes';update();});card.addEventListener('change',()=>{card.dataset.unsaved='true';status.textContent='Unsaved changes';update();});
    if(window.ResizeObserver){const observer=new ResizeObserver(()=>{if(card.isConnected)update();else observer.disconnect();});observer.observe(viewport);}
    update();
  }
  const walker=document.createTreeWalker(document.querySelector('.container'),NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement.closest('button,label,h1,h2,h3,summary'))node.textContent=node.textContent.replace(/^[\s]*(?:[\p{Extended_Pictographic}\uFE0F]+\s*)+/u,'');}
  let checkingDisplays = false;
  const displayTimer = setInterval(async()=>{
    if(checkingDisplays || document.hidden || !window.posnicKitchenScreen?.list || document.querySelector('.hw-screen-card[data-unsaved=true]')) return;
    checkingDisplays=true;
    try {
      const result=await window.posnicKitchenScreen.list();
      const signature=JSON.stringify((result?.displays||[]).map(d=>[d.id,d.connected,d.configured]));
      const displayed=JSON.stringify((window.screenState?.displays||[]).map(d=>[d.id,d.connected,d.configured]));
      if(signature!==displayed && typeof window.refreshScreens==='function') await window.refreshScreens();
    } catch (_) {} finally {checkingDisplays=false;}
  },5000);
  window.addEventListener('beforeunload',()=>clearInterval(displayTimer));
  document.addEventListener('display-language-change', () => {
    const h=screen.querySelector('.hw-heading');
    h.querySelector('h2').textContent=t('Kitchen Display');
    h.querySelector('p').textContent=t('View-only HDMI screen. Staff update orders from Captain. Saved displays reconnect automatically when Windows detects them.');
    const navButton=nav.querySelector("[onclick=\"switchTab('screen')\"]");if(navButton)navButton.textContent=t('Kitchen Display');
    if(typeof window.refreshScreens==='function' && !document.querySelector('.hw-screen-card[data-unsaved=true]')) void window.refreshScreens();
  });
  window.hardwareWorkspace={decorateScreen};
})();
