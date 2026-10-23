/* cloud.js — ซิงก์ข้อมูลขึ้น Supabase แบบ local-first
 *
 * หลักการ
 * - โมดูลเดิม (balance/slip/tasks) ยังเขียน localStorage เหมือนเดิมทุกอย่าง ไฟล์นี้แค่ "ฟัง" event
 *   'balance:changed' / 'tx:changed' / 'tasks:changed' แล้วนัดดันข้อมูลขึ้นคลาวด์ (debounce 600ms)
 * - Supabase = แหล่งข้อมูลจริง, localStorage = แคชออฟไลน์
 * - ไม่มีไลบรารี / ไม่มี config / ออฟไลน์ / ไม่ได้เข้าสู่ระบบ → แอปทำงานเหมือนเดิมทุกอย่าง
 *
 * สถานะการซิงก์เก็บใน fm.sync = {
 *   uid,                      // บัญชีล่าสุดที่ใช้เครื่องนี้ (กันรวมข้อมูลข้ามบัญชี)
 *   tx: [id], tasks: [id],    // snapshot: id ที่รู้ว่ามีบนคลาวด์ ณ การซิงก์สำเร็จล่าสุด
 *                             //   id อยู่ใน snapshot แต่หายจากเครื่อง = ผู้ใช้ลบในเครื่องนี้ → ลบบนคลาวด์
 *   pendingTx, pendingTasks,  // id ที่แก้ในเครื่องแต่ยังดันขึ้นไม่สำเร็จ (ตอน merge ฝั่งเครื่องชนะเฉพาะ id เหล่านี้)
 *   balanceDirty              // ยอดเงินแก้ในเครื่องแต่ยังดันขึ้นไม่สำเร็จ
 * }
 * fm.balance_ts = เวลา (ms) ที่ยอดเงินในเครื่องถูกแก้ล่าสุด ใช้เทียบกับ balances.updated_at
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 600;
  var UPSERT_BATCH = 500;      // แถวต่อคำขอ upsert
  var DELETE_BATCH = 200;      // id ต่อคำขอ delete (id อยู่ใน query string — กัน URL ยาวเกิน)
  var PAGE = 1000;             // แถวต่อหน้าเวลาดึง (Supabase จำกัดจำนวนแถวต่อคำขอ)
  var BACKOFF_BASE = 2000;
  var BACKOFF_MAX = 60000;
  var AMOUNT_LIMIT = 1e12;     // numeric(14,2) เก็บได้ < 1e12 จึงต้อง "น้อยกว่า" ไม่ใช่ "ไม่เกิน"
  var TEXT_MAX = 120;
  var ID_MAX = 100;
  var AUTH_KEY = 'fm.auth';    // ที่เก็บ session ของ supabase-js ใน localStorage (prefix fm.)
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var T = {
    unavailable: 'ซิงก์ไม่พร้อมใช้งาน',
    unavailableHint: 'โหลดระบบซิงก์ไม่สำเร็จ ข้อมูลยังบันทึกในเครื่องนี้ตามปกติ ตรวจสอบอินเทอร์เน็ตแล้วรีโหลดหน้า',
    checking: 'กำลังตรวจสอบบัญชี…',
    signIn: 'เข้าสู่ระบบเพื่อซิงก์',
    signOut: 'ออกจากระบบ',
    syncNow: 'ซิงก์ตอนนี้',
    synced: 'ซิงก์แล้ว',
    syncing: 'กำลังซิงก์…',
    offline: 'ออฟไลน์ — จะซิงก์เมื่อออนไลน์',
    failed: 'ซิงก์ไม่สำเร็จ',
    failedHint: 'ข้อมูลยังอยู่ในเครื่องนี้ ระบบจะลองซิงก์ใหม่อัตโนมัติ หรือกดซิงก์ตอนนี้',
    dlgTitle: 'เข้าสู่ระบบ',
    dlgHelp: 'เราจะส่งลิงก์เข้าสู่ระบบแบบใช้ครั้งเดียวไปที่อีเมลของคุณ ไม่ต้องตั้งรหัสผ่าน ระหว่างนี้ข้อมูลจะเก็บอยู่ในเครื่องนี้เท่านั้นจนกว่าจะเข้าสู่ระบบ',
    emailLabel: 'อีเมล',
    send: 'ส่งลิงก์เข้าสู่ระบบ',
    sending: 'กำลังส่ง…',
    close: 'ปิด',
    errEmpty: 'กรอกอีเมลก่อนส่งลิงก์',
    errEmail: 'รูปแบบอีเมลไม่ถูกต้อง ตัวอย่าง name@example.com',
    errFile: 'เปิดผ่านเว็บเซิร์ฟเวอร์ (เช่น http://localhost) ก่อนจึงจะเข้าสู่ระบบได้',
    errRate: 'ขอลิงก์บ่อยเกินไป รอประมาณ 1 นาทีแล้วลองใหม่',
    errNetwork: 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    errInvalid: 'ระบบไม่รับอีเมลนี้ ตรวจสอบตัวสะกดแล้วลองใหม่',
    errDisabled: 'ระบบยังไม่เปิดให้เข้าสู่ระบบด้วยอีเมล ติดต่อผู้ดูแลระบบ',
    errConfig: 'ระบบซิงก์ตั้งค่าไม่ถูกต้อง แจ้งผู้ดูแลระบบ',
    errGeneric: 'ส่งลิงก์ไม่สำเร็จ ลองใหม่อีกครั้งในอีกสักครู่',
    errUnavailable: 'ระบบซิงก์ยังไม่พร้อม ตรวจสอบอินเทอร์เน็ตแล้วรีโหลดหน้า',
    errLinkExpired: 'ลิงก์เข้าสู่ระบบหมดอายุหรือถูกใช้ไปแล้ว กรอกอีเมลเพื่อขอลิงก์ใหม่',
    errLinkFailed: 'เข้าสู่ระบบจากลิงก์ไม่สำเร็จ กรอกอีเมลเพื่อขอลิงก์ใหม่'
  };

  /* ================= pure helpers (ไม่แตะ DOM/storage — ทดสอบได้) ================= */

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function round2(x) { return Math.round(x * 100) / 100; }

  function toSet(v) {
    var s = {};
    if (Array.isArray(v)) v.forEach(function (id) { s[String(id)] = true; });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (id) { s[id] = true; });
    return s;
  }

  function cleanId(id) {
    if (typeof id !== 'string' && typeof id !== 'number') return null;
    var s = String(id);
    return s.length >= 1 && s.length <= ID_MAX ? s : null;
  }

  function cleanTs(ts) {
    if (ts === null || ts === undefined || ts === '' || typeof ts === 'boolean') return null;
    var n = Number(ts);
    return isFinite(n) && n >= 0 && n <= 8.64e15 ? Math.round(n) : null;
  }

  function cleanAmount(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = Number(v); // numeric จาก PostgREST อาจมาเป็น string
    if (!isFinite(n)) return null;
    n = round2(n);
    return n > 0 && n < AMOUNT_LIMIT ? n : null;
  }

  /* หมวดหมู่: key ที่ถูกต้องสำหรับชนิดนั้น (FM.cats) หรือ null — ไม่มี/ไม่รู้จัก/ผิดชนิด → null
   * (ไม่ทำให้ทั้งแถวไม่ถูกต้อง: tx เก่าที่ไม่มี category และแถวคลาวด์ที่ไม่มีคอลัมน์นี้ยังซิงก์ได้) */
  function cleanCategory(type, key) {
    if (typeof key !== 'string' || !FM.cats || typeof FM.cats.normalize !== 'function') return null;
    return FM.cats.normalize(type, key);
  }

  /* แถวรายการเงิน: คืนรูปแบบมาตรฐานของเครื่อง หรือ null ถ้าไม่ถูกต้อง */
  function cleanTx(t) {
    if (!t || typeof t !== 'object') return null;
    var id = cleanId(t.id);
    if (id === null) return null;
    if (t.type !== 'income' && t.type !== 'expense') return null;
    if (t.source !== 'slip' && t.source !== 'manual') return null;
    var amount = cleanAmount(t.amount);
    var ts = cleanTs(t.ts);
    if (amount === null || ts === null) return null;
    return { id: id, type: t.type, amount: amount, ts: ts, source: t.source, category: cleanCategory(t.type, t.category) };
  }

  function cleanTask(t) {
    if (!t || typeof t !== 'object') return null;
    var id = cleanId(t.id);
    if (id === null) return null;
    if (typeof t.text !== 'string' || !t.text.trim() || t.text.length > TEXT_MAX) return null;
    var ts = cleanTs(t.ts);
    if (ts === null) return null;
    return { id: id, text: t.text, done: t.done === true, ts: ts };
  }

  function sameRow(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function tsOf(r) { return (r && Number(r.ts)) || 0; }
  function byTsAsc(a, b) { return tsOf(a) - tsOf(b); }
  function byTsDesc(a, b) { return tsOf(b) - tsOf(a); }

  /* รวมรายการแบบ union ตาม id
   * - id มีทั้งสองฝั่ง: คลาวด์ชนะ ยกเว้น id นั้นยังมีการแก้ในเครื่องที่ค้างอยู่ (pending) → เครื่องชนะ
   * - มีเฉพาะคลาวด์: ถ้าเคยซิงก์แล้ว (อยู่ใน snapshot) = ผู้ใช้ลบในเครื่องนี้ → ไม่ดึงกลับ และนัดลบบนคลาวด์
   *                  ถ้าไม่เคยซิงก์ = เพิ่มจากเครื่องอื่น → ดึงลงมา
   * - มีเฉพาะเครื่อง: ถ้าเคยซิงก์แล้วและไม่ pending = ถูกลบจากเครื่องอื่น → ลบในเครื่องตาม
   *                  ไม่อย่างนั้น = ของใหม่ในเครื่อง → นัดดันขึ้น
   * - แถวในเครื่องที่ข้อมูลไม่ถูกต้อง: เก็บไว้ในเครื่องตามเดิม (ไม่ทำข้อมูลผู้ใช้หาย) แต่ไม่ส่งขึ้น
   * - แถวจากคลาวด์ที่ไม่ถูกต้อง: ทิ้ง (ถือเป็นข้อมูลไม่น่าเชื่อถือ) */
  function mergeList(localArr, remoteArr, clean, syncedIds, pendingIds, sortFn) {
    var synced = toSet(syncedIds);
    var pending = toSet(pendingIds);
    var localList = Array.isArray(localArr) ? localArr : [];
    var out = { rows: null, changed: false, upsert: [], remove: [], remoteIds: [], invalidLocal: 0, invalidRemote: 0 };

    var remoteMap = {};
    var remoteOrder = [];
    (Array.isArray(remoteArr) ? remoteArr : []).forEach(function (r) {
      var c = clean(r);
      if (!c) { out.invalidRemote++; return; }
      if (!has(remoteMap, c.id)) remoteOrder.push(c.id);
      remoteMap[c.id] = c;
    });
    out.remoteIds = remoteOrder.slice();

    var rows = [];
    var seen = {};
    localList.forEach(function (l) {
      var c = clean(l);
      if (!c) { out.invalidLocal++; rows.push(l); return; }
      if (has(seen, c.id)) { rows.push(l); return; } // id ซ้ำในเครื่อง: เก็บไว้ ไม่ประมวลผลซ้ำ
      seen[c.id] = true;
      if (has(remoteMap, c.id)) {
        var r = remoteMap[c.id];
        if (pending[c.id]) {
          rows.push(l);
          if (!sameRow(c, r)) out.upsert.push(c);
        } else if (sameRow(c, r)) {
          rows.push(l);
        } else {
          rows.push(r);
          out.changed = true;
        }
      } else if (synced[c.id] && !pending[c.id]) {
        out.changed = true; // ถูกลบจากเครื่องอื่น
      } else {
        rows.push(l);
        out.upsert.push(c);
      }
    });

    remoteOrder.forEach(function (id) {
      if (has(seen, id)) return;
      if (synced[id]) { out.remove.push(id); return; }
      rows.push(remoteMap[id]);
      out.changed = true;
    });

    out.rows = out.changed ? rows.sort(sortFn) : localList.slice();
    return out;
  }

  /* ยอดเงิน: ฝั่งที่เวลาแก้ล่าสุดใหม่กว่าชนะ (เวลาเท่ากัน → คลาวด์ชนะ) */
  function mergeBalance(local, remote) {
    var lRaw = local.balance;
    var lb = Number(lRaw);
    var hasLocal = lRaw !== null && lRaw !== undefined && isFinite(lb);
    if (!hasLocal) lb = 0;
    var lts = cleanTs(local.balanceTs) || 0;

    var invalid = 0;
    var rRaw = remote.balance;
    var rb = null;
    if (rRaw !== null && rRaw !== undefined && rRaw !== '' && typeof rRaw !== 'boolean') {
      rb = Number(rRaw);
      if (!isFinite(rb) || Math.abs(rb) >= AMOUNT_LIMIT) { rb = null; invalid = 1; }
    }
    var rts = cleanTs(remote.balanceTs) || 0;

    if (rb === null) {
      return { balance: lb, balanceTs: lts, from: hasLocal ? 'local' : 'none', push: hasLocal, changed: false, invalidRemote: invalid };
    }
    if (hasLocal && lts > rts) {
      return { balance: lb, balanceTs: lts, from: 'local', push: true, changed: false, invalidRemote: 0 };
    }
    rb = round2(rb);
    if (rb === 0) rb = 0; // กัน -0
    return { balance: rb, balanceTs: rts, from: 'remote', push: false, changed: !hasLocal || rb !== lb, invalidRemote: 0 };
  }

  /* _merge(local, remote, meta?) — pure
   * local/remote: { balance, balanceTs, tx, tasks } (remote.balance = null เมื่อยังไม่มีแถวบนคลาวด์)
   * meta (ไม่บังคับ): { tx:[id], tasks:[id], pendingTx:[id], pendingTasks:[id] } */
  function merge(local, remote, meta) {
    local = local || {};
    remote = remote || {};
    meta = meta || {};
    var b = mergeBalance(local, remote);
    var tx = mergeList(local.tx, remote.tx, cleanTx, meta.tx, meta.pendingTx, byTsAsc);
    var tasks = mergeList(local.tasks, remote.tasks, cleanTask, meta.tasks, meta.pendingTasks, byTsDesc);
    return {
      balance: b.balance,
      balanceTs: b.balanceTs,
      balanceFrom: b.from,
      tx: tx.rows,
      tasks: tasks.rows,
      changed: { balance: b.changed, tx: tx.changed, tasks: tasks.changed },
      push: { balance: b.push, tx: tx.upsert, tasks: tasks.upsert, removeTx: tx.remove, removeTasks: tasks.remove },
      remoteIds: { tx: tx.remoteIds, tasks: tasks.remoteIds },
      invalid: {
        local: tx.invalidLocal + tasks.invalidLocal,
        remote: tx.invalidRemote + tasks.invalidRemote + b.invalidRemote
      }
    };
  }

  function validateEmail(v) {
    var s = String(v || '').trim();
    if (!s) return T.errEmpty;
    if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return T.errEmail;
    return '';
  }

  /* magic link ต้องกลับมาที่ origin แบบ http(s) — file:// ใช้ไม่ได้ */
  function protocolError(protocol) {
    return protocol === 'http:' || protocol === 'https:' ? '' : T.errFile;
  }

  function mapAuthError(err) {
    var e = err || {};
    var code = String(e.code || '');
    var status = Number(e.status) || 0;
    var msg = String(e.message || '');
    var name = String(e.name || '');
    if (status === 429 || /rate_limit/.test(code) || /rate limit|too many/i.test(msg)) return T.errRate;
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || name === 'AuthRetryableFetchError' ||
        /failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return T.errNetwork;
    if (/signup_disabled|otp_disabled|email_provider_disabled/.test(code) || /signups not allowed|disabled/i.test(msg)) return T.errDisabled;
    if (/email_address_invalid|validation_failed|email_address_not_authorized/.test(code) || (status === 400 && /email/i.test(msg))) return T.errInvalid;
    if (status === 401 || status === 403 || /invalid api key|no api key/i.test(msg)) return T.errConfig;
    return T.errGeneric;
  }

  function maskEmail(email) {
    var e = String(email || '');
    var at = e.lastIndexOf('@');
    if (at < 1) return '•••';
    var name = e.slice(0, at);
    var keep = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
    return keep + '•••@' + e.slice(at + 1);
  }

  /* ================= state ================= */

  var client = null;
  var enabled = false;     // มี config + ไลบรารี + สร้าง client ได้
  var tracking = false;    // ฟัง event ในเครื่องแล้ว
  var initialDone = false; // ได้ INITIAL_SESSION แล้ว
  var started = false;
  var uid = null;
  var email = '';
  var manualSignOut = false;

  var applying = false;    // true ระหว่างที่ไฟล์นี้ emit เอง → listener ของเราต้องข้าม (กันวน push→pull→emit)
  var meta = null;
  var seq = 0;
  var balanceSeq = 0;
  var lastSeen = { tx: {}, tasks: {} };

  var busy = false;
  var queued = null;       // 'push' | 'full'
  var debounceTimer = 0;
  var retryTimer = 0;
  var attempts = 0;
  var status = 'synced';
  var lastInvalid = 0;
  var idleWaiters = [];

  var ui = {};
  var urlAuthError = '';

  var ABORT = { aborted: true };

  /* ================= storage ================= */

  function readArr(key) {
    var a = FM.get(key, []);
    return Array.isArray(a) ? a : [];
  }

  function readLocal() {
    return {
      balance: FM.get('balance', null),
      balanceTs: Number(FM.get('balance_ts', 0)) || 0,
      tx: readArr('tx'),
      tasks: readArr('tasks')
    };
  }

  function idList(v) {
    if (!Array.isArray(v)) return [];
    return v.map(cleanId).filter(function (x) { return x !== null; });
  }

  function pendingMap(v) {
    var m = {};
    idList(v).forEach(function (id) { m[id] = 0; });
    return m;
  }

  function freshMeta(forUid) {
    return { uid: forUid || null, tx: [], tasks: [], pendingTx: {}, pendingTasks: {}, balanceDirty: false };
  }

  function loadMeta() {
    var raw = FM.get('sync', null);
    if (!raw || typeof raw !== 'object') return freshMeta(null);
    return {
      uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : null,
      tx: idList(raw.tx),
      tasks: idList(raw.tasks),
      pendingTx: pendingMap(raw.pendingTx),
      pendingTasks: pendingMap(raw.pendingTasks),
      balanceDirty: raw.balanceDirty === true
    };
  }

  function saveMeta() {
    FM.set('sync', {
      uid: meta.uid,
      tx: meta.tx,
      tasks: meta.tasks,
      pendingTx: Object.keys(meta.pendingTx),
      pendingTasks: Object.keys(meta.pendingTasks),
      balanceDirty: meta.balanceDirty
    });
  }

  /* จำหน้าตาข้อมูลในเครื่องล่าสุด เพื่อรู้ว่า event รอบถัดไปแก้ id ไหน */
  function snapshotSeen(kind) {
    var clean = kind === 'tx' ? cleanTx : cleanTask;
    var next = {};
    readArr(kind).forEach(function (row) {
      var c = clean(row);
      if (c) next[c.id] = JSON.stringify(c);
    });
    lastSeen[kind] = next;
    return next;
  }

  function trackPending(kind) {
    var before = lastSeen[kind];
    var now = snapshotSeen(kind);
    var pend = kind === 'tx' ? meta.pendingTx : meta.pendingTasks;
    Object.keys(now).forEach(function (id) {
      if (before[id] !== now[id]) pend[id] = ++seq;
    });
    // id ที่หายไป = ถูกลบ → ไม่ต้องค้าง pending (การลบดูจาก snapshot แทน)
    Object.keys(pend).forEach(function (id) { if (!has(now, id)) delete pend[id]; });
    saveMeta();
  }

  /* ================= local events ================= */

  function onLocalBalance() {
    if (applying) return;
    FM.set('balance_ts', Date.now());
    meta.balanceDirty = true;
    balanceSeq = ++seq;
    saveMeta();
    schedulePush();
  }

  function onLocalTx() {
    if (applying) return;
    trackPending('tx');
    schedulePush();
  }

  function onLocalTasks() {
    if (applying) return;
    trackPending('tasks');
    schedulePush();
  }

  /* เขียนผล merge ลงเครื่องแล้วให้โมดูลอื่นวาดใหม่ */
  function applyMerged(m) {
    var cur = readLocal();
    if (m.balanceFrom !== 'none') {
      if (m.changed.balance || cur.balance !== m.balance) FM.set('balance', m.balance);
      if (cur.balanceTs !== m.balanceTs) FM.set('balance_ts', m.balanceTs);
    }
    if (m.changed.tx) FM.set('tx', m.tx);
    if (m.changed.tasks) FM.set('tasks', m.tasks);

    applying = true;
    try {
      if (m.changed.balance) FM.emit('balance:changed', m.balance);
      if (m.changed.tx) FM.emit('tx:changed', m.tx.slice());
    } finally {
      applying = false;
    }
    if (m.changed.tasks && FM.tasks && typeof FM.tasks.reload === 'function') {
      try { FM.tasks.reload(); } catch (e) { /* ไม่ให้การวาดใหม่ล้มทำให้ซิงก์ล้ม */ }
    }
    snapshotSeen('tx');
    snapshotSeen('tasks');
  }

  /* บัญชีอื่นเข้าสู่ระบบบนเครื่องที่มีแคชของบัญชีเดิม → ล้างแคชก่อน ห้ามรวมข้อมูลข้ามบัญชี */
  function adoptUser(newUid) {
    if (meta.uid && meta.uid !== newUid) {
      FM.set('balance', 0);
      FM.set('balance_ts', 0);
      FM.set('tx', []);
      FM.set('tasks', []);
      applying = true;
      try {
        FM.emit('balance:changed', 0);
        FM.emit('tx:changed', []);
      } finally {
        applying = false;
      }
      if (FM.tasks && typeof FM.tasks.reload === 'function') {
        try { FM.tasks.reload(); } catch (e) {}
      }
      meta = freshMeta(newUid);
      balanceSeq = 0;
    } else {
      meta.uid = newUid; // ครั้งแรกที่เข้าสู่ระบบ: ข้อมูลที่ใช้แบบไม่ล็อกอินจะถูกรวมขึ้นบัญชีนี้
    }
    snapshotSeen('tx');
    snapshotSeen('tasks');
    saveMeta();
  }

  /* ================= network ================= */

  function q(builder) {
    return Promise.resolve(builder).then(function (res) {
      if (res && res.error) throw res.error;
      return res ? res.data : null;
    });
  }

  function fetchAll(table, cols, forUid) {
    var all = [];
    function page(from) {
      return q(client.from(table).select(cols).eq('user_id', forUid).order('id', { ascending: true }).range(from, from + PAGE - 1))
        .then(function (rows) {
          rows = Array.isArray(rows) ? rows : [];
          all = all.concat(rows);
          return rows.length === PAGE ? page(from + PAGE) : all;
        });
    }
    return page(0);
  }

  function chunks(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /* วางแผนว่าจะส่งอะไรขึ้น: id ที่ pending หรือยังไม่เคยอยู่บนคลาวด์ + id ที่ลบในเครื่อง */
  function planPush(forUid) {
    var local = readLocal();
    var plan = { balance: null, tx: [], tasks: [], delTx: [], delTasks: [], invalid: 0 };

    function collect(rows, clean, snapshot, pending, outRows, outDel) {
      var snap = toSet(snapshot);
      var present = {};
      var picked = {};
      rows.forEach(function (row) {
        var anyId = row && cleanId(row.id);
        if (anyId !== null) present[anyId] = true;
        var c = clean(row);
        if (!c) { plan.invalid++; return; }
        if (has(picked, c.id)) return; // id ซ้ำใน batch เดียวกันทำให้ upsert ล้มทั้งชุด
        if (has(pending, c.id) || !snap[c.id]) {
          picked[c.id] = true;
          c.user_id = forUid;
          outRows.push(c);
        }
      });
      snapshot.forEach(function (id) { if (!present[id]) outDel.push(id); });
    }

    collect(local.tx, cleanTx, meta.tx, meta.pendingTx, plan.tx, plan.delTx);
    collect(local.tasks, cleanTask, meta.tasks, meta.pendingTasks, plan.tasks, plan.delTasks);

    if (meta.balanceDirty) {
      var b = Number(local.balance);
      if (local.balance !== null && isFinite(b) && Math.abs(b) < AMOUNT_LIMIT) {
        var ts = local.balanceTs > 0 ? local.balanceTs : Date.now();
        plan.balance = { user_id: forUid, amount: round2(b), updated_at: new Date(ts).toISOString() };
      } else {
        plan.invalid++;
      }
    }
    return plan;
  }

  function push(forUid) {
    var plan = planPush(forUid);
    var pendTxAt = {};
    var pendTasksAt = {};
    Object.keys(meta.pendingTx).forEach(function (id) { pendTxAt[id] = meta.pendingTx[id]; });
    Object.keys(meta.pendingTasks).forEach(function (id) { pendTasksAt[id] = meta.pendingTasks[id]; });
    var balSeqAt = balanceSeq;
    var balDirtyAt = meta.balanceDirty;

    var steps = [];
    if (plan.balance) {
      steps.push(function () { return q(client.from('balances').upsert(plan.balance, { onConflict: 'user_id' })); });
    }
    chunks(plan.tx, UPSERT_BATCH).forEach(function (rows) {
      steps.push(function () { return q(client.from('transactions').upsert(rows, { onConflict: 'user_id,id' })); });
    });
    chunks(plan.tasks, UPSERT_BATCH).forEach(function (rows) {
      steps.push(function () { return q(client.from('tasks').upsert(rows, { onConflict: 'user_id,id' })); });
    });
    chunks(plan.delTx, DELETE_BATCH).forEach(function (ids) {
      steps.push(function () { return q(client.from('transactions').delete().eq('user_id', forUid).in('id', ids)); });
    });
    chunks(plan.delTasks, DELETE_BATCH).forEach(function (ids) {
      steps.push(function () { return q(client.from('tasks').delete().eq('user_id', forUid).in('id', ids)); });
    });

    var chain = Promise.resolve();
    steps.forEach(function (fn) {
      chain = chain.then(function () {
        if (uid !== forUid) throw ABORT;
        return fn();
      });
    });

    return chain.then(function () {
      if (uid !== forUid) throw ABORT;
      function nextSnapshot(snapshot, del, rows) {
        var gone = toSet(del);
        var out = snapshot.filter(function (id) { return !gone[id]; });
        var inSnap = toSet(out);
        rows.forEach(function (r) { if (!inSnap[r.id]) { out.push(r.id); inSnap[r.id] = true; } });
        return out;
      }
      meta.tx = nextSnapshot(meta.tx, plan.delTx, plan.tx);
      meta.tasks = nextSnapshot(meta.tasks, plan.delTasks, plan.tasks);
      // ล้าง pending เฉพาะ id ที่ไม่ได้ถูกแก้ซ้ำระหว่างกำลังส่ง
      Object.keys(pendTxAt).forEach(function (id) { if (meta.pendingTx[id] === pendTxAt[id]) delete meta.pendingTx[id]; });
      Object.keys(pendTasksAt).forEach(function (id) { if (meta.pendingTasks[id] === pendTasksAt[id]) delete meta.pendingTasks[id]; });
      if (balDirtyAt && balanceSeq === balSeqAt) meta.balanceDirty = false;
      saveMeta();
      return { invalid: plan.invalid, requests: steps.length };
    });
  }

  function fullSync(forUid) {
    return Promise.all([
      q(client.from('balances').select('amount,updated_at').eq('user_id', forUid).maybeSingle()),
      fetchAll('transactions', 'id,type,amount,ts,source,category', forUid),
      fetchAll('tasks', 'id,text,done,ts', forUid)
    ]).then(function (r) {
      if (uid !== forUid) throw ABORT;
      var bal = r[0];
      var remoteTs = bal && bal.updated_at ? Date.parse(bal.updated_at) : 0;
      var remote = {
        balance: bal ? bal.amount : null,
        balanceTs: isFinite(remoteTs) ? remoteTs : 0,
        tx: r[1],
        tasks: r[2]
      };
      // อ่านข้อมูลในเครื่อง "หลัง" ได้ผลจากเน็ต แล้ว merge+เขียนแบบ synchronous → ไม่ทับการแก้ที่เกิดระหว่างรอ
      var m = merge(readLocal(), remote, {
        tx: meta.tx, tasks: meta.tasks, pendingTx: meta.pendingTx, pendingTasks: meta.pendingTasks
      });
      applyMerged(m);
      // snapshot = id ที่อยู่บนคลาวด์จริงตอนนี้ (id ที่ลบในเครื่องยังอยู่ในนี้ → push จะลบให้)
      meta.tx = m.remoteIds.tx;
      meta.tasks = m.remoteIds.tasks;
      meta.balanceDirty = m.push.balance;
      if (m.push.balance) balanceSeq = ++seq;
      saveMeta();
      return push(forUid).then(function (res) {
        res.invalid += m.invalid.remote;
        res.merged = m;
        return res;
      });
    });
  }

  /* ================= scheduler ================= */

  function schedulePush() {
    if (!uid) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { request('push'); }, DEBOUNCE_MS);
  }

  function request(kind) {
    if (!uid || !client) return;
    if (busy) {
      if (queued !== 'full') queued = kind;
      return;
    }
    run(kind);
  }

  function run(kind) {
    busy = true;
    clearTimeout(retryTimer);
    retryTimer = 0;
    var forUid = uid;
    setStatus('syncing');
    var failed = false;
    var p;
    try {
      p = kind === 'full' ? fullSync(forUid) : push(forUid);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(function (res) {
      if (uid !== forUid) return;
      attempts = 0;
      lastInvalid = (res && res.invalid) || 0;
      setStatus('synced');
    }, function (err) {
      if (err === ABORT || uid !== forUid) return;
      failed = true;
      attempts++;
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      scheduleRetry();
    }).then(function () {
      busy = false;
      var next = queued;
      queued = null;
      // ล้มเหลว → ปล่อยให้ retry (full sync) จัดการ ไม่ยิงคิวซ้ำทันที
      if (next && uid && !failed) run(next);
      else flushIdle();
    });
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = 0;
    if (!uid) return;
    if (navigator.onLine === false) return; // รอ event 'online'
    var delay = Math.min(BACKOFF_MAX, BACKOFF_BASE * Math.pow(2, Math.max(0, attempts - 1)));
    retryTimer = setTimeout(function () { retryTimer = 0; request('full'); }, delay);
  }

  function flushIdle() {
    if (busy) return;
    var w = idleWaiters;
    idleWaiters = [];
    w.forEach(function (fn) { fn(status); });
  }

  function whenIdle() {
    return new Promise(function (resolve) {
      if (!busy) resolve(status);
      else idleWaiters.push(resolve);
    });
  }

  function stopSync() {
    clearTimeout(debounceTimer);
    clearTimeout(retryTimer);
    debounceTimer = 0;
    retryTimer = 0;
    attempts = 0;
    queued = null;
  }

  /* ================= DOM ================= */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function icon(paths, size) {
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
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  var ICON_CLOUD = ['M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.5 4.5 0 0 0 7 18.5z'];
  var ICON_SYNC = ['M19.5 12a7.5 7.5 0 0 0-13.4-4.6', 'M5.5 3.5v4h4', 'M4.5 12a7.5 7.5 0 0 0 13.4 4.6', 'M18.5 20.5v-4h-4'];
  var ICON_CLOSE = ['M6 6l12 12', 'M18 6L6 18'];

  var STATUS_TEXT = { synced: T.synced, syncing: T.syncing, offline: T.offline, error: T.failed };

  function setStatus(s) {
    status = s;
    if (!ui.status) return;
    ui.status.textContent = STATUS_TEXT[s] || '';
    ui.chip.setAttribute('data-state', s);
    var hint = s === 'error' || s === 'offline' ? T.failedHint : '';
    if (s === 'synced' && lastInvalid > 0) hint = 'ข้ามรายการที่ข้อมูลไม่ถูกต้อง ' + lastInvalid + ' รายการ';
    if (hint) ui.chip.title = hint;
    else ui.chip.removeAttribute('title');
  }

  function renderAuth() {
    var box = ui.box;
    if (!box) return;
    var hadFocus = box.contains(document.activeElement);
    box.textContent = '';
    ui.status = null;
    ui.chip = null;
    ui.signInBtn = null;
    ui.signOutBtn = null;

    if (!enabled) {
      var note = el('p', 'cloud-auth__note', T.unavailable);
      note.setAttribute('role', 'status');
      note.title = T.unavailableHint;
      box.appendChild(note);
      return;
    }

    if (!initialDone && !uid) {
      var wait = el('p', 'cloud-auth__note', T.checking);
      wait.setAttribute('role', 'status');
      box.appendChild(wait);
      return;
    }

    if (!uid) {
      var btn = el('button', 'btn cloud-auth__signin');
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.appendChild(icon(ICON_CLOUD, 20));
      btn.appendChild(el('span', '', T.signIn));
      btn.addEventListener('click', function () { openDialog(btn); });
      box.appendChild(btn);
      ui.signInBtn = btn;
      if (hadFocus) btn.focus();
      return;
    }

    var masked = maskEmail(email);
    var chip = el('div', 'cloud-chip');
    var dot = el('span', 'cloud-chip__dot');
    dot.setAttribute('aria-hidden', 'true');
    var text = el('span', 'cloud-chip__text');
    var st = el('span', 'cloud-chip__status');
    st.setAttribute('role', 'status');
    st.setAttribute('aria-live', 'polite');
    var mail = el('span', 'cloud-chip__email', masked);
    mail.title = masked;
    mail.setAttribute('aria-label', 'บัญชี ' + masked);
    text.appendChild(st);
    text.appendChild(mail);
    chip.appendChild(dot);
    chip.appendChild(text);

    var syncBtn = el('button', 'icon-btn cloud-auth__sync');
    syncBtn.type = 'button';
    syncBtn.setAttribute('aria-label', T.syncNow);
    syncBtn.title = T.syncNow;
    syncBtn.appendChild(icon(ICON_SYNC, 20));
    syncBtn.addEventListener('click', function () { syncNow(); });

    var out = el('button', 'btn cloud-auth__signout', T.signOut);
    out.type = 'button';
    out.addEventListener('click', function () { signOut(); });

    box.appendChild(chip);
    box.appendChild(syncBtn);
    box.appendChild(out);
    ui.status = st;
    ui.chip = chip;
    ui.signOutBtn = out;
    setStatus(status);
    if (hadFocus) out.focus();
  }

  /* ---------- dialog ---------- */

  function buildDialog() {
    var dlg = el('dialog', 'cloud-dialog');
    dlg.id = 'cloud-dialog';
    dlg.setAttribute('aria-labelledby', 'cloud-dialog-title');
    dlg.setAttribute('aria-describedby', 'cloud-dialog-help');

    var head = el('div', 'cloud-dialog__head');
    var title = el('h2', 'cloud-dialog__title', T.dlgTitle);
    title.id = 'cloud-dialog-title';
    var closeBtn = el('button', 'icon-btn cloud-dialog__close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', T.close);
    closeBtn.appendChild(icon(ICON_CLOSE, 20));
    head.appendChild(title);
    head.appendChild(closeBtn);

    var help = el('p', 'cloud-dialog__help', T.dlgHelp);
    help.id = 'cloud-dialog-help';

    var form = el('form', 'cloud-dialog__form');
    form.noValidate = true;
    var field = el('div', 'field');
    var label = el('label', 'field__label', T.emailLabel);
    label.htmlFor = 'cloud-email';
    var input = el('input', 'input');
    input.id = 'cloud-email';
    input.type = 'email';
    input.name = 'email';
    input.autocomplete = 'email';
    input.setAttribute('inputmode', 'email');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.maxLength = 254;
    input.setAttribute('aria-describedby', 'cloud-email-error');
    var error = el('p', 'field__error');
    error.id = 'cloud-email-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(error);

    var success = el('p', 'cloud-dialog__success');
    success.setAttribute('role', 'status');
    success.setAttribute('aria-live', 'polite');

    var send = el('button', 'btn btn--primary cloud-dialog__send', T.send);
    send.type = 'submit';

    form.appendChild(field);
    form.appendChild(success);
    form.appendChild(send);

    dlg.appendChild(head);
    dlg.appendChild(help);
    dlg.appendChild(form);
    document.body.appendChild(dlg);

    ui.dlg = dlg;
    ui.input = input;
    ui.error = error;
    ui.success = success;
    ui.send = send;

    closeBtn.addEventListener('click', closeDialog);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendLink();
    });
    input.addEventListener('input', function () { if (!ui.error.hidden) showDialogError(''); });
    dlg.addEventListener('close', restoreFocus);
  }

  var lastTrigger = null;
  var sending = false;

  function showDialogError(msg) {
    ui.error.textContent = msg || '';
    ui.error.hidden = !msg;
    if (msg) ui.input.setAttribute('aria-invalid', 'true');
    else ui.input.removeAttribute('aria-invalid');
  }

  function openDialog(trigger, errorMsg) {
    if (!ui.dlg) return;
    lastTrigger = trigger || document.activeElement;
    showDialogError(errorMsg || '');
    ui.success.textContent = '';
    if (!ui.dlg.open) {
      if (typeof ui.dlg.showModal === 'function') ui.dlg.showModal();
      else ui.dlg.setAttribute('open', '');
    }
    ui.input.focus();
  }

  function closeDialog() {
    if (!ui.dlg || !ui.dlg.open) return;
    if (typeof ui.dlg.close === 'function') ui.dlg.close();
    else { ui.dlg.removeAttribute('open'); restoreFocus(); }
  }

  function restoreFocus() {
    var t = lastTrigger;
    lastTrigger = null;
    if (t && t !== document.body && t.isConnected && typeof t.focus === 'function') { t.focus(); return; }
    var first = ui.box && ui.box.querySelector('button');
    if (first) first.focus();
  }

  function sendLink() {
    if (sending) return;
    var value = ui.input.value.trim();
    var err = validateEmail(value);
    if (err) { showDialogError(err); ui.input.focus(); return; }
    err = protocolError(location.protocol);
    if (err) { showDialogError(err); return; }
    if (!client) { showDialogError(T.errUnavailable); return; }

    sending = true;
    showDialogError('');
    ui.success.textContent = '';
    ui.send.disabled = true;
    ui.send.textContent = T.sending;

    var p;
    try {
      p = client.auth.signInWithOtp({
        email: value,
        options: { emailRedirectTo: location.origin + location.pathname }
      });
    } catch (e) {
      p = Promise.reject(e);
    }
    Promise.resolve(p).then(function (res) {
      if (res && res.error) showDialogError(mapAuthError(res.error));
      else ui.success.textContent = 'ส่งลิงก์ไปที่ ' + value + ' แล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเข้าสู่ระบบ';
    }, function (e) {
      showDialogError(mapAuthError(e));
    }).then(function () {
      sending = false;
      ui.send.disabled = false;
      ui.send.textContent = T.send;
      // ปุ่มที่ถูก disable ทำให้ focus หลุด — คืน focus ให้ปุ่มส่งถ้ายังเปิด dialog อยู่
      if (ui.dlg.open && (!document.activeElement || document.activeElement === document.body)) ui.send.focus();
    });
  }

  /* ================= auth ================= */

  function readUrlAuthError() {
    try {
      var raw = (location.hash || '').replace(/^#/, '') + '&' + (location.search || '').replace(/^\?/, '');
      if (!/(^|&)(error|error_code|error_description)=/.test(raw)) return '';
      return /error_code=otp_expired/.test(raw) ? T.errLinkExpired : T.errLinkFailed;
    } catch (e) {
      return '';
    }
  }

  /* ลบ token/error ออกจากแถบที่อยู่ (supabase-js เคลียร์ hash ให้ แต่ทิ้ง # ค้างไว้) */
  function cleanUrl() {
    try {
      var hash = location.hash || '';
      var search = location.search || '';
      var badHash = hash === '#' || /(access_token|refresh_token|provider_token|error_description|error_code|error=)/.test(hash);
      var badSearch = /[?&](code|error|error_code|error_description)=/.test(search);
      if (!badHash && !badSearch) return;
      history.replaceState(history.state, '', location.pathname + (badSearch ? '' : search) + (badHash ? '' : hash));
    } catch (e) {}
  }

  function goSignedOut() {
    stopSync();
    uid = null;
    email = '';
    status = 'synced';
    renderAuth();
    flushIdle();
  }

  function handleAuth(event, sess) {
    if (event === 'INITIAL_SESSION') {
      initialDone = true;
      cleanUrl();
      if (urlAuthError && !(sess && sess.user)) openDialog(null, urlAuthError);
      urlAuthError = '';
    }
    var newUid = sess && sess.user && sess.user.id ? String(sess.user.id) : null;

    if (event === 'SIGNED_IN') manualSignOut = false;
    // ออกจากระบบแบบออฟไลน์แล้ว supabase-js ยังถือ session ในหน่วยความจำ → ไม่รับ session นั้นกลับมา
    if (manualSignOut && event !== 'SIGNED_IN') newUid = null;

    if (!newUid) {
      if (uid || event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') goSignedOut();
      return;
    }
    email = (sess.user && typeof sess.user.email === 'string') ? sess.user.email : '';
    if (newUid === uid) {
      // TOKEN_REFRESHED / SIGNED_IN ซ้ำ (เช่น สลับแท็บ) — ไม่ต้องเริ่มใหม่
      if (event === 'USER_UPDATED') renderAuth();
      return;
    }
    stopSync();
    uid = newUid;
    adoptUser(uid);
    closeDialog();
    status = 'syncing';
    renderAuth();
    request('full');
  }

  function signOut() {
    if (!client || !uid) return Promise.resolve();
    manualSignOut = true;
    goSignedOut(); // หยุดซิงก์ทันที เก็บแคชไว้ (ผู้ใช้เดิมกลับมาใช้ต่อได้)
    function dropLocal() {
      try { window.localStorage.removeItem(AUTH_KEY); } catch (e) {}
      try { if (client.auth.stopAutoRefresh) client.auth.stopAutoRefresh(); } catch (e) {}
    }
    var p;
    try { p = client.auth.signOut({ scope: 'local' }); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (res) { if (res && res.error) dropLocal(); }, dropLocal);
  }

  function syncNow() {
    if (!uid || !client) return Promise.resolve(status);
    clearTimeout(debounceTimer);
    request('full');
    return whenIdle();
  }

  /* ================= init ================= */

  function configOk(c) {
    return !!(c && typeof c.SUPABASE_URL === 'string' && /^https:\/\/[^\s/]+/.test(c.SUPABASE_URL) &&
      typeof c.SUPABASE_KEY === 'string' && c.SUPABASE_KEY.length > 10);
  }

  function init() {
    if (started) return;
    started = true;

    ui.box = document.getElementById('cloud-auth');
    var cfg = window.FM_CONFIG;
    var lib = window.supabase;
    urlAuthError = readUrlAuthError();

    if (configOk(cfg)) {
      meta = loadMeta();
      snapshotSeen('tx');
      snapshotSeen('tasks');
      // ติดตามการแก้ในเครื่องแม้ยังไม่ล็อกอิน เพื่อดันขึ้นเมื่อผู้ใช้เดิมกลับมาเข้าสู่ระบบ
      FM.on('balance:changed', onLocalBalance);
      FM.on('tx:changed', onLocalTx);
      FM.on('tasks:changed', onLocalTasks);
      tracking = true;
    }

    if (tracking && lib && typeof lib.createClient === 'function') {
      try {
        client = lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'implicit', // ลิงก์ใช้ได้แม้เปิดในเบราว์เซอร์อื่นบนเครื่อง ไม่ต้องมี code verifier
            storageKey: AUTH_KEY
          }
        });
        enabled = !!(client && client.auth && typeof client.from === 'function');
      } catch (e) {
        client = null;
        enabled = false;
      }
    }

    if (ui.box) {
      if (enabled) buildDialog();
      renderAuth();
    }

    if (!enabled) {
      client = null;
      cleanUrl(); // ไม่มีไลบรารี: อย่างน้อยอย่าทิ้ง token ไว้ในแถบที่อยู่
      return;
    }

    try {
      client.auth.onAuthStateChange(function (event, sess) {
        // ห้ามเรียก supabase แบบรอผลภายใน callback นี้ (supabase-js อาจค้าง) — เลื่อนไปทำนอก callback
        setTimeout(function () { handleAuth(event, sess); }, 0);
      });
    } catch (e) {
      enabled = false;
      client = null;
      renderAuth();
      return;
    }

    window.addEventListener('online', function () { if (uid) request('full'); });
    window.addEventListener('offline', function () { if (uid && !busy) setStatus('offline'); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && uid) request('full');
    });
  }

  window.FM = window.FM || {};
  FM.cloud = {
    init: init,
    signOut: signOut,
    syncNow: syncNow,
    _merge: merge,
    // ตัวช่วยแบบ pure สำหรับทดสอบใน console เท่านั้น
    _validateEmail: validateEmail,
    _protocolError: protocolError,
    _mapAuthError: mapAuthError,
    _maskEmail: maskEmail
  };
})();
