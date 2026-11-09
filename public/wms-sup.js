/**
 * @file wms-sup.js — PO ไหนมาจาก Supplier ไหน (แท็บ PO. Truck ในไฟล์ Transaction)
 *
 * บาง SKU ผลิตจากคนละบริษัท คุณภาพไม่เท่ากัน ห้ามเปิดขายคนละ Supplier พร้อมกัน
 * สคริปต์ tx-api.gs ส่งแท็บนี้มาเป็น sup = { tab, rows: [[PO, Supplier]], dup, missing } กับทุกคำตอบที่มี PO
 * (tx-summary, tx-daily, tx-fifo) หน้าเว็บใช้ไฟล์นี้แปลง PO เป็นชื่อ Supplier ที่เดียว
 *
 * PO ในสมุดมีเลขรอบรับต่อท้าย (-01, -26) แต่ในแท็บลงแค่เลขหลัก จึงเทียบด้วยเลขหลัก
 */
(function () {
  'use strict';

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /** เลขหลักของ PO: 2603000076-26 → 2603000076 PO รูปแบบอื่นคืนตามเดิม */
  function base(po) {
    var s = up(po);
    var m = /^(\d{6,})-\d{1,3}$/.exec(s);
    return m ? m[1] : s;
  }

  /** sup จากสคริปต์ → { เลขหลัก PO: ชื่อ Supplier } ไม่มีแท็บคืน {} */
  function map(sup) {
    var m = {};
    ((sup && sup.rows) || []).forEach(function (r) {
      var k = base(r[0]);
      if (k && m[k] === undefined) m[k] = String(r[1] == null ? '' : r[1]).trim();
    });
    return m;
  }

  /** ชื่อ Supplier ของ PO ไม่มีในแท็บคืน '' */
  function of(m, po) {
    var k = base(po);
    return (k && m && m[k]) || '';
  }

  /**
   * บอกสถานะแท็บให้หน้าเว็บขึ้นเตือน '' = ใช้ได้
   * sup เป็น undefined คือสคริปต์รุ่นเก่ายังไม่ส่ง, null คือยังไม่มีแท็บ
   */
  function note(sup) {
    if (sup === undefined) return 'สคริปต์ tx-api.gs รุ่นนี้ยังไม่ส่งชื่อ Supplier (แท็บ PO. Truck) ให้วางโค้ดใหม่แล้ว Deploy เป็น New version';
    if (!sup) return 'ยังไม่มีแท็บ PO. Truck (หัวตาราง Truck, PO.) ในไฟล์ชีต Transaction จึงยังไม่รู้ชื่อ Supplier';
    if (sup.missing) return 'แท็บ ' + sup.tab + ': ' + sup.missing;
    return '';
  }

  /** Supplier ที่มีของ (ยอดมากกว่า 0) จาก { ชื่อ: ชิ้น } ไม่นับที่ไม่รู้ชื่อ เรียงตามชื่อ */
  function names(byName) {
    return Object.keys(byName || {}).filter(function (k) { return k && byName[k] > 0; }).sort();
  }

  window.WmsSup = { base: base, map: map, of: of, note: note, names: names };
})();
