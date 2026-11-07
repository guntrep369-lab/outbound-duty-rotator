/**
 * tx-api.gs — อ่านชีต Transaction แล้วคิดยอดคงเหลือราย SKU / LOT / PO / Location
 *
 * ใช้กับหน้าสต๊อกราย Location (public/stock-location) — ใส่ URL ในหน้าตั้งค่า
 * ช่อง "Apps Script URL — Transaction" วิธีติดตั้งอยู่ใน README หัวข้อ
 * "Stock by Location"
 *
 * ผูกกับไฟล์ Google Sheet ที่มีชีต Transaction และไม่เขียนอะไรลงสมุดรายการเลย สมุดรายการ
 * เป็นของที่ทีมกรอกด้วยมือทุกวัน สคริปต์ที่แก้มันได้คือความเสี่ยงที่ไม่จำเป็น
 * ถ้าโค้ดนี้มีจุดผิด อย่างมากตัวเลขบนหน้าเว็บจะผิด สมุดรายการยังอยู่ครบเหมือนเดิม
 *
 * ที่เขียนมีแห่งเดียวคือแท็บ "นับสต๊อก" ซึ่งสคริปต์สร้างเอง คำขอจากเว็บเติมได้แค่ช่องผลนับที่ยังว่าง
 * กับขอให้ออกรายการนับของ SKU ที่บอกมา โดย Location คิดจากสมุดรายการเองและมีเพดานต่อวัน
 * คนที่มี URL จึงเขียนแถวตามใจหรือแก้ผลนับเดิมไม่ได้
 *
 * ?api=tx-summary          ยอดคงเหลือทั้งคลัง ยอดขาย และจุดที่ข้อมูลผิด
 * ?api=tx-history&sku=...  ความเคลื่อนไหวของ SKU เดียว
 * ?api=tx-count            รายการนับของวันนี้ (ยังไม่มีก็ออกให้) และผลนับย้อนหลัง
 * ?api=tx-count&peek=1     ผลนับรวมรายเดือนแบบอ่านอย่างเดียว ให้หน้าภาพรวมสต๊อก ไม่ออกรายการของวันนี้
 * ?api=tx-daily&from=...&to=...  ยอดแถวขายราย SKU ราย วัน และแถวขายทีละแถว ให้หน้าเช็ครายการตัดสต๊อกเอาไปเทียบ
 *                                พร้อมคู่ SKU จากแท็บ "MASTER แปลงสินค้า" (ถ้ามี) ให้หน้า LOT / PO ที่ขายออก
 * ?api=tx-fifo             ทุกแถวของสมุดแบบย่อ ให้หน้า FIFO สต๊อกคิดยอดราย LOT และหาการเบิกข้าม LOT เอง
 *                          หน้าเช็ครายการตัดสต๊อกใช้ชุดเดียวกันบอกว่าทำไมชีตทีมไม่ได้ตัด (ปุ่มดูที่มา)
 *                          หน้า LOT / PO ที่ขายออกใช้ประมาณ LOT/PO ให้ของที่ลงไว้เป็น LOT 0 จากแถวรับคืนกับ M/E
 *                          และจากแท็บ "ยอดก่อนนับ" (ถ้ามี) ให้ของที่นับได้แต่ไม่รู้ LOT
 * ?api=shared-at           เวลาของข้อมูลกลางชุดล่าสุด (ดูส่วน "ข้อมูลกลาง" ท้ายไฟล์)
 * POST {op:'count-save'}   บันทึกผลนับ
 * POST {op:'count-add'}    ส่ง SKU ที่ยอดไม่ตรงระบบบริษัทเข้าใบนับ
 * POST {op:'shared-fresh'} คิดยอดใหม่แล้วเก็บเป็นข้อมูลกลาง (ปุ่มดึงใหม่บนหน้าเว็บ)
 * ไม่ใส่ api               บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าตั้งค่าเช็คว่าใส่ URL ถูกตัว
 *
 * ข้อมูลกลาง: ผลของ tx-summary tx-daily และ tx-fifo เก็บเป็นไฟล์ JSON ในโฟลเดอร์ "WMS ข้อมูลกลาง" ใน Drive
 * ของเจ้าของสคริปต์ ทุกเครื่องอ่านชุดเดียวกัน ไม่ได้เขียนลงไฟล์ชีต
 */

// ชื่อชีตสมุดรายการ — ว่างไว้ = หาเองจากหัวตาราง (คอลัมน์ F, G ขึ้นต้นด้วย Location เบิก / รับ)
var TX_SHEET = '';

var BACKUP_FOLDER = 'WMS Transaction Backup';
var BACKUP_KEEP = 30;       // เก็บสำเนาล่าสุดกี่ไฟล์ เก่ากว่านั้นย้ายลงถังขยะ (กู้คืนจากถังได้อีก 30 วัน)
var BACKUP_PREFIX = 'Backup ';

var COLS = 12;              // A..L อ่านตามตำแหน่ง เพราะหัวตารางมีคำว่า SKU ซ้ำสองช่อง
var SALE_DAYS = 14;         // ยอดขายเฉลี่ยคิดจากกี่วันล่าสุด
var LATE_DAYS = 14;         // วันที่ GR ห่างจากแถวขายรอบข้างเกินนี้ถือว่าน่าสงสัย
var RARE_ROWS = 10;         // ชื่อ Location แปลกที่ใช้ไม่เกินเท่านี้แถว น่าจะพิมพ์ผิด
var RACK = /^[A-Z]+\d{0,2}-\d{2}-\d{2}(-\d{2})?$/;
var HISTORY_MAX = 500;      // SKU ขายดีมีหลายพันแถว ส่งแค่ช่วงล่าสุดพอ
var ISSUE_ROWS = 6;         // เลขแถวที่แนบไปต่อหนึ่งรายการ
var ISSUE_MAX = 200;        // รายการต่อหนึ่งเรื่อง ถ้าเกินบอกจำนวนจริงแล้วส่งแค่ที่หนักสุด

// แท็บคู่ SKU ตอนซื้อ กับ SKU หลังแปลง (1 ต่อ 1) หน้า LOT / PO ใช้คืน SKU ที่ขายกลับเป็น SKU ตอนซื้อ สคริปต์อ่านอย่างเดียว
var CONVERT_SHEET = 'MASTER แปลงสินค้า';

// แท็บยอดก่อนวันนับสต๊อก ผู้ใช้วางเอง (สมุดรอบก่อนทั้งชีต หรือตาราง SKU LOT PO จำนวน) สคริปต์อ่านอย่างเดียว
// หน้า LOT / PO ใช้แบ่งของที่นับได้แต่ไม่รู้ LOT (LOT 0) ออกเป็น LOT/PO ประมาณ
var BEFORE_SHEET = 'ยอดก่อนนับ';

var COUNT_SHEET = 'นับสต๊อก';
var COUNT_PER_DAY = 20;     // รายการนับต่อวัน
var COUNT_RISK_MAX = 10;    // รายการนับซ้ำกับรายการเสี่ยงรวมกันไม่เกินเท่านี้ ที่เหลือเป็นรายการสุ่ม
var COUNT_REST_DAYS = 30;   // นับแล้วเว้นกี่วันก่อนถูกเลือกอีก
var COUNT_KEEP_DAYS = 30;   // ส่งผลนับย้อนหลังให้หน้าเว็บกี่วัน
var COUNT_HEAD = ['วันที่', 'ที่มา', 'เหตุผล', 'Location', 'SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'Lot', 'PO', 'นับได้', 'ยอดในระบบ', 'ต่าง', 'ผู้นับ', 'เวลานับ'];
var COUNT_TEXT_COLS = 9;    // A..I เก็บเป็นข้อความ
var COUNT_RESULT_COL = 10;  // J..N ว่างจนกว่าจะนับ
var COUNT_WHO_COL = 13;     // M, N เก็บเป็นข้อความเหมือนกัน
var COUNT_DIFF_SRC = 'เทียบระบบ';   // ที่มาของรายการที่ส่งจากแท็บเทียบสต๊อก
var COUNT_DIFF_ALL = 'ทุก';         // ช่อง Lot และ PO ของรายการพวกนี้ นับรวมทุก LOT ทุก PO ต่อ Location
var COUNT_ELSEWHERE = 'ที่อื่น';    // แถวเผื่อของที่ชีตไม่รู้ว่ามี ยอดของจริงต้องรวมส่วนนี้ด้วย
var COUNT_DIFF_MAX = 300;           // รายการเทียบระบบต่อวัน คนที่มี URL ส่งเพิ่มได้ จึงต้องมีเพดานกันชีตโต

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api === 'tx-summary') return out_(p.shared ? sharedRead_('tx-summary', null, summary_) : summary_());
    if (p.api === 'tx-history') return out_(history_(String(p.sku || '')));
    if (p.api === 'tx-count') return out_(p.peek ? countPeek_() : countLoad_());
    if (p.api === 'tx-daily') {
      var from = String(p.from || ''), to = String(p.to || '');
      if (!p.shared) return out_(daily_(from, to));
      return out_(sharedRead_('tx-daily', { from: from, to: to }, function () { return daily_(from, to); }));
    }
    if (p.api === 'tx-fifo') return out_(p.shared ? sharedRead_('tx-fifo', null, fifo_) : fifo_());
    if (p.api === 'shared-at') return out_(sharedAt_());
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
  return out_({ app: 'transaction' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.op === 'count-save') return out_(countSave_(req));
    if (req.op === 'count-add') return out_(countAdd_(req));
    if (req.op === 'shared-fresh') return out_(sharedPress_(req));
    return out_({ error: 'ไม่รู้จักคำสั่งนี้' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ── อ่านชีต ─────────────────────────────────────────────────────────────── */

function ledgerSheet_(ss) {
  if (TX_SHEET) {
    var named = ss.getSheetByName(TX_SHEET);
    if (!named) throw new Error('ไม่พบชีตชื่อ ' + TX_SHEET);
    return named;
  }
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getLastRow() < 1 || all[i].getLastColumn() < 7) continue;
    var h = all[i].getRange(1, 6, 1, 2).getValues()[0];
    if (!/^location\s*เบิก/i.test(String(h[0]).trim()) || !/^location\s*รับ/i.test(String(h[1]).trim())) continue;
    /* แท็บยอดก่อนนับที่วางสมุดรอบก่อนมีหัวตารางแบบเดียวกัน ถ้าถูกลากไปไว้หน้าแท็บสมุด ทุกหน้าจะอ่านสมุดเก่าแทน */
    if (all[i].getName() === BEFORE_SHEET) continue;
    return all[i];
  }
  throw new Error('ไม่พบชีต Transaction — คอลัมน์ F, G ต้องเป็น Location เบิก และ Location รับ หรือใส่ชื่อชีตใน TX_SHEET');
}

/** แปลงแถวดิบเป็นรูปที่ใช้ต่อ เลขแถวนับแบบชีต (แถวข้อมูลแรก = 2) แถวว่างทั้งแถวถูกข้าม */
function readRows_(sheet, tz) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  var raw = sheet.getRange(2, 1, n, COLS).getValues();
  var rows = [];
  var near = '';   // วันที่ล่าสุดที่เห็น ใช้กับแถวที่ไม่มีวันที่ของตัวเอง
  for (var i = 0; i < raw.length; i++) {
    var c = raw[i];
    if (c.every(function (v) { return v === '' || v === null; })) continue;
    var own = ownDate_(c[9], tz);
    if (own) near = own;
    rows.push({
      row: i + 2,
      sku: text_(c[0]), long: text_(c[1]), name: text_(c[2]),
      lot: c[3] === '' ? '' : c[3],
      po: text_(c[4]),
      from: text_(c[5]), to: text_(c[6]),
      /* SUMIFS บวกเฉพาะช่องที่เป็นตัวเลข ตัวเลขที่พิมพ์เป็นข้อความจึงไม่ถูกนับ ต้องให้ตรงกับชีตยอด */
      qty: typeof c[7] === 'number' ? c[7] : 0,
      badQty: typeof c[7] === 'number' ? null : String(c[7]),
      type: text_(c[8]),
      note: plainDate_(c[9], tz) ? '' : text_(c[9]),
      date: own,
      near: near,
      open: text_(c[10]) === 'เปิด',
      who: text_(c[11]),
    });
  }
  return rows;
}

