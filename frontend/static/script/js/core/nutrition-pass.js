/*
 * Filling in a menu's nutrition, one dish at a time, where it can be watched.
 *
 * Owner asked for nutrition on every dish and an assistant to fill it in "if
 * user lazy to do". The single-dish button on the item screen does exactly
 * that, one press at a time - which on the 272-dish menu of a real shop is
 * 272 presses. Left there the panel is empty in every shop in the estate, and
 * a feature that is empty everywhere may as well not exist. That is the whole
 * reason this file is here.
 *
 * WHY THE BROWSER WALKS THE LIST, AND NOT THE SERVER.
 *
 * A server-side job over three hundred dishes is a thing nobody can watch,
 * nobody can stop once it is spending the shop's money, and which has to
 * invent its own progress reporting and its own way of telling somebody it
 * finished. A loop here gets all of that for free: the bar is the truth
 * because it IS the loop, Stop means stop on the next dish, and closing the
 * window ends it. The cost is that it only runs while the page is open, which
 * for a job somebody chose to start and is watching is not a cost.
 *
 * WHAT IT WILL NOT DO. It writes estimates, and an estimate publishes nothing:
 * utils/dish-facts.js holds back every badge and even the calorie figure
 * until a person confirms the dish. A machine guessing its way onto a live
 * menu is the same harm as a tick box marked "Heart healthy" - it is just a
 * door that is harder to see.
 *
 * And it never touches a dish somebody has already answered. That is enforced
 * on the server (storeEstimatedDishFacts), not here, because this file is the
 * thing most likely to be got wrong later.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  /*
   * NO LOCAL t() WRAPPER HERE, ON PURPOSE.
   *
   * The i18n scanner reads literal `PosnicPro.i18n.t('lang_x', 'X')` calls
   * out of these files. A local helper hides every one of them, which is how
   * the requests dock ended up with its whole key set in no language pack -
   * it falls back to English everywhere and nothing ever failed to say so.
   * Every call below is spelled out so the keys are found and translated.
   */

  /* The dishes this run will ask about, and where it has got to. */
  var todo = [];
  var at = 0;
  var running = false;
  var stopped = false;
  var done = 0;
  var failed = 0;
  var skipped = 0;
  /* Why the run was halted, when something halted it. Kept because finish()
     runs immediately afterwards and would otherwise paint its summary over
     the only sentence that says what to do about it. */
  var halted = '';

  function el(id) {
    return document.getElementById(id);
  }

  function say(html) {
    var box = el('nutrition_pass_state');
    if (box) box.innerHTML = html;
  }

  function esc(v) {
    var d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }

  function note(name, what, ok) {
    var log = el('nutrition_pass_log');
    if (!log) return;
    var li = document.createElement('li');
    li.className = ok ? 'is-done' : 'is-missed';
    li.innerHTML = '<span>' + esc(name) + '</span><b>' + esc(what) + '</b>';
    log.insertBefore(li, log.firstChild);
    /* Only the last few. A list of three hundred rows is not a thing anybody
       reads, and keeping them all makes the modal scroll away from the bar. */
    while (log.children.length > 12) log.removeChild(log.lastChild);
  }

  function paintBar() {
    var wrap = el('nutrition_pass_bar_wrap');
    var bar = el('nutrition_pass_bar');
    if (!wrap || !bar) return;
    wrap.style.display = todo.length ? '' : 'none';
    var pct = todo.length ? Math.round((at / todo.length) * 100) : 0;
    bar.style.width = pct + '%';
    bar.textContent = pct + '%';
  }

  /*
   * What the button says it will do, with the number in it.
   *
   * "Run this over your menu" with no count in front of it is not a choice
   * anybody can make: this spends the shop's own AI balance once per dish.
   */
  function paintReady() {
    var go = el('nutrition_pass_go');
    if (!go) return;
    go.disabled = running || todo.length === 0;
    if (running) {
      go.textContent = PosnicPro.i18n.t('lang_working', 'Working...');
      return;
    }
    go.textContent = todo.length
      ? PosnicPro.i18n.t('lang_estimate_n_dishes', 'Estimate {n} dishes').replace('{n}', todo.length)
      : PosnicPro.i18n.t('lang_nothing_to_do', 'Nothing to do');
  }

  function look(categoryId) {
    say('<p class="text-muted">' + esc(PosnicPro.i18n.t('lang_reading_the_menu', 'Reading the menu...')) + '</p>');
    todo = [];
    at = 0;
    paintBar();
    paintReady();

    PosnicPro.get(
      'items/dishesWantingNutrition',
      categoryId ? { category_id: categoryId } : {},
      function (r) {
        todo = (r && r.data) || [];
        var already = todo.filter(function (d) {
          return d.estimated;
        }).length;
        say(
          '<p>' +
            esc(
              todo.length
                ? PosnicPro.i18n.t('lang_dishes_without_nutrition', '{n} dishes have no nutrition yet.').replace(
                    '{n}',
                    todo.length
                  )
                : PosnicPro.i18n.t('lang_every_dish_answered', 'Every dish here has been answered already.')
            ) +
            '</p>' +
            (already
              ? '<p class="text-muted">' +
                esc(
                  PosnicPro.i18n.t(
                    'lang_of_those_estimated',
                    '{n} of those were estimated before and are still waiting for you to confirm them.'
                  ).replace('{n}', already)
                ) +
                '</p>'
              : '')
        );
        paintReady();
      },
      function () {
        say(
          '<p class="text-danger">' +
            esc(PosnicPro.i18n.t('lang_could_not_read_menu', 'Could not read the menu.')) +
            '</p>'
        );
        paintReady();
      }
    );
  }

  /*
   * One dish, then the next.
   *
   * Sequential on purpose. Three hundred requests in flight would take the
   * shop's AI provider rate limit down on the first try, and the whole point
   * of the bar is that somebody can see it moving and stop it.
   */
  function step() {
    if (stopped || at >= todo.length) return finish();

    var dish = todo[at];
    at += 1;
    paintBar();

    PosnicPro.post(
      {
        url: 'items/aiDishFactsFor',
        data: JSON.stringify({
          item_id: dish.item_id,
          name: dish.name,
          category_name: dish.category_name,
          description: dish.description,
          diet: dish.diet,
        }),
      },
      function (response) {
        if (response && response.type === 'success') {
          if (response.data && response.data.skipped) {
            skipped += 1;
            note(dish.name, PosnicPro.i18n.t('lang_left_alone', 'left alone'), true);
          } else {
            done += 1;
            var kcal = response.data && response.data.nutrition && response.data.nutrition.kcal;
            note(dish.name, kcal ? kcal + ' kcal' : PosnicPro.i18n.t('lang_stored', 'stored'), true);
          }
        } else {
          failed += 1;
          note(dish.name, (response && response.message) || PosnicPro.i18n.t('lang_no_answer', 'no answer'), false);
        }
        step();
      },
      function (xhr) {
        failed += 1;
        var why = PosnicPro.i18n.t('lang_no_answer', 'no answer');
        try {
          var body = JSON.parse((xhr && xhr.responseText) || '{}');
          if (body && body.message) why = body.message;
        } catch (e) {
          /* the default sentence is the fallback */
        }
        note(dish.name, why, false);

        /*
         * A REFUSAL STOPS THE WHOLE RUN, IT DOES NOT PLOUGH ON.
         *
         * 400 from this route means the shop's AI is refusing - no key, the
         * provider is down, the monthly cap is spent. Every remaining dish
         * would fail the same way, and asking three hundred times in a row is
         * how a rate limit becomes a ban.
         */
        if (xhr && xhr.status === 400) {
          stopped = true;
          halted = why;
        }
        step();
      }
    );
  }

  function finish() {
    running = false;
    var stop = el('nutrition_pass_stop');
    if (stop) stop.style.display = 'none';
    paintBar();
    paintReady();

    var parts = [PosnicPro.i18n.t('lang_n_dishes_estimated', '{n} estimated').replace('{n}', done)];
    if (skipped) parts.push(PosnicPro.i18n.t('lang_n_left_alone', '{n} left alone').replace('{n}', skipped));
    if (failed) parts.push(PosnicPro.i18n.t('lang_n_could_not', '{n} could not be done').replace('{n}', failed));

    /*
     * THE REASON COMES FIRST, WHEN THERE IS ONE.
     *
     * Driving the loop caught this: a refusal set the message and finish()
     * painted straight over it, so a shop with no AI key was told "Stopped.
     * 1 could not be done" and never learned why - which is the most likely
     * reason it stops and the one with an obvious fix. Every test passed,
     * because they all read the source rather than running it.
     */
    say(
      (halted ? '<p class="text-danger">' + esc(halted) + '</p>' : '') +
      '<p><strong>' +
        esc(stopped ? PosnicPro.i18n.t('lang_run_stopped', 'Stopped.') : PosnicPro.i18n.t('lang_finished', 'Finished.')) +
        '</strong> ' +
        esc(parts.join(', ')) +
        '</p>' +
        '<p class="text-muted">' +
        esc(
          PosnicPro.i18n.t(
            'lang_confirm_before_they_show',
            'These are estimates. Open a dish, check the numbers and save it, and its badges appear on the menu.'
          )
        ) +
        '</p>'
    );
  }

  function start() {
    if (running || !todo.length) return;
    running = true;
    stopped = false;
    halted = '';
    at = 0;
    done = 0;
    failed = 0;
    skipped = 0;
    var log = el('nutrition_pass_log');
    if (log) log.innerHTML = '';
    var stop = el('nutrition_pass_stop');
    if (stop) stop.style.display = '';
    say('<p>' + esc(PosnicPro.i18n.t('lang_working', 'Working...')) + '</p>');
    paintReady();
    step();
  }

  /*
   * The same list, from the same endpoint, that every other tool on this
   * screen uses. There is no in-memory catalogue of categories to read from -
   * an earlier draft of this invented one, which would have quietly rendered
   * an empty picker on every shop.
   */
  /* Takes the select's id: two screens use this now, and a version that
     hard-wired one of them would have filled the pass's picker while the
     review screen sat with nothing but "The whole menu" - correct-looking
     and wrong. */
  function fillCategories(intoId) {
    var sel = el(intoId || 'nutrition_pass_category');
    if (!sel) return;
    var all = '<option value="">' + esc(PosnicPro.i18n.t('lang_the_whole_menu', 'The whole menu')) + '</option>';
    sel.innerHTML = all;

    PosnicPro.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (response) {
      sel.innerHTML =
        all +
        ((response && response.suggestions) || [])
          .map(function (c) {
            return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
          })
          .join('');
    });
  }

  /* ------------------------------------------------------------------
   * CHECKING WHAT WAS GUESSED.
   *
   * The pass made estimating a menu cheap and left confirming it at one dish
   * at a time, which on 272 dishes is the same 272 presses moved one step
   * along. This is the other half, and confirming is the only thing that
   * publishes a badge.
   * ------------------------------------------------------------------ */

  var estimates = [];

  function sayReview(html) {
    var box = el('nutrition_review_state');
    if (box) box.innerHTML = html;
  }

  /* The claim words in the shop's language. The customer menu keeps its own
     dictionary for the same keys; this is the till's side of it. */
  function claimWord(key) {
    var words = {
      high_protein: PosnicPro.i18n.t('lang_claim_high_protein', 'High protein'),
      protein_source: PosnicPro.i18n.t('lang_claim_protein_source', 'Source of protein'),
      low_fat: PosnicPro.i18n.t('lang_claim_low_fat', 'Low fat'),
      high_fibre: PosnicPro.i18n.t('lang_claim_high_fibre', 'High fibre'),
      keto_friendly: PosnicPro.i18n.t('lang_claim_keto_friendly', 'Keto friendly'),
      low_carb: PosnicPro.i18n.t('lang_claim_low_carb', 'Low carb'),
      diabetic_friendly: PosnicPro.i18n.t('lang_claim_diabetic_friendly', 'Diabetic friendly'),
      heart_healthy: PosnicPro.i18n.t('lang_claim_heart_healthy', 'Heart healthy'),
      under_300: PosnicPro.i18n.t('lang_claim_under_300', 'Under 300 kcal'),
      under_500: PosnicPro.i18n.t('lang_claim_under_500', 'Under 500 kcal'),
      no_added_sugar: PosnicPro.i18n.t('lang_claim_no_added_sugar', 'No added sugar')
    };
    return words[key] || key;
  }

  /*
   * THE BADGES LEAD, NOT THE NUMBERS.
   *
   * A shop scanning calorie figures is being asked to check arithmetic it has
   * no way to check. A shop reading "Grilled Chicken - High protein, Heart
   * healthy" is being asked the question it can actually answer: is that
   * sentence true of my food? Those badges are exactly what confirming
   * publishes, so they are what the row leads with.
   */
  function reviewRow(d) {
    var n = d.nutrition || {};
    var kcal = n.kcal ? Math.round(n.kcal) + ' kcal' : '';
    var macros = ['protein_g', 'carbs_g', 'fat_g']
      .filter(function (k) { return typeof n[k] === 'number'; })
      .map(function (k) { return n[k] + 'g'; })
      .join(' / ');

    var badges = (d.claims || []).map(function (c) {
      return '<span class="nutrition-review-claim">' + esc(claimWord(c)) + '</span>';
    }).join('');

    return '<label class="nutrition-review-row">' +
      '<input type="checkbox" class="nutrition-review-tick" value="' + esc(d.item_id) + '" checked>' +
      '<span class="nutrition-review-name">' + esc(d.name) +
        '<small>' + esc(d.category_name) + '</small></span>' +
      '<span class="nutrition-review-numbers">' + esc(kcal) +
        (macros ? '<small>' + esc(macros) + '</small>' : '') + '</span>' +
      '<span class="nutrition-review-claims">' +
        (badges || '<em class="nutrition-review-none">' +
          esc(PosnicPro.i18n.t('lang_no_badges_earned', 'no badges')) + '</em>') +
      '</span>' +
    '</label>';
  }

  function paintReviewCount() {
    var button = el('nutrition_review_confirm');
    if (!button) return;
    var ticked = document.querySelectorAll('.nutrition-review-tick:checked').length;
    button.disabled = ticked === 0;
    button.textContent = ticked
      ? PosnicPro.i18n.t('lang_confirm_n_dishes', 'Confirm {n} dishes').replace('{n}', ticked)
      : PosnicPro.i18n.t('lang_confirm_checked', 'Confirm the ticked dishes');
  }

  function loadReview(categoryId) {
    var rows = el('nutrition_review_rows');
    if (rows) rows.innerHTML = '';
    sayReview('<p class="text-muted">' +
      esc(PosnicPro.i18n.t('lang_reading_the_menu', 'Reading the menu...')) + '</p>');

    PosnicPro.get(
      'items/estimatedDishes',
      categoryId ? { category_id: categoryId } : {},
      function (r) {
        estimates = (r && r.data) || [];
        if (!estimates.length) {
          sayReview('<p>' + esc(PosnicPro.i18n.t(
            'lang_nothing_waiting_to_check',
            'Nothing is waiting to be checked here.'
          )) + '</p>');
          paintReviewCount();
          return;
        }
        sayReview('<p>' + esc(PosnicPro.i18n.t(
          'lang_n_estimates_waiting',
          '{n} dishes were estimated and are on no menu yet.'
        ).replace('{n}', estimates.length)) + '</p>');
        if (rows) rows.innerHTML = estimates.map(reviewRow).join('');
        paintReviewCount();
      },
      function () {
        sayReview('<p class="text-danger">' +
          esc(PosnicPro.i18n.t('lang_could_not_read_menu', 'Could not read the menu.')) + '</p>');
      }
    );
  }

  function confirmTicked() {
    var ids = [].slice.call(document.querySelectorAll('.nutrition-review-tick:checked'))
      .map(function (box) { return box.value; });
    if (!ids.length) return;

    var button = el('nutrition_review_confirm');
    if (button) button.disabled = true;

    PosnicPro.post(
      { url: 'items/confirmNutrition', data: JSON.stringify({ item_ids: ids }) },
      function (response) {
        if (response && response.type === 'success') {
          PosnicPro.alert('success', response.message);
          /* Read back rather than striking the rows out here. A dish somebody
             answered by hand in the meantime was skipped on the server, and
             the screen should show what is actually left rather than what
             this page assumed happened. */
          loadReview((el('nutrition_review_category') || {}).value || '');
          return;
        }
        if (button) button.disabled = false;
        PosnicPro.alert('warning', (response && response.message) ||
          PosnicPro.i18n.t('lang_could_not_confirm', 'Could not confirm those dishes'));
      },
      function () {
        if (button) button.disabled = false;
        PosnicPro.alert('warning',
          PosnicPro.i18n.t('lang_could_not_confirm', 'Could not confirm those dishes'));
      }
    );
  }

  window.PosnicPro = window.PosnicPro || {};
  PosnicPro.nutritionPass = {
    /*
     * OPENED, THEN TOLD.
     *
     * The single-dish button hides itself when the shop has no AI key,
     * because a hidden button on a form nobody is studying costs nothing. A
     * menu entry cannot do that here: the only place that asks about
     * availability is the item FORM, and this lives on the item LIST, so a
     * gate written the same way would have been dead code and the entry
     * would have been hidden on every shop forever.
     *
     * So it stays visible for a restaurant and answers honestly when opened.
     * A control that explains why it cannot help beats one that silently
     * is not there - especially when the fix is "paste your key in Settings",
     * which nobody goes looking for on their own.
     */
    open: function () {
      if (window.jQuery) jQuery('#nutrition_pass_modal').modal('show');
      var go = el('nutrition_pass_go');
      if (go) go.disabled = true;

      PosnicPro.get(
        'items/aiAvailability',
        {},
        function (r) {
          if (!(r && r.data && r.data.available)) {
            say(
              '<p class="text-danger">' +
                esc(
                  PosnicPro.i18n.t(
                    'lang_no_ai_key_for_pass',
                    'This shop has no AI provider set up yet. Add a provider and key under Settings, AI, and this can fill in the whole menu.'
                  )
                ) +
                '</p>'
            );
            return;
          }
          fillCategories();
          look('');
        },
        function () {
          say(
            '<p class="text-danger">' +
              esc(PosnicPro.i18n.t('lang_could_not_read_menu', 'Could not read the menu.')) +
              '</p>'
          );
        }
      );
    },
    look: look,
    start: start,
    review: function () {
      if (window.jQuery) jQuery('#nutrition_review_modal').modal('show');
      fillCategories('nutrition_review_category');
      loadReview('');
    },
    loadReview: loadReview,
    stop: function () {
      stopped = true;
    },
    /* For the tests, and for anybody wondering what it thinks it is doing. */
    state: function () {
      return { todo: todo.length, at: at, running: running, done: done, failed: failed, skipped: skipped };
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', function (e) {
      var target = e.target && e.target.closest ? e.target.closest('#nutrition_pass_go, #nutrition_pass_stop') : null;
      if (!target) return;
      e.preventDefault();
      if (target.id === 'nutrition_pass_go') start();
      else PosnicPro.nutritionPass.stop();
    });

    document.addEventListener('change', function (e) {
      if (!e.target) return;
      if (e.target.id === 'nutrition_pass_category') return look(e.target.value || '');
      if (e.target.id === 'nutrition_review_category') return loadReview(e.target.value || '');
      if (e.target.classList && e.target.classList.contains('nutrition-review-tick')) {
        paintReviewCount();
      }
    });

    document.addEventListener('click', function (e) {
      var go = e.target && e.target.closest ? e.target.closest('#nutrition_review_confirm') : null;
      if (!go) return;
      e.preventDefault();
      confirmTicked();
    });
  });
})();
