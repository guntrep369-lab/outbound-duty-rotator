/**
 * @file wms-search.js — กฎการค้นหาออเดอร์ ว่าอะไรควรขึ้นก่อนอะไร
 *
 * แยกออกมาจากหน้าค้นหาเพราะมันเป็นฟังก์ชันบริสุทธิ์ล้วน ๆ (รับแถวกับคำค้น
 * คืนคะแนน) แต่ตอนอยู่ใน <script> กลางหน้า HTML ไม่มีเทสต์ตัวไหนแตะถึงได้เลย —
 * จะทดสอบต้องยกทั้งหน้ามารันพร้อม DOM และโค้ดอีกสี่ร้อยบรรทัด
 *
 * ผลคือกฎพวกนี้เคยพังเงียบมาแล้ว: เงื่อนไข "ข้อความบางส่วน" ถูกวางไว้ก่อน
 * "เลขคันตรงตัว" ทำให้ค้น "คัน21" แล้วได้ "คัน210" ติดมาด้วย ซึ่งเป็นคนละคัน
 * คนละคนขับ — เทสต์ผ่าน build ผ่าน deploy ผ่าน กว่าจะรู้คือมีคนไปกดดูเจอเอง
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsSearch
 */
(function () {
  'use strict';

  /** ตัดช่องว่างและพิมพ์เล็กใหญ่ทิ้ง — คนพิมพ์ค้นไม่ได้ใส่ตรงเป๊ะเสมอ */
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ''); }

  /** เหลือแต่ตัวเลข ใช้เทียบเบอร์โทรที่เขียนคนละแบบกัน */
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  /**
   * ให้คะแนนความตรง เพื่อให้สิ่งที่คนพิมพ์มาน่าจะหมายถึงที่สุดอยู่บนสุด
   * เลขออเดอร์ตรงเป๊ะสำคัญกว่าชื่อที่บังเอิญมีคำนั้นอยู่กลางประโยค
   *
   * @param {object} row แถวจากดัชนีค้นหา
   * @param {string} q   คำค้นที่ผ่าน norm() แล้ว
   * @param {string} qd  คำค้นที่เหลือแต่ตัวเลข
   * @returns {number} 0 = ไม่ตรง ยิ่งมากยิ่งตรง
   */
  function score(row, q, qd) {
    var id = norm(row.orderID), cn = norm(row.consign);
    if (id && id === q) return 100;
    if (cn && cn === q) return 95;
    if (id && id.indexOf(q) >= 0) return 80;
    if (cn && cn.indexOf(q) >= 0) return 75;

    /* เทียบเบอร์เฉพาะตอนที่พิมพ์มาเป็นตัวเลขล้วน — ถ้าดึงเลขออกจาก "TP-1001"
       มาเทียบด้วย เบอร์ที่บังเอิญมี 1001 อยู่ข้างในจะโผล่ขึ้นมาเป็นคนละลูกค้า */
    if (qd.length >= 3 && qd.length === q.length) {
      var p1 = digits(row.phone1), p2 = digits(row.phone2);
      if (p1 === qd || p2 === qd) return 90;
      if ((p1 && p1.indexOf(qd) >= 0) || (p2 && p2.indexOf(qd) >= 0)) return 70;
    }

    var cu = norm(row.customer);
    if (cu && cu.indexOf(q) === 0) return 60;
    if (cu && cu.indexOf(q) >= 0) return 50;

    /* ชื่อรถ — ตอบคำถามกลับด้าน: ไม่ใช่ "ออเดอร์นี้ไปคันไหน" (ป้ายบนการ์ดบอกอยู่)
       แต่คือ "คัน21 มีงานอะไรบ้าง" ซึ่งเป็นคำถามที่เกิดตอนคนขับโทรเข้ามาถาม
       หรือตอนต้องตามงานทั้งคัน */
    var tr = norm(row.truck);
    if (tr) {
      /* ถามถึงเลขคัน ("คัน21" หรือ "21") → เทียบเลขตรงตัว ไม่ใช่ข้อความบางส่วน
         ลำดับสองเงื่อนไขนี้เป็นตัวชี้ขาด ถ้าเอา indexOf ขึ้นก่อนเมื่อไหร่
         "คัน2" จะลาก "คัน21" กับ "คัน210" กลับมาทันที */
      var qn = /^(?:คัน)?(\d+)$/.exec(q);
      if (qn) {
        var n = window.WmsTruck ? window.WmsTruck.numberOf(row.truck) : null;
        if (n != null && n === parseInt(qn[1], 10)) return 45;
      } else if (tr.indexOf(q) >= 0) {
        return 45;   // ถามด้วยชื่อคนขับ เช่น "บัณฑิต"
      }
    }

    if (norm(row.address).indexOf(q) >= 0) return 30;
    if (norm(row.brand).indexOf(q) >= 0) return 20;
    return 0;
  }

  window.WmsSearch = { norm: norm, digits: digits, score: score };
})();
