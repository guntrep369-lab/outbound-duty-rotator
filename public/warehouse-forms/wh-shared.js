/**
 * @file wh-shared.js — ชิ้นส่วนเล็ก ๆ ที่ทั้งสามฟอร์มใช้เหมือนกัน
 *
 * แผนกและคลังมาจากไฟล์ Excel ต้นฉบับ ซึ่งกระจายอยู่ในก๊อปห้าใบของใบโอน ใบละค่า
 * (INBOUND / OUTBOUND / INVENTORY / QA → NEW WH-2 …) พอรวมเหลือฟอร์มเดียวแล้ว
 * ค่าพวกนี้ต้องมาจากที่เดียว ไม่งั้นสามฟอร์มจะมีตัวเลือกไม่ตรงกัน
 *
 * โหลดเป็น classic script เปิดเป็น window.WhShared
 */
(function () {
  'use strict';

  var DEPTS = ['', 'INBOUND', 'OUTBOUND', 'INVENTORY', 'QA'];
  var WAREHOUSES = ['', 'QA', 'NEW WH-1', 'NEW WH-2', 'OLD WH', 'SAFFRON'];

  function options(list, sel) {
    return list.map(function (v) {
      return '<option' + (v === sel ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
  }

  window.WhShared = {
    DEPTS: DEPTS,
    WAREHOUSES: WAREHOUSES,

    fillDepts: function (doc) {
      var d = doc || document;
      Array.prototype.forEach.call(d.querySelectorAll('select.dept'), function (s) {
        s.innerHTML = options(DEPTS, s.dataset.value || '');
      });
      Array.prototype.forEach.call(d.querySelectorAll('select.wh'), function (s) {
        s.innerHTML = options(WAREHOUSES, s.dataset.value || '');
      });
    },

    /** สร้างแถวรายการตามจำนวนที่ฟอร์มต้นฉบับมี — ไม่มากไม่น้อยกว่าเดิม */
    buildRows: function (tbodyId, n, tpl) {
      var out = '';
      for (var i = 1; i <= n; i++) out += '<tr>' + tpl(i) + '</tr>';
      document.getElementById(tbodyId).innerHTML = out;
    },

    /** ตั้งวันที่เป็นวันนี้ — คนกรอกแทบไม่เคยลงวันอื่น */
    today: function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var d = new Date();
      el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                 '-' + String(d.getDate()).padStart(2, '0');
    },

    /**
     * ยังไม่ได้อัปรายชื่อสินค้า = ฟอร์มยังกรอกได้ แต่ชื่อสินค้าจะไม่ขึ้นให้
     * ต้องบอกตรงนี้ ไม่ใช่ปล่อยให้พิมพ์รหัสแล้วสงสัยว่าทำไมช่องชื่อว่าง
     */
    warnIfNoSku: function () {
      if (window.WhSku && WhSku.get()) return;
      var slot = document.getElementById('warnSlot');
      if (!slot) return;
      slot.innerHTML = '<div class="wh-warn">⚠️ ยังไม่มีรายชื่อสินค้าในเครื่องนี้ — ' +
        'กรอกฟอร์มได้ตามปกติ แต่ช่อง “ชื่อสินค้า” จะไม่ขึ้นให้อัตโนมัติ ' +
        '<a href="./">อัปไฟล์รายชื่อที่หน้ารายการเอกสาร</a>';
    },
  };
})();
