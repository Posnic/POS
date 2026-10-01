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
              );
            if (method === "recover") return request(base + "/recover", {});
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
