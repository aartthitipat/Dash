/* main.js — จุดเริ่มระบบ: ตั้งวันที่, router, เรียก init ของแต่ละโมดูล
 * โมดูลที่ไม่มีใน FM ถูกข้ามอัตโนมัติ */
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
    // router ก่อนโมดูลอื่น: ตั้งหน้าที่แสดงตาม hash ก่อนโมดูลวาด
    if (FM.router && FM.router.init) {
      try {
        FM.router.init();
      } catch (e) {
        if (window.console) console.error(e);
      }
    }
    ['balance', 'slip', 'tasks', 'kpi', 'charts', 'txlist'].forEach(function (name) {
      var mod = FM[name];
      if (mod && typeof mod.init === 'function') {
        try {
          mod.init();
        } catch (e) {
          if (window.console) console.error(e);
        }
      }
    });
    // ซิงก์คลาวด์เริ่มหลังโมดูลอื่นพร้อมแล้ว (ต้องมี FM.tasks.reload และ listener ของโมดูลที่ฟัง tx/balance)
    if (FM.cloud && typeof FM.cloud.init === 'function') {
      try {
        FM.cloud.init();
      } catch (e) {
        if (window.console) console.error(e);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
