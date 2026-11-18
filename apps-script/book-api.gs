/**
 * book-api.gs — สมุดสต๊อก ขั้น 1–2: รหัสคน เลขที่เอกสาร ตัดขาย ย้าย/เติม/QA และคืนของ ใช้กับหน้า public/book/
 *
 * ผูกกับไฟล์ Google Sheet ใหม่ "WMS สมุดสต๊อก" ไม่ใช่ไฟล์ Transaction
 * สคริปต์นี้ไม่รู้จักสมุด Transaction เลย ไม่มี URL ไม่มีรหัสไฟล์ของมัน และไม่เปิดไฟล์อื่นนอกจากไฟล์ที่ตัวเองสร้าง
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
 * ไม่ใส่ api               บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าเว็บเช็คว่าใส่ URL ถูกตัว
 *
 * ทุกคำตอบมี v = รุ่นของสคริปต์ หน้าเว็บเทียบกับรุ่นที่ต้องใช้ ลืม Deploy เวอร์ชันใหม่จะขึ้นแถบแดงบอก
 */

/* เพิ่มทีละ 1 ทุกครั้งที่หน้าเว็บต้องใช้ของใหม่จากสคริปต์ (ต้องตรงกับ API_V ใน public/wms-book.js) */
var VERSION = 2;

var T_USER = 'ผู้ใช้';
var T_DOC = 'เลขที่เอกสาร';
var T_COPY = 'แถวที่คัดลอก';

var TABS = {};
TABS[T_USER] = {
  head: ['ชื่อ', 'รหัส', 'สิทธิ์', 'ใช้งาน', 'หมายเหตุ'],
  text: [1, 2, 3, 4, 5],
};
TABS[T_DOC] = {
  head: ['เลขที่', 'ประเภท', 'วันที่', 'ผู้ลง', 'บันทึกเมื่อ', 'แถว', 'ชิ้น', 'ออเดอร์', 'สถานะ', 'ยกเลิกโดย', 'ยกเลิกเมื่อ',
    'เหตุผล', 'รหัสชุด', 'ไฟล์', 'แถวที่คัดลอก', 'แถวสมุดตอนบันทึก'],
  text: [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15],
};
TABS[T_COPY] = {
  head: ['เลขที่', 'SKU', 'SKU เต็ม', 'LOT', 'PO', 'โลเบิก', 'โลรับ', 'ชิ้น', 'ประเภท', 'Note', 'Status'],
  text: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11],
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
    if (req.op === 'bk-login') { var u = auth_(req); return out_({ app: 'book', who: u.name, role: u.role }); }
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
function setup() { [T_USER, T_DOC, T_COPY].forEach(tab_); }

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
  var props = PropertiesService.getScriptProperties();
  var key = 'log|' + p.q;
  var id = props.getProperty(key);
  var file = null;
  if (id) file = SpreadsheetApp.openById(id);
  else if (make) {
    file = SpreadsheetApp.create('WMS สมุดสต๊อก · ออเดอร์ที่ตัด ' + p.y + ' Q' + p.q.slice(-1));
    props.setProperty(key, file.getId());
  }
  if (!file) return null;
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
      base: +r[15] || 0,
    };
  }).filter(function (d) { return d.doc; });
  if (typeof from === 'number') {
    copies_(list.filter(function (d) { return d.at && dayNo_(d.at.slice(0, 10)) >= from; }));
  }
  return list;
}

