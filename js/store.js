/* store.js — localStorage ปลอดภัย (prefix fm.) + pub/sub กลาง window.FM */
(function () {
  'use strict';

  var PREFIX = 'fm.';
  var memory = {};
  var listeners = {};
  var storageOk = (function () {
    try {
      var k = PREFIX + '__test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function get(key, fallback) {
    var raw = null;
    if (storageOk) {
      try {
        raw = window.localStorage.getItem(PREFIX + key);
      } catch (e) {
        raw = null;
      }
    }
    if (raw === null && Object.prototype.hasOwnProperty.call(memory, key)) raw = memory[key];
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    var raw;
    try {
      raw = JSON.stringify(value);
    } catch (e) {
      return false;
    }
    memory[key] = raw;
    if (!storageOk) return false;
    try {
      window.localStorage.setItem(PREFIX + key, raw);
      return true;
    } catch (e) {
      return false;
    }
  }

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return function off() {
      var arr = listeners[evt] || [];
      var i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }

  function emit(evt, payload) {
    var arr = (listeners[evt] || []).slice();
    for (var i = 0; i < arr.length; i++) {
      try {
        arr[i](payload);
      } catch (e) {
        if (window.console) console.error(e);
      }
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var moneyFmt = null;
  try {
    moneyFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    moneyFmt = null;
  }

  function fmtMoney(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    var sign = v < 0 ? '-' : '';
    var abs = Math.abs(v);
    var s = moneyFmt ? moneyFmt.format(abs) : abs.toFixed(2);
    return sign + '฿' + s;
  }

  window.FM = {
    get: get,
    set: set,
    on: on,
    emit: emit,
    uid: uid,
    fmtMoney: fmtMoney,
    storageOk: storageOk
  };
})();
