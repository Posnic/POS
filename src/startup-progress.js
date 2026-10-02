'use strict';

// Progress is replaceable: queue only the latest update while the page loads.
function createStartupProgress() {
  const pending = new WeakMap();
  return function update(contents, values) {
    if (!contents || contents.isDestroyed()) return;
    const existing = pending.get(contents);
    if (existing) { existing.values = values; return; }
    const entry = { values };
    const flush = () => {
      contents.removeListener('did-stop-loading', flush);
      contents.removeListener('destroyed', cancel);
      pending.delete(contents);
      if (contents.isDestroyed()) return;
      const payload = entry.values.map(value => JSON.stringify(value)).join(',');
      contents.executeJavaScript(`window.updateStartupStatus?.(${payload})`).catch(() => {});
    };
    const cancel = () => {
      contents.removeListener('did-stop-loading', flush);
      pending.delete(contents);
    };
    if (contents.isLoadingMainFrame()) {
      pending.set(contents, entry);
      contents.once('did-stop-loading', flush);
      contents.once('destroyed', cancel);
    } else flush();
  };
}
module.exports = { createStartupProgress };
