/**
 * stocktake-api.gs — นับสต๊อกใหญ่ (นับทั้งคลังเป็นรอบ ๆ) ใช้กับหน้า public/stocktake/
 *
 * ผูกกับไฟล์ Google Sheet ใหม่ที่สร้างไว้เก็บผลนับโดยเฉพาะ ไม่ใช่ไฟล์ Transaction
 * สคริปต์นี้ไม่รู้จักสมุด Transaction เลย ยอดตั้งต้นมาจากหน้าเว็บของหัวหน้า ซึ่งดึงจาก tx-api.gs อีกที
 * แล้วส่งมาเก็บไว้ที่นี่ สมุดจริงจึงไม่มีทางถูกแตะจากสคริปต์นี้
 *
 * แท็บที่สคริปต์สร้างเองตอนใช้ครั้งแรก (ไม่ต้องสร้างเอง)
 *   รอบนับ        หนึ่งแถวต่อหนึ่งรอบ ชื่อ วันที่ เวลาตัดยอด สถานะ
 *   ทีมและโซน     ทีม Inventory / คน Audit ของแต่ละรอบนับ และแถวที่ได้ไปนับ
 *   Location      Location ทั้งหมดที่ต้องนับในรอบนั้น พร้อมโซนกับแถว
 *   ยอดตั้งต้น    ยอดในสมุด ณ ตอนตัดยอด ราย Location × SKU × LOT × PO ดึงใหม่ได้ ชุดเก่าไม่ถูกลบ
 *   รายการสินค้า  SKU ทั้งคลังกับ PO → Supplier ให้ช่องพิมพ์ของคนนับมีรายการให้เลือก
 *   บันทึกนับ     ทุกกองที่คนนับกรอก ต่อท้ายอย่างเดียว แก้ = แถวใหม่ที่ชี้แถวเดิม ไม่ลบไม่ทับ
 *   ผลสรุป        (ขั้นวิเคราะห์) ยอดสุดท้ายราย Location × SKU × LOT × PO
 *   แผนนับรอบ 2   (ขั้นวิเคราะห์) รายการที่ต้องนับซ้ำ พร้อมเหตุผลและทีมที่ไปนับ
 *
 * รหัส
 *   HEAD_TOKEN  หัวหน้า: ตั้งรอบ ส่งยอดตั้งต้น แบ่งทีม ดูความคืบหน้า — ต้องตั้งก่อนใช้
 *   COUNT_TOKEN คนนับ: อ่านรายการ Location / SKU กับส่งผลนับ — ว่างไว้ได้ (ใช้แค่ URL)
 *               หน้าหัวหน้าได้รหัสนี้จากสคริปต์เอง แล้วใส่ในลิงก์ที่ส่งให้คนนับ
 *   คนนับไม่เคยได้ยอดในสมุด ต่อให้เปิดดูคำตอบของสคริปต์เอง และแต่ละทีมได้แค่แถวของทีมตัวเอง
 *
 * ?api=st-rounds&t=…             รายการรอบนับทั้งหมด (หัวหน้า)
 * ?api=st-head&round=…&t=…       ทุกอย่างของรอบ รวมยอดตั้งต้น (หัวหน้า)
 * ?api=st-log&round=…&since=…&t=…   แถวบันทึกนับหลังแถวที่ since ทุกทีม (หัวหน้า)
 * ?api=st-round&round=…&k=…      รอบ ทีม Location SKU PO สำหรับหน้ากรอก ไม่มียอดในสมุด (คนนับ)
 * ?api=st-mine&round=…&team=…&since=…&k=…   แถวบันทึกนับของทีมเดียว (คนนับ)
 * POST {op:'st-round-save'}  สร้าง / แก้รอบ (หัวหน้า)
 * POST {op:'st-baseline'}    เก็บยอดตั้งต้นชุดใหม่ (หัวหน้า)
 * POST {op:'st-teams'}       บันทึกทีม / โซน / Location ของรอบ (หัวหน้า)
 * POST {op:'st-status'}      เปลี่ยนสถานะรอบ เช่น เริ่มนับรอบ 1 (หัวหน้า)
 * POST {op:'st-count'}       ส่งผลนับเป็นชุด ส่งซ้ำได้ แถวที่เคยรับแล้วไม่ถูกเขียนซ้ำ (คนนับ)
 * ไม่ใส่ api                 บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าเว็บเช็คว่าใส่ URL ถูกตัว
 */

