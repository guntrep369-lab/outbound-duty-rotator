/**
 * tx-api.gs — อ่านชีต Transaction แล้วคิดยอดคงเหลือราย SKU / LOT / PO / Location
 *
 * ใช้กับหน้าสต๊อกราย Location (public/stock-location) — ใส่ URL ในหน้าตั้งค่า
 * ช่อง "Apps Script URL — Transaction" วิธีติดตั้งอยู่ใน README หัวข้อ
 * "Stock by Location"
 *
 * ผูกกับไฟล์ Google Sheet ที่มีชีต Transaction และไม่เขียนอะไรลงชีตเลย สมุดรายการ
 * เป็นของที่ทีมกรอกด้วยมือทุกวัน สคริปต์ที่แก้มันได้คือความเสี่ยงที่ไม่จำเป็น
 * ถ้าโค้ดนี้มีจุดผิด อย่างมากตัวเลขบนหน้าเว็บจะผิด ชีตยังอยู่ครบเหมือนเดิม
 *
 * ?api=tx-summary          ยอดคงเหลือทั้งคลัง ยอดขาย และจุดที่ข้อมูลผิด
 * ?api=tx-history&sku=...  ความเคลื่อนไหวของ SKU เดียว
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

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api === 'tx-summary') return out_(summary_());
    if (p.api === 'tx-history') return out_(history_(String(p.sku || '')));
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
  return out_({ app: 'transaction' });
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
      note: c[9] instanceof Date ? '' : text_(c[9]),
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
  if (note instanceof Date) return Utilities.formatDate(note, tz, 'yyyy-MM-dd');
  var m = /^GR\s*(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(text_(note));
  return m ? '20' + m[3] + '-' + pad_(m[2]) + '-' + pad_(m[1]) : '';
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

  var closed = {};
  var locs = {};
  var lastIn = {};   // Status ของแถวเข้าล่าสุด ณ แถวที่อ่านถึง ขายไปก่อนที่โลจะปิดไม่ถือว่าผิด
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
    if (r.type === 'ขาย' && !r.date) miss.push('วันที่ขาย');
    if (r.type !== 'ขาย' && !r.date && !r.note) miss.push('Note');
    if (!r.who) miss.push('ชื่อคนกรอก');
    if (miss.length) add('incomplete', { sku: r.sku, what: miss.join(', '), rows: [r.row], rowCount: 1 });

    if (r.long && r.to) lastIn[keyOf_(r.long, r.lot, r.po, r.to)] = r.open;
    if (r.type === 'ขาย' && r.from && r.long) {
      var k = keyOf_(r.long, r.lot, r.po, r.from);
      if (k in lastIn && (!lastIn[k] || /^(QA|IQA|RIB)$/.test(same_(r.from)))) {
        var c = closed[k] || (closed[k] = { sku: r.sku, lot: r.lot, po: r.po, loc: r.from, sold: 0, list: [] });
        c.sold += r.qty;
        c.list.push(r.row);
      }
    }
  });
  Object.keys(closed).forEach(function (k) {
    var c = closed[k];
    add('closedsale', merge_({ sku: c.sku, lot: c.lot, po: c.po, loc: c.loc, sold: c.sold }, someRows_(c.list)));
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
