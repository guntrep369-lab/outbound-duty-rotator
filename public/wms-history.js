/**
 * @file wms-history.js — ความจำข้ามวันของระบบ
 *
 * ทุกเช้าระบบคำนวณตัวเลขที่มีค่าแล้วทิ้งไปพร้อมกับการปิดแท็บ — จำนวนออเดอร์
 * ชิ้นที่ต้องหยิบ งานที่แทรกเข้ามาหลังจัดรอบเช้า จำนวนคันที่ใช้ ของที่ไม่พบใน
 * สต๊อก ตัวเลขพวกนี้ตอบคำถามที่ระบบตอบไม่ได้เลยตอนนี้: วันนี้หนักกว่าปกติไหม
 * งานแทรกเยอะขึ้นหรือเปล่า ช่วงนี้ต้องเรียกรถเสริมบ่อยขึ้นไหม
 *
 * เก็บแค่ตัวเลข ไม่เก็บชื่อลูกค้า ที่อยู่ เบอร์ หรือรหัสสินค้า — ประวัติที่ยาว
 * หลายเดือนไม่ควรกลายเป็นกองข้อมูลลูกค้าที่ไม่มีใครรู้ว่ามีอยู่
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsHistory
 */
(function () {
  'use strict';

  var KEY = 'wms:history';
  var MAX_DAYS = 90;      // ราวหนึ่งไตรมาส พอเห็นแนวโน้มโดยไม่บวมไปเรื่อย ๆ
  var MIN_BASE = 5;       // น้อยกว่านี้ยังไม่เรียกว่าค่าปกติ พูดไปก็เป็นการเดา

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function write(all) {
    /* ตัดวันเก่าทิ้งตอนเขียน ไม่ใช่ตอนอ่าน — localStorage มีเพดาน และการโตไป
       เรื่อย ๆ จนเขียนไม่ได้จะทำให้ของใหม่หายเงียบ ๆ แทนที่จะเป็นของเก่า */
    var days = Object.keys(all).sort();
    while (days.length > MAX_DAYS) delete all[days.shift()];
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; }
    catch (e) { return false; }
  }

  /**
   * บันทึกตัวเลขของวันทำงานหนึ่ง
   *
   * คีย์เป็น "วันของงาน" ที่อ่านมาจากชีต ไม่ใช่วันที่กดปุ่ม — ทีมทำงานล่วงหน้า
   * เย็นนี้ดึงงานพรุ่งนี้เป็นเรื่องปกติ ถ้าคีย์ด้วยวันที่ปฏิทินจะได้ประวัติที่
   * เลื่อนไปหนึ่งวันทั้งชุดโดยไม่มีใครสังเกต
   *
   * รวมกับของเดิมของวันนั้น ไม่ทับทิ้ง เพราะแต่ละหน้าบันทึกคนละตัวเลข และการ
   * ดึงข้อมูลซ้ำวันเดิมต้องเป็นการอัปเดต ไม่ใช่การลบสิ่งที่หน้าอื่นบันทึกไว้
   *
   * @param {string} day วันของงาน รูปแบบ YYYY-MM-DD
   * @param {object} nums ตัวเลขที่จะบันทึก เก็บเฉพาะค่าที่เป็นตัวเลขจริง
   */
  function record(day, nums) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
    var all = read();
    var cur = all[day] || {};
    Object.keys(nums || {}).forEach(function (k) {
      var v = nums[k];
      if (typeof v === 'number' && isFinite(v)) cur[k] = v;
    });
    if (!Object.keys(cur).length) return false;
    cur.at = Date.now();
    all[day] = cur;
    return write(all);
  }

  /** วันทั้งหมดที่มีข้อมูล เรียงเก่า→ใหม่ */
  function days() { return Object.keys(read()).sort(); }

  /**
   * ค่าปกติของตัวเลขหนึ่ง จากวันก่อนหน้า
   *
   * ไม่รวมวันที่กำลังถามถึง — เทียบวันนี้กับค่าเฉลี่ยที่มีวันนี้อยู่ข้างในคือ
   * การเจือจางความต่างที่อยากเห็นด้วยตัวมันเอง
   *
   * ใช้ค่ากลาง (median) ไม่ใช่ค่าเฉลี่ย เพราะวันที่มีงาน Event ก้อนใหญ่วันเดียว
   * ดึงค่าเฉลี่ยขึ้นจนวันปกติหลังจากนั้นดูเบาผิดจริง
   *
   * @returns {{median:number, n:number}|null} null = ข้อมูลยังน้อยเกินจะเรียกว่าปกติ
   */
  function baseline(field, exceptDay) {
    var all = read();
    var vals = Object.keys(all)
      .filter(function (d) { return d !== exceptDay; })
      .sort()
      .slice(-30)
      .map(function (d) { return all[d][field]; })
      .filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (vals.length < MIN_BASE) return null;
    var s = vals.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    var med = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return { median: med, n: vals.length };
  }

  /**
   * วันนี้ต่างจากปกติแค่ไหน
   * @returns {{pct:number, median:number, n:number}|null}
   */
  function compare(field, day) {
    var all = read();
    var cur = all[day] && all[day][field];
    if (typeof cur !== 'number') return null;
    var b = baseline(field, day);
    if (!b || !b.median) return null;
    return { pct: Math.round(((cur - b.median) / b.median) * 100), median: b.median, n: b.n };
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  window.WmsHistory = {
    MIN_BASE: MIN_BASE,
    MAX_DAYS: MAX_DAYS,
    read: read,
    record: record,
    days: days,
    baseline: baseline,
    compare: compare,
    clear: clear,
  };
})();