function text_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** เทียบแบบเดียวกับ SUMIFS ที่ไม่สนตัวพิมพ์เล็กใหญ่ */
function same_(v) { return String(v).trim().toUpperCase(); }

/**
 * วันที่ของแถวเอง: แถวขายมีในช่อง Note ส่วนแถวรับของพิมพ์ไว้แบบ GR dd-mm-yy
 * ที่เหลือ (RETURN, โอนย้าย, Stock Count) ไม่มีวันที่
 */
function ownDate_(note, tz) {
  var plain = plainDate_(note, tz);
  if (plain) return plain;
  var m = /^GR\s*(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(text_(note));
  return m ? ymd_(m[3], m[2], m[1]) : '';
}

/**
 * ช่องที่มีแต่วันที่ล้วน ๆ ในชีตอาจเป็นวันที่จริงหรือข้อความก็ได้ ขึ้นกับการตั้งค่าของไฟล์ จึงต้องอ่านได้ทั้งคู่
 * ข้อความอ่านแบบ วัน/เดือน/ปี ตามที่ทีมกรอก จะสลับเป็น เดือน/วัน/ปี ก็ต่อเมื่อช่องเดือนเกิน 12
 */
function plainDate_(v, tz) {
  if (v && typeof v.getTime === 'function') {
    if (isNaN(v.getTime())) return '';
    var p = Utilities.formatDate(v, tz, 'yyyy-MM-dd').split('-');
    return ymd_(p[0], p[1], p[2]);
  }
  var s = text_(v).replace(/\s+\d{1,2}:\d{2}.*$/, '');
  var m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
  if (m) return ymd_(m[1], m[2], m[3]);
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(s);
  if (!m) return '';
  return +m[2] > 12 ? ymd_(m[3], m[1], m[2]) : ymd_(m[3], m[2], m[1]);
}

/** ปี พ.ศ. แปลงเป็น ค.ศ. ทั้งแบบเต็ม (2569) และแบบย่อ (69) ค่าที่เป็นวันที่ไม่ได้จะได้ค่าว่าง */
function ymd_(y, m, d) {
  y = +y;
  if (y < 100) y += y >= 60 ? 1957 : 2000;
  else if (y >= 2400) y -= 543;
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return '';
  return y + '-' + pad_(+m) + '-' + pad_(+d);
}

function pad_(v) { return ('0' + v).slice(-2); }

function dayNo_(ymd) {
  var p = ymd.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
}

/* ── คิดยอด ─────────────────────────────────────────────────────────────── */

/**
 * กติกาเดียวกับชีตยอดของทีม
 *   เข้า = แถวที่มี Location รับ ไม่ดูประเภท
 *   ออก  = แถวที่มี Location เบิก และประเภทเป็น เบิก หรือ ขาย
 *   คีย์ = SKU คอลัมน์ B + LOT + PO + Location
 *
 * ต่างจากชีตยอดข้อเดียวโดยตั้งใจ คือไม่เอา Status มาแยกยอด สูตรในชีตแยกแถวเข้าตาม
 * Status แต่ไม่แยกแถวออก จุดที่เคยรับทั้งแบบว่างและแบบเปิดจึงหักซ้ำ (ดู issues_)
 * Status ใช้บอกว่าโลนี้เปิดขายไหม โดยยึดแถวเข้าล่าสุด
 */
function balances_(rows) {
  var keys = {};
  function at(r, loc) {
    var k = keyOf_(r.long, r.lot, r.po, loc);
    return keys[k] || (keys[k] = {
      long: r.long, sku: r.sku, lot: r.lot, po: r.po, loc: loc,
      inBlank: 0, inOpen: 0, out: 0, inRows: [], outRows: [], open: false,
    });
  }
  rows.forEach(function (r) {
    if (!r.long) return;                  // SUMIFS ใช้ B เป็นคีย์ แถวที่ B ว่างจึงไม่ถูกนับ
    if (r.to) {
      var a = at(r, r.to);
      if (r.open) a.inOpen += r.qty; else a.inBlank += r.qty;
      a.open = r.open;
      a.inRows.push(r.row);
    }
    if (r.from && (r.type === 'เบิก' || r.type === 'ขาย')) {
      var b = at(r, r.from);
      b.out += r.qty;
      b.outRows.push(r.row);
    }
  });
  return Object.keys(keys).map(function (k) {
    var x = keys[k];
    x.bal = x.inBlank + x.inOpen - x.out;
    return x;
  });
}

/**
 * ยอดขายรายรหัสในช่วงล่าสุด นับจากวันที่ขายล่าสุดในชีต ไม่ใช่วันนี้ ชีตอาจยังกรอกไม่ถึงวันนี้
 * วันที่เลยวันนี้ไปคือพิมพ์ปีผิด ถ้าเอามานับ ช่วงจะเลื่อนหนีแถวจริงทั้งหมดและรายการต้องเติมจะว่างเปล่า
 */
function sales_(rows, today) {
  var first = '', last = '';
  rows.forEach(function (r) {
    if (r.type !== 'ขาย' || !r.date || r.date > today) return;
    if (!first || r.date < first) first = r.date;
    if (r.date > last) last = r.date;
  });
  var out = { first: first, last: last, days: 0, bySku: {} };
  if (!last) return out;
  var end = dayNo_(last);
  /* ชีตที่เพิ่งเริ่มใหม่หลังนับสต๊อกอาจมีไม่ถึง 14 วัน หารด้วย 14 จะได้ยอดต่ำกว่าจริง */
  out.days = Math.min(SALE_DAYS, end - dayNo_(first) + 1);
  rows.forEach(function (r) {
    if (r.type !== 'ขาย' || !r.date || !r.long || r.date > today) return;
    if (end - dayNo_(r.date) >= out.days) return;
    var k = same_(r.long);
    out.bySku[k] = (out.bySku[k] || 0) + r.qty;
  });
  return out;
}

/* ── จุดที่ข้อมูลผิด ─────────────────────────────────────────────────────── */

function merge_(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }

/** เลขแถวที่แนบไปกับรายการ แถวเยอะก็ส่งแค่ช่วงต้น พร้อมจำนวนจริง */
function someRows_(list) { return { rows: list.slice(0, ISSUE_ROWS), rowCount: list.length }; }

function keyOf_(long, lot, po, loc) { return [same_(long), same_(lot), same_(po), same_(loc)].join('|'); }

function special_(loc) { return /^(QA|IQA|RIB)$/.test(same_(loc)); }

/** แถวขายจากจุดที่ตอนนั้นไม่ได้เปิดขาย หรือจาก QA, IQA, RIB ดู Status ของแถวเข้าล่าสุด ณ แถวที่อ่านถึง ขายไปก่อนที่โลจะปิดไม่ถือว่าผิด */
function closedSales_(rows) {
  var closed = {};
  var lastIn = {};
  rows.forEach(function (r) {
    if (r.long && r.to) lastIn[keyOf_(r.long, r.lot, r.po, r.to)] = r.open;
    if (r.type === 'ขาย' && r.from && r.long) {
      var k = keyOf_(r.long, r.lot, r.po, r.from);
      if (k in lastIn && (!lastIn[k] || special_(r.from))) {
        var c = closed[k] || (closed[k] = { sku: r.sku, long: r.long, lot: r.lot, po: r.po, loc: r.from, sold: 0, list: [] });
        c.sold += r.qty;
        c.list.push(r.row);
      }
    }
  });
  return closed;
}

/**
 * ยอดติดลบเริ่มจากแถวไหน เดินตามลำดับแถวในชีตแล้วหาครั้งสุดท้ายที่ยอดลงไปต่ำกว่าศูนย์และไม่กลับขึ้นมาอีก
 * แถวแรกของช่วงนั้นคือแถวที่ควรเช็คก่อน แถวก่อนหน้านั้นยอดยังไม่ติดลบ ต่อให้กรอกผิดก็ไม่ใช่ต้นเหตุของยอดที่ขาดตอนนี้
 * @returns {{at:number, before:number, rows:number[]}} rows คือแถวตั้งแต่จุดนั้นถึงท้ายสุด ทั้งแถวเข้าและแถวออก
 */
function dip_(x, byRow) {
  var ev = x.inRows.map(function (n) { return [n, 1]; }).concat(x.outRows.map(function (n) { return [n, -1]; }));
  /* แถวเดียวกันที่เป็นทั้งเข้าและออก (โอนเข้าที่เดิม) ให้นับเข้าก่อน ยอดจะได้ไม่ติดลบหลอก ๆ ระหว่างทาง */
  ev.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
  var run = 0, at = 0, before = 0;
  ev.forEach(function (e, i) {
    var prev = run;
    run += e[1] * byRow[e[0]].qty;
    if (run < -1e-9 && prev >= -1e-9) { at = i; before = prev; }
  });
  var seen = {}, list = [];
  ev.slice(at).forEach(function (e) { if (!seen[e[0]]) { seen[e[0]] = 1; list.push(e[0]); } });
  return { at: list[0], before: before, rows: list };
}

/**
 * Status ปนกัน: แถวรับเข้าที่ Status ต่างจากพวก แถวส่วนน้อยคือแถวที่น่าจะกรอกผิด
 * จำนวนเท่ากันให้ยึดแถวรับล่าสุด เพราะ Status ของกองนี้ตามแถวนั้นอยู่แล้ว
 */
function oddStatus_(x, byRow) {
  var open = [], blank = [];
  x.inRows.forEach(function (n) { (byRow[n].open ? open : blank).push(n); });
  var oddOpen = open.length === blank.length ? !x.open : open.length < blank.length;
  return { oddOpen: oddOpen, openN: open.length, blankN: blank.length, rows: oddOpen ? open : blank };
}

function issues_(rows, bals, today) {
  var out = [];
  var byRow = {};
  rows.forEach(function (r) { byRow[r.row] = r; });
  function add(kind, o) { o.kind = kind; out.push(o); }
  /* long คือรหัสคอลัมน์ B ที่ใช้คิดยอด หน้าเว็บใช้หากองอื่นของ SKU เดียวกันมาเป็นคำใบ้ */
  function head(x) { return { sku: x.sku, long: x.long, lot: x.lot, po: x.po, loc: x.loc }; }
  /**
   * แถวที่แนบไปพร้อมรายละเอียดแต่ละแถว [ประเภท, จำนวน, วันที่, 1 = ยืมวันที่จากแถวก่อน, คนกรอก, Location เบิก, Location รับ]
   * หน้าเว็บบอกได้เลยว่าแถวไหนเป็นขายกี่ชิ้นวันไหน ไม่ต้องเปิดชีตไล่ดูทีละแถว
   */
  function detail(list) {
    var o = someRows_(list);
    o.info = o.rows.map(function (n) {
      var r = byRow[n];
      return [r.type, r.qty, r.date || r.near, r.date ? 0 : 1, r.who, r.from, r.to];
    });
    return o;
  }

  bals.forEach(function (x) {
    if (x.inBlank && x.inOpen) {
      var odd = oddStatus_(x, byRow);
      add('mixed', merge_(merge_(head(x), {
        blank: x.inBlank, open: x.inOpen, out: x.out, bal: x.bal, oddOpen: odd.oddOpen, openN: odd.openN, blankN: odd.blankN,
      }), detail(odd.rows)));
    } else if (!x.inRows.length) {
      if (x.out) add('outonly', merge_(merge_(head(x), { bal: x.bal, at: x.outRows[0], before: 0 }), detail(x.outRows)));
    } else if (x.bal < 0) {
      var d = dip_(x, byRow);
      add('negative', merge_(merge_(head(x), {
        bal: x.bal, at: d.at, before: d.before, inQty: x.inBlank + x.inOpen, out: x.out,
      }), detail(d.rows)));
    }
  });

  var closed = closedSales_(rows);
  var locs = {};
  var unread = {};   // วันที่ขายที่อ่านไม่ออก จับกลุ่มตามรูปแบบ ไม่งั้นรูปแบบเดียวจะกลายเป็นหมื่นรายการ
  rows.forEach(function (r) {
    [r.from, r.to].forEach(function (l) {
      if (l) (locs[l] = locs[l] || []).push(r.row);
    });

    if (r.badQty) add('qty', { sku: r.sku, lot: r.lot, loc: r.to || r.from, value: r.badQty, rows: [r.row], rowCount: 1 });

    var miss = [];
    if (!r.long) miss.push('SKU คอลัมน์ B');
    if (r.badQty === '') miss.push('QTY');
    if (r.type !== 'รับ' && r.type !== 'เบิก' && r.type !== 'ขาย') miss.push('ประเภท');
    if (r.type === 'รับ' && !r.to) miss.push('Location รับ');
    if ((r.type === 'เบิก' || r.type === 'ขาย') && !r.from) miss.push('Location เบิก');
    if (r.type === 'ขาย' && !r.date && !r.note) miss.push('วันที่ขาย');
    if (r.type === 'ขาย' && !r.date && r.note) {
      var shape = r.note.replace(/\d/g, '9');
      (unread[shape] = unread[shape] || { note: r.note, list: [] }).list.push(r.row);
    }
    if (r.type !== 'ขาย' && !r.date && !r.note) miss.push('Note');
    if (!r.who) miss.push('ชื่อคนกรอก');
    if (miss.length) add('incomplete', { sku: r.sku, what: miss.join(', '), rows: [r.row], rowCount: 1 });
  });
  Object.keys(closed).forEach(function (k) {
    var c = closed[k];
    add('closedsale', merge_({ sku: c.sku, long: c.long, lot: c.lot, po: c.po, loc: c.loc, sold: c.sold }, detail(c.list)));
  });
  Object.keys(unread).forEach(function (k) {
    add('baddate', merge_({ note: unread[k].note }, someRows_(unread[k].list)));
  });

  locationIssues_(locs, add);
  dateIssues_(rows, add, today);

  /* Status ปนกันมักมียอดจริงเป็นศูนย์ สิ่งที่กระทบคือแถวออกที่ชีตยอดหักซ้ำ จึงเรียงตามตัวนั้นแทน */
  function weight(o) { return o.kind === 'mixed' ? o.out : Math.abs(o.bal || 0); }
  var counts = {};
  out.sort(function (a, b) { return weight(b) - weight(a); });
  return {
    counts: counts,
    list: out.filter(function (o) {
      counts[o.kind] = (counts[o.kind] || 0) + 1;
      return counts[o.kind] <= ISSUE_MAX;
    }),
  };
}

/** ชื่อ Location ที่น่าจะพิมพ์ผิด ดูจากรูปชื่อล้วน ๆ ไม่ได้เขียนรายชื่อโลไว้ในโค้ด */
function locationIssues_(locs, add) {
  var groups = {};
  Object.keys(locs).forEach(function (name) {
    var g = name.toUpperCase().replace(/[\s-]/g, '');
    (groups[g] = groups[g] || []).push(name);
  });
  var flagged = {};
  Object.keys(groups).forEach(function (g) {
    var names = groups[g];
    if (names.length < 2) return;
    names.sort(function (a, b) { return locs[b].length - locs[a].length; });
    names.slice(1).forEach(function (name) {
      flagged[name] = 1;
      add('locname', merge_({ name: name, like: names[0] }, someRows_(locs[name])));
    });
  });
  Object.keys(locs).forEach(function (name) {
    if (flagged[name] || RACK.test(name) || locs[name].length > RARE_ROWS) return;
    if (/^(QA|IQA|RIB)$/i.test(name)) return;
    add('locname', merge_({ name: name, like: '' }, someRows_(locs[name])));
  });
}

/**
 * วันที่ที่เลยวันนี้ไป หรือวันที่ GR ที่ห่างจากแถวขายรอบข้างมากผิดปกติ
 * มักเป็นเดือนหรือปีที่พิมพ์ผิด จับกลุ่มตามข้อความเดียวกัน
 */
function dateIssues_(rows, add, today) {
  var latest = '';
  var odd = {};
  rows.forEach(function (r) {
    if (!r.date) return;
    if (r.type === 'ขาย' && r.date <= today && r.date > latest) latest = r.date;
    var far = r.type !== 'ขาย' && latest && Math.abs(dayNo_(latest) - dayNo_(r.date)) > LATE_DAYS;
    if (r.date > today || far) {
      var g = r.note || r.date;
      (odd[g] = odd[g] || { note: g, near: latest, list: [] }).list.push(r.row);
    }
  });
  Object.keys(odd).forEach(function (k) {
    var g = odd[k];
    add('date', merge_({ note: g.note, near: g.near, first: g.list[0], last: g.list[g.list.length - 1] }, someRows_(g.list)));
  });
}

/* ── คำตอบ ───────────────────────────────────────────────────────────────── */

/**
 * ส่งแบบย่อ: ใส่รหัส SKU กับ Location ไว้ในตารางเดียวแล้วอ้างด้วยเลขลำดับ
 * ยอดที่เหลืออยู่จริงมีไม่กี่พันจุด ส่งสรุปเล็กกว่าส่งแถวดิบทั้งชีตหลายเท่า
 */
function summary_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ledgerSheet_(ss);
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = readRows_(sheet, tz);
  var bals = balances_(rows);
  var sold = sales_(rows, today);

  var known = {}, skuIdx = {}, skus = [], locIdx = {}, locs = [];
  rows.forEach(function (r) {
    if (!r.long) return;
    var k = same_(r.long);
    var s = known[k] || (known[k] = [r.sku, r.long, '']);
    if (!s[2] && r.name) s[2] = r.name;
  });
  function skuNo(k) {
    if (skuIdx[k] === undefined) { skuIdx[k] = skus.length; skus.push(known[k]); }
    return skuIdx[k];
  }
  function locNo(l) {
    var k = same_(l);   // พิมพ์เล็กใหญ่ต่างกันคือที่เดียวกัน ต้องเห็นเป็น Location เดียว
    if (locIdx[k] === undefined) { locIdx[k] = locs.length; locs.push(l); }
    return locIdx[k];
  }
  var keys = [];
  bals.forEach(function (x) {
    if (x.bal === 0) return;
    keys.push([skuNo(same_(x.long)), x.lot, x.po, locNo(x.loc), x.bal, x.open ? 1 : 0]);
  });

  var last = PropertiesService.getScriptProperties().getProperty('backup');
  return {
    app: 'transaction',
    at: Date.now(),
    rows: rows.length,
    lastDate: sold.last,
    saleDays: sold.days,
    /* SKU ที่ขายอยู่แต่ของหมดเกลี้ยงไม่มีแถวใน keys ต้องส่งแยก ไม่งั้นจะหลุดจากรายการต้องเติม */
    sold: Object.keys(sold.bySku).map(function (k) { return [skuNo(k), sold.bySku[k]]; }),
    sheet: { url: ss.getUrl(), gid: sheet.getSheetId() },
    backup: last ? JSON.parse(last) : null,
    skus: skus,
    locs: locs,
    keys: keys,
    issues: issues_(rows, bals, today),
  };
}