// รหัสหัวหน้า ตั้งเป็นคำที่เดายาก เช่น 'stock-หัวหน้า-2569' แล้วใส่คำเดียวกันในหน้านับสต๊อกใหญ่
var HEAD_TOKEN = '';
// รหัสในลิงก์ของคนนับ ว่างไว้ได้ ถ้าตั้ง คนที่มีแค่ URL สคริปต์จะส่งผลนับไม่ได้
var COUNT_TOKEN = '';

var T_ROUND = 'รอบนับ';
var T_TEAM = 'ทีมและโซน';
var T_LOC = 'Location';
var T_BASE = 'ยอดตั้งต้น';
var T_MASTER = 'รายการสินค้า';
var T_LOG = 'บันทึกนับ';
var T_SUM = 'ผลสรุป';
var T_PLAN = 'แผนนับรอบ 2';

/* หัวตาราง และคอลัมน์ที่ต้องเก็บเป็นข้อความ (เลขเริ่ม 1) ไม่งั้นชีตแปลงเอง: LOT 08 กลายเป็น 8 วันที่กลายเป็นอย่างอื่น */
var TABS = {};
TABS[T_ROUND] = {
  head: ['รหัสรอบ', 'ชื่อรอบ', 'วันที่นับ', 'เวลาตัดยอด', 'สถานะ', 'รอบนับที่เปิด', 'ยอดตั้งต้นชุดที่', 'ดึงยอดเมื่อ',
    'แถวสุดท้ายในสมุด', 'วันขายล่าสุดในสมุด', 'ตั้งค่า', 'สร้างโดย', 'สร้างเมื่อ', 'แก้ล่าสุดโดย', 'แก้ล่าสุดเมื่อ', 'อนุมัติโดย', 'อนุมัติเมื่อ'],
  text: [1, 2, 3, 4, 5, 8, 10, 11, 12, 13, 14, 15, 16, 17],
};
TABS[T_TEAM] = {
  head: ['รหัสรอบ', 'รอบนับ', 'รหัสทีม', 'ประเภท', 'ชื่อทีม', 'คนนับ', 'โซน', 'จำนวนโล', 'บันทึกโดย', 'บันทึกเมื่อ'],
  text: [1, 3, 4, 5, 6, 7, 9, 10],
};
TABS[T_LOC] = {
  head: ['รหัสรอบ', 'Location', 'โซน', 'แถว', 'ที่มา'],
  text: [1, 2, 3, 4, 5],
};
TABS[T_BASE] = {
  head: ['รหัสรอบ', 'ชุดที่', 'Location', 'SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'LOT', 'PO', 'ยอดในสมุด', 'เปิดขาย'],
  text: [1, 3, 4, 5, 6, 7, 8, 10],
};
TABS[T_MASTER] = {
  head: ['รหัสรอบ', 'ชนิด', 'รหัส', 'รหัสเต็ม / Supplier', 'ชื่อสินค้า'],
  text: [1, 2, 3, 4, 5],
};
TABS[T_LOG] = {
  head: ['บันทึกเมื่อ', 'รหัสรอบ', 'รอบนับ', 'รหัสทีม', 'ประเภท', 'คนนับ', 'Location', 'SKU', 'SKU เต็ม', 'LOT', 'PO',
    'จำนวน', 'ชนิด', 'แทนแถว', 'รหัสแถว', 'เครื่อง', 'เวลานับในเครื่อง'],
  text: [2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17],
};
TABS[T_SUM] = {
  head: ['รหัสรอบ', 'Location', 'SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'LOT', 'PO', 'ยอดในสมุด', 'Inventory นับได้', 'Audit นับได้',
    'รอบ 2 นับได้', 'ยอดสุดท้าย', 'ต่าง', 'กลุ่มปัญหา', 'เหตุผล', 'ทีม', 'คนนับ'],
  text: [1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17],
};
TABS[T_PLAN] = {
  head: ['รหัสรอบ', 'Location', 'SKU', 'เหตุผล', 'ทีมที่ไปนับ', 'ห้ามทีม', 'สถานะ'],
  text: [1, 2, 3, 4, 5, 6, 7],
};

var STATUS_SETUP = 'ตั้งค่า';
var STATUS_COUNT1 = 'นับรอบ 1';
var STATUS_CLOSED = 'ปิดแล้ว';
var STATUSES = [STATUS_SETUP, STATUS_COUNT1, 'วิเคราะห์', 'นับรอบ 2', STATUS_CLOSED];
var KINDS = ['Inventory', 'Audit'];
var TYPES = ['นับ', 'ว่าง', 'ยกเลิก'];   // แก้กอง = แถวนับใหม่ที่ชี้แถวเดิมในช่องแทนแถว ลบกอง = ยกเลิก
var BATCH_MAX = 200;                     // แถวต่อหนึ่งครั้งที่ส่ง หน้ากรอกส่งทีละไม่เกิน 40 อยู่แล้ว
var PILES_MAX = 40000;                   // กองในยอดตั้งต้น เกินนี้น่าจะส่งผิดของมา
var LOCK_MS = 30000;

/* ── ทางเข้า ─────────────────────────────────────────────────────────────── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api === 'st-rounds') { head_(p.t); return out_(rounds_()); }
    if (p.api === 'st-head') { head_(p.t); return out_(headView_(String(p.round || ''))); }
    if (p.api === 'st-log') { head_(p.t); return out_(logView_(String(p.round || ''), +p.since || 0, '')); }
    if (p.api === 'st-round') { counter_(p.k); return out_(countView_(String(p.round || ''))); }
    if (p.api === 'st-mine') {
      counter_(p.k);
      if (!p.team) return out_({ error: 'ไม่ได้บอกทีม' });
      return out_(logView_(String(p.round || ''), +p.since || 0, String(p.team)));
    }
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
  return out_({ app: 'stocktake' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.op === 'st-count') { counter_(req.k); return out_(count_(req)); }
    if (req.op === 'st-round-save') { head_(req.t); return out_(roundSave_(req)); }
    if (req.op === 'st-baseline') { head_(req.t); return out_(baseline_(req)); }
    if (req.op === 'st-teams') { head_(req.t); return out_(teams_(req)); }
    if (req.op === 'st-status') { head_(req.t); return out_(status_(req)); }
    return out_({ error: 'ไม่รู้จักคำสั่งนี้' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** หัวหน้าต้องมีรหัสเสมอ ไม่มีรหัสแปลว่าใครมี URL ก็เห็นยอดในสมุดก่อนนับ */
function head_(t) {
  if (!HEAD_TOKEN) throw new Error('ยังไม่ได้ตั้ง HEAD_TOKEN ใน Apps Script');
  if (String(t || '') !== HEAD_TOKEN) throw new Error('รหัสหัวหน้าไม่ถูก');
}

function counter_(k) {
  if (HEAD_TOKEN && String(k || '') === HEAD_TOKEN) return;
  if (COUNT_TOKEN && String(k || '') !== COUNT_TOKEN) throw new Error('ลิงก์นับไม่ถูก ขอลิงก์ใหม่จากหัวหน้า');
}

/* ── แท็บ ────────────────────────────────────────────────────────────────── */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** แท็บที่ยังไม่มีสร้างให้พร้อมหัวตาราง แท็บผลสรุปกับแผนรอบ 2 สร้างไว้เลยให้คนเปิดไฟล์เห็นครบ */
function tab_(name) {
  var ss = ss_();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name, ss.getSheets().length);
  var head = TABS[name].head;
  sheet.getRange(1, 1, 1, head.length).setValues([head]);
  sheet.setFrozenRows(1);
  return sheet;
}

