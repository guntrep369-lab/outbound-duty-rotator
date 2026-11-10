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
 *   ผลสรุป        ยอดราย Location × SKU × LOT × PO ตอนกดบันทึกผล และยอดสุดท้ายที่อนุมัติตอนปิดรอบ
 *   แผนนับรอบ 2   โลที่ต้องนับซ้ำ เหตุผล ทีมที่ไปนับ และคนที่ห้ามนับ (คนที่นับโลนั้นในรอบ 1)
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
 * POST {op:'st-status'}      เปลี่ยนสถานะรอบ: ตั้งค่า ↔ นับรอบ 1 ↔ วิเคราะห์ ↔ นับรอบ 2 (หัวหน้า)
 * POST {op:'st-summary'}     เขียนผลวิเคราะห์ลงแท็บผลสรุป แทนชุดเดิมของรอบ (หัวหน้า)
 * POST {op:'st-plan'}        บันทึกแผนนับรอบ 2 และทีมของรอบนับ 2 (หัวหน้า)
 * POST {op:'st-close'}       อนุมัติยอดสุดท้ายและปิดรอบ เก็บชื่อคนอนุมัติกับเวลา ปิดแล้วแก้อะไรไม่ได้อีก (หัวหน้า)
 * POST {op:'st-round-del'}   ลบรอบ (รอบทดลอง / ตั้งผิด) ต้องพิมพ์ชื่อรอบยืนยัน ลบแถวของรอบออกจากทุกแท็บ (หัวหน้า)
 * POST {op:'st-day2'}        ตั้ง / ยกเลิกการแบ่งนับ 2 วัน: โซนกับโลเปิดที่นับวันที่ 2 (หัวหน้า)
 * POST {op:'st-day2-open'}   เปิดนับวันที่ 2 พร้อมรายการโลวันแรกที่ขยับ ต้องนับใหม่ (หัวหน้า)
 * POST {op:'st-count'}       ส่งผลนับเป็นชุด ส่งซ้ำได้ แถวที่เคยรับแล้วไม่ถูกเขียนซ้ำ (คนนับ)
 * POST {op:'st-open'}        เครื่องนี้เปิดโลไหนอยู่ ตอบว่ามีใครในงานเดียวกันเปิดโลนั้นอยู่ (คนนับ ไม่ลงชีต)
 * ไม่ใส่ api                 บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าเว็บเช็คว่าใส่ URL ถูกตัว
 *
 * ทุกคำตอบมี v = รุ่นของสคริปต์ หน้าเว็บเทียบกับรุ่นที่ต้องใช้ ลืม Deploy เวอร์ชันใหม่จะขึ้นแถบแดงบอก
 */

/* เพิ่มทีละ 1 ทุกครั้งที่หน้าเว็บต้องใช้ของใหม่จากสคริปต์ (ต้องตรงกับ API_V ใน public/wms-stocktake.js) */
var VERSION = 6;

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
/* แถว PO มี SKU กับ LOT ที่ PO นั้นเคยรับในสมุด (ไม่มียอด) หน้ากรอกใช้เตือนตอน PO / LOT ไม่เข้ากับ SKU */
TABS[T_MASTER] = {
  head: ['รหัสรอบ', 'ชนิด', 'รหัส', 'รหัสเต็ม / Supplier', 'ชื่อสินค้า', 'SKU ที่เคยรับ', 'LOT ที่เคยรับ'],
  text: [1, 2, 3, 4, 5, 6, 7],
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
  head: ['รหัสรอบ', 'Location', 'แถว', 'เหตุผล', 'ทีมที่ไปนับ', 'ห้ามคนนับ', 'ทีมรอบ 1', 'บันทึกเมื่อ'],
  text: [1, 2, 3, 4, 5, 6, 7, 8],
};

