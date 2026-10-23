/* balance.js — การ์ดยอดเงิน: ตั้งยอดใหม่, บวกเพิ่ม, count-up, ประวัติ 5 รายการ */
(function () {
  'use strict';

  var MAX_AMOUNT = 1e12;
  var HISTORY_LIMIT = 5;
  var COUNT_MS = 500;
  var LEAVE_MS = 200;

  var els = {};
  var shown = 0;            // ค่าที่แสดงอยู่ตอนนี้ (ระหว่าง count-up)
  var target = 0;           // ค่าปลายทางของ animation
  var rafId = 0;
  var emitting = false;     // กัน listener ของตัวเองทำงานซ้ำตอน emit
  var busy = false;         // กำลังเล่น animation ลบแถว
  var statusTimer = 0;

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  var SVG_NS = 'http://www.w3.org/2000/svg';

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
    return t && (t.type === 'income' || t.type === 'expense') && isFinite(Number(t.amount));
  }

  function persist(balance, tx) {
    var ok1 = FM.set('balance', balance);
    var ok2 = FM.set('tx', tx);
    if (FM.storageOk && (!ok1 || !ok2)) showStorageNotice('บันทึกข้อมูลไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็ม ข้อมูลล่าสุดอาจหายเมื่อรีโหลด');
    emitting = true;
    try {
      FM.emit('balance:changed', balance);
      FM.emit('tx:changed', tx);
    } finally {
      emitting = false;
    }
  }

  /* ---------- parsing ---------- */
  function parseAmount(raw) {
    var s = String(raw || '').replace(/[\s,฿]/g, '').replace(/บาท$/, '');
    if (s === '') return { error: 'กรุณากรอกจำนวนเงิน' };
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'กรอกเป็นตัวเลขเท่านั้น เช่น 1,234.50' };
    var n = Number(s);
    if (!isFinite(n)) return { error: 'กรอกเป็นตัวเลขเท่านั้น เช่น 1,234.50' };
    if (Math.abs(n) > MAX_AMOUNT) return { error: 'จำนวนเงินต้องไม่เกิน 1,000,000,000,000 บาท' };
    return { value: round2(n) };
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function trashIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2');
    svg.appendChild(p);
    return svg;
  }

  /* ---------- balance figure ---------- */
  function paintFigure(v) {
    els.figure.textContent = FM.fmtMoney(v);
    els.figure.classList.toggle('is-negative', v < 0);
  }

  function showBalance(next, animate) {
    if (next === target) {
      if (!rafId) { shown = next; paintFigure(next); }
      return; // กำลังวิ่งไปค่านี้อยู่แล้ว
    }
    target = next;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (!animate || reducedMotion() || shown === next) {
      shown = next;
      paintFigure(next);
      return;
    }
    var from = shown;
    var start = 0;
    function step(now) {
      if (!start) start = now;
      var t = Math.min(1, (now - start) / COUNT_MS);
      var eased = 1 - Math.pow(1 - t, 3);
      shown = t >= 1 ? next : from + (next - from) * eased;
      paintFigure(t >= 1 ? next : round2(shown));
      if (t < 1) rafId = requestAnimationFrame(step);
      else { rafId = 0; shown = next; }
    }
    rafId = requestAnimationFrame(step);
  }

  /* ---------- form feedback ---------- */
  function setError(msg) {
    clearTimeout(statusTimer);
    els.status.textContent = '';
    els.error.textContent = msg || '';
    els.error.hidden = !msg;
    if (msg) els.input.setAttribute('aria-invalid', 'true');
    else els.input.removeAttribute('aria-invalid');
  }

  function setSuccess(msg) {
    setError('');
    els.status.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { els.status.textContent = ''; }, 2500);
  }

  function showStorageNotice(msg) {
    els.notice.textContent = msg;
    els.notice.hidden = false;
  }

  /* ---------- actions ---------- */
  function onSet() {
    var r = parseAmount(els.input.value);
    if (r.error) { setError(r.error); els.input.focus(); return; }
    var bal = r.value === 0 ? 0 : r.value; // กัน -0
    persist(bal, readTx());
    showBalance(bal, true);
    els.input.value = '';
    setSuccess('อัปเดตยอดแล้ว');
  }

  function onAdd() {
    var r = parseAmount(els.input.value);
    if (r.error) { setError(r.error); els.input.focus(); return; }
    if (!(r.value > 0)) {
      setError('ยอดที่บวกเพิ่มต้องมากกว่า 0 ถ้าเป็นรายจ่ายให้ใช้สลิปรายจ่าย');
      els.input.focus();
      return;
    }
    var bal = round2(readBalance() + r.value);
    if (Math.abs(bal) > MAX_AMOUNT) {
      setError('ยอดรวมจะเกิน 1,000,000,000,000 บาท');
      els.input.focus();
      return;
    }
    var tx = readTx();
    tx.push({ id: FM.uid(), type: 'income', amount: r.value, ts: Date.now(), source: 'manual' });
    persist(bal, tx);
    showBalance(bal, true);
    renderHistory(true);
    els.input.value = '';
    setSuccess('อัปเดตยอดแล้ว');
  }

  function removeTx(id, rowEl) {
    if (busy) return;
    var tx = readTx();
    var idx = -1;
    for (var i = 0; i < tx.length; i++) { if (tx[i] && tx[i].id === id) { idx = i; break; } }
    if (idx === -1) { renderHistory(false); return; }

    // จำปุ่มถัดไปเพื่อย้าย focus หลังลบ
    var rows = Array.prototype.slice.call(els.list.children);
    var pos = rows.indexOf(rowEl);
    var focusId = null;
    if (pos !== -1) {
      var neighbor = rows[pos + 1] || rows[pos - 1];
      if (neighbor) focusId = neighbor.getAttribute('data-id');
    }

    function commit() {
      var t = readTx();
      var j = -1;
      for (var k = 0; k < t.length; k++) { if (t[k] && t[k].id === id) { j = k; break; } }
      if (j === -1) { busy = false; renderHistory(false); return; }
      var item = t[j];
      var amt = Number(item.amount) || 0;
      var bal = readBalance();
      bal = round2(item.type === 'income' ? bal - amt : bal + amt);
      if (bal === 0) bal = 0;
      t.splice(j, 1);
      persist(bal, t);
      showBalance(bal, true);
      busy = false;
      renderHistory(true);
      var focusEl = focusId && els.list.querySelector('li[data-id="' + cssEscape(focusId) + '"] .balance-hist__del');
      if (focusEl) focusEl.focus();
      else els.input.focus();
    }

    var btn = rowEl && rowEl.querySelector('.balance-hist__del');
    if (btn) btn.disabled = true;
    if (!rowEl || reducedMotion()) { commit(); return; }
    busy = true;
    rowEl.classList.add('is-leaving');
    var done = false;
    function finish() { if (done) return; done = true; commit(); }
    rowEl.addEventListener('transitionend', function (e) { if (e.target === rowEl) finish(); });
    setTimeout(finish, LEAVE_MS + 80);
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  /* ---------- history ---------- */
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

  function latest() {
    return readTx().filter(isValidTx).sort(function (a, b) {
      return (Number(b.ts) || 0) - (Number(a.ts) || 0);
    }).slice(0, HISTORY_LIMIT);
  }

  function buildRow(t) {
    var income = t.type === 'income';
    var amt = Math.abs(Number(t.amount));
    var sign = income ? '+' : '\u2212';
    var typeText = income ? 'รายรับ' : 'รายจ่าย';
    var srcText = t.source === 'slip' ? 'สลิป' : 'กรอกเอง';
    var when = fmtWhen(t.ts);

    var li = el('li', 'balance-hist__row ' + (income ? 'is-income' : 'is-expense'));
    li.setAttribute('data-id', String(t.id));

    var main = el('div', 'balance-hist__main');
    var amount = el('span', 'balance-hist__amount num', sign + FM.fmtMoney(amt));
    var meta = el('span', 'balance-hist__meta');
    meta.appendChild(document.createTextNode(typeText + ' · ' + srcText + (when ? ' · ' : '')));
    if (when) meta.appendChild(el('span', 'num', when));
    main.appendChild(amount);
    main.appendChild(meta);

    var del = el('button', 'icon-btn balance-hist__del');
    del.type = 'button';
    del.setAttribute('aria-label', 'ลบรายการ ' + typeText + ' ' + FM.fmtMoney(amt) + (when ? ' ' + when : ''));
    del.appendChild(trashIcon());
    del.addEventListener('click', function () { removeTx(t.id, li); });

    li.appendChild(main);
    li.appendChild(del);
    return li;
  }

  function renderHistory(animate) {
    if (busy) return;
    var items = latest();
    var doAnim = animate && !reducedMotion();

    // FLIP: จำตำแหน่งเดิมของแถวที่ยังอยู่
    var before = {};
    if (doAnim) {
      Array.prototype.forEach.call(els.list.children, function (li) {
        before[li.getAttribute('data-id')] = li.getBoundingClientRect().top;
      });
    }

    els.list.textContent = '';
    items.forEach(function (t) { els.list.appendChild(buildRow(t)); });
    els.list.hidden = items.length === 0;
    els.empty.hidden = items.length !== 0;

    if (!doAnim) return;
    Array.prototype.forEach.call(els.list.children, function (li) {
      var id = li.getAttribute('data-id');
      if (Object.prototype.hasOwnProperty.call(before, id)) {
        var dy = before[id] - li.getBoundingClientRect().top;
        if (dy) {
          li.style.transition = 'none';
          li.style.transform = 'translateY(' + dy + 'px)';
          li.getBoundingClientRect();
          li.style.transition = '';
          li.style.transform = '';
        }
      } else {
        li.classList.add('is-entering');
        li.getBoundingClientRect();
        li.classList.remove('is-entering');
      }
    });
  }

  /* ---------- build ---------- */
  function build(root) {
    root.textContent = '';
    root.classList.add('balance');

    var figure = el('p', 'balance__figure num');
    figure.setAttribute('aria-live', 'polite');
    figure.setAttribute('aria-atomic', 'true');
    figure.id = 'balance-figure';

    var notice = el('p', 'balance__notice');
    notice.setAttribute('role', 'status');
    notice.hidden = true;

    // ไม่ใช้ <form> เพื่อไม่ให้ Enter ทำงานโดยไม่ตั้งใจ — ใช้ปุ่มเท่านั้น
    var form = el('div', 'balance__form');
    form.setAttribute('role', 'group');
    form.setAttribute('aria-label', 'ปรับยอดเงิน');

    var field = el('div', 'field balance__field');
    var label = el('label', 'field__label', 'จำนวนเงิน (บาท)');
    label.setAttribute('for', 'balance-input');
    var input = el('input', 'input num balance__input');
    input.id = 'balance-input';
    input.type = 'text';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', '0.00');
    input.setAttribute('aria-describedby', 'balance-error balance-status');
    var error = el('p', 'field__error');
    error.id = 'balance-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    var status = el('p', 'balance__status');
    status.id = 'balance-status';
    status.setAttribute('role', 'status');
    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(error);
    field.appendChild(status);

    var actions = el('div', 'balance__actions');
    var setBtn = el('button', 'btn', 'ตั้งยอดใหม่');
    setBtn.type = 'button';
    var addBtn = el('button', 'btn btn--primary', 'บวกเพิ่ม');
    addBtn.type = 'button';
    actions.appendChild(setBtn);
    actions.appendChild(addBtn);

    form.appendChild(field);
    form.appendChild(actions);

    var hist = el('div', 'balance-hist');
    var histTitle = el('h3', 'balance-hist__title', 'รายการล่าสุด');
    histTitle.id = 'balance-hist-title';
    var list = el('ul', 'balance-hist__list');
    list.setAttribute('aria-labelledby', 'balance-hist-title');
    var empty = el('p', 'balance-hist__empty', 'ยังไม่มีรายการ กรอกยอดหรืออัปโหลดสลิปเพื่อเริ่มบันทึก');
    hist.appendChild(histTitle);
    hist.appendChild(list);
    hist.appendChild(empty);

    root.appendChild(figure);
    root.appendChild(notice);
    root.appendChild(form);
    root.appendChild(hist);

    els = { figure: figure, notice: notice, input: input, error: error, status: status, list: list, empty: empty };

    setBtn.addEventListener('click', onSet);
    addBtn.addEventListener('click', onAdd);
    input.addEventListener('input', function () { if (!els.error.hidden) setError(''); });
  }

  function init() {
    var root = document.getElementById('balance-root');
    if (!root) return;
    build(root);

    if (FM.storageOk === false) showStorageNotice('เบราว์เซอร์นี้บันทึกข้อมูลไม่ได้ ข้อมูลจะหายเมื่อปิดหรือรีโหลดหน้า');

    var b = readBalance();
    shown = b; target = b;
    paintFigure(b);
    renderHistory(false);

    // ฟังการเปลี่ยนแปลงจากโมดูลอื่น (เช่น สลิป) — อ่านจาก storage ใหม่ ไม่ emit ซ้ำ
    FM.on('balance:changed', function () {
      if (emitting) return;
      showBalance(readBalance(), true);
    });
    FM.on('tx:changed', function () {
      if (emitting) return;
      renderHistory(true);
    });
  }

  FM.balance = { init: init };
})();
