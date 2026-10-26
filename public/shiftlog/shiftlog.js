/**
 * @file shiftlog.js — สมุดกะ: ออเดอร์ที่ติดปัญหาส่งต่อให้กะถัดไป กับเรื่องอื่นที่ต้องตามต่อ
 *
 * แทนชีตต่องานที่ทีมใช้อยู่ (วันที่ · Sup · Order ID · เลข consign · สินค้า · ขนาด · จำนวน ·
 * SKU · stock · หมายเหตุ) แถวละหนึ่งออเดอร์ที่ส่งตามปกติไม่ได้ ค้างไว้จนกะไหนสักกะส่งออกได้
 *
 * รายการเก็บใน shiftLog ของข้อมูลตารางกะ (localStorage wms:roster) เป็น { รหัส: รายการ }
 * อยู่ชุดเดียวกับตารางกะ จึงใช้ชีตส่วนกลางตัวเดิมได้เลย และสองเครื่องเพิ่มรายการพร้อมกัน
 * รวมกันได้ทีละรายการโดยไม่ต้องถาม (roster-sync.js รวม shiftLog ทีละช่อง)
 *
 * รายการ: { date, shift: 'morning'|'evening', kind: 'order'|'handover', text?,
 *           — kind 'order': sup?, order, consign?, product?, size?, qty?, sku?, reason, logis,
 *           open, result?: 'shipped'|'cancelled', updates?: [{by, at, text}],
 *           by, at, closedBy?, closedAt?, editedBy?, editedAt? }
 * - order: ออเดอร์ติดปัญหา — เปิดค้างจนกดส่งออกแล้ว หรือออเดอร์ถูกยกเลิก
 * - handover: เรื่องอื่นที่ไม่ใช่ออเดอร์ (รถไม่มา คนไม่พอ) — เปิดค้างจนกดเสร็จ
 * - logis: ต้องให้ทีม Logis ทำอะไรต่อ (แก้บิล ออกใบปะหน้าใหม่) — ขึ้นก่อนในหน้าดูของ Logis
 *
 * โหลดเป็น classic script เปิดเป็น window.ShiftLog
 */