var STATUS_SETUP = 'ตั้งค่า';
var STATUS_COUNT1 = 'นับรอบ 1';
var STATUS_ANALYZE = 'วิเคราะห์';
var STATUS_COUNT2 = 'นับรอบ 2';
var STATUS_CLOSED = 'ปิดแล้ว';
var STATUSES = [STATUS_SETUP, STATUS_COUNT1, STATUS_ANALYZE, STATUS_COUNT2, STATUS_CLOSED];
/* รอบที่หัวหน้าลบแล้ว (st-round-del) ไม่อยู่ใน STATUSES ตั้งผ่าน st-status ไม่ได้ · แถวรอบยังอยู่ รหัสรอบจะได้ไม่ถูกใช้ซ้ำ */
var STATUS_DELETED = 'ลบแล้ว';
var KINDS = ['Inventory', 'Audit'];
var TYPES = ['นับ', 'ว่าง', 'ยกเลิก'];   // แก้กอง = แถวนับใหม่ที่ชี้แถวเดิมในช่องแทนแถว ลบกอง = ยกเลิก
var BATCH_MAX = 200;                     // แถวต่อหนึ่งครั้งที่ส่ง หน้ากรอกส่งทีละไม่เกิน 40 อยู่แล้ว
var PILES_MAX = 40000;                   // กองในยอดตั้งต้น เกินนี้น่าจะส่งผิดของมา
var PLAN_MAX = 20000;                    // โลในแผนนับรอบ 2
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
    if (req.op === 'st-open') { counter_(req.k); return out_(open_(req)); }
    if (req.op === 'st-round-save') { head_(req.t); return out_(roundSave_(req)); }
    if (req.op === 'st-baseline') { head_(req.t); return out_(baseline_(req)); }
    if (req.op === 'st-teams') { head_(req.t); return out_(teams_(req)); }
    if (req.op === 'st-status') { head_(req.t); return out_(status_(req)); }
    if (req.op === 'st-summary') { head_(req.t); return out_(summary_(req)); }
    if (req.op === 'st-plan') { head_(req.t); return out_(plan_(req)); }
    if (req.op === 'st-close') { head_(req.t); return out_(close_(req)); }
    if (req.op === 'st-round-del') { head_(req.t); return out_(roundDel_(req)); }
    if (req.op === 'st-day2') { head_(req.t); return out_(day2Set_(req)); }
    if (req.op === 'st-day2-open') { head_(req.t); return out_(day2Open_(req)); }
    return out_({ error: 'ไม่รู้จักคำสั่งนี้' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}

function out_(o) {
  if (o && typeof o === 'object' && !Array.isArray(o)) o.v = VERSION;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function now_() { return Date.now(); }

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
  if (hit.status === STATUS_DELETED) throw new Error('รอบนับ ' + id + ' ถูกหัวหน้าลบแล้ว ขอลิงก์ใหม่จากหัวหน้า');
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
  return { app: 'stocktake', rounds: allRounds_().filter(function (r) { return r.status !== STATUS_DELETED; }).map(public_).reverse() };
}

/**
 * ลบรอบ (รอบทดลอง / ตั้งผิด) หัวหน้าต้องส่งชื่อรอบมาตรงทุกตัว กันลบผิดรอบจากหน้าที่เปิดค้างไว้
 *   ทีมและโซน Location ยอดตั้งต้น รายการสินค้า ผลสรุป แผนรอบ 2: เอาแถวของรอบนี้ออก แถวรอบอื่นอยู่ครบ
 *   บันทึกนับ: ดู clearLog_
 *   แถวในแท็บรอบนับเหลือไว้ สถานะ "ลบแล้ว" — รหัสรอบมาจากวันที่สร้าง + ลำดับ ถ้าเอาแถวออก รอบที่สร้างวันเดียวกันจะได้รหัสเดิม
 *   แล้วมือถือที่เคยเปิดลิงก์เก่า (จำกองที่นับตามรหัสรอบ) จะเห็นกองของรอบที่ลบไปแล้ว
 */
function roundDel_(req) {
  var id = text_(req.round);
  var who = plain_(req.by, 60);
  return withLock_(function () {
    var r = round_(id);
    if (text_(req.confirm) !== r.name) return { error: 'ชื่อรอบที่พิมพ์ไม่ตรง ต้องพิมพ์ "' + r.name + '" ให้ตรงทุกตัว' };
    var rows = {};
    [T_TEAM, T_LOC, T_BASE, T_MASTER, T_SUM, T_PLAN].forEach(function (name) {
      var n = rows_(name).filter(function (x) { return text_(x[0]) === r.id; }).length;
      if (n) replace_(name, r.id, []);
      rows[name] = n;
    });
    var busy = allRounds_().some(function (o) {
      return o.id !== r.id && o.status !== STATUS_CLOSED && o.status !== STATUS_DELETED;
    });
    rows[T_LOG] = clearLog_(r.id, busy);
    r.status = STATUS_DELETED;
    r.settings = {};
    r.editBy = who;
    r.editAt = stamp_();
    writeRound_(r);
    return { app: 'stocktake', deleted: r.id, rows: rows, inPlace: busy };
  });
}

/**
 * แถวบันทึกนับของรอบที่ลบ หน้ากรอกกับหน้าหัวหน้าอ่านต่อจากเลขแถวสุดท้ายที่เคยเห็น (since)
 *   มีรอบอื่นยังไม่ปิด: ล้างแถวในที่เดิม เหลือคำว่า "ลบแล้ว" ช่องแรก เลขแถวของรอบอื่นไม่ขยับ แถวท้ายไม่หาย
 *   ไม่มีรอบไหนเปิดอยู่: เอาแถวออกจริง แท็บสะอาด
 * คืนจำนวนแถวของรอบนี้
 */
function clearLog_(id, inPlace) {
  var sheet = tab_(T_LOG);
  var cols = TABS[T_LOG].head.length;
  var old = rows_(T_LOG);
  var mine = function (c) { return text_(c[1]) === id; };
  var n = old.filter(mine).length;
  if (!n) return 0;
  var all;
  if (inPlace) {
    all = old.map(function (c) {
      if (!mine(c)) return c;
      var blank = c.map(function () { return ''; });
      blank[0] = STATUS_DELETED;
      return blank;
    });
  } else {
    all = old.filter(function (c) { return !mine(c); });
  }
  sheet.getRange(2, 1, old.length, cols).clearContent();
  if (!all.length) return n;
  TABS[T_LOG].text.forEach(function (c) { sheet.getRange(2, c, all.length, 1).setNumberFormat('@'); });
  sheet.getRange(2, 1, all.length, cols).setValues(all);
  return n;
}

var SETTINGS_MAX = 30000;   // ค่าตั้งของรอบเป็น JSON ในช่องเดียว (ช่องหนึ่งรับได้ 50,000 ตัวอักษร) แผนรอบ 2 อยู่ในนี้ด้วย
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
  if (JSON.stringify(settings).length > SETTINGS_MAX) return { error: 'ค่าตั้งยาวเกินไป' };
  var who = plain_(req.by, 60);

  return withLock_(function () {
    var now = stamp_();
    if (x.id) {
      var r = round_(text_(x.id));
      if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว แก้ไม่ได้' };
      if (r.status !== STATUS_SETUP && (date !== r.date || cutoff !== r.cutoff)) {
        return { error: 'เริ่มนับแล้ว เปลี่ยนวันที่หรือเวลาตัดยอดไม่ได้' };
      }
      /* การแบ่งนับ 2 วันแก้ผ่าน st-day2 เท่านั้น หน้าตั้งรอบที่เปิดค้างไว้ (ค่าตั้งชุดเก่า) ต้องไม่ทับ */
      var keep = r.settings && r.settings.day2;
      if (keep) settings.day2 = keep; else delete settings.day2;
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
 * skus = [[SKU, SKU เต็ม, ชื่อ]] pos = [[PO, Supplier, [SKU เต็มที่เคยรับ], [LOT ที่เคยรับ]]] แทนรายการเดิมของรอบนี้ทั้งชุด
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
      if (Array.isArray(s) && text_(s[1])) master.push([r.id, 'SKU', plain_(s[0], 60), plain_(s[1], 60), plain_(s[2], 200), '', '']);
    });
    var list = function (v) {
      return (Array.isArray(v) ? v : []).map(function (x) { return plain_(x, 60).replace(/,/g, ' '); }).filter(function (x) { return x; }).join(',').slice(0, 20000);
    };
    pos.forEach(function (p) {
      if (Array.isArray(p) && text_(p[0])) master.push([r.id, 'PO', plain_(p[0], 40), plain_(p[1], 80), '', list(p[2]), list(p[3])]);
    });
    /* ไฟล์ที่สร้างก่อนมีสองช่องหลัง หัวตารางยังไม่มี เขียนหัวใหม่ให้ครบ */
    tab_(T_MASTER).getRange(1, 1, 1, TABS[T_MASTER].head.length).setValues([TABS[T_MASTER].head]);
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
    else if (text_(m[1]) === 'PO') out.pos.push([text_(m[2]), text_(m[3]), split_(m[5]), split_(m[6])]);
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
 * เปลี่ยนสถานะรอบ
 *   ตั้งค่า → นับรอบ 1   ต้องมียอดตั้งต้น ทีม Inventory ของรอบ 1 และรายการ Location
 *   นับรอบ 1 → ตั้งค่า   พักไว้ก่อน (แก้ทีม / ดึงยอดใหม่) ผลนับที่ส่งแล้วอยู่ครบ
 *   นับรอบ 1 ↔ วิเคราะห์ ปิดรับนับรอบ 1 แล้วดูผล ย้อนกลับไปนับต่อได้ (จนกว่าจะเปิดรอบ 2)
 *   วิเคราะห์ ↔ นับรอบ 2 ต้องบันทึกแผนรอบ 2 ก่อน (มีทีมของรอบนับ 2) ปิดรับรอบ 2 แล้วกลับมาดูผลได้
 * ระหว่างวิเคราะห์ เครื่องที่ยังค้างส่ง (เน็ตหลุด) ส่งผลเข้ามาได้อยู่ ไม่ให้ของหาย
 * ปิดรอบไม่ใช้คำสั่งนี้ ต้องใช้ st-close ที่มีชื่อคนอนุมัติกับยอดสุดท้าย
 */
var NEXT_ = {};
NEXT_[STATUS_SETUP] = [STATUS_COUNT1];
NEXT_[STATUS_COUNT1] = [STATUS_SETUP, STATUS_ANALYZE];
NEXT_[STATUS_ANALYZE] = [STATUS_COUNT1, STATUS_COUNT2];
NEXT_[STATUS_COUNT2] = [STATUS_ANALYZE];

function status_(req) {
  var to = text_(req.status);
  if (!NEXT_[to]) return { error: 'ยังเปลี่ยนเป็น ' + to + ' ไม่ได้' };
  var who = plain_(req.by, 60);
  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว' };
    if (r.status !== to && (NEXT_[r.status] || []).indexOf(to) < 0) return { error: 'จาก ' + r.status + ' เปลี่ยนเป็น ' + to + ' ไม่ได้' };
    if (to === STATUS_COUNT1 && r.pass >= 2) return { error: 'เปิดนับรอบ 2 ไปแล้ว กลับไปนับรอบ 1 ไม่ได้' };
    if (to === STATUS_COUNT2) {
      var t2 = teamsOf_(r.id).filter(function (t) { return t.pass === 2 && t.zones.length; });
      if (!t2.length) return { error: 'ยังไม่ได้บันทึกแผนนับรอบ 2' };
      r.pass = 2;
    }
    if (to === STATUS_COUNT1) {
      if (!r.set) return { error: 'ยังไม่ได้ดึงยอดตั้งต้น' };
      var inv = teamsOf_(r.id).filter(function (t) { return t.pass === 1 && t.kind === 'Inventory'; });
      if (!inv.length) return { error: 'ยังไม่มีทีม Inventory ของรอบ 1' };
      if (!locsOf_(r.id).length) return { error: 'ยังไม่ได้บันทึกรายการ Location' };
      r.pass = Math.max(r.pass, 1);
      /* นับ 2 วัน: จำแถวสุดท้ายในสมุดตอนเริ่มวันแรก แถวหลังจากนี้ที่แตะโลวันแรก = โลนั้นขยับ ต้องนับใหม่ */
      if (r.settings && r.settings.day2 && !r.settings.day2.row1) r.settings.day2.row1 = r.lastRow;
    }
    if (to === STATUS_ANALYZE && r.status === STATUS_COUNT1) {
      var d2 = day2_(r);
      if (d2 && !d2.on) return { error: 'ยังไม่ได้เปิดนับวันที่ 2 (โลที่รอวันที่ 2 ยังไม่ได้นับ) เปิดก่อน หรือยกเลิกการแบ่ง 2 วันในแท็บทีม/โซน' };
    }
    r.status = to;
    r.editBy = who; r.editAt = stamp_();
    writeRound_(r);
    return { app: 'stocktake', round: public_(r) };
  });
}

