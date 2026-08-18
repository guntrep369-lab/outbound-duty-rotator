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

  window.WmsTruck = { isCount: isCount, stopMap: stopMap };
})();
