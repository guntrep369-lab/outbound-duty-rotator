/**
 * book-api.gs — สมุดสต๊อก ขั้น 1–3: รหัสคน เลขที่เอกสาร ตัดขาย ย้าย/เติม/QA คืนของ และสมุดใหม่เต็มตัว ใช้กับหน้า public/book/
 *
 * ผูกกับไฟล์ Google Sheet ใหม่ "WMS สมุดสต๊อก" ไม่ใช่ไฟล์ Transaction
 * สคริปต์นี้ไม่รู้จักสมุด Transaction เดิมเลย ไม่มี URL ไม่มีรหัสไฟล์ของมัน และไม่เปิดไฟล์อื่นนอกจากไฟล์ที่ตัวเองสร้าง
 * ยอดสต๊อกที่หน้าเว็บใช้คิดมาจาก tx-api.gs (อ่านอย่างเดียว) แล้วหน้าเว็บคัดลอกแถวให้คนไปวางในชีตเดิมเอง
 * สมุดจริงจึงไม่มีทางถูกแตะจากสคริปต์นี้
 *
 * แท็บที่สคริปต์สร้างเองตอนใช้ครั้งแรก
 *   ผู้ใช้          ชื่อ รหัส สิทธิ์ ใช้งาน — หัวหน้าพิมพ์เองในไฟล์ชีต
 *                  รหัสพิมพ์เป็นตัวเลข 4–8 หลัก ล็อกอินสำเร็จครั้งแรกสคริปต์เปลี่ยนเป็นรหัสลับ (#…) อ่านย้อนไม่ได้
 *                  ลืมรหัส = หัวหน้าพิมพ์เลขใหม่ทับช่องเดิม · สิทธิ์ หัวหน้า (หัวหน้าและรองหัวหน้า Inventory) หรือ ลงรายการ
 *                  ใช้งาน ใส่ ไม่ = ปิดสิทธิ์คนนั้น
 *   เลขที่เอกสาร    หนึ่งแถวต่อหนึ่งชุดที่บันทึก เลขรันเอง T + ปีเดือน + เลข 4 หลัก (T2611-0001) เริ่มใหม่ทุกเดือน ทุกประเภทใช้เลขชุดเดียวกัน
 *                  แถวสมุดตอนบันทึก = แถวสุดท้ายของสมุดที่หน้าเว็บเห็นตอนกดบันทึก ใช้เช็คว่าชุดนี้วางในชีตเดิมแล้วหรือยัง
 *   แถวที่คัดลอก    แถวที่คนต้องวางในชีตเดิม หนึ่งแถวต่อแถว (เลขที่ + A–J) เครื่องอื่นกดคัดลอกซ้ำได้
 *                  แท็บเลขที่เอกสารชี้มาด้วย @แถวเริ่ม+จำนวน · แยกแท็บเพราะช่องเดียวรับข้อความได้ไม่เกิน 50,000 ตัวอักษร
 *
 * ไฟล์ที่สคริปต์สร้างเอง: "WMS สมุดสต๊อก · ออเดอร์ที่ตัด ปี Qn" ไตรมาสละไฟล์
 *   แท็บ 2026-11       หนึ่งแถวต่อหนึ่งบรรทัดออเดอร์ที่ตัดขาย (ระบบ + ออเดอร์ + SKU) ใช้กันตัดซ้ำ และหาว่าตัดจากกองไหนตอนคืนของ
 *   แท็บ 2026-11 คืน   หนึ่งแถวต่อหนึ่งบรรทัดที่คืน ใช้กันคืนเกินที่ตัด
 *   แยกไฟล์เพราะออเดอร์วันละราว 3,000 บรรทัด ทั้งปีเกิน 10 ล้านช่องที่ไฟล์ Google Sheet ไฟล์เดียวรับได้
 *   รหัสไฟล์เก็บใน Script Properties (log|2026Q4) สคริปต์เปิดได้แค่ไฟล์ที่ตัวเองสร้าง
 *
 * ?api=bk-names            รายชื่อคนที่ใช้งานอยู่ (ไม่มีรหัส) ให้หน้าเว็บขึ้นช่องเลือกชื่อ
 * POST {op:'bk-login'}     เช็คชื่อกับรหัส ตอบสิทธิ์
 * POST {op:'bk-seen'}      บรรทัดออเดอร์ไหนตัดไปแล้ว เลขที่เอกสารอะไร
 * POST {op:'bk-cut'}       บันทึกชุดตัดขาย ได้เลขที่เอกสาร ส่งซ้ำด้วยรหัสชุดเดิมได้เลขเดิม บรรทัดที่ตัดไปแล้ว = ไม่รับทั้งชุด
 * POST {op:'bk-move'}      บันทึกชุดย้าย / เติม / QA (แถวเบิกที่มีทั้งโลเบิกและโลรับ)
 * POST {op:'bk-find'}      หาออเดอร์ที่ตัดขายไว้ จากเลขออเดอร์ เลขอ้างอิง หรือเลขพัสดุ ย้อน 3 เดือน พร้อมชิ้นที่คืนไปแล้ว
 * POST {op:'bk-return'}    บันทึกชุดคืนของ คืนเกินที่ตัด = ไม่รับทั้งชุด
 * POST {op:'bk-recent'}    ชุดที่บันทึกในไม่กี่วันล่าสุด พร้อมแถวที่คัดลอก
 * POST {op:'bk-void'}      ยกเลิกชุด (หัวหน้า) บรรทัดออเดอร์ของชุดนั้นตัดหรือคืนใหม่ได้ ต้องไปลบแถวเลขนั้นในชีตเดิมเอง
 * POST {op:'bk-rows'}      บันทึกชุดจากตารางแบบสมุดเดิม A–K ทุกประเภท (หัวหน้า) ใช้กับงานที่ยังไม่มีหน้าของตัวเอง
 * POST {op:'bk-state'}     โหมดตอนนี้ แถวใน Transaction ยอดยกมา Backup ล่าสุด
 * POST {op:'bk-stock'}     ยอดคงเหลือทุกกองในสมุดใหม่ (หน้าตั้งค่าใช้เทียบกับยอดสมุดเดิม)
 * POST {op:'bk-open'}      ลงยอดยกมา (หัวหน้า โหมดคัดลอกเท่านั้น) ลงใหม่ได้ด้วย replace
 * POST {op:'bk-mode'}      สลับโหมด คัดลอก ↔ บันทึก (หัวหน้า)
 * POST {op:'bk-rebuild'}   คิดแท็บยอดคงเหลือใหม่จากแท็บ Transaction ทั้งแท็บ (หัวหน้า)
 * POST {op:'bk-backup'}    สำรองแถวใหม่ของ Transaction ตอนนี้เลย (หัวหน้า) ปกติสคริปต์ทำเองทุกคืน
 * ไม่ใส่ api               บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าเว็บเช็คว่าใส่ URL ถูกตัว
 *
 * สองโหมด (ขั้น 3) เก็บใน Script Properties ชื่อ mode
 *   คัดลอก (ค่าเริ่มต้น)  ชีตเดิมยังเป็นตัวจริง ทุกชุดได้แถวให้คนคัดลอกไปวางในชีตเดิม แท็บ Transaction ในไฟล์นี้มีแค่ยอดยกมา
 *   บันทึก               หลังตัดรอบ ทุกชุดลงแท็บ Transaction ในไฟล์นี้เลย เช็คกองในแท็บยอดคงเหลือก่อนลง กองไม่พอ = ไม่รับทั้งชุด
 *                        แถวที่คัดลอกยังเก็บเหมือนเดิม ถ้าต้องถอยกลับไปใช้ชีตเดิม หัวหน้าคัดลอกชุดพวกนี้ไปวางต่อได้
 *   Transaction          คอลัมน์ตรงกับชีตเดิมทุกช่อง (A–K, L ว่าง, M NAME, N เลขที่, O เวลา) + P ประเภทชุด Q อ้างอิง R รหัสชุด
 *                        วันตัดรอบแค่เปลี่ยนลิงก์ใน IMPORTRANGE ของไฟล์ที่ tx-api.gs อ่าน หน้าอื่นใช้ได้เหมือนเดิม
 *                        ทีมเปิดไฟล์นี้แบบดูอย่างเดียว ลงรายการผ่านหน้าเว็บเท่านั้น
 *   ยอดคงเหลือ           หนึ่งแถวต่อกอง (โล SKU LOT PO) สคริปต์คิดใหม่ทุกครั้งที่ลง Transaction
 *   Backup               ทุกคืนต่อท้ายแถวใหม่ของ Transaction ลงไฟล์ "WMS สมุดสต๊อก · สำรอง ปี Qn" ที่สคริปต์สร้างเอง
 *                        ตั้งเวลาครั้งเดียว: หน้าแก้สคริปต์ เลือกฟังก์ชัน installBackup แล้วกด Run
 *
 * ทุกคำตอบมี v = รุ่นของสคริปต์ หน้าเว็บเทียบกับรุ่นที่ต้องใช้ ลืม Deploy เวอร์ชันใหม่จะขึ้นแถบแดงบอก
 */

/* เพิ่มทีละ 1 ทุกครั้งที่หน้าเว็บต้องใช้ของใหม่จากสคริปต์ (ต้องตรงกับ API_V ใน public/wms-book.js) */
var VERSION = 3;

var T_USER = 'ผู้ใช้';
var T_DOC = 'เลขที่เอกสาร';
var T_COPY = 'แถวที่คัดลอก';
var T_TX = 'Transaction';
var T_BAL = 'ยอดคงเหลือ';

