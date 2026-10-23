/* chart.js — กราฟรายรับ vs รายจ่าย 7 วัน (Chart.js) อัปเดตตาม tx:changed / theme:changed */
(function () {
  'use strict';

  var DAYS = 7;
  var WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  var FONT_MONO = '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';
  var FONT_TEXT = '"Noto Sans Thai", "Outfit", system-ui, sans-serif';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var els = null;
  var chart = null;

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function cssVar(name) {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch (e) {
      return '';
    }
  }

  function readColors() {
    return {
      income: cssVar('--accent'),
      expense: cssVar('--expense'),
      muted: cssVar('--muted'),
      line: cssVar('--line'),
      surface: cssVar('--surface'),
      ink: cssVar('--ink')
    };
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function animOpts() {
    return reducedMotion() ? false : { duration: 500, easing: 'easeOutQuart' };
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function compact(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    function trim(x) { return (Math.round(x * 10) / 10).toString(); }
    if (abs >= 1e6) return sign + trim(abs / 1e6) + 'M';
    if (abs >= 1e3) return sign + trim(abs / 1e3) + 'k';
    return sign + trim(abs);
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  /* ---------- data ---------- */
  function buildData() {
    var now = new Date();
    var days = [];
    var index = {};
    for (var i = DAYS - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      index[dayKey(d)] = days.length;
      days.push({
        label: WEEKDAYS[d.getDay()] + ' ' + d.getDate(),
        full: WEEKDAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1),
        income: 0,
        expense: 0
      });
    }

    var tx = FM.get('tx', []);
    if (!Array.isArray(tx)) tx = [];
    var count = 0;
    for (var j = 0; j < tx.length; j++) {
      var t = tx[j];
      if (!t || (t.type !== 'income' && t.type !== 'expense')) continue;
      var amt = Number(t.amount);
      var ts = Number(t.ts);
      if (!isFinite(amt) || amt < 0 || !isFinite(ts)) continue;
      var k = index[dayKey(new Date(ts))];
      if (k === undefined) continue;
      days[k][t.type] += amt;
      count++;
    }

    var totalIn = 0, totalOut = 0;
    days.forEach(function (d) {
      d.income = round2(d.income);
      d.expense = round2(d.expense);
      totalIn += d.income;
      totalOut += d.expense;
    });

    return { days: days, count: count, totalIn: round2(totalIn), totalOut: round2(totalOut) };
  }

  /* ---------- chart config ---------- */
  function datasets(data, c) {
    var common = {
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 28,
      categoryPercentage: 0.7,
      barPercentage: 0.9
    };
    return [
      Object.assign({
        label: 'รายรับ',
        data: data.days.map(function (d) { return d.income; }),
        backgroundColor: c.income,
        hoverBackgroundColor: c.income
      }, common),
      Object.assign({
        label: 'รายจ่าย',
        data: data.days.map(function (d) { return d.expense; }),
        backgroundColor: c.expense,
        hoverBackgroundColor: c.expense
      }, common)
    ];
  }

  function applyColors(c) {
    var o = chart.options;
    o.scales.x.ticks.color = c.muted;
    o.scales.y.ticks.color = c.muted;
    o.scales.y.grid.color = c.line;
    var tt = o.plugins.tooltip;
    tt.backgroundColor = c.surface;
    tt.titleColor = c.ink;
    tt.bodyColor = c.ink;
    tt.borderColor = c.line;
    chart.data.datasets[0].backgroundColor = c.income;
    chart.data.datasets[0].hoverBackgroundColor = c.income;
    chart.data.datasets[1].backgroundColor = c.expense;
    chart.data.datasets[1].hoverBackgroundColor = c.expense;
  }

  function createChart(data) {
    var existing = window.Chart.getChart ? window.Chart.getChart(els.canvas) : null;
    if (existing) existing.destroy();

    var c = readColors();
    chart = new window.Chart(els.canvas, {
      type: 'bar',
      data: {
        labels: data.days.map(function (d) { return d.label; }),
        datasets: datasets(data, c)
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animOpts(),
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.surface,
            titleColor: c.ink,
            bodyColor: c.ink,
            borderColor: c.line,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { family: FONT_TEXT, weight: '600', size: 13 },
            bodyFont: { family: FONT_TEXT, size: 13 },
            callbacks: {
              title: function (items) {
                var d = items.length ? data.days[items[0].dataIndex] : null;
                return d ? d.full : '';
              },
              label: function (ctx) {
                return ctx.dataset.label + ': ' + FM.fmtMoney(ctx.parsed.y);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: c.muted, font: { family: FONT_TEXT, size: 12 }, maxRotation: 0, autoSkip: true }
          },
          y: {
            beginAtZero: true,
            grid: { color: c.line, drawTicks: false },
            border: { display: false },
            ticks: {
              color: c.muted,
              padding: 8,
              maxTicksLimit: 5,
              font: { family: FONT_MONO, size: 11 },
              callback: function (v) { return compact(v); }
            }
          }
        }
      }
    });
  }

  function updateChart(data) {
    // tooltip title callback อ่าน data จาก closure ตอนสร้าง — แทนด้วยชุดใหม่
    chart.options.plugins.tooltip.callbacks.title = function (items) {
      var d = items.length ? data.days[items[0].dataIndex] : null;
      return d ? d.full : '';
    };
    chart.options.animation = animOpts();
    chart.data.labels = data.days.map(function (d) { return d.label; });
    chart.data.datasets[0].data = data.days.map(function (d) { return d.income; });
    chart.data.datasets[1].data = data.days.map(function (d) { return d.expense; });
    applyColors(readColors());
    chart.update();
  }

  /* ---------- render ---------- */
  function renderSummary(data) {
    els.sumIn.textContent = '+' + FM.fmtMoney(data.totalIn);
    els.sumOut.textContent = '−' + FM.fmtMoney(data.totalOut);
    els.canvas.setAttribute('aria-label',
      'กราฟแท่งรายรับและรายจ่าย 7 วันล่าสุด รายรับรวม ' + FM.fmtMoney(data.totalIn) +
      ' รายจ่ายรวม ' + FM.fmtMoney(data.totalOut));

    var tbody = els.tbody;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    data.days.forEach(function (d) {
      var tr = el('tr');
      var th = el('th', null, d.full);
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      tr.appendChild(el('td', null, FM.fmtMoney(d.income)));
      tr.appendChild(el('td', null, FM.fmtMoney(d.expense)));
      tbody.appendChild(tr);
    });
  }

  function render() {
    if (!els) return;
    var data = buildData();
    var empty = data.count === 0;
    var noLib = typeof window.Chart === 'undefined';

    renderSummary(data);

    els.empty.hidden = !empty || noLib;
    els.error.hidden = !noLib;
    els.legend.hidden = empty || noLib;
    els.wrap.hidden = empty || noLib;
    els.summary.hidden = empty;
    els.table.hidden = empty;

    if (empty || noLib) return;

    if (chart) updateChart(data);
    else createChart(data);
  }

  function onTheme() {
    if (!chart) return;
    applyColors(readColors());
    chart.update('none');
  }

  /* ---------- DOM ---------- */
  function icon(paths) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
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

  function legendItem(mod, text) {
    var li = el('li', 'chart__legend-item');
    var sw = el('span', 'chart__swatch chart__swatch--' + mod);
    sw.setAttribute('aria-hidden', 'true');
    li.appendChild(sw);
    li.appendChild(document.createTextNode(text));
    return li;
  }

  function sumItem(label, mod) {
    var p = el('p', 'chart__sum chart__sum--' + mod);
    p.appendChild(el('span', 'chart__sum-label', label));
    var v = el('span', 'chart__sum-value num', '');
    p.appendChild(v);
    return { node: p, value: v };
  }

  function build(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var box = el('div', 'chart');

    var legend = el('ul', 'chart__legend');
    legend.setAttribute('aria-hidden', 'true');
    legend.appendChild(legendItem('income', 'รายรับ'));
    legend.appendChild(legendItem('expense', 'รายจ่าย'));

    var wrap = el('div', 'chart__wrap');
    var canvas = el('canvas', 'chart__canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'กราฟแท่งรายรับและรายจ่าย 7 วันล่าสุด');
    wrap.appendChild(canvas);

    var empty = el('div', 'chart__state chart__state--empty');
    empty.appendChild(icon(['M4 20h16', 'M7 16v-4', 'M12 16V8', 'M17 16v-6']));
    empty.appendChild(el('p', 'chart__state-text', 'ยังไม่มีรายรับรายจ่ายใน 7 วันนี้ อัปโหลดสลิปหรือบวกเพิ่มยอดเพื่อดูกราฟ'));

    var error = el('div', 'chart__state chart__state--error');
    error.setAttribute('role', 'alert');
    error.appendChild(icon(['M12 8v5', 'M12 16.5v.01', 'M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']));
    error.appendChild(el('p', 'chart__state-text', 'โหลดกราฟไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีโหลดหน้า'));

    var summary = el('div', 'chart__summary');
    var sIn = sumItem('รายรับรวม', 'income');
    var sOut = sumItem('รายจ่ายรวม', 'expense');
    summary.appendChild(sIn.node);
    summary.appendChild(sOut.node);

    var table = el('table', 'chart__sr');
    table.appendChild(el('caption', null, 'รายรับและรายจ่ายรายวัน 7 วันล่าสุด'));
    var thead = el('thead');
    var hr = el('tr');
    ['วัน', 'รายรับ', 'รายจ่าย'].forEach(function (h) {
      var th = el('th', null, h);
      th.setAttribute('scope', 'col');
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    var tbody = el('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);

    box.appendChild(legend);
    box.appendChild(wrap);
    box.appendChild(empty);
    box.appendChild(error);
    box.appendChild(summary);
    box.appendChild(table);
    root.appendChild(box);

    els = {
      legend: legend, wrap: wrap, canvas: canvas, empty: empty, error: error,
      summary: summary, sumIn: sIn.value, sumOut: sOut.value, table: table, tbody: tbody
    };
  }

  function init() {
    var root = document.getElementById('chart-root');
    if (!root) return;
    if (chart) { chart.destroy(); chart = null; }
    build(root);
    render();

    FM.on('tx:changed', render);
    FM.on('theme:changed', onTheme);

    // ฟอนต์เว็บโหลดเสร็จหลังวาดครั้งแรก — วาดใหม่ให้ใช้ Geist Mono / Noto Sans Thai
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { if (chart) chart.update('none'); });
      }
    } catch (e) {}
  }

  FM.chart = { init: init };
})();
