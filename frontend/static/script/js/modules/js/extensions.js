/* The host owns session headers and endpoint selection. Extension frames
 * receive data and command results only, never credentials or arbitrary URLs. */
(function () {
  "use strict";
  var generation = 0,
    mounted = null;
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
    var state = await request("/installation/status");
    if (run !== generation) return;
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
          cancel.disabled = true;
          try {
            await request("/installation/cancel", {});
            await PosnicPro.extensions.showDataTablePage();
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
            await PosnicPro.extensions.showDataTablePage();
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
    showDataTablePage: async function () {
      var run = show("Extensions");
      try {
        var data = await request("");
        if (run !== generation) return;
        status(
          data.extensions.length
            ? "Choose an extension."
            : "No extensions are enabled for this shop.",
        );
        var list = document.createElement("div");
        list.className = "list-group";
        data.extensions.forEach(function (item) {
          var link = document.createElement("a");
          link.className = "list-group-item list-group-item-action";
          link.href = "#/extensions/" + encodeURIComponent(item.id);
          link.textContent = item.displayName + " · " + item.version;
          list.append(link);
        });
        document.getElementById("extensions_content").append(list);
        if (data.canManage) await installationControls(run);
      } catch (error) {
        if (run === generation) status(error.message);
      }
    },
    showDetails: async function (id) {
      var run = show("Extension");
      if (!/^[a-z][a-z0-9.-]{2,99}$/.test(id)) {
        status("Invalid extension.");
        return;
      }
      var base = "/" + id;
      // Pin the branch at opening. Switching branch requires reopening
      // the frame so an old basket can never be submitted in a new shop.
      var branch = String(PosnicPro.local.get("branch_id_set") || "");
      async function afterCommand(result) {
        if (
          run !== generation ||
          branch !== String(PosnicPro.local.get("branch_id_set") || "")
        )
          return result;
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
          container: document.getElementById("extensions_content"),
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
                return { capabilities: values[0], namespace: values[1] };
              });
            if (method === "state") return request(base + "/state");
            if (method === "sales")
              return request(
                base + "/sales?after=" + encodeURIComponent(input.after || ""),
              );
            if (method === "salesReport")
              return request(
                base +
                  "/sales-report?day=" +
                  encodeURIComponent(input.day || ""),
              );
            if (method === "catalogue")
              return request(
                base +
                  "/catalogue?q=" +
                  encodeURIComponent(input.query || "") +
                  "&after=" +
                  encodeURIComponent(input.after || ""),
              );
            if (method === "command")
              return request(
                base + "/commands",
                {
                  expectedRevision: input.expectedRevision,
                  command: input.command,
                },
                input.requestKey,
              ).then(afterCommand);
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
        if (run === generation) status(error.message);
      }
    },
  };
  window.addEventListener("hashchange", function () {
    if (!/^#\/?extensions(?:\/|$)/.test(window.location.hash)) close();
  });
})();