var TABS = {};
TABS[T_USER] = {
  head: ['ชื่อ', 'รหัส', 'สิทธิ์', 'ใช้งาน', 'หมายเหตุ'],
  text: [1, 2, 3, 4, 5],
};
TABS[T_DOC] = {
  head: ['เลขที่', 'ประเภท', 'วันที่', 'ผู้ลง', 'บันทึกเมื่อ', 'แถว', 'ชิ้น', 'ออเดอร์', 'สถานะ', 'ยกเลิกโดย', 'ยกเลิกเมื่อ',
    'เหตุผล', 'รหัสชุด', 'ไฟล์', 'แถวที่คัดลอก', 'แถวสมุดตอนบันทึก', 'แถว Transaction'],
  text: [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 17],
};
TABS[T_COPY] = {
  head: ['เลขที่', 'SKU', 'SKU เต็ม', 'LOT', 'PO', 'โลเบิก', 'โลรับ', 'ชิ้น', 'ประเภท', 'Note', 'Status'],
  text: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11],
};
/* คอลัมน์ตรงกับชีต Transaction เดิม (L เป็นช่องสูตรในชีตเดิม ที่นี่ปล่อยว่าง) LOT PO ไม่ตั้งเป็นข้อความ จะได้เป็นตัวเลขแบบที่คนวางในชีตเดิม */
TABS[T_TX] = {
  head: ['SKU', 'SKU', 'Product Name', 'LOT', 'PO', 'Location เบิก', 'Location รับ', 'QTY', 'รับ/เบิก', 'Note', 'Status', '-',
    'NAME', 'RUNNUMBER', 'Time', 'ประเภทชุด', 'อ้างอิง', 'รหัสชุด'],
  text: [1, 2, 3, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
};
TABS[T_BAL] = {
  head: ['Location', 'SKU', 'SKU เต็ม', 'LOT', 'PO', 'ยอด', 'Status', 'วันรับแรก', 'แถวล่าสุด'],
  text: [1, 2, 3, 4, 5, 7, 8],
};
/* แท็บเดือนในไฟล์ออเดอร์ที่ตัด — สองคอลัมน์แรกคือที่ต้องอ่านทุกครั้งที่เช็คตัดซ้ำ จึงอยู่ติดกันทางซ้าย */
var LOG = {
  head: ['เลขที่', 'สถานะ', 'ระบบ', 'ออเดอร์', 'SKU', 'ชิ้น', 'วันที่ตัด', 'เลขอ้างอิง', 'กองที่ตัด (โล|LOT|PO|ชิ้น)', 'ผู้ลง', 'บันทึกเมื่อ',
    'เลขพัสดุ'],
  text: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12],
};
var RET = {
  head: ['เลขที่', 'สถานะ', 'ระบบ', 'ออเดอร์', 'SKU', 'ชิ้น', 'วันที่คืน', 'เลขอ้างอิง', 'คืนเข้ากอง (โล|LOT|PO|ชิ้น)', 'ผู้ลง', 'บันทึกเมื่อ',
    'เลขพัสดุ', 'เลขที่ตัด'],
  text: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13],
};
var RET_SUFFIX = ' คืน';

var ROLE_HEAD = 'หัวหน้า';
var ROLE_USER = 'ลงรายการ';
var VOID = 'ยกเลิก';
var TYPE_SALE = 'ตัดขาย';
var TYPE_MOVE = 'ย้าย';
var TYPE_RET = 'คืน';
var TYPE_ROWS = 'ตารางเดิม';
var TYPE_OPEN = 'ยอดยกมา';
var MODE_BOOK = 'book';
var MODE_COPY = 'copy';
var TX_TYPES = ['รับ', 'เบิก', 'ขาย'];
var SYSTEMS = ['JST', 'CRM'];
var MOVE_NOTES = ['โอนย้าย', 'โอนย้าย QA'];
var LINES_MAX = 8000;      // บรรทัดออเดอร์ต่อชุด ไฟล์ JST ทั้งวันราว 2,400 บรรทัด
var ROWS_MAX = 3000;       // แถวที่คัดลอกต่อชุด (ต่อ SKU ต่อกอง) ตัดขายทั้งวันราว 350
var PILES_MAX = 20;        // กองต่อหนึ่งบรรทัดออเดอร์
var KEYS_MAX = 2000;       // เลขที่หาได้ต่อครั้ง (bk-find)
var HITS_MAX = 50;         // บรรทัดที่ตอบต่อหนึ่งเลข
var FIND_MONTHS = 3;       // หาออเดอร์ย้อนกี่เดือน (เดือนนี้ + 2 เดือนก่อน)
var BAD_MAX = 5;           // ใส่รหัสผิดกี่ครั้งถึงพัก
var BAD_MIN = 10;          // พักกี่นาที
var BACK_DAYS = 45;        // วันที่ตัดย้อนหลังได้ไม่เกินกี่วัน
var RECENT_MAX = 7;        // bk-recent ย้อนได้ไม่เกินกี่วัน
var LOCK_MS = 30000;
var OPEN_MAX = 40000;      // แถวยอดยกมา (กองที่มีของ) ราว 5,000–15,000 กอง
var NAMES_MAX = 5000;      // ชื่อสินค้าที่ส่งมากับชุด
var BACKUP_ROWS = 20000;   // แถวที่สำรองต่อครั้ง เกินนี้ทำต่อคืนถัดไป (หรือกดสำรองซ้ำ)

/* ── ทางเข้า ─────────────────────────────────────────────────────────────── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api === 'bk-names') return out_({ app: 'book', names: names_() });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
  return out_({ app: 'book' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.op === 'bk-login') { var u = auth_(req); return out_({ app: 'book', who: u.name, role: u.role, mode: mode_() }); }
    if (req.op === 'bk-state') { auth_(req); return out_(state_()); }
    if (req.op === 'bk-stock') { auth_(req); return out_(stock_()); }
    if (/^bk-(rows|open|mode|rebuild|backup)$/.test(String(req.op))) {
      var hd = auth_(req);
      if (hd.role !== ROLE_HEAD) return out_({ error: 'คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า' });
      if (req.op === 'bk-rows') return out_(rowsSave_(req, hd));
      if (req.op === 'bk-open') return out_(open_(req, hd));
      if (req.op === 'bk-mode') return out_(setMode_(req, hd));
      if (req.op === 'bk-rebuild') return out_(withLock_(function () { return rebuild_(); }));
      return out_(withLock_(function () { return backup_(); }));
    }
    if (req.op === 'bk-seen') { auth_(req); return out_(seen_(req)); }
    if (req.op === 'bk-cut') { var c = auth_(req); return out_(cut_(req, c)); }
    if (req.op === 'bk-move') { var m = auth_(req); return out_(move_(req, m)); }
    if (req.op === 'bk-find') { auth_(req); return out_(find_(req)); }
    if (req.op === 'bk-return') { var r = auth_(req); return out_(return_(req, r)); }
    if (req.op === 'bk-recent') { auth_(req); return out_(recent_(req)); }
    if (req.op === 'bk-void') {
      var h = auth_(req);
      if (h.role !== ROLE_HEAD) return out_({ error: 'ยกเลิกชุดได้เฉพาะหัวหน้ากับรองหัวหน้า' });
      return out_(void_(req, h));
    }
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

/* ── แท็บ ────────────────────────────────────────────────────────────────── */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }

function tab_(name) {
  var ss = ss_();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name, ss.getSheets().length);
  head_(sheet, TABS[name]);
  return sheet;
}

/** หัวตาราง แถวแรกตรึงไว้ คอลัมน์ข้อความตั้งเป็นข้อความทั้งคอลัมน์ (PO 0 กับ LOT 0 ไม่หาย) */
function head_(sheet, spec) {
  sheet.getRange(1, 1, 1, spec.head.length).setValues([spec.head]);
  sheet.setFrozenRows(1);
  spec.text.forEach(function (c) { sheet.getRange(2, c, sheet.getMaxRows() - 1, 1).setNumberFormat('@'); });
}

/** รันครั้งเดียวจากหน้าแก้สคริปต์ก็ได้ ให้เห็นแท็บผู้ใช้ก่อนมีคนล็อกอิน (ใช้งานจริงสคริปต์สร้างเองอยู่แล้ว) */
function setup() { [T_USER, T_DOC, T_COPY, T_TX, T_BAL].forEach(tab_); }

function rows_(sheet, cols) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, cols).getValues();
}

/** เขียนต่อท้าย ตั้งคอลัมน์ข้อความก่อนเขียน แถวไม่พอให้เพิ่มก่อน (Apps Script ไม่ขยายแท็บให้เอง) คืนแถวแรกที่เขียน */
function append_(sheet, spec, list) {
  if (!list.length) return 0;
  var at = sheet.getLastRow() + 1;
  var short = at + list.length - 1 - sheet.getMaxRows();
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
  spec.text.forEach(function (c) { sheet.getRange(at, c, list.length, 1).setNumberFormat('@'); });
  sheet.getRange(at, 1, list.length, spec.head.length).setValues(list);
  return at;
}

function text_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** ข้อความจากเว็บต้องไม่กลายเป็นสูตรในชีต */
function plain_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/^[=+\-@'\s]+/, '').slice(0, max).trim();
}

/** รหัส SKU / ออเดอร์ / Location / PO ตัวพิมพ์ใหญ่ ห้ามขึ้นต้นด้วยเครื่องหมายสูตร (PO 0 กับ LOT 0 ต้องอยู่ครบ) */
function code_(v, max) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  return (/^[=+@']/.test(s) ? s.replace(/^[=+@'\s]+/, '') : s).slice(0, max).toUpperCase();
}

