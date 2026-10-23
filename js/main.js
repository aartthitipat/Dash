/* main.js — จุดเริ่มระบบ: ตั้งวันที่, เรียก init ของแต่ละโมดูล */
(function () {
  'use strict';

  function setDate() {
    var el = document.getElementById('today-date');
    if (!el) return;
    var now = new Date();
    var text;
    try {
      text = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
      text = now.toDateString();
    }
    el.textContent = text;
  }

  function start() {
    setDate();
    if (FM.theme && FM.theme.init) FM.theme.init();
    ['balance', 'chart', 'slip', 'tasks'].forEach(function (name) {
      var mod = FM[name];
      if (mod && typeof mod.init === 'function') {
        try {
          mod.init();
        } catch (e) {
          if (window.console) console.error(e);
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