/**
 * ผลวิเคราะห์ (หน้าหัวหน้าคิดจากยอดตั้งต้น + บันทึกนับ) เขียนลงแท็บผลสรุป แทนชุดเดิมของรอบนี้
 * lines = [[Location, SKU, SKU เต็ม, ชื่อ, LOT, PO, สมุด, Inventory, Audit, รอบ 2, ยอดสุดท้าย, ต่าง, กลุ่ม, เหตุผล, ทีม, คนนับ]]
 * ช่องตัวเลขเป็นตัวเลขหรือว่าง ข้อความทุกช่องตัดเครื่องหมายสูตรนำหน้า
 * แท็บนี้เป็นภาพตอนกดบันทึก ตัวเลขจริงยังคิดจากบันทึกนับเสมอ ไม่มีใครต้องแก้แท็บนี้มือ
 */
var SUM_NUM = [6, 7, 8, 9, 10, 11];

/* ── นับ 2 วัน ──────────────────────────────────────────────────────────────
 * วันแรกนับโลที่ไม่มีของขายออก (R กับโลปิด) Outbound ยังส่งของจากโลเปิดได้ · วันที่ 2 นับโลที่ยังขายอยู่ในวันแรก
 * ตัดยอดเช้าวันที่ 2 ครั้งเดียว ผลนับวันแรกเทียบกับยอดนั้นได้ถ้าโลนั้นไม่มีรายการในสมุดหลังเริ่มนับ (หน้าหัวหน้าเช็คจากสมุดตอนเปิดวันที่ 2)
 * ค่าตั้งของรอบ settings.day2 = { zones: [โซนที่นับวันที่ 2 ทั้งโซน], locs: [โลเปิดในโซนอื่น], openToo, row1: แถวสุดท้ายในสมุดตอนเริ่มวันแรก,
 *   on: 1 = เปิดนับวันที่ 2 แล้ว, at: เวลาที่เปิด (ms), moved: [โลวันแรกที่ขยับ นับใหม่วันที่ 2] }
 */