function num_(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

function stamp_() { return Utilities.formatDate(new Date(now_()), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(now_()), tz_(), 'yyyy-MM-dd'); }

function dayNo_(d) {
  var p = String(d).split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ── คนและรหัส ────────────────────────────────────────────────────────────── */

function users_() {
  var sheet = tab_(T_USER);
  return rows_(sheet, TABS[T_USER].head.length).map(function (r, i) {
    var role = text_(r[2]);
    return {
      row: i + 2, name: text_(r[0]), pin: text_(r[1]),
      role: /หัวหน้า/.test(role) ? ROLE_HEAD : ROLE_USER,
      on: !/^(ไม่|no|n|0|false|ปิด)$/i.test(text_(r[3])),
    };
  }).filter(function (u) { return u.name; });
}

function names_() {
  return users_().filter(function (u) { return u.on; }).map(function (u) { return u.name; });
}

/** เกลือของรหัส สุ่มครั้งเดียวเก็บใน Script Properties รหัสลับในแท็บจะได้เดาจากตารางสำเร็จรูปไม่ได้ */
function salt_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('salt');
  if (!s) { s = Utilities.getUuid(); props.setProperty('salt', s); }
  return s;
}

function hash_(name, pin) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt_() + '|' + name.toUpperCase() + '|' + pin, Utilities.Charset.UTF_8);
  return '#' + b.map(function (x) { var h = ((x + 256) % 256).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
}

/**
 * เช็คชื่อกับรหัสของทุกคำขอที่เขียนหรืออ่านออเดอร์
 * ผิดเกิน BAD_MAX ครั้งพักชื่อนั้น BAD_MIN นาที (เก็บใน CacheService)
 * รหัสในแท็บที่ยังเป็นตัวเลขธรรมดา (หัวหน้าเพิ่งพิมพ์) ล็อกอินถูกแล้วเปลี่ยนเป็นรหัสลับทันที
 */
function auth_(req) {
  var who = plain_(req.who, 40), pin = text_(req.pin);
  if (!who || !pin) throw new Error('ต้องเลือกชื่อและใส่รหัสก่อน');
  var list = users_();
  if (!list.length) throw new Error('ยังไม่มีรายชื่อคน ให้หัวหน้าเปิดไฟล์ WMS สมุดสต๊อก แท็บ ผู้ใช้ แล้วใส่ ชื่อ รหัส สิทธิ์');
  var u = list.filter(function (x) { return x.name.toUpperCase() === who.toUpperCase(); })[0];
  if (!u || !u.on) throw new Error('ไม่มีชื่อ ' + who + ' ในรายชื่อที่ใช้งานอยู่');
  var cache = CacheService.getScriptCache();
  var bk = 'bad|' + u.name.toUpperCase();
  var bad = +(cache.get(bk) || 0);
  if (bad >= BAD_MAX) throw new Error('ใส่รหัสผิดหลายครั้ง รอ ' + BAD_MIN + ' นาทีแล้วลองใหม่ หรือให้หัวหน้าตั้งรหัสใหม่');
  var ok = false;
  if (/^#/.test(u.pin)) ok = hash_(u.name, pin) === u.pin;
  else if (/^\d{4,8}$/.test(u.pin)) {
    ok = pin === u.pin;
    if (ok) {
      var cell = tab_(T_USER).getRange(u.row, 2, 1, 1);
      cell.setNumberFormat('@');
      cell.setValues([[hash_(u.name, pin)]]);
    }
  } else {
    throw new Error('รหัสของ ' + u.name + ' ในแท็บผู้ใช้ต้องเป็นตัวเลข 4–8 หลัก ให้หัวหน้าตั้งใหม่');
  }
  if (!ok) {
    cache.put(bk, String(bad + 1), BAD_MIN * 60);
    throw new Error('รหัสไม่ถูก (ผิดได้อีก ' + Math.max(0, BAD_MAX - bad - 1) + ' ครั้ง)');
  }
  if (bad) cache.remove(bk);
  return u;
}

/* ── ไฟล์ออเดอร์ที่ตัด ───────────────────────────────────────────────────── */

/** '2026-11-10' → { ym: '2026-11', q: '2026Q4' } */
function period_(day) {
  var y = +day.slice(0, 4), m = +day.slice(5, 7);
  return { ym: day.slice(0, 7), q: y + 'Q' + Math.ceil(m / 3), y: y, m: m };
}

function prevYm_(ym) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
  if (m < 1) { m = 12; y--; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

/** ['2026-11', '2026-10', '2026-09'] */
function monthsBack_(ym, n) {
  var out = [ym];
  while (out.length < n) out.push(prevYm_(out[out.length - 1]));
  return out;
}

/**
 * แท็บในไฟล์ออเดอร์ที่ตัด name = '2026-11' (ตัดขาย) หรือ '2026-11 คืน' (คืนของ)
 * make = สร้างไฟล์ / แท็บที่ยังไม่มี ไม่ make แล้วไม่มี = null
 * เปิดด้วยรหัสไฟล์ที่ตัวเองเก็บไว้เท่านั้น
 */
function logTab_(name, make) {
  var p = period_(name.slice(0, 7) + '-01');
  var spec = name.length > 7 ? RET : LOG;
  var file = ownFile_('log|' + p.q, 'WMS สมุดสต๊อก · ออเดอร์ที่ตัด ' + p.y + ' Q' + p.q.slice(-1), make);
  return file ? monthTab_(file, name, spec, make) : null;
}

/**
 * ไฟล์ที่สคริปต์สร้างเอง รหัสไฟล์เก็บใน Script Properties ตาม key (log|2026Q4, bak|2026Q4)
 * make = สร้างไฟล์ที่ยังไม่มี ไม่ make แล้วไม่มี = null · ที่เดียวในสคริปต์ที่เปิดไฟล์อื่น และเปิดได้แค่รหัสที่ตัวเองเก็บไว้
 */
function ownFile_(key, title, make) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(key);
  var file = null;
  if (id) file = SpreadsheetApp.openById(id);
  else if (make) {
    file = SpreadsheetApp.create(title);
    props.setProperty(key, file.getId());
  }
  return file;
}

/** แท็บชื่อ name ในไฟล์ของสคริปต์ ไม่มีแล้ว make = สร้างพร้อมหัวตาราง */
function monthTab_(file, name, spec, make) {
  var sheet = file.getSheetByName(name);
  if (!sheet) {
    if (!make) return null;
    sheet = file.insertSheet(name, file.getSheets().length);
    sheet.getRange(1, 1, 1, spec.head.length).setValues([spec.head]);
    sheet.setFrozenRows(1);
    /* แท็บเปล่าที่ Google ใส่มาตอนสร้างไฟล์ ลบทิ้งเมื่อมีแท็บเดือนแล้ว */
    file.getSheets().forEach(function (t) {
      if (t.getName() !== name && /^(Sheet|ชีต)\s*1$/i.test(t.getName()) && t.getLastRow() === 0 && file.deleteSheet) file.deleteSheet(t);
    });
  } else if (make && !text_(sheet.getRange(1, spec.head.length, 1, 1).getValues()[0][0])) {
    /* แท็บของรุ่นก่อน หัวตารางยังไม่มีคอลัมน์ใหม่ */
    sheet.getRange(1, 1, 1, spec.head.length).setValues([spec.head]);
  }
  return sheet;
}

function key_(sys, order, sku) { return sys + '|' + order + '|' + sku; }

/** บรรทัดที่ตัดแล้วของเดือนนั้นกับเดือนก่อน { คีย์: เลขที่ } ไม่นับชุดที่ยกเลิก */
function cutKeys_(day) {
  var ym = period_(day).ym, have = {};
  [prevYm_(ym), ym].forEach(function (m) {
    var sheet = logTab_(m, false);
    if (!sheet) return;
    rows_(sheet, 5).forEach(function (r) {
      if (text_(r[1]) === VOID) return;
      have[key_(text_(r[2]), text_(r[3]), text_(r[4]))] = text_(r[0]);
    });
  });
  return have;
}

function checkDay_(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) throw new Error('วันที่ต้องเป็น yyyy-mm-dd');
  var gap = dayNo_(today_()) - dayNo_(day);
  if (gap < -1) throw new Error('วันที่ ' + day + ' ยังไม่ถึง');
  if (gap > BACK_DAYS) throw new Error('วันที่ ' + day + ' ย้อนหลังเกิน ' + BACK_DAYS + ' วัน');
  return day;
}

/** req = {date, keys:['JST|1094166|LEG0000000012', …]} → { seen: { คีย์: เลขที่ } } เฉพาะที่ตัดแล้ว */
function seen_(req) {
  var day = checkDay_(text_(req.date));
  var have = cutKeys_(day), seen = {};
  (Array.isArray(req.keys) ? req.keys : []).slice(0, LINES_MAX).forEach(function (k) {
    k = text_(k).toUpperCase();
    if (have[k]) seen[k] = have[k];
  });
  return { app: 'book', seen: seen };
}

/** 'A-01-01|8|P1|2; B-02-01|9|P2|1' → [['A-01-01', '8', 'P1', 2], …] */
function piles_(s) {
  return text_(s).split(/;\s*/).filter(Boolean).map(function (x) {
    var p = x.split('|');
    return [p[0] || '', p[1] || '', p[2] || '', +p[3] || 0];
  });
}

/* ── เลขที่เอกสาร ─────────────────────────────────────────────────────────── */

/** ชุดทั้งหมด from = เลขวัน (dayNo_) ใส่มาแล้วอ่านแถวที่คัดลอกให้เฉพาะชุดที่บันทึกตั้งแต่วันนั้น */
function docs_(from) {
  var sheet = tab_(T_DOC);
  var list = rows_(sheet, TABS[T_DOC].head.length).map(function (r, i) {
    return {
      row: i + 2, doc: text_(r[0]), type: text_(r[1]), date: text_(r[2]), who: text_(r[3]), at: text_(r[4]),
      rows: +r[5] || 0, qty: +r[6] || 0, orders: +r[7] || 0, status: text_(r[8]),
      voidBy: text_(r[9]), voidAt: text_(r[10]), why: text_(r[11]), batch: text_(r[12]), file: text_(r[13]), ptr: text_(r[14]),
      base: +r[15] || 0, tx: text_(r[16]),
    };
  }).filter(function (d) { return d.doc; });
  if (typeof from === 'number') {
    copies_(list.filter(function (d) { return d.at && dayNo_(d.at.slice(0, 10)) >= from; }));
  }
  return list;
}

/**
 * ใส่ d.copy ให้ชุดในรายการ อ่านแท็บแถวที่คัดลอกช่วงเดียวครอบทุกชุด (ชุดของรุ่น 1 เก็บเป็น JSON ในช่องเดียว)
 * ชุดที่ลงแท็บ Transaction แล้ว (โหมดบันทึก) อ่านแถวจาก Transaction แทน ยอดยกมาไม่อ่าน (หลายพันแถว ไม่มีใครต้องคัดลอก)
 */
function copies_(list) {
  var lo = 0, hi = 0, tlo = 0, thi = 0;
  list.forEach(function (d) {
    d.copy = [];
    var m = /^@(\d+)\+(\d+)$/.exec(d.ptr), t = /^@(\d+)\+(\d+)$/.exec(d.tx || '');
    if (m) {
      d.at0 = +m[1]; d.n0 = +m[2];
      if (!lo || d.at0 < lo) lo = d.at0;
      hi = Math.max(hi, d.at0 + d.n0 - 1);
    } else if (t && d.type !== TYPE_OPEN) {
      d.t0 = +t[1]; d.tn = +t[2];
      if (!tlo || d.t0 < tlo) tlo = d.t0;
      thi = Math.max(thi, d.t0 + d.tn - 1);
    } else if (/^\[/.test(d.ptr)) {
      try { d.copy = JSON.parse(d.ptr) || []; } catch (e) { d.copy = []; }
    }
  });
  if (lo) {
    var vals = tab_(T_COPY).getRange(lo, 1, hi - lo + 1, TABS[T_COPY].head.length).getValues();
    list.forEach(function (d) {
      if (!d.n0) return;
      d.copy = vals.slice(d.at0 - lo, d.at0 - lo + d.n0).filter(function (r) { return text_(r[0]) === d.doc; }).map(function (r) {
        return [text_(r[1]), text_(r[2]), text_(r[3]), text_(r[4]), text_(r[5]), text_(r[6]), +r[7] || 0, text_(r[8]), text_(r[9]), text_(r[10])];
      });
    });
  }
  if (tlo) {
    var tx = tab_(T_TX), end = Math.min(thi, tx.getLastRow());
    var tv = end >= tlo ? tx.getRange(tlo, 1, end - tlo + 1, 14).getValues() : [];
    list.forEach(function (d) {
      if (!d.tn) return;
      d.copy = tv.slice(d.t0 - tlo, d.t0 - tlo + d.tn).filter(function (r) { return text_(r[13]) === d.doc; }).map(function (r) {
        return [text_(r[0]), text_(r[1]), text_(r[3]), text_(r[4]), text_(r[5]), text_(r[6]), +r[7] || 0, text_(r[8]), text_(r[9]), text_(r[10])];
      });
    });
  }
}

/** เลขถัดไปของเดือนนี้ ดูจากแท็บเลขที่เอกสารเอง (เรียกภายใต้ล็อกเท่านั้น) */
function nextDoc_(list) {
  var pre = 'T' + Utilities.formatDate(new Date(now_()), tz_(), 'yyMM') + '-';
  var top = 0;
  list.forEach(function (d) {
    if (d.doc.indexOf(pre) === 0) top = Math.max(top, +d.doc.slice(pre.length) || 0);
  });
  var n = String(top + 1);
  while (n.length < 4) n = '0' + n;
  return pre + n;
}

/** เขียนชุดใหม่: แถวที่คัดลอกก่อน แล้วแถวเลขที่เอกสารที่ชี้ไปหา (เรียกภายใต้ล็อกเท่านั้น) */
function writeDoc_(o) {
  var start = append_(tab_(T_COPY), TABS[T_COPY], o.copy.map(function (r) { return [o.doc].concat(r); }));
  append_(tab_(T_DOC), TABS[T_DOC], [[o.doc, o.type, o.day, o.who, o.at, o.rows !== undefined ? o.rows : o.copy.length, o.qty, o.orders || 0,
    '', '', '', '', o.batch, o.file || '', o.copy.length ? '@' + start + '+' + o.copy.length : '', o.base || '', o.tx || '']]);
}

function lite_(d, withCopy) {
  var o = { doc: d.doc, type: d.type, date: d.date, who: d.who, at: d.at, rows: d.rows, qty: d.qty, orders: d.orders,
    status: d.status, voidBy: d.voidBy, voidAt: d.voidAt, why: d.why, batch: d.batch, base: d.base, book: d.tx ? 1 : 0 };
  if (withCopy) o.copy = d.copy || [];
  return o;
}

/** แถวสุดท้ายของสมุดที่หน้าเว็บเห็นตอนกดบันทึก */
function base_(req) {
  var b = num_(req.base);
  return b !== null && b > 0 ? Math.floor(b) : '';
}

/** รหัสชุดเดิมที่บันทึกไปแล้ว (เน็ตหลุดตอนรอคำตอบแล้วกดส่งอีกครั้ง) */
function again_(list, batch) {
  var d = list.filter(function (x) { return x.batch === batch; })[0];
  return d ? { app: 'book', doc: d.doc, again: true, at: d.at, status: d.status, book: d.tx ? 1 : 0 } : null;
}

/**
 * แถวที่คัดลอก [SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ประเภท, Note, Status] ล้างให้ปลอดภัย แล้วเช็คตามประเภทชุด
 * check(row) คืนเหตุผลถ้าแถวไม่ถูก · คืน { rows, qty } หรือ { error }
 */
function copyRows_(copy, check) {
  if (!Array.isArray(copy) || !copy.length || copy.length > ROWS_MAX) return { error: 'แถวที่คัดลอกต้องมี 1–' + ROWS_MAX + ' แถว' };
  var rows = [], qty = 0, bad = [];
  copy.forEach(function (c, i) {
    c = c || [];
    var r = [code_(c[0], 60), code_(c[1], 60), code_(c[2], 20), code_(c[3], 40), code_(c[4], 40), code_(c[5], 40),
      num_(c[6]), plain_(c[7], 20), plain_(c[8], 60), plain_(c[9], 20)];
    var why = !r[0] ? 'ไม่มี SKU' : r[6] === null || r[6] <= 0 ? 'ชิ้นต้องมากกว่า 0' : r[2] === '' || r[3] === '' ? 'ไม่มี LOT หรือ PO'
      : r[9] && r[9] !== 'เปิด' ? 'Status ต้องเป็น เปิด หรือว่าง' : check(r);
    if (why) { bad.push({ n: i + 1, sku: r[0], why: why }); return; }
    qty += r[6];
    rows.push(r);
  });
  if (bad.length) return { error: 'แถวที่คัดลอกไม่ถูก ' + bad.length + ' แถว', bad: bad.slice(0, 50) };
  return { rows: rows, qty: Math.round(qty * 1000) / 1000 };
}

/* ── ตัดขาย ──────────────────────────────────────────────────────────────── */

/**
 * req = {batch, date, base, lines:[{sys, order, ref, track, sku, qty, piles:[[loc, lot, po, ชิ้น]]}],
 *        copy:[[SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ขาย, วันที่, Status]]}
 * ทั้งชุดหรือไม่รับเลย: แถวที่คนจะวางในชีตเดิมต้องตรงกับบรรทัดที่บันทึกไว้ทุกบรรทัด
 * ส่งซ้ำด้วย batch เดิม (เน็ตหลุดตอนรอคำตอบ) ได้เลขเดิม ไม่บันทึกซ้ำ
 */
function cut_(req, user) {
  var batch = plain_(req.batch, 60);
  if (!batch) return { error: 'ไม่มีรหัสชุด' };
  var day = checkDay_(text_(req.date));
  var lines = Array.isArray(req.lines) ? req.lines : [];
  if (!lines.length) return { error: 'ไม่มีบรรทัดออเดอร์ให้บันทึก' };
  if (lines.length > LINES_MAX) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LINES_MAX + ' บรรทัดออเดอร์' };

  /* ตรวจรูปแบบก่อนล็อก บรรทัดเดียวผิดก็ไม่รับทั้งชุด */
  var clean = [], seenKey = {}, bad = [], sumLines = 0;
  lines.forEach(function (l, i) {
    l = l || {};
    var sys = code_(l.sys, 10), order = code_(l.order, 60), sku = code_(l.sku, 60), qty = num_(l.qty);
    var piles = Array.isArray(l.piles) ? l.piles : [];
    function no(why) { bad.push({ n: i + 1, order: order, sku: sku, why: why }); }
    if (SYSTEMS.indexOf(sys) < 0) return no('ระบบต้องเป็น ' + SYSTEMS.join(' หรือ '));
    if (!order || !sku) return no('ไม่มีเลขออเดอร์หรือ SKU');
    if (qty === null || qty <= 0) return no('จำนวนต้องมากกว่า 0');
    if (!piles.length || piles.length > PILES_MAX) return no('ไม่มีกองที่ตัด');
    var k = key_(sys, order, sku);
    if (seenKey[k]) return no('บรรทัดซ้ำในชุดเดียวกัน');
    seenKey[k] = 1;
    var got = 0, ps = [];
    for (var j = 0; j < piles.length; j++) {
      var p = piles[j] || [];
      var pq = num_(p[3]);
      if (!code_(p[0], 40) || pq === null || pq <= 0) return no('กองที่ตัดไม่ครบ');
      got += pq;
      ps.push([code_(p[0], 40), code_(p[1], 20), code_(p[2], 40), pq].join('|'));
    }
    if (Math.abs(got - qty) > 1e-9) return no('ชิ้นในกองไม่เท่ากับชิ้นในออเดอร์');
    sumLines += qty;
    clean.push({ sys: sys, order: order, ref: code_(l.ref, 60), track: code_(l.track, 60), sku: sku, qty: qty, piles: ps.join('; '), key: k });
  });
  if (bad.length) return { error: 'มีบรรทัดออเดอร์ไม่ถูก ' + bad.length + ' บรรทัด', bad: bad.slice(0, 50) };

  var cp = copyRows_(req.copy, function (r) {
    if (r[7] !== 'ขาย') return 'ประเภทต้องเป็น ขาย';
    if (!r[4] || r[5]) return 'แถวขายมีแค่โลเบิก';
    return '';
  });
  if (cp.error) return cp;
  if (Math.abs(cp.qty - sumLines) > 1e-9) return { error: 'ชิ้นในแถวที่คัดลอก (' + cp.qty + ') ไม่เท่ากับชิ้นในออเดอร์ (' + sumLines + ')' };
  var names = namesIn_(req.names);

  return withLock_(function () {
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;

    var have = cutKeys_(day), dup = [];
    clean.forEach(function (l) { if (have[l.key]) dup.push({ key: l.key, doc: have[l.key] }); });
    if (dup.length) return { error: 'มีบรรทัดออเดอร์ที่ตัดไปแล้ว ' + dup.length + ' บรรทัด', dup: dup };
    var chk = bookCheck_(cp.rows);
    if (chk && chk.error) return chk;

    var doc = nextDoc_(list), at = stamp_(), ym = period_(day).ym;
    var orders = {};
    clean.forEach(function (l) { orders[l.sys + '|' + l.order] = 1; });
    var log = logTab_(ym, true);
    append_(log, LOG, clean.map(function (l) {
      return [doc, '', l.sys, l.order, l.sku, l.qty, day, l.ref, l.piles, user.name, at, l.track];
    }));
    var bk = commit_({ doc: doc, type: TYPE_SALE, day: day, who: user.name, at: at, copy: cp.rows, qty: sumLines,
      orders: Object.keys(orders).length, batch: batch, file: ym, base: base_(req), names: names }, chk);
    return { app: 'book', doc: doc, at: at, lines: clean.length, rows: cp.rows.length, qty: sumLines, book: bk.book, txAt: bk.txAt };
  });
}

/* ── ย้าย / เติม / QA ────────────────────────────────────────────────────── */

/**
 * req = {batch, date, base, copy:[[SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, เบิก, โอนย้าย | โอนย้าย QA, Status]]}
 * หน้าเว็บเลือก LOT/PO จากกองที่มีจริงแล้ว สคริปต์เช็คแค่รูปแบบแถว
 */
function move_(req, user) {
  var batch = plain_(req.batch, 60);
  if (!batch) return { error: 'ไม่มีรหัสชุด' };
  var day = checkDay_(text_(req.date));
  var cp = copyRows_(req.copy, function (r) {
    if (r[7] !== 'เบิก') return 'ประเภทต้องเป็น เบิก';
    if (!r[4] || !r[5]) return 'ต้องมีทั้งโลเบิกและโลรับ';
    if (r[4] === r[5]) return 'โลเบิกกับโลรับเป็นที่เดียวกัน';
    if (MOVE_NOTES.indexOf(r[8]) < 0) return 'Note ต้องเป็น ' + MOVE_NOTES.join(' หรือ ');
    return '';
  });
  if (cp.error) return cp;
  var names = namesIn_(req.names);
  return withLock_(function () {
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;
    var chk = bookCheck_(cp.rows);
    if (chk && chk.error) return chk;
    var doc = nextDoc_(list), at = stamp_();
    var bk = commit_({ doc: doc, type: TYPE_MOVE, day: day, who: user.name, at: at, copy: cp.rows, qty: cp.qty, batch: batch, base: base_(req),
      names: names }, chk);
    return { app: 'book', doc: doc, at: at, rows: cp.rows.length, qty: cp.qty, book: bk.book, txAt: bk.txAt };
  });
}

/* ── คืนของ ──────────────────────────────────────────────────────────────── */

/** ชิ้นที่คืนแล้วต่อบรรทัดออเดอร์ { คีย์: ชิ้น } อ่านแท็บคืนตั้งแต่เดือนนี้ย้อนถึงเดือน oldest ไม่นับชุดที่ยกเลิก */
function returned_(oldest) {
  var back = {}, m = period_(today_()).ym, guard = 0;
  while (m >= oldest && guard++ < 12) {
    var t = logTab_(m + RET_SUFFIX, false);
    if (t) {
      rows_(t, 6).forEach(function (r) {
        if (text_(r[1]) === VOID || !text_(r[3])) return;
        var k = key_(text_(r[2]), text_(r[3]), text_(r[4]));
        back[k] = Math.round(((back[k] || 0) + (+r[5] || 0)) * 1000) / 1000;
      });
    }
    m = prevYm_(m);
  }
  return back;
}

/**
 * req = {date, keys:['1094166', 'TH0123456789', …]} หาจากเลขออเดอร์ เลขอ้างอิง (ออเดอร์ออนไลน์) หรือเลขพัสดุ
 * ไล่จากเดือนของวันที่คืนย้อนไป FIND_MONTHS เดือน เจอครบทุกเลขแล้วหยุด
 * → { found: { เลข: [{sys, order, ref, track, sku, qty, date, doc, piles, back}] }, miss: [เลขที่ไม่เจอ] }
 */
function find_(req) {
  var day = checkDay_(text_(req.date));
  var want = {}, left = 0;
  (Array.isArray(req.keys) ? req.keys : []).slice(0, KEYS_MAX).forEach(function (k) {
    k = code_(k, 60);
    if (k && !want[k]) { want[k] = 1; left++; }
  });
  var months = monthsBack_(period_(day).ym, FIND_MONTHS);
  var found = {};
  months.forEach(function (m) {
    if (!left) return;
    var sheet = logTab_(m, false);
    if (!sheet) return;
    rows_(sheet, LOG.head.length).forEach(function (r) {
      if (text_(r[1]) === VOID) return;
      var hit = {};
      [r[3], r[7], r[11]].forEach(function (v) { var k = text_(v).toUpperCase(); if (k && want[k]) hit[k] = 1; });
      Object.keys(hit).forEach(function (k) {
        if (!found[k]) { found[k] = []; left--; }
        if (found[k].length >= HITS_MAX) return;
        found[k].push({ sys: text_(r[2]), order: text_(r[3]), ref: text_(r[7]), track: text_(r[11]), sku: text_(r[4]), qty: +r[5] || 0,
          date: text_(r[6]), doc: text_(r[0]), piles: piles_(r[8]), back: 0 });
      });
    });
  });
  var back = returned_(months[months.length - 1]);
  Object.keys(found).forEach(function (k) {
    found[k].forEach(function (l) { l.back = back[key_(l.sys, l.order, l.sku)] || 0; });
  });
  return { app: 'book', found: found, miss: Object.keys(want).filter(function (k) { return !found[k]; }), months: months };
}

/**
 * req = {batch, date, base,
 *        lines:[{sys, order, ref, track, sku, qty, cut, cutQty, piles:[[โลรับ, lot, po, ชิ้น]]}],
 *        copy:[[SKU, SKU เต็ม, LOT, PO, '', โลรับ, ชิ้น, รับ, RETURN | M/E-…, Status]]}
 * บรรทัดที่มีเลขที่ตัด (cut) = คืนออเดอร์ที่ตัดจากหน้านี้ คืนรวมเกินชิ้นที่ตัด (cutQty) ไม่รับทั้งชุด
 * บรรทัดที่ไม่มีเลขที่ตัด = ออเดอร์เก่าที่ตัดด้วยมือ หรือไม่รู้ออเดอร์ คืนเป็น LOT 0 / PO 0 แบบเดิม
 */
function return_(req, user) {
  var batch = plain_(req.batch, 60);
  if (!batch) return { error: 'ไม่มีรหัสชุด' };
  var day = checkDay_(text_(req.date));
  var lines = Array.isArray(req.lines) ? req.lines : [];
  if (!lines.length) return { error: 'ไม่มีบรรทัดคืนให้บันทึก' };
  if (lines.length > LINES_MAX) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LINES_MAX + ' บรรทัด' };

  var clean = [], seenKey = {}, bad = [], sumLines = 0;
  lines.forEach(function (l, i) {
    l = l || {};
    var sys = code_(l.sys, 10), order = code_(l.order, 60), sku = code_(l.sku, 60), qty = num_(l.qty);
    var cut = code_(l.cut, 20), cutQty = num_(l.cutQty);
    var piles = Array.isArray(l.piles) ? l.piles : [];
    function no(why) { bad.push({ n: i + 1, order: order, sku: sku, why: why }); }
    if (sys && SYSTEMS.indexOf(sys) < 0) return no('ระบบต้องเป็น ' + SYSTEMS.join(' หรือ ') + ' หรือว่าง');
    if (!sku) return no('ไม่มี SKU');
    if (qty === null || qty <= 0) return no('จำนวนต้องมากกว่า 0');
    if (!piles.length || piles.length > PILES_MAX) return no('ไม่มีกองที่คืนเข้า');
    var k = key_(sys, order, sku);
    if (cut) {
      if (!sys || !order) return no('คืนตามเลขที่ตัดต้องมีระบบกับเลขออเดอร์');
      if (cutQty === null || cutQty <= 0) return no('ไม่รู้ชิ้นที่ตัด');
      if (seenKey[k]) return no('บรรทัดซ้ำในชุดเดียวกัน');
      seenKey[k] = 1;
    }
    var got = 0, ps = [];
    for (var j = 0; j < piles.length; j++) {
      var p = piles[j] || [];
      var pq = num_(p[3]);
      if (!code_(p[0], 40) || code_(p[1], 20) === '' || code_(p[2], 40) === '' || pq === null || pq <= 0) return no('กองที่คืนเข้าไม่ครบ');
      got += pq;
      ps.push([code_(p[0], 40), code_(p[1], 20), code_(p[2], 40), pq].join('|'));
    }
    if (Math.abs(got - qty) > 1e-9) return no('ชิ้นในกองไม่เท่ากับชิ้นที่คืน');
    sumLines += qty;
    clean.push({ sys: sys, order: order, ref: code_(l.ref, 60), track: code_(l.track, 60), sku: sku, qty: qty, piles: ps.join('; '),
      cut: cut, cutQty: cutQty, key: k });
  });
  if (bad.length) return { error: 'มีบรรทัดคืนไม่ถูก ' + bad.length + ' บรรทัด', bad: bad.slice(0, 50) };

  var cp = copyRows_(req.copy, function (r) {
    if (r[7] !== 'รับ') return 'ประเภทต้องเป็น รับ';
    if (r[4] || !r[5]) return 'แถวคืนมีแค่โลรับ';
    if (r[8] !== 'RETURN' && !/^M\/E/i.test(r[8])) return 'Note ต้องเป็น RETURN หรือ M/E-…';
    return '';
  });
  if (cp.error) return cp;
  sumLines = Math.round(sumLines * 1000) / 1000;
  if (Math.abs(cp.qty - sumLines) > 1e-9) return { error: 'ชิ้นในแถวที่คัดลอก (' + cp.qty + ') ไม่เท่ากับชิ้นที่คืน (' + sumLines + ')' };
  var names = namesIn_(req.names);

  return withLock_(function () {
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;

    var ym = period_(day).ym;
    var back = returned_(monthsBack_(ym, FIND_MONTHS).pop()), over = [];
    clean.forEach(function (l) {
      if (!l.cut) return;
      var had = back[l.key] || 0;
      if (had + l.qty > l.cutQty + 1e-9) over.push({ key: l.key, cut: l.cutQty, back: had, qty: l.qty });
    });
    if (over.length) return { error: 'คืนเกินชิ้นที่ตัด ' + over.length + ' บรรทัด', over: over };
    var chk = bookCheck_(cp.rows);
    if (chk && chk.error) return chk;

    var doc = nextDoc_(list), at = stamp_();
    var orders = {};
    clean.forEach(function (l) { if (l.order) orders[l.sys + '|' + l.order] = 1; });
    var file = ym + RET_SUFFIX;
    append_(logTab_(file, true), RET, clean.map(function (l) {
      return [doc, '', l.sys, l.order, l.sku, l.qty, day, l.ref, l.piles, user.name, at, l.track, l.cut];
    }));
    var bk = commit_({ doc: doc, type: TYPE_RET, day: day, who: user.name, at: at, copy: cp.rows, qty: sumLines,
      orders: Object.keys(orders).length, batch: batch, file: file, base: base_(req), names: names }, chk);
    return { app: 'book', doc: doc, at: at, lines: clean.length, rows: cp.rows.length, qty: sumLines, book: bk.book, txAt: bk.txAt };
  });
}

