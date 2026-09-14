#!/usr/bin/env node
'use strict';
/*
 * The audit page, with the phone frames inlined so the report is one file.
 *
 * Two runs of scripts/dev/shoot.cjs feed it: docs/journey (the state the audit
 * was written against) and docs/journey-after (the same walk once the findings
 * were acted on). Side by side, because a claim that a screen got better is
 * worth exactly as much as the two pictures next to each other.
 */
const fs = require('fs');
const path = require('path');

const BEFORE = path.resolve('docs/journey');
const AFTER = path.resolve('docs/journey-after');
const OUT = path.resolve('docs/journey-audit.html');

const data = (dir, name) => {
  const p = path.join(dir, name + '.png');
  if (!fs.existsSync(p)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
};

const shot = (dir, name, caption, tag) => {
  const src = data(dir, name);
  if (!src) return '';
  return `<figure class="frame">
      <div class="phone" data-tag="${tag}"><img src="${src}" alt="${caption}" loading="lazy"></div>
      <figcaption><b>${tag}</b> ${caption}</figcaption>
    </figure>`;
};

const was = (name, caption) => shot(BEFORE, name, caption, 'Was');
const now = (name, caption) => shot(AFTER, name, caption, 'Now');

const page = `<title>Ordering Journey Audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=Public+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #f7f5f0; --card: #fff; --ink: #1b1a17; --ink-soft: #5d5a51; --rule: #ddd8cd;
    --flag: #9c2b2b; --flag-wash: #f6e9e7; --fixed: #1d6a48; --fixed-wash: #e6f0ea;
    --display: "Newsreader", Georgia, serif;
    --body: "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  :root:not([data-theme="light"]) { color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #16150f; --card: #201e18; --ink: #f0ece1; --ink-soft: #a8a293; --rule: #35322a;
      --flag: #e8837a; --flag-wash: #2e1d1b; --fixed: #6fc79b; --fixed-wash: #14251c;
    }
  }
  :root[data-theme="dark"] {
    --paper: #16150f; --card: #201e18; --ink: #f0ece1; --ink-soft: #a8a293; --rule: #35322a;
    --flag: #e8837a; --flag-wash: #2e1d1b; --fixed: #6fc79b; --fixed-wash: #14251c;
  }
  body { background: var(--paper); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.6; padding-block: 0; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 0 20px 80px; }

  header.top { padding-block: 56px 32px; border-bottom: 2px solid var(--ink); }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 14px; }
  h1 { font-family: var(--display); font-weight: 600; font-size: clamp(34px, 7vw, 56px); line-height: 1.04; margin: 0 0 16px; text-wrap: balance; letter-spacing: -.015em; }
  .standfirst { font-size: 18px; color: var(--ink-soft); margin: 0; max-width: 62ch; }
  .method { margin: 26px 0 0; padding: 14px 16px; border-left: 3px solid var(--rule); font-size: 14px; color: var(--ink-soft); max-width: 70ch; }
  .method code, p code, footer code { font-size: 13px; background: var(--card); padding: 1px 5px; border-radius: 4px; }
  .tally { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 0; }
  .tally div { flex: 1 1 160px; padding: 14px 16px; background: var(--card); border: 1px solid var(--rule); border-radius: 10px; }
  .tally b { font-variant-numeric: tabular-nums; font-size: 24px; font-family: var(--display); font-weight: 600; display: block; line-height: 1.1; }
  .tally span { font-size: 12px; color: var(--ink-soft); letter-spacing: .04em; text-transform: uppercase; font-weight: 700; }

  section.finding { padding-block: 44px; border-bottom: 1px solid var(--rule); }
  .head { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
  .num { font-family: var(--display); font-size: 40px; line-height: 1; font-weight: 600; color: var(--rule); flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .head h2 { font-family: var(--display); font-weight: 600; font-size: clamp(23px, 4vw, 31px); line-height: 1.15; margin: 0; flex: 1 1 240px; text-wrap: balance; }
  .chip { flex: 0 0 auto; align-self: center; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px; background: var(--fixed-wash); color: var(--fixed); }

  .body { display: grid; grid-template-columns: 1fr; gap: 26px; margin-top: 22px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
  @media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
  .frame { margin: 0; }
  .phone { border: 2px solid var(--rule); border-radius: 16px; overflow: hidden; background: var(--card); box-shadow: 0 8px 26px rgba(0,0,0,.10); }
  .phone[data-tag="Was"] { border-color: var(--flag); }
  .phone[data-tag="Now"] { border-color: var(--fixed); }
  .phone img { display: block; width: 100%; height: auto; }
  figcaption { font-size: 12.5px; color: var(--ink-soft); margin-top: 9px; line-height: 1.45; }
  figcaption b { display: inline-block; margin-right: 5px; padding: 1px 7px; border-radius: 999px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; background: var(--flag-wash); color: var(--flag); }
  .frame:has(.phone[data-tag="Now"]) figcaption b { background: var(--fixed-wash); color: var(--fixed); }

  .says { background: var(--card); border: 1px solid var(--rule); border-left: 3px solid var(--flag); border-radius: 8px; padding: 13px 15px; margin: 0 0 16px; font-size: 15px; }
  .says strong { display: block; margin-bottom: 4px; }
  .says .btn { display: inline-block; margin-top: 9px; background: var(--ink); color: var(--paper); border-radius: 7px; padding: 6px 16px; font-size: 13px; font-weight: 700; }
  p { margin: 0 0 14px; max-width: 68ch; }
  .fixnote { margin-top: 4px; padding: 13px 15px; border-radius: 8px; background: var(--fixed-wash); border: 1px solid var(--rule); font-size: 14.5px; max-width: 68ch; }
  .fixnote b { color: var(--fixed); }

  .ruler { display: flex; gap: 18px; align-items: stretch; margin: 4px 0 16px; }
  .bars { flex: 0 0 76px; display: flex; flex-direction: column; height: 250px; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
  .bars i { display: block; font-style: normal; }
  .bars i.chrome { background: var(--flag-wash); border-bottom: 1px solid var(--rule); }
  .bars i.food { background: var(--fixed-wash); }
  .key { font-size: 13.5px; color: var(--ink-soft); align-self: center; }
  .key dl { margin: 0; display: grid; grid-template-columns: auto auto; gap: 3px 14px; font-variant-numeric: tabular-nums; }
  .key dt { color: var(--ink); }
  .key dd { margin: 0; text-align: right; }
  .key .sum { border-top: 1px solid var(--rule); padding-top: 5px; margin-top: 5px; font-weight: 700; color: var(--ink); }

  table { border-collapse: collapse; width: 100%; font-size: 14.5px; margin: 8px 0 0; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--rule); }
  th { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-soft); }
  td.state { white-space: nowrap; font-weight: 700; color: var(--fixed); }
  footer.end { padding-block: 40px 0; font-size: 14px; color: var(--ink-soft); }
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Online ordering &middot; walked on a phone, then fixed</p>
    <h1>The ordering journey, before and after</h1>
    <p class="standfirst">
      Seven findings from driving the journey on a real phone. All seven are now
      fixed and deployed. Each one below is the frame it was found in, beside the
      same screen today.
    </p>
    <p class="method">
      A real headless Chrome, driven through the real sandbox at 390&times;844,
      tapping what a customer taps. It installs nothing. Re-run with
      <code>node scripts/dev/shoot.cjs</code>. A tap that finds nothing is
      reported as a miss and the run carries on, because a missing control is
      itself a finding.
    </p>
    <div class="tally">
      <div><b>7</b><span>findings</span></div>
      <div><b>7</b><span>fixed</span></div>
      <div><b>440 &rarr; 330px</b><span>of chrome before any food</span></div>
      <div><b>5 &rarr; 1</b><span>controls on the voice screen</span></div>
    </div>
  </header>

  <section class="finding">
    <div class="head"><span class="num">01</span><h2>A dead end at the end of the journey</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div class="pair">
        ${was('17-payment-settled', 'The last screen before the order goes. The only button offered could never work.')}
        <div>
          <div class="says">
            <strong>&#9888; Order could not be completed</strong>
            Checkout failed (404): Table&nbsp;34 already has an open order. Add to it, or settle it first.
            <span class="btn">Retry order</span>
          </div>
          <p>The worst thing the walk found. Retry posts the same order to the same
            table and fails identically, for ever &mdash; a loop with no exit. A raw
            HTTP status shown to a diner. And it says &ldquo;Add to it&rdquo; while
            giving no way to add to it.</p>
          <p>The door that adds to an open order had been built on the <b>voice</b>
            path and only there: ordering by talking added to the order, ordering by
            tapping hit a wall.</p>
          <div class="fixnote"><b>Fixed.</b> The door now lives where every path to
            the kitchen passes. If this phone holds the open order, the basket is
            merged into it. If it does not, the order belongs to another diner: say
            so plainly and offer the menu, because Retry would still be a button that
            cannot work.</div>
        </div>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">02</span><h2>The voice screen offered the same thing five times</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div class="pair">
        ${was('13-on-the-line', 'An orb captioned &ldquo;Tap to talk&rdquo;, a button reading &ldquo;Tap to talk&rdquo;, &ldquo;Hold to talk&rdquo;, and &ldquo;Talk to order&rdquo; and &ldquo;Type instead&rdquo; beneath.')}
        ${now('12-talk-code', 'One control. Holding appears when there is a line to hold; the chooser never surfaces under a call.')}
      </div>
      <div>
        <p>Two causes, neither visible in the code. Opening the line opens the
          sheet, and the sheet offered talk-or-type &mdash; and the call marked itself
          active <em>after</em> opening the sheet, so the guard meant to prevent
          exactly this was always told no call was running.</p>
        <p>And tapping and holding are different moments: tapping <em>opens</em> the
          line, holding <em>speaks</em> into it. Both were on screen at once, with the
          orb captioning the button beneath it for good measure.</p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">03</span><h2>Half the first screen was furniture</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div class="pair">
        ${was('03-menu-clean', 'Three items fit, the third cut off. 440px of 844 spent before any food.')}
        ${now('03-menu-clean', 'Sorting joined the section strip; the heading that repeated the chip is gone.')}
      </div>
      <div>
        <div class="ruler">
          <div class="bars">
            <i class="chrome" style="flex:110"></i><i class="chrome" style="flex:100"></i>
            <i class="chrome" style="flex:70"></i><i class="chrome" style="flex:100"></i>
            <i class="chrome" style="flex:60"></i><i class="food" style="flex:404"></i>
          </div>
          <div class="key"><dl>
            <dt>Shop name, count, table, bag</dt><dd>110px</dd>
            <dt>Search</dt><dd>100px</dd>
            <dt>Sort, alone on its row</dt><dd>70px</dd>
            <dt>Category chips</dt><dd>100px</dd>
            <dt>Heading repeating the chip</dt><dd>60px</dd>
            <dt class="sum">Was, before any food</dt><dd class="sum">440px</dd>
            <dt class="sum">Now</dt><dd class="sum">330px</dd>
          </dl></div>
        </div>
        <p>The sort control and the repeated section heading were the two least
          useful things on the screen, and they sat above the food. Filters belong at
          the end of the section strip, which is where every menu worth copying puts
          them: the chips scroll, the tools stay put.</p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">04</span><h2>The first screen arrived covered in overlays</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div class="pair">
        ${was('02-menu-as-it-lands', 'The assistant callout sits on the search field &mdash; the most-used control on the page.')}
        ${now('02-menu-as-it-lands', 'The same arrival today.')}
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">05</span><h2>The basket wasted its lower half and clipped names</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div class="pair">
        ${was('08-basket', 'Name guillotined mid-character. Total twice. &ldquo;Clear the order&rdquo; large, red and centred in the empty half.')}
        ${now('15-basket-after', '&ldquo;Add more items&rdquo;, &ldquo;Going to Table&nbsp;34&rdquo;, one total, and clearing made quiet.')}
      </div>
      <div>
        <p><b>The name was guillotined, not truncated.</b> <code>text-overflow</code>
          acts on the box that holds the text, and the name lives in a span inside a
          flex row while the rules sat on the row &mdash; so the row clipped its child
          and no ellipsis was ever drawn. Measured after the fix on the real page:
          174px shown of the 294px the words want, ellipsis applied, and 116px of room
          to spare instead of spilling out of the row.</p>
        <p>It also had <b>no way back to the menu</b> (which matters most in a
          restaurant, where people order in rounds), <b>never said where the food was
          going</b> at the moment of committing, and showed the <b>total twice</b>.</p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">06</span><h2>One added item was counted in three places</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div class="pair">
        ${was('06-added-one', 'A badge on the bag, a badge on the chip (clipped by its own corner), and &ldquo;1 item&rdquo; in the bar.')}
        ${now('06-added-one', 'The bar carries it. The chip keeps its tint, which says something different.')}
      </div>
      <div>
        <p>Every ordering app worth copying keeps exactly one persistent basket
          summary. Here that is the bar: it carries the count, the money and the way
          forward. The bag keeps its badge because it is the way <em>back</em> from
          pages with no bar. The chip keeps its tint, because &ldquo;something of mine
          is in this section&rdquo; is a different fact from &ldquo;how many&rdquo;.</p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">07</span><h2>Names truncated before they informed</h2><span class="chip">Fixed</span></div>
    <div class="body">
      <div>
        <p>&ldquo;A5 Ruled Notebook 1 notebo&hellip;&rdquo;. The unit is baked into the
          name, so the line was spent on &ldquo;1 notebook&rdquo; and then ran out
          &mdash; while the description got two full lines and truncated mid-word
          anyway. <b>The card gave more room to filler than to the name of the thing
          being sold.</b></p>
        <p>Two lines for the name and one for the description now, which is the shape
          of every menu worth copying: somebody scanning a menu is reading names, and
          reads a description only once a name has caught them. And &ldquo;Add&rdquo;
          rather than &ldquo;ADD&rdquo; &mdash; uppercase on an 84px minimum made the
          button wider than the photograph it sat on.</p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">&mdash;</span><h2>And two things the walk did not find</h2></div>
    <div class="body">
      <div>
        <p>Both came from questions afterwards, and both were the same shape as
          finding 1: something built on one path and not the other.</p>
        <p><b>A cancellation inside the minute reached nobody.</b> Past the minute a
          customer <em>asks</em>, and that worked. Inside it the order simply goes, and
          the only thing ever told was the <b>printer</b>, over the desktop process
          bus &mdash; no badge, no chime, no row anywhere. It is the worse case,
          because the ticket printed the moment the order landed. It is now carried in
          the queue until a person has seen it.</p>
        <p><b>And the requests lived on a page.</b> A till is on the sale screen with
          people in front of it. They now come to it: a dock at the bottom right, on
          every screen, shut until tapped and absent when nothing is waiting. Each card
          says what it is, <b>how long ago the order was placed</b>, and the dish-level
          difference &mdash; &ldquo;Chicken Biryani: 2 &rarr; 3&rdquo;. Because
          &ldquo;cancel this?&rdquo; is a different question at forty seconds and at
          eleven minutes.</p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head"><span class="num">&mdash;</span><h2>Where it stands</h2></div>
    <table>
      <thead><tr><th>Finding</th><th>State</th></tr></thead>
      <tbody>
        <tr><td>1. Retry-order dead end at the same table</td><td class="state">Fixed</td></tr>
        <tr><td>2. Voice screen offering the same thing five times</td><td class="state">Fixed</td></tr>
        <tr><td>3. Half the first screen was furniture</td><td class="state">Fixed</td></tr>
        <tr><td>4. Callout landing on the search field</td><td class="state">Fixed</td></tr>
        <tr><td>5. Basket wasting its lower half, clipping names</td><td class="state">Fixed</td></tr>
        <tr><td>6. One item counted in three places</td><td class="state">Fixed</td></tr>
        <tr><td>7. Names truncating before they informed</td><td class="state">Fixed</td></tr>
        <tr><td>A cancellation inside the minute reaching nobody</td><td class="state">Fixed</td></tr>
        <tr><td>Requests living on a page instead of at the till</td><td class="state">Fixed</td></tr>
        <tr><td>A test helper silently returning functions with no body</td><td class="state">Fixed</td></tr>
      </tbody>
    </table>
  </section>

  <footer class="end">
    Frames from the develop sandbox at 390&times;844. Re-run with
    <code>node scripts/dev/shoot.cjs</code> then
    <code>node scripts/dev/build-audit-page.cjs</code>. The written version is
    <code>docs/ORDERING_JOURNEY_AUDIT.md</code>.
  </footer>
</div>
`;

fs.writeFileSync(OUT, page);
console.log('wrote ' + OUT + '  (' + Math.round(fs.statSync(OUT).size / 1024) + 'KB)');
