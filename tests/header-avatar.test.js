const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/view.js', 'utf8');
const avatar = source.slice(source.indexOf('    var storedUserImage ='), source.indexOf("    $('.user-id').val"));
function setup(user, branch) {
  const dom = new JSDOM('<img id="user-image">', { runScripts: 'outside-only' });
  const w = dom.window, $ = require('jquery')(w);
  w.$ = $;
  w.PosnicPro = { local: { get: key => key === 'userimage' ? user : branch } };
  w.eval(avatar);
  return { w, $, image: $('#user-image') };
}
test('missing uploaded avatar falls back to branch then bundled avatar without changing saved values', () => {
  const { w, image } = setup('/uploads/missing.jpeg', '/uploads/shop.png');
  assert.equal(image.attr('src'), '/uploads/missing.jpeg');
  image.trigger('error');
  assert.equal(image.attr('src'), '/uploads/shop.png');
  image.trigger('error');
  assert.equal(image.attr('src'), 'static/images/default/user.svg');
  image.trigger('error');
  assert.equal(image.css('display'), 'none');
  assert.equal(w.PosnicPro.local.get('userimage'), '/uploads/missing.jpeg');
  w.close();
});
test('duplicate sources are skipped and refreshing the header replaces the fallback handler', () => {
  const { w, image } = setup('/uploads/shop.png', '/uploads/shop.png');
  w.eval(avatar);
  image.trigger('error');
  assert.equal(image.attr('src'), 'static/images/default/user.svg');
  assert.notEqual(image.css('display'), 'none');
  w.close();
});
test('default and legacy profile images preserve branch-logo preference', () => {
  for (const user of ['user.svg', null, 'http://localhost:5000/uploads/old.png']) {
    const { w, image } = setup(user, '/uploads/shop.png');
    assert.equal(image.attr('src'), '/uploads/shop.png');
    image.trigger('error');
    assert.equal(image.attr('src'), 'static/images/default/user.svg');
    w.close();
  }
});