/* ── ชุดที่บันทึก ────────────────────────────────────────────────────────── */

/** req = {days} ชุดที่บันทึกในไม่กี่วันล่าสุด ใหม่สุดก่อน พร้อมแถวที่คัดลอก */
function recent_(req) {
  var days = Math.max(1, Math.min(RECENT_MAX, +req.days || 2));
  var from = dayNo_(today_()) - days + 1;
  var list = docs_(from).filter(function (d) { return d.at && dayNo_(d.at.slice(0, 10)) >= from; });
  list.reverse();
  return { app: 'book', today: today_(), docs: list.map(function (d) { return lite_(d, true); }) };
}

/** req = {doc, why} ยกเลิกทั้งชุด: ทำเครื่องหมายในแท็บเลขที่เอกสารและทุกบรรทัดของชุดในไฟล์ออเดอร์ที่ตัด ไม่ลบแถว */
function void_(req, user) {
  var doc = code_(req.doc, 20), why = plain_(req.why, 200);
  if (!doc) return { error: 'ไม่ได้บอกเลขที่เอกสาร' };
  if (!why) return { error: 'ต้องใส่เหตุผลที่ยกเลิก' };
  return withLock_(function () {
    var d = docs_().filter(function (x) { return x.doc === doc; })[0];
    if (!d) return { error: 'ไม่พบเลขที่ ' + doc };
    if (d.status === VOID) return { error: doc + ' ถูกยกเลิกไปแล้ว' };
    if (d.tx || d.type === TYPE_OPEN) {
      return { error: d.type === TYPE_OPEN ? 'ยอดยกมายกเลิกไม่ได้ ใช้ ลงยอดยกมาใหม่ ในหน้าตั้งค่าสมุด'
        : doc + ' ลงแท็บ Transaction ไปแล้ว ยกเลิกแบบลงแถวกลับจะมาในขั้น 4 ตอนนี้ให้หัวหน้าลงแถวแก้ในตารางแบบเดิม' };
    }
    var at = stamp_();
    var sheet = tab_(T_DOC);
    sheet.getRange(d.row, 9, 1, 4).setValues([[VOID, user.name, at, why]]);
    var marked = 0;
    var log = d.file ? logTab_(d.file, false) : null;
    if (log) {
      var col = rows_(log, 2);
      var first = -1, n = 0;
      col.forEach(function (r, i) {
        if (text_(r[0]) !== doc) return;
        if (first < 0) first = i;
        n = i - first + 1;
      });
      if (first >= 0) {
        var block = col.slice(first, first + n).map(function (r) { return [text_(r[0]) === doc ? VOID : text_(r[1])]; });
        log.getRange(first + 2, 2, n, 1).setValues(block);
        marked = block.filter(function (b) { return b[0] === VOID; }).length;
      }
    }
    return { app: 'book', doc: doc, type: d.type, status: VOID, at: at, lines: marked };
  });
}