function setup_() {
  [T_ROUND, T_TEAM, T_LOC, T_BASE, T_MASTER, T_LOG, T_SUM, T_PLAN].forEach(tab_);
}

/** แถวข้อมูลทั้งแท็บ (ไม่รวมหัว) ไม่มีแถวได้ [] */
function rows_(name) {
  var sheet = tab_(name);
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, TABS[name].head.length).getValues();
}

/**
 * เขียนต่อท้าย ตั้งคอลัมน์ข้อความเป็นข้อความก่อนเขียน
 * แถวไม่พอให้เพิ่มก่อน เขียนเกินขอบแท็บแล้ว Apps Script ไม่ขยายให้เอง
 */
function append_(name, list) {
  if (!list.length) return;
  var sheet = tab_(name);
  var cols = TABS[name].head.length;
  var at = sheet.getLastRow() + 1;
  var short = at + list.length - 1 - sheet.getMaxRows();
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
  TABS[name].text.forEach(function (c) { sheet.getRange(at, c, list.length, 1).setNumberFormat('@'); });
  sheet.getRange(at, 1, list.length, cols).setValues(list);
}

/**
 * แทนแถวของรอบนี้ทั้งชุด (ทีม / Location / รายการสินค้า เป็นค่าตั้ง ไม่ใช่บันทึก)
 * keep(row) = แถวของรอบนี้ที่ต้องเก็บไว้ เช่น ทีมของรอบนับอื่น
 * เขียนทั้งแท็บใหม่ภายใต้ล็อก แถวของรอบอื่นอยู่ครบตามเดิม
 */