/**
 * ยอดแถวขายราย SKU ราย วัน ส่งแบบย่อเหมือน summary_ ไฟล์นี้ไม่รู้จักไฟล์ตัดสต๊อก หน้าเว็บเป็นคนเอาไปเทียบ
 * last คือวันขายล่าสุดของทั้งชีต ไม่ใช่ของช่วงที่ขอ หน้าเว็บจะได้รู้ว่าชีตลงถึงวันไหน
 * แถวที่นับไม่ได้ต้องบอกจำนวนกลับไป ไม่งั้นยอดที่หายไปจะดูเหมือนตัดไม่ตรงทั้งที่จริงกรอกไม่ครบ
 * lines คือแถวขายทีละแถวในช่วงที่ขอ หน้าเว็บใช้ชี้ว่ายอดของช่องที่ไม่ตรงมาจากแถวไหนในชีต
 *   [ลำดับวัน, ลำดับ SKU, เลขแถว, ลำดับ Location, LOT, PO, จำนวน (ข้อความถ้าพิมพ์ไม่ใช่ตัวเลข), ลำดับคนลง]
 * convert คือ MASTER แปลงสินค้า (ดู convert_) ให้หน้า LOT / PO ที่ขายออก
 */
function daily_(from, to) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var sheet = ledgerSheet_(ss);
  var rows = readRows_(sheet, tz);

  var out = {
    app: 'transaction', at: Date.now(), from: from, to: to, last: '',
    noDate: { rows: 0, qty: 0 }, noSku: { rows: 0, qty: 0 }, future: { rows: 0, qty: 0 }, badQty: { rows: 0 },
    sheet: { url: ss.getUrl(), gid: sheet.getSheetId() },
    skus: [], days: [], cells: [], locs: [], whos: [], lines: [],
  };
  function skip(part, r) { part.rows++; part.qty += r.qty; }
  function no(idx, list, v) {
    if (idx[v] === undefined) { idx[v] = list.length; list.push(v); }
    return idx[v];
  }

  var tally = {}, skuIdx = {}, locIdx = {}, whoIdx = {};
  rows.forEach(function (r) {
    if (r.type !== 'ขาย') return;
    if (!r.date) return skip(out.noDate, r);
    if (r.date > today) return skip(out.future, r);
    if (r.date > out.last) out.last = r.date;
    if ((from && r.date < from) || (to && r.date > to)) return;
    if (!r.long) return skip(out.noSku, r);
    if (r.badQty !== null) out.badQty.rows++;
    var k = same_(r.long);
    if (skuIdx[k] === undefined) { skuIdx[k] = out.skus.length; out.skus.push([k, r.name]); }
    var day = tally[r.date] || (tally[r.date] = {});
    day[k] = (day[k] || 0) + r.qty;
    out.lines.push([r.date, skuIdx[k], r.row, no(locIdx, out.locs, r.from), r.lot, r.po,
      r.badQty !== null ? r.badQty : r.qty, no(whoIdx, out.whos, r.who)]);
  });

  out.days = Object.keys(tally).sort();
  var dayIdx = {};
  out.days.forEach(function (d, i) {
    dayIdx[d] = i;
    Object.keys(tally[d]).forEach(function (k) {
      if (tally[d][k]) out.cells.push([i, skuIdx[k], tally[d][k]]);
    });
  });
  out.lines.forEach(function (l) { l[0] = dayIdx[l[0]]; });
  out.convert = convert_(ss, rows);
  return out;
}