/* ── สมุดใหม่ (ขั้น 3) ───────────────────────────────────────────────────── */

function mode_() { return PropertiesService.getScriptProperties().getProperty('mode') === MODE_BOOK ? MODE_BOOK : MODE_COPY; }

function round3_(n) { return Math.round(n * 1000) / 1000; }
function pad2_(n) { return (+n < 10 ? '0' : '') + (+n); }

/** ค่าที่เป็นตัวเลขล้วน (LOT 8, PO 0, LOT 0.11) เขียนเป็นตัวเลขแบบที่คนวางในชีตเดิม ที่เหลือเป็นข้อความ */
function sheetNum_(v) {
  var s = text_(v);
  return /^(0|[1-9]\d{0,14})(\.\d+)?$/.test(s) ? Number(s) : s;
}

function pileKey_(loc, sku, lot, po) {
  return [loc, sku, lot, po].map(function (v) { return text_(v).toUpperCase(); }).join('|');
}

/** วันรับใน Note: "GR 02-10-26" หรือ "ยอดยกมา T2612-0001 · GR 02-10-26" → '2026-10-02' */
function grDay_(note) {
  var m = /\bGR\s*(\d{1,2})-(\d{1,2})-(\d{2})\b/i.exec(text_(note));
  return m ? '20' + m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]) : '';
}