function replace_(name, roundId, list, keep) {
  var sheet = tab_(name);
  var cols = TABS[name].head.length;
  var old = rows_(name);
  var stay = old.filter(function (r) { return text_(r[0]) !== roundId || (keep && keep(r)); });
  var all = stay.concat(list);
  if (old.length) sheet.getRange(2, 1, old.length, cols).clearContent();
  if (!all.length) return;
  var short = all.length + 1 - sheet.getMaxRows();
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
  TABS[name].text.forEach(function (c) { sheet.getRange(2, c, all.length, 1).setNumberFormat('@'); });
  sheet.getRange(2, 1, all.length, cols).setValues(all);
}

function text_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** ข้อความจากเว็บต้องไม่กลายเป็นสูตรในชีต */
function plain_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/^[=+\-@'\s]+/, '').slice(0, max).trim();
}

/** รหัสทีม / Location / SKU / LOT / PO ตัดช่องว่างหัวท้าย ตัวพิมพ์ใหญ่ ห้ามขึ้นต้นด้วยเครื่องหมายสูตร */
function code_(v, max) { return plain_(v, max).toUpperCase(); }

function num_(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

function ms_(v) { return v && typeof v.getTime === 'function' ? v.getTime() : (typeof v === 'number' ? v : 0); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var out = fn();
    SpreadsheetApp.flush();   // เขียนให้เสร็จก่อนปล่อยล็อก เครื่องถัดไปจะได้เห็นแถวครบ
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ── รอบนับ ──────────────────────────────────────────────────────────────── */

function roundOf_(r, i) {
  var settings = {};
  try { settings = JSON.parse(text_(r[10]) || '{}') || {}; } catch (e) { settings = {}; }
  return {
    row: i + 2,
    id: text_(r[0]), name: text_(r[1]), date: text_(r[2]), cutoff: text_(r[3]),
    status: text_(r[4]) || STATUS_SETUP, pass: +r[5] || 0,
    set: +r[6] || 0, pulledAt: text_(r[7]), lastRow: +r[8] || 0, lastDate: text_(r[9]),
    settings: settings,
    by: text_(r[11]), at: text_(r[12]), editBy: text_(r[13]), editAt: text_(r[14]),
    approvedBy: text_(r[15]), approvedAt: text_(r[16]),
  };
}

function allRounds_() {
  return rows_(T_ROUND).map(roundOf_).filter(function (r) { return r.id; });
}

function round_(id) {
  if (!id) throw new Error('ไม่ได้บอกรอบนับ');
  var hit = allRounds_().filter(function (r) { return r.id === id; })[0];
  if (!hit) throw new Error('ไม่พบรอบนับ ' + id);
  return hit;
}

function roundRow_(r) {
  return [r.id, r.name, r.date, r.cutoff, r.status, r.pass, r.set, r.pulledAt, r.lastRow, r.lastDate,
    JSON.stringify(r.settings || {}), r.by, r.at, r.editBy, r.editAt, r.approvedBy, r.approvedAt];
}

function writeRound_(r) {
  var sheet = tab_(T_ROUND);
  TABS[T_ROUND].text.forEach(function (c) { sheet.getRange(r.row, c, 1, 1).setNumberFormat('@'); });
  sheet.getRange(r.row, 1, 1, TABS[T_ROUND].head.length).setValues([roundRow_(r)]);
}

function stamp_() {
  var ss = ss_();
  return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function public_(r) {
  return {
    id: r.id, name: r.name, date: r.date, cutoff: r.cutoff, status: r.status, pass: r.pass,
    set: r.set, pulledAt: r.pulledAt, lastRow: r.lastRow, lastDate: r.lastDate, settings: r.settings,
    by: r.by, at: r.at, editBy: r.editBy, editAt: r.editAt, approvedBy: r.approvedBy, approvedAt: r.approvedAt,
  };
}

function rounds_() {
  setup_();
  return { app: 'stocktake', rounds: allRounds_().map(public_).reverse() };
}

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var CUTOFF_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;

/**
 * สร้างรอบใหม่ หรือแก้รอบเดิม (ส่ง id มา)
 * วันที่กับเวลาตัดยอดแก้ได้ตอนยังตั้งค่าอยู่เท่านั้น พอเริ่มนับแล้วยอดตั้งต้นผูกกับเวลานั้นไปแล้ว
 */
function roundSave_(req) {
  var x = req.round || {};
  var name = plain_(x.name, 80);
  if (!name) return { error: 'ตั้งชื่อรอบก่อน' };
  var date = text_(x.date), cutoff = text_(x.cutoff).replace('T', ' ');
  if (!DATE_RE.test(date)) return { error: 'วันที่นับต้องเป็นแบบ ปปปป-ดด-วว' };
  if (!CUTOFF_RE.test(cutoff)) return { error: 'เวลาตัดยอดต้องมีทั้งวันที่และเวลา' };
  var settings = x.settings && typeof x.settings === 'object' ? x.settings : {};
  if (JSON.stringify(settings).length > 4000) return { error: 'ค่าตั้งยาวเกินไป' };
  var who = plain_(req.by, 60);

  return withLock_(function () {
    var now = stamp_();
    if (x.id) {
      var r = round_(text_(x.id));
      if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว แก้ไม่ได้' };
      if (r.status !== STATUS_SETUP && (date !== r.date || cutoff !== r.cutoff)) {
        return { error: 'เริ่มนับแล้ว เปลี่ยนวันที่หรือเวลาตัดยอดไม่ได้' };
      }
      r.name = name; r.date = date; r.cutoff = cutoff; r.settings = settings;
      r.editBy = who; r.editAt = now;
      writeRound_(r);
      return { app: 'stocktake', round: public_(r) };
    }
    var tz = ss_().getSpreadsheetTimeZone();
    var base = Utilities.formatDate(new Date(), tz, 'yyMMdd');
    var taken = {};
    allRounds_().forEach(function (o) { taken[o.id] = 1; });
    var n = 1;
    while (taken['ST' + base + '-' + n]) n++;
    var fresh = {
      id: 'ST' + base + '-' + n, name: name, date: date, cutoff: cutoff, status: STATUS_SETUP, pass: 0,
      set: 0, pulledAt: '', lastRow: 0, lastDate: '', settings: settings,
      by: who, at: now, editBy: '', editAt: '', approvedBy: '', approvedAt: '',
    };
    append_(T_ROUND, [roundRow_(fresh)]);
    return { app: 'stocktake', round: public_(fresh) };
  });
}

/* ── ยอดตั้งต้น ─────────────────────────────────────────────────────────── */

/**
 * เก็บยอดตั้งต้นชุดใหม่ ชุดเก่าอยู่ในแท็บต่อไป (ใช้ย้อนดูว่าเคยดึงไปกี่รอบ ได้ตัวเลขอะไร)
 * piles = [[Location, SKU, SKU เต็ม, ชื่อสินค้า, LOT, PO, ยอด, เปิดขาย 0/1]] คิดจากสมุดโดยหน้าเว็บ (WmsStocktake.baseline)
 * skus = [[SKU, SKU เต็ม, ชื่อ]] pos = [[PO, Supplier]] แทนรายการเดิมของรอบนี้ทั้งชุด
 * ปิดรอบแล้วดึงใหม่ไม่ได้ ยอดที่อนุมัติไปแล้วต้องเทียบกับชุดเดิม
 */
function baseline_(req) {
  var piles = Array.isArray(req.piles) ? req.piles : null;
  if (!piles) return { error: 'ไม่มียอดตั้งต้น' };
  if (piles.length > PILES_MAX) return { error: 'ยอดตั้งต้นเกิน ' + PILES_MAX + ' กอง' };
  var bad = piles.filter(function (p) { return !Array.isArray(p) || num_(p[6]) === null || !text_(p[0]) || !text_(p[2]); }).length;
  if (bad) return { error: 'ยอดตั้งต้นมี ' + bad + ' กองที่ข้อมูลไม่ครบ' };
  var skus = Array.isArray(req.skus) ? req.skus : [];
  var pos = Array.isArray(req.pos) ? req.pos : [];
  var who = plain_(req.by, 60);

  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว ดึงยอดใหม่ไม่ได้' };
    var set = r.set + 1;
    append_(T_BASE, piles.map(function (p) {
      return [r.id, set, code_(p[0], 40), plain_(p[1], 60), plain_(p[2], 60), plain_(p[3], 200),
        plain_(p[4], 30), plain_(p[5], 40), p[6], p[7] ? 'เปิด' : ''];
    }));
    var master = [];
    skus.forEach(function (s) {
      if (Array.isArray(s) && text_(s[1])) master.push([r.id, 'SKU', plain_(s[0], 60), plain_(s[1], 60), plain_(s[2], 200)]);
    });
    pos.forEach(function (p) {
      if (Array.isArray(p) && text_(p[0])) master.push([r.id, 'PO', plain_(p[0], 40), plain_(p[1], 80), '']);
    });
    replace_(T_MASTER, r.id, master);
    r.set = set;
    r.pulledAt = stamp_();
    r.lastRow = +req.lastRow || 0;
    r.lastDate = plain_(req.lastDate, 20);
    r.editBy = who; r.editAt = r.pulledAt;
    writeRound_(r);
    return { app: 'stocktake', round: public_(r), piles: piles.length };
  });
}

function baseRows_(r) {
  return rows_(T_BASE).filter(function (b) { return text_(b[0]) === r.id && +b[1] === r.set; }).map(function (b) {
    return [text_(b[2]), text_(b[3]), text_(b[4]), text_(b[5]), text_(b[6]), text_(b[7]), +b[8] || 0, text_(b[9]) === 'เปิด' ? 1 : 0];
  });
}

function master_(id) {
  var out = { skus: [], pos: [] };
  rows_(T_MASTER).forEach(function (m) {
    if (text_(m[0]) !== id) return;
    if (text_(m[1]) === 'SKU') out.skus.push([text_(m[2]), text_(m[3]), text_(m[4])]);
    else if (text_(m[1]) === 'PO') out.pos.push([text_(m[2]), text_(m[3])]);
  });
  return out;
}

/* ── ทีม โซน Location ────────────────────────────────────────────────────── */

function split_(v) {
  return text_(v).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

function teamsOf_(id) {
  return rows_(T_TEAM).filter(function (t) { return text_(t[0]) === id; }).map(function (t) {
    return {
      pass: +t[1] || 1, id: text_(t[2]), kind: text_(t[3]), name: text_(t[4]),
      members: split_(t[5]), zones: split_(t[6]), locs: +t[7] || 0, by: text_(t[8]), at: text_(t[9]),
    };
  });
}

function locsOf_(id) {
  return rows_(T_LOC).filter(function (l) { return text_(l[0]) === id; }).map(function (l) {
    return [text_(l[1]), text_(l[2]), text_(l[3]), text_(l[4])];
  });
}

/**
 * บันทึกทีมของรอบนับหนึ่ง (pass) แทนชุดเดิมของรอบนับนั้น ทีมของรอบนับอื่นอยู่ครบ
 * teams = [{id, kind: Inventory|Audit, name, members:[ชื่อ], zones:[แถว], locs: จำนวนโล}]
 * locs = [[Location, โซน, แถว, ที่มา]] ส่งมาเมื่อรายการ Location เปลี่ยน ไม่ส่ง = ใช้ชุดเดิม
 * skip = แถวที่ไม่นับรอบนี้ (เช่น DOCKLOAD) เก็บในค่าตั้งของรอบ โลยังอยู่ในแท็บ Location เปลี่ยนใจทีหลังได้
 * แก้ระหว่างนับได้ (ย้ายแถวให้อีกทีม) แถวบันทึกนับเดิมยังผูกกับรหัสทีมเดิม
 */
function teams_(req) {
  var pass = +req.pass || 1;
  var list = Array.isArray(req.teams) ? req.teams : [];
  var seen = {};
  var clean = [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i] || {};
    var id = code_(t.id, 20);
    if (!id) return { error: 'ทีมที่ ' + (i + 1) + ' ไม่มีรหัส' };
    if (seen[id]) return { error: 'รหัสทีม ' + id + ' ซ้ำ' };
    seen[id] = 1;
    if (KINDS.indexOf(t.kind) < 0) return { error: 'ทีม ' + id + ' ต้องเป็น Inventory หรือ Audit' };
    clean.push({
      id: id, kind: t.kind, name: plain_(t.name, 60) || id,
      members: (Array.isArray(t.members) ? t.members : []).map(function (m) { return plain_(m, 40).replace(/,/g, ' '); }).filter(function (m) { return m; }),
      zones: (Array.isArray(t.zones) ? t.zones : []).map(function (z) { return code_(z, 30).replace(/,/g, ' '); }).filter(function (z) { return z; }),
      locs: +t.locs || 0,
    });
  }
  var locs = Array.isArray(req.locs) ? req.locs : null;
  var skip = Array.isArray(req.skip) ? req.skip.map(function (z) { return code_(z, 30); }).filter(function (z) { return z; }) : null;
  var who = plain_(req.by, 60);

  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว' };
    var now = stamp_();
    if (skip) {
      r.settings = r.settings || {};
      r.settings.skip = skip;
      r.editBy = who; r.editAt = now;
      writeRound_(r);
    }
    replace_(T_TEAM, r.id, clean.map(function (t) {
      return [r.id, pass, t.id, t.kind, t.name, t.members.join(', '), t.zones.join(', '), t.locs, who, now];
    }), function (row) { return +row[1] !== pass; });
    if (locs) {
      var dup = {};
      replace_(T_LOC, r.id, locs.filter(function (l) {
        var k = Array.isArray(l) ? code_(l[0], 40) : '';
        if (!k || dup[k]) return false;
        dup[k] = 1;
        return true;
      }).map(function (l) { return [r.id, code_(l[0], 40), code_(l[1], 20), code_(l[2], 30), plain_(l[3], 30)]; }));
    }
    return { app: 'stocktake', round: public_(r), teams: teamsOf_(r.id), locs: locsOf_(r.id).length };
  });
}

