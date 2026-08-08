/**
 * @file wms-order-index.js — ออเดอร์ของวันนี้ เก็บไว้ให้หน้าอื่นค้นได้ทันที
 *
 * แท็บเทียบ Order ดึงข้อมูลจาก Apps Script อยู่แล้ว และการดึงแต่ละครั้งใช้เวลา
 * หลายวินาที ถ้าหน้าค้นหาต้องดึงเองทุกครั้งที่มีคนโทรมาถาม คนรับสายจะรอสายเปล่า
 * ทุกครั้ง ทั้งที่ข้อมูลชุดเดียวกันเพิ่งถูกดึงไปแล้วเมื่อเช้า
 *
 * WHY sessionStorage: ออเดอร์เป็นของวันเดียว ปิดเบราว์เซอร์แล้วต้องหายไป —
 * ความเสียหายที่แท้จริงคือการตอบลูกค้าด้วยรอบเมื่อวานโดยไม่รู้ตัว ไม่ใช่การ
 * ต้องกดดึงใหม่
 *
 * โหลดเป็น classic script (หน้าที่ใช้ไม่ได้เป็น module) เปิดเป็น window.OrderIndex
 */
(function () {
  'use strict';

  var KEY = 'wms:orders:today';

  /**
   * ฟิลด์ที่เก็บ — เท่าที่หน้าค้นหาต้องใช้ตอบคำถามทางโทรศัพท์
   * ไม่เก็บทั้งแถวดิบ เพราะ sessionStorage มีเพดาน และของที่ไม่ได้ใช้
   * ก็คือของที่ไม่มีใครสังเกตว่ามันผิด
   */
  var FIELDS = ['orderID', 'consign', 'sup', 'customer', 'address', 'phone1', 'phone2',
                'brand', 'size', 'qty1', 'giftRaw', 'qtyRaw', 'payment', 'remark', 'date'];

  function pick(row) {
    var o = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var v = row[FIELDS[i]];
      if (v !== '' && v != null) o[FIELDS[i]] = v;
    }
    return o;
  }

  /**
   * แปลง carriersData ของแท็บเทียบ Order เป็นดัชนีค้นหา
   *
   * เก็บทั้งรอบเช้า (Logis) และ CRM แต่ติดป้ายบอกที่มา — ออเดอร์ที่มีแต่ใน CRM
   * คือออเดอร์ที่เพิ่งเพิ่มเข้ามาหลังจัดรอบไปแล้ว ซึ่งเป็นคำตอบที่ต่างกันมาก
   * เวลาลูกค้าถามว่า "ของออกหรือยัง"
   *
   * @param {Array} carriersData [{ key, data1, data2 }]
   */
  function build(carriersData) {
    var rows = [];
    (carriersData || []).forEach(function (car) {
      var seen = Object.create(null);
      (car.data1 || []).forEach(function (r) {
        var o = pick(r); o.carrier = car.key; o.source = 'logis';
        if (r.orderID) seen[r.orderID] = true;
        rows.push(o);
      });
      // จาก CRM เอาเฉพาะออเดอร์ที่รอบเช้าไม่มี ไม่งั้นทุกออเดอร์จะขึ้นซ้ำสองครั้ง
      (car.data2 || []).forEach(function (r) {
        if (r.orderID && seen[r.orderID]) return;
        var o = pick(r); o.carrier = car.key; o.source = 'crm';
        rows.push(o);
      });
    });
    return rows;
  }

  window.OrderIndex = {
    KEY: KEY,
    build: build,

    /** @returns {{at:number, rows:Array}|null} */
    get: function () {
      try {
        var raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        var o = JSON.parse(raw);
        return o && Array.isArray(o.rows) && o.rows.length ? o : null;
      } catch (e) {
        return null;
      }
    },

    /** เก็บดัชนีไว้ให้หน้าค้นหา เรียกหลังดึงข้อมูลสำเร็จ */
    save: function (carriersData) {
      try {
        var rows = build(carriersData);
        if (!rows.length) return;
        sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows: rows }));
      } catch (e) {
        // เต็มโควตาหรืออยู่ในโหมดส่วนตัว — แท็บเทียบ Order ยังทำงานได้ตามปกติ
        // หน้าค้นหาจะขอให้กดดึงเอง ไม่คุ้มที่จะขัดจังหวะใคร
        console.warn('OrderIndex: เก็บดัชนีค้นหาไม่ได้ —', e.message);
      }
    },

    clear: function () {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
    },
  };
})();
