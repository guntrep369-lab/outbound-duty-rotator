/**
 * @file wms-invmatch.js — จับคู่ออเดอร์ที่ตัด LOT/PO แล้ว กับเลขที่เอกสาร (Invoice) จากไฟล์บัญชี
 *
 * ฝั่งคลัง: ไฟล์ออเดอร์ × LOT/PO (หน้า LOT / PO ที่ขายออก แบบรายออเดอร์) หนึ่งบรรทัดต่อ SKU × LOT × PO ของออเดอร์
 * ฝั่งบัญชี: ไฟล์ที่บัญชีส่งมา หนึ่งบรรทัดต่อรายการสินค้าในเอกสาร มีเลขออเดอร์กำกับ
 * ผลที่ได้: ทุกบรรทัดฝั่งคลังมีเลขที่เอกสาร บัญชีรู้ว่า Invoice ใบไหนตัดของจาก LOT/PO ไหน
 * และรายการที่ต้องตามต่อ (ยอดไม่ตรง ยังไม่มี Invoice มีแต่ในบัญชี)
 *
 * ทำในเบราว์เซอร์ล้วน ไม่ส่งไฟล์ไปที่ไหน ไม่เก็บลงเครื่อง ปิดหน้าแล้วหาย
 * ไฟล์เป็นตัวเลขบัญชีและเลขออเดอร์ลูกค้า ไม่ควรค้างอยู่ในเบราว์เซอร์ที่คนอื่นเปิดต่อได้
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsInvMatch
 */