/**
 * เปลี่ยนสถานะรอบ ขั้นนี้มีแค่ ตั้งค่า ↔ นับรอบ 1 (วิเคราะห์ / รอบ 2 / ปิดรอบ มาทีหลัง)
 * เริ่มนับได้เมื่อมียอดตั้งต้นแล้ว และมีทีม Inventory อย่างน้อยหนึ่งทีม
 */
function status_(req) {
  var to = text_(req.status);
  if ([STATUS_SETUP, STATUS_COUNT1].indexOf(to) < 0) return { error: 'ยังเปลี่ยนเป็น ' + to + ' ไม่ได้' };
  var who = plain_(req.by, 60);
  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว' };
    if (to === STATUS_COUNT1) {
      if (!r.set) return { error: 'ยังไม่ได้ดึงยอดตั้งต้น' };
      var inv = teamsOf_(r.id).filter(function (t) { return t.pass === 1 && t.kind === 'Inventory'; });
      if (!inv.length) return { error: 'ยังไม่มีทีม Inventory ของรอบ 1' };
      if (!locsOf_(r.id).length) return { error: 'ยังไม่ได้บันทึกรายการ Location' };
      r.pass = Math.max(r.pass, 1);
    }
    r.status = to;
    r.editBy = who; r.editAt = stamp_();
    writeRound_(r);
    return { app: 'stocktake', round: public_(r) };
  });
}

