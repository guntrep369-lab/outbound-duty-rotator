/**
 * @file wms-pick.js — กฎการนับของและจัดกลุ่มของใบหยิบของ
 *
 * ── ทำไมต้องแยกออกมา ──────────────────────────────────────────────────
 * โมดูลสรุปหยิบของกับแท็บเช็คสต๊อกใช้ตัวนับความต้องการตัวเดียวกัน แต่ตอนนี้อยู่
 * คนละหน้าแล้ว ถ้าปล่อยให้ต่างคนต่างมีชุดของตัวเอง วันหนึ่งใบหยิบจะบอกให้หยิบ
 * 12 ชิ้นแต่หน้าเช็คสต๊อกบอกว่าต้องใช้ 9 แล้วไม่มีใครรู้ว่าอันไหนจริง
 *
 * กฎการจัดกลุ่มก็เหมือนกัน — ลำดับในรายการมีความหมาย (ท๊อปเปอร์ต้องมาก่อนที่นอน
 * เครื่องนวดต้องมาก่อนหมอน ปลอกหมอนต้องมาก่อนหมอน) แก้ที่เดียวจบ
 *
 * ของที่ไม่เข้ากฎไหนเลยไปอยู่ "อื่น ๆ" ไม่ใช่หายไป — ของหายจากใบหยิบแปลว่า
 * ลืมหยิบจริง
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsPick
 */
