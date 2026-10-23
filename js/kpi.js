/* kpi.js — การ์ด KPI 4 ใบบนหน้าภาพรวม (docs/REDESIGN-PLAN.md §9.3)
 * ยอดเงิน (#kpi-balance), รายรับ/รายจ่ายเดือนนี้เทียบเดือนก่อน (#kpi-income/#kpi-expense), งาน (#kpi-tasks)
 * อ่านข้อมูลจาก FM.get ทุกครั้งที่วาด; ไม่ emit event เอง
 * ฟังก์ชันคำนวณล้วนเปิดไว้ที่ FM.kpi._calc เพื่อทดสอบใน console */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PCT_CAP = 999;
  var MAX_TIMER = 6 * 60 * 60 * 1000; // ตรวจรอบเดือนใหม่อย่างน้อยทุก 6 ชม. ขณะแท็บเปิดค้าง

  /* ---------- pure: คำนวณ ---------- */
  function toMs(ts) {
    if (typeof ts === 'number') return isFinite(ts) ? ts : NaN;
    if (typeof ts === 'string' && ts) {
      var n = Number(ts);
      return isFinite(n) ? n : Date.parse(ts);
    }
    return NaN;
  }

  // ขอบเขตเดือนปฏิทิน (เวลาท้องถิ่น): [start, end) ของเดือนนี้และเดือนก่อน
  function monthBounds(now) {
    var d = new Date(now);
    var y = d.getFullYear();
    var m = d.getMonth();
    return {
      prevStart: new Date(y, m - 1, 1).getTime(),
      curStart: new Date(y, m, 1).getTime(),
      nextStart: new Date(y, m + 1, 1).getTime()
    };
  }

  // รวมยอดเป็นสตางค์ (จำนวนเต็ม) กันทศนิยมคลาดเคลื่อน; แถวที่ไม่ถูกต้องถูกข้าม
  function monthTotals(tx, now) {
    var b = monthBounds(now);
    var c = { income: { cur: 0, prev: 0 }, expense: { cur: 0, prev: 0 } };
    if (!Array.isArray(tx)) tx = [];
    for (var i = 0; i < tx.length; i++) {
      var t = tx[i];
      if (!t || (t.type !== 'income' && t.type !== 'expense')) continue;
      var amt = Number(t.amount);
      if (!isFinite(amt) || amt <= 0) continue;
      var ms = toMs(t.ts);
      if (!isFinite(ms)) continue;
      var cents = Math.round(amt * 100);
      if (ms >= b.curStart && ms < b.nextStart) c[t.type].cur += cents;
      else if (ms >= b.prevStart && ms < b.curStart) c[t.type].prev += cents;
    }
    return {
      income: { cur: c.income.cur / 100, prev: c.income.prev / 100 },
      expense: { cur: c.expense.cur / 100, prev: c.expense.prev / 100 }
    };
  }

  // เทียบเดือนก่อน: kind = 'none' (เดือนก่อนเป็น 0) | 'same' | 'up' | 'down'
  // tone: income ▲ = good, expense ▲ = bad
  function delta(cur, prev, isExpense) {
    cur = Number(cur) || 0;
    prev = Number(prev) || 0;
    if (!(prev > 0)) return { kind: 'none', tone: 'neutral', text: '—' };
    var diffCents = Math.round(cur * 100) - Math.round(prev * 100);
    if (diffCents === 0) return { kind: 'same', tone: 'neutral', text: 'ไม่เปลี่ยนแปลง' };
    var kind = diffCents > 0 ? 'up' : 'down';
    var good = isExpense ? kind === 'down' : kind === 'up';
    var pct = Math.abs(diffCents) / Math.round(prev * 100) * 100;
    var text;
    if (pct > PCT_CAP) text = PCT_CAP + '%+';
    else if (pct < 0.1) text = '<0.1%';
    else text = String(Math.round(pct * 10) / 10) + '%';
    return { kind: kind, tone: good ? 'good' : 'bad', text: text, pct: pct };
  }

  function taskStats(tasks) {
    var total = 0;
    var done = 0;
    if (Array.isArray(tasks)) {
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (!t || typeof t !== 'object') continue;
        total++;
        if (t.done) done++;
      }
    }
    return { done: done, total: total };
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svg(paths, cls, filled) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('fill', filled ? 'currentColor' : 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    if (cls) s.setAttribute('class', cls);
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  var ICONS = {
    adjust: ['M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z', 'M13.5 8.5l2 2'],
    income: ['M17 7L7 17', 'M16 17H7V8'],
    expense: ['M7 17L17 7', 'M8 7h9v9'],
    tasks: ['M9 11l3 3 8-8', 'M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9'],
    up: ['M12 6l7 12H5z'],
    down: ['M12 18L5 6h14z']
  };

  function cornerIcon(name) {
    var wrap = el('span', 'kpi__corner kpi__badge');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.appendChild(svg(ICONS[name], 'kpi__icon'));
    return wrap;
  }

  // ตัวเลขใหญ่: ห่อด้วย container (cqi) ให้ย่อขนาดตามความยาวข้อความ
  function figure(liveRegion) {
    var fig = el('div', 'kpi__fig');
    var val = el('p', 'kpi__value num');
    if (liveRegion) {
      val.setAttribute('aria-live', 'polite');
      val.setAttribute('aria-atomic', 'true');
    }
    fig.appendChild(val);
    return { fig: fig, val: val };
  }

  function setValue(node, text) {
    if (node.textContent !== text) node.textContent = text;
    node.style.setProperty('--kpi-chars', String(Math.max(text.length, 1)));
  }

  /* ---------- การ์ด ---------- */
  var cards = {};

  function bodyOf(id) {
    var card = document.getElementById(id);
    return card ? card.querySelector('.slot__body') : null;
  }

  function buildBalance() {
    var body = bodyOf('kpi-balance');
    if (!body) return;
    body.textContent = '';
    var btn = el('button', 'icon-btn kpi__corner kpi__adjust');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'ปรับยอดเงิน');
    btn.title = 'ปรับยอดเงิน';
    btn.appendChild(svg(ICONS.adjust, 'kpi__icon'));
    btn.addEventListener('click', function () {
      if (FM.ui && typeof FM.ui.openAdjust === 'function') FM.ui.openAdjust(btn);
    });
    var f = figure(true);
    body.appendChild(btn);
    body.appendChild(f.fig);
    cards.balance = { val: f.val };
  }

  function buildMoney(key, id) {
    var body = bodyOf(id);
    if (!body) return;
    body.textContent = '';
    var f = figure(false);
    var line = el('p', 'kpi__delta');
    var glyph = el('span', 'kpi__glyph');
    glyph.setAttribute('aria-hidden', 'true');
    var sr = el('span', 'kpi-sr');
    var pct = el('span', 'kpi__pct num');
    var note = el('span', 'kpi__note');
    line.appendChild(glyph);
    line.appendChild(sr);
    line.appendChild(pct);
    line.appendChild(note);
    body.appendChild(cornerIcon(key));
    body.appendChild(f.fig);
    body.appendChild(line);
    cards[key] = { val: f.val, line: line, glyph: glyph, sr: sr, pct: pct, note: note, lastKind: null };
  }

  function buildTasks() {
    var body = bodyOf('kpi-tasks');
    if (!body) return;
    body.textContent = '';
    var f = figure(false);
    var unit = el('span', 'kpi__unit', ' งาน');
    var bar = el('div', 'kpi__bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'ความคืบหน้างาน');
    bar.setAttribute('aria-valuemin', '0');
    var fill = el('div', 'kpi__bar-fill');
    bar.appendChild(fill);
    var text = el('p', 'kpi__meta');
    var empty = el('p', 'kpi__meta');
    empty.appendChild(document.createTextNode('ยังไม่มีงาน · '));
    var link = el('a', 'kpi__link', 'ไปเพิ่มที่ กิจวัตร');
    link.href = '#/tasks';
    empty.appendChild(link);
    body.appendChild(cornerIcon('tasks'));
    body.appendChild(f.fig);
    body.appendChild(bar);
    body.appendChild(text);
    body.appendChild(empty);
    cards.tasks = { val: f.val, fig: f.fig, unit: unit, bar: bar, fill: fill, text: text, empty: empty };
  }

  /* ---------- วาด ---------- */
  function renderBalance() {
    var c = cards.balance;
    if (!c) return;
    var n = Number(FM.get('balance', 0));
    if (!isFinite(n)) n = 0;
    setValue(c.val, FM.fmtMoney(n));
    c.val.classList.toggle('is-negative', n < 0);
  }

  function renderMoney(key, totals) {
    var c = cards[key];
    if (!c) return;
    var t = totals[key];
    setValue(c.val, FM.fmtMoney(t.cur));
    var d = delta(t.cur, t.prev, key === 'expense');
    c.line.setAttribute('data-tone', d.tone);
    c.line.setAttribute('data-kind', d.kind);
    if (c.lastKind !== d.kind) {
      c.glyph.textContent = '';
      if (d.kind === 'up') c.glyph.appendChild(svg(ICONS.up, 'kpi__tri', true));
      else if (d.kind === 'down') c.glyph.appendChild(svg(ICONS.down, 'kpi__tri', true));
      else if (d.kind === 'none') c.glyph.textContent = '—';
      c.lastKind = d.kind;
    }
    if (d.kind === 'none') {
      c.sr.textContent = '';
      c.pct.textContent = '';
      c.note.textContent = 'ยังไม่มีข้อมูลเดือนก่อน';
    } else if (d.kind === 'same') {
      c.sr.textContent = '';
      c.pct.textContent = '';
      c.note.textContent = 'ไม่เปลี่ยนแปลงจากเดือนก่อน';
    } else {
      c.sr.textContent = d.kind === 'up' ? 'เพิ่มขึ้น ' : 'ลดลง ';
      c.pct.textContent = d.text;
      c.note.textContent = ' จากเดือนก่อน';
    }
  }

  function renderTasks() {
    var c = cards.tasks;
    if (!c) return;
    var s = taskStats(FM.get('tasks', []));
    var isEmpty = s.total === 0;
    if (isEmpty) {
      setValue(c.val, '0');
      c.val.appendChild(c.unit);
      c.val.style.setProperty('--kpi-chars', '5');
    } else {
      setValue(c.val, s.done + '/' + s.total);
    }
    c.bar.hidden = isEmpty;
    c.text.hidden = isEmpty;
    c.empty.hidden = !isEmpty;
    if (!isEmpty) {
      var label = 'ทำเสร็จแล้ว ' + s.done + ' จาก ' + s.total + ' งาน';
      c.bar.setAttribute('aria-valuemax', String(s.total));
      c.bar.setAttribute('aria-valuenow', String(s.done));
      c.bar.setAttribute('aria-valuetext', label);
      c.fill.style.transform = 'scaleX(' + (s.done / s.total) + ')';
      c.text.textContent = label;
    }
  }

  function renderMonth() {
    var totals = monthTotals(FM.get('tx', []), Date.now());
    renderMoney('income', totals);
    renderMoney('expense', totals);
    scheduleRollover();
  }

  function renderAll() {
    renderBalance();
    renderMonth();
    renderTasks();
  }

  // ขึ้นเดือนใหม่ขณะแท็บเปิดค้าง: ตั้งเวลาไปที่ต้นเดือนถัดไป (จำกัดไม่เกิน 6 ชม. ต่อรอบ)
  var rolloverTimer = 0;
  function scheduleRollover() {
    clearTimeout(rolloverTimer);
    var now = Date.now();
    var wait = Math.min(Math.max(monthBounds(now).nextStart - now + 1000, 1000), MAX_TIMER);
    rolloverTimer = setTimeout(renderMonth, wait);
  }

  /* ---------- init ---------- */
  var started = false;
  function init() {
    if (started) return;
    started = true;
    buildBalance();
    buildMoney('income', 'kpi-income');
    buildMoney('expense', 'kpi-expense');
    buildTasks();
    renderAll();

    FM.on('balance:changed', renderBalance);
    FM.on('tx:changed', renderMonth);
    FM.on('tasks:changed', renderTasks);
    FM.on('route:changed', function (name) { if (name === 'overview') renderAll(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') renderAll();
    });
  }

  window.FM = window.FM || {};
  FM.kpi = {
    init: init,
    render: renderAll,
    _calc: { monthBounds: monthBounds, monthTotals: monthTotals, delta: delta, taskStats: taskStats, toMs: toMs }
  };
})();
