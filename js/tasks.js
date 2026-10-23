/* tasks.js — เพิ่ม/ติ๊ก/ลบงานประจำวัน + progress */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var tasks = [];
  var els = {};
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* ---------- helpers ---------- */
  function reduced() {
    return !!(reduceMq && reduceMq.matches);
  }

  function tokenMs(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      var n = parseFloat(v);
      if (!isFinite(n)) return fallback;
      return /ms$/.test(v) ? n : n * 1000;
    } catch (e) {
      return fallback;
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function svg(paths, cls, size) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', String(size || 20));
    s.setAttribute('height', String(size || 20));
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    if (cls) s.setAttribute('class', cls);
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  var ICON_TRASH = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4h6v3'];
  var ICON_CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
  var ICON_EMPTY = ['M9 4h6', 'M9 4a1 1 0 0 0-1 1v1h8V5a1 1 0 0 0-1-1', 'M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2', 'M9 12h6', 'M9 16h4'];

  function sanitize(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (t) {
      return t && typeof t.text === 'string' && t.id;
    }).map(function (t) {
      return { id: String(t.id), text: t.text, done: !!t.done, ts: Number(t.ts) || 0 };
    });
  }

  function save() {
    FM.set('tasks', tasks);
    FM.emit('tasks:changed', tasks.slice());
  }

  function findIndex(id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return i;
    return -1;
  }

  /* FLIP: เลื่อนแถวที่เหลือไปตำแหน่งใหม่ด้วย transform เท่านั้น */
  function flip(mutate) {
    if (reduced()) { mutate(); return; }
    var items = Array.prototype.slice.call(els.list.children);
    var before = items.map(function (li) { return li.getBoundingClientRect().top; });
    mutate();
    var dur = tokenMs('--dur', 250);
    items.forEach(function (li, i) {
      if (!li.isConnected) return;
      var dy = before[i] - li.getBoundingClientRect().top;
      if (!dy) return;
      li.style.transition = 'none';
      li.style.transform = 'translateY(' + dy + 'px)';
      li.getBoundingClientRect(); /* force reflow */
      li.style.transition = 'transform ' + dur + 'ms var(--ease)';
      li.style.transform = '';
      var clear = function () { li.style.transition = ''; };
      li.addEventListener('transitionend', clear, { once: true });
      setTimeout(clear, dur + 50);
    });
  }

  /* ---------- rows ---------- */
  function buildRow(task) {
    var li = el('li', 'task' + (task.done ? ' is-done' : ''));
    li.dataset.id = task.id;

    var label = el('label', 'task__check');
    var box = el('span', 'task__box');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'task__cb';
    cb.checked = task.done;
    box.appendChild(cb);
    box.appendChild(svg(ICON_CHECK, 'task__tick', 16));
    var text = el('span', 'task__text', task.text);
    label.appendChild(box);
    label.appendChild(text);

    var del = el('button', 'icon-btn task__del');
    del.type = 'button';
    del.setAttribute('aria-label', 'ลบงาน: ' + task.text);
    del.appendChild(svg(ICON_TRASH, 'icon', 20));

    li.appendChild(label);
    li.appendChild(del);
    return li;
  }

  /* ข้อความเกิน 1 บรรทัด → ใช้ line-through แทนเส้นวาด (ดู tasks.css) */
  function markMultiline(li) {
    var t = li.querySelector('.task__text');
    if (!t) return;
    var lh = parseFloat(getComputedStyle(t).lineHeight) || 24;
    li.classList.toggle('is-multiline', t.getBoundingClientRect().height > lh * 1.5);
  }

  function markAll() {
    Array.prototype.forEach.call(els.list.children, markMultiline);
  }

  function rowById(id) {
    var rows = els.list.children;
    for (var i = 0; i < rows.length; i++) if (rows[i].dataset.id === id) return rows[i];
    return null;
  }

  function removeRows(lis, done) {
    if (!lis.length) { if (done) done(); return; }
    var finish = function () {
      flip(function () {
        lis.forEach(function (li) { if (li.parentNode) li.parentNode.removeChild(li); });
      });
      if (done) done();
    };
    if (reduced()) { finish(); return; }
    var dur = tokenMs('--dur', 250);
    lis.forEach(function (li) { li.classList.add('is-leaving'); });
    var called = false;
    var once = function () { if (called) return; called = true; finish(); };
    lis[0].addEventListener('animationend', once, { once: true });
    setTimeout(once, dur + 80);
  }

  /* ---------- summary / states ---------- */
  function updateSummary() {
    var total = tasks.length;
    var doneCount = tasks.filter(function (t) { return t.done; }).length;

    els.progress.hidden = total === 0;
    els.doneNum.textContent = String(doneCount);
    els.totalNum.textContent = String(total);
    els.bar.setAttribute('aria-valuemax', String(total));
    els.bar.setAttribute('aria-valuenow', String(doneCount));
    els.bar.setAttribute('aria-valuetext', 'เสร็จแล้ว ' + doneCount + ' จาก ' + total + ' งาน');
    els.fill.style.transform = 'scaleX(' + (total ? doneCount / total : 0) + ')';

    els.empty.hidden = total !== 0;
    els.list.hidden = total === 0;

    var allDone = total > 0 && doneCount === total;
    els.status.textContent = allDone ? 'ทำครบทุกงานแล้ว' : '';
    els.status.hidden = !allDone;

    els.clear.hidden = doneCount === 0;
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = !msg;
    if (msg) els.input.setAttribute('aria-invalid', 'true');
    else els.input.removeAttribute('aria-invalid');
  }

  /* ---------- actions ---------- */
  function addTask() {
    var text = els.input.value.trim();
    if (!text) {
      showError('พิมพ์ชื่องานก่อนเพิ่ม');
      els.input.focus();
      return;
    }
    showError('');
    var task = { id: FM.uid(), text: text, done: false, ts: Date.now() };
    tasks.unshift(task);
    save();

    var li = buildRow(task);
    if (!reduced()) li.classList.add('is-entering');
    flip(function () { els.list.insertBefore(li, els.list.firstChild); });
    markMultiline(li);
    li.addEventListener('animationend', function () { li.classList.remove('is-entering'); }, { once: true });

    updateSummary();
    els.input.value = '';
    els.input.focus();
  }

  function toggleTask(id, checked) {
    var i = findIndex(id);
    if (i === -1) return;
    tasks[i].done = checked;
    save();
    updateSummary();
  }

  function deleteTask(id) {
    var i = findIndex(id);
    if (i === -1) return;
    var li = rowById(id);
    if (!li || li.classList.contains('is-leaving')) return;

    /* ย้ายโฟกัสไปแถวถัดไป/ก่อนหน้า หรือช่องพิมพ์ */
    var target = li.nextElementSibling || li.previousElementSibling;
    while (target && target.classList.contains('is-leaving')) target = target.nextElementSibling;
    var focusEl = target ? target.querySelector('.task__del') : els.input;

    tasks.splice(i, 1);
    save();
    updateSummaryDeferred();
    if (focusEl) focusEl.focus();
    removeRows([li], updateSummary);
  }

  function clearDone() {
    var doneIds = tasks.filter(function (t) { return t.done; }).map(function (t) { return t.id; });
    if (!doneIds.length) return;
    tasks = tasks.filter(function (t) { return !t.done; });
    save();
    var lis = doneIds.map(rowById).filter(Boolean);
    els.input.focus();
    updateSummaryDeferred();
    removeRows(lis, updateSummary);
  }

  /* นับเลข/แถบทันที แต่ empty state รอจนแถวสุดท้ายหายไปก่อน */
  function updateSummaryDeferred() {
    var hadRows = els.list.children.length > 0;
    updateSummary();
    if (tasks.length === 0 && hadRows) {
      els.empty.hidden = true;
      els.list.hidden = false;
    }
  }

  /* ---------- build ---------- */
  function build(root) {
    var wrap = el('div', 'tasks');

    if (FM.storageOk === false) {
      wrap.appendChild(el('p', 'tasks__notice', 'เบราว์เซอร์นี้บันทึกข้อมูลไม่ได้ งานจะหายเมื่อรีโหลดหน้า ลองปิดโหมดส่วนตัวหรืออนุญาตการเก็บข้อมูล'));
    }

    /* progress */
    var progress = el('div', 'tasks__progress');
    var count = el('p', 'tasks__count');
    count.appendChild(document.createTextNode('เสร็จแล้ว '));
    var doneNum = el('span', 'num', '0');
    var totalNum = el('span', 'num', '0');
    count.appendChild(doneNum);
    count.appendChild(el('span', 'num', '/'));
    count.appendChild(totalNum);
    var bar = el('div', 'tasks__bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'ความคืบหน้างานวันนี้');
    bar.setAttribute('aria-valuemin', '0');
    var fill = el('div', 'tasks__bar-fill');
    bar.appendChild(fill);
    progress.appendChild(count);
    progress.appendChild(bar);
    wrap.appendChild(progress);

    /* form */
    var form = el('form', 'tasks__form');
    form.noValidate = true;
    var field = el('div', 'field');
    var label = el('label', 'field__label', 'งานที่ต้องทำ');
    label.htmlFor = 'task-input';
    var row = el('div', 'tasks__form-row');
    var input = el('input', 'input tasks__input');
    input.type = 'text';
    input.id = 'task-input';
    input.maxLength = 120;
    input.autocomplete = 'off';
    input.setAttribute('aria-describedby', 'task-error');
    var btn = el('button', 'btn btn--primary tasks__add', 'เพิ่มงาน');
    btn.type = 'submit';
    row.appendChild(input);
    row.appendChild(btn);
    var error = el('p', 'field__error');
    error.id = 'task-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    field.appendChild(label);
    field.appendChild(row);
    field.appendChild(error);
    form.appendChild(field);
    wrap.appendChild(form);

    /* all-done status */
    var status = el('p', 'tasks__status');
    status.setAttribute('role', 'status');
    status.hidden = true;
    wrap.appendChild(status);

    /* list */
    var list = el('ul', 'tasks__list');
    list.setAttribute('aria-label', 'รายการงาน');
    wrap.appendChild(list);

    /* empty */
    var empty = el('div', 'tasks__empty');
    empty.appendChild(svg(ICON_EMPTY, 'tasks__empty-icon', 32));
    empty.appendChild(el('p', '', 'ยังไม่มีงานวันนี้ พิมพ์งานแรกด้านบนแล้วกดเพิ่ม'));
    wrap.appendChild(empty);

    /* clear done */
    var clear = el('button', 'tasks__clear', 'ล้างงานที่เสร็จแล้ว');
    clear.type = 'button';
    clear.hidden = true;
    wrap.appendChild(clear);

    root.textContent = '';
    root.appendChild(wrap);

    els = {
      progress: progress, doneNum: doneNum, totalNum: totalNum, bar: bar, fill: fill,
      form: form, input: input, error: error, status: status, list: list, empty: empty, clear: clear
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      addTask();
    });
    input.addEventListener('input', function () {
      if (!els.error.hidden && input.value.trim()) showError('');
    });
    list.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains('task__cb')) return;
      var li = t.closest('.task');
      if (!li) return;
      li.classList.toggle('is-done', t.checked);
      toggleTask(li.dataset.id, t.checked);
    });
    list.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.task__del') : null;
      if (!b) return;
      var li = b.closest('.task');
      if (li) deleteTask(li.dataset.id);
    });
    clear.addEventListener('click', clearDone);
  }

  function init() {
    var root = document.getElementById('tasks-root');
    if (!root) return;
    tasks = sanitize(FM.get('tasks', []));
    build(root);
    tasks.forEach(function (t) { els.list.appendChild(buildRow(t)); });
    updateSummary();
    markAll();
    var raf = 0;
    window.addEventListener('resize', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; markAll(); });
    });
    /* ฟอนต์โหลดเสร็จทีหลังอาจเปลี่ยนจำนวนบรรทัด */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(markAll);
  }

  /* อ่าน 'tasks' จาก storage ใหม่แล้ววาดรายการ+สรุปใหม่ (ใช้เมื่อโมดูลอื่น เช่น cloud.js เขียนข้อมูลแทน) — ไม่ emit */
  function reload() {
    if (!els.list) return;
    var active = document.activeElement;
    var focusId = null;
    var focusSel = null;
    if (active && els.list.contains(active)) {
      var row = active.closest('.task');
      if (row) {
        focusId = row.dataset.id;
        focusSel = active.classList.contains('task__del') ? '.task__del' : '.task__cb';
      }
    }
    tasks = sanitize(FM.get('tasks', []));
    els.list.textContent = '';
    tasks.forEach(function (t) { els.list.appendChild(buildRow(t)); });
    updateSummary();
    markAll();
    if (focusId) {
      var again = rowById(focusId);
      var target = again && again.querySelector(focusSel);
      if (target) target.focus();
    }
  }

  window.FM = window.FM || {};
  FM.tasks = { init: init, reload: reload };
})();