var DAY2_ZONES_MAX = 40;
var DAY2_LOCS_MAX = 3000;

function codes_(v, max) {
  var seen = {}, out = [];
  (Array.isArray(v) ? v : []).forEach(function (x) {
    var c = code_(x, max);
    if (c && !seen[c]) { seen[c] = 1; out.push(c); }
  });
  return out;
}

/** ค่าแบ่งวันของรอบ ไม่ได้แบ่ง = null */
function day2_(r) {
  var d = r.settings && r.settings.day2;
  if (!d || typeof d !== 'object') return null;
  var zones = codes_(d.zones, 20), locs = codes_(d.locs, 40);
  if (!zones.length && !locs.length && !d.openToo) return null;
  return { zones: zones, locs: locs, openToo: d.openToo ? 1 : 0, row1: +d.row1 || 0, on: d.on ? 1 : 0, at: +d.at || 0, moved: codes_(d.moved, 40) };
}

/** โลในรายการของรอบที่ยังนับไม่ได้ (รอวันที่ 2) → {โล: 1} เปิดวันที่ 2 แล้ว หรือไม่ได้แบ่งวัน = ว่าง */
function day2Wait_(r, d, locs) {
  var out = {};
  if (!d || d.on) return out;
  var z = {};
  d.zones.forEach(function (x) { z[x] = 1; });
  d.locs.forEach(function (l) { out[l] = 1; });
  (locs || locsOf_(r.id)).forEach(function (l) { if (z[l[1]]) out[l[0]] = 1; });
  return out;
}

/** สิ่งที่หน้ากรอกต้องรู้ทุกครั้งที่คุยกับสคริปต์: สถานะ รอบนับ และวันนับ (0 = นับวันเดียว) วันเปลี่ยน = โหลดรายการโลใหม่ */
function lite_(r) {
  var d = day2_(r);
  return { id: r.id, status: r.status, pass: r.pass, day: d ? (d.on ? 2 : 1) : 0 };
}