/**
 * คู่ SKU จากแท็บ MASTER แปลงสินค้า ไม่มีแท็บส่ง null หน้าเว็บจะได้แยกออกจากสคริปต์รุ่นเก่าที่ไม่มีช่องนี้เลย
 * แถวแรกเป็นหัวตาราง หาคอลัมน์ SKU ที่หัวมีคำว่า ซื้อ กับ แปลง หรือ ขาย หาไม่เจอใช้คอลัมน์ A กับ B
 * ชื่อสินค้าของ SKU ตอนซื้อเอาจากสมุด สมุดไม่มี SKU นั้นส่งว่าง หน้าเว็บใช้ชื่อของ SKU ที่ขายแทน
 *   pairs = [[SKU หลังแปลง, SKU ตอนซื้อ, ชื่อ SKU ตอนซื้อ]]
 */
function convert_(ss, rows) {
  var sheet = ss.getSheetByName(CONVERT_SHEET);
  if (!sheet) return null;
  var out = { tab: CONVERT_SHEET, cols: ['', ''], pairs: [], blank: 0 };
  var h = sheet.getLastRow();
  if (h < 1) return out;
  var vals = sheet.getRange(1, 1, h, Math.max(sheet.getLastColumn(), 2)).getDisplayValues();
  var head = vals[0].map(function (v) { return String(v).trim(); });
  function find(re, skip) {
    for (var i = 0; i < head.length; i++) if (i !== skip && re.test(head[i]) && /SKU|รหัส/i.test(head[i])) return i;
    return -1;
  }
  var buy = find(/ซื้อ/, -1), after = find(/แปลง|ขาย/, buy);
  if (buy < 0 || after < 0) { buy = 0; after = 1; }
  out.cols = [head[buy] || '', head[after] || ''];

  var names = {};
  rows.forEach(function (r) {
    if (r.long && r.name && !names[same_(r.long)]) names[same_(r.long)] = r.name;
  });
  var seen = {};
  for (var i = 1; i < vals.length; i++) {
    var b = same_(vals[i][buy]), a = same_(vals[i][after]);
    if (!a && !b) continue;
    if (!a || !b) { out.blank++; continue; }
    if (a === b || seen[a + '|' + b]) continue;
    seen[a + '|' + b] = 1;
    out.pairs.push([a, b, names[b] || '']);
  }
  return out;
}

