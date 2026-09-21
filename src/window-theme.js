/*
 * Dress a secondary window in the shop's own theme.
 *
 * Hardware Manager, the Cloud panel, Backup Manager and Software Update are
 * separate Electron windows. They have their own stylesheets and cannot see the
 * app's, so they were built with fixed colours - a blue-to-purple gradient, a
 * white card, dark text - which looked like a template rather than like the
 * product, and looked plainly wrong on a shop running a dark theme. Opening
 * Hardware Manager from a black till and being handed a bright blue page is the
 * kind of thing that makes software feel assembled rather than made.
 *
 * The main process keeps the last palette the app applied. This reads it and
 * publishes it as CSS variables on :root, so window-theme.css - and any rule in
 * the window's own stylesheet - can use the same tokens the app uses.
 *
 * Deliberately tolerant. A window that cannot reach the palette keeps whatever
 * its own stylesheet said, which is how these looked before this existed. A
 * settings window that fails to open because a colour was missing would be a
 * far worse trade than one that opens in the wrong blue.
 */
(function () {
  'use strict';

  var FALLBACK = {
    bodyBg: '#f2f3f7',
    cardBg: '#ffffff',
    topbarBg: '#ffffff',
    sidebarBg: '#ffffff',
    textPrimary: '#16203a',
    textSecondary: '#5b6577',
    borderColor: '#e5e7eb',
    primaryColor: '#506fe4',
  };

  /* WCAG relative luminance, to decide whether this is a dark theme. */
  function luminance(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    function channel(pair) {
      var c = parseInt(pair, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
  }

  function apply(palette) {
    var p = Object.assign({}, FALLBACK, palette || {});
    var root = document.documentElement;

    root.style.setProperty('--w-body-bg', p.bodyBg);
    root.style.setProperty('--w-card-bg', p.cardBg);
    root.style.setProperty('--w-header-bg', p.topbarBg);
    root.style.setProperty('--w-text', p.textPrimary);
    root.style.setProperty('--w-muted', p.textSecondary);
    root.style.setProperty('--w-border', p.borderColor);
    root.style.setProperty('--w-accent', p.primaryColor);
    root.style.setProperty('--w-font', p.fontFamily || "'DM Sans', 'Segoe UI', system-ui, sans-serif");
    var accentLuminance = luminance(p.primaryColor);
    root.style.setProperty('--w-on-accent', accentLuminance !== null && accentLuminance > 0.179 ? '#000000' : '#ffffff');

    /*
     * A raised surface, computed rather than sent.
     *
     * Dialogs need a shade between the page and a card - a hovered row, a tab
     * strip. Mixing the card with the text colour gives one that works whichever
     * direction the theme runs, instead of a hardcoded grey that disappears on
     * dark and shouts on light.
     */
    root.style.setProperty('--w-raised',
      'color-mix(in srgb, ' + p.cardBg + ' 92%, ' + p.textPrimary + ' 8%)');

    var dark = (luminance(p.bodyBg) !== null) && luminance(p.bodyBg) < 0.4;
    root.setAttribute('data-window-theme', dark ? 'dark' : 'light');
    root.style.setProperty('--w-success', dark ? '#86efac' : '#166534');
    root.style.setProperty('--w-danger', dark ? '#fca5a5' : '#b91c1c');
    root.style.setProperty('--w-danger-bg', dark ? '#381d25' : '#fff1f2');
    /* So a native control - a select, a scrollbar - is drawn to match. */
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  function start() {
    var kind = document.body.getAttribute('data-desktop-window');
    var header = document.querySelector('.header, .hdr-text');
    if (kind && header) {
      var eyebrow = document.createElement('span');
      eyebrow.className = 'desktop-eyebrow';
      eyebrow.textContent = kind === 'update' ? 'Updates & recovery' : 'This computer';
      header.prepend(eyebrow);
    }
    if (kind) {
      document.querySelectorAll('.header h1, .section-title, .tabs .tab').forEach(function (el) {
        el.textContent = el.textContent.replace(/^[^\p{L}\p{N}]+/u, '');
      });
      document.querySelectorAll('.tabs').forEach(function (tabs) {
        tabs.setAttribute('role', 'tablist');
        if (kind === 'hardware') tabs.setAttribute('aria-orientation', 'vertical');
        var buttons = Array.from(tabs.querySelectorAll('.tab'));
        buttons.forEach(function (button, i) {
          button.setAttribute('role', 'tab');
          button.id = button.id || 'desktop-tab-' + i;
          var call = /switchTab\('([^']+)'\)/.exec(button.getAttribute('onclick') || '');
          var target = call ? call[1] + 'Tab' : 'tab-' + button.getAttribute('data-tab');
          var panel = document.getElementById(target);
          if (panel) {
            button.setAttribute('aria-controls', target);
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', button.id);
          }
          function sync() {
            buttons.forEach(function (b) {
              var selected = b.classList.contains('active');
              b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1;
            });
          }
          button.addEventListener('click', function () { queueMicrotask(sync); });
          sync();
        });
        tabs.addEventListener('keydown', function (event) {
          var visible = buttons.filter(function (b) { return !b.disabled && b.style.display !== 'none' && !b.classList.contains('tab-disabled'); });
          var index = visible.indexOf(document.activeElement), next;
          if (index < 0) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % visible.length;
          if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + visible.length - 1) % visible.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = visible.length - 1;
          if (next === undefined) return;
          event.preventDefault(); visible[next].click(); visible[next].focus();
        });
      });
      if (kind === 'hardware' && typeof window.switchTab === 'function') {
        var section = location.hash.slice(1);
        if (section) window.switchTab(section);
        if (window.electronAPI && window.electronAPI.desktop && window.electronAPI.desktop.onNavigate) {
          var removeNavigation = window.electronAPI.desktop.onNavigate(function (target) { window.switchTab(target); });
          window.addEventListener('unload', removeNavigation, { once: true });
        }
      }
    }
    // A theme change applies to open windows as well as newly opened ones.
    if (window.electronAPI && window.electronAPI.theme && window.electronAPI.theme.onChange) {
      var unsubscribe = window.electronAPI.theme.onChange(apply);
      window.addEventListener('unload', unsubscribe, { once: true });
    }
    try {
      if (!window.electronAPI || !window.electronAPI.theme
          || !window.electronAPI.theme.palette) {
        apply(null);
        return;
      }
      window.electronAPI.theme.palette()
        .then(function (palette) { apply(palette); })
        .catch(function () { apply(null); });
    } catch (e) {
      apply(null);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Exposed so a window can re-apply after the shop changes theme with it open.
  window.applyWindowTheme = apply;
}());
