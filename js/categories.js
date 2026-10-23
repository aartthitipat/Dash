/* categories.js — หมวดหมู่รายรับ/รายจ่าย (ข้อมูลล้วน ไม่มี UI) ต้องโหลดต่อจาก store.js
 * tx.category เก็บเป็น key (เช่น 'food'); tx เก่าที่ไม่มี category แสดงเป็น "ไม่ระบุ" */
(function () {
  'use strict';

  var LISTS = {
    expense: [
      { key: 'food', label: 'อาหาร' },
      { key: 'transport', label: 'เดินทาง' },
      { key: 'bills', label: 'บิลและที่พัก' },
      { key: 'shopping', label: 'ช้อปปิ้ง' },
      { key: 'health', label: 'สุขภาพ' },
      { key: 'fun', label: 'บันเทิง' },
      { key: 'other', label: 'อื่นๆ' }
    ],
    income: [
      { key: 'salary', label: 'เงินเดือน' },
      { key: 'side', label: 'รายได้เสริม' },
      { key: 'other', label: 'อื่นๆ' }
    ]
  };

  var NONE_LABEL = 'ไม่ระบุ';

  function list(type) {
    return (LISTS[type] || []).slice();
  }

  function find(type, key) {
    var arr = LISTS[type] || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].key === key) return arr[i];
    return null;
  }

  function isValid(type, key) {
    return !!find(type, key);
  }

  /* ชื่อที่แสดง: ไม่มี/ไม่รู้จัก → "ไม่ระบุ" */
  function label(type, key) {
    var c = find(type, key);
    return c ? c.label : NONE_LABEL;
  }

  /* ค่าที่ปลอดภัยสำหรับบันทึก: key ที่ถูกต้อง หรือ null */
  function normalize(type, key) {
    return isValid(type, key) ? key : null;
  }

  window.FM = window.FM || {};
  FM.cats = { list: list, isValid: isValid, label: label, normalize: normalize, NONE_LABEL: NONE_LABEL };
})();