/** ความเคลื่อนไหวของ SKU เดียว ใหม่สุดขึ้นก่อน คงเหลือคิดจากทุกแถวของ SKU นั้นแล้วค่อยตัดช่วงที่ส่ง */
function history_(sku) {
  if (!sku) return { error: 'ไม่ได้ระบุ SKU' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ledgerSheet_(ss);
  var rows = readRows_(sheet, ss.getSpreadsheetTimeZone());
  var want = same_(sku);
  var mine = rows.filter(function (r) { return r.long && (same_(r.sku) === want || same_(r.long) === want); });
  var total = 0;
  var list = mine.map(function (r) {
    var inQ = r.to ? r.qty : 0;
    var outQ = r.from && (r.type === 'เบิก' || r.type === 'ขาย') ? r.qty : 0;
    total += inQ - outQ;
    return {
      row: r.row, date: r.date || r.near, approx: !r.date, type: r.type, note: r.note,
      from: r.from, to: r.to, lot: r.lot, po: r.po, qty: r.qty, change: inQ - outQ, left: total, who: r.who,
    };
  });
  return {
    app: 'transaction',
    sku: mine.length ? mine[0].sku : sku,
    name: mine.length ? (mine.filter(function (r) { return r.name; })[0] || {}).name || '' : '',
    count: list.length,
    left: total,
    items: list.slice(-HISTORY_MAX).reverse(),
    sheet: { url: ss.getUrl(), gid: sheet.getSheetId() },
  };
}

/**
 * ทุกแถวของสมุดแบบย่อ ให้หน้า FIFO สต๊อก (public/fifo) เดินตามลำดับแถวเอง
 * กติกา FIFO อยู่ที่ public/wms-fifo.js ทั้งหมด ปรับกติกาทีหลังได้โดยไม่ต้องวางสคริปต์นี้ใหม่
 *   row = [เลขแถว, ลำดับ SKU, LOT, ลำดับ PO, ลำดับ Location เบิก, ลำดับ Location รับ, จำนวน, ประเภท, ลำดับวันที่, ธง]
 *   Location เบิก ส่งเฉพาะแถวเบิกกับขาย แถวอื่นไม่หักยอดต้นทาง (-1 = ไม่มี)
 *   ประเภท 0 = รับหรืออื่น ๆ, 1 = เบิก, 2 = ขาย
 *   วันที่ = วันที่ของแถวเอง หรือของแถวล่าสุดด้านบนที่มีวันที่ (-1 = ยังไม่มี)
 *   ธง 1 = Status เปิด, 2 = รับเข้าที่มี GR (วันที่คือวันรับ), 4 = แถวนับสต๊อก, 8 = วันที่เป็นของแถวเอง,
 *      16 = แถวแปลงสินค้า (Note มีคำว่า แปลง) หน้าเช็ครายการตัดสต๊อกใช้จับคู่ SKU ที่เบิกออกกับ SKU ที่รับเข้าแทน
 *      32 = แถวรับคืน (Note มี RETURN หรือ คืน), 64 = แถว M/E (Note มี M/E)
 *      หน้า LOT / PO ที่ขายออกใช้สองธงนี้ประมาณ LOT/PO ให้ของที่ลงไว้เป็น LOT 0 (ดู public/wms-lot0.js)
 * conv = 1 บอกว่าสคริปต์รุ่นนี้ส่งธง 16 แล้ว รุ่นก่อนไม่มีธงนี้ หน้าเว็บจะได้ไม่เข้าใจว่าไม่เคยมีการแปลงเลย
 * lot0 = 1 บอกว่าส่งธง 32 กับ 64 แล้ว รุ่นก่อนแยกแถวรับคืนกับ M/E ออกจากแถวรับอื่นไม่ได้
 * before คือยอดจากแท็บ ยอดก่อนนับ (ดู before_) ไม่มีแท็บส่ง null
 * convert คือ MASTER แปลงสินค้า (ดู convert_) หน้าสินค้าคงเหลือ ณ วันที่ใช้รวมยอด SKU ที่แปลงคืนเป็น SKU ตอนซื้อ
 * จำนวนที่พิมพ์เป็นข้อความเป็น 0 และแถวที่ SKU คอลัมน์ B ว่างไม่ถูกส่ง เหมือน balances_
 */
function fifo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var sheet = ledgerSheet_(ss);
  var rows = readRows_(sheet, tz);
  var out = {
    app: 'transaction', at: Date.now(), today: today, last: sales_(rows, today).last, conv: 1, lot0: 1,
    sheet: { url: ss.getUrl(), gid: sheet.getSheetId() },
    skus: [], pos: [], locs: [], days: [], rows: [],
  };
  var idx = { sku: {}, po: {}, loc: {}, day: {} };
  function no(kind, list, key, v) {
    if (idx[kind][key] === undefined) { idx[kind][key] = list.length; list.push(v); }
    return idx[kind][key];
  }
  rows.forEach(function (r) {
    if (!r.long) return;
    var s = no('sku', out.skus, same_(r.long), [r.sku, r.long, r.name]);
    if (!out.skus[s][2] && r.name) out.skus[s][2] = r.name;
    var t = r.type === 'ขาย' ? 2 : r.type === 'เบิก' ? 1 : 0;
    var flag = (r.open ? 1 : 0) + (r.date && /^GR/i.test(r.note) ? 2 : 0) + (/stock\s*count/i.test(r.note) ? 4 : 0) + (r.date ? 8 : 0)
      + (/แปลง/.test(r.note) ? 16 : 0) + (/return|คืน/i.test(r.note) ? 32 : 0) + (/M\/E/i.test(r.note) ? 64 : 0);
    out.rows.push([
      r.row, s, r.lot, no('po', out.pos, same_(r.po), r.po),
      t && r.from ? no('loc', out.locs, same_(r.from), r.from) : -1,
      r.to ? no('loc', out.locs, same_(r.to), r.to) : -1,
      r.qty, t, r.near ? no('day', out.days, r.near, r.near) : -1, flag,
    ]);
  });
  out.before = before_(ss, tz);
  out.convert = convert_(ss, rows);
  return out;
}

/**
 * ยอดก่อนวันนับสต๊อกจากแท็บ ยอดก่อนนับ ผู้ใช้วางได้สองแบบ
 *   สมุดรอบก่อนทั้งชีต: หัวตาราง F, G เป็น Location เบิก / Location รับ แบบสมุด คิดยอดคงเหลือราย SKU + LOT + PO
 *     ด้วยกติกาเดียวกับ balances_ (ไม่แยก Location) วันที่รับเอาจากแถว GR แรกของล็อตนั้น
 *   ตาราง: แถวแรกเป็นหัวตาราง หาคอลัมน์ SKU, LOT, PO, จำนวน จากหัวตาราง วันที่รับใส่หรือไม่ใส่ก็ได้
 *     SKU เดียวกัน LOT PO เดียวกันหลายแถวบวกรวมกัน (วางเป็นรายการรับเข้าแต่ละครั้งก็ได้)
 * layers = [[SKU, LOT, PO, จำนวน, วันที่รับ yyyy-mm-dd หรือว่าง]] เฉพาะยอดที่มากกว่า 0
 * ไม่มีแท็บส่ง null หาคอลัมน์ไม่เจอ missing บอกว่าขาดอะไร
 */
function before_(ss, tz) {
  var sheet = ss.getSheetByName(BEFORE_SHEET);
  if (!sheet) return null;
  var out = { tab: BEFORE_SHEET, mode: '', cols: [], missing: [], rows: 0, skip: 0, layers: [] };
  var h = sheet.getLastRow(), w = sheet.getLastColumn();
  if (h < 2 || w < 1) return out;
  var vals = sheet.getRange(1, 1, h, Math.max(w, COLS)).getValues();
  var head = vals[0].map(function (v) { return text_(v); });
  var sum = {}, order = [];
  function add(sku, lot, po, qty, date) {
    var k = [same_(sku), same_(lot), same_(po)].join('|');
    if (!sum[k]) { sum[k] = [text_(sku), lot, text_(po), 0, '']; order.push(k); }
    sum[k][3] += qty;
    if (date && (!sum[k][4] || date < sum[k][4])) sum[k][4] = date;
  }
  function blank(c) { return c.every(function (v) { return v === '' || v === null; }); }

  if (/^location\s*เบิก/i.test(head[5] || '') && /^location\s*รับ/i.test(head[6] || '')) {
    out.mode = 'ledger';
    for (var i = 1; i < vals.length; i++) {
      var c = vals[i];
      if (blank(c)) continue;
      if (!text_(c[1])) { out.skip++; continue; }
      out.rows++;
      var qty = typeof c[7] === 'number' ? c[7] : 0, type = text_(c[8]), lot = c[3] === '' ? '' : c[3];
      if (text_(c[6])) add(c[1], lot, c[4], qty, /^GR/i.test(text_(c[9])) ? ownDate_(c[9], tz) : '');
      if (text_(c[5]) && (type === 'เบิก' || type === 'ขาย')) add(c[1], lot, c[4], -qty, '');
    }
  } else {
    out.mode = 'table';
    var find = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
    /* หัว SKU สองช่องแบบสมุด (รหัสสั้น รหัสเต็ม) ใช้ช่องหลัง */
    var skus = [];
    head.forEach(function (v, j) { if (/sku|รหัส/i.test(v)) skus.push(j); });
    var col = { sku: skus.length ? skus[skus.length - 1] : -1, lot: find(/^lot|ล็อต/i), po: find(/^po/i),
      qty: find(/จำนวน|qty|คงเหลือ|ยอด/i), date: find(/วันที่|date/i) };
    out.cols = ['sku', 'lot', 'po', 'qty', 'date'].map(function (k) { return col[k] >= 0 ? head[col[k]] : ''; });
    out.missing = ['sku', 'lot', 'po', 'qty'].filter(function (k) { return col[k] < 0; });
    if (out.missing.length) return out;
    for (var r = 1; r < vals.length; r++) {
      var v = vals[r];
      if (blank(v)) continue;
      var n = typeof v[col.qty] === 'number' ? v[col.qty] : Number(text_(v[col.qty]).replace(/,/g, ''));
      if (!text_(v[col.sku]) || !(n > 0)) { out.skip++; continue; }
      out.rows++;
      var d = col.date >= 0 ? plainDate_(v[col.date], tz) || ownDate_(v[col.date], tz) : '';
      add(v[col.sku], v[col.lot] === '' ? '' : v[col.lot], v[col.po], n, d);
    }
  }
  order.forEach(function (k) { if (sum[k][3] > 0) out.layers.push(sum[k]); });
  return out;
}

/* ── นับสต๊อก ───────────────────────────────────────────────────────────── */

/** แท็บผลนับ ไม่มีก็สร้าง เป็นแท็บเดียวที่สคริปต์นี้เขียนลงไฟล์ */
function countSheet_(ss) {
  var sheet = ss.getSheetByName(COUNT_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(COUNT_SHEET, ss.getSheets().length);
  sheet.getRange(1, 1, 1, COUNT_HEAD.length).setValues([COUNT_HEAD]);
  sheet.setFrozenRows(1);
  return sheet;
}

function readCount_(sheet, tz) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, COUNT_HEAD.length).getValues().map(function (c, i) {
    var done = typeof c[9] === 'number';
    return {
      row: i + 2,
      date: plainDate_(c[0], tz),
      src: text_(c[1]), why: text_(c[2]), loc: text_(c[3]), sku: text_(c[4]), long: text_(c[5]), name: text_(c[6]),
      lot: text_(c[7]), po: text_(c[8]),
      k: keyOf_(c[5], c[7], c[8], c[3]),
      qty: done ? c[9] : null, exp: done ? c[10] : null, diff: done ? c[11] : null,
      who: text_(c[12]), at: text_(c[13]),
    };
  }).filter(function (p) { return p.date; });
}

