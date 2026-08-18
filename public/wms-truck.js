/**
 * @file wms-truck.js — งานของวันนี้ไปกับรถคันไหน และเป็นจุดที่เท่าไหร่
 *
 * ข้อมูลคันรถมาได้สองทาง: คอลัมน์ "ชื่อรถ" ในชีตออเดอร์ (ทางหลัก) กับไฟล์รถ
 * ที่ทีมขนส่งอัปให้ (ทางสำรอง สำหรับชีตรุ่นเก่าที่ยังไม่มีคอลัมน์นั้น)
 * ทั้งสองทางต้องนับจุดส่งด้วยกฎเดียวกัน ไม่งั้นคำตอบที่ให้ลูกค้าจะต่างกัน
 * ตามว่าวันนั้นบังเอิญมีไฟล์รถหรือเปล่า
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsTruck
 */
(function () {
  'use strict';

  /**
   * งานใหญ่ที่ต้องใช้รถหลายคัน ทีมกรอกจำนวนคันแทนชื่อคัน เช่น "5 คัน"
   *
   * พบจริงในชีต 46 แถวจาก 167 — เป็นงาน Event ที่ใช้รถ 5 คันส่งลูกค้ารายเดียว
   * ไม่ใช่เคสหลุด ค่าแบบนี้ไม่ระบุว่าเป็นรถคันไหน การขึ้น "จุดที่ 1/3" จึงเป็น
   * การอ้างลำดับบนเส้นทางที่ไม่มีอยู่จริง และถ้ามีงานใหญ่สองงานเขียน "5 คัน"
   * เหมือนกัน ทั้งสองจะถูกนับรวมเป็นเส้นทางเดียวทั้งที่คนละงาน — บอกแค่ชื่อพอ
   */
  function isCount(s) { return /^\d+\s*คัน$/.test(String(s == null ? '' : s).trim()); }

  /**
   * เลขคันจากชื่อรถ — "คัน21 .บัณฑิต" → 21
   *
   * ต้องเป็น "คัน" แล้วตามด้วยเลขเท่านั้น เพราะ "5 คัน" (เลขมาก่อน) แปลว่า
   * ใช้รถ 5 คัน ไม่ใช่คันที่ 5 — ในข้อมูลจริงเป็นแบบหลังถึง 28% ของแถว
   * ถ้าดึงมั่วงานก้อนใหญ่จะไปโผล่ผิดใบโดยไม่มีใครเห็น
   */
  function numberOf(name) {
    var m = /^\s*คัน\s*(\d+)/.exec(String(name == null ? '' : name));
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * ข้อความช่วงเลขคัน → รายการกลุ่ม เช่น "1-20, 21-60" หรือ "1-20 21-60"
   *
   * รับเลขเดี่ยวได้ด้วย ("5" = คัน 5 คันเดียว) และคัดช่วงที่กลับหัวหรือพิมพ์
   * ไม่ครบทิ้งเงียบ ๆ ไม่ใช่เดาว่าผู้ใช้หมายถึงอะไร
   *
   * @returns {Array<{from:number,to:number,label:string}>}
   */
  function parseRanges(text) {
    var out = [];
    String(text == null ? '' : text).split(/[,\n]/).forEach(function (part) {
      var s = part.trim();
      if (!s) return;
      var m = /^(\d+)\s*(?:-|–|ถึง)\s*(\d+)$/.exec(s);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a <= b) out.push({ from: a, to: b, label: 'คัน ' + a + '-' + b });
        return;
      }
      if (/^\d+$/.test(s)) {
        var n = parseInt(s, 10);
        out.push({ from: n, to: n, label: 'คัน ' + n });
      }
    });
    return out;
  }

  /** ช่วงแรกที่ครอบเลขนี้ — ไม่เข้าช่วงไหนคืน -1 */
  function rangeIndex(num, ranges) {
    if (num == null) return -1;
    for (var i = 0; i < (ranges || []).length; i++) {
      if (num >= ranges[i].from && num <= ranges[i].to) return i;
    }
    return -1;
  }

  /**
   * แผนที่ เลขออเดอร์ → { truck, time, seq, stops, numbered }
   *
   * ลำดับจุดส่งนับจาก "ลูกค้า" ที่พบ ไม่ใช่ลำดับแถว — หลายแถวของลูกค้าคนเดียว
   * คือจุดเดียว คนขับแวะครั้งเดียว ถ้านับตามแถวจะกลายเป็น "จุดที่ 7/9" สำหรับ
   * งานที่จริง ๆ แล้วแวะแค่ 3 ที่
   *
   * @param {Array} rows แถวที่เรียงตามลำดับในชีตแล้ว
   * @param {Function} read อ่าน { truck, order, customer, time } จากหนึ่งแถว
   */
  function stopMap(rows, read) {
    var byTruck = new Map();
    (rows || []).forEach(function (r) {
      var t = read(r).truck || 'ไม่ระบุ';
      if (!byTruck.has(t)) byTruck.set(t, []);
      byTruck.get(t).push(r);
    });

    var map = new Map();
    byTruck.forEach(function (rs, truck) {
      var stopOf = new Map(), n = 0;
      rs.forEach(function (r) {
        var c = read(r);
        var k = c.customer || c.order || '?';
        if (!stopOf.has(k)) stopOf.set(k, ++n);
      });
      rs.forEach(function (r) {
        var c = read(r);
        if (!c.order) return;
        map.set(c.order, {
          truck: truck,
          time: c.time,
          seq: stopOf.get(c.customer || c.order),
          stops: n,
          numbered: !isCount(truck),
        });
      });
    });
    return map;
  }

  window.WmsTruck = {
    isCount: isCount, stopMap: stopMap,
    numberOf: numberOf, parseRanges: parseRanges, rangeIndex: rangeIndex,
  };
})();
