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

  var state = {
    categories: [],
    currency: "",
    flat: [],
    /* What the reader has narrowed the menu to. Held here rather than read
       back off the controls each time, so search and filters compose instead
       of overwriting one another. */
    query: "",
    vegOnly: false,
    availableOnly: false,
    sort: "menu",
  };

  var el = function (id) {
    return document.getElementById(id);
  };

  /* ---------------------------------------------------------------- data */

  /**
   * Which shop this menu is for, and where the reader is sitting.
   *
   *   /menu                     the shop's default branch
   *   /menu/AZ100               that branch
   *   /menu/AZ100/table/5       its own table five
   *   /menu/AZ100/venue/RC/123  Royal Club Hotel, room 123
   *
   * The last one is why this reads the whole path rather than the last
   * segment: a hotel room is quoted a different price, and taking the last
   * segment of the URL would have asked the server for a shop called "123".
   *
   * Where the customer is sitting travels as a query parameter rather than as
   * part of the resource, because it qualifies the read - the same menu,
   * priced for where you are - rather than naming a different one.
   */
  function readUrl() {
    var parts = String(window.location.pathname || "")
      .split("/")
      .filter(Boolean);
    if (parts[0] === "menu") parts.shift();

    var query = new URLSearchParams(window.location.search);
    var point = {
      store: /^[A-Za-z0-9]{3,6}$/.test(parts[0] || "")
        ? parts[0]
        : query.get("branch") || null,
      table: query.get("table") || "",
      venue: query.get("venue") || "",
      unit: query.get("unit") || "",
    };

    if (parts[1] === "table") point.table = parts[2] || "";
    if (parts[1] === "venue") {
      point.venue = parts[2] || "";
      point.unit = parts[3] || "";
    }
    return point;
  }

  function endpoint() {
    var point = readUrl();
    var query = new URLSearchParams();
    ["table", "venue", "unit"].forEach(function (key) {
      if (point[key]) query.set(key, point[key]);
    });
    var suffix = query.toString();
    return (
      CONFIG.API_BASE_URL +
      "/online-ordering" +
      (point.store ? "/" + encodeURIComponent(point.store) : "") +
      "/menu" +
      (suffix ? "?" + suffix : "")
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

  /*
   * A price, in the shop's own money.
   *
   * A SYMBOL sits against the number - "₹280", the way it is written on every
   * bill in the country - and a CODE or a word keeps its space: "Rs 280",
   * "INR 280". The server sends the symbol where the shop has one.
   */
  function money(amount) {
    var n = Number(amount) || 0;
    var text = n % 1 === 0 ? String(n) : n.toFixed(2);
    var unit = state.currency;
    if (!unit) return text;
    return /^[A-Za-z]/.test(unit) ? unit + " " + text : unit + text;
  }

  /*
   * "Dishes" in a restaurant, "items" in a shop.
   *
   * The same menu serves a stationer as a kitchen, and "42 dishes" over a
   * list of ball pens reads as a page that does not know where it is. A
   * kitchen leaves fingerprints - a veg mark, a preparation time, a serving
   * period - and one is enough.
   */
  function unitWord(count) {
    var kitchen = state.flat.some(function (row) {
      var i = row.item;
      return (
        !!i.diet || Number(i.prep_minutes) > 0 || (i.served_in || []).length > 0
      );
    });
    if (count === 1) return kitchen ? "dish" : "item";
    return kitchen ? "dishes" : "items";
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
    /*
     * A photograph if the shop uploaded one, and otherwise the emoji the
     * server resolved - chosen by the shop, or read from the dish's own name.
     *
     * Nothing is still a perfectly good answer, and it is what "Item 4" gets.
     * The alternative to an honest blank is a grey placeholder box, which is
     * a promise of a picture that never arrives.
     */
    var thumb = item.image
      ? '<img class="dish-thumb" src="' +
        escapeHtml(item.image) +
        '" alt="" loading="lazy" decoding="async">'
      : item.icon
        ? '<span class="dish-icon" aria-hidden="true">' +
          escapeHtml(item.icon) +
          "</span>"
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
      (off || prep ? '<span class="dish-meta">' + off + prep + "</span>" : "") +
      "</span>" +
      thumb +
      "</button>"
    );
  }

  /**
   * One search result: a small square, a name, its section, the price.
   *
   * Deliberately not the menu card. A card is for browsing - it earns its
   * height with a picture and a description. Search is somebody asking whether
   * this kitchen has a thing, with the keyboard eating half the screen, so the
   * answer has to be a list they can run their eye down.
   */
  function resultHtml(item) {
    var thumb = item.image
      ? '<img class="result-thumb" src="' +
        escapeHtml(item.image) +
        '" alt="" loading="lazy" decoding="async">'
      : '<span class="result-icon" aria-hidden="true">' +
        escapeHtml(item.icon || "") +
        "</span>";

    /* The section it came from, because "Chicken 65" means something
       different under Starters than under Biryani - and when it is not
       available, why, which is the more useful thing to say. */
    var meta = item.categoryName || "";
    if (item.available === false) {
      var served = (item.served_in || []).join(" and ");
      meta = served ? served + " only" : "Not available today";
    } else if (Number(item.prep_minutes) > 0) {
      meta = meta
        ? meta + "  -  ~" + item.prep_minutes + " min"
        : "~" + item.prep_minutes + " min";
    }

    return (
      '<button type="button" class="result" data-id="' +
      escapeHtml(item.id) +
      '" data-available="' +
      (item.available === false ? "false" : "true") +
      '">' +
      thumb +
      '<span class="result-body">' +
      '<span class="result-name">' +
      dietMark(item.diet) +
      escapeHtml(item.name) +
      "</span>" +
      '<span class="result-meta">' +
      escapeHtml(meta) +
      "</span>" +
      "</span>" +
      '<span class="result-price">' +
      escapeHtml(money(item.price)) +
      "</span>" +
      "</button>"
    );
  }

  /**
   * How many dishes a section shows before it offers the rest.
   *
   * Enough to tell what the section IS, few enough that the next one is on
   * the same screen. A shop with four hundred lines has categories of forty,
   * and forty of anything buries everything after it.
   */
  var FOLD_AT = 6;

  /**
   * Fold every long section, and leave the short ones alone.
   *
   * Runs on the rendered menu rather than at build time so the button can
   * count what is actually visible after the filters have had their say.
   */
  function foldSections() {
    document.querySelectorAll(".section").forEach(function (section) {
      var row = section.querySelector(".dishes");
      if (!row) return;

      var dishes = [].slice
        .call(row.querySelectorAll(".dish"))
        .filter(function (d) {
          return !d.hidden;
        });

      var button = section.querySelector(".more-in-section");
      var hidden = Math.max(0, dishes.length - FOLD_AT);

      /* Expanded by hand stays expanded: somebody who opened Biryani does not
         want it shut again because they toggled a filter. */
      if (section.getAttribute("data-open") === "true" || hidden === 0) {
        dishes.forEach(function (d) {
          d.style.display = "";
        });
        if (button) button.hidden = true;
        return;
      }

      dishes.forEach(function (d, i) {
        d.style.display = i < FOLD_AT ? "" : "none";
      });

      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "more-in-section";
        row.parentNode.insertBefore(button, row.nextSibling);
      }
      button.hidden = false;
      button.textContent = "Show all " + dishes.length;
    });
  }

  document.addEventListener("click", function (e) {
    var more =
      e.target && e.target.closest
        ? e.target.closest(".more-in-section")
        : null;
    if (!more) return;
    var section = more.closest(".section");
    if (!section) return;
    section.setAttribute("data-open", "true");
    foldSections();
  });

  /**
   * Searching is a mode, and the page says so.
   *
   * The bar rises to the top, the shop name and the section chips stand down,
   * and a back arrow appears. On a phone with the keyboard up, that is the
   * difference between two results visible and eight.
   */
  function setSearching(on) {
    document.body.classList.toggle("searching", !!on);
    var back = el("search-back");
    if (back) back.hidden = !on;
  }

  (function wireSearchMode() {
    var input = el("search");
    var back = el("search-back");
    if (input) {
      input.addEventListener("focus", function () {
        setSearching(true);
      });
    }
    if (back) {
      back.addEventListener("click", function () {
        if (input) {
          input.value = "";
          input.blur();
        }
        state.query = "";
        setSearching(false);
        applyView();
      });
    }
  })();

  /**
   * Speak the dish instead of spelling it.
   *
   * The browser's own recogniser - the engine behind the keyboard's dictation
   * key. Nothing leaves the phone, there is no account and no key. Where the
   * browser has none the button stays hidden, because a microphone that does
   * nothing is worse than no microphone.
   */
  (function wireMic() {
    var Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    var mic = el("search-mic");
    var input = el("search");
    if (!Recognition || !mic || !input) return;

    mic.hidden = false;
    mic.setAttribute("data-supported", "true");
    var listening = null;

    mic.addEventListener("click", function () {
      if (listening) {
        listening.stop();
        return;
      }
      var rec = new Recognition();
      /* The page's own language, so a Tamil menu is not transcribed as
         English - the recogniser mishears NUMBERS first when told the wrong
         one, and a number is half of what people search for. */
      rec.lang = document.documentElement.lang || "en";
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = function () {
        listening = rec;
        mic.setAttribute("data-listening", "true");
        setSearching(true);
      };
      rec.onresult = function (e) {
        var said = "";
        for (var i = e.resultIndex; i < e.results.length; i++) {
          said += e.results[i][0].transcript;
        }
        said = said.trim();
        if (!said) return;
        input.value = said;
        /* Straight through the normal path, so a spoken word is searched the
           same way a typed one is - fuzziness and all. */
        applySearch(said);
      };
      rec.onerror = function () {
        /* Refused permission, no network for the engine that needs one, or
           simply nothing said. None of them is worth an alert on a menu. */
      };
      rec.onend = function () {
        listening = null;
        mic.removeAttribute("data-listening");
      };

      try {
        rec.start();
      } catch (err) {
        /* Already running, which the spec throws for. Nothing to do. */
      }
    });
  })();

  function render(data) {
    state.categories = data.categories || [];
    state.currency = (data.store && data.store.currency) || "";
    state.flat = [];
    state.categories.forEach(function (c) {
      c.items.forEach(function (i) {
        /* Carried onto the dish so search can weigh a category hit: somebody
           typing "breads" means the section, and the dishes do not otherwise
           know which one they are in. */
        i.categoryName = c.name || "";
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
    sub.textContent = count + " " + unitWord(count);
    sub.hidden = false;

    offerOrdering(data.channel || {});

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

    /*
     * Whose prices these are.
     *
     * A hotel room is quoted the marked-up price, and the guest is told so
     * here rather than finding out at checkout. Saying it plainly is also the
     * honest thing: the hotel is providing the service, and a guest who
     * understands that complains to nobody.
     */
    var point = data.service_point || {};
    if (point.venue) {
      el("venue-note").textContent =
        "Prices shown for " +
        point.venue.name +
        (point.venue.unit
          ? ", " + point.venue.unit_label + " " + point.venue.unit
          : "");
      el("venue-note").hidden = false;
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
          " " +
          unitWord(c.items.length) +
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

  /**
   * The way in, when there is one.
   *
   * A menu is read-only by design, and this is the one thing on it that
   * leads anywhere: a single bar at the bottom, only while the shop is
   * actually taking orders. It keeps the table or room the printed code
   * named, so a customer who scanned at table five lands on the ordering
   * page already at table five.
   */
  function offerOrdering(channel) {
    var bar = el("order-cta");
    var link = el("order-link");
    if (!bar || !link) return;

    var taking = channel.accepting === true && channel.mode !== "menu";
    bar.hidden = !taking;
    document.body.classList.toggle("can-order", taking);
    if (!taking) return;

    var point = readUrl();
    var href = "/order/";
    if (point.store) {
      href += encodeURIComponent(point.store);
      if (point.table) {
        href += "/table/" + encodeURIComponent(point.table);
      } else if (point.venue) {
        href += "/venue/" + encodeURIComponent(point.venue);
        if (point.unit) href += "/" + encodeURIComponent(point.unit);
      }
    }
    link.setAttribute("href", href);
  }

  function showState(title, detail) {
    var box = el("state");
    box.innerHTML = "<strong></strong><span></span>";
    box.querySelector("strong").textContent = title;
    box.querySelector("span").textContent = detail || "";
    box.hidden = false;
  }

  /* ------------------------------------------------------------- search
   *
   * PORTED FROM api/src/utils/menu-search.js, deliberately.
   *
   * This bundle is plain scripts on a phone with no build step, so there is
   * nothing to import through. Sharing ninety lines would mean giving the page
   * a module loader, and being fast on a bad connection is the whole reason
   * this page exists. tests/menu-search-parity.test.js pins the two copies to
   * the same answers so they cannot drift quietly.
   */

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Damerau-Levenshtein. The transposition is what makes "biriyani" one
     mistake rather than two. */
  function editDistance(a, b, budget) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > budget) return budget + 1;

    var prev2 = null;
    var prev = [];
    for (var k = 0; k <= b.length; k++) prev.push(k);

    for (var i = 1; i <= a.length; i++) {
      var row = new Array(b.length + 1);
      row[0] = i;
      var best = row[0];

      for (var j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var value = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          value = Math.min(value, prev2[j - 2] + cost);
        }
        row[j] = value;
        if (value < best) best = value;
      }

      if (best > budget) return budget + 1;
      prev2 = prev;
      prev = row;
    }
    return prev[b.length];
  }

  /* Short words get no slack: with a budget of two, "dal" matches "dosa" and
     a three-letter search returns the menu. */
  function budgetFor(length) {
    if (length < 5) return 0;
    if (length < 8) return 1;
    return 2;
  }

  function scoreWord(query, target) {
    if (!query || !target) return 0;
    if (query === target) return 100;
    if (target.indexOf(query) === 0) return 80;
    if (target.indexOf(query) !== -1) return 55;

    var budget = budgetFor(query.length);
    if (!budget) return 0;
    var distance = editDistance(query, target, budget);
    if (distance > budget) return 0;
    return 40 - (distance - 1) * 12;
  }

  /* Every query word must find something: somebody who typed two words meant
     both of them. */
  function scoreItem(query, fields) {
    var words = normalize(query).split(" ").filter(Boolean);
    if (!words.length) return { match: true, score: 0 };

    var haystacks = [
      { text: normalize(fields.name), weight: 1 },
      { text: normalize(fields.category), weight: 0.5 },
      { text: normalize(fields.description), weight: 0.35 },
    ].filter(function (h) {
      return h.text;
    });

    var total = 0;
    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      var bestForWord = 0;

      for (var h = 0; h < haystacks.length; h++) {
        var hay = haystacks[h];
        if (hay.text.indexOf(word) !== -1) {
          bestForWord = Math.max(bestForWord, 70 * hay.weight);
        }
        var parts = hay.text.split(" ");
        for (var p = 0; p < parts.length; p++) {
          var s = scoreWord(word, parts[p]);
          if (s) bestForWord = Math.max(bestForWord, s * hay.weight);
        }
      }

      if (!bestForWord) return { match: false, score: 0 };
      total += bestForWord;
    }

    return { match: true, score: Math.round(total / words.length) };
  }

  /* -------------------------------------------------------------- search */

  /**
   * Everything the reader has narrowed the menu to, applied together.
   *
   * SEARCH, FILTERS AND SORT COMPOSE. They used to be one function that read a
   * text box, which meant turning on "veg only" silently threw away whatever
   * had been typed. They are three independent narrowings of the same list
   * now, and this is the only place that decides what is on screen.
   *
   * The dish elements are reordered rather than rebuilt: the detail sheet
   * looks dishes up by id from state.flat, and rebuilding the markup on every
   * keystroke would throw away the scroll position mid-type.
   */
  function applyView() {
    var q = state.query.trim();
    var scores = {};
    var shown = 0;

    document.querySelectorAll(".section").forEach(function (section) {
      var visibleInSection = 0;
      var dishes = [].slice.call(section.querySelectorAll(".dish"));

      dishes.forEach(function (dish) {
        var item = lookup(dish.getAttribute("data-id"));
        if (!item) return;

        var ok = true;

        /* Veg only means veg. An unmarked dish is NOT assumed vegetarian -
           a shop that never filled the field has not promised anything, and
           guessing on somebody's behalf is the one mistake this filter must
           never make. */
        if (state.vegOnly && item.diet !== "veg" && item.diet !== "vegan") {
          ok = false;
        }
        if (state.availableOnly && item.available === false) ok = false;

        if (ok && q) {
          var hit = scoreItem(q, {
            name: item.name,
            description: item.description,
            category: item.categoryName,
          });
          ok = hit.match;
          scores[item.id] = hit.score;
        }

        dish.hidden = !ok;
        if (ok) visibleInSection++;
      });

      /* Reordered in place, so the sheet's lookups and the scroll position
         both survive a keystroke. */
      var order = sortedDishes(dishes, scores, q);
      var row = section.querySelector(".dishes");
      if (row)
        order.forEach(function (dish) {
          row.appendChild(dish);
        });

      /* A heading with nothing under it is noise. */
      section.hidden = visibleInSection === 0;
      shown += visibleInSection;
    });

    var narrowed = !!q || state.vegOnly || state.availableOnly;

    /*
     * Searching gets a list; browsing keeps the cards.
     *
     * The counter used to sit alone above a screen of white while the matches
     * waited below the fold - "40 dishes found" and nothing to look at. The
     * rows go where the eye already is.
     */
    var results = el("results");
    var menu = el("menu");
    if (q) {
      /*
       * Read the cards, not the catalogue.
       *
       * The filters and the search have just decided which dishes survive, and
       * they recorded that on the cards. Re-deriving it here would be a second
       * implementation of the same rule, free to disagree with the first -
       * state.flat holds { cat, item } wrappers rather than items, and the
       * first version of this read `item.id` off the wrapper and matched
       * nothing at all.
       */
      var matched = [];
      [].slice
        .call(document.querySelectorAll(".dish"))
        .filter(function (card) {
          return !card.hidden;
        })
        .forEach(function (card) {
          var item = lookup(card.getAttribute("data-id"));
          if (item) matched.push(item);
        });
      matched.sort(function (a, b) {
        return (scores[b.id] || 0) - (scores[a.id] || 0);
      });
      results.innerHTML = matched.map(resultHtml).join("");
      results.hidden = false;
      menu.hidden = true;
    } else {
      results.hidden = true;
      results.innerHTML = "";
      menu.hidden = false;
      foldSections();
    }

    el("search-clear").hidden = !q;
    /* The mic and the clear button share one corner of the field: the mic
       while there is nothing to clear, the clear once there is. */
    var mic = el("search-mic");
    if (mic && mic.getAttribute("data-supported") === "true") mic.hidden = !!q;
    /* The categories navigate a list that narrowing has just rearranged, so
       they step aside until it is cleared. */
    el("cats").hidden = narrowed;

    var counter = el("result-count");
    if (!narrowed) {
      counter.hidden = true;
      return;
    }

    counter.hidden = false;
    counter.innerHTML = "";
    if (shown === 0) {
      counter.appendChild(
        Object.assign(document.createElement("strong"), {
          textContent: q
            ? 'Nothing matches "' + state.query + '"'
            : "Nothing matches those filters",
        }),
      );
      counter.appendChild(
        document.createTextNode(
          q ? "Try a different word." : "Try turning one off.",
        ),
      );
    } else {
      counter.textContent =
        shown + (shown === 1 ? " dish" : " dishes") + " found";
    }
  }

  /** One dish from the flattened list, by id. */
  function lookup(id) {
    var found = state.flat.filter(function (row) {
      return String(row.item.id) === String(id);
    })[0];
    return found ? found.item : null;
  }

  /**
   * The order the visible dishes appear in.
   *
   * A live search ALWAYS sorts by how well each dish answered, whatever the
   * sort box says - somebody who just typed "dosa" is asking a question, and
   * answering it in price order buries the dosa. The box takes over again the
   * moment the search is cleared.
   */
  function sortedDishes(dishes, scores, query) {
    var list = dishes.slice();

    if (query) {
      return list.sort(function (a, b) {
        return (
          (scores[b.getAttribute("data-id")] || 0) -
          (scores[a.getAttribute("data-id")] || 0)
        );
      });
    }

    if (state.sort === "menu") return list;

    return list.sort(function (a, b) {
      var x = lookup(a.getAttribute("data-id")) || {};
      var y = lookup(b.getAttribute("data-id")) || {};
      if (state.sort === "popular") {
        return (y.ordered_count || 0) - (x.ordered_count || 0);
      }
      if (state.sort === "price_asc") return (x.price || 0) - (y.price || 0);
      if (state.sort === "price_desc") return (y.price || 0) - (x.price || 0);
      return 0;
    });
  }

  /* Kept under its old name: the search box, the clear button and the tests
     all call it, and the extra argument is the only thing that changed. */
  function applySearch(term) {
    state.query = String(term == null ? "" : term);
    applyView();
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
      /* From the last "#cat-" rather than a strict prefix strip: getAttribute
         gives the literal attribute, but a.href would give the resolved URL,
         and the two must not be able to disagree about which chip this is. */
      chips[a.getAttribute("href").replace(/^.*#cat-/, "")] = a;
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

  function closeSheet() {
    var sheet = el("sheet");
    if (!sheet) return;
    if (typeof sheet.close === "function") sheet.close();
    else sheet.removeAttribute("open");
  }

  function openSheet(id) {
    var found = state.flat.filter(function (row) {
      return String(row.item.id) === String(id);
    })[0];
    if (!found) return;
    var item = found.item;

    showPhotos(item);

    el("sheet-diet").innerHTML = dietMark(item.diet);
    el("sheet-title").textContent = item.name;

    var desc = el("sheet-desc");
    desc.textContent = item.description || "";
    desc.hidden = !item.description;

    el("sheet-price").textContent =
      money(item.price) +
      (item.available === false ? "  -  not available today" : "");

    showFacts(item);

    showGoesWith(item);

    var sheet = el("sheet");
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "open");
  }

  /**
   * The photo, whole, with a way out.
   *
   * The strip crops every picture to one band so the sheet reads as a list.
   * That is right for scanning and wrong for deciding - a customer looking at
   * a dish wants the picture the shop actually took, not the middle of it. So
   * a tap opens it contained on a dark ground, and the close button carries
   * its own background because a plain glyph vanishes on a photograph of
   * roughly half of everything.
   */
  function openViewer(src, alt) {
    var viewer = el("viewer");
    var img = el("viewer-img");
    if (!viewer || !img || !src) return;
    img.setAttribute("src", src);
    img.setAttribute("alt", alt || "");
    if (typeof viewer.showModal === "function") viewer.showModal();
    else viewer.setAttribute("open", "open");
  }

  function closeViewer() {
    var viewer = el("viewer");
    if (!viewer) return;
    if (typeof viewer.close === "function") viewer.close();
    else viewer.removeAttribute("open");
    /* Dropped rather than left behind: a phone that has been through a few
       dishes should not be holding every photo it has opened. */
    var img = el("viewer-img");
    if (img) img.removeAttribute("src");
  }

  /* Delegated, because the strip is rebuilt for every dish. */
  (function wireViewer() {
    var strip = el("sheet-strip");
    if (strip) {
      strip.addEventListener("click", function (e) {
        var img = e.target && e.target.closest ? e.target.closest("img") : null;
        if (img) openViewer(img.getAttribute("src"), img.getAttribute("alt"));
      });
    }

    var single = el("sheet-img");
    if (single) {
      single.addEventListener("click", function () {
        openViewer(single.getAttribute("src"), single.getAttribute("alt"));
      });
    }

    var close = el("viewer-close");
    if (close) close.addEventListener("click", closeViewer);

    var viewer = el("viewer");
    if (viewer) {
      /* Tapping the dark around the photo closes it, the way every photo
         viewer a customer has already used does. The photo itself does not,
         or a mis-tap while looking shuts it. */
      viewer.addEventListener("click", function (e) {
        if (e.target === viewer) closeViewer();
      });
      /* Escape already closes a <dialog>; this clears the src with it. */
      viewer.addEventListener("close", function () {
        var img = el("viewer-img");
        if (img) img.removeAttribute("src");
      });
    }
  })();

  /**
   * Every photo of a dish, in a strip you push sideways.
   *
   * Falls back to the single cover image when a shop has uploaded only one,
   * which is most of them - and to nothing at all when there is none, rather
   * than an empty grey box. The old single <img> stays in the markup for
   * exactly that fallback, so a dish with one photo renders the way it always
   * did.
   */
  function showPhotos(item) {
    var gallery = el("sheet-gallery");
    var strip = el("sheet-strip");
    var single = el("sheet-img");

    var photos =
      item.photos && item.photos.length
        ? item.photos
        : item.image
          ? [item.image]
          : [];

    /*
     * No photo at all falls back to the generated icon.
     *
     * Most shops upload nothing, so this is the common case rather than the
     * edge one, and an empty grey box for every dish is worse than a drawn
     * symbol. Bigger here than on the card: the sheet has the room, and a dish
     * somebody has opened deserves more than a thumbnail.
     */
    var icon = el("sheet-icon");
    if (!photos.length) {
      gallery.hidden = true;
      single.hidden = true;
      if (icon) {
        icon.textContent = item.icon || "";
        icon.hidden = !item.icon;
      }
      return;
    }
    if (icon) icon.hidden = true;

    single.hidden = true;
    gallery.hidden = false;
    strip.setAttribute("data-count", String(photos.length));
    strip.innerHTML = photos
      .map(function (src, i) {
        /* Only the first is eager: the rest are off-screen until somebody
           pushes the strip, and a phone on a bad connection should not be
           paying for five photos of a dish nobody has opened. */
        return (
          '<img src="' +
          escapeHtml(src) +
          '" alt="' +
          escapeHtml(item.name) +
          (photos.length > 1
            ? ", photo " + (i + 1) + " of " + photos.length
            : "") +
          '" loading="' +
          (i === 0 ? "eager" : "lazy") +
          '" decoding="async">'
        );
      })
      .join("");

    var dots = el("sheet-dots");
    dots.hidden = photos.length < 2;
    dots.innerHTML = photos
      .map(function (_, i) {
        return '<span data-on="' + (i === 0 ? "true" : "false") + '"></span>';
      })
      .join("");

    strip.scrollLeft = 0;
    if (photos.length > 1) watchStrip(strip, dots);
  }

  /* Which photo is in front, from where the strip has been pushed to. No
     scroll handler recalculating positions every frame - the browser already
     knows, and asking it is free. */
  function watchStrip(strip, dots) {
    if (strip._watched) return;
    strip._watched = true;
    strip.addEventListener(
      "scroll",
      function () {
        var each = strip.scrollWidth / strip.children.length;
        var at = Math.round(strip.scrollLeft / each);
        [].forEach.call(dots.children, function (dot, i) {
          dot.setAttribute("data-on", i === at ? "true" : "false");
        });
      },
      { passive: true },
    );
  }

  /* ---------------------------------------------------------------- wire */

  document.addEventListener("click", function (e) {
    /*
     * A suggestion opens that dish, in place.
     *
     * Checked BEFORE the .dish handler below, because a suggestion sits inside
     * the open sheet and closest(".dish") would otherwise never see it - and
     * tapping one would do nothing at all, which is the kind of dead control
     * that makes a page feel broken rather than limited.
     */
    var goes = e.target.closest && e.target.closest(".goes");
    if (goes) {
      openSheet(goes.getAttribute("data-id"));
      return;
    }

    /*
     * The category chips, scrolled by hand.
     *
     * They are anchors to `#cat-<id>`, which is the right markup: a screen
     * reader announces a link to a section, and the headings are real targets.
     * But this page carries a <base href="/menu/"> so that its assets resolve
     * on a deep URL, and a base makes the browser resolve "#cat-x" against
     * IT - so on /menu/AZ100/venue/RC/123 a chip would navigate to /menu/ and
     * throw away both the branch and the room.
     *
     * Handling it here keeps the markup honest and the URL intact.
     */
    var chip = e.target.closest && e.target.closest(".cat");
    if (chip) {
      var target = document.getElementById(
        chip.getAttribute("href").replace(/^.*#/, ""),
      );
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.focus({ preventScroll: true });
      }
      return;
    }

    /* A card on the menu, or a row in the search results: both are the dish. */
    var dish =
      e.target.closest &&
      (e.target.closest(".dish") || e.target.closest(".result"));
    if (dish) {
      openSheet(dish.getAttribute("data-id"));
      return;
    }

    if (e.target.id === "sheet-close") {
      closeSheet();
      return;
    }

    /*
     * Tapping the dark outside the sheet closes it.
     *
     * A <dialog> element fills the whole viewport - the shade around the panel
     * IS the dialog, so a click landing on the dialog itself and not on
     * anything inside it means somebody tapped away. Every sheet a customer
     * has ever used behaves this way, and reaching for a small x with one
     * thumb does not.
     */
    if (e.target.id === "sheet") {
      closeSheet();
      return;
    }

    if (e.target.id === "search-clear") {
      el("search").value = "";
      applySearch("");
      el("search").focus();
    }
  });

  /**
   * What people order with this, from the shop's own last month of sales.
   *
   * ONLY IN THE SHEET. A suggestion under every card turns a menu into a shop
   * and doubles its length; a suggestion where somebody has already stopped to
   * read one dish is an answer to the question they are actually asking.
   *
   * Silent when there is nothing to say. A new shop has no sales behind it,
   * and inventing three dishes to fill the space would be recommending at
   * random - which a diner notices immediately and stops trusting.
   */
  /**
   * Everything else the shop has said about this dish.
   *
   * A customer who has opened a dish is deciding, and four things decide it:
   * whether they can eat it, when it is served, how long it will take, and
   * whether it is on right now. Each row appears only when the shop has
   * actually answered - a heading over an empty value is worse than a shorter
   * list, because it reads as a shop that could not be bothered.
   */
  function showFacts(item) {
    var list = el("sheet-facts");
    if (!list) return;

    var rows = [];

    /* The same four values the mark is drawn from. This read "nonveg" once,
       a key nothing writes, so a non-vegetarian dish showed no Diet row at
       all - on the one kind of dish where the answer matters most. */
    var diet = {
      veg: "Vegetarian",
      vegan: "Vegan",
      non_veg: "Non-vegetarian",
      egg: "Contains egg",
    }[item.diet];
    if (diet) rows.push(["Diet", diet]);

    /* "Breakfast and Lunch" is a reason to come back; a grey card is a dead
       end that reads as "they have run out". */
    var served = (item.served_in || []).filter(Boolean);
    if (served.length) rows.push(["Served at", served.join(", ")]);

    if (Number(item.prep_minutes) > 0) {
      rows.push(["Takes about", item.prep_minutes + " minutes"]);
    }

    rows.push([
      "Right now",
      item.available === false
        ? served.length
          ? "Not being served - " + served.join(" and ") + " only"
          : "Not available today"
        : "Available",
    ]);

    if (item.categoryName) rows.push(["Section", item.categoryName]);

    list.innerHTML = rows
      .map(function (pair) {
        return (
          "<dt>" +
          escapeHtml(pair[0]) +
          "</dt><dd>" +
          escapeHtml(pair[1]) +
          "</dd>"
        );
      })
      .join("");
    list.hidden = rows.length === 0;
  }

  function showGoesWith(item) {
    var box = el("goes-with");
    if (!box) return;

    var ids = item.goes_with || [];
    var row = ids
      .map(lookup)
      .filter(Boolean)
      /* Never suggest the dish somebody is already looking at. */
      .filter(function (other) {
        return String(other.id) !== String(item.id);
      })
      .slice(0, 3);

    if (!row.length) {
      box.hidden = true;
      return;
    }

    el("goes-row").innerHTML = row
      .map(function (other) {
        return (
          '<button type="button" class="goes" data-id="' +
          escapeHtml(other.id) +
          '">' +
          '<span class="goes-name">' +
          dietMark(other.diet) +
          " " +
          escapeHtml(other.name) +
          "</span>" +
          '<span class="goes-price">' +
          escapeHtml(money(other.price)) +
          "</span></button>"
        );
      })
      .join("");
    box.hidden = false;
  }

  el("search").addEventListener("input", function (e) {
    applySearch(e.target.value);
  });

  /* ------------------------------------------------------- filters and sort */

  function toggleFilter(id, key) {
    var button = el(id);
    if (!button) return;
    button.addEventListener("click", function () {
      state[key] = !state[key];
      button.setAttribute("aria-pressed", state[key] ? "true" : "false");
      applyView();
    });
  }

  toggleFilter("filter-veg", "vegOnly");
  toggleFilter("filter-available", "availableOnly");

  if (el("sort")) {
    el("sort").addEventListener("change", function (e) {
      state.sort = e.target.value;
      applyView();
    });
  }

  load();
})();