(function () {
  'use strict';

  /**
   * หัวคอลัมน์ที่ยอมรับ เทียบแบบตัดช่องว่างกับขึ้นบรรทัดออก และไม่สนตัวพิมพ์เล็กใหญ่
   * ชื่อแรกของแต่ละช่องคือชื่อที่ใช้ในไฟล์ที่ส่งออก
   */
  var STOCK_COLS = {
    date: ['วันที่'],
    sys: ['ระบบ'],
    pre: ['เลขออเดอร์ก่อนที่จะแยกบิล', 'เลขออเดอร์ก่อนแยกบิล', 'ออเดอร์ก่อนแยกบิล'],
    order: ['เลขออเดอร์', 'ออเดอร์ภายใน'],
    online: ['หมายเลขคำสั่งซื้อออนไลน์', 'คำสั่งซื้อออนไลน์'],
    carrier: ['บริษัทขนส่ง'],
    sku: ['SKU'],
    sold: ['SKU ที่ขาย'],
    name: ['ชื่อสินค้า'],
    lot: ['LOT'],
    po: ['PO'],
    qty: ['จำนวน'],
  };
  var ACC_COLS = {
    order: ['ออเดอร์ภายใน', 'เลขออเดอร์'],
    pre: ['ออเดอร์ก่อนแยกบิล', 'เลขออเดอร์ก่อนที่จะแยกบิล', 'เลขออเดอร์ก่อนแยกบิล'],
    online: ['คำสั่งซื้อออนไลน์', 'หมายเลขคำสั่งซื้อออนไลน์'],
    doc: ['เลขที่เอกสาร'],
    docDate: ['วันที่เอกสาร'],
    due: ['วันที่ครบกำหนด'],
    ref: ['เลขที่อ้างอิง'],
    code: ['รหัสสินค้า', 'SKU'],
    name: ['ชื่อสินค้า'],
    qty: ['จำนวน'],
  };
  /* ช่องที่ขาดไม่ได้ ฝั่งบัญชีต้องมีเลขออเดอร์อย่างน้อยหนึ่งแบบด้วย ไม่งั้นไม่มีอะไรให้จับคู่
     LOT กับ PO ไม่บังคับ ไฟล์ออเดอร์ที่ยังไม่ได้ตัด LOT ก็จับคู่เลขเอกสารได้ */
  var STOCK_NEED = ['order', 'sku', 'qty'];
  var ACC_NEED = ['doc', 'code', 'qty'];
  var HEAD_SCAN = 15;   // หัวตารางอาจไม่ได้อยู่แถวแรก ถ้ามีชื่อรายงานอยู่ด้านบน

  /** วิธีที่จับคู่ได้ ลำดับนี้คือลำดับที่ลอง */
  var HOW = {
    order: 'เลขออเดอร์',
    pre: 'เลขออเดอร์ก่อนแยกบิล',
    online: 'เลขคำสั่งซื้อออนไลน์',
  };

  /** ผลของแต่ละรายการ ลำดับนี้คือลำดับตัวกรองบนหน้าเว็บ เรื่องที่ต้องตามต่อมาก่อน */
  var STATES = [
    { state: 'diff',    label: 'จำนวนไม่ตรง',            note: 'ได้เลขเอกสารแล้ว แต่ชิ้นต่อ SKU ไม่เท่ากับในเอกสาร' },
    { state: 'none',    label: 'ยังไม่มี Invoice',        note: 'ไม่พบออเดอร์นี้ในไฟล์บัญชี' },
    { state: 'acconly', label: 'มีแต่ในไฟล์บัญชี',        note: 'เอกสารอ้างเลขออเดอร์ที่ไม่มีในไฟล์คลัง' },
    { state: 'nokey',   label: 'บัญชียังไม่ใส่เลขออเดอร์', note: 'บรรทัดในไฟล์บัญชีที่ไม่มีทั้งเลขออเดอร์และเลขคำสั่งซื้อออนไลน์' },
    { state: 'ok',      label: 'ตรงกัน',                 note: 'ได้เลขเอกสาร และชิ้นต่อ SKU เท่ากัน' },
  ];

  /* ── อ่านไฟล์ ──────────────────────────────────────────────────────────── */

  function norm(h) { return String(h === null || h === undefined ? '' : h).replace(/\s+/g, '').toUpperCase(); }

  /** ค่าในช่องเป็นข้อความ ตัวเลขจำนวนเต็มไม่มีจุดทศนิยมหรือ e+ (ต่ำกว่า 1e21 String ให้ครบทุกหลัก) */
  function text(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return ymd(v);
    return String(v).trim();
  }

  /** ตัวที่ใช้เทียบเลขออเดอร์ ไม่สนตัวพิมพ์และช่องว่าง */
  function key(v) { return text(v).replace(/\s+/g, '').toUpperCase(); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * วันที่ → yyyy-mm-dd รับได้ทั้งวันที่จริง เลขวันที่ของ Excel และข้อความ วัน/เดือน/ปี หรือ ปี-เดือน-วัน
   * ปี พ.ศ. แปลงเป็น ค.ศ. อ่านไม่ออกได้ค่าว่าง
   */
  function ymd(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return '';
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    var s = String(v).trim().replace(/\s+\d{1,2}:\d{2}.*$/, '');
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    var y, mo, da;
    if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; } else {
      m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
      if (!m) return '';
      da = +m[1]; mo = +m[2]; y = +m[3];
      if (y < 100) y += 2000;
    }
    if (y >= 2400) y -= 543;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
    return y + '-' + pad(mo) + '-' + pad(da);
  }

  function num(v) {
    if (typeof v === 'number') return v;
    var n = Number(String(v === null || v === undefined ? '' : v).replace(/,/g, '').trim());
    return isNaN(n) ? NaN : n;
  }

  function colsOf(head, spec) {
    var idx = {};
    (head || []).forEach(function (h, i) { var k = norm(h); if (k && !(k in idx)) idx[k] = i; });
    var at = {};
    Object.keys(spec).forEach(function (f) {
      for (var j = 0; j < spec[f].length; j++) {
        var k = norm(spec[f][j]);
        if (k in idx) { at[f] = idx[k]; break; }
      }
    });
    return at;
  }

  function has(at, list) { return list.every(function (f) { return f in at; }); }

  /**
   * แท็บนี้เป็นฝั่งไหน หาแถวหัวตารางในสิบห้าแถวแรก
   * ฝั่งบัญชีมีเลขที่เอกสารกับรหัสสินค้า ฝั่งคลังมี SKU และมักมี LOT กับ PO
   * แท็บที่มีทั้งเลขที่เอกสารและ LOT/PO (เช่นไฟล์ที่หน้านี้ส่งออกเอง) นับเป็นฝั่งคลัง
   * @returns {{kind:'stock'|'acc', head:number, cols:Object}|{kind:'', missing:string[]}}
   *   missing คือชื่อช่องที่ขาด ถ้าดูแล้วน่าจะเป็นฝั่งหนึ่งแต่หัวตารางไม่ครบ
   */
  function detect(rows) {
    var best = { kind: '', missing: [] };
    for (var r = 0; r < Math.min(rows.length, HEAD_SCAN); r++) {
      var a = colsOf(rows[r], ACC_COLS), s = colsOf(rows[r], STOCK_COLS);
      var hasKey = 'order' in a || 'online' in a || 'pre' in a;
      if (has(s, STOCK_NEED) && ('lot' in s || 'po' in s || !('doc' in a))) return { kind: 'stock', head: r, cols: s };
      if (has(a, ACC_NEED) && hasKey) return { kind: 'acc', head: r, cols: a };
      if (best.missing.length) continue;
      if ('doc' in a) {
        best.missing = ACC_NEED.filter(function (f) { return !(f in a); }).map(function (f) { return ACC_COLS[f][0]; });
        if (!hasKey) best.missing.push(ACC_COLS.order[0] + ' หรือ ' + ACC_COLS.online[0]);
      } else if ('lot' in s || 'po' in s || 'sku' in s) {
        best.missing = STOCK_NEED.filter(function (f) { return !(f in s); }).map(function (f) { return STOCK_COLS[f][0]; });
      }
    }
    return best;
  }

  /**
   * เลขที่ Excel เก็บเป็นตัวเลขยาวเกิน 15 หลัก ทศนิยมกินหลักท้ายไปแล้ว หรือเป็นข้อความ 1.23E+17
   * จับคู่ผิดได้เงียบ ๆ จึงนับไว้เตือน (แก้ที่ต้นทาง: จัดรูปแบบช่องเป็นข้อความก่อนวางเลข)
   */
  function lossy(v) {
    if (typeof v === 'number') return Math.abs(v) > 9007199254740991;
    return /^\d+(\.\d+)?E\+\d+$/i.test(String(v === null || v === undefined ? '' : v).trim());
  }

  /**
   * แถวของแท็บ (อาร์เรย์ของแถว แถวละอาร์เรย์ของช่อง) → บรรทัดที่ใช้ต่อ
   * row คือเลขแถวในไฟล์ (แถวแรก = 1) จำนวนที่ไม่ใช่ตัวเลขนับเป็น 0 แล้วบอกจำนวนแถวไว้
   * ฝั่งคลังแถวที่ไม่มีทั้งเลขออเดอร์และเลขออนไลน์จับคู่อะไรไม่ได้ ข้ามแล้วนับไว้ใน noId
   * lossy นับบรรทัดที่เลขยาวเสียหลักไปแล้ว แยกตามชื่อช่อง
   * @returns {{kind:string, lines:Object[], bad:number, lossy:Object<string,number>, noId:number}}
   */
  function read(rows, det) {
    var c = det.cols;
    function at(row, f) { return f in c ? row[c[f]] : ''; }
    var lines = [], bad = 0, loss = {}, noId = 0;
    var spec = det.kind === 'stock' ? STOCK_COLS : ACC_COLS;
    for (var r = det.head + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var q = num(at(row, 'qty'));
      var line;
      if (det.kind === 'stock') {
        line = {
          row: r + 1, date: ymd(at(row, 'date')), sys: text(at(row, 'sys')), pre: text(at(row, 'pre')),
          order: text(at(row, 'order')), online: text(at(row, 'online')), carrier: text(at(row, 'carrier')),
          sku: text(at(row, 'sku')), sold: text(at(row, 'sold')), name: text(at(row, 'name')),
          lot: text(at(row, 'lot')), po: text(at(row, 'po')), qty: isNaN(q) ? 0 : q,
        };
        if (!line.order && !line.sku) continue;   // แถวว่างหรือแถวรวมท้ายตาราง
        if (!line.order && !line.online) { noId++; continue; }
      } else {
        line = {
          row: r + 1, order: text(at(row, 'order')), pre: text(at(row, 'pre')), online: text(at(row, 'online')),
          doc: text(at(row, 'doc')), docDate: ymd(at(row, 'docDate')), due: ymd(at(row, 'due')), ref: text(at(row, 'ref')),
          code: text(at(row, 'code')), name: text(at(row, 'name')), qty: isNaN(q) ? 0 : q,
        };
        if (!line.doc && !line.code) continue;
      }
      if (isNaN(q)) bad++;
      ['order', 'online', 'pre'].forEach(function (f) { if (lossy(at(row, f))) add(loss, spec[f][0], 1); });
      lines.push(line);
    }
    return { kind: det.kind, lines: lines, bad: bad, lossy: loss, noId: noId };
  }

  /** ช่วงวันที่ของบรรทัด */
  function span(lines, f) {
    var min = '', max = '';
    lines.forEach(function (l) {
      var d = l[f];
      if (!d) return;
      if (!min || d < min) min = d;
      if (d > max) max = d;
    });
    return { min: min, max: max };
  }

  /** สรุปของแต่ละฝั่งไว้โชว์ใต้ชื่อไฟล์ */
  function describe(src) {
    var orders = {};
    src.lines.forEach(function (l) { var k = key(l.order) || key(l.online); if (k) orders[k] = 1; });
    var out = { lines: src.lines.length, orders: Object.keys(orders).length, bad: src.bad, lossy: src.lossy || {}, noId: src.noId || 0 };
    if (src.kind === 'stock') out.span = span(src.lines, 'date');
    else {
      out.span = span(src.lines, 'docDate');
      var docs = {};
      src.lines.forEach(function (l) { if (l.doc) docs[key(l.doc)] = 1; });
      out.docs = Object.keys(docs).length;
      out.noKey = src.lines.filter(function (l) { return !key(l.order) && !key(l.online); }).length;
    }
    return out;
  }

  /* ── จับคู่ ────────────────────────────────────────────────────────────── */

  function add(map, k, v) { map[k] = (map[k] || 0) + v; }
  function clean(n) { return Math.round(n * 1000) / 1000; }

  /**
   * จับคู่ทีละออเดอร์ฝั่งคลัง
   *   1. เลขออเดอร์ตรงกับเลขออเดอร์ในไฟล์บัญชี
   *   2. เลขออเดอร์ก่อนแยกบิลตรงกับเลขออเดอร์ในไฟล์บัญชี (บัญชีออกเอกสารใบเดียวก่อนแยกบิล)
   *   3. เลขคำสั่งซื้อออนไลน์ตรงกัน
   * ออเดอร์ฝั่งบัญชีหนึ่งเลขอาจมีหลายออเดอร์ฝั่งคลังมาจับคู่ (กรณีแยกบิล) จึงเทียบจำนวนรวมกันทั้งกลุ่ม
   *
   * เทียบชิ้นต่อ SKU: ฝั่งคลังใช้ SKU ที่ขายถ้ามี (บรรทัดที่แปลงคืนเป็น SKU ตอนซื้อ) เพราะเอกสารออกตาม SKU ที่ขาย
   * รหัสในเอกสารที่ไม่มีในไฟล์คลังเลยสักบรรทัด เช่น ค่าส่ง ไม่นำมาเทียบ แต่แสดงไว้ในรายละเอียด
   *
   * @returns {{orders:Object[], bills:Object[], acconly:Object[], nokey:Object[], counts:Object, accSpan:Object, stockSpan:Object}}
   */
  function match(stock, acc) {
    var sLines = stock.lines || stock, aLines = acc.lines || acc;
    var universe = {};
    sLines.forEach(function (l) { universe[key(l.sold || l.sku)] = 1; universe[key(l.sku)] = 1; });

    /* บิลฝั่งบัญชี: จับกลุ่มตามเลขออเดอร์ บรรทัดที่มีแต่เลขออนไลน์ไปรวมกับบิลที่มีเลขออนไลน์เดียวกัน
       (รอบแรกเอาบรรทัดที่มีเลขออเดอร์ก่อน ลำดับในไฟล์จึงไม่มีผล) ไม่มีทั้งคู่จับกลุ่มตามเลขเอกสาร */
    var bills = {}, byOrder = {}, byOnline = {}, nokeyDocs = {}, list = [];
    function put(b, l) {
      var kn = key(l.online);
      if (!b.online && l.online) b.online = l.online;
      if (kn && !byOnline[kn]) byOnline[kn] = b;
      if (l.doc && b.docs.indexOf(l.doc) === -1) b.docs.push(l.doc);
      if (l.docDate && (!b.docDate || l.docDate < b.docDate)) b.docDate = l.docDate;
      b.lines.push(l);
      b.qty += l.qty;
    }
    function bill(id, l) {
      var b = bills[id];
      if (!b) {
        b = bills[id] = { id: id, order: l.order, online: l.online, pre: l.pre, docs: [], docDate: '', lines: [], stock: [], qty: 0 };
        list.push(b);
      }
      return b;
    }
    aLines.forEach(function (l) {
      var ko = key(l.order);
      if (!ko) return;
      put(byOrder[ko] = bill('O:' + ko, l), l);
    });
    aLines.forEach(function (l) {
      if (key(l.order)) return;
      var kn = key(l.online);
      if (kn) { put(byOnline[kn] || bill('N:' + kn, l), l); return; }
      var kd = key(l.doc);
      var n = nokeyDocs[kd] || (nokeyDocs[kd] = { state: 'nokey', doc: l.doc, docDate: l.docDate, lines: [], qty: 0 });
      n.lines.push(l);
      n.qty += l.qty;
    });

    /* ออเดอร์ฝั่งคลัง */
    var orders = [], seen = {};
    sLines.forEach(function (l) {
      var k = key(l.order) || ('N:' + key(l.online));
      var o = seen[k];
      if (!o) {
        o = seen[k] = { order: l.order, online: l.online, pre: l.pre, date: l.date, sys: l.sys, carrier: l.carrier, lines: [], qty: 0 };
        orders.push(o);
      }
      if (!o.online && l.online) o.online = l.online;
      if (!o.pre && l.pre) o.pre = l.pre;
      if (l.date && (!o.date || l.date < o.date)) o.date = l.date;
      o.lines.push(l);
      o.qty += l.qty;
    });

    var accSpan = span(aLines, 'docDate');
    orders.forEach(function (o) {
      var b = null, how = '';
      if (key(o.order) && byOrder[key(o.order)]) { b = byOrder[key(o.order)]; how = 'order'; }
      else if (key(o.pre) && byOrder[key(o.pre)]) { b = byOrder[key(o.pre)]; how = 'pre'; }
      else if (key(o.online) && byOnline[key(o.online)]) { b = byOnline[key(o.online)]; how = 'online'; }
      o.how = how;
      o.bill = b;
      if (b) b.stock.push(o);
      /* ออเดอร์ที่วันที่เลยเอกสารใบสุดท้ายในไฟล์บัญชี น่าจะแค่ยังไม่ถึงรอบ ไม่ใช่ตกหล่น */
      o.later = !b && !!accSpan.max && !!o.date && o.date > accSpan.max;
    });

    /* รหัสในไฟล์บัญชีที่ไม่มีในไฟล์คลังเลย (ค่าส่ง ค่าบริการ ฯลฯ) ไม่นำมาเทียบ แต่รวมไว้ให้เห็นว่ามีอะไรถูกข้ามบ้าง */
    var extraCodes = {};
    aLines.forEach(function (l) {
      var k = key(l.code);
      if (!k || universe[k]) return;
      var e = extraCodes[k] || (extraCodes[k] = { code: l.code, name: l.name, lines: 0, qty: 0 });
      e.lines++;
      e.qty += l.qty;
    });

    function diffsOf(s, a, names) {
      var out = [];
      Object.keys(names).forEach(function (k) {
        var x = clean(s[k] || 0), y = clean(a[k] || 0);
        if (x !== y) out.push({ sku: names[k].sku, name: names[k].name, stock: x, acc: y });
      });
      return out.sort(function (p, q) { return Math.abs(q.stock - q.acc) - Math.abs(p.stock - p.acc) || String(p.sku).localeCompare(String(q.sku)); });
    }

    list.forEach(function (b) {
      b.extra = [];
      b.diffs = [];
      b.main = '';
      if (!b.stock.length) { b.state = 'acconly'; return; }
      var s = {}, a = {}, byDoc = {}, names = {};
      b.stock.forEach(function (o) {
        o.lines.forEach(function (l) {
          var k = key(l.sold || l.sku);
          add(s, k, l.qty);
          names[k] = names[k] || { sku: l.sold || l.sku, name: l.name };
        });
      });
      b.lines.forEach(function (l) {
        var k = key(l.code);
        if (!universe[k]) { b.extra.push(l); return; }
        add(a, k, l.qty);
        add(byDoc[l.doc] || (byDoc[l.doc] = {}), k, l.qty);
        names[k] = names[k] || { sku: l.code, name: l.name };
      });
      b.diffs = diffsOf(s, a, names);
      /* ออเดอร์ที่มีหลายเอกสาร (เช่นใบลดหนี้ที่อ้างเลขออเดอร์เดิม) รวมกันแล้วไม่ตรง
         ถ้ามีเอกสารใบเดียวที่ตรงพอดี ถือว่าใบนั้นคือ Invoice ของออเดอร์ ใบอื่นบอกไว้ในหมายเหตุ */
      if (b.diffs.length && b.docs.length > 1) {
        var hit = b.docs.filter(function (d) { return byDoc[d] && !diffsOf(s, byDoc[d], names).length; });
        if (hit.length === 1) { b.main = hit[0]; b.diffs = []; }
      }
      b.state = b.diffs.length ? 'diff' : 'ok';
    });

    orders.forEach(function (o) { o.state = o.bill ? o.bill.state : 'none'; });
    var acconly = list.filter(function (b) { return b.state === 'acconly'; });
    var nokey = Object.keys(nokeyDocs).map(function (k) { return nokeyDocs[k]; });

    var counts = { ok: 0, diff: 0, none: 0, later: 0, acconly: acconly.length, nokey: nokey.length, nokeyLines: 0, many: 0, orders: orders.length, matched: 0 };
    orders.forEach(function (o) {
      counts[o.state]++;
      if (o.bill) counts.matched++;
      if (o.later) counts.later++;
      if (o.bill && o.bill.docs.length > 1 && !o.bill.main) counts.many++;
    });
    nokey.forEach(function (n) { counts.nokeyLines += n.lines.length; });
    var extra = Object.keys(extraCodes).map(function (k) { return extraCodes[k]; })
      .sort(function (p, q) { return q.lines - p.lines || String(p.code).localeCompare(String(q.code)); });
    return { orders: orders, bills: list, acconly: acconly, nokey: nokey, counts: counts, extraCodes: extra,
      accSpan: accSpan, stockSpan: span(sLines, 'date') };
  }

  /** เลขเอกสารที่ใช้แทนออเดอร์นี้ ถ้ามีหลายใบแต่ใบเดียวตรง ใช้ใบนั้น */
  function docOf(b) { return b ? b.main || b.docs.join(', ') : ''; }

  /** เหตุที่ควรรู้ของออเดอร์ที่จับคู่แล้ว เขียนสั้นพอใส่ช่องหมายเหตุ */
  function noteOf(o, last) {
    var b = o.bill;
    if (!b) return o.later ? 'วันที่หลังเอกสารใบสุดท้ายในไฟล์บัญชี (' + last + ') น่าจะยังไม่ถึงรอบ' : '';
    var out = [];
    if (b.main) out.push('ใช้เอกสารใบที่จำนวนตรง ยังมีใบอื่นอ้างออเดอร์นี้: ' + b.docs.filter(function (d) { return d !== b.main; }).join(', '));
    else if (b.docs.length > 1) out.push('มี ' + b.docs.length + ' เอกสารอ้างออเดอร์นี้');
    if (b.stock.length > 1) out.push('เอกสารนี้รวม ' + b.stock.length + ' ออเดอร์ (แยกบิล)');
    if (b.extra.length) out.push('ไม่นับรหัสที่ไม่มีในไฟล์คลัง ' + b.extra.length + ' บรรทัด');
    return out.join(' · ');
  }

  /* ── รายการบนหน้าเว็บ ──────────────────────────────────────────────────── */

  /**
   * รายการเดียวที่หน้าเว็บวาด ทั้งออเดอร์ฝั่งคลัง บิลที่มีแต่ในบัญชี และเอกสารที่ไม่มีเลขออเดอร์
   * เรียงตาม STATES แล้วตามวันที่ เรื่องที่ต้องตามต่อขึ้นก่อน
   */
  function items(res) {
    var out = [], last = dmy(res.accSpan.max);
    res.orders.forEach(function (o) {
      var b = o.bill;
      out.push({
        state: o.state, order: o.order, online: o.online, pre: o.pre, date: o.date, how: o.how, later: o.later,
        doc: docOf(b), docs: b ? b.docs : [], docDate: b ? b.docDate : '', stockQty: clean(o.qty), accQty: b ? clean(b.qty) : 0,
        diffs: b ? b.diffs : [], extra: b ? b.extra : [], group: b ? b.stock.length : 0, note: noteOf(o, last),
        stock: o.lines, acc: b ? b.lines : [],
      });
    });
    res.acconly.forEach(function (b) {
      out.push({ state: 'acconly', order: b.order, online: b.online, pre: b.pre, date: '', how: '', later: false,
        doc: docOf(b), docs: b.docs, docDate: b.docDate, stockQty: 0, accQty: clean(b.qty), diffs: [], extra: [], group: 0, note: '',
        stock: [], acc: b.lines });
    });
    res.nokey.forEach(function (n) {
      out.push({ state: 'nokey', order: '', online: '', pre: '', date: '', how: '', later: false,
        doc: n.doc, docs: n.doc ? [n.doc] : [], docDate: n.docDate, stockQty: 0, accQty: clean(n.qty), diffs: [], extra: [], group: 0, note: '',
        stock: [], acc: n.lines });
    });
    var rank = {};
    STATES.forEach(function (s, i) { rank[s.state] = i; });
    out.sort(function (a, b) {
      return rank[a.state] - rank[b.state] || String(a.date || a.docDate).localeCompare(String(b.date || b.docDate)) ||
        String(a.order).localeCompare(String(b.order));
    });
    return out;
  }

  /** ค้นด้วยเลขออเดอร์ เลขออนไลน์ เลขเอกสาร หรือรหัสสินค้า */
  function filter(list, opts) {
    var only = opts.only || '', want = key(opts.q || '');
    return list.filter(function (i) {
      if (only === 'later' ? !i.later : only && i.state !== only) return false;
      if (!want) return true;
      if ([i.order, i.online, i.pre].concat(i.docs).some(function (v) { return key(v).indexOf(want) !== -1; })) return true;
      return i.stock.some(function (l) { return key(l.sku) === want || key(l.sold) === want; }) ||
        i.acc.some(function (l) { return key(l.code) === want; });
    });
  }

  /* ── ส่งออก ────────────────────────────────────────────────────────────── */

  /** yyyy-mm-dd → dd/mm/yyyy แบบที่ทีมกรอกในไฟล์ */
  function dmy(d) {
    var p = String(d || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }

  var RESULT = { ok: 'ตรง', diff: 'จำนวนไม่ตรง', none: 'ยังไม่มี Invoice' };

  var LINE_HEAD = ['วันที่', 'ระบบ', 'เลขออเดอร์ก่อนแยกบิล', 'เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'บริษัทขนส่ง', 'SKU', 'SKU ที่ขาย',
    'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'เลขที่เอกสาร', 'วันที่เอกสาร', 'จับคู่ด้วย', 'ผลเทียบจำนวน', 'หมายเหตุ'];

  /** ทุกบรรทัดฝั่งคลังตามลำดับในไฟล์ ต่อท้ายด้วยเลขที่เอกสาร ใช้ส่งบัญชีได้ทันที */
  function lineTable(res) {
    var rows = [LINE_HEAD], last = dmy(res.accSpan.max);
    var all = [];
    res.orders.forEach(function (o) { var n = noteOf(o, last); o.lines.forEach(function (l) { all.push([l, o, n]); }); });
    all.sort(function (a, b) { return a[0].row - b[0].row; });
    all.forEach(function (x) {
      var l = x[0], o = x[1], b = o.bill;
      rows.push([dmy(l.date), l.sys, l.pre, l.order, l.online, l.carrier, l.sku, l.sold, l.name, l.lot, l.po, l.qty,
        docOf(b), b ? dmy(b.docDate) : '', HOW[o.how] || '', RESULT[o.state], x[2]]);
    });
    return rows;
  }

  var DIFF_HEAD = ['เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'เลขที่เอกสาร', 'SKU', 'ชื่อสินค้า', 'จำนวนฝั่งคลัง', 'จำนวนฝั่งบัญชี', 'ต่าง (คลัง − บัญชี)'];

  /** หนึ่งบรรทัดต่อ SKU ที่ไม่ตรงของแต่ละบิล ออเดอร์ที่แยกบิลเขียนรวมกันในช่องเดียว */
  function diffTable(res) {
    var rows = [DIFF_HEAD];
    res.bills.forEach(function (b) {
      if (b.state !== 'diff') return;
      var orders = b.stock.map(function (o) { return o.order; }).join(', ');
      var online = b.stock.map(function (o) { return o.online; }).filter(Boolean).join(', ');
      b.diffs.forEach(function (d) {
        rows.push([orders, online, docOf(b), d.sku, d.name, d.stock, d.acc, clean(d.stock - d.acc)]);
      });
    });
    return rows;
  }

  var NONE_HEAD = ['วันที่', 'เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'เลขออเดอร์ก่อนแยกบิล', 'ระบบ', 'บริษัทขนส่ง', 'จำนวนชิ้น', 'หมายเหตุ'];

  function noneTable(res) {
    var rows = [NONE_HEAD];
    var last = dmy(res.accSpan.max);
    res.orders.forEach(function (o) {
      if (o.state !== 'none') return;
      rows.push([dmy(o.date), o.order, o.online, o.pre, o.sys, o.carrier, clean(o.qty),
        noteOf(o, last)]);
    });
    return rows;
  }

  var ACC_HEAD = ['เลขออเดอร์', 'คำสั่งซื้อออนไลน์', 'เลขที่เอกสาร', 'วันที่เอกสาร', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'หมายเหตุ', 'แถวในไฟล์บัญชี'];

  /** บรรทัดฝั่งบัญชีที่หาออเดอร์ฝั่งคลังไม่เจอ กับบรรทัดที่ไม่มีเลขออเดอร์ */
  function accTable(res) {
    var rows = [ACC_HEAD];
    res.acconly.forEach(function (b) {
      b.lines.forEach(function (l) {
        rows.push([l.order, l.online, l.doc, dmy(l.docDate), l.code, l.name, l.qty, 'ไม่พบออเดอร์นี้ในไฟล์คลัง', l.row]);
      });
    });
    res.nokey.forEach(function (n) {
      n.lines.forEach(function (l) {
        rows.push([l.order, l.online, l.doc, dmy(l.docDate), l.code, l.name, l.qty, 'บัญชียังไม่ใส่เลขออเดอร์', l.row]);
      });
    });
    return rows;
  }

  var LABEL = {};
  STATES.forEach(function (s) { LABEL[s.state] = s.label; });

  var ITEM_HEAD = ['ผล', 'เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'วันที่', 'เลขที่เอกสาร', 'วันที่เอกสาร', 'จับคู่ด้วย',
    'ชิ้นฝั่งคลัง', 'ชิ้นฝั่งบัญชี', 'SKU ที่ไม่ตรง', 'หมายเหตุ'];

  /** รายการบนหน้าเว็บตามตัวกรอง หนึ่งบรรทัดต่อออเดอร์หรือเอกสาร ใช้กับปุ่มคัดลอก */
  function itemTable(list) {
    var rows = [ITEM_HEAD];
    list.forEach(function (i) {
      rows.push([LABEL[i.state], i.order, i.online, dmy(i.date), i.doc, dmy(i.docDate), HOW[i.how] || '',
        i.stockQty, i.accQty,
        i.diffs.map(function (d) { return d.sku + ' คลัง ' + d.stock + ' บัญชี ' + d.acc; }).join(' · '), i.note]);
    });
    return rows;
  }

  /** ตาราง → ข้อความคั่นด้วยแท็บ วางใน Excel หรือ Google Sheets ได้ตรงช่อง */
  function tsv(rows) {
    return rows.map(function (r) {
      return r.map(function (v) { return String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' '); }).join('\t');
    }).join('\n');
  }

  window.WmsInvMatch = {
    STOCK_COLS: STOCK_COLS,
    ACC_COLS: ACC_COLS,
    STATES: STATES,
    HOW: HOW,
    LINE_HEAD: LINE_HEAD,
    norm: norm,
    key: key,
    ymd: ymd,
    dmy: dmy,
    detect: detect,
    read: read,
    describe: describe,
    match: match,
    items: items,
    filter: filter,
    lineTable: lineTable,
    diffTable: diffTable,
    noneTable: noneTable,
    accTable: accTable,
    itemTable: itemTable,
    tsv: tsv,
  };
})();
