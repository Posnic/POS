"use strict";
/* Builds the audit page with the phone frames inlined, so the report is one
   self-contained file. */
const fs = require("fs");
const path = require("path");

const FRAMES = path.resolve("docs/journey");
const OUT = path.resolve("docs/journey-audit.html");

const data = (name) => {
  const p = path.join(FRAMES, name + ".png");
  if (!fs.existsSync(p)) throw new Error("missing frame: " + name);
  return "data:image/png;base64," + fs.readFileSync(p).toString("base64");
};

const shot = (name, caption) =>
  `<figure class="frame">
      <div class="phone"><img src="${data(name)}" alt="${caption}" loading="lazy"></div>
      <figcaption>${caption}</figcaption>
    </figure>`;

const page = `<title>Ordering Journey Audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Public+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #f7f5f0;
    --card: #ffffff;
    --ink: #1b1a17;
    --ink-soft: #5d5a51;
    --rule: #ddd8cd;
    --flag: #9c2b2b;
    --flag-wash: #f6e9e7;
    --fixed: #1d6a48;
    --fixed-wash: #e6f0ea;
    --display: "Newsreader", Georgia, "Times New Roman", serif;
    --body: "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  :root:not([data-theme="light"]) { color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #16150f;
      --card: #201e18;
      --ink: #f0ece1;
      --ink-soft: #a8a293;
      --rule: #35322a;
      --flag: #e8837a;
      --flag-wash: #2e1d1b;
      --fixed: #6fc79b;
      --fixed-wash: #14251c;
    }
  }
  :root[data-theme="dark"] {
    --paper: #16150f;
    --card: #201e18;
    --ink: #f0ece1;
    --ink-soft: #a8a293;
    --rule: #35322a;
    --flag: #e8837a;
    --flag-wash: #2e1d1b;
    --fixed: #6fc79b;
    --fixed-wash: #14251c;
  }

  body {
    background: var(--paper);
    color: var(--ink);
    font-family: var(--body);
    font-size: 16px;
    line-height: 1.6;
    padding-block: 0;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 20px 80px; }

  header.top { padding-block: 56px 34px; border-bottom: 2px solid var(--ink); margin-bottom: 6px; }
  .eyebrow {
    font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--ink-soft); margin: 0 0 14px;
  }
  h1 {
    font-family: var(--display); font-weight: 600; font-size: clamp(34px, 7vw, 56px);
    line-height: 1.05; margin: 0 0 16px; text-wrap: balance; letter-spacing: -0.015em;
  }
  .standfirst { font-size: 18px; color: var(--ink-soft); margin: 0; max-width: 62ch; }
  .method {
    margin: 26px 0 0; padding: 14px 16px; border-left: 3px solid var(--rule);
    font-size: 14px; color: var(--ink-soft); max-width: 70ch;
  }
  .method code { font-size: 13px; background: var(--card); padding: 1px 5px; border-radius: 4px; }

  .tally { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 0; }
  .tally b {
    font-variant-numeric: tabular-nums; font-size: 26px; font-family: var(--display); font-weight: 600;
    display: block; line-height: 1;
  }
  .tally div {
    flex: 1 1 150px; padding: 14px 16px; background: var(--card);
    border: 1px solid var(--rule); border-radius: 10px;
  }
  .tally span { font-size: 12px; color: var(--ink-soft); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 700; }

  section.finding { padding-block: 44px; border-bottom: 1px solid var(--rule); }
  .head { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
  .num {
    font-family: var(--display); font-size: 40px; line-height: 1; font-weight: 600;
    color: var(--rule); flex: 0 0 auto; font-variant-numeric: tabular-nums;
  }
  .head h2 {
    font-family: var(--display); font-weight: 600; font-size: clamp(23px, 4vw, 31px);
    line-height: 1.15; margin: 0; flex: 1 1 240px; text-wrap: balance;
  }
  .chip {
    flex: 0 0 auto; align-self: center; font-size: 11px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px;
  }
  .chip.open { background: var(--flag-wash); color: var(--flag); }
  .chip.done { background: var(--fixed-wash); color: var(--fixed); }

  .body { display: grid; grid-template-columns: 300px 1fr; gap: 30px; align-items: start; margin-top: 22px; }
  .body.wide { grid-template-columns: 1fr; }
  .body.pair { grid-template-columns: 300px 300px 1fr; }
  @media (max-width: 780px) { .body, .body.pair { grid-template-columns: 1fr; } }

  .frame { margin: 0; }
  .phone {
    border: 1px solid var(--rule); border-radius: 18px; overflow: hidden;
    background: var(--card); box-shadow: 0 8px 26px rgba(0,0,0,.10);
  }
  .phone img { display: block; width: 100%; height: auto; }
  figcaption { font-size: 12.5px; color: var(--ink-soft); margin-top: 9px; line-height: 1.45; }

  .says {
    background: var(--card); border: 1px solid var(--rule); border-left: 3px solid var(--flag);
    border-radius: 8px; padding: 13px 15px; margin: 0 0 16px; font-size: 15px;
  }
  .says strong { display: block; margin-bottom: 4px; }
  .says .btn {
    display: inline-block; margin-top: 9px; background: var(--ink); color: var(--paper);
    border-radius: 7px; padding: 6px 16px; font-size: 13px; font-weight: 700;
  }
  p { margin: 0 0 14px; max-width: 66ch; }
  ul { margin: 0 0 14px; padding-left: 20px; max-width: 66ch; }
  li { margin-bottom: 7px; }
  .fixnote {
    margin-top: 16px; padding: 13px 15px; border-radius: 8px;
    background: var(--fixed-wash); border: 1px solid var(--rule); font-size: 14.5px;
  }
  .fixnote b { color: var(--fixed); }

  /* The measurement that makes finding 3 undeniable: how much of the first
     screen is spent before any food. Drawn to scale, 844px tall. */
  .ruler { display: flex; gap: 16px; align-items: stretch; margin: 4px 0 0; }
  .bars { flex: 0 0 92px; display: flex; flex-direction: column; height: 300px; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
  .bars i { display: block; font-style: normal; }
  .bars i.chrome { background: repeating-linear-gradient(45deg, var(--flag-wash), var(--flag-wash) 5px, transparent 5px, transparent 10px); border-bottom: 1px solid var(--rule); }
  .bars i.food { background: var(--fixed-wash); }
  .key { font-size: 13.5px; color: var(--ink-soft); align-self: center; }
  .key dl { margin: 0; display: grid; grid-template-columns: auto auto; gap: 3px 12px; font-variant-numeric: tabular-nums; }
  .key dt { color: var(--ink); }
  .key dd { margin: 0; text-align: right; }
  .key .sum { border-top: 1px solid var(--rule); padding-top: 5px; margin-top: 5px; font-weight: 700; color: var(--ink); }

  table { border-collapse: collapse; width: 100%; font-size: 14.5px; margin: 8px 0 0; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--rule); }
  th { font-size: 11.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-soft); }
  td.state { white-space: nowrap; font-weight: 700; }
  td.state.done { color: var(--fixed); }
  td.state.open { color: var(--flag); }

  footer.end { padding-block: 40px 0; font-size: 14px; color: var(--ink-soft); }
  footer.end code { background: var(--card); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Online ordering &middot; evaluated on a phone</p>
    <h1>The ordering journey, walked and photographed</h1>
    <p class="standfirst">
      Every judgement about this bundle so far was made by reading code and asking
      what you saw. That is the wrong way round for a question about a journey:
      what is being judged is what a person meets, in order, on a phone.
    </p>
    <p class="method">
      A real headless Chrome was driven through the real sandbox at 390&times;844
      &mdash; an iPhone 14 &mdash; tapping what a customer taps, keeping every frame.
      It installs nothing. Re-run it with
      <code>node scripts/dev/shoot.cjs</code>. A tap that finds nothing is reported
      as a miss and the run carries on, because a missing control is itself a finding.
    </p>
    <div class="tally">
      <div><b>7</b><span>findings</span></div>
      <div><b>3</b><span>fixed today</span></div>
      <div><b>52%</b><span>of the first screen is furniture</span></div>
      <div><b>1</b><span>dead end with no exit</span></div>
    </div>
  </header>

  <section class="finding">
    <div class="head">
      <span class="num">01</span>
      <h2>A dead end at the end of the journey</h2>
      <span class="chip done">Fixed</span>
    </div>
    <div class="body">
      ${shot("17-payment-settled", "The last screen before the order goes. The only button offered cannot ever work.")}
      <div>
        <div class="says">
          <strong>&#9888; Order could not be completed</strong>
          Checkout failed (404): Table&nbsp;34 already has an open order. Add to it, or settle it first.
          <span class="btn">Retry order</span>
        </div>
        <p>This is the worst thing in the bundle. Three failures compounding:</p>
        <ul>
          <li><b>The only button offered cannot ever work.</b> Retry posts the same order
            to the same table and fails identically, for ever. A loop with no exit.</li>
          <li><b>A raw HTTP status is shown to a diner.</b> &ldquo;404&rdquo; means nothing to them.</li>
          <li><b>It says &ldquo;Add to it&rdquo; and gives no way to add to it.</b></li>
        </ul>
        <p>
          That last point is the real defect. The door that adds to an open order was
          built on the <em>voice</em> path and only there: ordering by talking added to
          the order, ordering by tapping hit a wall. Your one-order-per-table rule is
          right &mdash; two tickets on one table is usually somebody picking the wrong
          table &mdash; but a rule with no door beside it is a wall.
        </p>
        <div class="fixnote">
          <b>Fixed.</b> The door now lives where every path to the kitchen passes. If this
          phone holds the open order, the basket is merged into it, with quantities read
          back from the shop first. If it does not, the order belongs to another diner:
          say so in words and offer the menu, because Retry would still be a button that
          cannot work.
        </div>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">02</span>
      <h2>The voice sheet offers the same thing three times</h2>
      <span class="chip done">Fixed</span>
    </div>
    <div class="body pair">
      ${shot("12-talk-code", "Arriving on a code that says talk: an orb captioned &ldquo;Tap to talk&rdquo;, a button reading &ldquo;Tap to talk&rdquo;, and &ldquo;Hold to talk&rdquo; beneath it.")}
      ${shot("13-on-the-line", "While connecting, &ldquo;Talk to order&rdquo; and &ldquo;Type instead&rdquo; appear as well. Five controls for one job.")}
      <div>
        <p>Two separate causes, both invisible in the code:</p>
        <ul>
          <li><b>Starting a call reopened the chooser beneath it.</b> Opening the line
            opens the sheet, and the sheet offers talk-or-type. Worse, the call marked
            itself active <em>after</em> opening the sheet &mdash; so the guard meant to
            prevent exactly this was always told no call was running.</li>
          <li><b>Tapping and holding are different moments.</b> Tapping <em>opens</em>
            the line; holding <em>speaks</em> into it. Both were on screen at once, with
            the orb captioning the button beneath it for good measure.</li>
        </ul>
        <p>Note also the roughly 800&nbsp;pixels of empty space above the controls.</p>
        <div class="fixnote">
          <b>Fixed.</b> Holding appears when there is a line to hold. The orb stops
          repeating the button under it. The chooser never surfaces under a call.
        </div>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">03</span>
      <h2>Half the first screen is furniture</h2>
      <span class="chip open">Open</span>
    </div>
    <div class="body pair">
      ${shot("03-menu-clean", "The menu with every overlay dismissed. Three items fit; the third is cut off.")}
      <div>
        <div class="ruler">
          <div class="bars">
            <i class="chrome" style="flex: 110"></i>
            <i class="chrome" style="flex: 100"></i>
            <i class="chrome" style="flex: 70"></i>
            <i class="chrome" style="flex: 100"></i>
            <i class="chrome" style="flex: 60"></i>
            <i class="food" style="flex: 404"></i>
          </div>
          <div class="key">
            <dl>
              <dt>Shop name, count, table, bag</dt><dd>110px</dd>
              <dt>Search</dt><dd>100px</dd>
              <dt>Sort, alone on its row</dt><dd>70px</dd>
              <dt>Category chips</dt><dd>100px</dd>
              <dt>Heading repeating the chip</dt><dd>60px</dd>
              <dt class="sum">Before any food</dt><dd class="sum">440px</dd>
              <dt>Left for the menu</dt><dd>404px</dd>
            </dl>
          </div>
        </div>
      </div>
      <div>
        <p>
          Measured on the frame: <b>440 of 844 pixels &mdash; 52% &mdash; is spent
          before a single product.</b> Three items fit, the third half cut off.
        </p>
        <p>
          And the menu does not scroll the window; it scrolls inside an inner
          element. So the browser chrome never retracts and that 440px is permanent
          &mdash; on a real phone it is worse than this frame shows.
        </p>
        <p>
          Put plainly: <b>the sort control and the repeated section heading are the
          two least useful things on the screen, and they sit above the food.</b>
        </p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">04</span>
      <h2>The first screen arrives covered in overlays</h2>
      <span class="chip open">Open</span>
    </div>
    <div class="body">
      ${shot("02-menu-as-it-lands", "Untouched, as a customer meets it. The callout sits on the search field.")}
      <div>
        <p>
          The assistant&rsquo;s first-run callout &mdash; &ldquo;NEW &mdash; Ask me
          what&rsquo;s good, or just talk&rdquo; &mdash; lands <b>on top of the search
          field</b>, the single most-used control on the page.
        </p>
        <p>
          It is a good idea in the wrong place. The red panel below it is injected by
          the sandbox and never reaches a real shop, so discount that one &mdash; but
          the callout is ours.
        </p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">05</span>
      <h2>The basket wastes its lower half, and clips names mid-character</h2>
      <span class="chip open">Open</span>
    </div>
    <div class="body">
      ${shot("08-basket", "Content ends around 750px. Everything below is blank.")}
      <div>
        <ul>
          <li><b>The lower half of the screen is blank.</b></li>
          <li><b>The item name is clipped mid-character with no ellipsis</b>, running
            under the stepper: &ldquo;A5 Ruled Notebook 1 not&rdquo;.</li>
          <li><b>&ldquo;Clear the order&rdquo;</b> is large, red, centred and floating in
            that empty space &mdash; visually the second most prominent thing on the
            screen, and it is the destructive action.</li>
          <li><b>The total appears twice</b>, once in a card and once in the bar.</li>
          <li><b>No way to add more items</b> except the back arrow &mdash; which matters
            most in a restaurant, where people order in rounds.</li>
          <li><b>The table is not shown.</b> A customer cannot confirm where the food is
            going at the moment they commit to it.</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">06</span>
      <h2>One added item is counted in three places</h2>
      <span class="chip open">Open</span>
    </div>
    <div class="body">
      ${shot("06-added-one", "Adding one item: a badge on the bag, a badge on the chip, and &ldquo;1 item&rdquo; in the bar.")}
      <div>
        <p>
          Three counters for the same fact. The bottom bar is the right one &mdash; it
          carries the count, the money and the way forward. The other two are noise, and
          the chip badge is clipped by the chip&rsquo;s own rounded corner.
        </p>
        <p>
          The stepper also sits <b>on top of the product photo</b>, covering half of it,
          and is the widest element in the card.
        </p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">07</span>
      <h2>Product names truncate before they inform</h2>
      <span class="chip open">Open</span>
    </div>
    <div class="body wide">
      <div>
        <p>
          &ldquo;A5 Ruled Notebook 1 notebo&hellip;&rdquo;. &ldquo;White Envelopes 25
          envelop&hellip;&rdquo;. The unit is baked into the name, so the line is spent on
          &ldquo;1 notebook&rdquo; and then runs out &mdash; while the description gets two
          full lines and truncates mid-word anyway.
        </p>
        <p>
          <b>The card gives more room to filler than to the name of the thing being
          sold.</b> On a restaurant menu this is the difference between reading
          &ldquo;Chicken Biryani 1 handi&rdquo; and reading &ldquo;Chicken Biryani 1
          han&hellip;&rdquo;.
        </p>
      </div>
    </div>
  </section>

  <section class="finding">
    <div class="head">
      <span class="num">&mdash;</span>
      <h2>Where it stands</h2>
    </div>
    <table>
      <thead><tr><th>Finding</th><th>State</th></tr></thead>
      <tbody>
        <tr><td>1. Retry-order dead end at the same table</td><td class="state done">Fixed, 2 tests</td></tr>
        <tr><td>2. Voice sheet offering the same thing three times</td><td class="state done">Fixed, 2 tests</td></tr>
        <tr><td>A test helper silently returning functions with no body</td><td class="state done">Fixed, now asserts</td></tr>
        <tr><td>3. Half the first screen is furniture</td><td class="state open">Needs your call</td></tr>
        <tr><td>4. Callout lands on the search field</td><td class="state open">Needs your call</td></tr>
        <tr><td>5. Basket wastes its lower half, clips names</td><td class="state open">Needs your call</td></tr>
        <tr><td>6. One item counted in three places</td><td class="state open">Needs your call</td></tr>
        <tr><td>7. Names truncate before they inform</td><td class="state open">Needs your call</td></tr>
      </tbody>
    </table>
    <p style="margin-top:18px">
      Findings 3 to 7 are layout and information design on the two busiest screens in
      the product. They are real, and they are what &ldquo;reduce empty spaces&rdquo; has
      been pointing at. Each changes what every customer sees, so they want deciding
      rather than assuming.
    </p>
  </section>

  <footer class="end">
    Frames taken from the develop sandbox at 390&times;844. Re-run with
    <code>node scripts/dev/shoot.cjs</code>; every frame lands in <code>docs/journey/</code>.
    The written version is <code>docs/ORDERING_JOURNEY_AUDIT.md</code>.
  </footer>
</div>
`;

fs.writeFileSync(OUT, page);
console.log(
  "wrote " + OUT + "  (" + Math.round(fs.statSync(OUT).size / 1024) + "KB)",
);
