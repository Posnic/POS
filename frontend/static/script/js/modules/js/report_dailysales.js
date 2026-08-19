PosnicPro.quickreport = {
  showDataTablePage: function () {
    var loader = $(".loader-dailysale-report");
    loader.find(".loadingSpinner:first").remove();
    PosnicPro.HideSideBarModal();
    $(".vertical-layout").removeClass("toggle-menu");
    $(".vertical-menu li a").removeClass("active");
    $("#dailysale-view-tab-line,.dropdown-item").removeClass("active");
    $(".page_loader,#osk-container").hide();
    $(".page-title-box,#dailyreport_new").show();
    $("#v-pills-report-tab,#viewdailyreport_page").addClass("active");
    $(".custom-daily-sale-nav-menu").addClass("active");
    $("#v-pills-report").addClass("show active");
    PosnicPro.quickreport.salereportTable("Daily");
    if (PosnicPro.local.get("userplan") === "free") {
      $("#dailysale-view-line").css("filter", "blur(2px)");
      $("#export_daily_report, .blur_val").attr("disabled", true).css({
        "pointer-events": "none",
        cursor: "not-allowed",
        opacity: "0.5",
      });
      $("#dailysale_upgrade").show();
    } else {
      $("#dailysale-view-line").css("filter", "none");
      $("#export_daily_report, .blur_val").removeAttr("disabled").css({
        "pointer-events": "auto",
        cursor: "pointer",
        opacity: "1",
      });
      $("#dailysale_upgrade").hide();
    }
  },
  salereportTable: function (type) {
    // helpers (ES5-safe)
    function esc(s) {
      s = s == null ? "" : String(s);
      return s.replace(/[&<>"']/g, function (m) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m];
      });
    }
    function safeNum(n) {
      n = parseFloat(n);
      return isFinite(n) ? n : 0;
    }
    function trim(s) {
      return (s || "").replace(/^\s+|\s+$/g, "");
    }

    var branchId = String($("#dailysale_branch_value").val() || "");
    if (!branchId) {
      $("#dailysale_branch_value").focus();
      return;
    }

    var loader = $(".loader-dailysale-report");
    $("<div class='loadingSpinner'></div>").appendTo(loader);

    var daterange = String($("#view_dailysale_report_daterange").val() || "");
    var fields =
      daterange.indexOf(" - ") > -1
        ? daterange.split(" - ")
        : daterange.split("-");
    var startDate = trim(fields[0]);
    var endDate = trim(fields[1]);

    if (!startDate || !endDate) {
      loader.find(".loadingSpinner:first").remove();
      PosnicPro.alert("error", "Select a valid date range");
      return;
    }

    var params = {
      url: "sales/dailySalesReports",
      data: {
        branch: branchId,
        starting_date: startDate,
        ending_date: endDate,
        type: type, // 'VIEW' | 'CSV' | 'PDF' etc.
      },
    };

    PosnicPro.get(
      params,
      function (response) {
        loader.find(".loadingSpinner:first").remove();
        if (response.type !== "success") {
          PosnicPro.alert(response.type, response.message);
          return;
        }

        var currency = PosnicPro.local.get("currencySign") || "₹";

        // ---- Branch ----
        var branchData =
          response.data && response.data.branch_details
            ? response.data.branch_details
            : {};
        $("#daily_report_date").html(
          PosnicPro.convertDate(branchData.date || "")
        );
        $("#daily_report_fromdate").html(startDate);
        $("#daily_report_todate").html(endDate);
        $("#daily_report_branchname").html(esc(branchData.branch_name));
        $("#daily_report_branchaddress").html(esc(branchData.branch_address));
        $("#daily_report_branchphone").html(esc(branchData.branch_phone));
        $("#daily_report_branchemail").html(esc(branchData.branch_email));

        var branchHeaderRow = [
          "fromDate",
          "toDate",
          "branchName",
          "branchAddress",
          "branchPhone",
          "branchEmail",
        ];
        var branchDataRow = [
          branchData.from_date,
          branchData.to_date,
          branchData.branch_name,
          branchData.branch_address,
          branchData.branch_phone,
          branchData.branch_email,
        ];

        // ---- Products ----
        var productData =
          response.data && response.data.product_details
            ? response.data.product_details
            : [];

        if (productData.length > 0) {
          $(".hide-show-dailyimgreport").hide();
          $(".hide-show-dailyreport").show();
        } else {
          $(".hide-show-dailyimgreport").show();
          $(".hide-show-dailyreport").hide();
        }

        $("#daily_report_product_details tbody").children("tr").remove();

        var qty = 0,
          price = 0,
          total = 0,
          profit = 0;
        var productHeaderRow = [
          "productName",
          "productSku",
          "productQty",
          "productSubtotal",
          "productDiscount",
          "productTax",
          "productTotal",
        ];
        var productAllDataRow = [];

        for (var i = 0; i < productData.length; i++) {
          var p = productData[i];
          var pQty = safeNum(p.product_qty);
          var pSubtotal = safeNum(p.product_subtotal);
          var pTotal = safeNum(p.product_total);
          var pProfit = safeNum(p.product_profit);
          var pDiscount = safeNum(p.product_discount);
          var pTax = safeNum(p.product_tax);

          qty += pQty;
          price += pSubtotal;
          total += pTotal;
          profit += pProfit;

          if (pSubtotal > 0) {
            var rowHTMLLine =
              " <tr> " +
              '   <td class="font-12 text-center">' +
              (i + 1) +
              "</td>" +
              '   <td class="font-12 text-left">' +
              esc(p.product_name) +
              "</td>" +
              '   <td class="font-12 text-left">' +
              esc(p.product_sku) +
              "</td>" +
              '   <td class="font-12 text-center">' +
              pQty +
              "</td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              pSubtotal +
              "</span> </td>" +
              '   <td class="font-12 text-right">-' +
              currency +
              '&nbsp;<span class="number">' +
              pDiscount +
              "</span> </td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              pTax +
              "</span> </td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              pTotal +
              "</span> </td>" +
              " </tr>";

            $("#daily_report_product_details tbody").append(rowHTMLLine);
            productAllDataRow.push([
              p.product_name,
              p.product_sku,
              pQty,
              pSubtotal,
              pDiscount,
              pTax,
              pTotal,
            ]);
          }
        }


        // Qty is a count, so avoid showing .00 when it's a whole number
        var qtyValue = safeNum(qty);
        var qtyDecimals = qtyValue % 1 === 0 ? 0 : 2;
        $(".daily_report_qty_price").number(qtyValue, qtyDecimals);

        $(".daily_report_product_price").number(safeNum(price), 2);
        $(".daily_report_product_total").number(safeNum(total), 2);
        // $('.daily_report_product_profit').number(safeNum(profit), 2);

        // ---- Payments ----
        var paymentData =
          response.data && response.data.payment_details
            ? response.data.payment_details
            : [];
        $("#daily_report_tender_details tbody").children("tr").remove();
        var tenderTotal = 0;
        var paymentHeaderRow = ["paymentMode", "amount"];
        var paymentAllDataRow = [];

        // Group payment modes case/whitespace-insensitively so that
        // variants like "Upi" and "upi" are combined into one row.
        var groupedPayments = {};
        var paymentKeys = [];
        for (var j = 0; j < paymentData.length; j++) {
          var pm = paymentData[j] || {};
          var rawMode = trim(pm.payment_mode || "");
          var key = rawMode.toLowerCase();
          var amt = safeNum(pm.sale_payment);

          if (!groupedPayments[key]) {
            groupedPayments[key] = {
              label: rawMode || "Unknown",
              amount: 0,
            };
            paymentKeys.push(key);
          }
          groupedPayments[key].amount += amt;
        }

        // Additional Discount - show detailed breakdown by type (calculate before tender)
        let extraDiscountData = response.data && response.data.extra_discount ? response.data.extra_discount : {};
        let total_sale_extra_discount = safeNum(extraDiscountData.total_sale_extra_discount) || 0;
        let extraDiscountByType = extraDiscountData.by_type || [];

        // Hide table if no payment details
        if (!paymentData || paymentData.length === 0 || paymentKeys.length === 0) {
          $("#tender_type_heading").hide();
          $("#daily_report_tender_details").closest(".col-sm-12").hide();
        } else {
          $("#tender_type_heading").show();
          $("#daily_report_tender_details").closest(".col-sm-12").show();
        }

        for (var g = 0; g < paymentKeys.length; g++) {
          var k = paymentKeys[g];
          var entry = groupedPayments[k];
          var label = entry.label;
          var totalAmt = entry.amount;
          tenderTotal += totalAmt;

          var rowHTMLLine2 =
            " <tr> " +
            '   <td class="font-12 text-center">' +
            (g + 1) +
            "</td>" +
            '   <td class="font-12 text-left">' +
            esc(label) +
            "</td>" +
            '   <td class="font-12 text-right">' +
            currency +
            '&nbsp;<span class="number">' +
            totalAmt +
            "</span> </td>" +
            " </tr>";

          $("#daily_report_tender_details tbody").append(rowHTMLLine2);
          paymentAllDataRow.push([label, totalAmt]);
        }
        
        // Re-check after loop to hide if total is still 0
        if (tenderTotal <= 0) {
          $("#tender_type_heading").hide();
          $("#daily_report_tender_details").closest(".col-sm-12").hide();
        }
        
        // Display tender total as-is (backend already accounts for discounts)
        $(".daily_report_product_tender_total").number(safeNum(tenderTotal), 2);

        /*
         * Keep the figures the screen just showed, for the printed slip.
         *
         * The slip has to agree with the page to the paisa, and the page does
         * real work to get here: payment modes are grouped so that "Upi" and
         * "upi" become one row, and the totals are summed from the line
         * detail. Recomputing any of that separately is how a printed report
         * and the screen it came from end up disagreeing with each other.
         */
        PosnicPro.quickreport.lastReport = {
          branch: branchData,
          from: startDate,
          to: endDate,
          qty: safeNum(qty),
          subtotal: safeNum(price),
          total: safeNum(total),
          payments: paymentAllDataRow.map(function (row) {
            return { label: row[0], amount: safeNum(row[1]) };
          }),
          tenderTotal: safeNum(tenderTotal),
          products: productAllDataRow.map(function (row) {
            return { name: row[0], qty: safeNum(row[2]), total: safeNum(row[6]) };
          }),
        };

        // The PDF's Summary section - the on-screen stat cards are divs the
        // exporter cannot gather, so the numbers ride this hidden table.
        (function () {
          var money = function (n) { return Number(n || 0).toFixed(2); };
          var rows = '<tr><td>Total sales</td><td class="text-right">' + money(PosnicPro.quickreport.lastReport.total) + '</td></tr>'
            + '<tr><td>Items sold</td><td class="text-right">' + PosnicPro.quickreport.lastReport.qty + '</td></tr>'
            + '<tr><td>Payments received</td><td class="text-right">' + money(PosnicPro.quickreport.lastReport.tenderTotal) + '</td></tr>';
          PosnicPro.quickreport.lastReport.payments.forEach(function (p) {
            rows += '<tr><td>' + $('<i>').text(p.label).html() + '</td><td class="text-right">' + money(p.amount) + '</td></tr>';
          });
          $('#dayend_export_summary_body').html(rows);
        })();
        
        // Clear existing rows
        $("#daily_report_extra_discount_details tbody").children("tr").remove();
        
        // Hide table if no extra discount
        if (total_sale_extra_discount <= 0) {
          $("#extra_discount_heading").hide();
          $("#daily_report_extra_discount_details").closest(".col-sm-12").hide();
        } else {
          $("#extra_discount_heading").show();
          $("#daily_report_extra_discount_details").closest(".col-sm-12").show();
          
          // Add rows for each discount type
          if (extraDiscountByType.length > 0) {
            let currency = PosnicPro.local.get('currencySign') || '₹';
            
            extraDiscountByType.forEach(function(item) {
              let discountType = item.type || 'amount';
              let discountAmount = safeNum(item.sale_extra_discount_total) || 0;
              let discountValue = safeNum(item.extra_discount_total) || 0;
              
              if (discountAmount > 0) {
                let typeLabel = '';
                if (discountType === 'percent' || discountType === 'percentage') {
                  typeLabel = 'Percentage Discount (' + discountValue + '%)';
                } else if (discountType === 'amount' || discountType === 'price') {
                  typeLabel = 'Amount Discount';
                } else {
                  typeLabel = 'Additional Discount';
                }
                
                let rowHTML = '<tr>' +
                  '<td class="text-left">' + typeLabel + '</td>' +
                  '<td class="text-right">' + currency + ' <span class="number">' + discountAmount.toFixed(2) + '</span></td>' +
                  '</tr>';
                
                $("#daily_report_extra_discount_details tbody").append(rowHTML);
              }
            });
          }
        }
        
        $(".daily_report_extra_discount_total").number(total_sale_extra_discount, 2);

        // ---- Table-wise totals ----
        var tableSummary =
          response.data && response.data.table_summary
            ? response.data.table_summary
            : [];

        if (PosnicPro.local.get("table_options") !== "enable") {
          $("#daily_report_table_summary tbody").children("tr").remove();
          $(".daily_report_table_total").text("0.00");
          $(".daily_report_table_pax").text("");
          $("#daily_report_table_summary").closest(".col-sm").hide();
          $(".table-dine-summary-section").hide();
        } else {
          $(".table-dine-summary-section").show();
          $("#daily_report_table_summary").closest(".col-sm").show();
          $("#daily_report_table_summary tbody").children("tr").remove();

          var tableTotal = 0;
          var tablePaxTotal = 0;
          for (var s = 0; s < tableSummary.length; s++) {
            var row = tableSummary[s];
            var name = row.name || "" + (row.table_number || "");
            var amt = safeNum(row.total_amount);
            var pax = safeNum(row.table_pax);

            tableTotal += amt;
            if (pax > 0) {
              tablePaxTotal += pax;
            } else {
              pax = "";
            }

            var rowHTMLTable =
              " <tr> " +
              '   <td class="font-12 text-center">' +
              (s + 1) +
              "</td>" +
              '   <td class="font-12 text-left">' +
              esc(name) +
              "</td>" +
              '   <td class="font-12 text-center">' +
              pax +
              "</td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              amt +
              "</span> </td>" +
              " </tr>";

            $("#daily_report_table_summary tbody").append(rowHTMLTable);
          }

          $(".daily_report_table_total").number(safeNum(tableTotal), 2);
          $(".daily_report_table_pax").text(
            tablePaxTotal > 0 ? tablePaxTotal : ""
          );

          // Show/hide Pax column itself based on whether we have any positive pax
          var $tablePaxCells = $(
            "#daily_report_table_summary thead td:nth-child(3)," +
              "#daily_report_table_summary tbody td:nth-child(3)," +
              "#daily_report_table_summary tfoot td:nth-child(3)"
          );
          if (tablePaxTotal > 0) {
            $tablePaxCells.show();
          } else {
            $tablePaxCells.hide();
          }
        }
        // ---- Taxes (aggregated from API) ----
        var taxDetails =
          response.data && response.data.tax_details
            ? response.data.tax_details
            : [];
        $("#daily_report_tax_details tbody").children("tr").remove();

        var taxTotal = 0;
        var taxHeaderRow = ["taxName", "amount"];
        var taxAllDataRow = [];

        // Hide table if no tax details
        if (!taxDetails || taxDetails.length === 0) {
          $("#tax_type_heading").hide();
          $("#daily_report_tax_details").closest(".col-sm-12").hide();
        } else {
          $("#tax_type_heading").show();
          $("#daily_report_tax_details").closest(".col-sm-12").show();
        }

        for (var t = 0; t < taxDetails.length; t++) {
          var row = taxDetails[t];
          var taxName = row.tax_name;
          var totalTax = safeNum(row.total_tax);
          taxTotal += totalTax;

          var rowHTMLTaxLine =
            " <tr> " +
            '   <td class="font-12 text-center">' +
            (t + 1) +
            "</td>" +
            '   <td class="font-12 text-left">' +
            esc(taxName) +
            "</td>" +
            '   <td class="font-12 text-right">' +
            currency +
            '&nbsp;<span class="number">' +
            totalTax +
            "</span> </td>" +
            " </tr>";

          $("#daily_report_tax_details tbody").append(rowHTMLTaxLine);
          taxAllDataRow.push([taxName, totalTax]);
        }
        
        // Re-check after loop to hide if total is still 0
        if (taxTotal <= 0) {
          $("#tax_type_heading").hide();
          $("#daily_report_tax_details").closest(".col-sm-12").hide();
        }
        
        $(".daily_report_product_tax_total").number(safeNum(taxTotal), 2);
        
        if (PosnicPro.local.get("table_options") === "enable") {
          $("#daily_report_dine_details").show();
        } else {
          $("#daily_report_dine_details").hide();
        }

        // ---- Dine Type (aggregated from API) ----
        var dineDetails =
          response.data && response.data.dine_details
            ? response.data.dine_details
            : [];
        $("#daily_report_dine_details tbody").children("tr").remove();

        var dineCountTotal = 0;
        var dinePaxTotal = 0;
        var dineAmountTotal = 0;
        var dineHeaderRow = ["Dine Type", "Count", "Pax", "Amount"];
        var dineAllDataRow = [];

        for (var d = 0; d < dineDetails.length; d++) {
          var row = dineDetails[d];
          var dType = row.dine_type || "Unknown";
          var dCount = safeNum(row.dine_count);

          // Support different backend field names for pax
          var rawPax = null;
          if (row.dine_pax != null) {
            rawPax = row.dine_pax;
          } else if (row.pax != null) {
            rawPax = row.pax;
          } else if (row.person_count != null) {
            rawPax = row.person_count;
          }
          var dPax = safeNum(rawPax);

          var dAmount = safeNum(row.dine_amount);

          dineCountTotal += dCount;
          // Only accumulate pax when it is a positive number
          if (dPax > 0) {
            dinePaxTotal += dPax;
          } else {
            dPax = "";
          }
          dineAmountTotal += dAmount;

          var rowHTMLDine =
            " <tr> " +
            '   <td class="font-12 text-center">' +
            (d + 1) +
            "</td>" +
            '   <td class="font-12 text-left">' +
            esc(dType) +
            "</td>" +
            '   <td class="font-12 text-center">' +
            dCount +
            "</td>" +
            '   <td class="font-12 text-center">' +
            dPax +
            "</td>" +
            '   <td class="font-12 text-right">' +
            currency +
            '&nbsp;<span class="number">' +
            dAmount +
            "</span> </td>" +
            " </tr>";

          $("#daily_report_dine_details tbody").append(rowHTMLDine);
          dineAllDataRow.push([dType, dCount, dPax, dAmount]);
        }
        $(".daily_report_dine_count").text(dineCountTotal);
        // If total pax is 0, keep footer blank instead of showing 0
        $(".daily_report_dine_pax").text(dinePaxTotal > 0 ? dinePaxTotal : "");
        $(".daily_report_dine_total").number(safeNum(dineAmountTotal), 2);

        // Show/hide Pax column itself based on whether we have any positive pax
        // Note: the header uses <td>, not <th>, so target td in thead.
        var $paxCells = $(
          "#daily_report_dine_details thead td:nth-child(4)," +
            "#daily_report_dine_details tbody td:nth-child(4)," +
            "#daily_report_dine_details tfoot td:nth-child(4)"
        );
        if (dinePaxTotal > 0) {
          $paxCells.show();
        } else {
          $paxCells.hide();
        }

        // format numeric spans
        $("span.number").number(true, 2);

        // ---- CSV Export (ES5-safe) ----
        if (type === "CSV") {
          var csv = [];
          var k;

          // products
          csv.push(productHeaderRow);
          for (k = 0; k < productAllDataRow.length; k++) {
            csv.push(productAllDataRow[k]);
          }

          // branch
          csv.push(branchHeaderRow);
          csv.push(branchDataRow);

          // payments
          csv.push(paymentHeaderRow);
          for (k = 0; k < paymentAllDataRow.length; k++) {
            csv.push(paymentAllDataRow[k]);
          }

          // dine types
          csv.push(dineHeaderRow);
          for (k = 0; k < dineAllDataRow.length; k++) {
            csv.push(dineAllDataRow[k]);
          }

          // taxes
          csv.push(taxHeaderRow);
          for (k = 0; k < taxAllDataRow.length; k++) {
            csv.push(taxAllDataRow[k]);
          }

          PosnicPro.JSONToCSVConvertor(csv, "Daily", true);
        }
      },
      function (xhr) {
        loader.find(".loadingSpinner:first").remove();
        var response;
        try {
          response = jQuery.parseJSON(xhr.responseText || "{}");
        } catch (e) {
          response = { type: "error", message: "Request failed" };
        }
        PosnicPro.alert(
          response.type || "error",
          response.message || "Request failed"
        );
      }
    );
  },

  viewReportSaleExport: function (index) {
    var type = $(index).data("id");
    PosnicPro.quickreport.salereportTable(type);
  },
  saleTableTabClick: function () {
    $("#change_sale_view").data("id", "tableView");
    $(".hide-sale-details").prop("disabled", false);
  },
  dailyReportCsv: function () {
    PosnicPro.quickreport.salereportTable("CSV");
  },

  /*
   * Print the daily report to the till printer.
   *
   * On a roll this is not the report with columns removed - it is a cash-up
   * slip, which is a different document with a different job. The A4 report is
   * an accounting record that wants every line; the slip is what somebody
   * tears off at closing, counts the drawer against, signs, and puts in the
   * cash bag. So it leads with what was sold, what of it was cash and what was
   * UPI, and ends with somewhere to write the count.
   *
   * Per-product detail is deliberately not on it. A grocery sells four hundred
   * lines a day, and printing them is several feet of paper nobody reads. The
   * ten largest by value are worth having; the rest is what the A4 copy and
   * the emailed PDF are for.
   *
   * On A4 nothing changes: the page prints as a page, because it is one.
   */
  printDailyReport: function () {
    var report = PosnicPro.quickreport.lastReport;
    if (!report) {
      PosnicPro.alert('warning', 'Run the report first, then print it.');
      return false;
    }

    var width = PosnicPro.resolvePaperWidth();

    // A4 is a sheet, and the browser has no raw printer to send bytes to
    // either. Both go through the page path that already exists.
    if (width === 'a4' || !window.electronAPI || !window.electronAPI.printer
        || !window.electronAPI.printer.printReport) {
      // Web / A4: a real vector PDF on its own white palette - never a
      // themed screenshot (owner: professional A4 layout, theme-free).
      PosnicPro.reportExport.printPdf('export_daily_report', PosnicPro.quickreport._exportMeta());
      return false;
    }

    PosnicPro.quickreport._printSlipElectron(report, width);
    return false;
  },

  /* Export identity shared by PDF / CSV / Excel. */
  _exportMeta: function () {
    var report = PosnicPro.quickreport.lastReport || {};
    var b = report.branch || {};
    return {
      shop: b.branch_name || '',
      address: b.branch_address || b.address || '',
      phone: b.branch_telephone || b.phone || '',
      title: 'Day-End Summary',
      range: (report.from && report.to) ? report.from + ' - ' + report.to : '',
      filename: 'day-end-summary'
    };
  },

  exportCsv: function () {
    if (!PosnicPro.quickreport.lastReport) { PosnicPro.alert('warning', 'Run the report first, then export it.'); return false; }
    PosnicPro.reportExport.csv('export_daily_report', PosnicPro.quickreport._exportMeta());
    return false;
  },

  exportXls: function () {
    if (!PosnicPro.quickreport.lastReport) { PosnicPro.alert('warning', 'Run the report first, then export it.'); return false; }
    PosnicPro.reportExport.xls('export_daily_report', PosnicPro.quickreport._exportMeta());
    return false;
  },

  /*
   * The dedicated day-close slip (owner: many shops have ONLY thermal
   * printers). Desktop prints through the thermal rail; the web renders
   * the same slip narrow and hands it to the browser's print dialog, so
   * a driver-connected thermal printer works there too.
   */
  printDaySlip: function () {
    var report = PosnicPro.quickreport.lastReport;
    if (!report) { PosnicPro.alert('warning', 'Run the report first, then print the slip.'); return false; }
    var width = PosnicPro.resolvePaperWidth();
    if (window.electronAPI && window.electronAPI.printer && window.electronAPI.printer.printReport
        && width !== 'a4') {
      PosnicPro.quickreport._printSlipElectron(report, width);
      return false;
    }
    var doc = PosnicPro.quickreport._slipDoc(report);
    var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
    var h = '<div class="slip">';
    h += '<div class="c b big">' + esc(doc.shop) + '</div>';
    h += '<div class="c b">' + esc(doc.title) + '</div><hr>';
    doc.meta.forEach(function (m) { h += '<div class="r"><span>' + esc(m.label) + '</span><span>' + esc(m.value) + '</span></div>'; });
    doc.sections.forEach(function (sec) {
      h += '<hr>';
      if (sec.name) { h += '<div class="b">' + esc(sec.name) + '</div>'; }
      if (sec.type === 'pairs' || sec.type === 'blanks') {
        (sec.rows || []).forEach(function (row) {
          if (typeof row === 'string') { h += '<div class="r"><span>' + esc(row) + '</span><span class="fill"></span></div>'; }
          else { h += '<div class="r"><span>' + esc(row.label) + '</span><span>' + esc(row.value) + '</span></div>'; }
        });
        if (sec.total) { h += '<div class="r b"><span>' + esc(sec.total.label) + '</span><span>' + esc(sec.total.value) + '</span></div>'; }
      } else if (sec.type === 'total') {
        h += '<div class="r b big"><span>' + esc(sec.label) + '</span><span>' + esc(sec.value) + '</span></div>';
      } else if (sec.type === 'items') {
        (sec.rows || []).forEach(function (row) {
          h += '<div class="r"><span>' + esc(row.name) + ' x' + esc(row.qty) + '</span><span>' + esc(row.amount) + '</span></div>';
        });
      } else if (sec.type === 'note') {
        h += '<div class="note">' + esc(sec.text) + '</div>';
      }
    });
    h += '</div>';
    var w = window.open('', '_blank');
    if (!w) { PosnicPro.alert('warning', 'Allow pop-ups so the slip can print.'); return false; }
    w.document.write('<html><head><title>Day-Close Slip</title><style>'
      + '@page{margin:4mm;}body{margin:0;font-family:Consolas,Menlo,monospace;font-size:12px;color:#000;background:#fff;}'
      + '.slip{width:72mm;}.c{text-align:center;}.b{font-weight:700;}.big{font-size:15px;}'
      + '.r{display:flex;justify-content:space-between;gap:6px;padding:1px 0;}'
      + '.fill{flex:1;border-bottom:1px dotted #000;margin-left:6px;}'
      + 'hr{border:none;border-top:1px dashed #000;margin:5px 0;}.note{margin-top:6px;font-size:10px;}'
      + '</style></head><body>' + h
      + '<script>setTimeout(function(){window.focus();window.print();},80);<' + '/script></body></html>');
    w.document.close();
    return false;
  },

  /* The slip document, one builder for both print rails. */
  _slipDoc: function (report) {
    var money = function (n) { return Number(n || 0).toFixed(2); };

    // Cash is the figure the slip exists for, so it is named rather than left
    // for the reader to find among the other tenders.
    var cash = 0;
    for (var i = 0; i < report.payments.length; i++) {
      if (/^cash$/i.test(report.payments[i].label)) cash += report.payments[i].amount;
    }

    var top = report.products.slice().sort(function (a, b) {
      return b.total - a.total;
    }).slice(0, 10);

    var doc = {
      shop: report.branch.branch_name || '',
      title: 'DAILY SALES',
      meta: [
        { label: 'From', value: report.from },
        { label: 'To', value: report.to },
        { label: 'Printed', value: new Date().toLocaleString('en-IN') },
        { label: 'By', value: PosnicPro.local.get('loginuser_name') || '' }
      ],
      sections: [
        { type: 'pairs', name: 'SALES', rows: [
          { label: 'Items sold', value: String(report.qty) },
          { label: 'Subtotal', value: money(report.subtotal) }
        ] },
        { type: 'total', label: 'TOTAL SALES', value: money(report.total) },
        { type: 'pairs', name: 'PAYMENTS',
          rows: report.payments.map(function (p) {
            return { label: p.label, value: money(p.amount) };
          }),
          total: { label: 'Total received', value: money(report.tenderTotal) } },
        /*
         * The cash figure sits at the head of the handover block, directly
         * above the line the count goes on, because that is the comparison
         * the person signing is making.
         *
         * The rest is left blank on purpose. The app cannot know what is
         * physically in the drawer, and across a date range it cannot
         * honestly work out what ought to be either - a range can span
         * several register sessions, each with its own opening float.
         * Printing a computed "expected" from incomplete information would be
         * worse than printing a line to write on.
         */
        { type: 'blanks', name: 'HANDOVER', rows: [
          { label: 'Cash sales', value: money(cash) },
          'Opening float', 'Cash counted', 'Difference', 'Handed to', 'Signature'
        ] },
        { type: 'items', name: 'TOP ITEMS BY VALUE',
          rows: top.map(function (p) {
            return { name: p.name, qty: String(p.qty), amount: money(p.total) };
          }) },
        { type: 'note', text: 'Full item detail is on the A4 copy and the emailed PDF.' }
      ]
    };
    return doc;
  },

  _printSlipElectron: function (report, width) {
    var doc = PosnicPro.quickreport._slipDoc(report);
    Promise.resolve(PosnicPro.resolveReceiptPrinter())
    .then(function (chosen) {
      return chosen || window.electronAPI.printer.getDefault();
    })
    .then(function (printerName) {
      if (printerName && typeof printerName === 'object') printerName = printerName.name || null;
      if (!printerName) {
        throw new Error('No printer found. Choose one in Hardware Manager, Receipt Printer.');
      }
      return window.electronAPI.printer.printReport(doc, {
        printerName: printerName,
        paperWidth: width,
        docName: 'Daily Sales'
      });
    })
    .then(function (result) {
      if (!result || !result.success) {
        PosnicPro.alert('error', (result && result.error) || 'Print failed');
      }
    })
    .catch(function (err) {
      PosnicPro.alert('error', (err && err.message) ? err.message : 'Print failed');
    });

    return false;
  },

  // Shared: render the on-screen report body (#export_daily_report) to a canvas
  // so Print and Download produce the SAME thing the user sees - no separate
  // server template, no blank page. White background keeps it print-clean on
  // any theme (dark themes included).
  _captureReport: function (onCanvas) {
    var el = document.getElementById('export_daily_report');
    if (!el) { PosnicPro.alert('warning', 'Run the report first, then try again.'); return; }
    /* html2canvas loads on first use. This also FIXES the dashboard: the
       library was only ever bundled into the mail-print page, so this check
       used to fail on every till with "Report tools not loaded". */
    PosnicPro.lazy.load('html2canvas').then(function () {
      var scale = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5));
      window.html2canvas(el, {
        scale: scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: el.scrollWidth,
        logging: false
      }).then(function (canvas) {
        onCanvas(canvas);
      }).catch(function (err) {
        PosnicPro.alert('error', 'Could not render the report: ' + (err && err.message ? err.message : err));
      });
    });
  },

  dailyReportPdf: function () {
    var report = PosnicPro.quickreport.lastReport;
    if (!report) { PosnicPro.alert('warning', 'Run the report first, then download it.'); return false; }
    PosnicPro.lazy.load('jspdf').then(function () {
      PosnicPro.quickreport._buildPdf();
    });
    return false;
  },

  _buildPdf: function () {
    PosnicPro.reportExport.pdf('export_daily_report', PosnicPro.quickreport._exportMeta());
    return false;
  },

  _buildPdfLegacyScreenshot: function () {
    // The bundled jsPDF exposes its constructor differently across builds:
    // window.jspdf.jsPDF (2.x UMD returning {jsPDF}), window.jsPDF (1.x global),
    // or window.jspdf itself when the UMD returns the constructor directly (our
    // bundle) - the last case made "window.jspdf.jsPDF" undefined and threw
    // "jsPDF is not a constructor". Resolve it robustly.
    var jsPDFCtor = (window.jspdf && typeof window.jspdf.jsPDF === 'function') ? window.jspdf.jsPDF
                  : (typeof window.jsPDF === 'function') ? window.jsPDF
                  : (typeof window.jspdf === 'function') ? window.jspdf
                  : null;
    if (!jsPDFCtor) { PosnicPro.alert('error', 'PDF tools not loaded - refresh and retry.'); return false; }
    PosnicPro.quickreport._captureReport(function (canvas) {
      var imgData = canvas.toDataURL('image/png');
      var pageW = 210, pageH = 297, margin = 8;         // A4 portrait, mm
      var contentW = pageW - margin * 2;
      var imgH = (canvas.height * contentW) / canvas.width;
      var pageContentH = pageH - margin * 2;
      var pdf = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      var position = margin;
      var heightLeft = imgH;
      pdf.addImage(imgData, 'PNG', margin, position, contentW, imgH, undefined, 'FAST');
      heightLeft -= pageContentH;
      while (heightLeft > 0) {
        position = margin - (imgH - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, contentW, imgH, undefined, 'FAST');
        heightLeft -= pageContentH;
      }
      pdf.save('quick-sale-report.pdf');
    });
    return false;
  },

  dailyReportEmail: function () {
    $("#to_email_value").val("");
    $("#to_email_modal").modal("show");
  },

  emailFormSubmit: function () {
    const email = ($("#to_email_value").val() || "").trim();
    const branchId = ($("#dailysale_branch_value").val() || "")
      .toString()
      .trim();
    const daterange = ($("#view_dailysale_report_daterange").val() || "").trim();

    // basic guards
    if (!branchId) {
      PosnicPro.alert("error", "Please select a branch");
      return;
    }
    if (!daterange) {
      PosnicPro.alert("error", "Please select a date range");
      return;
    }
    // quick email check (client-side only; server still validates)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      PosnicPro.alert("error", "Please enter a valid email");
      return;
    }

    // robust split: "MM/DD/YYYY - MM/DD/YYYY"
    let fields = daterange.split(" - ");
    if (fields.length !== 2) fields = daterange.split("-").map((s) => s.trim());
    const startDate = (fields[0] || "").trim();
    const endDate = (fields[1] || "").trim();
    if (!startDate || !endDate) {
      PosnicPro.alert("error", "Select a valid date range");
      return;
    }

    // fetch report data (use a stable type; do NOT read from date label)
    const getParams = {
      url: "sales/dailySalesReports",
      data: {
        branch: branchId,
        starting_date: startDate,
        ending_date: endDate,
        type: "VIEW", // we just need the data payload for the email
      },
    };

    PosnicPro.get(
      getParams,
      function (resp1) {
        if (resp1.type !== "success") {
          PosnicPro.alert(resp1.type, resp1.message);
          return;
        }

        // send email with the fetched data
        const postParams = {
          url: "sales/dailySalesMail",
          data: JSON.stringify({
            email: email,
            data: resp1.data,
          }),
        };

        PosnicPro.post(
          postParams,
          function (resp2) {
            $("#to_email_value").val("");
            $("#to_email_modal").modal("hide");
            PosnicPro.alert(resp2.type, resp2.message);
          },
          function (xhr2) {
            let r = {};
            try {
              r = jQuery.parseJSON(xhr2.responseText || "{}");
            } catch (e) {}
            PosnicPro.alert(
              r.type || "error",
              r.message || "Email request failed"
            );
          }
        );
      },
      function (xhr1) {
        let r = {};
        try {
          r = jQuery.parseJSON(xhr1.responseText || "{}");
        } catch (e) {}
        PosnicPro.alert(
          r.type || "error",
          r.message || "Report request failed"
        );
      }
    );
  },
};

