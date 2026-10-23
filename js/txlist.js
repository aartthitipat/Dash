/* txlist.js — หน้า #/tx: รายการรับ-จ่ายทั้งหมด (ใหม่→เก่า), ตัวกรอง ทั้งหมด/รายรับ/รายจ่าย (จำใน fm.txFilter),
 * ปุ่ม "บวกเพิ่ม" (เปิดกล่องปรับยอดของ balance.js ผ่าน FM.ui.openAdjust), ลบรายการ = ย้อนยอดเงิน
 * - แสดงทีละ 50 แถว + ปุ่ม "แสดงเพิ่ม" (ไม่มี infinite scroll)
 * - เขียน fm.balance / fm.tx แล้ว emit 'balance:changed' ตามด้วย 'tx:changed'; ข้าม event ของตัวเอง (emitting)
 *   และวาดใหม่จาก storage เมื่อโมดูลอื่น (สลิป / ปรับยอด / ซิงก์) แก้รายการ
 * - tx เก่าที่ไม่มี category แสดง "ไม่ระบุ" (FM.cats.label) */
(function () {
  'use strict';

  var CHUNK = 50;
  var LEAVE_MS = 200;
  var FILTER_KEY = 'txFilter';
  var FILTERS = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'income', label: 'รายรับ' },
    { key: 'expense', label: 'รายจ่าย' }
  ];
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var els = {};
  var filter = 'all';
  var limit = CHUNK;
  var emitting = false;   // กัน listener ของตัวเองทำงานซ้ำตอน emit
  var busy = false;       // กำลังเล่น animation ลบแถว (เลื่อนการวาดใหม่ไว้ก่อน)

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  /* ---------- state ---------- */
  function round2(x) { return Math.round(x * 100) / 100; }

  function readBalance() {
    var n = Number(FM.get('balance', 0));
    return isFinite(n) ? n : 0;
  }

  function readTx() {
    var arr = FM.get('tx', []);
    return Array.isArray(arr) ? arr : [];
  }

  function isValidTx(t) {
    return !!t && (t.type === 'income' || t.type === 'expense') && isFinite(Number(t.amount)) &&
      (typeof t.id === 'string' || typeof t.id === 'number');
  }

  function readFilter() {
    var f = FM.get(FILTER_KEY, 'all');
    for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i].key === f) return f;
    return 'all';
  }

  /* ใหม่→เก่า ตาม ts แล้วตาม id (id ของ FM.uid ขึ้นต้นด้วยเวลา จึงเรียงมาก→น้อยให้สอดคล้อง) */
  function sorted() {
    return readTx().filter(isValidTx).sort(function (a, b) {
      var d = (Number(b.ts) || 0) - (Number(a.ts) || 0);
      if (d) return d;
      var ia = String(a.id);
      var ib = String(b.id);
      return ia < ib ? 1 : ia > ib ? -1 : 0;
    });
  }

  function persist(balance, tx) {
    var ok1 = FM.set('balance', balance);
    var ok2 = FM.set('tx', tx);
    if (FM.storageOk && (!ok1 || !ok2)) {
      els.notice.textContent = 'บันทึกข้อมูลไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็ม ข้อมูลล่าสุดอาจหายเมื่อรีโหลด';
      els.notice.hidden = false;
    } else {
      els.notice.hidden = true; // เขียนสำเร็จแล้ว → คำเตือนเก่าไม่จริงอีกต่อไป
    }
    emitting = true;
    try {
      FM.emit('balance:changed', balance);
      FM.emit('tx:changed', tx);
    } finally {
      emitting = false;
    }
  }

  /* ---------- เวลาแบบไทย (สำเนาส่วนตัว — ไม่ประกาศเป็น global) ---------- */
  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtWhen(ts) {
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var t = d.getTime();
    if (t >= startToday && t < startToday + 864e5) return hm + ' วันนี้';
    if (t >= startToday - 864e5 && t < startToday) return hm + ' เมื่อวาน';
    var s = d.getDate() + ' ' + TH_MONTHS[d.getMonth()];
    if (d.getFullYear() !== now.getFullYear()) s += ' ' + (d.getFullYear() + 543);
    return s;
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(d, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  }

  var ICON_TRASH = 'M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2';
  var ICON_PLUS = 'M12 5v14M5 12h14';

  function catLabel(t) {
    return FM.cats ? FM.cats.label(t.type, t.category) : 'ไม่ระบุ';
  }

  /* ---------- rows ---------- */
  function buildRow(t) {
    var income = t.type === 'income';
    var amt = Math.abs(Number(t.amount));
    var money = FM.fmtMoney(amt);
    var typeText = income ? 'รายรับ' : 'รายจ่าย';
    var cat = catLabel(t);
    var when = fmtWhen(t.ts);

    var li = el('li', 'txl__row ' + (income ? 'is-income' : 'is-expense'));
    li.setAttribute('data-id', String(t.id));

    var glyph = el('span', 'txl__glyph num', income ? '+' : '−');
    glyph.setAttribute('aria-hidden', 'true');

    var main = el('div', 'txl__main');
    var line = el('p', 'txl__line');
    var catEl = el('span', 'txl__cat');
    catEl.appendChild(el('span', 'txl__sr', typeText + ' '));
    catEl.appendChild(document.createTextNode(cat));
    // U+2060 (word joiner) กันไม่ให้เครื่องหมาย +/− ถูกตัดแยกบรรทัดจากตัวเลข
    var amount = el('span', 'txl__amount num', (income ? '+' : '−') + '⁠' + money);
    line.appendChild(catEl);
    line.appendChild(amount);

    var meta = el('p', 'txl__meta');
    meta.appendChild(document.createTextNode((t.source === 'slip' ? 'สลิป' : 'กรอกเอง') + (when ? ' · ' : '')));
    if (when) meta.appendChild(el('span', 'num', when));
    main.appendChild(line);
    main.appendChild(meta);

    var del = el('button', 'icon-btn txl__del');
    del.type = 'button';
    del.setAttribute('aria-label', 'ลบรายการ ' + typeText + ' ' + cat + ' ' + money + (when ? ' ' + when : ''));
    del.appendChild(icon(ICON_TRASH, 18));
    del.addEventListener('click', function () { removeTx(String(t.id), li); });

    li.appendChild(glyph);
    li.appendChild(main);
    li.appendChild(del);
    return li;
  }

  function summaryText(shown, total) {
    if (!total) return '';
    if (shown < total) return 'แสดง ' + shown + ' จาก ' + total + ' รายการ';
    return 'แสดง ' + total + ' รายการ';
  }

  function emptyText(hasAny) {
    if (!hasAny) return 'ยังไม่มีรายการ บันทึกจากสลิปด้วยปุ่ม "อ่านสลิป" ด้านบน หรือกด "บวกเพิ่ม" เพื่อเพิ่มรายรับ';
    return filter === 'income' ? 'ไม่มีรายการรายรับ' : 'ไม่มีรายการรายจ่าย';
  }

  /* วาดรายการใหม่จาก storage; animate = FLIP แถวที่ขยับ + แถวใหม่เลื่อนเข้า (transform/opacity) */
  function render(animate) {
    if (busy) return; // commit ของการลบจะวาดใหม่ให้เอง
    var all = sorted();
    var items = filter === 'all' ? all : all.filter(function (t) { return t.type === filter; });
    var shown = items.slice(0, limit);
    var doAnim = !!animate && !reducedMotion();

    var before = {};
    if (doAnim) {
      Array.prototype.forEach.call(els.list.children, function (li) {
        before[li.getAttribute('data-id')] = li.getBoundingClientRect().top;
      });
    }

    var frag = document.createDocumentFragment();
    shown.forEach(function (t) { frag.appendChild(buildRow(t)); });
    els.list.textContent = '';
    els.list.appendChild(frag);
    els.list.hidden = shown.length === 0;

    var sum = summaryText(shown.length, items.length);
    if (els.summary.textContent !== sum) els.summary.textContent = sum;
    els.summary.hidden = !sum;
    var empty = items.length ? '' : emptyText(all.length > 0);
    if (els.empty.textContent !== empty) els.empty.textContent = empty;
    els.empty.hidden = !empty;
    els.more.hidden = items.length <= shown.length;

    if (!doAnim) return;
    // อ่านตำแหน่งทั้งหมดก่อน แล้วค่อยเขียน (กัน layout thrash)
    var moves = [];
    var entering = [];
    Array.prototype.forEach.call(els.list.children, function (li) {
      var id = li.getAttribute('data-id');
      if (Object.prototype.hasOwnProperty.call(before, id)) {
        var dy = before[id] - li.getBoundingClientRect().top;
        if (dy) moves.push([li, dy]);
      } else {
        entering.push(li);
      }
    });
    if (!moves.length && !entering.length) return;
    moves.forEach(function (m) {
      m[0].style.transition = 'none';
      m[0].style.transform = 'translateY(' + m[1] + 'px)';
    });
    entering.forEach(function (li) { li.classList.add('is-entering'); });
    void els.list.offsetHeight;
    moves.forEach(function (m) {
      m[0].style.transition = '';
      m[0].style.transform = '';
    });
    entering.forEach(function (li) { li.classList.remove('is-entering'); });
  }

  /* ---------- filter ---------- */
  function setFilter(key) {
    if (key === filter) return;
    filter = key;
    FM.set(FILTER_KEY, key);
    limit = CHUNK;
    els.segs.forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-filter') === key ? 'true' : 'false');
    });
    render(false);
  }

  function pressedSeg() {
    for (var i = 0; i < els.segs.length; i++) {
      if (els.segs[i].getAttribute('aria-pressed') === 'true') return els.segs[i];
    }
    return els.segs[0];
  }

  /* ---------- delete (ย้อนยอดแบบเดียวกับ balance.js เดิม) ---------- */
  function removeTx(id, rowEl) {
    if (busy) return;
    var rows = Array.prototype.slice.call(els.list.children);
    var pos = rows.indexOf(rowEl);

    function commit() {
      var t = readTx();
      var j = -1;
      for (var k = 0; k < t.length; k++) { if (t[k] && String(t[k].id) === id) { j = k; break; } }
      busy = false;
      if (j !== -1) {
        var item = t[j];
        var amt = Number(item.amount) || 0;
        var bal = readBalance();
        bal = round2(item.type === 'income' ? bal - amt : bal + amt);
        if (bal === 0) bal = 0; // กัน -0
        t.splice(j, 1);
        persist(bal, t);
      }
      render(j !== -1);
      // focus: แถวที่มาแทนที่ตำแหน่งเดิม (= แถวถัดไป) → แถวก่อนหน้า → ตัวกรอง (เมื่อรายการว่าง)
      var now = els.list.children;
      var next = now[pos] || now[pos - 1] || now[now.length - 1];
      var btn = next && next.querySelector('.txl__del');
      if (btn) btn.focus();
      else pressedSeg().focus();
    }

    var delBtn = rowEl && rowEl.querySelector('.txl__del');
    if (delBtn) delBtn.disabled = true;
    if (!rowEl || pos === -1 || reducedMotion()) { commit(); return; }
    busy = true;
    rowEl.classList.add('is-leaving');
    var finished = false;
    function finish() { if (finished) return; finished = true; commit(); }
    rowEl.addEventListener('transitionend', function (e) { if (e.target === rowEl) finish(); });
    setTimeout(finish, LEAVE_MS + 80);
  }

  /* ---------- build ---------- */
  function build(root) {
    root.textContent = '';
    root.classList.add('txl');

    var bar = el('div', 'txl__bar');
    var group = el('div', 'txl__filter');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'กรองรายการ');
    var segs = FILTERS.map(function (f) {
      var b = el('button', 'txl__seg', f.label);
      b.type = 'button';
      b.setAttribute('data-filter', f.key);
      b.setAttribute('aria-pressed', f.key === filter ? 'true' : 'false');
      b.addEventListener('click', function () { setFilter(f.key); });
      group.appendChild(b);
      return b;
    });

    var add = el('button', 'btn btn--primary txl__add');
    add.type = 'button';
    add.setAttribute('aria-haspopup', 'dialog');
    add.setAttribute('aria-controls', 'adjust-dialog');
    add.appendChild(icon(ICON_PLUS, 20));
    add.appendChild(el('span', '', 'บวกเพิ่ม'));
    add.addEventListener('click', function () {
      if (FM.ui && typeof FM.ui.openAdjust === 'function') FM.ui.openAdjust(add);
    });

    bar.appendChild(group);
    bar.appendChild(add);

    var notice = el('p', 'txl__notice');
    notice.setAttribute('role', 'alert');
    notice.hidden = true;

    // จำนวนที่แสดง + ข้อความว่าง อยู่ใน live region เดียว (ประกาศเมื่อเปลี่ยนตัวกรอง)
    var status = el('div', 'txl__status');
    status.setAttribute('role', 'status');
    var summary = el('p', 'txl__summary');
    var empty = el('p', 'txl__empty');
    status.appendChild(summary);
    status.appendChild(empty);

    var list = el('ul', 'txl__list');
    list.setAttribute('aria-label', 'รายการรับ-จ่าย ใหม่ไปเก่า');

    var more = el('button', 'btn txl__more', 'แสดงเพิ่ม');
    more.type = 'button';
    more.hidden = true;
    more.addEventListener('click', function () {
      var from = els.list.children.length;
      limit += CHUNK;
      render(false);
      // ย้าย focus ไปแถวแรกที่เพิ่งแสดง (ปุ่มอาจหายไปเมื่อแสดงครบ)
      var first = els.list.children[from];
      if (first) {
        first.setAttribute('tabindex', '-1');
        first.focus();
      }
    });

    root.appendChild(bar);
    root.appendChild(notice);
    root.appendChild(status);
    root.appendChild(list);
    root.appendChild(more);

    els = { root: root, segs: segs, add: add, notice: notice, summary: summary, empty: empty, list: list, more: more };
  }

  function init() {
    var root = document.getElementById('txlist-root');
    if (!root) return;
    filter = readFilter();
    build(root);
    render(false);

    FM.on('tx:changed', function () {
      if (emitting) return;
      render(true);
    });
    // กลับมาที่หน้า #/tx: วาดใหม่ให้ป้ายเวลา (วันนี้/เมื่อวาน) ไม่ค้างข้ามวัน
    FM.on('route:changed', function (name) {
      if (name === 'tx') render(false);
    });
  }

  window.FM = window.FM || {};
  FM.txlist = { init: init };
})();
