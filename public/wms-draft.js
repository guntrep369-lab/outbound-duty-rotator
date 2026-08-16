/**
 * @file wms-draft.js — ส่งรายการที่กรอกไว้แล้วข้ามโมดูล
 *
 * แท็บเช็คสต๊อกรู้อยู่แล้วว่า SKU ไหนต้องเบิก QA และต้องใช้กี่ชิ้น ส่วนใบเบิกใน
 * เอกสารคลังสินค้าก็กรอกในเว็บได้แล้ว แต่สองอย่างนี้ไม่ต่อกัน คนจึงต้องอ่าน
 * หน้าจอหนึ่งแล้วพิมพ์ลงอีกหน้าจอหนึ่งด้วยมือ — รูปแบบเดียวกับที่ป้ายชี้บ่งสถานะ
 * เคยเป็นก่อนจะให้มันดึงจากไฟล์ออเดอร์เอง
 *
 * WHY sessionStorage: เป็นของที่ส่งต่อทันทีระหว่างสองหน้า ไม่ใช่การตั้งค่า
 * ปิดเบราว์เซอร์แล้วต้องหายไป ไม่งั้นพรุ่งนี้เปิดใบเบิกมาแล้วเจอของเมื่อวานค้างอยู่
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsDraft
 */
(function () {
  'use strict';

  var KEY = 'wms:draft';

  function readAll() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  window.WmsDraft = {
    KEY: KEY,

    /**
     * ฝากรายการไว้ให้อีกหน้าหยิบไปกรอก
     * @param {string} kind ชนิดเอกสาร เช่น 'requisition'
     * @param {Array} items แถวที่จะกรอก
     * @param {object} [meta] ค่าหัวเอกสาร เช่น คลังต้นทาง/ปลายทาง
     * @returns {boolean} ฝากสำเร็จไหม — ถ้าไม่ ผู้เรียกต้องบอกผู้ใช้ ไม่ใช่พาไปหน้าเปล่า
     */
    put: function (kind, items, meta) {
      try {
        var all = readAll();
        all[kind] = { at: Date.now(), items: items || [], meta: meta || {} };
        sessionStorage.setItem(KEY, JSON.stringify(all));
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * หยิบไปใช้แล้วลบทิ้ง — ครั้งเดียวจบ
     *
     * ลบทันทีที่อ่าน เพราะปุ่ม "ล้างฟอร์ม" ของหน้าฟอร์มคือการโหลดหน้าใหม่
     * ถ้าไม่ลบ กดล้างแล้วของเดิมจะกลับมาทุกครั้ง ซึ่งตรงข้ามกับที่ปุ่มบอกไว้
     */
    take: function (kind) {
      var all = readAll();
      var d = all[kind] || null;
      if (d) {
        try {
          delete all[kind];
          sessionStorage.setItem(KEY, JSON.stringify(all));
        } catch (e) {}
      }
      return d;
    },

    /** ดูว่ามีของฝากไว้ไหม โดยไม่หยิบออก */
    peek: function (kind) {
      return readAll()[kind] || null;
    },
  };
})();