/** สุ่มแบบได้ผลเดิมทุกครั้งเมื่อวันและรายการเท่าเดิม ลำดับเปลี่ยนไปคนละแบบในแต่ละวัน */
function hash_(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * คัดรายการนับของวันนี้ เรียงตาม Location ให้เดินนับได้ทีเดียว
 *   นับซ้ำ = ครั้งก่อนไม่ตรง ให้นับอีกรอบเพื่อแยกว่านับพลาดหรือยอดผิดจริง รอบสองไม่ตรงอีกก็ไม่เรียกซ้ำแล้ว
 *   เสี่ยง = จุดที่ข้อมูลฟ้องว่าน่าจะผิด ยอดติดลบมาก่อนเพราะเป็นไปไม่ได้ในโลกจริง
 *   สุ่ม  = ชั้นวางสำรองที่ไม่ได้เปิดขาย ใช้วัดความแม่นยำของทั้งคลัง
 * โลเปิดไม่เอามาสุ่ม เพราะของเข้าออกทั้งวันและแถวขายกรอกตามหลัง นับตอนไหนก็ไม่ตรงโดยที่ยอดไม่ได้ผิด
 */
function pickCount_(rows, bals, past, today) {
  var end = dayNo_(today);
  var rest = {};
  var last = {};
  /* รายการเทียบระบบมีผลนับของตัวเองที่แท็บเทียบสต๊อก คนเป็นคนตัดสินว่าจะนับซ้ำไหม */
  past.forEach(function (p) {
    if (p.qty === null || p.src === COUNT_DIFF_SRC) return;
    last[p.k] = p;
    if (end - dayNo_(p.date) < COUNT_REST_DAYS) rest[p.k] = 1;
  });
  var names = {};
  rows.forEach(function (r) {
    if (r.long && r.name && !names[same_(r.long)]) names[same_(r.long)] = r.name;
  });

  var list = [];
  var picked = {};
  function keyOfBal(x) { return keyOf_(x.long, x.lot, x.po, x.loc); }
  function take(x, k, src, why) {
    if (picked[k]) return;
    picked[k] = 1;
    list.push({ src: src, why: why, loc: x.loc, sku: x.sku, long: x.long, name: names[same_(x.long)] || x.name || '', lot: x.lot, po: x.po });
  }

  Object.keys(last).forEach(function (k) {
    var p = last[k];
    if (p.diff === 0 || p.src === 'นับซ้ำ' || p.date >= today || list.length >= COUNT_RISK_MAX) return;
    take(p, k, 'นับซ้ำ', 'ครั้งก่อนไม่ตรง');
  });

  var closed = closedSales_(rows);
  var risky = [];
  bals.forEach(function (x) {
    var k = keyOfBal(x);
    if (x.bal === 0 || rest[k] || !(RACK.test(same_(x.loc)) || special_(x.loc))) return;
    if (x.bal < 0) risky.push({ x: x, k: k, tier: 0, weight: -x.bal, why: 'ยอดติดลบ' });
    else if (closed[k]) risky.push({ x: x, k: k, tier: 1, weight: closed[k].sold, why: 'ขายจากโลไม่เปิด' });
    else if (x.inBlank && x.inOpen) risky.push({ x: x, k: k, tier: 2, weight: x.out, why: 'Status ปนกัน' });
  });
  risky.sort(function (a, b) { return a.tier - b.tier || b.weight - a.weight; });
  risky.forEach(function (r) {
    if (list.length < COUNT_RISK_MAX) take(r.x, r.k, 'เสี่ยง', r.why);
  });

  var pool = bals.filter(function (x) {
    return x.bal > 0 && !x.open && RACK.test(same_(x.loc)) && !rest[keyOfBal(x)];
  });
  function rank(x) { return hash_(today + keyOfBal(x)); }
  pool.sort(function (a, b) { return rank(a) - rank(b); });
  pool.forEach(function (x) {
    if (list.length < COUNT_PER_DAY) take(x, keyOfBal(x), 'สุ่ม', 'สุ่มตรวจ');
  });

  return list.sort(function (a, b) { return same_(a.loc) < same_(b.loc) ? -1 : same_(a.loc) > same_(b.loc) ? 1 : 0; });
}

/**
 * วันที่และรหัสตั้งเป็นข้อความก่อนเขียน ไม่งั้นชีตจะแปลงเองตามการตั้งค่าของไฟล์
 * ซึ่งเป็นต้นเหตุให้วันที่ขายในสมุดรายการอ่านไม่ออกมาแล้ว
 */
function appendCount_(sheet, today, list) {
  if (!list.length) return;
  var at = sheet.getLastRow() + 1;
  var short = at + list.length - 1 - sheet.getMaxRows();
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
  sheet.getRange(at, 1, list.length, COUNT_TEXT_COLS).setNumberFormat('@');
  sheet.getRange(at, COUNT_WHO_COL, list.length, 2).setNumberFormat('@');
  sheet.getRange(at, 1, list.length, COUNT_HEAD.length).setValues(list.map(function (l) {
    return [today, l.src, l.why, l.loc, l.sku, l.long, l.name, String(l.lot), String(l.po), '', '', '', '', ''];
  }));
}

/**
 * รายการที่ยังไม่นับไม่ส่งเหตุผลไปด้วย และยังไม่มียอดในระบบให้ส่ง คนนับจึงนับตามของจริง ไม่ใช่นับให้ตรงเลข
 * รายการเทียบระบบของวันก่อนที่ยังไม่นับต้องส่งด้วย หน้าเว็บจะได้รู้ว่ารอบนั้นนับไม่ครบ ไม่ใช่สรุปผลจากแค่จุดที่นับแล้ว
 */
function countView_(past, today) {
  var end = dayNo_(today);
  return {
    app: 'transaction',
    today: today,
    lines: past.filter(function (p) {
      if (p.date === today) return true;
      return (p.qty !== null || p.src === COUNT_DIFF_SRC) && end - dayNo_(p.date) < COUNT_KEEP_DAYS;
    }).map(function (p) {
      var o = { k: p.k, date: p.date, src: p.src, loc: p.loc, sku: p.sku, name: p.name, lot: p.lot, po: p.po };
      if (p.src === COUNT_DIFF_SRC) o.long = p.long;
      return p.qty === null ? o : merge_(o, { why: p.why, qty: p.qty, exp: p.exp, diff: p.diff, who: p.who, at: p.at });
    }),
  };
}

function countLoad_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  /* หลายเครื่องเปิดพร้อมกันตอนเช้าต้องได้รายการชุดเดียว ไม่ใช่คนละชุดซ้อนกัน */
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = countSheet_(ss);
    var past = readCount_(sheet, tz);
    /* ส่ง SKU มาจากแท็บเทียบสต๊อกก่อนเปิดใบนับครั้งแรกของวันได้ แถวพวกนั้นไม่ได้แปลว่าออกรายการประจำวันแล้ว */
    if (!past.some(function (p) { return p.date === today && p.src !== COUNT_DIFF_SRC; })) {
      var rows = readRows_(ledgerSheet_(ss), tz);
      appendCount_(sheet, today, pickCount_(rows, balances_(rows), past, today));
      past = readCount_(sheet, tz);
    }
    return countView_(past, today);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ผลนับรวมรายเดือนให้หน้าภาพรวมสต๊อก อ่านอย่างเดียว ไม่ออกรายการของวันนี้และไม่สร้างแท็บ
 * หัวหน้าเปิดดูก่อนทีมเปิดใบนับ ต้องไม่ทำให้รายการของวันนั้นออกก่อนเวลา และไม่ต้องอ่านสมุดรายการทั้งเล่ม
 * ความแม่นยำนับเฉพาะรายการสุ่มแบบเดียวกับหน้าสต๊อกราย Location นับซ้ำกับเสี่ยงถูกเลือกมาเพราะน่าจะผิดอยู่แล้ว
 *   todays  รายการของวันนี้ทั้งหมด กับที่นับแล้ว (ยังไม่ออกรายการ = 0 ทั้งคู่)
 *   last    รายการสุ่มที่นับแล้วในช่วง COUNT_KEEP_DAYS วันล่าสุด ตัวเดียวกับความแม่นยำบนหน้าสต๊อกราย Location
 *   months  ราย yyyy-mm: counted นับแล้วทั้งหมด, off ไม่ตรง, sample รายการสุ่มที่นับแล้ว, match สุ่มแล้วตรง
 */
function countPeek_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var sheet = ss.getSheetByName(COUNT_SHEET);
  var end = dayNo_(today);
  var out = { app: 'transaction', peek: true, today: today, todays: { total: 0, done: 0 }, last: { sample: 0, match: 0 }, months: {} };
  (sheet ? readCount_(sheet, tz) : []).forEach(function (p) {
    if (p.date === today) { out.todays.total++; if (p.qty !== null) out.todays.done++; }
    if (p.qty === null) return;
    var ym = p.date.slice(0, 7);
    var m = out.months[ym] || (out.months[ym] = { counted: 0, off: 0, sample: 0, match: 0 });
    m.counted++;
    if (p.diff !== 0) m.off++;
    if (p.src !== 'สุ่ม') return;
    m.sample++;
    if (p.diff === 0) m.match++;
    if (end - dayNo_(p.date) < COUNT_KEEP_DAYS) { out.last.sample++; if (p.diff === 0) out.last.match++; }
  });
  return out;
}

/**
 * ยอดในระบบคิด ณ ตอนส่ง ไม่ใช่ตอนออกรายการ ของที่ย้ายระหว่างวันจึงไม่กลายเป็นยอดไม่ตรง
 * ผลนับเขียนได้ครั้งเดียว ส่งซ้ำหรือสองคนนับรายการเดียวกัน ผลแรกยังอยู่ และชื่อคนต้องไม่กลายเป็นสูตรในชีต
 */
