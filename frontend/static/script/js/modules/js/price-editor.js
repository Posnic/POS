/* Price Settings: bounded pages, recoverable drafts and resumable price-sheet jobs. */
(function () {
  "use strict";
  var p = PosnicPro.pricesettings;
  var priceBranches = [],
    selectedBranches = [],
    branchScopeKey = "",
    editingMode = "file",
    reviewScreen = false;
  function branchName(id) {
    var branch = priceBranches.find(function (b) {
      return b.id === String(id);
    });
    return branch ? branch.code + " · " + branch.name : String(id || "");
  }
  async function loadBranches() {
    var capturedKey = key();
    if (branchScopeKey !== capturedKey) {
      selectedBranches = [];
      branchScopeKey = capturedKey;
    }
    priceBranches = await api({ action: "branches" });
    if (key() !== capturedKey) return;
    if (!selectedBranches.length)
      selectedBranches = [String(PosnicPro.local.get("branch_id_set"))];
    selectedBranches = selectedBranches.filter(function (id) {
      return priceBranches.some(function (b) {
        return b.id === id;
      });
    });
    var container = $("#ps-branches")
      .empty()
      .prop("hidden", priceBranches.length <= 1 || editingMode === "schedules");
    if (priceBranches.length <= 1) return;
    var picker = $("<details>").appendTo(container);
    function selectionLabel() {
      picker
        .find("summary")
        .text(
          "Apply prices to: " +
            selectedBranches.length +
            " of " +
            priceBranches.length +
            " branches",
        );
    }
    $('<summary class="btn btn-light">').appendTo(picker);
    selectionLabel();
    var box = $('<div class="ps-branch-options">').appendTo(picker);
    $('<button class="btn btn-light ml-2">')
      .text("All accessible branches")
      .on("click", function () {
        selectedBranches = priceBranches.map(function (b) {
          return b.id;
        });
        loadBranches().then(function () {
          p.gridLoad(1);
          p.sheetCount();
        });
      })
      .appendTo(box);
    priceBranches.forEach(function (b) {
      var row = $('<div class="ps-branch-row">').appendTo(box);
      $('<label class="m-2">')
        .append(
          $('<input type="checkbox">')
            .prop("checked", selectedBranches.includes(b.id))
            .on("change", function () {
              selectedBranches = $("#ps-branches input:checked")
                .map(function () {
                  return this.value;
                })
                .get();
              selectionLabel();
              p.gridLoad(1);
              p.sheetCount();
            })
            .val(b.id),
          document.createTextNode(" " + branchName(b.id)),
        )
        .appendTo(row);
      $('<button class="btn btn-link btn-sm">')
        .text("Edit code")
        .on("click", async function () {
          var code = window.prompt(
            "Short branch code for " + b.name + " (for example ABC)",
            b.code,
          );
          if (!code) return;
          try {
            await api({ action: "branchCode", targetBranchId: b.id, code: code });
            await loadBranches();
          } catch (e) {
            error(e);
          }
        })
        .appendTo(row);
    });
  }
  function t(key, fallback) {
    return PosnicPro.i18n ? PosnicPro.i18n.t(key, fallback) : fallback;
  }
  function categories(id) {
    return $("#" + id + " input:checked")
      .map(function () {
        return this.value;
      })
      .get();
  }
  function categoryLabel(id) {
    var selected = $("#" + id + " input:checked");
    $("#" + id + " summary").text(
      selected.length
        ? selected
            .map(function () {
              return $(this).parent().text().trim();
            })
            .get()
            .join(", ")
        : t("lang_all_categories", "All categories"),
    );
  }
  // Keep multi-select choices open while selecting; dismiss on outside interaction.
  $(document).off("click.priceCategories keydown.priceCategories")
    .on("click.priceCategories", function (event) {
      $(".ps-category-picker[open]").each(function () {
        if (!this.contains(event.target)) this.open = false;
      });
    }).on("keydown.priceCategories", function (event) {
      if (event.key !== "Escape") return;
      $(".ps-category-picker[open]").each(function () {
        this.open = false;
        if (this.contains(document.activeElement)) $(this).find("summary").trigger("focus");
      });
    });
  p.setPriceCategories = function (items) {
    ["ps-grid-category", "ps-sheet-category"].forEach(function (id) {
      var selected = categories(id),
        box = $("#" + id + " .ps-category-list").empty();
      items.forEach(function (item) {
        $("<label>")
          .append(
            $("<input type='checkbox'>")
              .val(item.id)
              .prop("checked", selected.includes(String(item.id))),
            document.createTextNode(item.name),
          )
          .appendTo(box);
      });
      categoryLabel(id);
    });
  };
  p.categoriesChanged = function (id) {
    categoryLabel(id);
    if (id === "ps-grid-category") p.gridLoad(1);
    else p.sheetCount();
  };
  p.clearCategories = function (id) {
    $("#" + id + " input").prop("checked", false);
    p.categoriesChanged(id);
  };
  p.clearPriceFilters = function (where) {
    $("#ps-" + where + "-search").val("");
    p.clearCategories("ps-" + where + "-category");
  };
  p.editMode = function (mode) {
    editingMode = mode;
    ["file", "direct", "schedules"].forEach(function (name) {
      var active = name === mode;
      $("#ps-" + name + "-panel").prop("hidden", !active);
      $("#ps-" + name + "-tab")
        .attr("aria-selected", String(active))
        .attr("tabindex", active ? "0" : "-1");
    });
    $("#ps-branches").prop(
      "hidden",
      mode === "schedules" || priceBranches.length <= 1,
    );
    if (mode === "schedules") p.sheetHistory(historyPage);
    if (mode === "file") {
      p.sheetOpen("download");
    }
  };
  p.editModeKey = function (event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    var modes = ["file", "direct", "schedules"],
      index = modes.indexOf(editingMode);
    var mode =
      modes[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 2
            : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3
      ];
    p.editMode(mode);
    $("#ps-" + mode + "-tab").focus();
  };
  p._gridRows = {};
  p._gridPage = 1;
  p.gridSearch = function () {
    clearTimeout(p._gridTimer);
    p._gridTimer = setTimeout(function () {
      p.gridLoad(1);
    }, 250);
  };
  var fields = {
    selling_price: "Selling price",
    company_price: "Cost price",
    mrp_price: "MRP",
  };
  var visible = {
    itemid: true,
    unit: true,
    selling_price: true,
    company_price: false,
    mrp_price: false,
  };
  var draft = {},
    scope = "",
    ready,
    dbPromise,
    sequence = 0,
    busy = false,
    currentJob,
    currentRevision = 0,
    holdSelections = {},
    jobPage = 1,
    filter = "changes";
  var originalShow = p.showDataTablePage;
  function key() {
    return (
      location.origin +
      ":" +
      PosnicPro.local.get("branch_id_set") +
      ":" +
      PosnicPro.local.get("userid")
    );
  }
  function db() {
    if (!dbPromise)
      dbPromise = new Promise(function (resolve, reject) {
        var request = indexedDB.open("posnic-price-drafts", 1);
        request.onupgradeneeded = function () {
          request.result.createObjectStore("drafts");
        };
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    return dbPromise;
  }
  function storage(write) {
    var captured = scope,
      snapshot = JSON.parse(JSON.stringify(draft));
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(
          "drafts",
          write ? "readwrite" : "readonly",
        );
        var request = write
          ? tx.objectStore("drafts").put(snapshot, captured)
          : tx.objectStore("drafts").get(captured);
        tx.oncomplete = function () {
          resolve(request.result);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.onabort = tx.onerror;
      });
    });
  }
  function persist() {
    storage(true)
      .then(function () {
        $("#ps-draft-status").text(
          "Draft saved on this device. Prices are not applied yet.",
        );
      })
      .catch(function () {
        $("#ps-draft-status").text(
          "Draft storage is unavailable. Keep this screen open until the update finishes.",
        );
      });
  }
  function api(data) {
    return new Promise(function (resolve, reject) {
      PosnicPro.post(
        { url: "items/priceSheet", data: JSON.stringify(data) },
        function (r) {
          if (r.type === "success") resolve(r.data);
          else reject(new Error(r.message || "Price request failed"));
        },
        function () {
          reject(new Error("Connection interrupted. Your job can be resumed."));
        },
      );
    });
  }
  function error(e) {
    $("#ps-sheet-status").text(e.message);
    $("#ps-file-status").text(e.message);
    PosnicPro.alert("warning", e.message);
  }
  function id() {
    var bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }
  function number(n) {
    return Number(n || 0).toFixed(2);
  }
  function count() {
    var total = Object.keys(draft).length;
    $("#ps-grid-count").text(
      total + (total === 1 ? " item changed" : " items changed"),
    );
    $("#ps-grid-review").prop("disabled", busy || !Object.keys(draft).length);
  }
  function columns() {
    var box = $("#ps-columns").empty();
    Object.keys(visible).forEach(function (f) {
      var input = $('<input type="checkbox">')
        .prop("checked", visible[f])
        .on("change", function () {
          visible[f] = this.checked;
          paint();
        });
      $('<label class="d-block py-2">')
        .append(
          input,
          document.createTextNode(
            " " + (fields[f] || (f === "unit" ? "Unit" : "SKU")),
          ),
        )
        .appendTo(box);
    });
  }
  function paint() {
    var head = $("<tr>").append($("<th>").text("Item"));
    if (priceBranches.length > 1) head.append($("<th>").text("Branch"));
    Object.keys(visible)
      .filter(function (f) {
        return visible[f];
      })
      .forEach(function (f) {
        head.append(
          $("<th>").text(fields[f] || (f === "unit" ? "Unit" : "SKU")),
        );
      });
    $("#ps-grid-head").empty().append(head);
    var body = $("#ps-grid-body").empty();
    Object.values(p._gridRows).forEach(function (it) {
      var tr = $("<tr>").append($("<td>").text(it.name));
      if (priceBranches.length > 1)
        tr.append($("<td>").text(branchName(it.branch_id)));
      Object.keys(visible)
        .filter(function (f) {
          return visible[f];
        })
        .forEach(function (f) {
          var td = $("<td>").appendTo(tr);
          if (!fields[f]) {
            td.text(it[f] || "—");
            return;
          }
          var change = draft[it._id] && draft[it._id].changes[f];
          var input = $(
            '<input type="number" min="0" step="0.01" inputmode="decimal" class="form-control">',
          )
            .css({ minHeight: "44px", minWidth: "110px", maxWidth: "170px" })
            .attr("aria-label", fields[f] + " for " + it.name)
            .attr("data-price-field", f)
            .val(change ? change.value : number(it[f]));
          var old = $('<small class="d-block">').text(
            change ? "Was " + number(change.old) : "",
          );
          input
            .on("focus", function () {
              this.select();
            })
            .on("input", function () {
              var original =
                draft[it._id] && draft[it._id].changes[f]
                  ? draft[it._id].changes[f].old
                  : Number(it[f] || 0);
              if (this.value === "" || Number(this.value) === original) {
                if (draft[it._id]) delete draft[it._id].changes[f];
              } else {
                if (!draft[it._id])
                  draft[it._id] = {
                    id: it._id,
                    name: it.name,
                    branchId: it.branch_id,
                    changes: {},
                  };
                draft[it._id].changes[f] = { old: original, value: this.value };
              }
              if (draft[it._id] && !Object.keys(draft[it._id].changes).length)
                delete draft[it._id];
              var changed = draft[it._id] && draft[it._id].changes[f];
              td.toggleClass("table-info", !!changed);
              old.text(changed ? "Was " + number(original) : "");
              count();
              persist();
            })
            .on("keydown", function (e) {
              if (e.key === "Enter") {
                e.preventDefault();
                tr.next()
                  .find('[data-price-field="' + f + '"]')
                  .focus();
              }
            });
          td.toggleClass("table-info", !!change).append(input, old);
        });
      body.append(tr);
    });
    var empty = !Object.keys(p._gridRows).length;
    $("#ps-grid-empty").prop("hidden", !empty);
    $("#ps-direct-panel .ps-grid-scroll, #ps-direct-panel .ps-pager").prop(
      "hidden",
      empty,
    );
    count();
  }
  p.showDataTablePage = function () {
    if (scope !== key()) p._catsLoaded = false;
    originalShow.call(p);
    visible = {
      itemid: true,
      unit: true,
      selling_price: true,
      company_price: false,
      mrp_price: false,
    };
    columns();
    loadBranches()
      .then(function () {
        p.gridLoad(1);
        p.editMode(editingMode);
      })
      .catch(error);
  };
  p.gridLoad = async function (page) {
    if (busy) return;
    if (priceBranches.length && !selectedBranches.length) {
      p._gridRows = {};
      paint();
      return error(new Error("Select at least one branch"));
    }
    var request = ++sequence,
      nextScope = key();
    if (scope !== nextScope) {
      scope = nextScope;
      draft = {};
      p._gridRows = {};
      ready = storage(false)
        .then(function (data) {
          if (scope === nextScope) draft = data || {};
        })
        .catch(function () {
          $("#ps-draft-status").text(
            "Draft recovery unavailable in this browser.",
          );
        });
    }
    await ready;
    if (request !== sequence || key() !== scope) return;
    columns();
    var size = Number($("#ps-grid-size").val()) || 50;
    PosnicPro.get(
      {
        url: "items/priceGrid",
        data: $.param({
          page: Math.max(1, page),
          pageSize: size,
          search: $("#ps-grid-search").val(),
          category: categories("ps-grid-category").join(","),
          branches: selectedBranches.join(","),
        }),
      },
      function (r) {
        if (request !== sequence || key() !== scope) return;
        if (r.type !== "success") {
          error(new Error(r.message));
          return;
        }
        p._gridPage = r.data.page;
        p._gridRows = {};
        var reconciled = false;
        r.data.items.forEach(function (it) {
          p._gridRows[it._id] = it;
          var d = draft[it._id];
          if (!d) return;
          Object.keys(d.changes).forEach(function (f) {
            if (Number(it[f] || 0) === Number(d.changes[f].value)) {
              delete d.changes[f];
              reconciled = true;
            }
          });
          if (!Object.keys(d.changes).length) delete draft[it._id];
        });
        if (reconciled) persist();
        paint();
        $("#ps-grid-page").text(
          "Page " +
            r.data.page +
            " of " +
            Math.max(1, Math.ceil(r.data.total / size)) +
            " · " +
            r.data.total +
            " items",
        );
        $("#ps-grid-prev").prop("disabled", page <= 1);
        $("#ps-grid-next").prop("disabled", page * size >= r.data.total);
      },
    );
  };
  p.gridDiscard = function () {
    if (window.confirm("Discard all unsaved price changes?")) {
      draft = {};
      persist();
      paint();
    }
  };
  p.gridReview = async function () {
    if (busy || key() !== scope) return;
    var rows = Object.values(draft).filter(function (row) {
        return !row.branchId || selectedBranches.includes(String(row.branchId));
      }),
      zero = false;
    for (var row of rows)
      for (var change of Object.values(row.changes)) {
        if (
          !/^\d+(?:\.\d{1,2})?$/.test(String(change.value)) ||
          Number(change.value) > 1000000000
        )
          return error(
            new Error(
              "Correct invalid prices: use non-negative numbers with at most two decimals.",
            ),
          );
        if (Number(change.value) === 0) zero = true;
      }
    if (
      zero &&
      !window.confirm(
        "This update includes zero prices. Include these zero values in the review?",
      )
    )
      return;
    busy = true;
    filter = "changes";
    count();
    try {
      var jobId = id();
      await api({
        action: "create",
        jobId: jobId,
        name: "Price grid",
        allowZero: zero,
        branches: selectedBranches,
      });
      for (var start = 0; start < rows.length; start += 500) {
        $("#ps-draft-status").text(
          "Preparing review: " +
            Math.min(start + 500, rows.length) +
            " of " +
            rows.length +
            " items…",
        );
        await api({
          action: "append",
          jobId: jobId,
          start: start,
          rows: rows.slice(start, start + 500),
        });
      }
      showJob(
        await api({ action: "finish", jobId: jobId, total: rows.length }),
      );
      $("#ps-draft-status").text("Review ready. Prices are not applied yet.");
    } catch (e) {
      error(e);
    } finally {
      busy = false;
      count();
    }
  };
  p.sheetClose = function () {
    document.getElementById("ps-sheet").close();
    if (reviewScreen) {
      reviewScreen = false;
      $("#ps-sheet").removeClass("ps-review-screen");
      $("#ps-grid > .ps-edit-tabs").prop("hidden", false);
      $("#ps-branches").prop("hidden", priceBranches.length <= 1);
      p.editMode(editingMode);
    }
  };
  p.sheetOpen = function (which) {
    if (!$("#ps-file-status").length)
      $('<div id="ps-file-status" role="status" class="mt-3">').appendTo(
        "#ps-file-panel",
      );
    $("#ps-sheet-prepare").text("Download price sheet");
    $("#ps-sheet-import button").text("Validate & review changes");
    $("#ps-sheet-download").appendTo("#ps-file-download").prop("hidden", false);
    $("#ps-sheet-import").appendTo("#ps-file-upload").prop("hidden", false);
    $("#ps-job-view").prop("hidden", true);
    $("#ps-sheet-status").text("");
    $("#ps-sheet-title").text(
      which === "download" ? "Download price sheet" : "Import price updates",
    );
    filter = "changes";
    var box = $("#ps-sheet-fields");
    if (!box.children().length)
      Object.keys(fields).forEach(function (f) {
        $('<label class="mr-3">')
          .append(
            $('<input type="checkbox">').val(f).prop("checked", !!visible[f]),
            document.createTextNode(" " + fields[f]),
          )
          .appendTo(box);
      });
    if (which === "download") p.sheetCount();
    if (which === "import") $("#ps-sheet-file").focus();
  };
  var countTimer,
    countSequence = 0;
  p.sheetCount = function () {
    clearTimeout(countTimer);
    $("#ps-sheet-prepare").prop("disabled", true);
    var n = ++countSequence;
    $("#ps-sheet-count").attr("aria-busy", "true").removeClass("ps-count-empty")
      .text("Updating matching items…");
    if (priceBranches.length && !selectedBranches.length) {
      $("#ps-sheet-count").attr("aria-busy", "false").text("Select a branch to see matching items.");
      return;
    }
    $("#ps-sheet-clear").prop("hidden", true);
    countTimer = setTimeout(function () {
      PosnicPro.get(
        {
          url: "items/priceGrid",
          data: $.param({
            search: $("#ps-sheet-search").val(),
            category: categories("ps-sheet-category").join(","),
            branches: selectedBranches.join(","),
            pageSize: 10,
          }),
        },
        function (r) {
          if (n === countSequence) {
            var empty = r.type === "success" && r.data.total === 0;
            $("#ps-sheet-prepare").prop(
              "disabled",
              r.type !== "success" || empty,
            );
            $("#ps-sheet-clear").prop("hidden", !empty);
            $("#ps-sheet-count").attr("aria-busy", "false").toggleClass("ps-count-empty", empty).text(
              r.type === "success"
                ? empty
                  ? t(
                      "lang_no_products_match_filters",
                      "No products match these filters.",
                    )
                  : r.data.total + (r.data.total === 1 ? " matching item across all pages" : " matching items across all pages")
                : "Could not count items",
            );
          }
        },
        function () {
          if (n !== countSequence) return;
          $("#ps-sheet-count").attr("aria-busy", "false").text("Could not count items. Try changing the filters again.");
        },
      );
    }, 250);
  };
  function download(data) {
    $("#ps-file-status").text(
      "Downloaded " +
        data.filename +
        ". Edit the New columns, then upload the file for review.",
    );
    var bytes = Uint8Array.from(atob(data.base64), function (c) {
      return c.charCodeAt(0);
    });
    var url = URL.createObjectURL(new Blob([bytes]));
    var a = document.createElement("a");
    a.href = url;
    a.download = data.filename;
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }
  p.sheetDownload = async function (button) {
    var selected = $("#ps-sheet-fields input:checked")
      .map(function () {
        return this.value;
      })
      .get();
    if (!selected.length)
      return error(new Error("Select at least one price field"));
    $(button).prop("disabled", true);
    $("#ps-sheet-status").text("Preparing all matching items…");
    try {
      download(
        await api({
          action: "download",
          fields: selected.join(","),
          search: $("#ps-sheet-search").val(),
          category: categories("ps-sheet-category").join(","),
          format: $("#ps-sheet-format").val(),
          branches: selectedBranches,
        }),
      );
      $("#ps-sheet-status").text(
        "Sheet prepared. Fill in the New columns and import it for review.",
      );
    } catch (e) {
      error(e);
    } finally {
      $(button).prop("disabled", false);
    }
  };
  p.sheetImport = function (button) {
    var file = $("#ps-sheet-file")[0].files[0];
    if (!file || file.size > 10 * 1024 * 1024)
      return error(new Error("Choose a CSV or XLSX file up to 10 MB"));
    var form = new FormData();
    form.append("file", file);
    form.append("jobId", id());
    form.append("name", file.name);
    form.append("allowZero", $("#ps-sheet-zero").is(":checked"));
    form.append("branches", selectedBranches.join(","));
    filter = "changes";
    $(button).prop("disabled", true);
    $("#ps-sheet-status").text(
      "Uploading and checking sheet. No prices are being changed.",
    );
    $("#ps-file-status").text(
      "Uploading and validating. Prices have not been applied.",
    );
    PosnicPro.request(
      {
        url: "items/priceSheetImport",
        method: "POST",
        data: form,
        contentType: false,
        processData: false,
      },
      function (r) {
        $(button).prop("disabled", false);
        if (r.type === "success") showJob(r.data);
        else error(new Error(r.message));
      },
      function () {
        $(button).prop("disabled", false);
        error(
          new Error(
            "Upload interrupted. Check recent jobs before uploading again.",
          ),
        );
      },
    );
  };
  async function showJob(data) {
    if (
      currentJob !== data.job._id ||
      currentRevision !== (data.job.revision || 0)
    )
      holdSelections = {};
    currentJob = data.job._id;
    currentRevision = data.job.revision || 0;
    jobPage = data.page;
    reviewScreen = true;
    var dialog = document.getElementById("ps-sheet");
    if (dialog.open) dialog.close();
    $(dialog).addClass("ps-review-screen").attr("open", "");
    $(
      "#ps-direct-panel, #ps-file-panel, #ps-schedules-panel, #ps-branches, #ps-grid > .ps-edit-tabs",
    ).prop("hidden", true);
    $("#ps-sheet-download, #ps-sheet-import").prop("hidden", true);
    $("#ps-sheet-title").text("Review price changes · " + data.job.status);
    $("#ps-sheet .ps-dialog-header button").text(
      editingMode === "schedules" ? "Back to schedules" : "Back to editing",
    );
    var box = $("#ps-job-view").prop("hidden", false).empty(),
      c = data.counts;
    if (data.job.exportedAt && data.job.exportedAt.length)
      $("<p>")
        .text("Sheet exported: " + data.job.exportedAt.join(", "))
        .appendTo(box);
    if (priceBranches.length > 1)
      $("<p>")
        .text(
          "Branches: " + (data.job.branchIds || []).map(branchName).join(", "),
        )
        .appendTo(box);
    if (data.job.lastError) $("<p>").text(data.job.lastError).appendTo(box);
    if (data.job.status === "scheduled") {
      $("<p class='ps-update-success'>")
        .text(
          "Price update scheduled. Tills receive applied prices through sync.",
        )
        .appendTo(box);
      Object.keys(data.job.dueByBranch || {}).forEach(function (id) {
        var branch = priceBranches.find(function (b) {
          return b.id === id;
        });
        var zone = branch ? branch.timezone : "Asia/Calcutta";
        $("<p>")
          .text(
            (priceBranches.length > 1 ? branchName(id) + ": " : "") +
              new Date(data.job.dueByBranch[id]).toLocaleString(undefined, {
                timeZone: zone,
              }) +
              " (" +
              zone +
              ")",
          )
          .appendTo(box);
      });
    }
    if (data.job.status === "complete") {
      var issues = (c.invalid || 0) + (c.conflict || 0);
      var message = issues
        ? '<lang class="lang_price_update_completed_with_issues">Price update finished. Some items need attention.</lang>'
        : c.updated
          ? '<lang class="lang_prices_updated_successfully">Prices updated successfully.</lang>'
          : '<lang class="lang_no_prices_were_changed">No prices were changed.</lang>';
      $('<div id="ps-update-result" role="status" aria-live="polite">')
        .addClass(
          issues
            ? "ps-update-warning"
            : c.updated
              ? "ps-update-success"
              : "ps-update-neutral",
        )
        .append($("<strong>").html(message))
        .appendTo(box);
      if (PosnicPro.i18n && PosnicPro.i18n.apply) PosnicPro.i18n.apply(box[0]);
    }
    $("<p>")
      .text(
        (c.pending || 0) +
          " ready · " +
          (c.updated || 0) +
          " updated · " +
          (c.invalid || 0) +
          " invalid · " +
          (c.conflict || 0) +
          " conflicts · " +
          (c.unchanged || 0) +
          " unchanged",
      )
      .appendTo(box);
    var select = $(
      '<select class="form-control mb-2" aria-label="Review status" data-t-aria-label="lang_review_status">',
    ).css("max-width", "250px");
    [
      "changes",
      "",
      "invalid",
      "pending",
      "updated",
      "conflict",
      "held",
      "skipped",
      "unchanged",
    ].forEach(function (s) {
      select.append(
        $("<option>")
          .val(s)
          .text(s === "changes" ? "Price changes & issues" : s || "All rows"),
      );
    });
    select.val(filter).on("change", function () {
      filter = this.value;
      p.sheetJob(currentJob, 1);
    });
    box.append(select);
    var table = $('<table class="table">').append(
        '<thead><tr><th><lang class="lang_row_item">Row / item</lang></th><th><lang class="lang_changes">Changes</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr></thead>',
      ),
      body = $("<tbody>").appendTo(table);
    data.rows.forEach(function (r) {
      if (filter === "changes" && r.status === "unchanged") return;
      var tr = $("<tr>").append(
        $("<td>").text(
          r.number +
            " · " +
            r.name +
            (priceBranches.length > 1 ? " · " + branchName(r.branch_id) : ""),
        ),
      );
      var td = $("<td>");
      Object.keys(r.changes).forEach(function (f) {
        $("<div>")
          .text(
            fields[f] +
              ": " +
              number(r.changes[f].old) +
              " → " +
              number(r.changes[f].value),
          )
          .appendTo(td);
      });
      tr.append(td, $("<td>").text(r.reason || r.status));
      if (r.status === "held")
        $('<label class="d-block">')
          .append(
            $('<input class="ps-hold-override" type="checkbox">')
              .val(r.itemId)
              .prop("checked", !!holdSelections[r.itemId])
              .on("change", function () {
                holdSelections[r.itemId] = this.checked;
              }),
            document.createTextNode(" Replace held selling price"),
          )
          .appendTo(tr.children().last());
      body.append(tr);
    });
    if (!body.children().length)
      body.append(
        $("<tr>").append(
          $('<td colspan="3">').text("No price changes in this view."),
        ),
      );
    box.append($('<div class="table-responsive">').append(table));
    var pager = $(
      '<div class="d-flex flex-wrap align-items-center" style="gap:10px">',
    );
    pager.append(
      $(
        '<button class="btn btn-light"><lang class="lang_previous">Previous</lang></button>',
      )
        .prop("disabled", data.page <= 1)
        .on("click", function () {
          p.sheetJob(currentJob, jobPage - 1);
        }),
      $("<span>").text("Page " + data.page + " · " + data.total + " rows"),
      $(
        '<button class="btn btn-light"><lang class="lang_next">Next</lang></button>',
      )
        .prop("disabled", data.page * 50 >= data.total)
        .on("click", function () {
          p.sheetJob(currentJob, jobPage + 1);
        }),
    );
    box.append(pager);
    if (data.job.status === "draft")
      $("<p>")
        .text(
          "Upload incomplete. No prices applied. Re-upload the complete sheet to a new job.",
        )
        .appendTo(box);
    if (
      ["review", "running", "scheduled", "attention"].includes(
        data.job.status,
      ) &&
      (c.pending || c.held)
    ) {
      if (data.job.status !== "running") {
        var when = $('<select id="ps-when" class="form-control">')
          .append(
            '<option value="now" data-t="lang_now">Now</option><option value="tomorrow">Tomorrow · midnight in each branch timezone</option><option value="custom" data-t="lang_schedule_date_time">Schedule date & time</option>',
          )
          .val(data.job.when || "now");
        $('<label class="d-block mt-3">')
          .text("When should prices apply?")
          .append(when)
          .appendTo(box);
        $(
          '<input id="ps-local-time" type="datetime-local" class="form-control" aria-label="Effective date and time" data-t-aria-label="lang_effective_date_and_time">',
        )
          .val(data.job.localTime || "")
          .prop("hidden", when.val() !== "custom")
          .appendTo(box);
        when.on("change", function () {
          $("#ps-local-time").prop("hidden", this.value !== "custom");
          $("#ps-confirm-prices").text(
            this.value === "now" ? "Apply prices now" : "Save price schedule",
          );
        });
        $('<label class="d-block mt-3">')
          .text("Note / description (optional)")
          .append(
            $(
              '<textarea id="ps-note" class="form-control" maxlength="500" placeholder="For example: Diwali offer" data-t-placeholder="lang_for_example_diwali_offer">',
            ).val(data.job.note || ""),
          )
          .appendTo(box);
        $('<label class="d-block mt-3">')
          .text(
            "Keep selling prices until (optional; later changes show a warning)",
          )
          .append(
            $(
              '<input id="ps-hold-until" type="date" class="form-control">',
            ).val(data.job.holdDate || ""),
          )
          .appendTo(box);
      }
      if (c.invalid)
        $('<label class="d-block mt-3">')
          .append(
            '<input id="ps-job-skip" type="checkbox">',
            document.createTextNode(
              " Skip invalid rows and apply valid changes",
            ),
          )
          .appendTo(box);
      $('<button id="ps-confirm-prices" class="btn btn-primary mt-3">')
        .text(
          data.job.status === "running"
            ? "Resume update"
            : $("#ps-when").val() === "now"
              ? "Apply prices now"
              : "Save price schedule",
        )
        .on("click", function () {
          p.sheetProcess(this, !!c.invalid, data.job.status);
        })
        .appendTo(box);
    }
    if (["scheduled", "review", "attention"].includes(data.job.status))
      $('<button class="btn btn-light ml-2 mt-3">')
        .text("Cancel update")
        .on("click", async function () {
          if (!window.confirm("Cancel this price update?")) return;
          try {
            showJob(
              await api({
                action: "cancel",
                jobId: currentJob,
                revision: currentRevision,
              }),
            );
          } catch (e) {
            error(e);
          }
        })
        .appendTo(box);
    $(
      '<button class="btn btn-light ml-2 mt-3"><lang class="lang_download_result_report">Download result report</lang></button>',
    )
      .on("click", function () {
        p.sheetReport(this);
      })
      .appendTo(box);
    if (c.invalid || c.conflict) {
      $(
        '<button class="btn btn-light ml-2 mt-3"><lang class="lang_download_current_prices_for_unresolved_ite">Download current prices for unresolved items</lang></button>',
      )
        .on("click", async function () {
          $(this).prop("disabled", true);
          try {
            download(
              await api({
                action: "download",
                retryJobId: currentJob,
                fields: Object.keys(fields).join(","),
                format: "xlsx",
              }),
            );
          } catch (e) {
            error(e);
          } finally {
            $(this).prop("disabled", false);
          }
        })
        .appendTo(box);
    }
    $("#ps-sheet-status").text(
      "Changes apply only to the reviewed branches. Conflicting prices are kept unchanged.",
    );
  }
  p.sheetJob = async function (job, page) {
    try {
      showJob(
        await api({
          action: "status",
          jobId: job,
          revision: currentRevision,
          page: page || 1,
          filter: filter,
        }),
      );
    } catch (e) {
      error(e);
    }
  };
  p.sheetProcess = async function (button, hasInvalid, jobStatus) {
    if (busy || (hasInvalid && !$("#ps-job-skip").is(":checked")))
      return error(
        new Error(
          "Explicitly select Skip invalid rows or correct the sheet first.",
        ),
      );
    busy = true;
    var job = currentJob,
      captured = scope;
    $(button).prop("disabled", true);
    count();
    try {
      var data;
      if (jobStatus !== "running") {
        var when = $("#ps-when").val() || "now";
        data = await api({
          action: "configure",
          jobId: job,
          when: when,
          localTime: $("#ps-local-time").val(),
          note: $("#ps-note").val(),
          holdUntil: $("#ps-hold-until").val() || null,
          holdOverrides: Object.keys(holdSelections).filter(function (id) {
            return holdSelections[id];
          }),
          skipInvalid: !hasInvalid || $("#ps-job-skip").is(":checked"),
        });
        if (when !== "now") {
          showJob(data);
          return;
        }
      }
      do {
        if (key() !== captured)
          throw new Error(
            "Branch or user changed. Resume from the original branch.",
          );
        data = await api({ action: "process", jobId: job, skipInvalid: true });
        (data.processed || []).forEach(function (r) {
          var d = draft[r.id];
          if (!d) return;
          Object.keys(r.changes).forEach(function (f) {
            if (
              d.changes[f] &&
              Number(d.changes[f].old) === r.changes[f].old &&
              Number(d.changes[f].value) === r.changes[f].value
            )
              delete d.changes[f];
          });
          if (!Object.keys(d.changes).length) delete draft[r.id];
        });
        persist();
        count();
        $("#ps-sheet-status").text(
          (data.counts.updated || 0) +
            " updated; " +
            (data.counts.pending || 0) +
            " remaining. Keep this page open, or resume later.",
        );
      } while (data.job.status === "running");
      await p.sheetJob(job, 1);
    } catch (e) {
      error(e);
    } finally {
      busy = false;
      $(button).prop("disabled", false);
      count();
      p.gridLoad(p._gridPage || 1);
    }
  };
  p.sheetReport = async function (button) {
    $(button).prop("disabled", true);
    try {
      var data = await api({
        action: "download",
        jobId: currentJob,
        format: "csv",
      });
      download(data);
    } catch (e) {
      error(e);
    } finally {
      $(button).prop("disabled", false);
    }
  };
  var historyPage = 1,
    historyStatus = "upcoming",
    historySequence = 0;
  p.scheduleFilter = function (status) {
    historyStatus = status;
    $("[data-job-status]").each(function () {
      $(this).attr("aria-pressed", String(this.dataset.jobStatus === status));
    });
    p.sheetHistory(1);
  };
  p.sheetHistory = async function (page) {
    var request = ++historySequence,
      box = $("#ps-sheet-history").empty();
    box.text("Loading updates…");
    try {
      var result = await api({
        action: "list",
        page: page || 1,
        status: historyStatus,
        pageSize: Number($("#ps-jobs-size").val()) || 10,
      });
      if (request !== historySequence) return;
      if (!result.jobs.length && result.page > 1)
        return p.sheetHistory(result.page - 1);
      historyPage = result.page;
      box.empty();
      var wrap = $('<div class="table-responsive">').appendTo(box),
        table = $('<table class="ps-jobs-table">').appendTo(wrap),
        head = $("<tr>").appendTo($("<thead>").appendTo(table)),
        body = $("<tbody>").appendTo(table);
      ["Note / description", "Timing"]
        .concat(priceBranches.length > 1 ? ["Branches"] : [])
        .concat(["Status", "Actions"])
        .forEach(function (label) {
          $('<th scope="col">').text(label).appendTo(head);
        });
      result.jobs.forEach(function (j) {
        var row = $("<tr>").appendTo(body);
        $("<td>")
          .text(j.note || "Price update")
          .appendTo(row);
        $("<td>")
          .text(
            j.effectiveAt
              ? new Date(j.effectiveAt).toLocaleString()
              : "Created " + new Date(j.created_date).toLocaleString(),
          )
          .appendTo(row);
        if (priceBranches.length > 1)
          $("<td>")
            .text((j.branchIds || [j.branch_id]).map(branchName).join(", "))
            .appendTo(row);
        var labels = {
          scheduled: "Scheduled",
          running: "Applying",
          attention: "Needs attention",
          review: "Needs review",
          draft: "Unfinished upload",
          complete: "Completed",
          cancelled: "Cancelled",
        };
        $('<span class="ps-job-status">')
          .text(labels[j.status] || j.status)
          .appendTo($("<td>").appendTo(row));
        var actions = $('<div class="ps-job-actions">').appendTo(
          $("<td>").appendTo(row),
        );
        async function open(edit) {
          filter = "changes";
          await p.sheetJob(j._id);
          if (edit) $("#ps-when").focus();
        }
        $('<button type="button" class="btn btn-light btn-sm">')
          .text("View")
          .on("click", function () {
            open(false);
          })
          .appendTo(actions);
        if (["scheduled", "review", "attention"].includes(j.status)) {
          $('<button type="button" class="btn btn-light btn-sm">')
            .text("Edit")
            .on("click", open)
            .appendTo(actions);
          $('<button type="button" class="btn btn-light btn-sm">')
            .text("Cancel")
            .on("click", async function () {
              if (
                !window.confirm(
                  "Cancel this price update? It will no longer be applied.",
                )
              )
                return;
              $(this).prop("disabled", true);
              try {
                await api({
                  action: "cancel",
                  jobId: j._id,
                  revision: j.revision || 0,
                });
                await p.sheetHistory(historyPage);
              } catch (e) {
                $(this).prop("disabled", false);
                box.find(".ps-list-error").remove();
                $('<p class="ps-list-error" role="alert">')
                  .text(e.message)
                  .prependTo(box);
                error(e);
              }
            })
            .appendTo(actions);
        }
      });
      if (!result.jobs.length) {
        wrap.remove();
        $('<p class="ps-empty">')
          .text(
            "No " +
              (historyStatus === "complete" ? "completed" : historyStatus) +
              " updates.",
          )
          .appendTo(box);
      }
      var pager = $('<div class="ps-pager">').appendTo(box);
      $('<button class="btn btn-light">')
        .text("Previous")
        .prop("disabled", result.page <= 1)
        .on("click", function () {
          p.sheetHistory(result.page - 1);
        })
        .appendTo(pager);
      $("<span>")
        .text(
          "Page " +
            result.page +
            " of " +
            Math.max(1, Math.ceil(result.total / result.pageSize)) +
            " · " +
            result.total +
            " updates",
        )
        .appendTo(pager);
      $('<button class="btn btn-light">')
        .text("Next")
        .prop("disabled", result.page * result.pageSize >= result.total)
        .on("click", function () {
          p.sheetHistory(result.page + 1);
        })
        .appendTo(pager);
    } catch (e) {
      if (request === historySequence)
        box.text("Could not load updates. Select the status again to retry.");
      error(e);
    }
  };
  window.addEventListener("beforeunload", function (e) {
    if (busy) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
})();