/** '2026-10-02' → '02-10-26' แบบที่ทีมพิมพ์ในสมุด */
function grText_(d) { return d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(2, 4); }

/** ไตรมาสของวันนี้แบบที่ tx-api.gs อ่านได้ Q4/26 */
function quarterTag_() { var p = period_(today_()); return 'Q' + Math.ceil(p.m / 3) + '/' + String(p.y).slice(2); }

/** ชื่อสินค้าที่หน้าเว็บส่งมา { SKU เต็ม หรือ SKU: ชื่อ } ใช้เติมช่อง Product Name */
function namesIn_(v) {
  var out = {}, n = 0;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  Object.keys(v).forEach(function (k) {
    if (n >= NAMES_MAX) return;
    var key = code_(k, 60);
    if (!key) return;
    out[key] = plain_(v[k], 120);
    n++;
  });
  return out;
}

/** แท็บยอดคงเหลือ → { คีย์กอง: {loc, sku, long, lot, po, qty, status, first, last} } */
function balance_() {
  var map = {};
  rows_(tab_(T_BAL), TABS[T_BAL].head.length).forEach(function (r) {
    var p = { loc: text_(r[0]), sku: text_(r[1]), long: text_(r[2]), lot: text_(r[3]), po: text_(r[4]), qty: +r[5] || 0,
      status: text_(r[6]), first: text_(r[7]), last: +r[8] || 0 };
    if (p.loc && (p.long || p.sku)) map[pileKey_(p.loc, p.long || p.sku, p.lot, p.po)] = p;
  });
  return map;
}

/**
 * แถว [SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ประเภท, Note, Status] เข้ายอดคงเหลือ กติกาเดียวกับ tx-api.gs
 *   เข้า = มีโลรับ ไม่ดูประเภท · ออก = มีโลเบิกและประเภทเป็น เบิก หรือ ขาย · Status ของกองยึดแถวเข้าล่าสุด
 * at = เลขแถวใน Transaction ของแถวแรก · strict = บอกแถวที่กองไม่พอ (โหมดบันทึก) ไม่ strict = ติดลบได้ (คิดใหม่ทั้งแท็บ)
 * แก้ map ในที่ คืนรายการกองไม่พอ
 */
function applyRows_(map, rows, at, strict) {
  var short = [];
  function pile(loc, r) {
    var k = pileKey_(loc, r[1] || r[0], r[2], r[3]);
    return map[k] || (map[k] = { loc: text_(loc).toUpperCase(), sku: text_(r[0]).toUpperCase(), long: text_(r[1]).toUpperCase(),
      lot: text_(r[2]).toUpperCase(), po: text_(r[3]).toUpperCase(), qty: 0, status: '', first: '', last: 0 });
  }
  rows.forEach(function (r, i) {
    if (!r[0] && !r[1]) return;
    var qty = +r[6] || 0;
    if (r[5]) {
      var p = pile(r[5], r);
      p.qty = round3_(p.qty + qty);
      p.status = r[9] === 'เปิด' ? 'เปิด' : '';
      p.last = at + i;
      var d = grDay_(r[8]);
      if (d && (!p.first || d < p.first)) p.first = d;
    }
    if (r[4] && (r[7] === 'เบิก' || r[7] === 'ขาย')) {
      var q = pile(r[4], r);
      if (strict && q.qty + 1e-9 < qty) short.push({ n: i + 1, loc: q.loc, sku: r[0], lot: r[2], po: r[3], have: Math.max(0, q.qty), need: qty });
      q.qty = round3_(q.qty - qty);
      q.last = at + i;
    }
  });
  return short;
}