/* ── มุมมอง ─────────────────────────────────────────────────────────────── */

/** ทุกอย่างของรอบให้หน้าหัวหน้า บันทึกนับดึงแยกด้วย st-log เพราะดึงเพิ่มทีละนิดได้ */
function headView_(id) {
  setup_();
  var r = round_(id);
  var m = master_(r.id);
  return {
    app: 'stocktake', round: public_(r), countKey: COUNT_TOKEN,
    teams: teamsOf_(r.id), locs: locsOf_(r.id), piles: baseRows_(r), skus: m.skus, pos: m.pos,
  };
}

/** หน้ากรอกของคนนับ ไม่มียอดในสมุดแม้แต่ช่องเดียว นับแบบไม่รู้ยอดจึงเป็นจริงไม่ว่าใครเปิดดูคำตอบ */
function countView_(id) {
  setup_();
  var r = round_(id);
  var m = master_(r.id);
  return {
    app: 'stocktake',
    round: { id: r.id, name: r.name, date: r.date, status: r.status, pass: r.pass, auditMin: +(r.settings && r.settings.auditMin) || 0 },
    teams: teamsOf_(r.id).map(function (t) { return { pass: t.pass, id: t.id, kind: t.kind, name: t.name, members: t.members, zones: t.zones }; }),
    locs: locsOf_(r.id).map(function (l) { return [l[0], l[2]]; }),
    skus: m.skus, pos: m.pos,
  };
}

