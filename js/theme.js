/* theme.js — สลับธีม light/dark, จำค่าใน fm.theme, ไม่มีค่า = ตามระบบ */
(function () {
  'use strict';

  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function systemTheme() {
    return mq && mq.matches ? 'dark' : 'light';
  }

  function current() {
    var saved = FM.get('theme', null);
    return saved === 'light' || saved === 'dark' ? saved : systemTheme();
  }

  function syncButton(theme) {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var dark = theme === 'dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', 'โหมดมืด');
  }

  function apply(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) FM.set('theme', theme);
    syncButton(theme);
    FM.emit('theme:changed', theme);
  }

  function init() {
    apply(current(), false);

    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
      });
    }

    if (mq) {
      var onSystem = function () {
        var saved = FM.get('theme', null);
        if (saved !== 'light' && saved !== 'dark') apply(systemTheme(), false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onSystem);
      else if (mq.addListener) mq.addListener(onSystem);
    }
  }

  FM.theme = { init: init, current: current };
})();