$(document).ready(function () {
  setTimeout(function () {
    var fullHash = window.location.hash;
    var hash = fullHash.replace(/^#\/?/, "");
    if (hash === "quickreport") {
      var loader = $(".loader-dailysale-report");
      loader.find(".loadingSpinner:first").remove();
      $("#view_dailysale_report_daterange")
        .data("daterangepicker")
        .setStartDate(moment().startOf("day"));
      $("#view_dailysale_report_daterange")
        .data("daterangepicker")
        .setEndDate(moment().endOf("day"));
      $("#view_dailysale_report_daterange span").html(
        '<span>Today</span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' +
          moment().startOf("day").format("YYYY/MM/DD h:mm A") +
          " - " +
          moment().endOf("day").format("YYYY/MM/DD h:mm A") +
          '"><i class="feather icon-help-circle setfeather_font"></i></span>'
      );
      $("#view_dailysale_report_daterange").val(
        moment().startOf("day").format("YYYY/MM/DD h:mm A") +
          " - " +
          moment().endOf("day").format("YYYY/MM/DD h:mm A")
      );

      PosnicPro.quickreport.salereportTable();
    }
  }, 3000);
});

// validate signup form on keyup and submit
$(".to_email_form").validate({
  highlight: function (element, errorClass) {
    $(element).css("border-color", "#f9616d");
  },
  unhighlight: function (element, errorClass) {
    $(element).css("border-color", "#eae8e8");
  },
  rules: {
    to_email_value: {
      required: true,
      email: true,
      emailExt: true,
      maxlength: 250,
    },
  },
  messages: {
    to_email_value: {
      required: "Please Enter a email address",
      maxlength: "Email should not be more than 250 Characters",
    },
  },
});

$("#to_email_modal").on("shown.bs.modal", function () {
  $(this).find("#to_email_value").focus();
});

$(".to_email_form").submit(function (event) {
  event.preventDefault();
  if ($(".to_email_form").valid()) {
    // checks form for validity
    PosnicPro.quickreport.emailFormSubmit();
  }
});
