/* The host owns session headers and endpoint selection. Extension frames
 * receive data and command results only, never credentials or arbitrary URLs. */
(function () {
  "use strict";
  var generation = 0,
    menuGeneration = 0,
    mounted = null;
  async function exportReport(input) {
    if (!['csv','xls','pdf','print'].includes(input.format) || !Array.isArray(input.rows) || input.rows.length > 30 || typeof input.range !== 'string' || input.range.length > 120)
      throw Error('Invalid extension report.');
    const rows = input.rows.map(row => {
      if (!Array.isArray(row) || row.length !== 3 || row.some(cell => typeof cell !== 'string' || cell.length > 150)) throw Error('Invalid report cells.');
      return row.map(cell => /^[=+@\-\t\r]/.test(cell) ? "'" + cell : cell);
    });
    const root = document.createElement('div'); root.id='extension-report-'+crypto.randomUUID(); root.hidden=true;
    const table=document.createElement('table'); table.setAttribute('data-export-include','');
    [['Type','Currency','Amount'],...rows].forEach((row,index)=>{const tr=document.createElement('tr');row.forEach(cell=>{const td=document.createElement(index?'td':'th');td.textContent=cell;tr.appendChild(td)});table.appendChild(tr)});
    root.appendChild(table); document.body.appendChild(root);
    const meta={title:PosnicPro.i18n.t('lang_basket_review_report', 'Basket Review report'),range:input.range,filename:'basket-review-report'};
    try {
      if (input.format==='csv'||input.format==='xls') PosnicPro.reportExport[input.format](root.id,meta);
      else {
        await PosnicPro.lazy.load('jspdf');
        const C=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF||window.jspdf;
        if(typeof C!=='function')throw Error('PDF tools unavailable.');
        const doc=PosnicPro.reportExport._buildDoc(root.id,meta,C);
        if(!doc)throw Error('Report unavailable.');
        if(input.format==='pdf')doc.save(meta.filename+'.pdf');
        else await PosnicPro.printPdfDocument(doc,meta.filename,'Allow pop-ups to print the report.');
      }
      return {exported:true};
    } finally {root.remove()}
  }
  function close() {
    generation++;
    if (mounted) mounted.destroy();
    mounted = null;
  }
  function request(path, body, key) {
    return new Promise(function (resolve, reject) {
      PosnicPro.request(
        {
          url: "extensions/v1" + path,
          method: body ? "POST" : "GET",
          data: body ? JSON.stringify(body) : undefined,
          idempotencyKey: key,
        },
        resolve,
        function (xhr) {
          var detail = xhr.responseJSON && xhr.responseJSON.error;
          var error = new Error(
            (detail && detail.message) ||
              "Unable to reach Posnic. Check the connection and retry.",
          );
          error.code = (detail && detail.code) || "EXTENSION_CONNECTION_FAILED";
          reject(error);
        },
      );
    });
  }
  function show(title) {
    close();
    PosnicPro.HideSideBarModal();
    $(".page_loader,#osk-container").hide();
    $("#extensions,.page-title-box").show();
    $(".dashboard_img_menu").hide();
    document.getElementById("extensions_title").textContent = title;
    document.getElementById("extensions_status").textContent = "Loading…";
    document.getElementById("extensions_content").replaceChildren();
    return generation;
  }
  function status(value) {
    document.getElementById("extensions_status").textContent = value;
  }
  async function installationControls(run) {
    var openingBranch = String(PosnicPro.local.get("branch_id_set") || "");
    var state = await request("/installation/status");
    if (run !== generation) return;
    if (openingBranch !== String(PosnicPro.local.get("branch_id_set") || "")) {
      status("The shop changed. Reopen Extensions before installing.");
      return;
    }
    var section = document.createElement("section");
    section.className = "card mt-3";
    var body = document.createElement("div");
    body.className = "card-body";
    section.append(body);
    var heading = document.createElement("h5");
    heading.textContent = "Install or update an extension";
    body.append(heading);
    var note = document.createElement("p");
    note.setAttribute("role", "status");
    body.append(note);
    document.getElementById("extensions_content").append(section);
    if (!state.available) {
      note.textContent =
        "Extension installation is not configured on this host. Contact your installation administrator.";
      return;
    }
    if (state.busy) {
      note.textContent = state.pending
        ? state.pending.id +
          " " +
          state.pending.version +
          " is queued. Finish pending transactions, close Posnic and reopen it to apply the package."
        : "An installation is queued for another shop on this host.";
      if (state.pending) {
        var cancel = document.createElement("button");
        cancel.className = "btn btn-light";
        cancel.textContent = "Cancel queued installation";
        cancel.onclick = async function () {
          if (run !== generation || openingBranch !== String(PosnicPro.local.get("branch_id_set") || "")) {
            note.textContent = "The shop changed. Reopen Extensions before installing.";
            return;
          }
          cancel.disabled = true;
          try {
            await request("/installation/cancel", {});
            if (run === generation) await PosnicPro.extensions.showDataTablePage("installation");
          } catch (error) {
            note.textContent = error.message;
            cancel.disabled = false;
          }
        };
        body.append(cancel);
      }
      return;
    }
    note.textContent =
      "Choose the signed extension ZIP supplied by Posnic. Installation preserves basket data and takes effect after restart. To roll back, choose the previously supplied compatible package.";
    var file = document.createElement("input");
    file.type = "file";
    file.accept = ".zip";
    file.className = "form-control mb-2";
    file.setAttribute("aria-label", "Signed extension package");
    body.append(file);
    var review = document.createElement("button");
    review.className = "btn btn-primary";
    review.textContent = "Verify package";
    body.append(review);
    var pinnedBranch = String(PosnicPro.local.get("branch_id_set") || "");
    function current() {
      if (
        run !== generation ||
        pinnedBranch !== String(PosnicPro.local.get("branch_id_set") || "")
      )
        throw new Error(
          "The shop changed. Reopen Extensions before installing.",
        );
    }
    review.onclick = async function () {
      try {
        current();
        var selected = file.files[0];
        if (!selected || selected.size > 24 * 1024 * 1024)
          throw new Error(
            "Choose a signed extension ZIP no larger than 24 MB.",
          );
        review.disabled = true;
        file.disabled = true;
        note.textContent = "Verifying package…";
        var staged = await new Promise(function (resolve, reject) {
          PosnicPro.request(
            {
              url: "extensions/v1/installation/stage",
              method: "POST",
              data: selected,
              contentType: "application/octet-stream",
              processData: false,
            },
            resolve,
            function (xhr) {
              reject(
                new Error(
                  xhr.responseJSON?.error?.message ||
                    "Package verification failed.",
                ),
              );
            },
          );
        });
        current();
        note.textContent =
          "Verified: " +
          staged.id +
          " · " +
          staged.version +
          ". Apply this version to the current shop on the next restart?";
        review.textContent = "Apply on next restart";
        review.disabled = false;
        review.onclick = async function () {
          try {
            current();
            review.disabled = true;
            await request("/installation/activate", {
              id: staged.id,
              version: staged.version,
            });
            if (run === generation) await PosnicPro.extensions.showDataTablePage("installation");
          } catch (error) {
            note.textContent = error.message;
            review.disabled = false;
          }
        };
      } catch (error) {
        note.textContent = error.message;
        review.disabled = false;
        file.disabled = false;
      }
    };
  }
  PosnicPro.extensions = {
    closeEmbedded: close,
    refreshMenu: async function () {
      var menuRun = ++menuGeneration;
      var branch = String(PosnicPro.local.get('branch_id_set') || '');
      document.querySelectorAll('[data-extension-menu]').forEach(function (node) { node.remove(); });
      if (!branch) return;
      try {
        var data = await request('');
        if (menuRun !== menuGeneration || branch !== String(PosnicPro.local.get('branch_id_set') || '')) return;
        document.querySelectorAll('[data-extension-menu]').forEach(function (node) { node.remove(); });
        if (PosnicPro.saleExtensions) PosnicPro.saleExtensions.configure(data.extensions);
        var anchor = document.getElementById('view_touchsales_page');
        if (!anchor) return;
        data.extensions.filter(function (item) { return item.enabled !== false && item.menu === 'sales'; }).forEach(function (item) {
          var row = document.createElement('li'), link = document.createElement('a'), icon = document.createElement('img');
          row.dataset.extensionMenu = item.id;
          link.href = '#/extensions/' + encodeURIComponent(item.id);
          icon.src = 'static/images/svg-icon/basket-review.svg'; icon.alt = ''; icon.className = 'img-fluid';
          link.append(icon, document.createTextNode(item.displayName)); row.append(link);
          anchor.parentElement.after(row);
          if (window.location.hash === link.getAttribute('href')) {
            row.classList.add('active'); link.classList.add('active');
            var pane = $(row).closest('.tab-pane');
            $('.vertical-menu-icon [href="#' + pane.attr('id') + '"]').tab('show');
          }
        });
      } catch (_) { /* No extension navigation when the authorised list is unavailable. */ }
    },
    showDataTablePage: async function (selectedTab) {
      var run = show("Extensions");
      var branch = String(PosnicPro.local.get("branch_id_set") || "");
      try {
        var data = await request("");
        if (run !== generation) return;
        if (branch !== String(PosnicPro.local.get("branch_id_set") || "")) {
          status("The shop changed. Reopen Extensions to see its installed packages.");
          return;
        }
        var content = document.getElementById("extensions_content");
        var installing = selectedTab === "installation" && data.canManage;
        var tabs = document.createElement("div");
        tabs.className = "nav nav-tabs mb-3";
        tabs.setAttribute("aria-label", "Extension views");
        function tab(label, name, active) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "nav-link" + (active ? " active" : "");
          button.textContent = label;
          button.setAttribute("aria-pressed", String(active));
          button.onclick = function () {
            PosnicPro.extensions.showDataTablePage(name);
          };
          tabs.append(button);
        }
        tab("Your extensions (" + data.extensions.length + ")", "installed", !installing);
        if (data.canManage) tab("Install or update", "installation", installing);
        content.append(tabs);
        if (installing) {
          status("Install a signed package supplied by Posnic.");
          await installationControls(run);
          return;
        }
        status(
          data.extensions.length
            ? "Extensions available to you in this shop."
            : "No extensions are enabled for this shop.",
        );
        var search = document.createElement("input");
        search.type = "search";
        search.className = "form-control mb-3";
        search.placeholder = "Search installed extensions…";
        search.setAttribute("aria-label", "Search installed extensions");
        search.style.maxWidth = "420px";
        if (data.extensions.length) content.append(search);
        var list = document.createElement("div");
        list.className = "row";
        content.append(list);
        function renderInstalled() {
          list.replaceChildren();
          var query = search.value.trim().toLowerCase();
          var matches = data.extensions.filter(function (item) {
            return (item.displayName + " " + item.id + " " + item.version)
              .toLowerCase().includes(query);
          });
          matches.forEach(function (item) {
            var column = document.createElement("div");
            column.className = "col-12 col-md-6 col-xl-4 mb-3";
            var card = document.createElement("article");
            card.className = "card h-100";
            var body = document.createElement("div");
            body.className = "card-body";
            var heading = document.createElement("h5");
            var link = document.createElement("a");
            if (item.enabled !== false)
              link.href = "#/extensions/" + encodeURIComponent(item.id);
            link.textContent = item.displayName + " · " + item.version;
            link.style.overflowWrap = "anywhere";
            heading.append(link);
            var enabled = document.createElement("span");
            enabled.className = "badge mb-2 " + (item.enabled === false ? "badge-secondary" : "badge-success");
            enabled.textContent = item.installed === false ? "Removed · data retained" : item.enabled === false ? "Disabled" : "Enabled";
            var note = document.createElement("p");
            note.className = "text-muted mb-0";
            note.textContent = item.installed === false ? "Removed from this shop. Restore the verified package, then enable it to resume."
              : item.enabled === false
              ? "Data is retained. Enable this extension to use its tools."
              : "Open this extension to use its tools.";
            body.append(enabled, heading, note);
            if (data.canManage) {
              var toggle = document.createElement("button");
              toggle.type = "button";
              toggle.className = "btn btn-light mt-3";
              toggle.textContent = item.enabled === false ? "Enable" : "Disable";
              toggle.setAttribute("aria-label", toggle.textContent + " " + item.displayName);
              toggle.onclick = async function () {
                if (run !== generation || branch !== String(PosnicPro.local.get("branch_id_set") || "")) {
                  status("The shop changed. Reopen Extensions before changing an extension.");
                  return;
                }
                toggle.disabled = true;
                try {
                  await request("/" + encodeURIComponent(item.id) + "/enabled", { enabled: item.enabled === false });
                  await PosnicPro.extensions.refreshMenu();
                  if (run === generation) await PosnicPro.extensions.showDataTablePage();
                } catch (error) {
                  if (run === generation) {
                    status(error.code === "extension_operation_in_progress"
                      ? "Finish or recover the extension's current operation, then try again. No data has been removed."
                      : error.message);
                    toggle.disabled = false;
                  }
                }
              };
              body.append(toggle);
              toggle.hidden = item.installed === false;
              var removal = document.createElement("button");
              removal.type = "button";
              removal.className = "btn btn-light mt-3 ml-2";
              removal.textContent = item.installed === false ? "Restore" : "Remove from shop";
              removal.onclick = async function () {
                function current() { return run === generation && branch === String(PosnicPro.local.get("branch_id_set") || ""); }
                if (!current()) return;
                if (item.installed !== false && !window.confirm("Remove this extension from this shop? Basket data, stock, sales and payment records will be retained. Other shops are unchanged. You can restore it later.")) return;
                removal.disabled = true;
                try {
                  await request("/" + encodeURIComponent(item.id) + "/installed", { installed: item.installed === false, retainData: true });
                  if (!current()) return;
                  await PosnicPro.extensions.refreshMenu();
                  if (current()) await PosnicPro.extensions.showDataTablePage();
                } catch (error) {
                  if (current()) {
                    status(error.code === "extension_payment_unresolved" ? "Finish or cancel pending payments before removing this extension. No data was removed." : error.message);
                    removal.disabled = false;
                  }
                }
              };
              body.append(removal);
              var history = document.createElement("button");
              history.type = "button";
              history.className = "btn btn-light mt-3 ml-2";
              history.textContent = "Activity";
              history.setAttribute("aria-label", "Activity for " + item.displayName);
              var activity = document.createElement("div");
              activity.className = "mt-3";
              activity.hidden = true;
              activity.setAttribute("role", "status");
              var cursor;
              async function loadActivity() {
                function current() {
                  return run === generation && body.isConnected &&
                    branch === String(PosnicPro.local.get("branch_id_set") || "");
                }
                if (!current()) return;
                history.disabled = true;
                activity.hidden = false;
                try {
                  var result = await request("/" + encodeURIComponent(item.id) +
                    "/lifecycle-history" + (cursor ? "?before=" + cursor : ""));
                  if (!current()) return;
                  if (!cursor) activity.replaceChildren();
                  if (!result.events.length && !cursor) activity.textContent = "No activation changes recorded.";
                  result.events.forEach(function (event) {
                    var entry = document.createElement("p");
                    entry.className = "small mb-2";
                    entry.textContent = ({ enabled: "Enabled", disabled: "Disabled", removed: "Removed from shop", restored: "Restored" }[event.action] || "Lifecycle change") +
                      " · " + new Date(event.changedAt).toLocaleString() +
                      " · v" + event.version + " · Staff ID: " + event.actorId;
                    activity.append(entry);
                  });
                  cursor = result.next;
                  history.textContent = cursor ? "Older activity" : "Refresh activity";
                } catch (error) {
                  if (current()) status(error.message);
                } finally {
                  if (current()) history.disabled = false;
                }
              }
              history.onclick = loadActivity;
              body.append(history, activity);
            }
            card.append(body);
            column.append(card);
            list.append(column);
          });
          if (!matches.length && data.extensions.length) {
            var empty = document.createElement("p");
            empty.className = "col-12 text-muted";
            empty.setAttribute("role", "status");
            empty.textContent = "No installed extensions match your search.";
            list.append(empty);
          }
        }
        search.oninput = renderInstalled;
        renderInstalled();
      } catch (error) {
        if (run === generation) status(error.message);
      }
    },
    showDetails: async function (id, embedded) {
      PosnicPro.extensions.refreshMenu();
      var run;
      if (embedded) { close(); run = generation; } else run = show("Extension");
      if (!/^[a-z][a-z0-9.-]{2,99}$/.test(id)) {
        status("Invalid extension.");
        return;
      }
      var base = "/" + id;
      // Pin the branch at opening. Switching branch requires reopening
      // the frame so an old basket can never be submitted in a new shop.
      var branch = String(PosnicPro.local.get("branch_id_set") || "");
      async function afterCommand(result, commandType) {
        if (
          run !== generation ||
          branch !== String(PosnicPro.local.get("branch_id_set") || "")
        )
          return result;
        if (embedded && embedded.onCommand) embedded.onCommand(result, commandType);
        var drawer = window.electronAPI && window.electronAPI.cashDrawer;
        if (!drawer || !Array.isArray(result.hostActions)) return result;
        try {
          var config = await drawer.loadConfig();
          if (!config || !config.autoOpenOnSale) return result;
          if (!config.printerName || config.method === "serial")
            throw new Error("Choose the drawer printer in Hardware Manager.");
          for (var action of result.hostActions) {
            if (action.type !== "cash-sale-completed") continue;
            if (
              run !== generation ||
              branch !== String(PosnicPro.local.get("branch_id_set") || "")
            )
              return result;
            var claim = await request(base + "/cash-drawer", {
              saleId: action.saleId,
            });
            if (!claim.open) continue;
            // Claim is durable before IPC, so lost responses/restarts never
            // automatically pulse a second time. A miss needs manual opening.
            if (
              run !== generation ||
              branch !== String(PosnicPro.local.get("branch_id_set") || "")
            )
              return result;
            var opened = await drawer.openViaPrinter(
              config.printerName,
              config.pin || 0,
            );
            if (!opened || !opened.success)
              throw new Error(
                (opened && opened.error) || "Cash drawer did not open.",
              );
          }
        } catch (error) {
          status(
            "Sale saved. Check the cash drawer and use its manual control if needed. " +
              error.message,
          );
        }
        return result;
      }
      try {
        var data = await request(base + "/view");
        if (run !== generation) return;
        document.getElementById("extensions_title").textContent =
          data.displayName;
        status("");
        mounted = PosnicExtensionFrame.mount({
          container: embedded ? embedded.container : document.getElementById("extensions_content"),
          extensionId: id,
          title: data.displayName,
          view: data.view,
          request: function (method, input) {
            if (
              run !== generation ||
              branch !== String(PosnicPro.local.get("branch_id_set") || "")
            )
              throw new Error(
                "The shop or page changed. Reopen the extension before continuing.",
              );
            if (method === "bootstrap")
              return Promise.all([
                request(base + "/capabilities"),
                request(base + "/state"),
              ]).then(function (values) {
                return { capabilities: values[0], namespace: values[1], salesWorkspace: embedded ? embedded.workspace : null };
              });
            if (method === "state") return request(base + "/state");
            if (method === "sales")
              return request(
                base + "/sales?after=" + encodeURIComponent(input.after || ""),
              );
            if (method === "exportReport") return exportReport(input);
            if (method === "salesReport")
              return request(
                base +
                  "/sales-report?day=" +
                  encodeURIComponent(input.day || "") + "&endDay=" + encodeURIComponent(input.endDay || input.day || ""),
              );
            if (method === "catalogue")
              return request(
                base +
                  "/catalogue?q=" +
                  encodeURIComponent(input.query || "") +
                  "&after=" +
                  encodeURIComponent(input.after || ""),
              );
            if (method === "command") {
              if (embedded && embedded.onBusy) embedded.onBusy(true);
              return request(
                base + "/commands",
                {
                  expectedRevision: input.expectedRevision,
                  command: input.command,
                },
                input.requestKey,
              ).then(function(result){if(embedded && embedded.onBusy) embedded.onBusy(false);return afterCommand(result, input.command?.type);},function(error){if(embedded && embedded.onBusy) embedded.onBusy(!error.code || error.code === 'EXTENSION_CONNECTION_FAILED');throw error;});
            }
            if (method === "recover")
              return request(base + "/recover", {}).then(afterCommand);
            if (method === "receipt")
              return request(base + "/receipt", input).then(
                async function (receipt) {
                  if (
                    run !== generation ||
                    branch !==
                      String(PosnicPro.local.get("branch_id_set") || "")
                  )
                    throw new Error(
                      "The shop changed. Reopen the extension before printing.",
                    );
                  var document = receipt.document;
                  if (receipt.kind === "paid") {
                    if (!/^[a-f0-9]{24}$/i.test(receipt.saleId || ""))
                      throw new Error("Invalid receipt reference.");
                    document = await new Promise(function (resolve, reject) {
                      PosnicPro.request(
                        { url: "sales/" + receipt.saleId },
                        function (response) {
                          if (response.type !== "success")
                            return reject(
                              new Error(
                                response.message || "Receipt unavailable.",
                              ),
                            );
                          resolve(response.data);
                        },
                        function () {
                          reject(new Error("Could not load the paid receipt."));
                        },
                      );
                    });
                  }
                  if (
                    run !== generation ||
                    branch !==
                      String(PosnicPro.local.get("branch_id_set") || "")
                  )
                    throw new Error(
                      "The shop changed. Reopen the extension before printing.",
                    );
                  if (!document || !PosnicPro.receiptDesigner)
                    throw new Error("Receipt printing is unavailable.");
                  return PosnicPro.receiptDesigner.printSale(
                    document,
                    undefined,
                    false,
                    { preserveWorkspace: true, propagateFailure: true },
                  );
                },
              );
            throw new Error(
              "This host does not support that extension operation yet.",
            );
          },
        });
      } catch (error) {
        if (run === generation) { if (embedded) embedded.container.textContent = error.message; else status(error.message); }
      }
    },
  };
  window.addEventListener("hashchange", function () {
    if (!/^#\/?extensions(?:\/|$)/.test(window.location.hash)) close();
  });
})();