/** เขียนแท็บยอดคงเหลือใหม่ทั้งแท็บ กองยอด 0 ไม่ลง เรียงตามโล แล้ว SKU LOT PO คืนรายการกอง */
function writeBalance_(map) {
  var sheet = tab_(T_BAL), spec = TABS[T_BAL];
  var cmp = function (a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); };
  var list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (p) { return Math.abs(p.qty) > 1e-9; });
  list.sort(function (a, b) { return cmp(a.loc, b.loc) || cmp(a.long || a.sku, b.long || b.sku) || cmp(a.lot, b.lot) || cmp(a.po, b.po); });
  var old = Math.max(0, sheet.getLastRow() - 1);
  if (list.length) {
    var short = list.length + 1 - sheet.getMaxRows();
    if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
    spec.text.forEach(function (c) { sheet.getRange(2, c, list.length, 1).setNumberFormat('@'); });
    sheet.getRange(2, 1, list.length, spec.head.length).setValues(list.map(function (p) {
      return [p.loc, p.sku, p.long, p.lot, p.po, p.qty, p.status, p.first, p.last || ''];
    }));
  }
  if (old > list.length) sheet.getRange(list.length + 2, 1, old - list.length, spec.head.length).clearContent();
  return list;
}

/**
 * ลงแถวต่อท้ายแท็บ Transaction (เรียกภายใต้ล็อกเท่านั้น) คืนแถวแรกที่ลง
 * o = {rows (แบบแถวที่คัดลอก), names, who, doc, at, type, ref, batch}
 */
function txWrite_(o) {
  var names = o.names || {};
  return append_(tab_(T_TX), TABS[T_TX], o.rows.map(function (r) {
    return [r[0], r[1], names[r[1]] || names[r[0]] || '', sheetNum_(r[2]), sheetNum_(r[3]), r[4], r[5], r[6], r[7], r[8], r[9], '',
      o.who, o.doc, o.at, o.type, o.ref || '', o.batch];
  }));
}

/**
 * โหมดบันทึก: เช็คกองก่อนลง (เรียกภายใต้ล็อก) · โหมดคัดลอกคืน null
 * กองไม่พอ (รวมแถวก่อนหน้าในชุดเดียวกัน) = ไม่รับทั้งชุด คืน {error, short} · ผ่าน = {map ยอดหลังลง, at แถวแรกที่จะลง}
 */
function bookCheck_(rows) {
  if (mode_() !== MODE_BOOK) return null;
  var map = balance_(), at = tab_(T_TX).getLastRow() + 1;
  var short = applyRows_(map, rows, at, true);
  if (short.length) {
    return { error: 'ยอดในสมุดไม่พอ ' + short.length + ' แถว ต้องลงรับของ หรือให้หัวหน้าปรับยอดก่อน', short: short.slice(0, 50) };
  }
  return { map: map, at: at };
}

/**
 * ส่วนท้ายของทุกชุด (ภายใต้ล็อก) โหมดบันทึก: ลงแท็บ Transaction เขียนยอดคงเหลือ แถวที่คัดลอกไม่ต้องเก็บซ้ำ (อ่านจาก Transaction ได้)
 * แล้วเขียนแถวเลขที่เอกสาร · คืน {book, txAt}
 */
function commit_(o, chk) {
  var out = {};
  if (chk) {
    var at = txWrite_({ rows: o.copy, names: o.names, who: o.who, doc: o.doc, at: o.at, type: o.type, ref: o.ref, batch: o.batch });
    writeBalance_(chk.map);
    o.tx = '@' + at + '+' + o.copy.length;
    o.base = at - 1;
    o.rows = o.copy.length;
    o.copy = [];
    out = { book: 1, txAt: at };
  }
  writeDoc_(o);
  return out;
}

/* ── ตารางแบบสมุดเดิม ────────────────────────────────────────────────────── */

/**
 * req = {batch, date, base, ref, names, copy:[[SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, รับ | เบิก | ขาย, Note, Status]]}
 * ลงได้ทุกประเภท (รับของ แปลง M/E ปรับยอด) จนกว่าแต่ละงานจะมีหน้าของตัวเอง เฉพาะหัวหน้ากับรองหัวหน้า
 *   รับ = มีโลรับอย่างเดียว · เบิก = มีโลเบิก (โลรับมีหรือไม่มีก็ได้) · ขาย = มีโลเบิกอย่างเดียว · ทุกแถวต้องมี Note
 *   แถวขาย Note = วันที่ขาย yyyy-mm-dd แบบชีตเดิม (tx-api อ่านเป็นวันขาย หน้าเว็บใช้เช็คว่าชุดลงสมุดแล้ว)
 */
function rowsSave_(req, user) {
  var batch = plain_(req.batch, 60);
  if (!batch) return { error: 'ไม่มีรหัสชุด' };
  var day = checkDay_(text_(req.date));
  var cp = copyRows_(req.copy, function (r) {
    if (TX_TYPES.indexOf(r[7]) < 0) return 'ประเภทต้องเป็น ' + TX_TYPES.join(' ');
    if (r[7] === 'รับ' && (!r[5] || r[4])) return 'แถวรับมีแค่โลรับ';
    if (r[7] === 'เบิก' && !r[4]) return 'แถวเบิกต้องมีโลเบิก';
    if (r[7] === 'ขาย' && (!r[4] || r[5])) return 'แถวขายมีแค่โลเบิก';
    if (r[4] && r[4] === r[5]) return 'โลเบิกกับโลรับเป็นที่เดียวกัน';
    if (!r[8]) return 'ต้องมี Note บอกว่าเป็นงานอะไร';
    if (r[7] === 'ขาย' && !/^\d{4}-\d{2}-\d{2}$/.test(r[8])) return 'แถวขาย Note ต้องเป็นวันที่ขาย (yyyy-mm-dd)';
    return '';
  });
  if (cp.error) return cp;
  var names = namesIn_(req.names), ref = plain_(req.ref, 60);
  return withLock_(function () {
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;
    var chk = bookCheck_(cp.rows);
    if (chk && chk.error) return chk;
    var doc = nextDoc_(list), at = stamp_();
    var bk = commit_({ doc: doc, type: TYPE_ROWS, day: day, who: user.name, at: at, copy: cp.rows, qty: cp.qty, batch: batch, base: base_(req),
      names: names, ref: ref }, chk);
    return { app: 'book', doc: doc, at: at, rows: cp.rows.length, qty: cp.qty, book: bk.book, txAt: bk.txAt };
  });
}

/* ── ยอดยกมา สถานะ สลับโหมด ─────────────────────────────────────────────── */

/**
 * req = {batch, asOf, replace, rows:[[SKU, SKU เต็ม, ชื่อ, LOT, PO, โล, ชิ้น, Status, วันรับ yyyy-mm-dd, ไตรมาส Q4/26]]}
 * ยอดยกมา = ยอดคงเหลือทุกกองของสมุดเดิม ณ วันตัดรอบ (หน้าเว็บคิดจาก tx-fifo) ลงเป็นแถวรับ กองละแถว
 * Note "ยอดยกมา T2612-0001 · GR 02-10-26" = วันรับแรกของ SKU+LOT+PO (หน้า FIFO กับปีของ LOT ใช้)
 * ไม่รู้วันรับ = "· Q4/26" ไตรมาสของรอบนับที่ของกองนั้นมาจาก หรือไตรมาสของวันที่ลง
 * asOf = แถวสุดท้ายของสมุดเดิมที่ใช้คิด · ลงได้เฉพาะโหมดคัดลอก · ลงใหม่ (replace) = ล้าง Transaction กับยอดคงเหลือก่อน
 */
