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
 * ?api=tx-daily&from=...&to=...  ยอดแถวขายราย SKU ราย วัน ให้หน้าเช็ครายการตัดสต๊อกเอาไปเทียบ
 * POST {op:'count-save'}   บันทึกผลนับ
 * POST {op:'count-add'}    ส่ง SKU ที่ยอดไม่ตรงระบบบริษัทเข้าใบนับ
 * ไม่ใส่ api               บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าตั้งค่าเช็คว่าใส่ URL ถูกตัว
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
    if (p.api === 'tx-summary') return out_(summary_());
    if (p.api === 'tx-history') return out_(history_(String(p.sku || '')));
    if (p.api === 'tx-count') return out_(countLoad_());
    if (p.api === 'tx-daily') return out_(daily_(String(p.from || ''), String(p.to || '')));
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
    if (/^location\s*เบิก/i.test(String(h[0]).trim()) && /^location\s*รับ/i.test(String(h[1]).trim())) return all[i];
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
        var c = closed[k] || (closed[k] = { sku: r.sku, lot: r.lot, po: r.po, loc: r.from, sold: 0, list: [] });
        c.sold += r.qty;
        c.list.push(r.row);
      }
    }
  });
  return closed;
}

function issues_(rows, bals, today) {
  var out = [];
  function add(kind, o) { o.kind = kind; out.push(o); }
  function head(x) { return { sku: x.sku, lot: x.lot, po: x.po, loc: x.loc }; }

  bals.forEach(function (x) {
    if (x.inBlank && x.inOpen) {
      add('mixed', merge_(merge_(head(x), { blank: x.inBlank, open: x.inOpen, out: x.out, bal: x.bal }), someRows_(x.inRows)));
    } else if (!x.inRows.length) {
      if (x.out) add('outonly', merge_(merge_(head(x), { bal: x.bal }), someRows_(x.outRows)));
    } else if (x.bal < 0) {
      add('negative', merge_(merge_(head(x), { bal: x.bal }), someRows_(x.inRows.concat(x.outRows).sort(function (p, q) { return p - q; }))));
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
    add('closedsale', merge_({ sku: c.sku, lot: c.lot, po: c.po, loc: c.loc, sold: c.sold }, someRows_(c.list)));
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
 */
function daily_(from, to) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = readRows_(ledgerSheet_(ss), tz);

  var out = {
    app: 'transaction', at: Date.now(), from: from, to: to, last: '',
    noDate: { rows: 0, qty: 0 }, noSku: { rows: 0, qty: 0 }, future: { rows: 0, qty: 0 }, badQty: { rows: 0 },
    skus: [], days: [], cells: [],
  };
  function skip(part, r) { part.rows++; part.qty += r.qty; }

  var tally = {}, skuIdx = {};
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
  });

  out.days = Object.keys(tally).sort();
  out.days.forEach(function (d, i) {
    Object.keys(tally[d]).forEach(function (k) {
      if (tally[d][k]) out.cells.push([i, skuIdx[k], tally[d][k]]);
    });
  });
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
