'use strict';

/*
 * Every start tag closes.
 *
 * The Restaurant settings page rendered empty on develop. Its pane's opening
 * tag ran over two lines, and a rebuild kept the first line only:
 *
 *   <div class="tab-pane fade" id="v-pills-tableorder" role="tabpanel"
 *       <!-- ... -->
 *       <ul class="nav nav-tabs ...">
 *
 * No ">" ever closed it. The browser kept reading the comment and the tab
 * strip as attributes of the div until it met a ">", and the page showed a
 * heading over nothing. Every guard on that pane counted "<div" tokens and
 * saw a perfectly balanced tree, because the tokens were all there. What was
 * missing was one character.
 *
 * So this reads every HTML source the app ships and asks the one question
 * those guards could not: does each start tag reach its ">" before the next
 * "<" begins? Quoted attribute values may contain either, and are skipped.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function htmlFiles() {
  const out = [];
  for (const dir of ['frontend', path.join('frontend', 'modules'), path.join('frontend', 'layouts')]) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (f.endsWith('.html')) out.push(path.join(dir, f));
    }
  }
  return out;
}

/** Start tags that never reach ">" before another "<" opens. */
function unclosedStartTags(html) {
  const found = [];
  /* a tag name, then attributes (quoted values may hold < or >), stopping at
     the next "<" - a healthy tag has its ">" inside that run */
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)(?:"[^"]*"|'[^']*'|[^<>"'])*?(?=<)/g;
  let m;
  while ((m = re.exec(html))) {
    /* a ">" inside a quoted value is text, not the end of the tag */
    if (m[0].replace(/"[^"]*"|'[^']*'/g, '').includes('>')) continue;
    const line = html.slice(0, m.index).split('\n').length;
    found.push(`${line}: <${m[1]}`);
  }
  return found;
}

test('the scanner sees a tag with no closing bracket', () => {
  /* The exact shape that shipped, so the guard is known to be looking at the
     right thing rather than passing on an empty regex. */
  const broken = '<div class="tab-pane fade" id="x" role="tabpanel"\n  <!-- note -->\n  <ul class="nav"></ul>\n</div>';
  assert.deepStrictEqual(unclosedStartTags(broken), ['1: <div']);
  const fine = '<div class="tab-pane fade" id="x" role="tabpanel"\n  aria-labelledby="x-tab">\n  <ul class="nav"></ul>\n</div>';
  assert.deepStrictEqual(unclosedStartTags(fine), []);
  /* a ">" inside a quoted attribute value is not a close */
  assert.deepStrictEqual(unclosedStartTags('<a title="a > b" href="#"\n<span>x</span>'), ['1: <a']);
});

test('every start tag in every shipped HTML file closes', () => {
  const files = htmlFiles();
  assert.ok(files.length > 20, `only ${files.length} html files found; has the layout moved?`);
  const offenders = [];
  for (const f of files) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const hit of unclosedStartTags(html)) offenders.push(`${f}:${hit}`);
  }
  assert.deepStrictEqual(offenders, [],
    'a start tag never closes, and the browser will swallow what follows into it:\n  ' + offenders.join('\n  '));
});