(function () {
  'use strict';
  var SKU_RE = /\(([A-Z]{2,}\d{5,})\)/;

  /** รหัสสินค้าในวงเล็บท้ายชื่อ เช่น "หมอน (FRE0000000216)" → FRE0000000216 */
  function extractSKU(text) {
    var m = SKU_RE.exec(text || "");
    return m ? m[1] : null;
  }

  /**
   * ของที่รหัสขึ้นต้น FRE เก็บอยู่โซนเดียวกันในคลัง เดินหยิบรอบเดียวจบ
   *
   * การจัดกลุ่มตามประเภทอย่างเดียวแยกให้ไม่ได้ เพราะของโซนนี้ปนอยู่ในหลายประเภท —
   * ในข้อมูลจริงกลุ่ม "หมอน" มี FRE 40 บรรทัดปนกับรหัสอื่น 14 บรรทัด และ
   * "ผ้านวม/ผ้าห่ม" ปนกันเกือบครึ่งต่อครึ่ง คนหยิบจึงต้องไล่อ่านทั้งกลุ่มเพื่อคัดเอง
   *
   * ใช้กับใบของแถมเท่านั้น — ใบที่นอนไม่มีรหัส FRE เลยสักบรรทัด
   */
  var FRE_RE = /^FRE/i;
  function inFreZone(item) {
    return FRE_RE.test(String((item && item.sku) || ''));
  }

  var PICK_CATS = [
    // ท๊อปเปอร์มาก่อนที่นอน เพราะชื่อสินค้ามักมีคำว่า "ที่นอน" หรือ "mattress"
    // ปนอยู่ด้วย ถ้าเรียงทีหลังจะถูกที่นอนจับไปก่อน
    { label: '🧶 ท๊อปเปอร์', re: /ท๊อปเปอร์|ท็อปเปอร์|topper/i, bySize: true },
    { label: '🛏️ ที่นอน', re: /ที่นอน|mattress/i, bySize: true },
    { label: '💺 เก้าอี้', re: /เก้าอี้|chair/i },
    { label: '🪑 โต๊ะ',   re: /โต๊ะ|desk|desktop/i },
    { label: '🛌 เตียง',  re: /เตียง|bed frame|adjustable bed/i },
  ];

  var GIFT_CATS = [
    { label: 'ชุดเครื่องนอน',   re: /ชุดเครื่องนอน|bedding set/i },
    { label: 'ผ้านวม / ผ้าห่ม', re: /ผ้านวม|ผ้าห่ม|duvet|comforter|blanket/i },
    { label: 'ผ้ารองกันเปื้อน', re: /ผ้ารอง|กันเปื้อน|protector/i },
    // กลุ่มนวดต้องมาก่อนหมอน ไม่งั้น "หมอนนวด" จะถูกกลุ่มหมอนจับไปก่อน
    { label: '💆 เครื่องนวด / ปืนนวด',
      re: /เครื่องนวด|ปืนนวด|นวดไฟฟ้า|massage\s*gun|massager|massage/i },
    // สะกดได้ทั้ง โน๊ต และ โน้ต จึงรับทั้งสองแบบ ไม่งั้นครึ่งหนึ่งของรายการหลุดกลุ่ม
    { label: '🖥️ แขนจับจอ / ที่วางโน้ตบุ๊ค',
      re: /แขนจับจอ|ขาตั้งจอ|(ที่|แท่น)วางโน[๊้]ตบุ[๊้]ค|monitor\s*(arm|stand|mount)|(laptop|notebook)\s*stand/i },
    // ปลอกหมอนมาก่อนหมอน ด้วยเหตุผลเดียวกัน — ชื่อมีคำว่า "หมอน"/"pillow" อยู่แล้ว
    { label: 'ปลอกหมอน',       re: /ปลอกหมอน|pillow\s*case|pillowcase/i },
    { label: 'หมอน',           re: /หมอน|pillow/i },
    // ของชิ้นใหญ่ ทีมขอให้อยู่ท้ายใบเสมอ — last:true ไม่ใช่แค่วางไว้ล่างสุดของ
    // รายการนี้ เพราะ "อื่น ๆ" ถูกจัดให้อยู่ท้ายอยู่แล้ว ถ้าไม่ทำเครื่องหมายไว้
    // กลุ่มนี้จะไปโผล่เหนือ อื่น ๆ ทุกครั้งที่มีของหลุดกลุ่ม
    { label: '🪑 เก้าอี้ / ท๊อปโต๊ะ / ขาโต๊ะ', last: true,
      re: /เก้าอี้|ท[๊็]อปโต๊ะ|ขาโต๊ะ|โต๊ะ|chair|desk|table\s*top/i },
  ];

  function pickSize(name) {
    const m = /(\d+(?:\.\d+)?)\s*(?:ft|ฟุต)/i.exec(String(name || ''));
    return m ? parseFloat(m[1]) : null;
  }

  function aggregateSKUDemand(rows) {
    const demand = {};
    // Build lookup: orderId -> {sup, customer}
    const orderMeta = {};
    rows.forEach(row => {
      if (row.orderID && !orderMeta[row.orderID]) {
        orderMeta[row.orderID] = { sup: row.sup || '—', customer: row.customer || '—' };
      }
    });
  
    function addDemand(sku, name, qty, orderId, type) {
      if (!demand[sku]) demand[sku] = { sku, name, qty: 0, type: type || 'bed', orderMap: {} };
      demand[sku].qty += qty;
      // orderMap: orderId -> { sup, customer, qty }
      if (!demand[sku].orderMap[orderId]) {
        const m = orderMeta[orderId] || { sup: '—', customer: '—' };
        demand[sku].orderMap[orderId] = { orderId, sup: m.sup, customer: m.customer, qty: 0 };
      }
      demand[sku].orderMap[orderId].qty += qty;
    }
  
    rows.forEach(row => {
      const orderId = row.orderID;
      const brand   = row.brand;
      const qty1    = parseFloat(row.qty1 || 1) || 1;
      const giftRaw = row.giftRaw || '';
      const qtyRaw  = row.qtyRaw  || '';
  
      if (brand) {
        const sku = extractSKU(brand);
        if (sku) addDemand(sku, brand, qty1, orderId, 'bed');
        if (giftRaw) {
          const gLines = giftRaw.split('\n');
          const qLines = qtyRaw.split('\n');
          gLines.forEach((g, i) => {
            const name = g.replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim();
            if (!name) return;
            const q = parseFloat((qLines[i]||'').trim()) || 1;
            const gsku = extractSKU(name);
            if (gsku) addDemand(gsku, name, q, orderId, 'gift');
          });
        }
      } else if (giftRaw) {
        const gLines = giftRaw.split('\n');
        const qLines = qtyRaw.split('\n');
        gLines.forEach((g, i) => {
          const name = g.replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim();
          if (!name) return;
          const q = parseFloat((qLines[i]||'').trim()) || 1;
          const sku = extractSKU(name);
          if (sku) addDemand(sku, name, q, orderId, 'gift');
        });
      }
    });
    return demand;
  }
  /**
   * ชื่อที่ใช้จำแนกประเภทและขนาด
   *
   * ไฟล์สต๊อกระบุขนาด/ประเภทชัดกว่าไฟล์ออเดอร์มาก จึงใช้ description จากสต๊อก
   * เป็นหลัก แล้วถอยไปใช้ชื่อจากไฟล์ออเดอร์เมื่อยังไม่ได้ดึงสต๊อก หรือ SKU นั้น
   * ไม่มีในไฟล์ — ใบหยิบจึงยังใช้ได้แม้ไม่มีสต๊อก แค่จำแนกหยาบลง
   *
   * @param {object} stock map จาก WmsStock.read().map (ส่ง {} มาได้ถ้ายังไม่มี)
   */
  function nameOf(item, stock) {
    var s = (stock || {})[item.sku];
    var desc = s && String(s.description || '').trim();
    return desc || item.name || '';
  }

  /** จับสินค้าเข้ากลุ่ม ตัวแรกที่ตรงชนะ ไม่ตรงเลย → อื่น ๆ */
  function categoryOf(item, stock) {
    var cats = item.type === 'gift' ? GIFT_CATS : PICK_CATS;
    var name = nameOf(item, stock);
    for (var i = 0; i < cats.length; i++) if (cats[i].re.test(name)) return cats[i];
    return { label: 'อื่น ๆ', re: null };
  }

  /**
   * เรียงกลุ่มตามลำดับที่ตั้งไว้ กลุ่มที่ทำเครื่องหมาย last ไว้ลงท้ายสุดเสมอ
   *
   * last ไม่ใช่แค่วางไว้ล่างสุดของรายการกฎ เพราะ "อื่น ๆ" ถูกจัดให้อยู่ท้ายอยู่แล้ว
   * ถ้าไม่ทำเครื่องหมาย กลุ่มนั้นจะไปโผล่เหนือ อื่น ๆ ทุกครั้งที่มีของหลุดกลุ่ม
   */
  function rankOf(cat, list) {
    if (cat.last) return 999;
    var i = list.indexOf(cat);
    return i < 0 ? 99 : i;
  }

  window.WmsPick = {
    SKU_RE: SKU_RE,
    PICK_CATS: PICK_CATS,
    GIFT_CATS: GIFT_CATS,
    extractSKU: extractSKU,
    aggregateSKUDemand: aggregateSKUDemand,
    pickSize: pickSize,
    nameOf: nameOf,
    categoryOf: categoryOf,
    rankOf: rankOf,
    inFreZone: inFreZone,
  };
})();
