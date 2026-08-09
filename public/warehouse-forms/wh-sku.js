/**
 * @file wh-sku.js — รายชื่อสินค้าและคู่ขาย↔แถม ที่ฟอร์มคลังสินค้าใช้ค้นหา
 *
 * ในไฟล์ Excel ต้นฉบับ ช่อง "ชื่อสินค้า" ไม่ได้พิมพ์เอง แต่เป็นสูตร
 *   XLOOKUP(B7, data!B:B, data!D:D, "")
 * ซึ่งในชีต "ใบโอนสินค้า ข้าม Location" ขึ้น #NAME? ทุกบรรทัด เพราะไฟล์ถูกบันทึก
 * มาจากโปรแกรมที่ไม่รู้จัก XLOOKUP — ส่วนที่ทำให้ฟอร์มมีค่าคือส่วนที่พังอยู่พอดี
 * ที่นี่จึงทำการค้นหาเอง ไม่ต้องพึ่งว่าเปิดด้วยโปรแกรมอะไร
 *
 * WHY localStorage: รายชื่อสินค้าไม่ได้เปลี่ยนทุกวันเหมือนไฟล์ออเดอร์ อัปครั้งเดียว
 * แล้วใช้ได้ยาว ๆ — ต่างจาก sessionStorage ที่ตั้งใจให้ข้อมูลของวันหายไปเมื่อปิด
 *
 * WHY ไม่ฝังไว้ใน repo: repo นี้เป็น public การใส่รหัสสินค้าและชื่อสินค้าทั้งหมด
 * ลงไปเท่ากับเผยแพร่แคตตาล็อกภายในโดยไม่ได้ตั้งใจ
 *
 * โหลดเป็น classic script เปิดเป็น window.WhSku
 */
(function () {
  'use strict';

  var KEY = 'wms:wh:sku';

  var norm = function (s) { return String(s == null ? '' : s).trim().toUpperCase(); };

  function read() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      return o && Array.isArray(o.items) ? o : null;
    } catch (e) {
      return null;
    }
  }

  /** index สร้างใหม่ทุกครั้งที่โหลดหน้า ไม่เก็บลง storage เพราะสร้างเร็วกว่าอ่าน */
  var _idx = null;
  function index() {
    if (_idx) return _idx;
    var db = read();
    _idx = { bySku: Object.create(null), pairOf: Object.create(null), items: db ? db.items : [] };
    if (!db) return _idx;
    db.items.forEach(function (it) {
      // ชี้ได้ทั้งรหัสสั้น (AHM001) และรหัสยาว (AHM0000000001) เพราะเอกสารคนละใบ
      // ใช้คนละแบบ และคนกรอกก็หยิบมาจากที่ที่มีอยู่ตรงหน้า
      if (it.sku) _idx.bySku[norm(it.sku)] = it;
      if (it.pid) _idx.bySku[norm(it.pid)] = it;
    });
    // ชีต Master แปลงบาร์ บันทึกไว้สองทางอยู่แล้ว (แถวหนึ่ง ขาย→แถม อีกแถว แถม→ขาย)
    // จึงอ่านตามที่เขียนไว้ ไม่สร้างทางกลับเอง ไม่งั้นของที่ทำเองจะทับของจริงแล้ว
    // ป้ายทิศทางกลับด้าน
    (db.pairs || []).forEach(function (p) {
      [p.fromSku, p.fromPid].forEach(function (k) {
        if (k) _idx.pairOf[norm(k)] = { to: p.toSku, name: p.toName };
      });
    });
    return _idx;
  }

  /**
   * อ่านชีต data และ Master แปลงบาร์ จากไฟล์ที่อัปมา
   * @param {object} wb workbook ของ XLSX
   */
  function parseWorkbook(wb) {
    var pick = function (test) {
      return wb.SheetNames.filter(function (n) { return test(String(n).toLowerCase()); })[0];
    };
    var dataName = pick(function (n) { return n === 'data'; }) || pick(function (n) { return n.indexOf('data') !== -1; });
    var pairName = pick(function (n) { return n.indexOf('แปลง') !== -1; });

    var items = [], pairs = [];
    if (dataName) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[dataName], { header: 1, defval: '' });
      rows.slice(1).forEach(function (r) {
        var sku = String(r[1] || '').trim();
        var desc = String(r[3] || '').trim();
        if (!sku || !desc) return;
        items.push({ sku: sku, pid: String(r[2] || '').trim(), name: desc });
      });
    }
    if (pairName) {
      var pr = XLSX.utils.sheet_to_json(wb.Sheets[pairName], { header: 1, defval: '' });
      pr.slice(1).forEach(function (r) {
        var fromSku = String(r[2] || '').trim(), toSku = String(r[5] || '').trim();
        if (!fromSku || !toSku) return;
        pairs.push({
          fromPid: String(r[1] || '').trim(), fromSku: fromSku, fromName: String(r[3] || '').trim(),
          toPid: String(r[4] || '').trim(), toSku: toSku, toName: String(r[6] || '').trim(),
        });
      });
    }
    return { items: items, pairs: pairs, dataName: dataName || '', pairName: pairName || '' };
  }

  window.WhSku = {
    KEY: KEY,
    parseWorkbook: parseWorkbook,

    /** @returns {{at:number, items:Array, pairs:Array, fileName:string}|null} */
    get: read,

    /** @returns {{ok:boolean, error?:string}} */
    save: function (fileName, parsed) {
      if (!parsed.items.length) {
        return { ok: false, error: 'ไม่พบชีต "data" หรือไม่มีรายการสินค้าในไฟล์' };
      }
      try {
        localStorage.setItem(KEY, JSON.stringify({
          at: Date.now(), fileName: fileName || '',
          items: parsed.items, pairs: parsed.pairs,
        }));
        _idx = null;
        return { ok: true };
      } catch (e) {
        return { ok: false, error: 'บันทึกไม่ได้ — รายการอาจใหญ่เกินพื้นที่ของเบราว์เซอร์' };
      }
    },

    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      _idx = null;
    },

    /** หาสินค้าจากรหัส — รับได้ทั้งรหัสสั้นและรหัสยาว */
    find: function (code) {
      return index().bySku[norm(code)] || null;
    },

    /** รหัสปลายทางที่คู่กับรหัสนี้ ตามที่ชีต Master แปลงบาร์ บันทึกไว้ */
    pair: function (code) {
      return index().pairOf[norm(code)] || null;
    },

    /**
     * ค้นแบบพิมพ์ไปเรื่อย ๆ — คืนไม่เกิน `limit` รายการ
     * รหัสที่ขึ้นต้นตรงมาก่อนชื่อที่มีคำนั้นอยู่กลาง เพราะคนกรอกมักรู้รหัสอยู่แล้ว
     */
    search: function (q, limit) {
      var s = norm(q);
      if (s.length < 2) return [];
      var items = index().items, out = [], mid = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (norm(it.sku).indexOf(s) === 0 || norm(it.pid).indexOf(s) === 0) out.push(it);
        else if (norm(it.sku).indexOf(s) !== -1 || it.name.toUpperCase().indexOf(s) !== -1) mid.push(it);
        if (out.length >= (limit || 8)) break;
      }
      return out.concat(mid).slice(0, limit || 8);
    },
  };
})();
