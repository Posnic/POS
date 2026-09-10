/*
 * The shop's public menu.
 *
 * Read-only, by design and not by omission. There is no cart here, no prices
 * that become a total, and nothing that starts an order - that is what
 * /order is for. A menu is the thing a customer reads at the table, outside
 * the window, or in a message a friend sent them, and it should do that one
 * job faster and more clearly than the paper it replaced.
 *
 * WHAT MAKES A MENU GOOD, and what each of those costs here:
 *
 *   Scannable      two-line descriptions on the card, the whole thing in the
 *                  detail sheet. A page where every dish is a paragraph
 *                  cannot be read at a table.
 *   Navigable      category chips that travel with you and light up as you
 *                  scroll. Scrolling back to the top to change section is what
 *                  makes a digital menu worse than paper.
 *   Searchable     one box, instant, over names and descriptions, with a
 *                  count read out to a screen reader.
 *   Honest         a dish that is off tonight is shown and marked, not hidden.
 *                  A menu with holes reads as a kitchen that has run out.
 *   Marked         the veg dot, which Indian menus carry by law and customers
 *                  look for before they read the name.
 *
 * Vanilla, and small. A menu is a list; a framework to render one is weight a
 * phone on a bad connection pays for nothing.
 */
(function () {
  "use strict";

  var state = { categories: [], currency: "", flat: [] };

  var el = function (id) {
    return document.getElementById(id);
  };

  /* ---------------------------------------------------------------- data */

  /**
   * The store address this menu is for.
   *
   * `/menu/AZ100` names a branch. `/menu` means the shop's default, which the
   * server resolves - most shops have one branch and should not have to print
   * a code to say which of their one branch they mean.
   */
  function storeAddress() {
    var last =
      String(window.location.pathname || "")
        .split("/")
        .filter(Boolean)
        .pop() || "";
    if (/^[A-Za-z0-9]{3,6}$/.test(last) && last !== "menu") return last;
    return new URLSearchParams(window.location.search).get("branch") || null;
  }

  function endpoint() {
    var store = storeAddress();
    return (
      CONFIG.API_BASE_URL +
      "/online-ordering" +
      (store ? "/" + encodeURIComponent(store) : "") +
      "/menu"
    );
  }

  function load() {
    fetch(endpoint(), { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json().then(function (body) {
          return { ok: r.ok, body: body };
        });
      })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.data) {
          showState(
            "This menu is not available",
            (res.body && res.body.message) || "",
          );
          return;
        }
        render(res.body.data);
      })
      .catch(function () {
        /* Offline, or the shop's server is down. Say which, roughly,
                   rather than leaving a spinner turning. */
        showState(
          "Could not load the menu",
          "Check your connection and try again.",
        );
      });
  }

  /* -------------------------------------------------------------- render */

  function money(amount) {
    var n = Number(amount) || 0;
    var text = n % 1 === 0 ? String(n) : n.toFixed(2);
    return state.currency ? state.currency + " " + text : text;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  /* The dot, when the shop has said. Empty is left empty: a wrong mark on a
       dish somebody cannot eat is worse than no mark at all. */
  function dietMark(diet) {
    var known = { veg: 1, non_veg: 1, egg: 1, vegan: 1 };
    if (!known[diet]) return "";
    var label = {
      veg: "Vegetarian",
      non_veg: "Non-vegetarian",
      egg: "Contains egg",
      vegan: "Vegan",
    }[diet];
    return (
      '<span class="diet diet-' +
      diet +
      '" role="img" aria-label="' +
      label +
      '"></span>'
    );
  }

  function dishHtml(item) {
    var thumb = item.image
      ? '<img class="dish-thumb" src="' +
        escapeHtml(item.image) +
        '" alt="" loading="lazy" decoding="async">'
      : "";
    var desc = item.description
      ? '<p class="dish-desc">' + escapeHtml(item.description) + "</p>"
      : "";
    /*
     * WHY a dish is greyed out, not just that it is.
     *
     * "Breakfast only, 7:00 AM to 11:00 AM" is a reason to come back
     * tomorrow. An unexplained grey card is a dead end, and the customer
     * assumes the restaurant has run out.
     */
    var off = "";
    if (item.available === false) {
      var served = (item.served_in || []).join(" and ");
      off =
        '<span class="off-today">' +
        escapeHtml(served ? served + " only" : "Not available today") +
        "</span>";
    }

    /* How long the kitchen needs, when the shop has said. */
    var prep =
      Number(item.prep_minutes) > 0
        ? '<span class="prep">' +
          escapeHtml("~" + item.prep_minutes + " min") +
          "</span>"
        : "";

    return (
      '<button type="button" class="dish" data-id="' +
      escapeHtml(item.id) +
      '" ' +
      'data-available="' +
      (item.available === false ? "false" : "true") +
      '">' +
      '<span class="dish-body">' +
      '<span class="dish-title">' +
      dietMark(item.diet) +
      '<span class="dish-name">' +
      escapeHtml(item.name) +
      "</span></span>" +
      desc +
      '<span class="dish-price">' +
      escapeHtml(money(item.price)) +
      "</span>" +
      (off || prep ? "<br>" + off + (off && prep ? " " : "") + prep : "") +
      "</span>" +
      thumb +
      "</button>"
    );
  }

  function render(data) {
    state.categories = data.categories || [];
    state.currency = (data.store && data.store.currency) || "";
    state.flat = [];
    state.categories.forEach(function (c) {
      c.items.forEach(function (i) {
        state.flat.push({ cat: c.id, item: i });
      });
    });

    var store = data.store || {};
    document.title = store.name ? store.name + " menu" : "Menu";

    if (store.logo) {
      var logo = el("shop-logo");
      logo.src = store.logo;
      logo.hidden = false;
    }
    if (store.name) el("shop-name").textContent = store.name;

    var count = data.item_count || 0;
    var sub = el("shop-sub");
    sub.textContent = count + (count === 1 ? " dish" : " dishes");
    sub.hidden = false;

    /*
     * The shop's own words about being closed, paused or menu-only. Shown
     * on a menu too, because someone reading it at 11pm wants to know when
     * the kitchen opens, and that answer is already computed server-side.
     */
    var channel = data.channel || {};
    if (channel.message) {
      el("notice").textContent = channel.message;
      el("notice").hidden = false;
    }

    if (!state.categories.length) {
      showState(
        "No dishes yet",
        "This shop has not added anything to its menu.",
      );
      return;
    }

    el("state").hidden = true;
    el("controls").hidden = false;

    el("cats").innerHTML = state.categories
      .map(function (c, i) {
        return (
          '<a class="cat" href="#cat-' +
          escapeHtml(c.id) +
          '"' +
          (i === 0 ? ' aria-current="true"' : "") +
          ">" +
          escapeHtml(c.name || "Menu") +
          "</a>"
        );
      })
      .join("");

    el("menu").innerHTML = state.categories
      .map(function (c) {
        return (
          '<section class="section" data-cat="' +
          escapeHtml(c.id) +
          '">' +
          '<h2 id="cat-' +
          escapeHtml(c.id) +
          '" tabindex="-1">' +
          escapeHtml(c.name || "Menu") +
          "</h2>" +
          '<p class="section-count">' +
          c.items.length +
          (c.items.length === 1 ? " dish" : " dishes") +
          "</p>" +
          '<div class="dishes">' +
          c.items.map(dishHtml).join("") +
          "</div>" +
          "</section>"
        );
      })
      .join("");

    el("foot").textContent = store.name || "";
    el("foot").hidden = !store.name;

    watchSections();
  }

  function showState(title, detail) {
    var box = el("state");
    box.innerHTML = "<strong></strong><span></span>";
    box.querySelector("strong").textContent = title;
    box.querySelector("span").textContent = detail || "";
    box.hidden = false;
  }

  /* -------------------------------------------------------------- search */

  function applySearch(term) {
    var q = String(term || "")
      .trim()
      .toLowerCase();
    var sections = document.querySelectorAll(".section");
    var shown = 0;

    sections.forEach(function (section) {
      var visibleInSection = 0;
      section.querySelectorAll(".dish").forEach(function (dish) {
        var hay = dish.textContent.toLowerCase();
        var match = !q || hay.indexOf(q) !== -1;
        dish.hidden = !match;
        if (match) visibleInSection++;
      });
      /* A heading with nothing under it is noise while searching. */
      section.hidden = visibleInSection === 0;
      shown += visibleInSection;
    });

    el("search-clear").hidden = !q;
    /* The categories navigate a list that searching has just rearranged,
           so they step aside until the search is cleared. */
    el("cats").hidden = !!q;

    var counter = el("result-count");
    if (!q) {
      counter.hidden = true;
    } else {
      counter.hidden = false;
      counter.innerHTML = "";
      if (shown === 0) {
        counter.appendChild(
          Object.assign(document.createElement("strong"), {
            textContent: 'Nothing matches "' + term + '"',
          }),
        );
        counter.appendChild(document.createTextNode("Try a different word."));
      } else {
        counter.textContent =
          shown + (shown === 1 ? " dish" : " dishes") + " found";
      }
    }
  }

  /* ------------------------------------------------------- scroll spy */

  /*
   * Which section the reader is actually in.
   *
   * IntersectionObserver rather than a scroll handler: the browser does the
   * work off the main thread, and a scroll listener that recalculates
   * positions on every frame is exactly what makes a long menu feel cheap on
   * an old phone.
   */
  function watchSections() {
    if (!("IntersectionObserver" in window)) return;

    var chips = {};
    document.querySelectorAll(".cat").forEach(function (a) {
      chips[a.getAttribute("href").replace("#cat-", "")] = a;
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.getAttribute("data-cat");
          Object.keys(chips).forEach(function (key) {
            chips[key].removeAttribute("aria-current");
          });
          if (chips[id]) {
            chips[id].setAttribute("aria-current", "true");
            /* Keep the active chip in view, or on a long menu it
                       scrolls off the strip and the reader loses their place. */
            chips[id].scrollIntoView({ block: "nearest", inline: "center" });
          }
        });
      },
      { rootMargin: "-120px 0px -70% 0px" },
    );

    document.querySelectorAll(".section").forEach(function (s) {
      observer.observe(s);
    });
  }

  /* --------------------------------------------------------- detail sheet */

  function openSheet(id) {
    var found = state.flat.filter(function (row) {
      return String(row.item.id) === String(id);
    })[0];
    if (!found) return;
    var item = found.item;

    var img = el("sheet-img");
    if (item.image) {
      img.src = item.image;
      img.hidden = false;
    } else {
      img.hidden = true;
    }

    el("sheet-diet").innerHTML = dietMark(item.diet);
    el("sheet-title").textContent = item.name;

    var desc = el("sheet-desc");
    desc.textContent = item.description || "";
    desc.hidden = !item.description;

    el("sheet-price").textContent =
      money(item.price) +
      (item.available === false ? "  -  not available today" : "");

    var sheet = el("sheet");
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "open");
  }

  /* ---------------------------------------------------------------- wire */

  document.addEventListener("click", function (e) {
    var dish = e.target.closest && e.target.closest(".dish");
    if (dish) {
      openSheet(dish.getAttribute("data-id"));
      return;
    }

    if (e.target.id === "sheet-close") {
      var sheet = el("sheet");
      if (typeof sheet.close === "function") sheet.close();
      else sheet.removeAttribute("open");
    }

    if (e.target.id === "search-clear") {
      el("search").value = "";
      applySearch("");
      el("search").focus();
    }
  });

  el("search").addEventListener("input", function (e) {
    applySearch(e.target.value);
  });

  load();
})();
