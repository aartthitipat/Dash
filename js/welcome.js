/* welcome.js — หน้าแรก #/welcome (FM.welcome) docs/WELCOME-PLAN.md
 * - สเกล stage 1672×941: เขียน --s, --stage-x, --hero-vh, --rim-y ลง .hero (rAF throttle; resize/orientation/เข้าหน้า)
 * - ท้องฟ้า: canvas ดาว (seeded, DPR ≤ 2) + canvas ขอบดาวเคราะห์ (ตารางสีตามมุม core --sky → --blue → โปร่งใส)
 *   วาดใหม่เฉพาะเมื่อขนาด/ตำแหน่งเปลี่ยน หรือแท็บกลับมาแสดง — ไม่มี rAF loop ตอนว่าง
 * - timeline เปิดตัว: ใส่ .is-entering เมื่อเข้าหน้า (ไม่เล่นเมื่อ prefers-reduced-motion)
 * - พรีวิวแดชบอร์ด: ข้อมูลจริงจาก FM.get('tx'/'tasks') ผ่าน FM.kpi._calc; ไม่มีข้อมูล = ข้อมูลตัวอย่าง (มีป้ายบอก)
 * - ชื่อผู้ใช้ในพรีวิว: cloud.js ไม่มี API อ่านอีเมล จึงแสดง "ผู้เยี่ยมชม" เสมอ
 * - ปุ่ม "เริ่มใช้งาน" ตั้ง fm.welcomed = true แล้วไป #/ ; "ลองอ่านสลิป" เปิด FM.ui.openSlip
 * โหลดหลัง store.js / router.js / kpi.js; main.js เรียก init() หลัง router */