/**
 * แถวบันทึกนับหลังแถวที่ since (เลขแถวในชีต) ของรอบนี้ team ว่าง = ทุกทีม
 * แถวในชีตต่อท้ายอย่างเดียว เลขแถวจึงใช้เป็นจุดอ่านต่อได้ หน้าเว็บขอเฉพาะของใหม่ทุกครั้ง
 * แถว = [เลขแถว, บันทึกเมื่อ (ms), รอบนับ, ทีม, ประเภท, คนนับ, Location, SKU, SKU เต็ม, LOT, PO, จำนวน, ชนิด, แทนแถว, รหัสแถว, เวลานับในเครื่อง]
 */
function logView_(id, since, team) {
  setup_();
  return withLock_(function () {
    var r = round_(id);
    return { app: 'stocktake', round: { id: r.id, status: r.status, pass: r.pass }, rows: logRows_(r.id, since, team), last: tab_(T_LOG).getLastRow() };
  });
}

function logRows_(id, since, team) {
  var sheet = tab_(T_LOG);
  var last = sheet.getLastRow();
  var from = Math.max(2, (since || 0) + 1);
  if (last < from) return [];
  var cols = TABS[T_LOG].head.length;
  return sheet.getRange(from, 1, last - from + 1, cols).getValues().map(function (c, i) {
    return { row: from + i, c: c };
  }).filter(function (x) {
    return text_(x.c[1]) === id && (!team || text_(x.c[3]) === team) && text_(x.c[14]);
  }).map(function (x) {
    var c = x.c;
    return [x.row, ms_(c[0]), +c[2] || 1, text_(c[3]), text_(c[4]), text_(c[5]), text_(c[6]), text_(c[7]), text_(c[8]),
      text_(c[9]), text_(c[10]), num_(c[11]), text_(c[12]), text_(c[13]), text_(c[14]), text_(c[16])];
  });
}

