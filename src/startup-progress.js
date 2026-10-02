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
function clearLoginRenderer(contents, targetUrl, logger = console) {
  const clean = () => {
    if (contents.isDestroyed() || contents.getURL() !== targetUrl) return;
    contents.executeJavaScript("localStorage.removeItem('posnic_jwt_token'); document.cookie = 'loginuser=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';")
      .catch(error => logger.warn('[Auth] Renderer token cleanup skipped:', error.message));
  };
  // loadPageAndReveal resolves at DOM-ready; executeJavaScript otherwise adds
  // another did-stop-loading waiter during Electron's navigation startup.
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', clean);
  else clean();
}
module.exports = { createStartupProgress, clearLoginRenderer };
