/* slip.js — อัปโหลดสลิป, OCR (Tesseract tha+eng ในเบราว์เซอร์), แก้ยอด, ยืนยันรายรับ/รายจ่าย */
(function () {
  'use strict';

  var MAX_BYTES = 10 * 1024 * 1024;
  var MAX_SIDE = 1800;          // ย่อด้านยาวสุดก่อน OCR
  var CONTRAST = 1.2;           // เพิ่ม contrast เล็กน้อยหลังแปลงเป็นขาวดำ
  var MAX_AMOUNT = 1e12;
  var LOAD_TIMEOUT = 120000;    // โหลดตัวอ่านภาษา (ครั้งแรกต้องดาวน์โหลด)
  var READ_TIMEOUT = 90000;     // อ่านภาพหนึ่งใบ
  var DONE_MS = 4000;           // เวลาค้างข้อความบันทึกสำเร็จ
  var LOAD_SHARE = 0.35;        // สัดส่วน progress ของช่วงโหลด (เมื่อยังไม่มี worker)
  var MIN_SCORE = -4;           // ต่ำกว่านี้ = บรรทัดค่าธรรมเนียม/คงเหลือ/อ้างอิง ไม่นำมาเสนอ
  var MAX_ALTS = 3;

  /* =========================================================
   * Amount parser (pure) — FM.slip._parseAmount(text)
   * คืน { amount: number|null, alternatives: number[], candidates: [{value, score, line}] }
   * ========================================================= */
  var MONEY_RE = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g;
  var POS_KEYS = [
    ['จำนวนเงิน', 6], ['ยอดโอน', 5], ['ยอดชำระ', 5], ['จำนวน', 5], ['amount', 5],
    ['ยอดเงิน', 4], ['total', 3], ['ยอด', 3]
  ];
  var NEG_KEYS = ['ค่าธรรมเนียม', 'fee', 'คงเหลือ', 'balance', 'ref', 'เลขที่', 'อ้างอิง'];
  var CUR_RE = /บาท|thb|฿/;
  var TIME_KEY_RE = /เวลา|time/;

  function round2(x) { return Math.round(x * 100) / 100; }

  // ตัดช่องว่าง + ตัวพิมพ์เล็ก + แก้ "ํา" ที่ OCR แยกเป็นสองตัว ให้เทียบคำได้
  function keyOf(line) {
    return line.replace(/\s+/g, '').toLowerCase().replace(/ํา/g, 'ำ');
  }

  // แก้ความผิดพลาด OCR แบบน้อยที่สุด: "1, 234.00" → "1,234.00", "1,25O.OO" → "1,250.00", "1l" → "11"
  function fixLine(s) {
    var prev;
    var n = 0;
    do {
      prev = s;
      s = s.replace(/(\d)\s*([,.])\s*(\d)/g, function (m, a, sep, b) { return a + sep + b; })
           .replace(/(\d[,.]?)[Oo]/g, function (m, a) { return a + '0'; })
           .replace(/(\d[,.]?)[lI|]/g, function (m, a) { return a + '1'; });
    } while (s !== prev && ++n < 8);
    return s;
  }

  function posScore(k) {
    var best = 0;
    for (var i = 0; i < POS_KEYS.length; i++) {
      if (k.indexOf(POS_KEYS[i][0]) !== -1 && POS_KEYS[i][1] > best) best = POS_KEYS[i][1];
    }
    return best;
  }

  function hasNeg(k) {
    for (var i = 0; i < NEG_KEYS.length; i++) if (k.indexOf(NEG_KEYS[i]) !== -1) return true;
    return false;
  }

  // ตัวเลขในบรรทัดที่เป็นรูปแบบเงิน และไม่ใช่ส่วนหนึ่งของวันที่/เวลา/เลขบัญชี/เลขอ้างอิง
  function lineCandidates(line, key) {
    var out = [];
    var m;
    var segStart = 0;
    MONEY_RE.lastIndex = 0;
    while ((m = MONEY_RE.exec(line)) !== null) {
      var raw = m[0];
      var before = line.slice(0, m.index);
      var after = line.slice(m.index + raw.length);
      // ข้อความระหว่างตัวเลขก่อนหน้ากับตัวนี้ = ป้ายของตัวเลขนี้ (กรณีหลายยอดในบรรทัดเดียว)
      var segKey = keyOf(line.slice(segStart, m.index));
      segStart = m.index + raw.length;
      // ติดกับตัวเลข/จุด/จุลภาคอื่น เช่น 23.10.2566, 1.250.00, 1234,567.00
      if (/\d$|\d[.,]$/.test(before)) continue;
      if (/^\d|^[.,]\d/.test(after)) continue;
      // ต่อด้วย - / : เช่น เลขบัญชี 123-4-56789.00, วันที่ 23/10.66
      if (/\d\s?[-\/:]\s?$/.test(before)) continue;
      if (/^\s?[-\/:]\s?\d/.test(after)) continue;
      var value = Number(raw.replace(/,/g, ''));
      if (!isFinite(value)) continue;
      // เวลาแบบไทย "14.30 น." หรือบรรทัดที่มีคำว่าเวลา
      if (raw.indexOf(',') === -1) {
        var hh = Math.floor(value);
        var mm = Math.round((value - hh) * 100);
        if (hh <= 23 && mm <= 59 && (/^\s*น(\.|\s|$)/.test(after) || TIME_KEY_RE.test(key))) continue;
      }
      var bonus = 0;
      if (/^\s*(บาท|thb|฿)/i.test(after) || /(฿|thb)\s*$/i.test(before)) bonus += 1;
      if (raw.indexOf(',') !== -1) bonus += 0.5;
      out.push({ value: round2(value), bonus: bonus, segKey: segKey });
    }
    return out;
  }

  function parseAmount(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var all = [];
    var prev = null; // บรรทัดก่อนหน้าที่ไม่ว่าง { pos, neg, hasNum }

    for (var i = 0; i < lines.length; i++) {
      var line = fixLine(lines[i]);
      if (!line.trim()) continue;
      var key = keyOf(line);
      var neg = hasNeg(key);
      var pos = neg ? 0 : posScore(key); // "ยอดคงเหลือ" มีคำว่า "ยอด" แต่เป็นบรรทัดที่ต้องตัดคะแนน
      var cur = CUR_RE.test(key);
      var cands = lineCandidates(line, key);

      // ป้ายอยู่บรรทัดบน ตัวเลขอยู่บรรทัดล่าง (เช่น "จำนวน:" แล้วขึ้นบรรทัดใหม่)
      var ctxPos = 0;
      var ctxNeg = false;
      if (!pos && !neg && prev && !prev.hasNum) {
        ctxPos = prev.pos * 0.8;
        ctxNeg = prev.neg;
      }

      for (var j = 0; j < cands.length; j++) {
        var c = cands[j];
        if (!(c.value > 0) || c.value > MAX_AMOUNT) continue;
        var cPos = pos;
        var cNeg = neg;
        // ป้ายที่อยู่ติดหน้าตัวเลขชนะป้ายของทั้งบรรทัด
        if (cands.length > 1 && (hasNeg(c.segKey) || posScore(c.segKey))) {
          cNeg = hasNeg(c.segKey);
          cPos = cNeg ? 0 : posScore(c.segKey);
        }
        var score = Math.max(cPos, ctxPos) + (cur ? 2 : 0) + c.bonus + ((cNeg || ctxNeg) ? -8 : 0);
        all.push({ value: c.value, score: score, line: lines[i].trim() });
      }

      prev = { pos: pos, neg: neg, hasNum: cands.length > 0 };
    }

    // ค่าเดียวกันซ้ำหลายบรรทัด → เก็บคะแนนสูงสุด
    var byValue = {};
    var uniq = [];
    all.forEach(function (c) {
      var k = c.value.toFixed(2);
      if (!byValue[k]) { byValue[k] = c; uniq.push(c); }
      else if (c.score > byValue[k].score) {
        uniq[uniq.indexOf(byValue[k])] = c;
        byValue[k] = c;
      }
    });

    uniq.sort(function (a, b) { return (b.score - a.score) || (b.value - a.value); });
    var eligible = uniq.filter(function (c) { return c.score > MIN_SCORE; });

    return {
      amount: eligible.length ? eligible[0].value : null,
      alternatives: eligible.slice(1, 1 + MAX_ALTS).map(function (c) { return c.value; }),
      candidates: uniq
    };
  }

  /* =========================================================
   * ช่องกรอกยอด
   * ========================================================= */
  function parseField(raw) {
    var s = String(raw || '').replace(/[\s,฿]/g, '').replace(/บาท$/, '');
    if (s === '') return { empty: true, error: 'กรุณากรอกจำนวนเงิน' };
    if (/^-/.test(s)) return { error: 'กรอกยอดเป็นค่าบวก แล้วเลือกรายรับหรือรายจ่ายด้านล่าง' };
    if (/^\+?\d*\.\d{3,}$/.test(s)) return { error: 'ทศนิยมได้ไม่เกิน 2 ตำแหน่ง' };
    if (!/^\+?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return { error: 'กรอกเป็นตัวเลขเท่านั้น เช่น 1,250.00' };
    var n = round2(Number(s.replace(/^\+/, '')));
    if (!isFinite(n)) return { error: 'กรอกเป็นตัวเลขเท่านั้น เช่น 1,250.00' };
    if (!(n > 0)) return { error: 'ยอดเงินต้องมากกว่า 0' };
    if (n > MAX_AMOUNT) return { error: 'จำนวนเงินต้องไม่เกิน 1,000,000,000,000 บาท' };
    return { value: n };
  }

  function fmtPlain(n) {
    try {
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
      return n.toFixed(2);
    }
  }

  function fmtSize(b) {
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }

  /* =========================================================
   * Tesseract worker (สร้างครั้งเดียวเมื่อต้องใช้ แล้วใช้ซ้ำ)
   * ========================================================= */
  var worker = null;
  var workerPromise = null;
  var workerGen = 0;
  var onLog = null; // logger ของรอบที่กำลังทำงาน

  function err(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  function noop() {}

  function safeTerminate(w) {
    try {
      var p = w && w.terminate && w.terminate();
      if (p && p.then) p.then(noop, noop);
    } catch (e) { /* ignore */ }
  }

  function withTimeout(p, ms, code) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(err(code)); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function getWorker() {
    if (workerPromise) return workerPromise;
    if (typeof window.Tesseract === 'undefined' || !window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
      return Promise.reject(err('nolib'));
    }
    var gen = ++workerGen;
    var raw;
    var failLoad = noop;
    // Tesseract 5 ไม่ reject createWorker ถ้าโหลดภาษาล้ม (ค้างไว้เฉย ๆ) → ใช้ errorHandler ตัดจบเร็ว
    var failed = new Promise(function (resolve, reject) { failLoad = reject; });
    failed.catch(noop);
    try {
      raw = Promise.resolve(window.Tesseract.createWorker(['tha', 'eng'], 1, {
        logger: function (m) { if (onLog) onLog(m); },
        // หลังพร้อมแล้ว error ของ recognize มาทาง promise rejection อยู่แล้ว
        errorHandler: function () { if (gen === workerGen && !worker) failLoad(err('load')); }
      }));
    } catch (e) {
      return Promise.reject(err('load'));
    }
    // ถ้ารอบนี้ถูกยกเลิกไปแล้ว (timeout/เปลี่ยนรูป/ออกจากหน้า) แต่ worker เพิ่งพร้อม → ปิดทิ้ง
    raw.then(function (w) { if (gen !== workerGen) safeTerminate(w); }, noop);

    workerPromise = withTimeout(Promise.race([raw, failed]), LOAD_TIMEOUT, 'load').then(function (w) {
      if (gen !== workerGen) throw err('stale');
      worker = w;
      return w;
    }).catch(function (e) {
      if (gen === workerGen) { workerGen++; workerPromise = null; worker = null; }
      throw (e && e.code) ? e : err('load');
    });
    return workerPromise;
  }

  function dropWorker() {
    workerGen++;
    var w = worker;
    worker = null;
    workerPromise = null;
    if (w) safeTerminate(w);
  }

  /* =========================================================
   * เตรียมภาพ: ย่อ ≤1800px, ขาวดำ, contrast เล็กน้อย
   * ========================================================= */
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(err('image')); };
      img.src = url;
    });
  }

  function prepare(url, file) {
    return loadImage(url).then(function (img) {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (!w || !h) throw err('image');
      var s = Math.min(1, MAX_SIDE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * s));
      var ch = Math.max(1, Math.round(h * s));
      var c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { input: file, canvas: null };
      ctx.drawImage(img, 0, 0, cw, ch);
      try {
        var d = ctx.getImageData(0, 0, cw, ch);
        var px = d.data;
        for (var i = 0; i < px.length; i += 4) {
          var a = px[i + 3] / 255;
          // พื้นโปร่งใส → ถือเป็นสีขาว
          var l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * a + 255 * (1 - a);
          l = (l - 128) * CONTRAST + 128;
          px[i] = px[i + 1] = px[i + 2] = l; // Uint8ClampedArray ตัดค่า 0–255 ให้เอง
          px[i + 3] = 255;
        }
        ctx.putImageData(d, 0, 0);
      } catch (e) {
        // canvas ถูก taint (บางเบราว์เซอร์ใน file://) → ส่งไฟล์ต้นฉบับแทน
        c.width = c.height = 0;
        return { input: file, canvas: null };
      }
      return { input: c, canvas: c };
    });
  }

  /* =========================================================
   * UI
   * ========================================================= */
  var els = {};
  var state = {
    file: null,
    url: '',
    run: 0,          // run token — ผลของรอบเก่าถูกทิ้ง
    running: false,
    saving: false,
    phase: ''
  };
  var doneTimer = 0;
  var dragDepth = 0;

  var TEMPLATE =
    '<div class="slip__drop" data-el="drop">' +
      '<label class="slip__zone" for="slip-file" data-el="zone">' +
        '<input type="file" id="slip-file" class="slip__file" accept="image/*" aria-describedby="slip-hint" data-el="file">' +
        '<svg class="slip__zone-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>' +
        '</svg>' +
        '<span class="slip__zone-title">เลือกรูปสลิป</span>' +
        '<span class="slip__zone-sub">หรือลากรูปมาวางที่นี่ หรือกด Ctrl+V เพื่อวางรูป</span>' +
        '<span class="slip__zone-meta">ไฟล์ภาพ ขนาดไม่เกิน <span class="num">10</span> MB</span>' +
      '</label>' +
    '</div>' +
    '<div class="slip__work" data-el="work" hidden>' +
      '<div class="slip__preview" data-el="preview">' +
        '<img class="slip__thumb" alt="ภาพสลิปที่เลือก" data-el="thumb">' +
        '<div class="slip__meta">' +
          '<p class="slip__name" data-el="name"></p>' +
          '<p class="slip__size num" data-el="size"></p>' +
        '</div>' +
        '<button type="button" class="btn slip__change" data-el="change">เปลี่ยนรูป</button>' +
      '</div>' +
      '<div class="slip__status" role="status" aria-live="polite">' +
        '<span class="slip__dot" aria-hidden="true" data-el="dot"></span>' +
        '<span class="slip__status-text" data-el="statusText"></span>' +
      '</div>' +
      '<div class="slip__progress" role="progressbar" aria-label="ความคืบหน้าการอ่านสลิป" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-el="progress">' +
        '<span class="slip__bar" data-el="bar"></span>' +
      '</div>' +
      '<div class="slip__skeleton" aria-hidden="true" data-el="skeleton">' +
        '<span class="slip__sk slip__sk--label"></span>' +
        '<span class="slip__sk slip__sk--field"></span>' +
        '<span class="slip__sk slip__sk--chips"></span>' +
      '</div>' +
      '<p class="slip__alert" role="alert" data-el="ocrError" hidden></p>' +
      '<div class="slip__result" data-el="result" hidden>' +
        '<div class="field">' +
          '<label class="field__label" for="slip-amount">ยอดเงินจากสลิป (แก้ไขได้)</label>' +
          '<input class="input num slip__amount" id="slip-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="slip-amount-error" data-el="input">' +
          '<p class="field__error" id="slip-amount-error" role="alert" data-el="fieldError" hidden></p>' +
        '</div>' +
        '<div class="slip__chips" role="group" aria-label="ยอดอื่นที่อ่านได้จากสลิป" data-el="chips" hidden></div>' +
        '<button type="button" class="btn slip__retry" data-el="retry" hidden>ลองอ่านใหม่</button>' +
        // หมวดหมู่: เลือกก่อนกดรายรับ/รายจ่าย — optgroup แยกชนิด, value = "ชนิด:key" (ตัวเลือกเติมใน build)
        '<div class="field slip__cat-field" data-el="catField">' +
          '<label class="field__label" for="slip-cat">หมวดหมู่</label>' +
          '<select class="input slip__cat" id="slip-cat" aria-describedby="slip-cat-help" data-el="cat"></select>' +
          '<p class="slip__cat-help" id="slip-cat-help">เลือกก่อนกดรายรับหรือรายจ่าย</p>' +
          '<p class="field__error" id="slip-cat-error" role="alert" data-el="catError" hidden></p>' +
        '</div>' +
      '</div>' +
      '<div class="slip__actions" role="group" aria-label="บันทึกยอดจากสลิป">' +
        '<button type="button" class="btn btn--primary slip__btn" data-el="income" disabled><span class="slip__sign" aria-hidden="true">+</span>รายรับ</button>' +
        '<button type="button" class="btn slip__btn slip__btn--expense" data-el="expense" disabled><span class="slip__sign" aria-hidden="true">−</span>รายจ่าย</button>' +
      '</div>' +
    '</div>' +
    '<p class="field__error slip__file-error" id="slip-file-error" role="alert" data-el="fileError" hidden></p>' +
    '<p class="slip__hint" id="slip-hint">ภาพถูกประมวลผลในเบราว์เซอร์ ไม่ถูกอัปโหลดไปที่ใด ครั้งแรกต้องใช้อินเทอร์เน็ตเพื่อโหลดตัวอ่านภาษาไทย</p>' +
    '<p class="slip__done" role="status" data-el="done"></p>';

  /* ---------- small view helpers ---------- */
  function setStatus(text, dot) {
    if (els.statusText.textContent !== text) els.statusText.textContent = text;
    els.dot.className = 'slip__dot' + (dot ? ' is-' + dot : '');
  }

  function setProgress(p) {
    var v = Math.max(0, Math.min(1, p));
    els.bar.style.transform = 'scaleX(' + v + ')';
    els.progress.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }

  function setFileError(msg) {
    els.fileError.textContent = msg || '';
    els.fileError.hidden = !msg;
    // error อยู่ใต้ส่วนที่มองเห็น (dropzone หรือพรีวิว)
    var anchor = state.file ? els.preview : els.drop;
    if (msg && anchor.nextElementSibling !== els.fileError) anchor.insertAdjacentElement('afterend', els.fileError);
    if (msg) els.file.setAttribute('aria-describedby', 'slip-hint slip-file-error');
    else els.file.setAttribute('aria-describedby', 'slip-hint');
  }

  function setFieldError(msg) {
    els.fieldError.textContent = msg || '';
    els.fieldError.hidden = !msg;
    if (msg) els.input.setAttribute('aria-invalid', 'true');
    else els.input.removeAttribute('aria-invalid');
  }

  /* ---------- หมวดหมู่ (select เดียว 2 optgroup) ---------- */
  var CAT_DEFAULT = 'expense:other';
  var CAT_GROUPS = [['expense', 'หมวดรายจ่าย'], ['income', 'หมวดรายรับ']];

  function fillCats(sel) {
    sel.textContent = '';
    if (!FM.cats) return;
    CAT_GROUPS.forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g[1];
      FM.cats.list(g[0]).forEach(function (c) {
        var o = document.createElement('option');
        o.value = g[0] + ':' + c.key;
        o.textContent = c.label;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = CAT_DEFAULT;
  }

  // คืน { group, key } ของตัวเลือกปัจจุบัน หรือ null ถ้าไม่มี
  function readCat() {
    var v = String(els.cat.value || '');
    var i = v.indexOf(':');
    if (i < 1) return null;
    return { group: v.slice(0, i), key: v.slice(i + 1) };
  }

  function setCatError(msg) {
    els.catError.textContent = msg || '';
    els.catError.hidden = !msg;
    if (msg) {
      els.cat.setAttribute('aria-invalid', 'true');
      els.cat.setAttribute('aria-describedby', 'slip-cat-help slip-cat-error');
    } else {
      els.cat.removeAttribute('aria-invalid');
      els.cat.setAttribute('aria-describedby', 'slip-cat-help');
    }
  }

  function setOcrError(msg) {
    els.ocrError.textContent = msg || '';
    els.ocrError.hidden = !msg;
  }

  function setDone(msg) {
    clearTimeout(doneTimer);
    els.done.textContent = msg || '';
    if (msg) doneTimer = setTimeout(function () { els.done.textContent = ''; }, DONE_MS);
  }

  function setActionsEnabled(on) {
    els.income.disabled = !on;
    els.expense.disabled = !on;
  }

  function refreshActions() {
    var ok = !state.running && !state.saving && !!parseField(els.input.value).value;
    setActionsEnabled(ok);
  }

  function clearChips() {
    els.chips.textContent = '';
    els.chips.hidden = true;
  }

  function renderChips(values) {
    clearChips();
    if (!values || !values.length) return;
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn slip__chip';
      // ห่อเป็น span เดียว ไม่ให้ gap ของ .btn แยกข้อความกับตัวเลข
      var t = document.createElement('span');
      t.appendChild(document.createTextNode('หรือเป็น '));
      var n = document.createElement('span');
      n.className = 'num';
      n.textContent = FM.fmtMoney(v);
      t.appendChild(n);
      t.appendChild(document.createTextNode('?'));
      b.appendChild(t);
      b.addEventListener('click', function () {
        els.input.value = fmtPlain(v);
        setFieldError('');
        refreshActions();
        els.input.focus();
      });
      els.chips.appendChild(b);
    });
    els.chips.hidden = false;
  }

  function showEmptyView() {
    els.work.hidden = true;
    els.drop.hidden = false;
  }

  function showWorkView() {
    els.drop.hidden = true;
    els.work.hidden = false;
  }

  function showRunningView() {
    els.progress.hidden = false;
    els.skeleton.hidden = false;
    els.result.hidden = true;
    els.retry.hidden = true;
    setOcrError('');
    setFieldError('');
    setCatError('');
    clearChips();
    els.input.value = '';
    setActionsEnabled(false);
  }

  function showResultView() {
    els.progress.hidden = true;
    els.skeleton.hidden = true;
    els.result.hidden = false;
    refreshActions();
  }

  /* ---------- file intake ---------- */
  function validate(f) {
    if (!f) return 'ไม่พบไฟล์ ลองเลือกรูปสลิปอีกครั้ง';
    if (!f.type || f.type.indexOf('image/') !== 0) return 'ไฟล์นี้ไม่ใช่รูปภาพ เลือกไฟล์รูปสลิป เช่น JPG หรือ PNG';
    if (f.size > MAX_BYTES) return 'ไฟล์ใหญ่เกิน 10 MB ลองครอปหรือแคปหน้าจอสลิปใหม่แล้วเลือกอีกครั้ง';
    if (f.size === 0) return 'ไฟล์นี้ว่างเปล่า เลือกรูปสลิปใหม่อีกครั้ง';
    return '';
  }

  function revokeUrl() {
    if (state.url) {
      try { URL.revokeObjectURL(state.url); } catch (e) { /* ignore */ }
      state.url = '';
    }
  }

  function acceptFile(f) {
    if (state.saving) return;
    var msg = validate(f);
    if (msg) { setFileError(msg); return; }

    var hadFocusInRoot = els.root.contains(document.activeElement);
    setDone('');
    revokeUrl();
    state.file = f;
    state.url = URL.createObjectURL(f);
    setFileError('');
    els.thumb.src = state.url;
    els.name.textContent = f.name || 'รูปจากคลิปบอร์ด';
    els.size.textContent = fmtSize(f.size);
    showWorkView();
    if (hadFocusInRoot) els.change.focus();
    startOcr();
  }

  /* ---------- OCR ---------- */
  var LOAD_TEXT = 'กำลังโหลดตัวอ่านภาษา…';
  var READ_TEXT = 'กำลังอ่านสลิป…';

  function loadStep(status) {
    if (status.indexOf('core') !== -1) return 0;
    if (status.indexOf('language') !== -1) return 2;
    if (status.indexOf('api') !== -1) return 3;
    if (status.indexOf('tesseract') !== -1) return 1;
    return 0;
  }

  function startOcr() {
    if (!state.file || !state.url) return;
    var token = ++state.run;
    var jobId = 'slip-' + token;
    // ถ้ารอบก่อนยังอ่านอยู่ ไม่ terminate worker (Tesseract 5.0.5 โยน unhandled rejection
    // ถ้าปิดระหว่าง recognize) — งานเก่าเข้าคิวจนจบ แล้วผลถูกทิ้งด้วย token/jobId
    state.running = true;

    var hadWorker = !!worker;
    var prog = 0;
    state.phase = hadWorker ? 'read' : 'load';
    showRunningView();
    setStatus(hadWorker ? READ_TEXT : LOAD_TEXT, 'running');
    setProgress(0);

    onLog = function (m) {
      if (token !== state.run || !m) return;
      // progress ของงานรอบเก่าที่ยังค้างในคิว → ไม่นับ
      if (m.userJobId && String(m.userJobId).indexOf('slip-') === 0 && m.userJobId !== jobId) return;
      var st = String(m.status || '');
      var p = Number(m.progress);
      if (!isFinite(p)) p = 0;
      var next;
      if (st.indexOf('recognizing') === 0) {
        var base = hadWorker ? 0 : LOAD_SHARE;
        next = base + (1 - base) * p;
        if (state.phase !== 'read') { state.phase = 'read'; setStatus(READ_TEXT, 'running'); }
      } else {
        next = LOAD_SHARE * (loadStep(st) + p) / 4;
      }
      prog = Math.max(prog, Math.min(1, next));
      setProgress(prog);
    };

    var canvas = null;
    var prepP = prepare(state.url, state.file);
    var workerP = getWorker();
    workerP.catch(noop); // กัน unhandled rejection ถ้า prepare ล้มก่อน

    prepP.then(function (prep) {
      canvas = prep.canvas;
      if (token !== state.run) throw err('stale');
      return workerP.then(function (w) {
        if (token !== state.run) throw err('stale');
        if (state.phase !== 'read') { state.phase = 'read'; setStatus(READ_TEXT, 'running'); }
        var job;
        try {
          job = w.recognize(prep.input, {}, { text: true, blocks: false, hocr: false, tsv: false }, jobId);
        } catch (e) {
          throw err('read');
        }
        return withTimeout(Promise.resolve(job), READ_TIMEOUT, 'readtimeout').catch(function (e) {
          if (e && e.code === 'readtimeout') { if (token === state.run) dropWorker(); throw err('read'); }
          throw (e && e.code) ? e : err('read');
        });
      });
    }).then(function (res) {
      if (token !== state.run) return;
      var text = (res && res.data && res.data.text) || '';
      finishOcr(parseAmount(text));
    }, function (e) {
      if (token !== state.run) return;
      failOcr(e && e.code);
    }).then(function () {
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
    });
  }

  function endRun() {
    state.running = false;
    onLog = null;
    setProgress(1);
  }

  function finishOcr(result) {
    endRun();
    showResultView();
    if (result.amount != null) {
      els.input.value = fmtPlain(result.amount);
      setStatus('อ่านเสร็จแล้ว พบยอด ' + FM.fmtMoney(result.amount) + ' ตรวจสอบก่อนบันทึก', 'done');
      els.retry.hidden = true;
    } else {
      els.input.value = '';
      setStatus('อ่านยอดจากสลิปไม่เจอ กรอกเองได้เลย', 'error');
      els.retry.hidden = false;
    }
    renderChips(result.alternatives);
    refreshActions();
  }

  function failOcr(code) {
    endRun();
    var offline = navigator.onLine === false;
    var msg;
    if (code === 'nolib') {
      msg = 'โหลดตัวอ่านสลิปไม่ได้ (อาจออฟไลน์หรือเครือข่ายบล็อก) เชื่อมต่ออินเทอร์เน็ตแล้วรีโหลดหน้า หรือกรอกยอดเองด้านล่าง';
    } else if (code === 'image') {
      msg = 'เปิดรูปนี้ไม่ได้ ลองบันทึกเป็น JPG หรือ PNG แล้วเลือกใหม่ หรือกรอกยอดเองด้านล่าง';
    } else if (code === 'load' || offline) {
      msg = offline
        ? 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต ครั้งแรกต้องใช้อินเทอร์เน็ตเพื่อโหลดตัวอ่านภาษาไทย เชื่อมต่อแล้วกด "ลองอ่านใหม่" หรือกรอกยอดเองด้านล่าง'
        : 'โหลดตัวอ่านภาษาไทยไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วกด "ลองอ่านใหม่" หรือกรอกยอดเองด้านล่าง';
    } else if (code === 'stopped') {
      msg = 'การอ่านสลิปถูกหยุดกลางคัน กด "ลองอ่านใหม่" หรือกรอกยอดเองด้านล่าง';
    } else {
      msg = 'อ่านสลิปไม่สำเร็จ ลองใช้รูปที่ชัดขึ้นแล้วกด "ลองอ่านใหม่" หรือกรอกยอดเองด้านล่าง';
    }
    showResultView();
    els.input.value = '';
    clearChips();
    setStatus('อ่านสลิปไม่สำเร็จ', 'error');
    setOcrError(msg);
    els.retry.hidden = false;
    refreshActions();
  }

  /* ---------- confirm ---------- */
  function confirm(type) {
    if (state.saving || state.running) return;
    var r = parseField(els.input.value);
    if (!r.value) {
      setFieldError(r.error);
      els.input.focus();
      return;
    }
    // หมวดต้องเป็นของชนิดที่กด ("อื่นๆ" มีทั้งสองชนิดจึงใช้ได้กับทั้งสองปุ่ม) — ไม่เปลี่ยนให้เอง
    var category = null;
    var cat = readCat();
    if (FM.cats && cat) {
      if (!FM.cats.isValid(type, cat.key)) {
        setCatError(type === 'expense'
          ? 'หมวดนี้เป็นของรายรับ เลือกหมวดรายจ่ายหรือกดรายรับ'
          : 'หมวดนี้เป็นของรายจ่าย เลือกหมวดรายรับหรือกดรายจ่าย');
        els.cat.focus();
        return;
      }
      category = cat.key;
    }
    setCatError('');
    var cur = Number(FM.get('balance', 0));
    if (!isFinite(cur)) cur = 0;
    var bal = round2(type === 'income' ? cur + r.value : cur - r.value);
    if (bal === 0) bal = 0; // กัน -0
    if (Math.abs(bal) > MAX_AMOUNT) {
      setFieldError('ยอดรวมจะเกิน 1,000,000,000,000 บาท');
      els.input.focus();
      return;
    }

    state.saving = true;
    setActionsEnabled(false);

    var prevTx = FM.get('tx', []);
    if (!Array.isArray(prevTx)) prevTx = [];
    var tx = prevTx.slice();
    tx.push({ id: FM.uid(), type: type, amount: r.value, ts: Date.now(), source: 'slip', category: category });

    var ok1 = FM.set('balance', bal);
    var ok2 = FM.set('tx', tx);
    if (FM.storageOk && (!ok1 || !ok2)) {
      // เขียนไม่ครบ → ย้อนค่าเดิม ไม่ให้ยอดกับประวัติไม่ตรงกัน
      FM.set('balance', cur);
      FM.set('tx', prevTx);
      state.saving = false;
      setFieldError('บันทึกไม่สำเร็จ พื้นที่เบราว์เซอร์อาจเต็ม ลองลบรายการเก่าแล้วกดอีกครั้ง');
      refreshActions();
      return;
    }

    FM.emit('balance:changed', bal);
    FM.emit('tx:changed', tx);

    var label = type === 'income' ? 'รายรับ' : 'รายจ่าย';
    reset();
    state.saving = false;
    setDone('บันทึกเป็น' + label + ' ' + FM.fmtMoney(r.value) + ' แล้ว');
    els.file.focus();
  }

  /* ---------- reset ---------- */
  function reset() {
    state.run++; // ทิ้งผลที่อาจค้าง
    if (state.running) { dropWorker(); state.running = false; }
    onLog = null;
    revokeUrl();
    state.file = null;
    state.phase = '';
    els.thumb.removeAttribute('src');
    els.name.textContent = '';
    els.size.textContent = '';
    els.input.value = '';
    els.file.value = '';
    clearChips();
    setFieldError('');
    setCatError('');
    if (els.cat.options.length) els.cat.value = CAT_DEFAULT;
    setOcrError('');
    setFileError('');
    setStatus('', '');
    setProgress(0);
    setActionsEnabled(false);
    showEmptyView();
  }

  /* ---------- drag & drop / paste ---------- */
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
    return false;
  }

  function setDrag(on) {
    els.root.classList.toggle('is-dragover', on);
  }

  function isEditable(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return t.type !== 'file' && t.type !== 'button' && t.type !== 'checkbox' && t.type !== 'radio';
    return false;
  }

  function onPaste(e) {
    if (state.saving || isEditable(e.target)) return;
    var cd = e.clipboardData;
    if (!cd) return;
    var file = null;
    var i;
    if (cd.files && cd.files.length) {
      for (i = 0; i < cd.files.length; i++) {
        if (cd.files[i].type && cd.files[i].type.indexOf('image/') === 0) { file = cd.files[i]; break; }
      }
    }
    if (!file && cd.items) {
      for (i = 0; i < cd.items.length; i++) {
        var it = cd.items[i];
        if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) { file = it.getAsFile(); if (file) break; }
      }
    }
    if (!file) return;

    // วางรูปตอนลิ้นชักปิดอยู่ → เปิดลิ้นชักก่อน (ไม่อ่านสลิปแบบมองไม่เห็น)
    var drawer = els.root.closest ? els.root.closest('dialog') : null;
    if (drawer) {
      // มีกล่องโต้ตอบอื่นเปิดอยู่ (ปรับยอด / เข้าสู่ระบบ) → ไม่ซ้อนลิ้นชักทับ
      var open = document.querySelectorAll('dialog[open]');
      for (i = 0; i < open.length; i++) if (open[i] !== drawer) return;
      // FM.ui.openSlip ไม่ทำอะไรถ้าเปิดอยู่แล้ว และยกเลิกการปิดถ้ากำลังเล่น animation ปิด
      if (FM.ui && typeof FM.ui.openSlip === 'function') FM.ui.openSlip();
      if (!drawer.open) return;
    }
    e.preventDefault();
    acceptFile(file);
  }

  /* ---------- build ---------- */
  function build(root) {
    root.textContent = '';
    root.classList.add('slip');
    root.innerHTML = TEMPLATE;
    els = { root: root };
    Array.prototype.forEach.call(root.querySelectorAll('[data-el]'), function (n) {
      els[n.getAttribute('data-el')] = n;
    });

    els.file.addEventListener('change', function () {
      var f = els.file.files && els.file.files[0];
      if (f) acceptFile(f);
      // ล้างค่า เพื่อให้เลือกไฟล์เดิมซ้ำได้
      try { els.file.value = ''; } catch (e) { /* ignore */ }
    });

    els.change.addEventListener('click', function () {
      if (state.saving) return;
      els.file.click();
    });

    els.retry.addEventListener('click', function () {
      if (state.saving || state.running || !state.file) return;
      startOcr();
    });

    els.input.addEventListener('input', function () {
      if (!els.fieldError.hidden && !parseField(els.input.value).error) setFieldError('');
      refreshActions();
    });
    els.input.addEventListener('change', function () {
      var r = parseField(els.input.value);
      setFieldError(r.empty ? '' : (r.error || ''));
      refreshActions();
    });
    els.input.addEventListener('keydown', function (e) {
      // Enter ไม่บันทึกเอง — ผู้ใช้ต้องเลือกรายรับ/รายจ่ายชัดเจน
      if (e.key === 'Enter') e.preventDefault();
    });

    fillCats(els.cat);
    if (!els.cat.options.length) els.catField.hidden = true; // ไม่มี FM.cats → บันทึก category = null
    els.cat.addEventListener('change', function () { setCatError(''); });

    els.income.addEventListener('click', function () { confirm('income'); });
    els.expense.addEventListener('click', function () { confirm('expense'); });

    root.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setDrag(true);
    });
    root.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = state.saving ? 'none' : 'copy';
    });
    root.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) setDrag(false);
    });
    root.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDrag(false);
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) acceptFile(f);
    });
  }

  function init() {
    var root = document.getElementById('slip-root');
    if (!root) return;
    build(root);
    reset();

    document.addEventListener('paste', onPaste);

    window.addEventListener('pagehide', function () {
      if (state.running) {
        state.run++;
        failOcr('stopped');
      }
      dropWorker();
    });
  }

  FM.slip = { init: init, _parseAmount: parseAmount };
})();
