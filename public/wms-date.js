/**
 * @file wms-date.js — วันที่ที่แสดงบนหน้าจอ เขียนแบบเดียวกันทั้งระบบ
 *
 * ── ทำไมต้องมีไฟล์นี้ ──────────────────────────────────────────────────
 * หลายหน้าแปลง 'YYYY-MM-DD' เป็น "17 ส.ค." เหมือนกันแต่เขียนแยกกัน และทุกที่
 * ตัดปีทิ้งหมด ซึ่งกลายเป็นจุดบอด: ถ้าสคริปต์ฝั่ง Apps Script อ่านวันที่ไม่ออก
 * แล้วได้ปี 2001 มา (ชีตเขียน "Mon, Aug 17" ซึ่งไม่มีปี) หน้าจอจะขึ้นว่า
 * "17 ส.ค." ซึ่งดูถูกต้องทุกประการ ความผิดพลาดจึงมองไม่เห็นเลย
 *
 * กติกาที่นี่: ปีปัจจุบันไม่ต้องเขียน ปีอื่นต้องเขียน — ของที่ถูกอยู่แล้วจะสั้น
 * เหมือนเดิม ส่วนของที่ผิดหรือข้ามปีจริง ๆ จะสะดุดตาทันที
 *
 * ── ทำไมใช้ ค.ศ. ไม่ใช่ พ.ศ. ──────────────────────────────────────────
 * ทั้งระบบพูดเป็น ค.ศ. อยู่แล้ว ทั้งข้อความเตือนจาก Apps Script ("ไม่มีออเดอร์
 * ของวันที่ 2026-08-17") และช่อง ?date= ถ้าตรงนี้ขึ้น 2569 คนจะต้องแปลงในหัว
 * ทุกครั้งที่เทียบสองที่ และเลข 2544 ก็ไม่ได้ช่วยให้ใครนึกออกว่ามันคือปี 2001
 * ที่ผิดพลาด
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsDate
 */
(function () {
  'use strict';

  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /** 'YYYY-MM-DD' หรือ 'YYYY-MM-DD HH:mm' → [y, m, d, hh, mm] หรือ null */
  function parts(v) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(v || '').trim());
    if (!m) return null;
    return [+m[1], +m[2], +m[3], m[4] || '', m[5] || ''];
  }

  function midnight(y, mo, d) { return new Date(y, mo - 1, d).getTime(); }

  function today() {
    var n = new Date();
    return midnight(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  /**
   * วันที่แบบสั้นสำหรับแสดงผล — ใส่ปีให้เมื่อไม่ใช่ปีปัจจุบัน
   * @param {string} v 'YYYY-MM-DD'
   * @returns {string} เช่น '17 ส.ค.' หรือ '17 ส.ค. 2001' — คืนค่าเดิมถ้าอ่านไม่ออก
   */
  function thai(v) {
    var p = parts(v);
    if (!p) return String(v || '');
    var s = p[2] + ' ' + (MONTHS[p[1] - 1] || p[1]);
    return p[0] === new Date().getFullYear() ? s : s + ' ' + p[0];
  }

  /**
   * เวลาที่บันทึก — 'วันนี้ 08:15 น.' / 'เมื่อวาน 17:30 น.' / '16 ส.ค. 08:15 น.'
   *
   * วันนี้กับเมื่อวานเขียนเป็นคำ เพราะเป็นสองวันที่คนอ่านแล้วต้องรู้ทันทีว่าใหม่
   * หรือเก่า ส่วนที่ไกลกว่านั้นบอกวันที่ไปเลย ปีตามกติกาเดียวกับ thai()
   */
  function when(v) {
    var p = parts(v);
    if (!p) return String(v || '');
    var time = p[3] ? ' ' + p[3] + ':' + p[4] + ' น.' : '';
    var gap = Math.round((midnight(p[0], p[1], p[2]) - today()) / 86400000);
    if (gap === 0)  return 'วันนี้' + time;
    if (gap === -1) return 'เมื่อวาน' + time;
    if (gap === 1)  return 'พรุ่งนี้' + time;
    return thai(v) + time;
  }

  /** ช่วงวันของงานในไฟล์ — '17 ส.ค.' / '16 ส.ค., 17 ส.ค.' / '16 ส.ค.–18 ส.ค.' */
  function range(list) {
    var ds = (list || []).filter(Boolean).slice().sort();
    if (!ds.length) return '';
    if (ds.length === 1) return thai(ds[0]);
    if (ds.length === 2) return thai(ds[0]) + ', ' + thai(ds[1]);
    return thai(ds[0]) + '–' + thai(ds[ds.length - 1]);
  }

  /** วันนี้แบบ 'YYYY-MM-DD' ตามเวลาเครื่องผู้ใช้ */
  function todayYmd() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  window.WmsDate = {
    MONTHS: MONTHS,
    thai: thai,
    when: when,
    range: range,
    todayYmd: todayYmd,
    isToday: function (v) { var p = parts(v); return !!p && midnight(p[0], p[1], p[2]) === today(); },
  };
})();