/** ตั้ง / ยกเลิก (day2 ว่าง) การแบ่งนับ 2 วัน ได้ตอนตั้งค่าหรือระหว่างนับรอบ 1 ก่อนเปิดวันที่ 2 */
function day2Set_(req) {
  var x = req.day2 && typeof req.day2 === 'object' ? req.day2 : null;
  var zones = x ? codes_(x.zones, 20) : [], locs = x ? codes_(x.locs, 40) : [];
  if (zones.length > DAY2_ZONES_MAX || locs.length > DAY2_LOCS_MAX) return { error: 'รายการนับวันที่ 2 ยาวเกินไป' };
  var who = plain_(req.by, 60);
  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status !== STATUS_SETUP && r.status !== STATUS_COUNT1) return { error: 'ตั้งแบ่งวันนับได้ตอนตั้งค่าหรือระหว่างนับรอบ 1 เท่านั้น' };
    var old = day2_(r);
    if (old && old.on) return { error: 'เปิดนับวันที่ 2 ไปแล้ว เปลี่ยนการแบ่งวันไม่ได้' };
    r.settings = r.settings || {};
    if (!x || (!zones.length && !locs.length && !x.openToo)) {
      delete r.settings.day2;
    } else {
      r.settings.day2 = {
        zones: zones, locs: locs, openToo: x.openToo ? 1 : 0,
        row1: (old && old.row1) || (r.status === STATUS_COUNT1 ? r.lastRow : 0),
      };
      if (JSON.stringify(r.settings).length > SETTINGS_MAX) return { error: 'โลเปิดที่ต้องนับวันที่ 2 เยอะเกินจะเก็บได้ ให้เลือกทั้งโซนแทน' };
    }
    r.editBy = who; r.editAt = stamp_();
    writeRound_(r);
    return { app: 'stocktake', round: public_(r) };
  });
}

/**
 * เปิดนับวันที่ 2 หน้าหัวหน้าดึงยอดสมุดชุดใหม่ (st-baseline) ก่อน แล้วส่งรายการโลวันแรกที่มีรายการในสมุดหลังเริ่มนับมา
 * โลพวกนั้นนับใหม่วันที่ 2 ผลนับวันแรกของโลนั้นหน้าเว็บไม่ใช้ (แถวในชีตอยู่ครบ) เปิดแล้วย้อนกลับไม่ได้
 */
function day2Open_(req) {
  var moved = codes_(req.moved, 40);
  if (moved.length > DAY2_LOCS_MAX) return { error: 'โลที่ขยับเยอะเกินไป (' + moved.length + ' โล) ตรวจว่าดึงสมุดถูกไฟล์' };
  var who = plain_(req.by, 60);
  return withLock_(function () {
    var r = round_(text_(req.round));
    var d = day2_(r);
    if (!d) return { error: 'รอบนี้ไม่ได้แบ่งนับ 2 วัน' };
    if (d.on) return { error: 'เปิดนับวันที่ 2 ไปแล้ว' };
    if (r.status !== STATUS_COUNT1) return { error: 'เปิดนับวันที่ 2 ได้ระหว่างนับรอบ 1 เท่านั้น' };
    var now = stamp_();
    r.settings.day2 = { zones: d.zones, locs: d.locs, openToo: d.openToo, row1: d.row1, on: 1, at: now_(), moved: moved, by: who, when: now };
    if (JSON.stringify(r.settings).length > SETTINGS_MAX) return { error: 'โลที่ขยับเยอะเกินจะเก็บได้ (' + moved.length + ' โล)' };
    r.editBy = who; r.editAt = now;
    writeRound_(r);
    return { app: 'stocktake', round: public_(r), moved: moved.length };
  });
}

/** ตรวจและทำความสะอาดแถวผลสรุป 16 ช่อง → {rows} หรือ {error} ใช้ทั้งบันทึกผลและปิดรอบ */
function sumClean_(lines, id) {
  if (!Array.isArray(lines)) return { error: 'ไม่มีแถวผลสรุป' };
  if (lines.length > PILES_MAX * 2) return { error: 'แถวผลสรุปเยอะเกินไป' };
  var clean = [];
  var n = function (v) { return v === null ? '' : v; };
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (!Array.isArray(l) || l.length !== 16) return { error: 'แถวผลสรุปที่ ' + (i + 1) + ' ไม่ครบ 16 ช่อง' };
    for (var j = 0; j < SUM_NUM.length; j++) {
      var v = l[SUM_NUM[j]];
      if (v !== '' && v !== null && num_(v) === null) return { error: 'แถวผลสรุปที่ ' + (i + 1) + ' ช่องตัวเลขไม่ใช่ตัวเลข' };
    }
    clean.push([id, code_(l[0], 40), plain_(l[1], 60), plain_(l[2], 60), plain_(l[3], 120), plain_(l[4], 30), plain_(l[5], 40),
      n(l[6]), n(l[7]), n(l[8]), n(l[9]), n(l[10]), n(l[11]), plain_(l[12], 30), plain_(l[13], 300), plain_(l[14], 60), plain_(l[15], 200)]);
  }
  return { rows: clean };
}