function countSave_(req) {
  var items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) return { error: 'ไม่มีรายการที่จะบันทึก' };
  var fine = items.every(function (i) { return i && typeof i.qty === 'number' && isFinite(i.qty) && i.qty >= 0; });
  if (!fine) return { error: 'จำนวนที่นับต้องเป็นตัวเลขและไม่ติดลบ' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var bal = {};
  var spot = {};
  balances_(readRows_(ledgerSheet_(ss), tz)).forEach(function (x) {
    bal[keyOf_(x.long, x.lot, x.po, x.loc)] = x.bal;
    var s = same_(x.long) + '|' + same_(x.loc);
    spot[s] = (spot[s] || 0) + x.bal;
  });
  function expected(p) {
    if (p.src !== COUNT_DIFF_SRC) return bal[p.k] || 0;
    return p.long.split(',').reduce(function (sum, l) { return sum + (spot[same_(l) + '|' + same_(p.loc)] || 0); }, 0);
  }
  var who = plain_(req.who, 60);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = countSheet_(ss);
    var open = {};
    readCount_(sheet, tz).forEach(function (p) {
      if (p.qty === null) open[p.date + '|' + p.k] = p;
    });
    var saved = 0;
    items.forEach(function (i) {
      var id = req.date + '|' + i.k;
      var p = open[id];
      if (!p) return;
      delete open[id];
      var exp = expected(p);
      sheet.getRange(p.row, COUNT_RESULT_COL, 1, 5).setValues([[i.qty, exp, i.qty - exp, who, Utilities.formatDate(now, tz, 'HH:mm')]]);
      saved++;
    });
    var view = countView_(readCount_(sheet, tz), Utilities.formatDate(now, tz, 'yyyy-MM-dd'));
    view.saved = saved;
    view.skipped = items.length - saved;
    return view;
  } finally {
    lock.releaseLock();
  }
}

/** ข้อความจากเว็บต้องไม่กลายเป็นสูตรในชีต */
function plain_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/^[=+\-@'\s]+/, '').slice(0, max);
}

/**
 * ส่ง SKU ที่ยอดไม่ตรงระบบบริษัทเข้าใบนับ ออกแถวต่อ Location รวมทุก LOT ทุก PO
 * ระบบบริษัทรู้แค่ยอดรวมของ SKU คำถามจึงมีแค่ว่าของจริงมีเท่าไหร่ และกรอก LOT ผิดไม่ทำให้ยอดรวมเพี้ยน
 *
 * Location คิดจากสมุดรายการเองทุกครั้ง เว็บบอกได้แค่ว่าเป็น SKU ไหน
 * SKU ที่ยังรอนับอยู่ไม่ออกซ้ำ ส่วนตัวที่นับครบแล้วส่งใหม่ได้ เผื่ออยากนับอีกรอบ
 */
function countAdd_(req) {
  var items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) return { error: 'ไม่มี SKU ที่จะส่ง' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = readRows_(ledgerSheet_(ss), tz);
  var known = {};
  var names = {};
  rows.forEach(function (r) {
    if (!r.long) return;
    var k = same_(r.long);
    if (!known[k]) known[k] = r.long;
    if (!names[k] && r.name) names[k] = r.name;
  });
  var spots = {};
  balances_(rows).forEach(function (x) {
    if (x.bal === 0) return;
    var k = same_(x.long);
    (spots[k] = spots[k] || {})[same_(x.loc)] = x.loc;
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = countSheet_(ss);
    var mine = readCount_(sheet, tz).filter(function (p) { return p.date === today && p.src === COUNT_DIFF_SRC; });
    var waiting = {};
    mine.forEach(function (p) { if (p.qty === null) waiting[same_(p.long)] = 1; });

    var list = [];
    var added = 0;
    var skipped = 0;
    items.forEach(function (i) {
      var sku = plain_(i && i.sku, 100);
      var longs = (i && Array.isArray(i.longs) ? i.longs : [])
        .map(function (l) { return known[same_(l)]; })
        .filter(function (l) { return l; });
      var id = longs.join(',') || sku;
      if (!sku || waiting[same_(id)]) { skipped++; return; }
      waiting[same_(id)] = 1;

      var locs = {};
      longs.forEach(function (l) {
        var at = spots[same_(l)] || {};
        Object.keys(at).forEach(function (k) { locs[k] = at[k]; });
      });
      var name = (longs.length && names[same_(longs[0])]) || plain_(i.name, 200);
      Object.keys(locs).sort().map(function (k) { return locs[k]; }).concat(COUNT_ELSEWHERE).forEach(function (loc) {
        list.push({ src: COUNT_DIFF_SRC, why: 'ยอดไม่ตรงระบบบริษัท', loc: loc, sku: sku, long: id, name: name, lot: COUNT_DIFF_ALL, po: COUNT_DIFF_ALL });
      });
      added++;
    });
    if (mine.length + list.length > COUNT_DIFF_MAX) {
      return { error: 'ส่งได้ไม่เกินวันละ ' + COUNT_DIFF_MAX + ' จุด วันนี้มีแล้ว ' + mine.length + ' จุด รอบนี้จะเพิ่มอีก ' + list.length + ' จุด เลือก SKU ให้น้อยลง' };
    }
    appendCount_(sheet, today, list);
    var view = countView_(readCount_(sheet, tz), today);
    view.added = added;
    view.addedLines = list.length;
    view.skipped = skipped;
    return view;
  } finally {
    lock.releaseLock();
  }
}

/* ── Backup ─────────────────────────────────────────────────────────────── */

/**
 * ทำสำเนาทั้งไฟล์ลงโฟลเดอร์ใน Drive ของเจ้าของสคริปต์ ไฟล์ต้นฉบับไม่ถูกแตะ
 * ลบเฉพาะไฟล์ในโฟลเดอร์นี้ที่ขึ้นต้นด้วย BACKUP_PREFIX และลบแบบย้ายลงถังขยะ
 */
function backupNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var name = BACKUP_PREFIX + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + ' ' + ss.getName();
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);

  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });

  PropertiesService.getScriptProperties().setProperty('backup', JSON.stringify({ at: Date.now(), name: name, kept: Math.min(files.length, BACKUP_KEEP) }));
  return name;
}

/** กดรันครั้งเดียวจากหน้าแก้สคริปต์: ตั้งให้ Backup ทุกคืน แล้วทำสำเนาแรกให้ทันที เพื่อให้เห็นว่าใช้ได้ */
function installBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(2).create();
  return backupNow();
}

/* ── ข้อมูลกลาง ─────────────────────────────────────────────────────────── */

/*
 * เดิมแต่ละเครื่องกดดึงเอง ได้ตัวเลขคนละเวลา คนหนึ่งเห็นยอดตอนเช้า อีกคนเห็นตอนบ่าย แล้วคุยกันไม่ตรง
 * ตอนนี้ผลที่คิดเสร็จเก็บไว้ชุดเดียว ทุกเครื่องอ่านชุดนั้น หน้าเว็บถาม shared-at ทุกนาที มีชุดใหม่ค่อยโหลด
 *
 * เก็บเป็นไฟล์ JSON ในโฟลเดอร์ SHARED_FOLDER ใน Drive ของเจ้าของสคริปต์ ไม่เขียนลงไฟล์ชีต สมุดรายการไม่ถูกแตะ
 * เวลา คนกด และเลขไฟล์อยู่ใน Script Properties คีย์ shared:<ชื่อ> ถามได้เร็วโดยไม่ต้องเปิดไฟล์
 *
 * ?api=tx-summary&shared=1               ชุดที่เก็บไว้ ยังไม่มีหรือเก่ากว่า SHARED_MAX_MIN ก็คิดใหม่แล้วเก็บ
 * ?api=tx-daily&from=...&to=...&shared=1  แบบเดียวกัน ใช้ได้เมื่อช่วงวันที่ตรงกับชุดที่เก็บ
 * ?api=tx-fifo&shared=1                  แถวทั้งสมุดของหน้า FIFO กับหน้าภาพรวม ชุดนี้ใช้ทำรายงานรายเดือน
 *                                        เปิดหน้าแล้วใช้ชุดที่มี เก่ากว่า SHARED_FIFO_MAX_MIN ค่อยคิดใหม่
 * POST {op:'shared-fresh', api, by}      คิดใหม่แล้วเก็บแทนชุดเดิม ถ้ามีคนกำลังคิดอยู่ตอบ busy แทนการคิดซ้อน
 * ไม่ใส่ shared                          คิดใหม่ทุกครั้งและไม่เก็บ เหมือนรุ่นก่อน
 *
 * ตั้งเวลา: รัน installShared ครั้งเดียวจากหน้าแก้สคริปต์ เลิกด้วย stopShared
 */
var SHARED_APP = 'transaction';
var SHARED_NAMES = ['tx-summary', 'tx-daily', 'tx-fifo'];
var SHARED_FOLDER = 'WMS ข้อมูลกลาง';
var SHARED_MAX_MIN = 60;          // เปิดหน้าแล้วชุดที่เก็บไว้เก่ากว่านี้ คิดใหม่ให้เลย ตั้งเวลาไว้ทุก 30 นาที ปกติจึงไม่ถึง
var SHARED_EVERY_MIN = 30;        // ตั้งเวลาดึงเองทุกกี่นาที Apps Script ให้เลือกได้แค่ 1 5 10 15 30
var SHARED_FROM_HOUR = 8;         // ตั้งเวลาทำงานเฉพาะ 8:00 ถึงก่อน 18:00 ตามเวลาของไฟล์ชีต นอกเวลางานไม่มีใครดู
var SHARED_TO_HOUR = 18;
var SHARED_BUSY_MS = 7 * 60000;   // Apps Script ตัดจบที่ 6 นาที ป้ายกำลังคิดที่ค้างนานกว่านี้คือตัวที่ตายไปแล้ว
/* ชุด FIFO อ่านทั้งสมุดเหมือนยอดคงเหลือ แต่ใช้ดูรายเดือน ตั้งเวลาคิดใหม่ทุก 2 ชั่วโมงก็พอ ประหยัดโควตาเวลา
   เปิดหน้าแล้วใช้ชุดที่มีอยู่ได้ถึงหนึ่งวัน หัวหน้าเปิดดูตอนเช้าก่อนรอบตั้งเวลาแรกจะได้ไม่ต้องรอ */
var SHARED_FIFO_EVERY_MIN = 120;
var SHARED_FIFO_MAX_MIN = 24 * 60;

function sharedJson_(all, k) {
  try { return all[k] ? JSON.parse(all[k]) : null; } catch (err) { return null; }
}

