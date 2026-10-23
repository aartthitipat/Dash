/* router.js — hash routing (#/, #/tx, #/tasks) + ลิ้นชักสลิป/กล่องปรับยอด (FM.ui)
 * - สลับหน้าด้วย hidden ของ <section data-page> (ไม่ทำลาย DOM ของโมดูล)
 * - hash ที่ไม่ใช่ route (เช่น #access_token=… จากลิงก์เข้าสู่ระบบ) ไม่แตะ ปล่อยให้ cloud.js จัดการ
 * - emit 'route:changed' (ชื่อหน้า) หลังสลับหน้า ให้โมดูลที่ต้องวัดขนาดใหม่ฟังได้
 * ต้องโหลดต่อจาก store.js; main.js เรียก FM.router.init() ก่อน init โมดูลอื่น */
(function () {
  'use strict';

  var APP_NAME = 'การเงินและกิจวัตร';
  var ROUTES = {
    overview: { hash: '#/', title: 'ภาพรวม' },
    tx: { hash: '#/tx', title: 'รายการ' },
    tasks: { hash: '#/tasks', title: 'กิจวัตร' }
  };
  var PATHS = { '': 'overview', 'tx': 'tx', 'tasks': 'tasks' };
  var BOOT_MS = 900;

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  var current = null;
  var started = false;
  var els = { pages: [], links: [] };

  /* ---------- route parsing ---------- */
  // คืน { name, known, isRoute } — isRoute=false เมื่อ hash ไม่ได้ขึ้นต้นด้วย #/ (เช่น token ของ Supabase)
  function parse(hash) {
    var h = String(hash || '');
    if (h === '' || h === '#') return { name: 'overview', known: true, isRoute: true };
    if (h.indexOf('#/') !== 0) return { name: 'overview', known: true, isRoute: false };
    var path = h.slice(2).split(/[?#]/)[0].replace(/\/+$/, '');
    if (Object.prototype.hasOwnProperty.call(PATHS, path)) return { name: PATHS[path], known: true, isRoute: true };
    return { name: 'overview', known: false, isRoute: true };
  }

  /* ---------- view ---------- */
  function render(name, opts) {
    opts = opts || {};
    var changed = name !== current;
    current = name;

    els.pages.forEach(function (sec) {
      var on = sec.getAttribute('data-page') === name;
      if (on) {
        var wasHidden = sec.hidden;
        sec.hidden = false;
        if (wasHidden && opts.animate && !reducedMotion()) {
          sec.classList.remove('is-entering');
          void sec.offsetWidth; // เริ่ม animation ใหม่
          sec.classList.add('is-entering');
        }
      } else {
        sec.hidden = true;
        sec.classList.remove('is-entering');
      }
    });

    els.links.forEach(function (a) {
      if (a.getAttribute('data-route') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    var r = ROUTES[name];
    if (els.title) els.title.textContent = r.title;
    document.title = r.title + ' · ' + APP_NAME;

    if (changed) FM.emit('route:changed', name);
  }

  function onHashChange() {
    var p = parse(location.hash);
    if (!p.isRoute) return; // hash ของระบบอื่น (cloud.js ลบออกเอง)
    if (!p.known) {
      try { history.replaceState(history.state, '', ROUTES.overview.hash); } catch (e) {}
    }
    var name = p.name;
    if (name === current) return;
    endBoot();
    closeAll();
    render(name, { animate: true });
    try { window.scrollTo(0, 0); } catch (e) {}
    if (els.title) {
      try { els.title.focus({ preventScroll: true }); } catch (e) { els.title.focus(); }
    }
  }

  function endBoot() {
    if (els.main && els.main.hasAttribute('data-boot')) els.main.removeAttribute('data-boot');
  }

  function go(name) {
    if (!ROUTES[name]) name = 'overview';
    var target = ROUTES[name].hash;
    if (location.hash === target) return;
    location.hash = target;
  }

  /* ---------- dialogs (ลิ้นชักสลิป / ปรับยอด) ---------- */
  var dialogs = {};

  function setupDialog(key, id) {
    var dlg = document.getElementById(id);
    if (!dlg) return;
    var d = { el: dlg, trigger: null, closing: false, timer: 0 };
    dialogs[key] = d;

    // Esc: ปิดแบบมี animation แทนการปิดทันที
    dlg.addEventListener('cancel', function (e) {
      e.preventDefault();
      closeDialog(key);
    });

    dlg.addEventListener('click', function (e) {
      // คลิกพื้นหลัง (backdrop) = เป้าหมายคือ <dialog> เอง เพราะเนื้อหาเต็มกล่อง
      if (e.target === dlg) { closeDialog(key); return; }
      var btn = e.target.closest ? e.target.closest('[data-close]') : null;
      if (btn && dlg.contains(btn)) closeDialog(key);
    });

    // ปิดด้วยวิธีอื่นที่ไม่ผ่าน closeDialog (เช่น form method=dialog) — afterClose ทำซ้ำได้ไม่มีผลข้าง
    dlg.addEventListener('close', function () { afterClose(d); });
  }

  /* เก็บกวาดหลังปิด: เรียกแบบ synchronous จาก closeDialog (event 'close' เป็น async และอาจมาช้า) */
  function afterClose(d) {
    clearTimeout(d.timer);
    d.closing = false;
    d.el.classList.remove('is-closing');
    updateLock();
    var t = d.trigger;
    d.trigger = null;
    if (t && t !== document.body && t.isConnected && typeof t.focus === 'function') {
      try { t.focus({ preventScroll: true }); } catch (err) { t.focus(); }
    }
  }

  function updateLock() {
    var anyOpen = Object.keys(dialogs).some(function (k) { return dialogs[k].el.open; });
    document.documentElement.classList.toggle('is-locked', anyOpen);
  }

  function openDialog(key, trigger) {
    var d = dialogs[key];
    if (!d) return;
    var dlg = d.el;
    if (d.closing) {
      // เปิดซ้ำระหว่างกำลังปิด → ยกเลิกการปิด
      clearTimeout(d.timer);
      d.closing = false;
      dlg.classList.remove('is-closing');
      return;
    }
    if (dlg.open) return;
    var active = trigger || document.activeElement;
    d.trigger = active && active !== document.body ? active : null;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    updateLock();
  }

  function closeDialog(key, immediate) {
    var d = dialogs[key];
    if (!d || !d.el.open || d.closing) return;
    var dlg = d.el;
    function finish() {
      clearTimeout(d.timer);
      if (dlg.open) {
        if (typeof dlg.close === 'function') dlg.close();
        else dlg.removeAttribute('open');
      }
      afterClose(d);
    }
    if (immediate || reducedMotion()) { finish(); return; }
    d.closing = true;
    dlg.classList.add('is-closing');
    var done = false;
    function once(e) {
      if (e && e.target !== dlg) return;
      if (done) return;
      done = true;
      dlg.removeEventListener('animationend', once);
      if (d.closing) finish();
    }
    dlg.addEventListener('animationend', once);
    d.timer = setTimeout(once, 260); // สำรองกรณี animationend ไม่มา
  }

  // เปลี่ยนหน้าขณะเปิดอยู่ (เช่น ปุ่มย้อนกลับ): ปิดทันทีและไม่คืน focus เพราะ router จะย้าย focus ไป h1 เอง
  // (event 'close' มาแบบ async จึงต้องล้าง trigger ก่อน)
  function closeAll() {
    Object.keys(dialogs).forEach(function (k) {
      if (dialogs[k].el.open) dialogs[k].trigger = null;
      closeDialog(k, true);
    });
  }

  /* ---------- init ---------- */
  function init() {
    if (started) return;
    started = true;

    els.main = document.querySelector('.pages');
    els.title = document.getElementById('page-title');
    els.pages = Array.prototype.slice.call(document.querySelectorAll('[data-page]'));
    els.links = Array.prototype.slice.call(document.querySelectorAll('.rail__link[data-route]'));

    setupDialog('slip', 'slip-drawer');
    setupDialog('adjust', 'adjust-dialog');

    var slipBtn = document.getElementById('open-slip');
    if (slipBtn) slipBtn.addEventListener('click', function () { openDialog('slip', slipBtn); });

    var p = parse(location.hash);
    if (p.isRoute && !p.known) {
      try { history.replaceState(history.state, '', ROUTES.overview.hash); } catch (e) {}
    }
    render(p.name, { animate: false }); // โหลดครั้งแรก: ไม่ย้าย focus ไม่เล่น transition
    window.addEventListener('hashchange', onHashChange);
    setTimeout(endBoot, BOOT_MS);
  }

  window.FM = window.FM || {};
  FM.router = {
    init: init,
    go: go,
    current: function () { return current; }
  };
  FM.ui = {
    openSlip: function (trigger) { openDialog('slip', trigger); },
    closeSlip: function () { closeDialog('slip'); },
    openAdjust: function (trigger) { openDialog('adjust', trigger); },
    closeAdjust: function () { closeDialog('adjust'); }
  };
})();