(function () {
  'use strict';

  /* หมายเหตุในชีตเดิมมี 20 กว่าตัวเลือกเรียงปนกัน ทั้งสาเหตุ ที่ที่ต้องไปรับของ และเรื่องที่ต้องแจ้ง
     Logis คนเลือกจึงต้องไล่อ่านทั้งรายการ (จนมีตัวเลือก "ไม่รู้ๆ") และสิ้นเดือนนับอะไรไม่ได้
     ที่นี่ใช้คำเดิมของทีมเกือบทั้งหมดให้จำได้ แต่จัดเป็นหมวด และรวมคู่ที่เป็นเรื่องเดียวกัน */
  var GROUPS = [
    { id: 'stock', label: 'ของ / สต๊อก' },
    { id: 'fetch', label: 'ต้องไปรับของ' },
    { id: 'logis', label: 'ต้องแจ้ง Logis' },
    { id: 'other', label: 'อื่น ๆ' },
  ];
  var REASONS = [
    { id: 'out', label: 'หมด / รอเติม', group: 'stock' },
    { id: 'reserved', label: 'สินค้าจอง', group: 'stock' },
    { id: 'damaged', label: 'เสียหาย', group: 'stock' },
    { id: 'nosku', label: 'ไม่มี SKU', group: 'stock' },
    { id: 'convert', label: 'แปลงสินค้า', group: 'stock' },
    { id: 'at_in', label: 'รับที่ IN', group: 'fetch' },
    { id: 'at_qa', label: 'รับที่ QA', group: 'fetch' },
    { id: 'at_acc', label: 'รับที่บัญชี', group: 'fetch' },
    { id: 'at_return', label: 'รับสินค้าจาก return', group: 'fetch' },
    // บิลมา 1 กล่อง แต่แพ็คจริงต้องใช้ 2 กล่อง — กะถัดไปต้องแจ้ง Logis ให้แก้บิล
    { id: 'split', label: 'แจ้งแตกล็อต', group: 'logis', logis: true },
    { id: 'box', label: 'เพิ่ม / เปลี่ยนกล่อง', group: 'logis', logis: true },
    { id: 'item', label: 'เพิ่ม / เปลี่ยนสินค้า', group: 'logis', logis: true },
    { id: 'gift', label: 'ยกเลิกของแถม', group: 'logis', logis: true },
    { id: 'nolabel', label: 'ไม่มีใบปะหน้า', group: 'logis', logis: true },
    { id: 'carrier', label: 'ขนส่งแจ้งยกเลิก', group: 'logis', logis: true },
    { id: 'other', label: 'อื่น ๆ', group: 'other' },
  ];
  var SHIFTS = { morning: 'กะเช้า', evening: 'กะบ่าย' };
  var RESULTS = { shipped: 'ส่งออกแล้ว', cancelled: 'ยกเลิกออเดอร์' };

  function reasonOf(id) {
    for (var i = 0; i < REASONS.length; i++) if (REASONS[i].id === id) return REASONS[i];
    return REASONS[REASONS.length - 1];
  }
  function reasonLabel(id) { return reasonOf(id).label; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  /**
   * กะของเวลานี้ — กะเช้า 07:00–16:00 กะบ่าย 16:00–24:00
   * หลังเที่ยงคืนก่อน 7 โมงยังเป็นคนกะบ่ายที่กำลังปิดงาน จึงนับเป็นกะบ่ายของเมื่อวาน
   */
  function shiftAt(now) {
    var h = now.getHours();
    if (h < 7) {
      var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return { date: ymd(y), shift: 'evening' };
    }
    return { date: ymd(now), shift: h < 16 ? 'morning' : 'evening' };
  }

  var DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  var MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  /** 'YYYY-MM-DD' → "ส. 24 ต.ค. 2569" */
  function dayText(s) {
    var d = pd(s);
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }

  /** ค้างมากี่วันแล้ว นับจากวันที่ของรายการถึงวันของกะตอนนี้ */
  function age(e, today) { return Math.max(0, Math.round((pd(today) - pd(e.date)) / 86400000)); }

  /** รหัสรายการ — เวลาบวกเลขสุ่ม สองเครื่องกดบันทึกวินาทีเดียวกันก็ไม่ชนกัน */
  function newId(now, rnd) {
    return now.getTime().toString(36) + Math.floor((rnd === undefined ? Math.random() : rnd) * 1e6).toString(36);
  }

  function rows(log) {
    var out = [];
    for (var id in log) {
      var e = log[id];
      if (!e || typeof e !== 'object') continue;
      var r = { id: id };
      for (var k in e) r[k] = e[k];
      out.push(r);
    }
    return out;
  }
  /** เรียงตามวัน กะเช้าก่อนกะบ่าย แล้วตามเวลาที่บันทึก */
  function byWhen(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.shift !== b.shift) return a.shift === 'morning' ? -1 : 1;
    return (a.at || 0) - (b.at || 0);
  }

  /** เรื่องที่ยังค้าง ทุกวัน — เก่าสุดขึ้นก่อน ค้างนานต้องเห็นก่อน */
  function openItems(log) {
    return rows(log).filter(function (e) { return e.open; }).sort(byWhen);
  }

  /** รายการของวันหนึ่ง แยกตามกะ */
  function day(log, date) {
    var out = { morning: [], evening: [] };
    rows(log).filter(function (e) { return e.date === date; }).sort(byWhen).forEach(function (e) {
      (out[e.shift] || out.evening).push(e);
    });
    return out;
  }

  function bump(o, k) { o[k] = (o[k] || 0) + 1; }

  /**
   * สรุปเดือน ym ('YYYY-MM') — นับเฉพาะออเดอร์ติดปัญหา เรื่องอื่นนับแค่จำนวน
   * open: ออเดอร์ที่ยังไม่ได้ส่ง · openOther: เรื่องอื่นที่ยังค้าง
   * closeDays: ออเดอร์ที่ปิดแล้วใช้เวลากี่วันจนส่งออก/ยกเลิก (วันเดียวกัน = 0)
   * products: สินค้าที่ติดบ่อยสุดก่อน — ใช้ SKU ถ้ามี ไม่มีก็ใช้ชื่อสินค้า
   */
  function month(log, ym) {
    var s = {
      orders: 0, handovers: 0, open: 0, openOther: 0, shipped: 0, cancelled: 0,
      byReason: {}, byGroup: {}, bySup: {}, byShift: { morning: 0, evening: 0 },
      products: [], closeDays: { n: 0, avg: 0 }, list: [],
    };
    var prod = {}, days = 0;
    rows(log).filter(function (e) { return String(e.date).slice(0, 7) === ym; }).sort(byWhen).forEach(function (e) {
      if (e.kind !== 'order') { s.handovers++; if (e.open) s.openOther++; return; }
      if (e.open) s.open++;
      var r = reasonOf(e.reason);
      s.orders++;
      bump(s.byReason, r.id);
      bump(s.byGroup, r.group);
      bump(s.bySup, e.sup || '—');
      if (s.byShift[e.shift] !== undefined) s.byShift[e.shift]++;
      if (e.result === 'shipped') s.shipped++;
      if (e.result === 'cancelled') s.cancelled++;
      var key = e.sku || e.product;
      if (key) {
        var p = prod[key] || (prod[key] = { key: key, sku: e.sku || '', product: e.product || '', n: 0 });
        p.n++;
        if (!p.product && e.product) p.product = e.product;
      }
      if (!e.open && e.closedAt) {
        s.closeDays.n++;
        days += age(e, ymd(new Date(e.closedAt)));
      }
      s.list.push(e);
    });
    s.products = Object.keys(prod).map(function (k) { return prod[k]; })
      .sort(function (a, b) { return b.n - a.n || (a.key < b.key ? -1 : 1); });
    if (s.closeDays.n) s.closeDays.avg = Math.round(days / s.closeDays.n * 10) / 10;
    return s;
  }

  /**
   * สินค้าของออเดอร์นี้จากข้อมูลออเดอร์ที่ดึงมาแล้ว (OrderIndex.get().rows) — ใส่เลขออเดอร์
   * แล้วได้ Sup เลข consign สินค้า ขนาด จำนวน โดยไม่ต้องพิมพ์ซ้ำจากชีตออเดอร์
   * ออเดอร์หนึ่งมีหลายสินค้าได้ คนเลือกว่าตัวไหนติด
   * SKU อยู่ในวงเล็บท้ายชื่อสินค้า (ใช้ตัวแยกของ wms-pick.js ถ้าโหลดไว้)
   * @returns {Array<{sup, consign, product, size, qty, sku}>}
   */
  function orderLines(idxRows, id) {
    var want = String(id || '').trim().toUpperCase();
    if (!want) return [];
    var skuOf = window.WmsPick && window.WmsPick.extractSKU;
    var out = [], seen = {};
    (idxRows || []).forEach(function (r) {
      if (String(r.orderID || '').trim().toUpperCase() !== want) return;
      var line = {
        sup: r.sup || '', consign: r.consign || '', product: r.brand || '', size: r.size || '',
        qty: r.qty1 != null && r.qty1 !== '' ? Number(r.qty1) || r.qty1 : '',
        sku: (skuOf && skuOf(r.brand)) || '',
      };
      var k = JSON.stringify(line);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(line);
    });
    return out;
  }

  window.ShiftLog = {
    GROUPS: GROUPS, REASONS: REASONS, SHIFTS: SHIFTS, RESULTS: RESULTS,
    reasonOf: reasonOf, reasonLabel: reasonLabel,
    shiftAt: shiftAt, age: age, dayText: dayText, newId: newId,
    openItems: openItems, day: day, month: month, orderLines: orderLines,
  };
})();