(function () {
  'use strict';

  var STAGE_W = 1672;
  var STAGE_H = 941;
  var MQ_DESKTOP = '(min-width: 900px) and (orientation: landscape)';
  var STAR_MAX = 220;
  var STAR_SEED = 20240611;
  var DAYS = 30;

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var mqDesk = window.matchMedia ? window.matchMedia(MQ_DESKTOP) : null;

  var els = {};
  var started = false;
  var raf = 0;
  var last = { w: 0, h: 0, dpr: 0, rim: -1, desk: null };
  var stars = null;
  var menuOpen = false;

  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }
  function isDesktop() { return mqDesk ? mqDesk.matches : window.innerWidth >= 900; }
  function active() { return !!(FM.router && FM.router.current && FM.router.current() === 'welcome'); }

  /* ---------- seeded PRNG (mulberry32) ---------- */
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeStars() {
    var rnd = prng(STAR_SEED);
    var list = [];
    for (var i = 0; i < STAR_MAX; i++) {
      var big = rnd() < 0.08;
      list.push({
        x: rnd(),
        y: rnd(),
        r: big ? 1.1 + rnd() * 0.7 : 0.35 + rnd() * 0.65,
        a: big ? 0.7 + rnd() * 0.3 : 0.2 + rnd() * 0.55,
        big: big
      });
    }
    return list;
  }

  /* ---------- สีจาก CSS var (อ่านตอนวาด) ---------- */
  function parseColor(v) {
    v = String(v || '').trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    return null;
  }

  function tokenColor(name) {
    try { return parseColor(getComputedStyle(els.page).getPropertyValue(name)); } catch (e) { return null; }
  }

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'; }

  function mix(a, b, t) {
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
  }

  /* ---------- canvas ---------- */
  function prepCanvas(c, w, h, dpr) {
    var W = Math.max(1, Math.round(w * dpr));
    var H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    var ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  // วงกลมดาวเคราะห์: ศูนย์กลางเหนือขอบบน ยอดโค้งล่างสุดอยู่ที่ y = apex, ตัดขอบบนที่ ±half จากกลางจอ
  function planet(w, apex, desk) {
    var half = w * (desk ? 0.6 : 0.66);
    var R = (half * half + apex * apex) / (2 * apex);
    return { cx: w / 2, cy: apex - R, R: R, apex: apex };
  }

  function drawStars(w, h, dpr, p) {
    var ctx = prepCanvas(els.stars, w, h, dpr);
    if (!ctx) return;
    var ink = tokenColor('--ink');
    if (!ink) return;
    if (!stars) stars = makeStars();
    // ดาวเท่าเดิมทุกขนาดจอ: จอเล็กลดจำนวนตามพื้นที่ (ไม่ให้แน่นเกิน)
    var n = Math.round(STAR_MAX * Math.max(0.45, Math.min(1, (w * h) / (1440 * 900))));
    var edge = p.R + 6;
    for (var i = 0; i < n; i++) {
      var s = stars[i];
      var x = s.x * w;
      var y = s.y * h;
      var dx = x - p.cx;
      var dy = y - p.cy;
      if (dx * dx + dy * dy < edge * edge) continue; // ซ่อนหลังดาวเคราะห์
      if (s.big) {
        var g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 4);
        g.addColorStop(0, rgba(ink, s.a * 0.45));
        g.addColorStop(1, rgba(ink, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - s.r * 4, y - s.r * 4, s.r * 8, s.r * 8);
      }
      ctx.fillStyle = rgba(ink, s.a);
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRim(w, h, dpr, p, desk) {
    var ctx = prepCanvas(els.rim, w, h, dpr);
    if (!ctx) return;
    var sky = tokenColor('--sky');
    var blue = tokenColor('--blue');
    var ink = tokenColor('--ink');
    if (!sky || !blue || !ink) return;

    var cx = p.cx;
    var cy = p.cy;
    var R = p.R;
    var unit = desk ? Math.max(0.55, Math.min(w / STAGE_W, h / STAGE_H)) : 0.6;

    // 1) แสงฟุ้งด้านนอก (radial) แล้วจางไปทางสองข้างด้วย mask แนวนอน
    var bloomW = 260 * unit;
    var g = ctx.createRadialGradient(cx, cy, R - 4, cx, cy, R + bloomW);
    g.addColorStop(0, rgba(blue, 0));
    g.addColorStop(0.03, rgba(blue, 0.55));
    g.addColorStop(0.22, rgba(blue, 0.2));
    g.addColorStop(0.6, rgba(blue, 0.05));
    g.addColorStop(1, rgba(blue, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    var m = ctx.createLinearGradient(0, 0, w, 0);
    m.addColorStop(0, rgba(ink, 0.12));
    m.addColorStop(0.3, rgba(ink, 0.7));
    m.addColorStop(0.5, rgba(ink, 1));
    m.addColorStop(0.7, rgba(ink, 0.7));
    m.addColorStop(1, rgba(ink, 0.12));
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // 2) บรรยากาศด้านในขอบดาวเคราะห์
    var inner = 70 * unit + 20;
    var gi = ctx.createRadialGradient(cx, cy, Math.max(0, R - inner), cx, cy, R);
    gi.addColorStop(0, rgba(blue, 0));
    gi.addColorStop(0.75, rgba(blue, 0.12));
    gi.addColorStop(1, rgba(sky, 0.32));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = gi;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 3) เส้นขอบ: ตารางสีตามมุม (u = 0 ยอดโค้ง → 1 จุดที่ขอบโค้งออกนอกจอ)
    var table = [
      { u: 0, c: mix(sky, ink, 0.35), a: 1 },
      { u: 0.35, c: sky, a: 0.9 },
      { u: 0.7, c: mix(sky, blue, 0.6), a: 0.55 },
      { u: 1, c: blue, a: 0 }
    ];
    var sinv = Math.max(-1, Math.min(1, -cy / R));
    var halfAng = Math.PI / 2 - Math.asin(sinv); // ครึ่งมุมของส่วนที่เห็น
    var a0 = Math.PI / 2 - halfAng;
    var a1 = Math.PI / 2 + halfAng;
    var passes = [
      { lw: 18 * unit + 6, k: 0.1 },
      { lw: 6 * unit + 2, k: 0.35 },
      { lw: 1.6, k: 1 }
    ];
    var conic = typeof ctx.createConicGradient === 'function';
    for (var i = 0; i < passes.length; i++) {
      var ps = passes[i];
      var style;
      if (conic) {
        var cg = ctx.createConicGradient(a0, cx, cy);
        var span = (2 * halfAng) / (Math.PI * 2);
        var stops = [];
        table.forEach(function (row) {
          stops.push({ f: span / 2 * (1 - row.u), c: row.c, a: row.a });
          if (row.u > 0) stops.push({ f: span / 2 * (1 + row.u), c: row.c, a: row.a });
        });
        stops.sort(function (x, y) { return x.f - y.f; });
        stops.forEach(function (st) { cg.addColorStop(Math.max(0, Math.min(1, st.f)), rgba(st.c, st.a * ps.k)); });
        cg.addColorStop(1, rgba(blue, 0));
        style = cg;
      } else {
        style = rgba(sky, 0.8 * ps.k);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = ps.lw;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a0, a1);
      ctx.stroke();
    }

    // 4) จางลงในแถบเมนูด้านบน: ขอบที่โค้งขึ้นไปผ่านโลโก้/เมนูต้องไม่กินความต่างสีของตัวอักษร
    if (p.navBottom > 0) {
      var y0 = Math.max(0, p.navMid);
      var y1 = Math.min(h, p.navBottom + 28);
      if (y1 > y0) {
        ctx.globalCompositeOperation = 'destination-in';
        var fm = ctx.createLinearGradient(0, y0, 0, y1);
        fm.addColorStop(0, rgba(ink, 0.04));
        fm.addColorStop(0.5, rgba(ink, 0.3));
        fm.addColorStop(1, rgba(ink, 1));
        ctx.fillStyle = fm;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  // ยอดโค้ง: ระหว่างเมนูด้านบนกับหัวเรื่อง
  function rimApex(heroTop) {
    var t = els.title.getBoundingClientRect().top - heroTop;
    var fs = parseFloat(getComputedStyle(els.title).fontSize) || 48;
    var navBottom = els.nav.getBoundingClientRect().bottom - heroTop;
    return Math.round(Math.max(navBottom + 8, t - fs * 0.45));
  }

  /* ---------- วัดขนาด + วาด ---------- */
  function update(force) {
    raf = 0;
    if (!started || !active() || !els.hero) return;
    var w = els.hero.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (!w || !vh) return;
    var desk = isDesktop();
    var s = Math.min(w / STAGE_W, vh / STAGE_H);
    var st = els.hero.style;
    st.setProperty('--s', s.toFixed(4));
    st.setProperty('--stage-x', ((w - STAGE_W * s) / 2).toFixed(1) + 'px');
    st.setProperty('--hero-vh', vh + 'px');

    if (desk && els.panel) {
      var pw = els.panel.clientWidth;
      var ph = els.panel.clientHeight;
      els.panel.style.setProperty('--hp-w', (pw / s).toFixed(1) + 'px');
      els.panel.style.setProperty('--hp-h', (ph / s).toFixed(1) + 'px');
    } else if (els.panel) {
      els.panel.style.removeProperty('--hp-w');
      els.panel.style.removeProperty('--hp-h');
    }

    var heroTop = els.hero.getBoundingClientRect().top;
    var apex = rimApex(heroTop);
    st.setProperty('--rim-y', apex + 'px');

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && w === last.w && vh === last.h && dpr === last.dpr && apex === last.rim && desk === last.desk) return;
    last = { w: w, h: vh, dpr: dpr, rim: apex, desk: desk };
    var p = planet(w, Math.max(apex, 24), desk);
    var nb = els.nav.getBoundingClientRect();
    p.navBottom = nb.bottom - heroTop;
    p.navMid = (nb.top + nb.bottom) / 2 - heroTop;
    try {
      drawStars(w, vh, dpr, p);
      drawRim(w, vh, dpr, p, desk);
    } catch (e) {
      if (window.console) console.error(e);
    }
  }

  function schedule(force) {
    if (!started || !active()) return;
    if (force) last.w = 0;
    if (raf) return;
    raf = window.requestAnimationFrame(function () { update(false); });
  }

  /* ---------- timeline เปิดตัว ---------- */
  function play() {
    if (!els.hero) return;
    els.hero.classList.remove('is-entering');
    if (reducedMotion()) return;
    void els.hero.offsetWidth; // เริ่ม animation ใหม่ทุกครั้งที่เข้าหน้า
    els.hero.classList.add('is-entering');
  }

  /* ---------- ข้อมูลพรีวิว ---------- */
  function sampleData(calc) {
    var rnd = prng(7);
    var daily = [];
    for (var i = 0; i < DAYS; i++) {
      var base = 520 + Math.sin(i / 3.2) * 210 + Math.sin(i / 1.3) * 90;
      daily.push(Math.max(80, Math.round(base + rnd() * 260)));
    }
    var income = { cur: 42500, prev: 38000 };
    var expense = { cur: 18240.5, prev: 20100 };
    return {
      sample: true,
      income: income,
      expense: expense,
      incomeDelta: calc ? calc.delta(income.cur, income.prev, false) : null,
      expenseDelta: calc ? calc.delta(expense.cur, expense.prev, true) : null,
      count: 46,
      slips: 12,
      tasks: { done: 5, total: 7 },
      daily: daily
    };
  }

  function readData() {
    var calc = FM.kpi && FM.kpi._calc;
    var tx = FM.get('tx', []);
    var tasks = FM.get('tasks', []);
    if (!Array.isArray(tx)) tx = [];
    if (!Array.isArray(tasks)) tasks = [];
    if (!calc) return sampleData(null);

    var valid = [];
    for (var i = 0; i < tx.length; i++) {
      var t = tx[i];
      if (!t || (t.type !== 'income' && t.type !== 'expense')) continue;
      var amt = Number(t.amount);
      if (!isFinite(amt) || amt <= 0) continue;
      var ms = calc.toMs(t.ts);
      if (!isFinite(ms)) continue;
      valid.push({ type: t.type, amount: amt, ms: ms, source: t.source });
    }
    var ts = calc.taskStats(tasks);
    if (!valid.length && !ts.total) return sampleData(calc);

    var now = Date.now();
    var b = calc.monthBounds(now);
    var totals = calc.monthTotals(tx, now);
    var count = 0;
    var slips = 0;
    var d = new Date(now);
    var starts = [];
    for (var k = 0; k <= DAYS; k++) starts.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (DAYS - 1) + k).getTime());
    var daily = [];
    for (k = 0; k < DAYS; k++) daily.push(0);
    for (i = 0; i < valid.length; i++) {
      var v = valid[i];
      if (v.ms >= b.curStart && v.ms < b.nextStart) {
        count++;
        if (v.source === 'slip') slips++;
      }
      if (v.type === 'expense' && v.ms >= starts[0] && v.ms < starts[DAYS]) {
        for (k = 0; k < DAYS; k++) {
          if (v.ms < starts[k + 1]) { daily[k] += Math.round(v.amount * 100); break; }
        }
      }
    }
    for (k = 0; k < DAYS; k++) daily[k] = daily[k] / 100;
    return {
      sample: false,
      income: totals.income,
      expense: totals.expense,
      incomeDelta: calc.delta(totals.income.cur, totals.income.prev, false),
      expenseDelta: calc.delta(totals.expense.cur, totals.expense.prev, true),
      count: count,
      slips: slips,
      tasks: ts,
      daily: daily
    };
  }

  /* ---------- วาดพรีวิว ---------- */
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function tri(up) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '12');
    s.setAttribute('height', '12');
    s.setAttribute('focusable', 'false');
    s.setAttribute('fill', 'currentColor');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', up ? 'M12 6l7 12H5z' : 'M12 18L5 6h14z');
    s.appendChild(p);
    return s;
  }

  function hook(name) { return els.panel ? els.panel.querySelector('[data-hp="' + name + '"]') : null; }

  function setText(name, text) {
    var n = hook(name);
    if (n && n.textContent !== text) n.textContent = text;
  }

  function renderDelta(name, d) {
    var n = hook(name);
    if (!n) return;
    n.textContent = '';
    if (!d || d.kind === 'none') {
      n.setAttribute('data-tone', 'neutral');
      n.appendChild(document.createTextNode('ยังไม่มีข้อมูลเดือนก่อน'));
      return;
    }
    n.setAttribute('data-tone', d.tone);
    if (d.kind === 'same') {
      n.appendChild(document.createTextNode('ไม่เปลี่ยนแปลงจากเดือนก่อน'));
      return;
    }
    var tone = document.createElement('span');
    tone.className = 'hp-stat__tone';
    tone.appendChild(tri(d.kind === 'up'));
    var pct = document.createElement('span');
    pct.className = 'num';
    pct.textContent = d.text;
    tone.appendChild(pct);
    n.appendChild(tone);
    n.appendChild(document.createTextNode(' จากเดือนก่อน'));
  }

  // เส้นโค้งเรียบ (Catmull-Rom → Bezier) จำกัดจุดควบคุมไม่ให้เลยกรอบ
  function chartPaths(values) {
    var W = 600;
    var H = 200;
    var top = 14;
    var bottom = 6;
    var max = 0;
    values.forEach(function (v) { if (v > max) max = v; });
    var n = values.length;
    var pts = values.map(function (v, i) {
      var x = n > 1 ? (i / (n - 1)) * W : W / 2;
      var y = max > 0 ? H - bottom - (v / max) * (H - top - bottom) : H - bottom;
      return [x, y];
    });
    function clampY(y) { return Math.max(top - 6, Math.min(H - bottom, y)); }
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 0; i < n - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6;
      var c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
      var c2x = p2[0] - (p3[0] - p1[0]) / 6;
      var c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
      d += 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return { line: d, area: d + 'L' + W + ' ' + H + 'L0 ' + H + 'Z', max: max };
  }

  function renderPanel() {
    if (!els.panel) return;
    var data;
    try {
      data = readData();
    } catch (e) {
      data = sampleData(FM.kpi && FM.kpi._calc);
    }
    try {
      var sample = hook('sample');
      if (sample) sample.hidden = !data.sample;
      setText('income', FM.fmtMoney(data.income.cur));
      setText('expense', FM.fmtMoney(data.expense.cur));
      renderDelta('income-delta', data.incomeDelta);
      renderDelta('expense-delta', data.expenseDelta);
      setText('count', String(data.count));
      setText('slips', String(data.slips));
      setText('tasks', data.tasks.done + '/' + data.tasks.total);
      var bar = hook('tasks-bar');
      if (bar) bar.style.setProperty('--p', data.tasks.total ? String(data.tasks.done / data.tasks.total) : '0');
      var paths = chartPaths(data.daily && data.daily.length ? data.daily : [0, 0]);
      var line = hook('line');
      var area = hook('area');
      if (line) line.setAttribute('d', paths.line);
      if (area) area.setAttribute('d', paths.area);
      setText('max', paths.max > 0 ? 'สูงสุด ' + FM.fmtMoney(paths.max) : '');
    } catch (e) {
      if (window.console) console.error(e);
    }
  }

  /* ---------- เมนูมือถือ ---------- */
  function openMenu() {
    var m = els.menu;
    if (!m || m.open) return;
    try {
      if (typeof m.showModal === 'function') m.showModal();
      else m.setAttribute('open', '');
    } catch (e) {
      m.setAttribute('open', '');
    }
    menuOpen = true;
    els.menuBtn.setAttribute('aria-expanded', 'true');
  }

  // เก็บกวาดแบบ synchronous (event 'close' ของ <dialog> เป็น async และอาจมาช้า — แบบเดียวกับ router.js)
  // restore=false: กำลังเปลี่ยนหน้า (router ย้าย focus ไปหัวเรื่องของหน้าใหม่เอง)
  function closeMenu(restore) {
    var m = els.menu;
    if (!m) return;
    if (m.open) {
      if (typeof m.close === 'function') m.close();
      else m.removeAttribute('open');
    }
    afterMenuClose(restore !== false);
  }

  function afterMenuClose(restore) {
    if (!menuOpen) return; // ทำไปแล้ว
    menuOpen = false;
    els.menuBtn.setAttribute('aria-expanded', 'false');
    if (restore && els.menuBtn.offsetParent !== null) {
      try { els.menuBtn.focus({ preventScroll: true }); } catch (e) { els.menuBtn.focus(); }
    }
  }

  function setupMenu() {
    if (!els.menu || !els.menuBtn) return;
    els.menuBtn.addEventListener('click', openMenu);
    // Esc: ปิดผ่าน closeMenu เพื่อคืน focus ทันที
    els.menu.addEventListener('cancel', function (e) {
      e.preventDefault();
      closeMenu(true);
    });
    // ปิดด้วยวิธีอื่น (ถ้ามี) — afterMenuClose ทำซ้ำได้ไม่มีผลข้าง
    els.menu.addEventListener('close', function () { afterMenuClose(true); });
    els.menu.addEventListener('click', function (e) {
      if (e.target === els.menu) { closeMenu(true); return; } // คลิกพื้นหลัง
      var closeBtn = e.target.closest ? e.target.closest('[data-menu-close]') : null;
      if (closeBtn) { closeMenu(true); return; }
      var link = e.target.closest ? e.target.closest('a[href]') : null;
      if (link) {
        var same = link.getAttribute('href') === location.hash;
        closeMenu(same);
      }
    });
  }

  /* ---------- route ---------- */
  function enter() {
    renderPanel();
    update(true); // วัดทันที (หน้าเพิ่งแสดง) ก่อนเฟรมแรก
    play();
  }

  function leave() {
    closeMenu(false);
    if (els.hero) els.hero.classList.remove('is-entering');
  }

  function onDataChanged() {
    if (active()) renderPanel();
  }

  /* ---------- init ---------- */
  function init() {
    if (started) return;
    els.page = document.querySelector('.page--welcome');
    els.hero = document.getElementById('hero');
    if (!els.page || !els.hero) return;
    started = true;
    els.nav = els.hero.querySelector('.hero-nav');
    els.title = document.getElementById('welcome-title');
    els.panel = document.getElementById('hero-panel');
    els.stars = document.getElementById('hero-stars');
    els.rim = document.getElementById('hero-rim');
    els.menu = document.getElementById('hero-menu');
    els.menuBtn = document.getElementById('hero-menu-btn');

    // ปุ่มเริ่มใช้งาน: จำว่าเคยผ่านหน้าแรกแล้ว (ลิงก์พาไป #/ เอง)
    els.hero.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-welcome-start], [data-welcome-slip]') : null;
      if (!t) return;
      if (t.hasAttribute('data-welcome-start')) {
        FM.set('welcomed', true);
      } else if (FM.ui && typeof FM.ui.openSlip === 'function') {
        FM.ui.openSlip(t);
      }
    });

    setupMenu();

    FM.on('route:changed', function (name) {
      if (name === 'welcome') enter();
      else leave();
    });
    FM.on('tx:changed', onDataChanged);
    FM.on('tasks:changed', onDataChanged);

    window.addEventListener('resize', function () { schedule(false); });
    window.addEventListener('orientationchange', function () { schedule(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') schedule(true);
    });
    if (mqDesk) {
      var onLayout = function () {
        if (isDesktop()) closeMenu(false);
        schedule(true);
      };
      if (mqDesk.addEventListener) mqDesk.addEventListener('change', onLayout);
      else if (mqDesk.addListener) mqDesk.addListener(onLayout);
    }
    // ฟอนต์โหลดเสร็จทำให้ตำแหน่งหัวเรื่องเปลี่ยน → วัดยอดโค้งใหม่
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { schedule(false); }, function () {});
    }

    // router.init ทำงานก่อนโมดูลนี้ → ถ้าเปิดมาที่หน้าแรกเลยต้องเริ่มเอง
    if (active()) enter();
  }

  window.FM = window.FM || {};
  FM.welcome = {
    init: init,
    render: renderPanel,
    _data: readData
  };
})();