function open_(req, user) {
  var batch = plain_(req.batch, 60);
  if (!batch) return { error: 'ไม่มีรหัสชุด' };
  var src = Array.isArray(req.rows) ? req.rows : [];
  if (!src.length || src.length > OPEN_MAX) return { error: 'ยอดยกมาต้องมี 1–' + OPEN_MAX + ' กอง' };
  var asOf = num_(req.asOf);
  var rows = [], names = {}, bad = [], qty = 0, seen = {};
  src.forEach(function (c, i) {
    c = c || [];
    var r = [code_(c[0], 60), code_(c[1], 60), code_(c[3], 20), code_(c[4], 40), '', code_(c[5], 40), num_(c[6]), 'รับ', '',
      text_(c[7]) === 'เปิด' ? 'เปิด' : ''];
    var why = !r[0] ? 'ไม่มี SKU' : !r[5] ? 'ไม่มีโล' : r[6] === null || r[6] <= 0 ? 'ชิ้นต้องมากกว่า 0'
      : r[2] === '' || r[3] === '' ? 'ไม่มี LOT หรือ PO' : '';
    var k = pileKey_(r[5], r[1] || r[0], r[2], r[3]);
    if (!why && seen[k]) why = 'กองซ้ำ';
    if (why) { bad.push({ n: i + 1, sku: r[0], loc: r[5], why: why }); return; }
    seen[k] = 1;
    var gr = /^\d{4}-\d{2}-\d{2}$/.test(text_(c[8])) ? text_(c[8]) : '';
    var q = /^Q[1-4]\/\d{2}$/.test(text_(c[9])) ? text_(c[9]) : '';
    rows.push({ r: r, gr: gr, q: q });
    var nm = plain_(c[2], 120);
    if (nm) names[r[1] || r[0]] = nm;
    qty += r[6];
  });
  if (bad.length) return { error: 'ยอดยกมาไม่ถูก ' + bad.length + ' กอง', bad: bad.slice(0, 50) };

  return withLock_(function () {
    if (mode_() === MODE_BOOK) return { error: 'โหมดบันทึกอยู่ ลงยอดยกมาไม่ได้ ต้องสลับกลับเป็นโหมดคัดลอกก่อน' };
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;
    var tx = tab_(T_TX), had = Math.max(0, tx.getLastRow() - 1);
    var prev = list.filter(function (d) { return d.type === TYPE_OPEN && d.status !== VOID; });
    if ((had || prev.length) && !req.replace) {
      return { error: 'มียอดยกมาแล้ว' + (prev.length ? ' (' + prev[prev.length - 1].doc + ')' : '') + ' จะลงใหม่ต้องกด ลงใหม่', had: had };
    }
    var at = stamp_(), qt = quarterTag_();
    if (had) tx.getRange(2, 1, had, TABS[T_TX].head.length).clearContent();
    var bal = tab_(T_BAL), nb = Math.max(0, bal.getLastRow() - 1);
    if (nb) bal.getRange(2, 1, nb, TABS[T_BAL].head.length).clearContent();
    var dsheet = tab_(T_DOC);
    prev.forEach(function (d) { dsheet.getRange(d.row, 9, 1, 4).setValues([[VOID, user.name, at, 'ลงยอดยกมาใหม่']]); });
    var doc = nextDoc_(list);
    var out = rows.map(function (x) {
      x.r[8] = TYPE_OPEN + ' ' + doc + ' · ' + (x.gr ? 'GR ' + grText_(x.gr) : x.q || qt);
      return x.r;
    });
    var map = {};
    applyRows_(map, out, 2, false);
    var txAt = txWrite_({ rows: out, names: names, who: user.name, doc: doc, at: at, type: TYPE_OPEN,
      ref: asOf ? 'สมุดเดิมถึงแถว ' + asOf : '', batch: batch });
    writeBalance_(map);
    writeDoc_({ doc: doc, type: TYPE_OPEN, day: today_(), who: user.name, at: at, copy: [], rows: out.length, qty: round3_(qty),
      batch: batch, base: asOf || '', tx: '@' + txAt + '+' + out.length });
    return { app: 'book', doc: doc, at: at, rows: out.length, qty: round3_(qty), replaced: prev.map(function (d) { return d.doc; }) };
  });
}

/**
 * สถานะสมุดใหม่: โหมด ยอดยกมาล่าสุด ชุดที่บันทึกหลังยอดยกมา แถวแรกของ Transaction (หน้าเว็บเทียบกับ tx-fifo
 * ว่า tx-api อ่านไฟล์นี้แล้วหรือยัง) และ Backup ล่าสุด
 */
function state_() {
  var props = PropertiesService.getScriptProperties();
  var list = docs_();
  var op = list.filter(function (d) { return d.type === TYPE_OPEN && d.status !== VOID; }).pop() || null;
  var after = op ? list.filter(function (d) { return d.row > op.row && d.status !== VOID && d.type !== TYPE_OPEN; }) : [];
  var tx = tab_(T_TX), last = tx.getLastRow();
  var f = last >= 2 ? tx.getRange(2, 1, 1, 11).getValues()[0] : null;
  return {
    app: 'book', mode: mode_(), modeAt: props.getProperty('modeAt') || '', modeBy: props.getProperty('modeBy') || '',
    rows: Math.max(0, last - 1), piles: Math.max(0, tab_(T_BAL).getLastRow() - 1),
    open: op ? { doc: op.doc, at: op.at, who: op.who, rows: op.rows, qty: op.qty, asOf: op.base || 0 } : null,
    after: after.length, afterDocs: after.slice(-10).map(function (d) { return d.doc; }),
    first: f ? { sku: text_(f[0]), long: text_(f[1]), lot: text_(f[3]), po: text_(f[4]), to: text_(f[6]), qty: +f[7] || 0 } : null,
    backup: { at: props.getProperty('bakAt') || '', row: +(props.getProperty('bakRow') || 0) },
    today: today_(),
  };
}

/** req = {mode: 'book' | 'copy', why} สลับไปโหมดบันทึกต้องมียอดยกมา และไม่มีชุดที่บันทึกหลังยอดยกมา */
function setMode_(req, user) {
  var want = req.mode === MODE_BOOK ? MODE_BOOK : req.mode === MODE_COPY ? MODE_COPY : '';
  if (!want) return { error: 'โหมดต้องเป็น book หรือ copy' };
  var why = plain_(req.why, 200);
  return withLock_(function () {
    if (mode_() === want) return { app: 'book', mode: want, same: true };
    if (want === MODE_BOOK) {
      var st = state_();
      if (!st.open) return { error: 'ยังไม่ได้ลงยอดยกมา' };
      if (st.after) {
        return { error: 'มี ' + st.after + ' ชุดที่บันทึกหลังลงยอดยกมา (' + st.afterDocs.join(', ') + ') ของพวกนี้อยู่ในชีตเดิม ยอดยกมาไม่มี ต้องลงยอดยกมาใหม่ก่อนสลับ' };
      }
    } else if (!why) {
      return { error: 'ถอยกลับโหมดคัดลอกต้องใส่เหตุผล' };
    }
    var props = PropertiesService.getScriptProperties(), at = stamp_();
    props.setProperty('mode', want);
    props.setProperty('modeAt', at);
    props.setProperty('modeBy', user.name);
    var hist = [];
    try { hist = JSON.parse(props.getProperty('modeLog') || '[]'); } catch (e) { hist = []; }
    hist.push([at, user.name, want, why]);
    props.setProperty('modeLog', JSON.stringify(hist.slice(-20)));
    return { app: 'book', mode: want, at: at };
  });
}

/** ยอดคงเหลือทุกกอง [[โล, SKU, SKU เต็ม, LOT, PO, ยอด, Status]] */
function stock_() {
  var map = balance_();
  return {
    app: 'book', mode: mode_(), rows: Math.max(0, tab_(T_TX).getLastRow() - 1),
    piles: Object.keys(map).map(function (k) { var p = map[k]; return [p.loc, p.sku, p.long, p.lot, p.po, p.qty, p.status]; }),
  };
}

/** คิดแท็บยอดคงเหลือใหม่จาก Transaction ทั้งแท็บ (เรียกภายใต้ล็อก) ใช้ตอนมีคนแก้แท็บ Transaction ด้วยมือ */
function rebuild_() {
  var tx = tab_(T_TX), n = tx.getLastRow() - 1, map = {};
  if (n > 0) {
    var vals = tx.getRange(2, 1, n, 11).getValues().map(function (c) {
      return [text_(c[0]).toUpperCase(), text_(c[1]).toUpperCase(), text_(c[3]).toUpperCase(), text_(c[4]).toUpperCase(),
        text_(c[5]).toUpperCase(), text_(c[6]).toUpperCase(), typeof c[7] === 'number' ? c[7] : 0, text_(c[8]), text_(c[9]), text_(c[10])];
    });
    applyRows_(map, vals, 2, false);
  }
  var list = writeBalance_(map);
  var neg = list.filter(function (p) { return p.qty < 0; });
  return {
    app: 'book', rows: Math.max(0, n), piles: list.length, neg: neg.length,
    negList: neg.slice(0, 50).map(function (p) { return [p.loc, p.sku, p.lot, p.po, p.qty]; }),
  };
}

/* ── Backup ──────────────────────────────────────────────────────────────── */

var BAK = {
  head: ['แถวในสมุด'].concat(TABS[T_TX].head),
  text: TABS[T_TX].text.map(function (c) { return c + 1; }),
};

/** แท็บเดือนในไฟล์สำรองรายไตรมาสที่สคริปต์สร้างเอง */
function bakTab_(day) {
  var p = period_(day);
  var file = ownFile_('bak|' + p.q, 'WMS สมุดสต๊อก · สำรอง Transaction ' + p.y + ' Q' + p.q.slice(-1), true);
  return monthTab_(file, p.ym, BAK, true);
}

/**
 * ต่อท้ายแถวใหม่ของ Transaction ลงไฟล์สำรอง (เรียกภายใต้ล็อก) จำแถวที่สำรองแล้วใน Script Properties (bakRow)
 * ยอดยกมาเปลี่ยน (ลงใหม่) = เริ่มสำรองใหม่ตั้งแต่แถว 2 · ครั้งละไม่เกิน BACKUP_ROWS แถว
 */
function backup_() {
  var props = PropertiesService.getScriptProperties();
  var tx = tab_(T_TX), last = tx.getLastRow();
  var op = (docs_().filter(function (d) { return d.type === TYPE_OPEN && d.status !== VOID; }).pop() || {}).doc || '';
  var done = +(props.getProperty('bakRow') || 1);
  if ((props.getProperty('bakDoc') || '') !== op || done > last) done = 1;
  var n = Math.max(0, Math.min(last - done, BACKUP_ROWS));
  var at = stamp_();
  if (n) {
    var vals = tx.getRange(done + 1, 1, n, TABS[T_TX].head.length).getValues();
    append_(bakTab_(today_()), BAK, vals.map(function (r, i) { return [done + 1 + i].concat(r); }));
  }
  props.setProperty('bakRow', String(done + n));
  props.setProperty('bakDoc', op);
  props.setProperty('bakAt', at);
  return { app: 'book', rows: n, at: at, upTo: done + n, more: Math.max(0, last - done - n) };
}

/** ตัวที่ตั้งเวลาเรียกทุกคืน */
function backup() { return withLock_(backup_); }

/** รันครั้งเดียวจากหน้าแก้สคริปต์: ตั้งเวลาสำรองทุกคืนตีหนึ่ง (รันซ้ำได้ ตัวเก่าถูกลบก่อน) */
function installBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backup').timeBased().everyDays(1).atHour(1).create();
  return 'ตั้งเวลาสำรองทุกคืนตีหนึ่งแล้ว';
}