function summary_(req) {
  var id = text_(req.round);
  var who = plain_(req.by, 60);
  var c = sumClean_(Array.isArray(req.lines) ? req.lines : [], id);
  if (c.error) return c;
  var clean = c.rows;
  return withLock_(function () {
    var r = round_(id);
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว' };
    if (!r.pass) return { error: 'ยังไม่เริ่มนับ ยังไม่มีอะไรให้สรุป' };
    replace_(T_SUM, r.id, clean);
    r.settings = r.settings || {};
    r.settings.summaryAt = stamp_();
    r.settings.summaryBy = who;
    r.settings.summaryRows = clean.length;
    writeRound_(r);
    return { app: 'stocktake', saved: clean.length, round: public_(r) };
  });
}

/* ── นับรอบ 2 และปิดรอบ ────────────────────────────────────────────────── */

/** แผนรอบ 2 ของรอบนี้ → [[Location, แถว, เหตุผล, ทีม, [ห้ามคนนับ], ทีมรอบ 1]] */
function planOf_(id) {
  return rows_(T_PLAN).filter(function (p) { return text_(p[0]) === id && text_(p[1]); }).map(function (p) {
    return [text_(p[1]), text_(p[2]), text_(p[3]), text_(p[4]), split_(p[5]), text_(p[6])];
  });
}

/**
 * บันทึกแผนนับรอบ 2 (หน้าหัวหน้าคิดจากผลวิเคราะห์ WmsStocktake.plan2) แทนแผนเดิมของรอบทั้งชุด
 * plan = [[Location, แถว, เหตุผล, ทีม, [ห้ามคนนับ], ทีมรอบ 1, โซน]]  opts = ค่าตั้งที่ใช้คิด (เก็บไว้ในรอบ)
 * ทีมของรอบนับ 2 = ทีม Inventory ของรอบ 1 ชุดเดิม (รหัส ชื่อ คนเดิม) ได้รายการโลแทนแถว
 * โลในแผนที่ยังไม่มีในแท็บ Location (เช่น โลที่คนนับเจอของนอกรายการ) เพิ่มให้ ที่มา = รอบ 2
 * แก้แผนระหว่างนับรอบ 2 ได้ แถวที่นับไปแล้วยังผูกกับรหัสทีมเดิม
 */
function plan_(req) {
  var list = Array.isArray(req.plan) ? req.plan : null;
  if (!list) return { error: 'ไม่มีแผนนับรอบ 2' };
  if (list.length > PLAN_MAX) return { error: 'แผนรอบ 2 เกิน ' + PLAN_MAX + ' โล' };
  var opts = req.opts && typeof req.opts === 'object' ? req.opts : {};
  if (JSON.stringify(opts).length > SETTINGS_MAX / 2) return { error: 'ค่าตั้งรอบ 2 ยาวเกินไป ตัดโลที่เพิ่ม/ตัดออกเองให้น้อยลง' };
  var who = plain_(req.by, 60);

  return withLock_(function () {
    var r = round_(text_(req.round));
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว' };
    if (r.status !== STATUS_ANALYZE && r.status !== STATUS_COUNT2) return { error: 'ทำแผนรอบ 2 ได้หลังปิดรับนับรอบ 1 แล้วเท่านั้น' };
    var inv = {};
    teamsOf_(r.id).forEach(function (t) { if (t.pass === 1 && t.kind === 'Inventory') inv[t.id] = t; });
    var now = stamp_();
    var seen = {}, rows = [], zones = {}, order = [], newLocs = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!Array.isArray(p)) return { error: 'แผนแถวที่ ' + (i + 1) + ' ไม่ถูกรูปแบบ' };
      var loc = code_(p[0], 40);
      if (!loc) return { error: 'แผนแถวที่ ' + (i + 1) + ' ไม่มี Location' };
      if (seen[loc]) return { error: 'Location ' + loc + ' ซ้ำในแผน' };
      seen[loc] = 1;
      var team = code_(p[3], 20);
      if (!inv[team]) return { error: loc + ': ไม่มีทีม Inventory ' + (team || '(ว่าง)') + ' ในรอบ 1' };
      var forbid = (Array.isArray(p[4]) ? p[4] : split_(p[4])).map(function (m) { return plain_(m, 40).replace(/,/g, ' '); }).filter(function (m) { return m; });
      rows.push([r.id, loc, code_(p[1], 30), plain_(p[2], 300), team, forbid.join(', '), code_(p[5], 20), now]);
      if (!zones[team]) { zones[team] = []; order.push(team); }
      zones[team].push(loc);
      newLocs.push([loc, code_(p[6], 20), code_(p[1], 30)]);
    }
    replace_(T_PLAN, r.id, rows);
    replace_(T_TEAM, r.id, order.map(function (id) {
      var t = inv[id];
      return [r.id, 2, t.id, 'Inventory', t.name, t.members.join(', '), zones[id].join(', '), zones[id].length, who, now];
    }), function (row) { return +row[1] !== 2; });
    var have = {};
    locsOf_(r.id).forEach(function (l) { have[l[0]] = 1; });
    var add = newLocs.filter(function (l) { return !have[l[0]]; }).map(function (l) { return [r.id, l[0], l[1], l[2], 'รอบ 2']; });
    append_(T_LOC, add);
    r.settings = r.settings || {};
    r.settings.r2 = opts;
    r.settings.planAt = now;
    r.settings.planBy = who;
    r.settings.planRows = rows.length;
    r.editBy = who; r.editAt = now;
    writeRound_(r);
    return { app: 'stocktake', round: public_(r), plan: planOf_(r.id), teams: teamsOf_(r.id), added: add.length };
  });
}

