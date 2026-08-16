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

  /* แผนก: อ่านได้จริงจากไฟล์ Excel ต้นฉบับทั้งสี่ค่า
     คลัง: ผู้ใช้ยืนยันมาว่ามีสามที่นี้ — ตอนแรกผมใส่ NEW WH-1 / OLD WH / SAFFRON
     เพิ่มเข้าไปเองโดยเดาว่าคลังคงมีมากกว่าที่เห็นในไฟล์ ซึ่งเป็นการเดาที่ทำให้
     คนกรอกเลือกปลายทางที่ไม่มีอยู่จริงได้โดยไม่มีอะไรเตือน */
  var DEPTS = ['', 'INBOUND', 'OUTBOUND', 'INVENTORY', 'QA'];
  var WAREHOUSES = ['', 'NEW WH-2', 'QA', 'RACK'];

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
     * วางโลโก้บริษัทมุมซ้ายบนของใบ
     *
     * ใช้รูปเดียวกับที่ตั้งไว้ในหน้าตั้งค่า (และที่ใบนำส่งสินค้าใช้อยู่) ไม่ได้เก็บ
     * รูปแยกของตัวเอง — เอกสารของบริษัทเดียวกันควรขึ้นโลโก้เดียวกันเสมอ
     *
     * ยังไม่ได้ตั้งโลโก้ก็ปล่อยว่าง ไม่ขึ้นกรอบรูปแตก และหุบช่องว่างฝั่งขวาด้วย
     * เพื่อให้ชื่อเอกสารกลับไปอยู่กึ่งกลางเหมือนตอนไม่มีโลโก้
     */
    mountLogo: function () {
      var head = document.querySelector('.wh-head');
      if (!head) return;
      var src = window.WmsSettings ? WmsSettings.logo() : '';
      if (!src) { head.classList.add('no-logo'); return; }
      var img = head.querySelector('.wh-logo');
      if (img) { img.src = src; img.alt = 'โลโก้บริษัท'; }
    },

    /**
     * ยังไม่ได้อัปรายชื่อสินค้า = ฟอร์มยังกรอกได้ แต่ชื่อสินค้าจะไม่ขึ้นให้
     * ต้องบอกตรงนี้ ไม่ใช่ปล่อยให้พิมพ์รหัสแล้วสงสัยว่าทำไมช่องชื่อว่าง
     */
    warnIfNoSku: function () {
      // นับทั้งสองแหล่ง — ชื่อสินค้ามาจากการดึงสต๊อกได้แล้ว การเตือนให้ไปอัปไฟล์
      // ทั้งที่ฟอร์มเติมชื่อได้อยู่แล้ว คือส่งคนไปทำงานที่ไม่ต้องทำ
      var src = window.WhSku && window.WhSku.sources();
      if (src && (src.stock || src.file)) return;
      var slot = document.getElementById('warnSlot');
      if (!slot) return;
      // ต่อท้าย ไม่ใช่เขียนทับ — ช่องนี้อาจมีข้อความจากที่อื่นอยู่แล้ว เช่นแถบ
      // "กรอกมาจากแท็บเช็คสต๊อกให้แล้ว" ซึ่งมีลิงก์สร้างใบถัดไปอยู่ในนั้น
      slot.insertAdjacentHTML('beforeend', '<div class="wh-warn">⚠️ ยังไม่มีรายชื่อสินค้าในเครื่องนี้ — ' +
        'กรอกฟอร์มได้ตามปกติ แต่ช่อง “ชื่อสินค้า” จะไม่ขึ้นให้อัตโนมัติ ' +
        '<a href="./">อัปไฟล์รายชื่อที่หน้ารายการเอกสาร</a>');
    },
  };
})();