/** ใส่ d.copy ให้ชุดในรายการ อ่านแท็บแถวที่คัดลอกช่วงเดียวครอบทุกชุด (ชุดของรุ่น 1 เก็บเป็น JSON ในช่องเดียว) */
function copies_(list) {
  var lo = 0, hi = 0;
  list.forEach(function (d) {
    d.copy = [];
    var m = /^@(\d+)\+(\d+)$/.exec(d.ptr);
    if (m) {
      d.at0 = +m[1]; d.n0 = +m[2];
      if (!lo || d.at0 < lo) lo = d.at0;
      hi = Math.max(hi, d.at0 + d.n0 - 1);
    } else if (/^\[/.test(d.ptr)) {
      try { d.copy = JSON.parse(d.ptr) || []; } catch (e) { d.copy = []; }
    }
  });
  if (!lo) return;
  var vals = tab_(T_COPY).getRange(lo, 1, hi - lo + 1, TABS[T_COPY].head.length).getValues();
  list.forEach(function (d) {
    if (!d.n0) return;
    d.copy = vals.slice(d.at0 - lo, d.at0 - lo + d.n0).filter(function (r) { return text_(r[0]) === d.doc; }).map(function (r) {
      return [text_(r[1]), text_(r[2]), text_(r[3]), text_(r[4]), text_(r[5]), text_(r[6]), +r[7] || 0, text_(r[8]), text_(r[9]), text_(r[10])];
    });
  });
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
  append_(tab_(T_DOC), TABS[T_DOC], [[o.doc, o.type, o.day, o.who, o.at, o.copy.length, o.qty, o.orders || 0,
    '', '', '', '', o.batch, o.file || '', '@' + start + '+' + o.copy.length, o.base || '']]);
}

function lite_(d, withCopy) {
  var o = { doc: d.doc, type: d.type, date: d.date, who: d.who, at: d.at, rows: d.rows, qty: d.qty, orders: d.orders,
    status: d.status, voidBy: d.voidBy, voidAt: d.voidAt, why: d.why, batch: d.batch, base: d.base };
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
  return d ? { app: 'book', doc: d.doc, again: true, at: d.at, status: d.status } : null;
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

  return withLock_(function () {
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;

    var have = cutKeys_(day), dup = [];
    clean.forEach(function (l) { if (have[l.key]) dup.push({ key: l.key, doc: have[l.key] }); });
    if (dup.length) return { error: 'มีบรรทัดออเดอร์ที่ตัดไปแล้ว ' + dup.length + ' บรรทัด', dup: dup };

    var doc = nextDoc_(list), at = stamp_(), ym = period_(day).ym;
    var orders = {};
    clean.forEach(function (l) { orders[l.sys + '|' + l.order] = 1; });
    var log = logTab_(ym, true);
    append_(log, LOG, clean.map(function (l) {
      return [doc, '', l.sys, l.order, l.sku, l.qty, day, l.ref, l.piles, user.name, at, l.track];
    }));
    writeDoc_({ doc: doc, type: TYPE_SALE, day: day, who: user.name, at: at, copy: cp.rows, qty: sumLines,
      orders: Object.keys(orders).length, batch: batch, file: ym, base: base_(req) });
    return { app: 'book', doc: doc, at: at, lines: clean.length, rows: cp.rows.length, qty: sumLines };
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
  return withLock_(function () {
    var list = docs_();
    var again = again_(list, batch);
    if (again) return again;
    var doc = nextDoc_(list), at = stamp_();
    writeDoc_({ doc: doc, type: TYPE_MOVE, day: day, who: user.name, at: at, copy: cp.rows, qty: cp.qty, batch: batch, base: base_(req) });
    return { app: 'book', doc: doc, at: at, rows: cp.rows.length, qty: cp.qty };
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

    var doc = nextDoc_(list), at = stamp_();
    var orders = {};
    clean.forEach(function (l) { if (l.order) orders[l.sys + '|' + l.order] = 1; });
    var file = ym + RET_SUFFIX;
    append_(logTab_(file, true), RET, clean.map(function (l) {
      return [doc, '', l.sys, l.order, l.sku, l.qty, day, l.ref, l.piles, user.name, at, l.track, l.cut];
    }));
    writeDoc_({ doc: doc, type: TYPE_RET, day: day, who: user.name, at: at, copy: cp.rows, qty: sumLines,
      orders: Object.keys(orders).length, batch: batch, file: file, base: base_(req) });
    return { app: 'book', doc: doc, at: at, lines: clean.length, rows: cp.rows.length, qty: sumLines };
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