/**
 * อนุมัติยอดสุดท้ายแล้วปิดรอบ หัวหน้าคนเดียวอนุมัติ ชื่อกับเวลาเก็บในแถวรอบ
 * lines = ยอดสุดท้าย 16 ช่อง (WmsStocktake.closeRows) แทนแท็บผลสรุปของรอบ เป็นตัวเลขที่อนุมัติ
 * ปิดแล้ว: ส่งผลนับ แก้ทีม แผน สถานะ ดึงยอดใหม่ไม่ได้อีก ไฟล์ปรับยอดสร้างจากแท็บผลสรุปนี้
 * สคริปต์นี้ไม่แตะสมุด Transaction คนลงสมุดปรับยอดตามไฟล์ Excel เอง
 */
function close_(req) {
  var approver = plain_(req.approver, 60);
  if (!approver) return { error: 'ใส่ชื่อคนอนุมัติก่อน' };
  var id = text_(req.round);
  var c = sumClean_(req.lines, id);
  if (c.error) return c;
  if (!c.rows.length) return { error: 'ไม่มียอดสุดท้ายให้อนุมัติ' };
  var t = req.totals && typeof req.totals === 'object' ? req.totals : {};
  var totals = {};
  ['lines', 'adjLines', 'book', 'final', 'plus', 'minus', 'net'].forEach(function (k) { totals[k] = num_(t[k]) === null ? 0 : t[k]; });
  var who = plain_(req.by, 60);

  return withLock_(function () {
    var r = round_(id);
    if (r.status === STATUS_CLOSED) return { error: 'รอบนี้ปิดแล้ว อนุมัติโดย ' + r.approvedBy + ' เมื่อ ' + r.approvedAt };
    if (r.status !== STATUS_ANALYZE && r.status !== STATUS_COUNT2) return { error: 'ปิดรอบได้หลังปิดรับนับรอบ 1 แล้วเท่านั้น' };
    replace_(T_SUM, r.id, c.rows);
    var now = stamp_();
    r.status = STATUS_CLOSED;
    r.approvedBy = approver;
    r.approvedAt = now;
    r.settings = r.settings || {};
    r.settings.closeTotals = totals;
    r.settings.summaryAt = now;
    r.settings.summaryBy = who;
    r.settings.summaryRows = c.rows.length;
    r.editBy = who; r.editAt = now;
    writeRound_(r);
    return { app: 'stocktake', round: public_(r), saved: c.rows.length };
  });
}

