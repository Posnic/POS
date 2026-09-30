'use strict';
(() => {
  const $ = (id) => document.getElementById(id),
    demo = new URLSearchParams(location.search).get('demo') === '1';
  const stages = ['new', 'preparing', 'ready'];
  let settings = { orangeMinutes: 5, redMinutes: 10, pulse: true };
  let tickets = [],
    online = false,
    reading = false,
    mutating = false,
    gesture = null,
    revision = 0,
    undo = null,
    undoTimer;
  const sample = () => [
    {
      id: 'demo-1:c0',
      saleId: 'demo-1',
      roundId: 'c0',
      table: '6',
      placedAt: new Date(Date.now() - 120000).toISOString(),
      state: 'new',
      revision: 0,
      items: [
        { qty: 2, name: 'Chicken biryani' },
        { qty: 1, name: 'Paneer tikka', note: 'Less spicy' },
      ],
    },
    {
      id: 'demo-2:c0',
      saleId: 'demo-2',
      roundId: 'c0',
      table: '3',
      placedAt: new Date(Date.now() - 420000).toISOString(),
      state: 'preparing',
      revision: 0,
      items: [
        { qty: 3, name: 'Veg fried rice' },
        { qty: 2, name: 'Butter naan' },
      ],
    },
    {
      id: 'demo-3:c0',
      saleId: 'demo-3',
      roundId: 'c0',
      table: '8',
      placedAt: new Date(Date.now() - 660000).toISOString(),
      state: 'ready',
      revision: 0,
      items: [
        { qty: 1, name: 'Fish curry' },
        { qty: 2, name: 'Steamed rice' },
      ],
    },
    {
      id: 'demo-1:c1',
      saleId: 'demo-1',
      roundId: 'c1',
      table: '6',
      placedAt: new Date().toISOString(),
      state: 'new',
      revision: 0,
      items: [{ qty: 2, name: 'Lime soda' }],
    },
  ];
  const time = (value) => {
    const d = new Date(value);
    return value && Number.isFinite(d.getTime())
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : '';
  };
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  async function request(url, body) {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('posnic.kitchen.device')
          ? { 'X-Kitchen-Device': localStorage.getItem('posnic.kitchen.device') }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) {
      const e = Error(data.message || data.error?.message || 'Could not contact the kitchen.');
      e.status = response.status;
      throw e;
    }
    return data;
  }
  function render() {
    if (
      gesture ||
      (online && !mutating && document.activeElement?.classList.contains('quantity-input'))
    )
      return;
    for (const stage of stages) {
      const list = tickets.filter((t) => t.state === stage);
      $(stage).replaceChildren();
      $('count-' + stage).textContent = list.length;
      if (!list.length)
        $(stage).append(
          node(
            'p',
            'empty',
            online
              ? 'No ' +
                  (stage === 'new'
                    ? 'new orders'
                    : stage === 'ready'
                      ? 'orders ready'
                      : 'orders preparing')
              : 'Waiting for connection'
          )
        );
      for (const ticket of list) {
        const age = ticket.placedAt ? Date.now() - new Date(ticket.placedAt).getTime() : 0;
        const card = node(
          'article',
          'ticket' +
            (age >= settings.redMinutes * 60000
              ? ' overdue' + (settings.pulse ? ' pulse' : '')
              : age >= settings.orangeMinutes * 60000
                ? ' aging'
                : '')
        );
        card.dataset.id = ticket.id;
        const top = node('div', 'top'),
          table = node('span', 'table');
        if (ticket.table) {
          const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          icon.setAttribute('viewBox', '0 0 24 24');
          icon.setAttribute('aria-hidden', 'true');
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('d', 'M3 9h18v3H3z M5 12v9 M19 12v9 M5 3v6 M19 3v6');
          p.setAttribute('fill', 'none');
          p.setAttribute('stroke', 'currentColor');
          p.setAttribute('stroke-width', '2');
          icon.append(p);
          table.append(icon, document.createTextNode(ticket.table));
        }
        top.append(table, node('span', 'arrival', time(ticket.placedAt)));
        card.append(top);
        const items = node('ul', 'items');
        for (const item of ticket.items) {
          const li = node('li');
          li.append(node('span', 'quantity', item.qty + '×'), node('span', 'name', item.name));
          if (Number.isFinite(Number(item.priced_at_table)) && Number(item.priced_at_table) > 0) {
            li.append(
              node(
                'strong',
                'note',
                'Amount: ' +
                  Number(item.priced_at_table).toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                  }) +
                  ' each'
              )
            );
          }
          if (item.note) li.append(node('span', 'note', item.note));
          if (item.seat || item.course)
            li.append(
              node(
                'span',
                'note',
                [item.seat ? 'Seat ' + item.seat : '', item.course || '']
                  .filter(Boolean)
                  .join(' · ')
              )
            );
          const allergies = [...(item.allergies || []), item.allergy_note || ''].filter(Boolean);
          if (allergies.length)
            li.append(node('strong', 'allergy', 'ALLERGY: ' + allergies.join(', ')));
          const total = item.total ?? item.qty,
            ready = item.ready ?? (stage === 'ready' ? total : 0);
          const collected = item.collected || 0,
            served = item.served || 0;
          li.append(
            node(
              'span',
              'item-progress',
              `${Math.max(0, ready - collected)} ready to collect · ${Math.max(0, collected - served)} collected`
            )
          );
          if (item.collectorName && collected > served)
            li.append(node('span', 'note', 'Collected by ' + item.collectorName));
          if (stage === 'preparing' && ready < total) {
            const controls = node('div', 'item-controls'),
              input = node('input', 'quantity-input');
            input.disabled = !online || mutating;
            input.type = 'number';
            input.min = '0.01';
            input.max = String(total - ready);
            input.step = 'any';
            input.value = String(Math.min(1, total - ready));
            input.setAttribute('aria-label', 'Quantity ready: ' + item.name);
            const b = node('button', 'item-ready', 'Ready');
            b.disabled = !online || mutating;
            b.onclick = () => {
              const quantity = Number(input.value);
              if (!Number.isFinite(quantity) || quantity <= 0 || quantity > total - ready) {
                $('message').textContent = 'Choose a quantity within the remaining order.';
                return;
              }
              void advance(ticket, null, false, {
                operation: 'ready',
                itemId: item.id,
                quantity: ready + quantity,
                previous: ready,
              });
            };
            controls.append(input, b);
            li.append(controls);
          }
          items.append(li);
        }
        card.append(items);
        if (ticket.ownerName) card.append(node('p', 'waiting', 'Ordered by ' + ticket.ownerName));
        if (stage !== 'ready') {
          const b = node(
            'button',
            'advance' + (stage === 'preparing' ? ' ready-action' : ''),
            stage === 'new' ? 'Start preparing →' : 'Ready all →'
          );
          b.disabled = !online || mutating;
          b.onclick = () => advance(ticket, stages[stages.indexOf(stage) + 1]);
          card.append(b);
        } else card.append(node('p', 'waiting', 'Ready for collection · awaiting service'));
        $(stage).append(card);
      }
    }
  }
  function stateText() {
    $('connection').textContent = demo
      ? 'DEMO · sample orders only'
      : online
        ? 'Connected'
        : 'Disconnected · orders may be out of date';
  }
  async function refresh() {
    if (reading || mutating) return;
    reading = true;
    const current = revision;
    try {
      if (demo) {
        online = true;
        $('branch').textContent = 'Kitchen · demo';
      } else {
        const data = await request('/api/kitchen');
        if (current !== revision) return;
        tickets = data.tickets;
        if (data.settings) settings = data.settings;
        if (!document.activeElement?.closest('#device-setup')) {
          $('orange-minutes').value = settings.orangeMinutes;
          $('red-minutes').value = settings.redMinutes;
          $('pulse-orders').checked = settings.pulse;
        }
        online = true;
        $('branch').textContent = data.branch || 'Kitchen';
        $('signin').hidden = true;
      }
      $('updated').textContent = 'Updated ' + time(new Date().toISOString());
    } catch (e) {
      if (current !== revision) return;
      online = false;
      $('message').textContent = e.message;
      $('signin').hidden = e.status !== 401;
    } finally {
      reading = false;
      stateText();
      render();
    }
  }
  function actionId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function advance(ticket, state, isUndo = false, lineAction = null) {
    if (!online || mutating) return;
    mutating = true;
    revision++;
    $('message').textContent = 'Saving…';
    render();
    try {
      const result = demo
        ? { ticket: demoChange(ticket, state, lineAction) }
        : await request('/api/kitchen/transition', {
            saleId: ticket.saleId,
            roundId: ticket.roundId,
            ...(lineAction
              ? {
                  operation: lineAction.operation,
                  itemId: lineAction.itemId,
                  quantity: lineAction.quantity,
                }
              : { state }),
            revision: ticket.revision,
            actionId: actionId(),
          });
      tickets = tickets.map((t) => (t.id === ticket.id ? result.ticket : t));
      $('message').textContent = demo ? 'Demo updated - no real order changed.' : 'Saved';
      clearTimeout(undoTimer);
      undo = isUndo
        ? null
        : {
            ticket: result.ticket,
            state: ticket.state,
            lineAction: lineAction ? { ...lineAction, quantity: lineAction.previous } : null,
          };
      $('undoBox').hidden = !undo;
      if (undo) {
        $('undoLabel').textContent = lineAction ? 'Item readiness updated' : 'Moved to ' + state;
        undoTimer = setTimeout(() => {
          undo = null;
          $('undoBox').hidden = true;
        }, 10000);
      }
    } catch (e) {
      $('message').textContent =
        e.status === 409 ? e.message : 'Update not confirmed. Refreshing before another action.';
      online = false;
      undo = null;
      $('undoBox').hidden = true;
    } finally {
      mutating = false;
      stateText();
      render();
      if (!demo) {
        if (reading) setTimeout(refresh, 200);
        else void refresh();
      }
    }
  }
  const board = $('board');
  board.addEventListener('pointerdown', (e) => {
    if (gesture) {
      gesture.card.classList.remove('gesture');
      gesture = null;
      return;
    }
    if (
      !e.isPrimary ||
      e.button !== 0 ||
      e.target.closest('button,input,select') ||
      !online ||
      mutating
    )
      return;
    const card = e.target.closest('.ticket'),
      ticket = card && tickets.find((t) => t.id === card.dataset.id);
    if (!ticket || ticket.state === 'ready') return;
    gesture = { pointer: e.pointerId, x: e.clientX, y: e.clientY, card, ticket };
    card.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const dx = e.clientX - gesture.x,
      dy = e.clientY - gesture.y;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
      gesture.card.classList.remove('gesture');
      gesture = null;
      return;
    }
    gesture.card.classList.toggle('gesture', dx > 30 && dx > Math.abs(dy) * 1.5);
  });
  board.addEventListener('pointerup', (e) => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const g = gesture;
    gesture = null;
    g.card.classList.remove('gesture');
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y,
      rect = g.card.getBoundingClientRect();
    if (
      dx >= Math.min(160, Math.max(80, rect.width * 0.25)) &&
      Math.abs(dy) < Math.min(60, dx * 0.5) &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    )
      void advance(g.ticket, stages[stages.indexOf(g.ticket.state) + 1]);
    else render();
  });
  function cancelGesture() {
    if (gesture) gesture.card.classList.remove('gesture');
    gesture = null;
    render();
  }
  board.addEventListener('pointercancel', cancelGesture);
  board.addEventListener('lostpointercapture', cancelGesture);
  window.addEventListener('blur', cancelGesture);
  $('undo').onclick = () => {
    if (undo) void advance(undo.ticket, undo.state, true, undo.lineAction);
  };
  $('refresh').onclick = () => {
    if (!mutating) void refresh();
  };
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      $('message').textContent = 'Use your kiosk browser fullscreen setting on this device.';
    }
  };
  window.addEventListener('offline', () => {
    if (demo) return;
    online = false;
    stateText();
    render();
  });
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  function clock() {
    $('clock').textContent = new Date().toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  function demoChange(ticket, state, lineAction) {
    const items = ticket.items.map((i) => ({
      ...i,
      ready: lineAction
        ? i.id === lineAction.itemId
          ? lineAction.quantity
          : i.ready
        : state === 'ready'
          ? i.total
          : state === 'preparing' && ticket.state === 'ready'
            ? i.collected
            : i.ready,
    }));
    return {
      ...ticket,
      items,
      state: items.every((i) => i.ready >= i.total) ? 'ready' : lineAction ? 'preparing' : state,
      revision: ticket.revision + 1,
    };
  }
  if (demo)
    tickets = sample().map((t) => ({
      ...t,
      ownerName: 'Captain Arun',
      items: t.items.map((i, n) => ({
        ...i,
        id: t.roundId + 'i' + n,
        total: i.qty,
        served: 0,
        collected: 0,
        ready: t.state === 'ready' ? i.qty : 0,
      })),
    }));
  clock();
  setInterval(clock, 1000);
  setInterval(refresh, 5000);
  void refresh();
})();
