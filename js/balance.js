/* balance.js — ฟอร์มปรับยอดเงินในกล่อง #adjust-root (ตั้งยอดใหม่ / บวกเพิ่ม + หมวดรายรับ)
 * การ์ด KPI เป็นเจ้าของตัวเลขยอดเงินหลัก (ที่นี่แสดงแค่บรรทัด "ยอดปัจจุบัน" ในกล่อง) และไม่มีประวัติ (ย้ายไปหน้า #/tx = txlist.js)
 * เขียน fm.balance / fm.tx แล้ว emit 'balance:changed' ตามด้วย 'tx:changed'
 * อ่านค่าจาก storage ใหม่ทุกครั้งที่กดปุ่ม จึงไม่ต้องเก็บสถานะของโมดูลอื่น */
(function () {
  'use strict';

  var MAX_AMOUNT = 1e12;
  var CLOSE_MS = 900;       // ค้างข้อความสำเร็จให้อ่าน/ประกาศก่อนปิดกล่อง
  var DEFAULT_CAT = 'other';

  var els = {};
  var emitting = false;     // กัน listener ของตัวเองทำงานซ้ำตอน emit
  var statusTimer = 0;
  var closeTimer = 0;
  var closing = false;      // รอปิดกล่องหลังทำรายการสำเร็จ (ปุ่มไม่รับการกดชั่วคราว)

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

  /* คืน true เมื่อเขียนลงเครื่องได้ครบ (หรือเบราว์เซอร์ไม่มี storage ตั้งแต่ต้น — แจ้งไว้แล้วตอน init) */
  function persist(balance, tx) {
    var ok1 = FM.set('balance', balance);
    var ok2 = FM.set('tx', tx);
    var failed = FM.storageOk && (!ok1 || !ok2);
    if (failed) showStorageNotice('บันทึกข้อมูลไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็ม ข้อมูลล่าสุดอาจหายเมื่อรีโหลด');
    emitting = true;
    try {
      FM.emit('balance:changed', balance);
      FM.emit('tx:changed', tx);
    } finally {
      emitting = false;
    }
    return !failed;
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

  /* ---------- หลังทำรายการสำเร็จ: ประกาศผล แล้วปิดกล่อง (router คืน focus ให้ปุ่มที่เปิด) ---------- */
  function setLocked(on) {
    closing = on;
    [els.setBtn, els.addBtn].forEach(function (b) {
      if (on) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
    });
  }

  function done(saved) {
    els.input.value = '';
    setSuccess('อัปเดตยอดแล้ว');
    // เขียนลงเครื่องไม่สำเร็จ → ไม่ปิดกล่อง ให้ผู้ใช้เห็นคำเตือนก่อน
    if (!saved) return;
    var dlg = els.dialog;
    if (!dlg || !dlg.open || !FM.ui || typeof FM.ui.closeAdjust !== 'function') return;
    // ไม่ใช้ disabled เพราะปุ่มที่มี focus จะทำให้ focus หลุดไป body ระหว่างรอ
    setLocked(true);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      closeTimer = 0;
      if (dlg.open) FM.ui.closeAdjust();
      else resetForm();
    }, CLOSE_MS);
  }

  function renderCurrent() {
    if (els.currentVal) els.currentVal.textContent = FM.fmtMoney(readBalance());
  }

  /* ล้างฟอร์มทุกครั้งที่กล่องปิด (Esc / ปุ่มปิด / พื้นหลัง / หลังสำเร็จ) */
  function resetForm() {
    clearTimeout(closeTimer);
    closeTimer = 0;
    clearTimeout(statusTimer);
    setLocked(false);
    els.input.value = '';
    setError('');
    els.status.textContent = '';
    if (els.select) els.select.value = DEFAULT_CAT;
    // คำเตือน "บันทึกไม่สำเร็จ" เป็นของครั้งก่อน; คำเตือน "เบราว์เซอร์บันทึกไม่ได้" ต้องค้างไว้
    if (FM.storageOk !== false) els.notice.hidden = true;
  }

  /* ---------- actions ---------- */
  function onSet() {
    if (closing) return;
    var r = parseAmount(els.input.value);
    if (r.error) { setError(r.error); els.input.focus(); return; }
    var bal = r.value === 0 ? 0 : r.value; // กัน -0
    done(persist(bal, readTx()));
  }

  function onAdd() {
    if (closing) return;
    var r = parseAmount(els.input.value);
    if (r.error) { setError(r.error); els.input.focus(); return; }
    if (!(r.value > 0)) {
      setError('ยอดที่บวกเพิ่มต้องมากกว่า 0 ถ้าเป็นรายจ่ายให้ใช้สลิปรายจ่าย');
      els.input.focus();
      return;
    }
    var bal = round2(readBalance() + r.value);
    if (bal === 0) bal = 0; // กัน -0
    if (Math.abs(bal) > MAX_AMOUNT) {
      setError('ยอดรวมจะเกิน 1,000,000,000,000 บาท');
      els.input.focus();
      return;
    }
    var category = FM.cats ? FM.cats.normalize('income', els.select ? els.select.value : DEFAULT_CAT) : null;
    var tx = readTx();
    tx.push({ id: FM.uid(), type: 'income', amount: r.value, ts: Date.now(), source: 'manual', category: category });
    done(persist(bal, tx));
  }

  /* ---------- build (ภายใน #adjust-root ของกล่องปรับยอด) ---------- */
  function build(root) {
    root.textContent = '';
    root.classList.add('balance');

    var notice = el('p', 'balance__notice');
    notice.setAttribute('role', 'status');
    notice.hidden = true;

    // ยอดที่ "ตั้งยอดใหม่" จะเขียนทับ (อัปเดตตอนเปิดกล่องและเมื่อยอดเปลี่ยน)
    var current = el('p', 'balance__current', 'ยอดปัจจุบัน ');
    var currentVal = el('span', 'num balance__current-val');
    current.appendChild(currentVal);

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
    // showModal() ย้าย focus มาที่ช่องนี้แทนปุ่มปิด
    input.setAttribute('autofocus', '');
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
    form.appendChild(field);

    // หมวดรายรับ: ใช้กับ "บวกเพิ่ม" เท่านั้น ("ตั้งยอดใหม่" ไม่สร้างรายการ)
    var select = null;
    var cats = FM.cats ? FM.cats.list('income') : [];
    if (cats.length) {
      var catField = el('div', 'field balance__field');
      var catLabel = el('label', 'field__label', 'หมวดหมู่รายรับ');
      catLabel.setAttribute('for', 'balance-cat');
      select = el('select', 'input balance__select');
      select.id = 'balance-cat';
      select.setAttribute('aria-describedby', 'balance-cat-help');
      cats.forEach(function (c) {
        var o = el('option', '', c.label);
        o.value = c.key;
        select.appendChild(o);
      });
      select.value = DEFAULT_CAT;
      var help = el('p', 'balance__help', 'ใช้กับปุ่มบวกเพิ่มเท่านั้น');
      help.id = 'balance-cat-help';
      catField.appendChild(catLabel);
      catField.appendChild(select);
      catField.appendChild(help);
      form.appendChild(catField);
    }

    var actions = el('div', 'balance__actions');
    var setBtn = el('button', 'btn', 'ตั้งยอดใหม่');
    setBtn.type = 'button';
    var addBtn = el('button', 'btn btn--primary', 'บวกเพิ่ม');
    addBtn.type = 'button';
    actions.appendChild(setBtn);
    actions.appendChild(addBtn);
    form.appendChild(actions);

    root.appendChild(notice);
    root.appendChild(current);
    root.appendChild(form);

    els = {
      notice: notice, input: input, error: error, status: status, select: select, currentVal: currentVal,
      setBtn: setBtn, addBtn: addBtn,
      dialog: root.closest ? root.closest('dialog') : null
    };

    setBtn.addEventListener('click', onSet);
    addBtn.addEventListener('click', onAdd);
    input.addEventListener('input', function () { if (!els.error.hidden) setError(''); });
  }

  function init() {
    var root = document.getElementById('adjust-root');
    if (!root) return;
    build(root);
    renderCurrent();
    // ยอดเปลี่ยนจากที่ใด (กล่องนี้/สลิป/ลบรายการ/ซิงก์คลาวด์) ก็อัปเดตบรรทัดยอดปัจจุบัน
    FM.on('balance:changed', renderCurrent);

    if (FM.storageOk === false) showStorageNotice('เบราว์เซอร์นี้บันทึกข้อมูลไม่ได้ ข้อมูลจะหายเมื่อปิดหรือรีโหลดหน้า');

    // router.js เป็นคนเปิด/ปิดกล่อง (FM.ui) — ที่นี่แค่ล้างฟอร์มเมื่อปิด
    // ดูจาก attribute open (MutationObserver) แทน event 'close' ซึ่งมาแบบ async และบางสภาพแวดล้อมไม่มาเลย
    var dlg = els.dialog;
    if (dlg && window.MutationObserver) {
      new MutationObserver(function () { if (!dlg.open) resetForm(); else renderCurrent(); })
        .observe(dlg, { attributes: true, attributeFilter: ['open'] });
    } else if (dlg) {
      dlg.addEventListener('close', resetForm);
    }

    // ฟัง 'balance:changed' แค่เพื่อบรรทัดยอดปัจจุบัน: ทุกปุ่มอ่าน fm.balance / fm.tx จาก storage ใหม่
    // ตอนกด (ธง emitting ยังตั้งระหว่าง emit ของตัวเอง เผื่อมี listener ในไฟล์นี้ภายหลัง)
  }

  FM.balance = { init: init };
})();