/* ── ส่งผลนับ ───────────────────────────────────────────────────────────── */

/**
 * รับผลนับเป็นชุดจากเครื่องคนนับ (เก็บในเครื่องก่อน ส่งเมื่อมีเน็ต)
 * item = {uid, pass, team, who, loc, sku, long, lot, po, qty, type: นับ|ว่าง|ยกเลิก, ref, at}
 * uid คือรหัสที่เครื่องตั้งให้แต่ละแถว ส่งซ้ำ (เน็ตหลุดก่อนได้คำตอบ) แถวเดิมจะไม่ถูกเขียนซ้ำ
 * 15 เครื่องส่งพร้อมกันได้ ทุกครั้งเขียนภายใต้ล็อกเดียว แถวไม่ทับกัน
 * คำตอบมีแถวของทีมนี้ที่ใหม่กว่า since ด้วย เครื่องของเพื่อนในทีมจะเห็นกันโดยไม่ต้องถามแยก
 */
function count_(req) {
  var items = Array.isArray(req.items) ? req.items : [];
  if (items.length > BATCH_MAX) return { error: 'ส่งได้ครั้งละไม่เกิน ' + BATCH_MAX + ' แถว' };
  var device = plain_(req.device, 40);

  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว ส่งผลนับไม่ได้' };
    if (!r.pass) return { error: 'รอบนี้ยังไม่เปิดนับ' };
    var teams = {};
    teamsOf_(r.id).forEach(function (t) { teams[t.pass + '|' + t.id] = t; });

    var sheet = tab_(T_LOG);
    var n = sheet.getLastRow() - 1;
    var have = {};
    if (n > 0) sheet.getRange(2, 15, n, 1).getValues().forEach(function (v) { if (text_(v[0])) have[text_(v[0])] = 1; });

    var now = new Date();
    var rows = [], rejected = [], dup = 0;
    items.forEach(function (i) {
      i = i || {};
      var uid = plain_(i.uid, 60);
      function no(why) { rejected.push({ uid: uid, why: why }); }
      if (!uid) return no('ไม่มีรหัสแถว');
      if (have[uid]) { dup++; return; }
      var pass = +i.pass || 1;
      if (pass > r.pass) return no('รอบนับ ' + pass + ' ยังไม่เปิด');
      var team = teams[pass + '|' + code_(i.team, 20)];
      if (!team) return no('ไม่มีทีม ' + i.team + ' ในรอบนับ ' + pass);
      var type = TYPES.indexOf(i.type) >= 0 ? i.type : '';
      if (!type) return no('ชนิดแถวไม่ถูก');
      var loc = code_(i.loc, 40);
      if (!loc) return no('ไม่มี Location');
      var ref = plain_(i.ref, 60);
      var qty = '';
      var sku = '', long = '', lot = '', po = '';
      if (type === 'นับ') {
        qty = num_(i.qty);
        if (qty === null || qty < 0) return no('จำนวนต้องเป็นตัวเลขไม่ติดลบ');
        sku = plain_(i.sku, 60); long = plain_(i.long, 60) || sku;
        if (!long) return no('ไม่มี SKU');
        lot = plain_(i.lot, 30); po = plain_(i.po, 40);
      } else if (type === 'ว่าง') {
        qty = 0;
      } else if (!ref) {
        return no('ยกเลิกต้องบอกแถวที่ยกเลิก');
      }
      have[uid] = 1;
      rows.push([now, r.id, pass, team.id, team.kind, plain_(i.who, 40), loc, sku, long, lot, po, qty, type, ref, uid, device, plain_(i.at, 30)]);
    });
    append_(T_LOG, rows);
    var since = +req.since || 0;
    return {
      app: 'stocktake', saved: rows.length, dup: dup, rejected: rejected,
      round: { id: r.id, status: r.status, pass: r.pass },
      rows: req.team ? logRows_(r.id, since, code_(req.team, 20)) : [],
      last: sheet.getLastRow(),
    };
  });
}
