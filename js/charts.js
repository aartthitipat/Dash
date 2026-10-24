/* charts.js — ชุดกราฟหน้าภาพรวม (Chart.js 4.4.1) + รายการล่าสุด
 * ช่อง (index.html): #charts-bar, #charts-hbar, #charts-donut, #charts-area, #recent-root → เติมใน .slot__body
 * - ข้อมูลจาก FM.get('tx') อ่านใหม่ทุกครั้งที่ 'tx:changed', แถวที่ไม่ถูกต้องถูกข้าม
 * - ช่วง 7/30 วันใช้ร่วมกันระหว่างกราฟแท่งและกราฟพื้นที่: เก็บใน fm.chartRange, แจ้งด้วย FM event 'chart:range' (โมดูลนี้เป็นเจ้าของ)
 * - สีอ่านจาก token จริงขณะวาด (scriptable) → 'theme:changed' วาดใหม่โดยไม่สร้างกราฟใหม่
 * - หน้าภาพรวมถูกซ่อนเมื่ออยู่หน้าอื่น: 'route:changed' = 'overview' → resize() กราฟทุกตัว
 * ต้องโหลดต่อจาก store.js และ categories.js; main.js เรียก FM.charts.init() */
(function () {
  'use strict';

  var RANGES = [7, 30];
  var RANGE_KEY = 'chartRange';
  var HBAR_TOP = 6;      // แท่งนอน: หมวดสูงสุด 6 แท่ง + "อื่นๆ"
  var DONUT_MAX = 5;     // โดนัท: ไล่เฉดได้ไม่เกิน 5 ชิ้น + "อื่นๆ"/"ไม่ระบุ"
  var NONE = '__none';
  var REST = '__rest';
  var MINUS = '−';
  var WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  // ตัวเลขใช้ Geist Mono; อักษรไทยในบรรทัดเดียวกันตกไปที่ Noto Sans Thai ตามลำดับฟอนต์
  var FONT_MIX = '"Geist Mono", "Noto Sans Thai", ui-monospace, "SFMono-Regular", Menlo, monospace';
  var FONT_TEXT = '"Noto Sans Thai", "Outfit", system-ui, sans-serif';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var S = {
    started: false,
    range: 7,
    C: null,          // สีที่อ่านจาก token (rgb)
    views: {},        // DOM ของแต่ละช่อง
    charts: { bar: null, area: null, hbar: null, donut: null },
    probe: null,
    mqReduce: null
  };

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function icon(paths, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 28));
    svg.setAttribute('height', String(size || 28));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  }

  function money(v) { return FM.fmtMoney(Math.abs(v)); }

  /* +฿… / −฿… (เครื่องหมายลบจริง U+2212) */
  function signed(v) {
    var n = round2(Number(v) || 0);
    return (n > 0 ? '+' : n < 0 ? MINUS : '') + money(n);
  }

  function compact(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var abs = Math.abs(n);
    var sign = n < 0 ? MINUS : '';
    function trim(x) { return (Math.round(x * 10) / 10).toString(); }
    if (abs >= 1e6) return sign + trim(abs / 1e6) + 'M';
    if (abs >= 1e3) return sign + trim(abs / 1e3) + 'k';
    return sign + trim(abs);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

  /* ข้อความผสมตัวเลข: ตัวเลขห่อด้วย .num (Geist Mono), ส่วนอื่นเป็นข้อความธรรมดา */
  function appendMixed(node, text) {
    String(text).split(/(\d[\d,.:/]*)/).forEach(function (part, i) {
      if (!part) return;
      if (i % 2 === 1) node.appendChild(el('span', 'num', part));
      else node.appendChild(document.createTextNode(part));
    });
  }

  function cats() {
    return FM.cats || {
      isValid: function () { return false; },
      label: function () { return 'ไม่ระบุ'; },
      NONE_LABEL: 'ไม่ระบุ'
    };
  }

  function reducedMotion() { return !!(S.mqReduce && S.mqReduce.matches); }

  function animOpts() {
    return reducedMotion() ? false : { duration: 500, easing: 'easeOutQuart' };
  }

  function hasLib() { return typeof window.Chart === 'function'; }

  /* ---------- สีจาก token ---------- */
  function parseRgb(s) {
    var m = /rgba?\(([^)]+)\)/.exec(String(s || ''));
    if (!m) return null;
    var p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 && isFinite(p[3]) ? p[3] : 1 };
  }

  function rgbStr(c, alpha) {
    var a = alpha == null ? c.a : alpha;
    var r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b);
    return a >= 1 ? 'rgb(' + r + ', ' + g + ', ' + b + ')' : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
  }

  function lin(v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }

  function contrast(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
  }

  function readToken(name) {
    var p = S.probe;
    p.style.color = '';
    p.style.color = 'var(' + name + ')';
    return parseRgb(getComputedStyle(p).color) || { r: 128, g: 128, b: 128, a: 1 };
  }

  /* ปลายไล่เฉด: ปกติ = --sky; ถ้า --sky อยู่ระหว่าง --blue กับพื้นการ์ด (โหมดสว่าง ทั้งคู่เข้มใกล้กัน)
   * ขยับ --sky ไปทาง --surface จนเหลือ contrast 3.2:1 กับพื้น เพื่อให้เฉดที่ติดกันแยกออกจากกันได้ */
  function rampEnd(blue, sky, surface) {
    var lb = lum(blue), ls = lum(sky), lf = lum(surface);
    if ((ls - lb) * (lf - ls) <= 0 || contrast(sky, surface) <= 3.2) return sky;
    var lo = 0, hi = 1, best = sky;
    for (var i = 0; i < 24; i++) {
      var t = (lo + hi) / 2;
      var c = mix(sky, surface, t);
      if (contrast(c, surface) >= 3.2) { best = c; lo = t; } else hi = t;
    }
    return best;
  }

  function readColors() {
    var raw = {
      blue: readToken('--blue'),
      sky: readToken('--sky'),
      skyGraphic: readToken('--sky-graphic'),
      ink: readToken('--ink'),
      muted: readToken('--muted'),
      line: readToken('--line'),
      lineStrong: readToken('--line-strong'),
      surface: readToken('--surface'),
      surface2: readToken('--surface-2')
    };
    var end = rampEnd(raw.blue, raw.sky, raw.surface);
    var C = {};
    Object.keys(raw).forEach(function (k) { C[k] = rgbStr(raw[k], 1); });
    C.blueFill = rgbStr(raw.blue, 0.2);
    C.raw = raw;
    C.rampEnd = end;
    C._ramps = {};
    C.ramp = function (n) {
      if (C._ramps[n]) return C._ramps[n];
      var out = [];
      for (var i = 0; i < n; i++) out.push(rgbStr(n === 1 ? raw.blue : mix(raw.blue, end, i / (n - 1)), 1));
      C._ramps[n] = out;
      return out;
    };
    return C;
  }

  /* สีของแถวหมวด: ไล่เฉดตามลำดับ, "อื่นๆ" = --line-strong, "ไม่ระบุ" = --muted (เทาน้ำเงินทั้งคู่) */
  function rowColor(row, rampCount) {
    if (!row) return S.C.blue;
    if (row.key === REST) return S.C.lineStrong;
    if (row.key === NONE) return S.C.muted;
    return S.C.ramp(Math.max(1, rampCount))[row.rank] || S.C.blue;
  }

  /* ---------- ข้อมูล ---------- */
  function validTx() {
    var raw = FM.get('tx', []);
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (!t || typeof t !== 'object') continue;
      if (t.type !== 'income' && t.type !== 'expense') continue;
      var amt = num(t.amount);
      var ts = num(t.ts);
      if (!isFinite(amt) || amt < 0 || !isFinite(ts)) continue;
      if (isNaN(new Date(ts).getTime())) continue;
      out.push({ type: t.type, amount: amt, ts: ts, source: t.source, category: t.category });
    }
    return out;
  }

  function rangeData(tx, n) {
    var now = new Date();
    var days = [];
    var index = {};
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      index[dayKey(d)] = days.length;
      days.push({
        date: d,
        // 7 วัน: 2 บรรทัด (วัน / วันที่) ให้แสดงครบทุกวันแม้จอแคบ; 30 วัน: "23/10" แล้วให้ autoSkip เว้นเอง
        label: n <= 7 ? [WEEKDAYS[d.getDay()], String(d.getDate())] : d.getDate() + '/' + (d.getMonth() + 1),
        full: WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()],
        income: 0,
        expense: 0
      });
    }
    tx.forEach(function (t) {
      var k = index[dayKey(new Date(t.ts))];
      if (k === undefined) return;
      days[k][t.type] += t.amount;
    });
    var totalIn = 0, totalOut = 0, cum = 0;
    days.forEach(function (d) {
      d.income = round2(d.income);
      d.expense = round2(d.expense);
      d.net = round2(d.income - d.expense);
      cum = round2(cum + d.net);
      d.cum = cum;
      totalIn += d.income;
      totalOut += d.expense;
    });
    totalIn = round2(totalIn);
    totalOut = round2(totalOut);
    return { n: n, days: days, totalIn: totalIn, totalOut: totalOut, empty: totalIn === 0 && totalOut === 0 };
  }

  function monthLabel(d) {
    try {
      return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    } catch (e) {
      return MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    }
  }

  function monthSums(tx, type) {
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth();
    var sums = {};
    var c = cats();
    tx.forEach(function (t) {
      if (t.type !== type) return;
      var d = new Date(t.ts);
      if (d.getFullYear() !== y || d.getMonth() !== m) return;
      var key = c.isValid(type, t.category) ? t.category : NONE;
      sums[key] = (sums[key] || 0) + t.amount;
    });
    return { sums: sums, month: monthLabel(now) };
  }

  function catLabel(type, key) {
    if (key === NONE) return cats().NONE_LABEL || 'ไม่ระบุ';
    if (key === REST) return cats().label(type, 'other');
    return cats().label(type, key);
  }

  /* เปอร์เซ็นต์ทศนิยม 1 ตำแหน่ง รวมได้ 100.0 พอดี (largest remainder) */
  function percents(rows, total) {
    if (!(total > 0)) return rows.map(function () { return 0; });
    var raw = rows.map(function (r) { return r.amount / total * 1000; });
    var base = raw.map(Math.floor);
    var left = 1000 - base.reduce(function (a, b) { return a + b; }, 0);
    var order = raw.map(function (v, i) { return { i: i, f: v - base[i] }; })
      .sort(function (a, b) { return b.f - a.f || a.i - b.i; });
    for (var k = 0; k < left && k < order.length; k++) base[order[k].i] += 1;
    return base.map(function (v) { return v / 10; });
  }

  function pctText(p) { return p.toFixed(1) + '%'; }

  function finishRows(rows, type) {
    var total = round2(rows.reduce(function (a, r) { return a + r.amount; }, 0));
    var pcts = percents(rows, total);
    var rank = 0;
    rows.forEach(function (r, i) {
      r.label = catLabel(type, r.key);
      r.pct = pcts[i];
      r.rank = r.key === NONE || r.key === REST ? -1 : rank++;
    });
    return { rows: rows, total: total, rampCount: rank };
  }

  /* แท่งนอน: เรียงมาก→น้อย (รวม "ไม่ระบุ"), 6 อันดับแรก, ที่เหลือ + หมวด "อื่นๆ" รวมเป็นแท่งสุดท้าย */
  function expenseRows(tx) {
    var ms = monthSums(tx, 'expense');
    var named = [], rest = 0;
    Object.keys(ms.sums).forEach(function (k) {
      var v = round2(ms.sums[k]);
      if (!(v > 0)) return;
      if (k === 'other') { rest += v; return; }
      named.push({ key: k, amount: v, label: catLabel('expense', k) });
    });
    named.sort(function (a, b) { return b.amount - a.amount || a.label.localeCompare(b.label, 'th'); });
    var rows = named.slice(0, HBAR_TOP);
    named.slice(HBAR_TOP).forEach(function (r) { rest += r.amount; });
    if (rest > 0) rows.push({ key: REST, amount: round2(rest) });
    var out = finishRows(rows, 'expense');
    out.month = ms.month;
    return out;
  }

  /* โดนัท: หมวดที่มีชื่อ เรียงมาก→น้อย ≤5 ชิ้น, จากนั้น "อื่นๆ" และ "ไม่ระบุ" */
  function incomeRows(tx) {
    var ms = monthSums(tx, 'income');
    var named = [], rest = 0, none = 0;
    Object.keys(ms.sums).forEach(function (k) {
      var v = round2(ms.sums[k]);
      if (!(v > 0)) return;
      if (k === 'other') rest += v;
      else if (k === NONE) none += v;
      else named.push({ key: k, amount: v, label: catLabel('income', k) });
    });
    named.sort(function (a, b) { return b.amount - a.amount || a.label.localeCompare(b.label, 'th'); });
    var rows = named.slice(0, DONUT_MAX);
    named.slice(DONUT_MAX).forEach(function (r) { rest += r.amount; });
    if (rest > 0) rows.push({ key: REST, amount: round2(rest) });
    if (none > 0) rows.push({ key: NONE, amount: round2(none) });
    var out = finishRows(rows, 'income');
    out.month = ms.month;
    return out;
  }

  /* ---------- Chart.js: ตัวเลือกร่วม ---------- */
  function tooltipOpts(callbacks) {
    return {
      backgroundColor: function () { return S.C.surface; },
      titleColor: function () { return S.C.ink; },
      bodyColor: function () { return S.C.ink; },
      borderColor: function () { return S.C.line; },
      borderWidth: 1,
      padding: 10,
      cornerRadius: 10,
      boxPadding: 4,
      usePointStyle: true,
      titleFont: { family: FONT_MIX, weight: '600', size: 13 },
      bodyFont: { family: FONT_MIX, size: 13 },
      callbacks: callbacks
    };
  }

  function xCategory(n) {
    return {
      grid: { display: false },
      border: { display: false },
      ticks: {
        color: function () { return S.C.muted; },
        font: { family: FONT_MIX, size: 12 },
        maxRotation: 0,
        autoSkip: n > 7, // 7 วันแสดงครบทุกวัน (ป้าย 2 บรรทัดแคบพอที่ 320px)
        autoSkipPadding: 10
      }
    };
  }

  function yValue(zeroStrong) {
    return {
      beginAtZero: true,
      border: { display: false },
      grid: {
        drawTicks: false,
        color: function (ctx) {
          return zeroStrong && ctx.tick && ctx.tick.value === 0 ? S.C.lineStrong : S.C.line;
        },
        lineWidth: function (ctx) {
          return zeroStrong && ctx.tick && ctx.tick.value === 0 ? 1.5 : 1;
        }
      },
      ticks: {
        color: function () { return S.C.muted; },
        padding: 8,
        maxTicksLimit: 5,
        font: { family: FONT_MIX, size: 11 },
        callback: function (v) { return compact(v); }
      }
    };
  }

  /* ข้อมูลชุดปัจจุบันของกราฟ (ผูกไว้ที่ canvas ก่อนสร้าง/อัปเดต) */
  function fmData(chart) {
    return chart && chart.canvas ? chart.canvas.$fm : null;
  }

  function dayOf(items) {
    var it = items && items[0];
    var data = it && fmData(it.chart);
    var d = data && data.days[it.dataIndex];
    return d ? d.full : '';
  }

  /* สร้างหรืออัปเดตกราฟ: มีได้ตัวเดียวต่อ canvas, ไม่สร้างซ้ำ */
  function upsert(name, canvas, data, build, update, mode) {
    var ch = S.charts[name];
    if (ch && ch.canvas !== canvas) { ch.destroy(); ch = null; }
    if (!ch) {
      var existing = window.Chart.getChart ? window.Chart.getChart(canvas) : null;
      if (existing) existing.destroy();
      canvas.$fm = data; // callback/plugin อ่านผ่าน fmData() ได้ตั้งแต่เฟรมแรก
      ch = new window.Chart(canvas, build(data));
      S.charts[name] = ch;
      return ch;
    }
    canvas.$fm = data;
    ch.options.animation = animOpts();
    update(ch, data);
    ch.update(mode);
    return ch;
  }

  function drop(name) {
    var ch = S.charts[name];
    if (ch) {
      try { ch.destroy(); } catch (e) {}
      S.charts[name] = null;
    }
  }

  /* สถานะของช่อง: 'chart' | 'empty' | 'error' */
  function setState(v, state) {
    v.wrap.hidden = state !== 'chart';
    v.empty.hidden = state !== 'empty';
    v.error.hidden = state !== 'error';
  }

  /* ---------- DOM ส่วนร่วม ---------- */
  function stateBox(kind, text) {
    var box = el('div', 'charts__state charts__state--' + kind);
    if (kind === 'error') {
      box.setAttribute('role', 'alert');
      box.appendChild(icon(['M12 8v5', 'M12 16.5v.01', 'M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']));
    } else {
      box.appendChild(icon(['M4 20h16', 'M7 16v-4', 'M12 16V8', 'M17 16v-6']));
    }
    var p = el('p', 'charts__state-text');
    appendMixed(p, text);
    box.appendChild(p);
    box.hidden = true;
    return box;
  }

  function canvasWrap(mod, label) {
    var wrap = el('div', 'charts__wrap charts__wrap--' + mod);
    var canvas = el('canvas', 'charts__canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    wrap.appendChild(canvas);
    return { wrap: wrap, canvas: canvas };
  }

  /* ตารางข้อมูลสำหรับโปรแกรมอ่านหน้าจอ: ห่อด้วย div ซ่อนแบบ visually-hidden
   * (ตารางไม่ยอมหดตาม width:1px จึงล้นขอบจอเป็น scroll แนวนอนถ้าใส่ class ที่ตารางเอง) */
  function srTable(headers) {
    var box = el('div', 'charts-sr');
    var table = el('table');
    box.appendChild(table);
    var caption = el('caption');
    table.appendChild(caption);
    var thead = el('thead');
    var tr = el('tr');
    headers.forEach(function (h) {
      var th = el('th', null, h);
      th.setAttribute('scope', 'col');
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    var tbody = el('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    return { table: box, caption: caption, tbody: tbody };
  }

  function fillTable(t, caption, rows) {
    t.caption.textContent = caption;
    clear(t.tbody);
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (c, i) {
        var cell = el(i === 0 ? 'th' : 'td', null, c);
        if (i === 0) cell.setAttribute('scope', 'row');
        tr.appendChild(cell);
      });
      t.tbody.appendChild(tr);
    });
    t.table.hidden = rows.length === 0;
  }

  function errorText() {
    return 'โหลดกราฟไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีโหลดหน้า';
  }

  /* ---------- 1) กราฟแท่ง รายรับ vs รายจ่าย ---------- */
  function buildBar(body) {
    var box = el('div', 'charts charts--bar');

    var bar = el('div', 'charts__toolbar');
    var legend = el('ul', 'charts__legend');
    legend.setAttribute('aria-hidden', 'true');
    [['income', 'รายรับ'], ['expense', 'รายจ่าย']].forEach(function (it) {
      var li = el('li', 'charts__legend-item');
      li.appendChild(el('span', 'charts__swatch charts__swatch--' + it[0]));
      li.appendChild(document.createTextNode(it[1]));
      legend.appendChild(li);
    });

    var seg = el('div', 'charts__seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'ช่วงเวลาของกราฟ');
    var buttons = RANGES.map(function (n) {
      var b = el('button', 'charts__seg-btn');
      b.type = 'button';
      b.setAttribute('data-range', String(n));
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', n + ' วัน'); // ชื่อเดียวกับข้อความที่เห็น (ตัวเลขอยู่ใน span.num)
      b.appendChild(el('span', 'num', String(n)));
      b.appendChild(document.createTextNode(' วัน'));
      b.addEventListener('click', function () { setRange(n); });
      seg.appendChild(b);
      return b;
    });
    bar.appendChild(legend);
    bar.appendChild(seg);

    var cw = canvasWrap('bar', 'กราฟแท่งรายรับและรายจ่าย');
    var empty = stateBox('empty', '');
    var error = stateBox('error', errorText());

    var summary = el('div', 'charts__summary');
    summary.setAttribute('aria-live', 'polite');
    function sum(label, mod) {
      var p = el('p', 'charts__sum');
      var sw = el('span', 'charts__swatch charts__swatch--' + mod);
      sw.setAttribute('aria-hidden', 'true');
      p.appendChild(sw);
      p.appendChild(el('span', 'charts__sum-label', label));
      var v = el('span', 'charts__sum-value num');
      p.appendChild(v);
      summary.appendChild(p);
      return v;
    }
    var sumIn = sum('รายรับรวม', 'income');
    var sumOut = sum('รายจ่ายรวม', 'expense');

    var t = srTable(['วัน', 'รายรับ', 'รายจ่าย']);

    box.appendChild(bar);
    box.appendChild(cw.wrap);
    box.appendChild(empty);
    box.appendChild(error);
    box.appendChild(summary);
    box.appendChild(t.table);
    body.appendChild(box);

    return {
      legend: legend, buttons: buttons, wrap: cw.wrap, canvas: cw.canvas, empty: empty, error: error,
      summary: summary, sumIn: sumIn, sumOut: sumOut, t: t,
      title: document.getElementById('charts-bar-title')
    };
  }

  function barConfig(data) {
    function ds(label, key, color) {
      return {
        label: label,
        data: data.days.map(function (d) { return d[key]; }),
        backgroundColor: function () { return S.C[color]; },
        hoverBackgroundColor: function () { return S.C[color]; },
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 24,
        categoryPercentage: 0.72,
        barPercentage: 0.86
      };
    }
    return {
      type: 'bar',
      data: {
        labels: data.days.map(function (d) { return d.label; }),
        datasets: [ds('รายรับ', 'income', 'blue'), ds('รายจ่าย', 'expense', 'skyGraphic')]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animOpts(),
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: tooltipOpts({
            title: dayOf,
            label: function (ctx) { return ctx.dataset.label + ': ' + FM.fmtMoney(ctx.parsed.y); }
          })
        },
        scales: { x: xCategory(data.n), y: yValue(false) }
      }
    };
  }

  function renderBar(tx, mode) {
    var v = S.views.bar;
    if (!v) return;
    var data = rangeData(tx, S.range);
    var n = data.n;

    if (v.title) {
      clear(v.title);
      v.title.appendChild(document.createTextNode('รายรับและรายจ่าย '));
      v.title.appendChild(el('span', 'num', String(n)));
      v.title.appendChild(document.createTextNode(' วัน'));
    }
    v.buttons.forEach(function (b) {
      b.setAttribute('aria-pressed', Number(b.getAttribute('data-range')) === n ? 'true' : 'false');
    });

    v.sumIn.textContent = '+' + money(data.totalIn);
    v.sumOut.textContent = MINUS + money(data.totalOut);
    v.canvas.setAttribute('aria-label',
      'กราฟแท่งรายรับและรายจ่ายรายวัน ' + n + ' วันล่าสุด รายรับรวม ' + money(data.totalIn) +
      ' รายจ่ายรวม ' + money(data.totalOut));

    clear(v.empty.querySelector('.charts__state-text'));
    appendMixed(v.empty.querySelector('.charts__state-text'),
      'ยังไม่มีรายรับรายจ่ายใน ' + n + ' วันล่าสุด อ่านสลิปหรือบวกเพิ่มยอดเพื่อดูกราฟ' +
      (n === 7 ? ' หรือลองดูช่วง 30 วัน' : ''));

    fillTable(v.t, 'รายรับและรายจ่ายรายวัน ' + n + ' วันล่าสุด',
      data.empty ? [] : data.days.map(function (d) { return [d.full, FM.fmtMoney(d.income), FM.fmtMoney(d.expense)]; }));

    v.legend.hidden = data.empty || !hasLib();
    v.summary.hidden = data.empty;

    if (data.empty) { drop('bar'); setState(v, 'empty'); return; }
    if (!hasLib()) { drop('bar'); setState(v, 'error'); return; }
    setState(v, 'chart');
    try {
      upsert('bar', v.canvas, data, barConfig, function (ch, d) {
        ch.data.labels = d.days.map(function (x) { return x.label; });
        ch.data.datasets[0].data = d.days.map(function (x) { return x.income; });
        ch.data.datasets[1].data = d.days.map(function (x) { return x.expense; });
        ch.options.scales.x.ticks.autoSkip = d.n > 7;
      }, mode);
    } catch (e) {
      if (window.console) console.error(e);
      drop('bar');
      setState(v, 'error');
    }
  }

  /* ---------- 4) กราฟพื้นที่ การเปลี่ยนแปลงสุทธิสะสม ---------- */
  function buildArea(body) {
    var box = el('div', 'charts charts--area');
    var help = el('p', 'charts__help');
    var cw = canvasWrap('area', 'กราฟพื้นที่การเปลี่ยนแปลงสุทธิสะสม');
    var empty = stateBox('empty', '');
    var error = stateBox('error', errorText());
    var t = srTable(['วัน', 'สุทธิของวัน', 'สุทธิสะสม']);
    box.appendChild(help);
    box.appendChild(cw.wrap);
    box.appendChild(empty);
    box.appendChild(error);
    box.appendChild(t.table);
    body.appendChild(box);
    return { help: help, wrap: cw.wrap, canvas: cw.canvas, empty: empty, error: error, t: t };
  }

  function areaConfig(data) {
    return {
      type: 'line',
      data: {
        labels: data.days.map(function (d) { return d.label; }),
        datasets: [{
          label: 'การเปลี่ยนแปลงสุทธิสะสม',
          data: data.days.map(function (d) { return d.cum; }),
          borderColor: function () { return S.C.sky; },
          backgroundColor: function () { return S.C.blueFill; },
          pointBackgroundColor: function () { return S.C.sky; },
          pointBorderColor: function () { return S.C.surface; },
          pointHoverBackgroundColor: function () { return S.C.sky; },
          pointHoverBorderColor: function () { return S.C.surface; },
          fill: 'origin',
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          pointRadius: function (ctx) { var d = fmData(ctx.chart); return d && d.n <= 7 ? 3 : 0; },
          pointHoverRadius: 5,
          pointBorderWidth: 1.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animOpts(),
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 6, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: tooltipOpts({
            title: dayOf,
            label: function (ctx) { return 'สุทธิสะสม: ' + signed(ctx.parsed.y); },
            afterLabel: function (ctx) {
              var d = fmData(ctx.chart) && fmData(ctx.chart).days[ctx.dataIndex];
              return d ? 'สุทธิของวัน: ' + signed(d.net) : '';
            }
          })
        },
        scales: { x: xCategory(data.n), y: yValue(true) }
      }
    };
  }

  function renderArea(tx, mode) {
    var v = S.views.area;
    if (!v) return;
    var data = rangeData(tx, S.range);
    var n = data.n;
    var last = data.days[data.days.length - 1].cum;
    var min = Math.min.apply(null, data.days.map(function (d) { return d.cum; }));
    var max = Math.max.apply(null, data.days.map(function (d) { return d.cum; }));

    clear(v.help);
    appendMixed(v.help, 'รายรับลบรายจ่ายสะสมตลอด ' + n + ' วันล่าสุด (เริ่มนับจาก 0) ไม่ใช่ยอดเงินคงเหลือ');

    v.canvas.setAttribute('aria-label',
      'กราฟพื้นที่การเปลี่ยนแปลงสุทธิสะสม ' + n + ' วันล่าสุด ไม่ใช่ยอดเงินคงเหลือ สิ้นสุดที่ ' + signed(last) +
      ' ต่ำสุด ' + signed(min) + ' สูงสุด ' + signed(max));

    clear(v.empty.querySelector('.charts__state-text'));
    appendMixed(v.empty.querySelector('.charts__state-text'),
      'ยังไม่มีรายการใน ' + n + ' วันล่าสุด เมื่อบันทึกรายรับหรือรายจ่าย กราฟจะแสดงผลรวมสุทธิสะสมที่นี่');

    fillTable(v.t, 'การเปลี่ยนแปลงสุทธิสะสม ' + n + ' วันล่าสุด (ไม่ใช่ยอดเงินคงเหลือ)',
      data.empty ? [] : data.days.map(function (d) { return [d.full, signed(d.net), signed(d.cum)]; }));

    if (data.empty) { drop('area'); setState(v, 'empty'); return; }
    if (!hasLib()) { drop('area'); setState(v, 'error'); return; }
    setState(v, 'chart');
    try {
      upsert('area', v.canvas, data, areaConfig, function (ch, d) {
        ch.data.labels = d.days.map(function (x) { return x.label; });
        ch.data.datasets[0].data = d.days.map(function (x) { return x.cum; });
        ch.options.scales.x.ticks.autoSkip = d.n > 7;
      }, mode);
    } catch (e) {
      if (window.console) console.error(e);
      drop('area');
      setState(v, 'error');
    }
  }

  /* ---------- 2) แท่งนอน รายจ่ายเดือนนี้ตามหมวด ---------- */
  function fitText(ctx, text, maxW) {
    if (maxW <= 0) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  /* plugin เฉพาะกราฟนี้ (ไม่ register ทั้งระบบ): ราง (track) หลังแท่ง + ชื่อหมวดซ้าย / จำนวนเงินขวา เหนือแท่ง */
  var hbarLabels = {
    id: 'fmHbarLabels',
    beforeDatasetsDraw: function (chart) {
      var meta = chart.getDatasetMeta(0);
      var area = chart.chartArea;
      var ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = S.C.surface2;
      meta.data.forEach(function (bar) {
        var p = bar.getProps(['y', 'height'], true);
        var h = p.height, y = p.y - h / 2, w = area.right - area.left;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(area.left, y, w, h, 4);
        else ctx.rect(area.left, y, w, h);
        ctx.fill();
      });
      ctx.restore();
    },
    afterDatasetsDraw: function (chart) {
      var data = fmData(chart);
      if (!data) return;
      var meta = chart.getDatasetMeta(0);
      var area = chart.chartArea;
      var ctx = chart.ctx;
      ctx.save();
      ctx.textBaseline = 'alphabetic';
      meta.data.forEach(function (bar, i) {
        var row = data.rows[i];
        if (!row) return;
        var p = bar.getProps(['y', 'height'], true);
        var y = p.y - p.height / 2 - 7;
        var amount = FM.fmtMoney(row.amount);
        ctx.font = '500 13px ' + FONT_MIX;
        var aw = ctx.measureText(amount).width;
        ctx.fillStyle = S.C.ink;
        ctx.textAlign = 'right';
        ctx.fillText(amount, area.right, y);
        ctx.font = '400 13px ' + FONT_TEXT;
        ctx.textAlign = 'left';
        ctx.fillText(fitText(ctx, row.label, area.right - area.left - aw - 12), area.left, y);
      });
      ctx.restore();
    }
  };

  function buildHbar(body) {
    var box = el('div', 'charts charts--hbar');
    var cw = canvasWrap('hbar', 'กราฟแท่งแนวนอนรายจ่ายเดือนนี้ตามหมวด');
    var empty = stateBox('empty', 'ยังไม่มีรายจ่ายในเดือนนี้ อ่านสลิปแล้วกด “รายจ่าย” เพื่อดูว่าเงินออกไปที่หมวดไหน');
    var error = stateBox('error', errorText());
    var summary = el('p', 'charts__total');
    summary.appendChild(el('span', 'charts__sum-label', 'รวมรายจ่ายเดือนนี้'));
    var total = el('span', 'charts__sum-value num');
    summary.appendChild(total);
    var t = srTable(['หมวด', 'จำนวน', 'สัดส่วน']);
    box.appendChild(cw.wrap);
    box.appendChild(empty);
    box.appendChild(error);
    box.appendChild(summary);
    box.appendChild(t.table);
    body.appendChild(box);
    return { wrap: cw.wrap, canvas: cw.canvas, empty: empty, error: error, summary: summary, total: total, t: t };
  }

  function hbarConfig(data) {
    return {
      type: 'bar',
      data: {
        labels: data.rows.map(function (r) { return r.label; }),
        datasets: [{
          label: 'รายจ่าย',
          data: data.rows.map(function (r) { return r.amount; }),
          backgroundColor: function (ctx) {
            var d = fmData(ctx.chart);
            return d ? rowColor(d.rows[ctx.dataIndex], d.rampCount) : S.C.blue;
          },
          hoverBackgroundColor: function (ctx) {
            var d = fmData(ctx.chart);
            return d ? rowColor(d.rows[ctx.dataIndex], d.rampCount) : S.C.blue;
          },
          borderRadius: 4,
          borderSkipped: false,
          categoryPercentage: 1,
          barPercentage: 0.36,
          maxBarThickness: 20
        }]
      },
      plugins: [hbarLabels],
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: animOpts(),
        layout: { padding: { top: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: tooltipOpts({
            title: function (items) { return items.length ? items[0].label : ''; },
            label: function (ctx) {
              var r = fmData(ctx.chart) && fmData(ctx.chart).rows[ctx.dataIndex];
              return 'รายจ่าย: ' + FM.fmtMoney(ctx.parsed.x) + (r ? ' (' + pctText(r.pct) + ')' : '');
            }
          })
        },
        scales: {
          x: { display: false, beginAtZero: true, max: data.max },
          y: { display: false }
        }
      }
    };
  }

  function renderHbar(tx, mode) {
    var v = S.views.hbar;
    if (!v) return;
    var data = expenseRows(tx);
    data.max = data.rows.reduce(function (a, r) { return Math.max(a, r.amount); }, 0);
    var empty = data.rows.length === 0;

    v.box = v.box || v.wrap.parentNode;
    v.box.style.setProperty('--hbar-rows', String(Math.max(1, data.rows.length)));
    v.total.textContent = MINUS + money(data.total);
    v.summary.hidden = empty;

    var top = data.rows[0];
    v.canvas.setAttribute('aria-label',
      'กราฟแท่งแนวนอนรายจ่ายเดือน' + data.month + ' ตามหมวด ' + data.rows.length + ' แท่ง' +
      (top ? ' มากที่สุดคือ ' + top.label + ' ' + money(top.amount) : '') + ' รวม ' + money(data.total));

    fillTable(v.t, 'รายจ่ายเดือน' + data.month + ' ตามหมวด เรียงจากมากไปน้อย',
      data.rows.map(function (r) { return [r.label, FM.fmtMoney(r.amount), pctText(r.pct)]; }));

    if (empty) { drop('hbar'); setState(v, 'empty'); return; }
    if (!hasLib()) { drop('hbar'); setState(v, 'error'); return; }
    setState(v, 'chart');
    try {
      upsert('hbar', v.canvas, data, hbarConfig, function (ch, d) {
        ch.data.labels = d.rows.map(function (r) { return r.label; });
        ch.data.datasets[0].data = d.rows.map(function (r) { return r.amount; });
        ch.options.scales.x.max = d.max;
      }, mode);
    } catch (e) {
      if (window.console) console.error(e);
      drop('hbar');
      setState(v, 'error');
    }
  }

  /* ---------- 3) โดนัท รายรับเดือนนี้ตามหมวด ---------- */
  function buildDonut(body) {
    var box = el('div', 'charts charts--donut');
    var cw = canvasWrap('donut', 'กราฟโดนัทรายรับเดือนนี้ตามหมวด');
    var center = el('div', 'charts__center');
    center.setAttribute('aria-hidden', 'true');
    center.appendChild(el('span', 'charts__center-label', 'รวมเดือนนี้'));
    var centerValue = el('span', 'charts__center-value num');
    center.appendChild(centerValue);
    cw.wrap.appendChild(center);
    var empty = stateBox('empty', 'ยังไม่มีรายรับในเดือนนี้ กด “บวกเพิ่ม” หรืออ่านสลิปรายรับเพื่อดูสัดส่วนตามหมวด');
    var error = stateBox('error', errorText());
    var legend = el('ul', 'charts__keys');
    legend.setAttribute('aria-label', 'สัดส่วนรายรับตามหมวด');
    var t = srTable(['หมวด', 'จำนวน', 'สัดส่วน']);
    box.appendChild(cw.wrap);
    box.appendChild(empty);
    box.appendChild(error);
    box.appendChild(legend);
    box.appendChild(t.table);
    body.appendChild(box);
    return { wrap: cw.wrap, canvas: cw.canvas, centerValue: centerValue, empty: empty, error: error, legend: legend, t: t };
  }

  function donutConfig(data) {
    return {
      type: 'doughnut',
      data: {
        labels: data.rows.map(function (r) { return r.label; }),
        datasets: [{
          label: 'รายรับ',
          data: data.rows.map(function (r) { return r.amount; }),
          backgroundColor: function (ctx) {
            var d = fmData(ctx.chart);
            return d ? rowColor(d.rows[ctx.dataIndex], d.rampCount) : S.C.blue;
          },
          borderColor: function () { return S.C.surface; },
          hoverBorderColor: function () { return S.C.surface; },
          borderWidth: 2,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animOpts(),
        cutout: '70%',
        layout: { padding: 6 },
        plugins: {
          legend: { display: false },
          tooltip: tooltipOpts({
            title: function (items) { return items.length ? items[0].label : ''; },
            label: function (ctx) {
              var r = fmData(ctx.chart) && fmData(ctx.chart).rows[ctx.dataIndex];
              return 'รายรับ: ' + FM.fmtMoney(ctx.parsed) + (r ? ' (' + pctText(r.pct) + ')' : '');
            }
          })
        }
      }
    };
  }

  function renderDonut(tx, mode) {
    var v = S.views.donut;
    if (!v) return;
    var data = incomeRows(tx);
    var empty = data.rows.length === 0;

    v.centerValue.textContent = money(data.total);

    clear(v.legend);
    data.rows.forEach(function (r) {
      var li = el('li', 'charts__key');
      var sw = el('span', 'charts__key-swatch');
      sw.setAttribute('aria-hidden', 'true');
      sw.style.backgroundColor = rowColor(r, data.rampCount);
      li.appendChild(sw);
      li.appendChild(el('span', 'charts__key-name', r.label));
      var vals = el('span', 'charts__key-vals');
      vals.appendChild(el('span', 'charts__key-pct num', pctText(r.pct)));
      vals.appendChild(el('span', 'charts__key-amt num', FM.fmtMoney(r.amount)));
      li.appendChild(vals);
      v.legend.appendChild(li);
    });
    v.legend.hidden = empty;

    v.canvas.setAttribute('aria-label',
      'กราฟโดนัทรายรับเดือน' + data.month + ' ตามหมวด รวม ' + money(data.total) +
      (data.rows.length ? ' ' + data.rows.map(function (r) { return r.label + ' ' + pctText(r.pct); }).join(', ') : ''));

    fillTable(v.t, 'รายรับเดือน' + data.month + ' ตามหมวด',
      data.rows.map(function (r) { return [r.label, FM.fmtMoney(r.amount), pctText(r.pct)]; }));

    if (empty) { drop('donut'); setState(v, 'empty'); return; }
    if (!hasLib()) { drop('donut'); setState(v, 'error'); return; }
    setState(v, 'chart');
    try {
      upsert('donut', v.canvas, data, donutConfig, function (ch, d) {
        ch.data.labels = d.rows.map(function (r) { return r.label; });
        ch.data.datasets[0].data = d.rows.map(function (r) { return r.amount; });
      }, mode);
    } catch (e) {
      if (window.console) console.error(e);
      drop('donut');
      setState(v, 'error');
    }
  }

  /* ---------- 5) รายการล่าสุด ---------- */
  function buildRecent(body) {
    var box = el('div', 'recent');
    var list = el('ul', 'recent__list');
    var empty = el('div', 'charts__state charts__state--empty recent__empty');
    empty.appendChild(icon(['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6M9 16h3']));
    empty.appendChild(el('p', 'charts__state-text', 'ยังไม่มีรายการ อ่านสลิปหรือกด “บวกเพิ่ม” เพื่อเริ่มบันทึก'));
    empty.hidden = true;
    var foot = el('a', 'recent__all');
    foot.href = '#/tx';
    foot.appendChild(el('span', null, 'ดูทั้งหมด'));
    foot.appendChild(icon(['M9 6l6 6-6 6'], 18));
    box.appendChild(list);
    box.appendChild(empty);
    box.appendChild(foot);
    body.appendChild(box);
    return { list: list, empty: empty };
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  function whenText(ts) {
    var d = new Date(ts);
    var now = new Date();
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var diff = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
    if (diff === 0) return 'วันนี้ ' + hm;
    if (diff === 1) return 'เมื่อวาน ' + hm;
    var s = d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (d.getFullYear() !== now.getFullYear()) s += ' ' + String(d.getFullYear() + 543).slice(-2);
    return s;
  }

  function renderRecent(tx) {
    var v = S.views.recent;
    if (!v) return;
    var rows = tx.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 5);
    clear(v.list);
    rows.forEach(function (t) {
      var inc = t.type === 'income';
      var li = el('li', 'recent__item');
      var glyph = el('span', 'recent__glyph recent__glyph--' + (inc ? 'in' : 'out'));
      glyph.setAttribute('aria-hidden', 'true');
      glyph.appendChild(icon(inc ? ['M12 6v12', 'M6 12h12'] : ['M6 12h12'], 18));
      li.appendChild(glyph);

      var main = el('div', 'recent__main');
      var cat = el('p', 'recent__cat');
      cat.appendChild(el('span', 'charts-sr', (inc ? 'รายรับ' : 'รายจ่าย') + ' หมวด '));
      cat.appendChild(document.createTextNode(cats().label(t.type, t.category)));
      main.appendChild(cat);
      var meta = el('p', 'recent__meta');
      var time = el('time');
      try { time.setAttribute('datetime', new Date(t.ts).toISOString()); } catch (e) {}
      appendMixed(time, whenText(t.ts));
      meta.appendChild(time);
      var dot = el('span', 'recent__dot', '·');
      dot.setAttribute('aria-hidden', 'true');
      meta.appendChild(dot);
      meta.appendChild(el('span', null, t.source === 'slip' ? 'สลิป' : 'กรอกเอง'));
      main.appendChild(meta);
      li.appendChild(main);

      li.appendChild(el('span', 'recent__amt num recent__amt--' + (inc ? 'in' : 'out'),
        (inc ? '+' : MINUS) + money(t.amount)));
      v.list.appendChild(li);
    });
    v.list.hidden = rows.length === 0;
    v.empty.hidden = rows.length !== 0;
  }

  /* ---------- วงจรการวาด ---------- */
  function renderRange(tx, mode) {
    renderBar(tx, mode);
    renderArea(tx, mode);
  }

  function renderAll(mode) {
    if (!S.started) return;
    var tx = validTx();
    renderRange(tx, mode);
    renderHbar(tx, mode);
    renderDonut(tx, mode);
    renderRecent(tx);
  }

  function eachChart(fn) {
    Object.keys(S.charts).forEach(function (k) {
      var ch = S.charts[k];
      if (ch) {
        try { fn(ch); } catch (e) { if (window.console) console.error(e); }
      }
    });
  }

  function resizeAll() {
    eachChart(function (ch) {
      // หยุด animation ที่ค้าง (เช่น สร้างตอนหน้าถูกซ่อน) ก่อน — ระหว่างที่ animation วิ่ง Chart.js เลื่อน resize ไปเฟรมถัดไป
      ch.stop();
      ch.resize();
      ch.update('none');
    });
  }

  function readRange() {
    var r = Number(FM.get(RANGE_KEY, 7));
    return RANGES.indexOf(r) !== -1 ? r : 7;
  }

  function setRange(n) {
    if (RANGES.indexOf(n) === -1 || n === S.range) return;
    S.range = n;
    FM.set(RANGE_KEY, n);
    FM.emit('chart:range', n);
  }

  function onTheme() {
    if (!S.started) return;
    S.C = readColors();
    renderAll('none');
  }

  function build() {
    function body(id) {
      var slot = document.getElementById(id);
      var b = slot ? slot.querySelector('.slot__body') : null;
      if (b) clear(b);
      return b;
    }
    var b;
    if ((b = body('charts-bar'))) S.views.bar = buildBar(b);
    if ((b = body('charts-hbar'))) S.views.hbar = buildHbar(b);
    if ((b = body('charts-donut'))) S.views.donut = buildDonut(b);
    if ((b = body('charts-area'))) S.views.area = buildArea(b);
    if ((b = body('recent-root'))) S.views.recent = buildRecent(b);
  }

  function init() {
    if (S.started) return;
    S.started = true;

    S.mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    S.probe = el('span', 'charts-probe');
    S.probe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(S.probe);
    S.C = readColors();
    S.range = readRange();

    build();
    renderAll();

    FM.on('tx:changed', function () { renderAll(); });
    FM.on('theme:changed', onTheme);
    FM.on('chart:range', function (n) {
      if (RANGES.indexOf(Number(n)) === -1) return;
      S.range = Number(n);
      renderRange(validTx());
    });
    FM.on('route:changed', function (name) {
      if (name !== 'overview') return;
      // หน้าเพิ่งเลิกซ่อน: วัดขนาดใหม่ทันที และอีกครั้งหลัง layout เฟรมถัดไป
      resizeAll();
      if (window.requestAnimationFrame) window.requestAnimationFrame(resizeAll);
    });

    // เปลี่ยนวัน/เดือนระหว่างที่แท็บถูกพักไว้ → คำนวณช่วงวันและเดือนปัจจุบันใหม่
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') renderAll('none');
    });

    if (S.mqReduce) {
      var onMotion = function () {
        eachChart(function (ch) { ch.options.animation = animOpts(); });
      };
      if (S.mqReduce.addEventListener) S.mqReduce.addEventListener('change', onMotion);
      else if (S.mqReduce.addListener) S.mqReduce.addListener(onMotion);
    }

    // ฟอนต์เว็บโหลดเสร็จหลังวาดครั้งแรก → วาดใหม่ให้ใช้ Geist Mono / Noto Sans Thai
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { eachChart(function (ch) { ch.update('none'); }); });
      }
    } catch (e) {}
  }

  window.FM = window.FM || {};
  FM.charts = {
    init: init,
    range: function () { return S.range; },
    setRange: setRange
  };
})();