function sharedProp_(k) {
  return sharedJson_({ v: PropertiesService.getScriptProperties().getProperty(k) }, 'v');
}

function sameParams_(a, b) {
  a = a || {}; b = b || {};
  return String(a.from || '') === String(b.from || '') && String(a.to || '') === String(b.to || '');
}

function running_(name) {
  var r = sharedProp_('shared-run:' + name);
  return r && Date.now() - r.at < SHARED_BUSY_MS ? r : null;
}

/** ชุดที่เก็บไว้ ไม่มี ช่วงวันที่ไม่ตรง เก่าเกิน maxMin หรือไฟล์ถูกลบ คืน null */
function sharedLoad_(name, params, maxMin) {
  var info = sharedProp_('shared:' + name);
  if (!info || !info.file || !sameParams_(info.params, params)) return null;
  if (maxMin && Date.now() - info.at > maxMin * 60000) return null;
  try {
    var f = DriveApp.getFileById(info.file);
    if (f.isTrashed()) return null;
    return JSON.parse(f.getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
}

/**
 * เก็บผลเป็นชุดกลาง ไฟล์มีป้าย shared ของตัวเองติดไปด้วย คนที่โหลดรู้ว่าเป็นชุดไหนโดยไม่ต้องถามซ้ำ
 * เขียนไฟล์กับป้ายใต้ล็อกเดียวกัน สองงานเสร็จพร้อมกันป้ายจะไม่ชี้ไปคนละชุดกับไฟล์
 * เก็บไม่สำเร็จไม่ทำให้คำตอบล้ม คนกดยังได้ตัวเลขของตัวเอง แค่คนอื่นยังเห็นชุดเดิม
 */
function sharedSave_(name, params, data, meta) {
  var pub = { at: Date.now(), by: meta.by || '', auto: !!meta.auto, ms: meta.ms || 0, params: params || null };
  data.shared = pub;
  var text = JSON.stringify(data);
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    try {
      var old = sharedProp_('shared:' + name);
      var file = null;
      if (old && old.file) {
        try { file = DriveApp.getFileById(old.file); if (file.isTrashed()) file = null; } catch (err) { file = null; }
      }
      if (file) {
        file.setContent(text);
      } else {
        var it = DriveApp.getFoldersByName(SHARED_FOLDER);
        var folder = it.hasNext() ? it.next() : DriveApp.createFolder(SHARED_FOLDER);
        file = folder.createFile(name + ' · ' + SpreadsheetApp.getActiveSpreadsheet().getName() + '.json', text, 'text/plain');
      }
      var keep = { file: file.getId(), size: text.length };
      Object.keys(pub).forEach(function (k) { keep[k] = pub[k]; });
      props.setProperty('shared:' + name, JSON.stringify(keep));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    data.sharedErr = 'เก็บเป็นข้อมูลกลางไม่สำเร็จ: ' + String(err && err.message || err);
  }
  return data;
}

/**
 * คิดใหม่แล้วเก็บ มีคนกำลังคิดชุดเดียวกันอยู่ ตอบ busy ให้หน้าเว็บรอชุดนั้นแทน
 * คิดซ้อนไม่ทำให้ตัวเลขผิด แต่กินโควตาเวลาของ Apps Script และทุกคนรอนานขึ้น
 * งานตั้งเวลาที่ล้มเก็บข้อความไว้ใน shared-err ไม่มีใครเห็นหน้าจอตอนนั้น จึงต้องบอกผ่านหน้าเว็บทีหลัง
 */
function sharedFresh_(name, params, who, compute) {
  var run = running_(name);
  if (run) return { app: SHARED_APP, busy: { at: run.at, by: run.by, auto: run.auto } };
  var props = PropertiesService.getScriptProperties();
  var started = Date.now();
  props.setProperty('shared-run:' + name, JSON.stringify({ at: started, by: who.by, auto: who.auto, params: params || null }));
  try {
    var data = compute();
    sharedSave_(name, params, data, { by: who.by, auto: who.auto, ms: Date.now() - started });
    props.deleteProperty('shared-err:' + name);
    return data;
  } catch (err) {
    if (who.auto) props.setProperty('shared-err:' + name, JSON.stringify({ at: Date.now(), msg: String(err && err.message || err).slice(0, 300) }));
    throw err;
  } finally {
    props.deleteProperty('shared-run:' + name);
  }
}

/** เปิดหน้าเว็บ ส่งชุดที่เก็บไว้ ถ้ามีคนกำลังคิดชุดใหม่อยู่ ส่งชุดเก่าไปก่อน ชุดใหม่หน้าเว็บจะโหลดเองตอนถามรอบถัดไป */
function sharedRead_(name, params, compute) {
  var kept = sharedLoad_(name, params, name === 'tx-fifo' ? SHARED_FIFO_MAX_MIN : SHARED_MAX_MIN);
  if (kept) return kept;
  if (running_(name)) {
    var old = sharedLoad_(name, params, 0);
    if (old) return old;
  }
  return sharedFresh_(name, params, { by: '', auto: true }, compute);
}

/** ปุ่มดึงใหม่ ชื่อคนกดมาจากเว็บ ตัดตัวที่ทำให้กลายเป็นสูตรออกเหมือนข้อความอื่นจากเว็บ */
function sharedPress_(req) {
  var who = { by: plain_(req.by, 60), auto: false };
  if (req.api === 'tx-summary') return sharedFresh_('tx-summary', null, who, summary_);
  if (req.api === 'tx-fifo') return sharedFresh_('tx-fifo', null, who, fifo_);
  if (req.api === 'tx-daily') {
    var from = String(req.from || ''), to = String(req.to || '');
    if (!/^(\d{4}-\d{2}-\d{2})?$/.test(from) || !/^(\d{4}-\d{2}-\d{2})?$/.test(to)) return { error: 'ช่วงวันที่ไม่ถูกต้อง' };
    return sharedFresh_('tx-daily', { from: from, to: to }, who, function () { return daily_(from, to); });
  }
  return { error: 'ไม่รู้จักข้อมูลชุดนี้' };
}

/** คำตอบสั้น ๆ ให้หน้าเว็บถามทุกนาที: ชุดล่าสุดเป็นของเวลาไหน ใครกด ใครกำลังคิดอยู่ งานตั้งเวลาล้มไหม */
function sharedAt_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = { app: SHARED_APP, at: Date.now(), shared: {}, run: {}, err: {} };
  SHARED_NAMES.forEach(function (n) {
    var i = sharedJson_(all, 'shared:' + n);
    if (i) out.shared[n] = { at: i.at, by: i.by, auto: i.auto, ms: i.ms, params: i.params };
    var r = sharedJson_(all, 'shared-run:' + n);
    if (r && Date.now() - r.at < SHARED_BUSY_MS) out.run[n] = { at: r.at, by: r.by, auto: r.auto };
    var e = sharedJson_(all, 'shared-err:' + n);
    if (e) out.err[n] = e;
  });
  return out;
}

function workHour_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = Number(Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'H'));
  return h >= SHARED_FROM_HOUR && h < SHARED_TO_HOUR;
}

/**
 * คิดทุกชุดใหม่ ยอดรายวันคิดเฉพาะช่วงวันที่ที่หน้าเช็ครายการตัดสต๊อกเปิดดูล่าสุด
 * ชุด FIFO คิดเมื่อชุดเดิมเก่าถึง SHARED_FIFO_EVERY_MIN (เผื่อ 5 นาทีให้ตรงกับรอบทุก 30 นาที) หรือยังไม่มี
 * ชุดหนึ่งล้มไม่ทำให้อีกชุดไม่ได้คิด ข้อความที่ล้มเก็บไว้ใน shared-err แล้ว
 */
function sharedAuto_() {
  var who = { by: '', auto: true };
  var done = [];
  try { if (!sharedFresh_('tx-summary', null, who, summary_).busy) done.push('ยอดคงเหลือ'); } catch (err) {}
  var d = sharedProp_('shared:tx-daily');
  if (d && d.params) {
    var from = String(d.params.from || ''), to = String(d.params.to || '');
    try {
      if (!sharedFresh_('tx-daily', { from: from, to: to }, who, function () { return daily_(from, to); }).busy) done.push('ยอดขายรายวัน');
    } catch (err) {}
  }
  var f = sharedProp_('shared:tx-fifo');
  if (!f || Date.now() - f.at >= (SHARED_FIFO_EVERY_MIN - 5) * 60000) {
    try { if (!sharedFresh_('tx-fifo', null, who, fifo_).busy) done.push('FIFO'); } catch (err) {}
  }
  return done;
}

/** ตัวตั้งเวลาเรียกฟังก์ชันนี้ นอกเวลางานไม่ทำอะไร */
function sharedTick() {
  if (!workHour_()) return;
  sharedAuto_();
}

/** กดรันครั้งเดียวจากหน้าแก้สคริปต์: ตั้งเวลาดึงข้อมูลกลางเอง แล้วเก็บชุดแรกให้ทันที เพื่อให้เห็นว่าใช้ได้ */
function installShared() {
  stopShared();
  ScriptApp.newTrigger('sharedTick').timeBased().everyMinutes(SHARED_EVERY_MIN).create();
  var done = sharedAuto_();
  return 'ตั้งเวลาแล้ว ทุก ' + SHARED_EVERY_MIN + ' นาที ช่วง ' + SHARED_FROM_HOUR + ':00 ถึง ' + SHARED_TO_HOUR + ':00'
    + ' / เก็บชุดแรกแล้ว: ' + (done.join(', ') || 'ไม่สำเร็จ ดูข้อความใน shared-err');
}

/** เลิกตั้งเวลา ชุดที่เก็บไว้ยังอยู่ ปุ่มดึงใหม่บนหน้าเว็บยังเก็บชุดกลางได้เหมือนเดิม */
function stopShared() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sharedTick') ScriptApp.deleteTrigger(t);
  });
}