/** ผลสรุปของรอบ (16 ช่อง ไม่มีรหัสรอบ) ให้หน้าหัวหน้าหลังปิดรอบ ใช้สร้างไฟล์ปรับยอดได้ทุกเครื่อง */
function sumOf_(id) {
  return rows_(T_SUM).filter(function (s) { return text_(s[0]) === id; }).map(function (s) {
    var out = s.slice(1);
    return out.map(function (v, i) { return SUM_NUM.indexOf(i) >= 0 ? (num_(v) === null ? '' : v) : text_(v); });
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
    plan: planOf_(r.id), sum: r.status === STATUS_CLOSED ? sumOf_(r.id) : null,
  };
}

/** หน้ากรอกของคนนับ ไม่มียอดในสมุดแม้แต่ช่องเดียว นับแบบไม่รู้ยอดจึงเป็นจริงไม่ว่าใครเปิดดูคำตอบ */
function countView_(id) {
  setup_();
  var r = round_(id);
  var m = master_(r.id);
  /* นับ 2 วัน: วันแรกรายการโลไม่มีโลที่รอวันที่ 2 (ยังขายของออกอยู่ นับตอนนี้ตัวเลขใช้ไม่ได้) ส่งแยกไว้ให้หน้ากรอกกันคนเพิ่มโลพวกนี้เอง */
  var d = day2_(r);
  var all = locsOf_(r.id);
  var wait = day2Wait_(r, d, all);
  return {
    app: 'stocktake',
    round: { id: r.id, name: r.name, date: r.date, status: r.status, pass: r.pass, auditMin: +(r.settings && r.settings.auditMin) || 0, day: d ? (d.on ? 2 : 1) : 0 },
    teams: teamsOf_(r.id).map(function (t) { return { pass: t.pass, id: t.id, kind: t.kind, name: t.name, members: t.members, zones: t.zones }; }),
    locs: all.filter(function (l) { return !wait[l[0]]; }).map(function (l) { return [l[0], l[2]]; }),
    wait: all.filter(function (l) { return wait[l[0]]; }).map(function (l) { return [l[0], l[2]]; }),
    day2: d ? { zones: d.zones, on: d.on, at: d.at, moved: d.moved } : null,
    skus: m.skus, pos: m.pos,
    /* รอบ 2: โล + คนที่ห้ามนับซ้ำ (ไม่มีเหตุผล ไม่มีตัวเลข คนนับไม่รู้ว่าโลนี้ผิดอะไร) */
    plan: planOf_(r.id).map(function (p) { return [p[0], p[4]]; }),
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
    return { app: 'stocktake', round: lite_(r), rows: logRows_(r.id, since, team), last: tab_(T_LOG).getLastRow() };
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
    /* รอบ 2: คนที่นับโลนั้นในรอบ 1 ห้ามนับซ้ำ อ่านแผนครั้งเดียวต่อชุดเมื่อมีแถวรอบ 2 */
    var forbid = null;
    function banned(loc, who) {
      if (!forbid) {
        forbid = {};
        planOf_(r.id).forEach(function (p) { forbid[p[0]] = p[4].map(function (w) { return w.toUpperCase(); }); });
      }
      return (forbid[loc] || []).indexOf(String(who).toUpperCase()) >= 0;
    }

    /* นับ 2 วัน: โลที่รอวันที่ 2 ยังขายของออกอยู่ ผลนับวันแรกของโลพวกนี้ใช้ไม่ได้ ไม่รับ (อ่านรายการโลเมื่อเจอแถวแรกที่ต้องเช็คเท่านั้น) */
    var d2 = day2_(r), wait = null;
    function waiting(loc) {
      if (!d2 || d2.on) return false;
      if (!wait) wait = day2Wait_(r, d2);
      return !!wait[loc];
    }

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
      var who = plain_(i.who, 40).replace(/,/g, ' ');
      if (pass >= 2 && type !== 'ยกเลิก' && banned(loc, who)) return no(who + ' นับโล ' + loc + ' ในรอบ 1 แล้ว ให้คนอื่นนับ');
      if (pass === 1 && type !== 'ยกเลิก' && waiting(loc)) return no('โล ' + loc + ' นับวันที่ 2 ยังไม่เปิดให้นับ');
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
      rows.push([now, r.id, pass, team.id, team.kind, who, loc, sku, long, lot, po, qty, type, ref, uid, device, plain_(i.at, 30)]);
    });
    append_(T_LOG, rows);
    var since = +req.since || 0;
    return {
      app: 'stocktake', saved: rows.length, dup: dup, rejected: rejected,
      round: lite_(r),
      rows: req.team ? logRows_(r.id, since, code_(req.team, 20)) : [],
      last: sheet.getLastRow(),
    };
  });
}

/* ── ใครเปิดโลไหนอยู่ ─────────────────────────────────────────────────── */

var OPEN_MIN = 15;   // เปิดโลค้างไว้นานกว่านี้ถือว่าออกไปแล้ว

/**
 * เครื่องคนนับบอกว่าเปิดโลไหนอยู่ (loc ว่าง = ออกจากโลแล้ว) ตอบว่ามีใครในงานเดียวกัน
 * (รอบนับเดียวกัน ประเภทเดียวกัน Inventory / Audit) เปิดโลนี้อยู่บ้าง
 * กันสองคนในทีมนับโลเดียวกันโดยไม่รู้ตัว ยอดจะซ้ำเป็นสองเท่า
 * เก็บใน CacheService ไม่ลงชีต ไม่อ่านชีต ไม่ล็อก ตอบเร็ว · ชนกันพอดีแค่ทำให้เตือนพลาดหนึ่งครั้ง ไม่กระทบผลนับ
 * req = {round, pass, kind, who, device, loc}
 */
function open_(req) {
  var round = code_(req.round, 40), dev = plain_(req.device, 40);
  if (!round || !dev) return { error: 'ไม่ได้บอกรอบหรือเครื่อง' };
  var kind = KINDS.indexOf(req.kind) >= 0 ? req.kind : KINDS[0];
  var who = plain_(req.who, 40);
  var loc = code_(req.loc, 40);
  var cache = CacheService.getScriptCache();
  var now = now_(), ttl = OPEN_MIN * 60;
  var key = loc ? ['op', round, +req.pass || 1, kind, loc].join('|') : '';
  var mine = 'od|' + round + '|' + dev;

  function list(k) { try { return JSON.parse(cache.get(k) || '[]') || []; } catch (e) { return []; } }
  /* คนอื่นที่ยังเปิดอยู่ ตัดเครื่องนี้ออก ตัดที่เกินเวลาออก */
  function fresh(k) { return list(k).filter(function (x) { return x && x.d !== dev && now - x.t < ttl * 1000; }); }

  var prev = cache.get(mine) || '';
  if (prev && prev !== key) cache.put(prev, JSON.stringify(fresh(prev)), ttl);
  if (!key) { cache.remove(mine); return { app: 'stocktake', others: [] }; }
  var others = fresh(key);
  cache.put(key, JSON.stringify(others.concat([{ d: dev, w: who, t: now }]).slice(-6)), ttl);
  cache.put(mine, key, ttl);
  var me = who.toUpperCase();
  return {
    app: 'stocktake',
    others: others.filter(function (x) { return String(x.w).toUpperCase() !== me; })
      .map(function (x) { return { who: x.w, ago: Math.max(0, Math.round((now - x.t) / 60000)) }; }),
  };
}
