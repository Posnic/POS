(function () {
  "use strict";
  const messages = [
    { label: 'Collect payment', t: 'lang_captain_collect_payment' },
    { label: 'Payment details', t: 'lang_captain_payment_details' },
    { label: 'Remaining balance', t: 'lang_captain_remaining_balance' },
    { label: 'All remaining guests', t: 'lang_captain_all_remaining_guests' },
    { label: 'Amount received', t: 'lang_captain_amount_received' },
    { label: 'Change to return', t: 'lang_captain_change_to_return' },
    {
      label: 'Payment reference (optional)', t: 'lang_captain_payment_reference',
    },
    {
      label: 'I verified this payment on the terminal or bank app.', t: 'lang_captain_payment_verified',
    },
    { label: 'Record payment', t: 'lang_captain_record_payment' },
    { label: 'Payment recorded', t: 'lang_captain_payment_recorded' },
    {
      label:
        "Confirm only after receiving the money. This does not charge a card or bank account.",
      t: "lang_captain_confirm_received",
    },
    {
      label:
        "Payment status is not confirmed. Retry this request; do not collect the money again.",
      t: "lang_captain_payment_uncertain",
    },
    {
      label:
        "Connect to the shop server before collecting payment. You can still take orders offline.",
      t: "lang_captain_payment_connect",
    },
    {
      label: 'Another payment changed this bill. Review the remaining balance.', t: 'lang_captain_payment_changed',
    },
    {
      label:
        "This phone could not save the payment request. Do not collect payment yet.",
      t: "lang_captain_payment_storage",
    },
    {
      label: 'Return to the original server to confirm this payment.', t: 'lang_captain_payment_server',
    },
    {
      label: 'Payment collection is not enabled for this phone.', t: 'lang_captain_payment_disabled',
    },
    {
      label: 'Enter an amount at least equal to the bill.', t: 'lang_captain_payment_short',
    },
    { label: 'Paid', t: 'lang_paid' },
    { label: 'Cash', t: 'lang_cash' },
    { label: 'Card', t: 'lang_card' },
    { label: 'UPI', t: 'lang_upi' },
    { label: 'Close', t: 'lang_close' },
    { label: 'Retry', t: 'lang_retry' },
    { label: 'Loading...', t: 'lang_loading' },
    { label: 'Cancel', t: 'lang_cancel' },
    { label: 'Guest', t: 'lang_guest' },
  ];
  const t = (text) =>
    window.I18N
      ? I18N.t(text)
      : window.PosnicPro?.i18n?.t(
          messages.find((m) => m.label === text)?.t || text,
          text,
        ) || text;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const mobile = () => !!window.POSNIC;
  const base = () =>
    mobile() ? POSNIC.session?.base || POSNIC.server.baseUrl : location.origin;
  const branch = () =>
    mobile()
      ? localStorage.getItem("branch_id")
      : String(PosnicPro.local.get("branch_id_set") || "");
  function request(method, path, body) {
    if (mobile()) return POSNIC.api[method](path, body);
    return new Promise((resolve, reject) =>
      PosnicPro[method](
        {
          url: path.replace(/^\//, ""),
          data: method === "get" ? body : JSON.stringify(body),
          processData: method === "get",
        },
        resolve,
        (e) =>
          reject(
            Object.assign(new Error("request_failed"), { status: e?.status }),
          ),
      ),
    );
  }
  const root = () =>
    mobile() ? "/captain/v1/payments" : "/sales/tablePayments";
  let splitDraft = null,
    dialog,
    plan,
    pending,
    busy = false,
    table = "",
    branchId = "",
    key = "",
    error = "",
    selected = "",
    method = "Cash",
    received = "",
    reference = "",
    verified = false;
  const monetary = () => CaptainMoney.snapshot(plan || {});
  const money = n => CaptainMoney.format(CaptainMoney.fromMinor(Number(n || 0), monetary()), monetary());
  const cashMinor = () => { try { return CaptainMoney.toMinor(received || 0, monetary()); } catch { return NaN; } };
  const receivedDefault = () => CaptainMoney.fromMinor(amount(), monetary()).toFixed(monetary().currencyDigits);
  const amount = () =>
    selected === ""
      ? plan?.dueMinor || 0
      : plan?.guests[Number(selected)]?.totalMinor || 0;
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ pending, plan }));
      return true;
    } catch {
      error =
        "This phone could not save the payment request. Do not collect payment yet.";
      return false;
    }
  };
  function render() {
    if (!dialog) return;
    let body = "";
    if (plan) {
      body = `<div class="cp-balance"><span>${esc(t("Remaining balance"))}</span><strong translate="no">${esc(money(plan.dueMinor))}</strong></div>`;
      body += `<div class="cp-guests">${plan.guests.map((g) => `<div><span translate="no">${esc(g.name)}</span><span>${g.paid ? esc(t("Paid")) : `<span translate="no">${esc(money(g.totalMinor))}</span>`}</span></div>`).join("")}</div>`;
      if (plan.dueMinor > 0 && !pending)
        body += `
        ${plan.guests.filter((g) => !g.paid).length > 1 ? `<label>${esc(t("Guest"))}<select id="cp-guest"><option value="">${esc(t("All remaining guests"))}</option>${plan.guests.map((g, i) => (g.paid ? "" : `<option value="${i}" ${selected === String(i) ? "selected" : ""} translate="no">${esc(g.name)} · ${esc(money(g.totalMinor))}</option>`)).join("")}</select></label>` : ""}
        <div class="cp-methods" role="group" aria-label="${esc(t("Collect payment"))}">${plan.methods.map((m) => `<button type="button" data-method="${m}" aria-pressed="${method === m}">${esc(t(m === "Upi" ? "UPI" : m))}</button>`).join("")}</div>
        ${method === "Cash" ? `<label>${esc(t("Amount received"))}<input id="cp-received" inputmode="decimal" type="number" min="0" step="${1 / monetary().factor}" value="${esc(received)}"></label><div class="cp-change"><span>${esc(t("Change to return"))}</span><strong id="cp-change" translate="no">${esc(money(Math.max(0, cashMinor() - amount())))}</strong></div>` : `<label>${esc(t("Payment reference (optional)"))}<input id="cp-reference" maxlength="100" value="${esc(reference)}"></label><label class="cp-confirm"><input type="checkbox" id="cp-verified" ${verified ? "checked" : ""}><span>${esc(t("I verified this payment on the terminal or bank app."))}</span></label>`}
        <p class="cp-help">${esc(t("Confirm only after receiving the money. This does not charge a card or bank account."))}</p>`;
      if (plan.dueMinor === 0)
        body += `<p role="status">${esc(t("Payment recorded"))}</p>`;
    } else
      body = `<p>${esc(t(busy ? "Loading..." : "Connect to the shop server before collecting payment. You can still take orders offline."))}</p>`;
    dialog.innerHTML = `<header><h2>${esc(t("Collect payment"))} <small translate="no">${esc(table)}</small></h2><button type="button" data-action="close" aria-label="${esc(t("Close"))}">×</button></header><div class="cp-body">${body}${error ? `<p class="cp-error" role="status">${esc(t(error))}</p>` : ""}</div><footer><button type="button" data-action="close">${esc(t(plan?.dueMinor === 0 ? "Close" : "Cancel"))}</button>${plan?.dueMinor === 0 ? "" : `<button type="button" class="cp-primary" data-action="record" ${busy ? "disabled" : ""}>${esc(t(busy ? "Loading..." : pending || !plan ? "Retry" : "Record payment"))}${plan && !pending ? ` · <span translate="no">${esc(money(amount()))}</span>` : ""}</button>`}</footer>`;
    if (busy || pending)
      dialog
        .querySelectorAll("input,select,[data-method]")
        .forEach((el) => (el.disabled = true));
  }
  async function load() {
    if (busy) return;
    busy = true;
    error = "";
    render();
    try {
      plan = await request("post", root() + "/table", {
        table_number: table,
        branchId,
        ...(splitDraft || {}),
      });
      if (!plan?.id || !plan.enabled)
        throw Object.assign(new Error("Disabled"), { status: 403 });
      method = plan.methods.includes(method) ? method : plan.methods[0];
      selected = "";
      received = receivedDefault();
      verified = false;
    } catch (e) {
      plan = null;
      error =
        e.status === 403
          ? "Payment collection is not enabled for this phone."
          : "Connect to the shop server before collecting payment. You can still take orders offline.";
    } finally {
      busy = false;
      render();
      if (!dialog.open && plan && !plan.paidMinor) close();
    }
  }
  async function record() {
    if (busy) return;
    if (!plan && !pending) {
      await load();
      return;
    }
    if (!pending) {
      const paid = amount(),
        cash = cashMinor();
      if (method === "Cash" && (!Number.isFinite(cash) || cash < paid)) {
        error = "Enter an amount at least equal to the bill.";
        render();
        return;
      }
      if (method !== "Cash" && !verified) {
        error = "I verified this payment on the terminal or bank app.";
        render();
        return;
      }
      pending = {
        base: base(),
        body: {
          branchId,
          planId: plan.id,
          version: plan.version,
          guest: selected === "" ? null : Number(selected),
          amountMinor: paid,
          method,
          receivedMinor: method === "Cash" ? cash : paid,
          reference,
          request_id: crypto.randomUUID(),
        },
      };
      if (!save()) {
        pending = null;
        render();
        return;
      }
    }
    if (pending.base !== base()) {
      error = "Return to the original server to confirm this payment.";
      render();
      return;
    }
    busy = true;
    error = "";
    render();
    try {
      const result = await request("post", root() + "/record", pending.body);
      if (result.confirmed !== pending.body.request_id)
        throw new Error("Unconfirmed");
      plan = result;
      pending = null;
      localStorage.removeItem(key);
      selected = "";
      received = receivedDefault();
      verified = false;
      reference = "";
      error = "";
      window.dispatchEvent(
        new CustomEvent("captain:payment-recorded", {
          detail: { table, remaining: plan.dueMinor },
        }),
      );
    } catch (e) {
      if ([400, 403, 409, 422].includes(e.status)) {
        pending = null;
        localStorage.removeItem(key);
        busy = false;
        await load();
        error =
          e.status === 403
            ? "Payment collection is not enabled for this phone."
            : "Another payment changed this bill. Review the remaining balance.";
      } else {
        error =
          "Payment status is not confirmed. Retry this request; do not collect the money again.";
        save();
      }
    } finally {
      busy = false;
      render();
    }
  }
  async function close() {
    dialog.close();
    if (plan && !pending && !busy && plan.paidMinor === 0)
      request("post", root() + "/release", { planId: plan.id, branchId }).catch(
        () => {},
      );
  }
  function setup() {
    if (dialog) return;
    const style = document.createElement("style");
    style.textContent = `#captain-payments{width:min(100vw,480px);max-width:100vw;max-height:100dvh;height: min(100dvh,780px);border:0;border-radius:18px;padding:0;color:#172033;background:#fff;font:inherit;box-shadow:0 16px 60px #0004}#captain-payments::backdrop{background:#15223b88}#captain-payments[open]{display:flex;flex-direction:column}#captain-payments *{box-sizing:border-box}#captain-payments header,#captain-payments footer{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid #e4e8ee}#captain-payments h2{font-size:20px;margin:0;flex:1}#captain-payments h2 small{font-size:14px;display:block;color:#667085;margin-top:4px}#captain-payments button{min-height:46px;padding:10px 16px;border:1px solid #dbe1eb;border-radius:10px;background:white;color:inherit;font:inherit;font-weight:600;cursor:pointer}#captain-payments button:disabled{opacity:.55;cursor:wait}#captain-payments .cp-body{padding:20px;overflow:auto;flex:1}#captain-payments footer{border-top:1px solid #e4e8ee;border-bottom:0;padding-bottom:max(16px,env(safe-area-inset-bottom))}#captain-payments .cp-primary{flex:1;background:#5146e5;color:white;border-color:#5146e5}#captain-payments .cp-balance{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}#captain-payments .cp-balance strong{font-size:26px}#captain-payments .cp-guests{margin-bottom:22px;border:1px solid #e4e8ee;border-radius:12px;padding:4px 14px}#captain-payments .cp-guests>div{display:flex;justify-content:space-between;padding:12px 0;gap:12px}#captain-payments label{display:block;margin:16px 0;font-weight:600}#captain-payments input:not([type=checkbox]),#captain-payments select{display:block;width:100%;min-height:48px;padding:10px;margin-top:8px;border:1px solid #cbd3df;border-radius:10px;font:inherit;background:white;color:inherit}#captain-payments .cp-methods{display:flex;gap:8px;flex-wrap:wrap}#captain-payments .cp-methods button{flex:1}#captain-payments [aria-pressed=true]{border-color:#5146e5;background:#efedff;color:#3529aa}#captain-payments .cp-change{display:flex;justify-content:space-between;gap:10px}#captain-payments .cp-confirm{display:flex;align-items:flex-start;gap:10px;line-height:1.5}#captain-payments .cp-confirm input{width:22px;height:22px;flex:none}#captain-payments .cp-help{color:#667085;font-size:13px;line-height:1.5;margin-top:22px}#captain-payments .cp-error{padding:12px;background:#fff5e6;color:#754700;border-radius:10px;line-height:1.5}@media(max-width:480px){#captain-payments{width:100%;height:100dvh;max-height:100dvh;border-radius:0;margin:0}}`;
    document.head.append(style);
    dialog = document.createElement("dialog");
    dialog.id = "captain-payments";
    dialog.setAttribute("aria-label", t("Collect payment"));
    document.body.append(dialog);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    dialog.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "close") close();
      if (action === "record") record();
      const m = e.target.closest("[data-method]")?.dataset.method;
      if (m) {
        method = m;
        verified = false;
        error = "";
        render();
      }
    });
    dialog.addEventListener("change", (e) => {
      if (e.target.id === "cp-guest") {
        selected = e.target.value;
        received = receivedDefault();
        verified = false;
        render();
      }
      if (e.target.id === "cp-verified") verified = e.target.checked;
    });
    dialog.addEventListener("input", (e) => {
      if (e.target.id === "cp-reference") reference = e.target.value;
      if (e.target.id === "cp-received") {
        received = e.target.value;
        dialog.querySelector("#cp-change").textContent = money(
          Math.max(0, cashMinor() - amount()),
        );
      }
    });
  }
  async function open(value, branchValue, draft) {
    setup();
    if (busy) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    splitDraft = draft || null;
    table = String(value);
    branchId = String(branchValue || branch());
    key = "posnic.payment:" + base() + ":" + branchId + ":" + table;
    plan = null;
    pending = null;
    error = "";
    selected = "";
    reference = "";
    verified = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const candidate = localStorage.key(i);
        if (
          candidate.startsWith("posnic.payment:") &&
          candidate.endsWith(":" + branchId + ":" + table)
        ) {
          const prior = JSON.parse(localStorage.getItem(candidate) || "null");
          if (prior?.pending) {
            key = candidate;
            break;
          }
        }
      }
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved?.pending) {
        pending = saved.pending;
        plan = saved.plan;
        error =
          "Payment status is not confirmed. Retry this request; do not collect the money again.";
      }
    } catch {}
    render();
    if (!dialog.open) dialog.showModal();
    if (!pending) await load();
  }
  async function available() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const storedKey = localStorage.key(i);
        if (storedKey.startsWith("posnic.payment:")) {
          const saved = JSON.parse(localStorage.getItem(storedKey) || "null");
          if (saved?.pending?.body?.branchId === String(branch())) return true;
        }
      }
    } catch {}
    try {
      return (
        (
          await request(
            "get",
            mobile()
              ? "/captain/v1/payment-options"
              : "/sales/tablePayments/options",
          )
        ).enabled === true
      );
    } catch {
      return false;
    }
  }
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-collect-table]");
    if (button) open(button.dataset.collectTable, button.dataset.branchId);
  });
  window.addEventListener("captain:back", (e) => {
    if (dialog?.open) {
      e.preventDefault();
      close();
    }
  });
  window.CaptainPayments = { open, available };
})();
