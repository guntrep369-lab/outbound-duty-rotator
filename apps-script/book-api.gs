/**
 * book-api.gs — สมุดสต๊อก ขั้น 1: รหัสคน เลขที่เอกสาร และบันทึกออเดอร์ที่ตัดขาย ใช้กับหน้า public/book/
 *
 * ผูกกับไฟล์ Google Sheet ใหม่ "WMS สมุดสต๊อก" ไม่ใช่ไฟล์ Transaction
 * สคริปต์นี้ไม่รู้จักสมุด Transaction เลย ไม่มี URL ไม่มีรหัสไฟล์ของมัน และไม่เปิดไฟล์อื่นนอกจากไฟล์ที่ตัวเองสร้าง
 * ยอดสต๊อกที่หน้าตัดขายใช้คิดมาจาก tx-api.gs (อ่านอย่างเดียว) แล้วหน้าเว็บคัดลอกแถวให้คนไปวางในชีตเดิมเอง
 * สมุดจริงจึงไม่มีทางถูกแตะจากสคริปต์นี้
 *
 * แท็บที่สคริปต์สร้างเองตอนใช้ครั้งแรก
 *   ผู้ใช้          ชื่อ รหัส สิทธิ์ ใช้งาน — หัวหน้าพิมพ์เองในไฟล์ชีต
 *                  รหัสพิมพ์เป็นตัวเลข 4–8 หลัก ล็อกอินสำเร็จครั้งแรกสคริปต์เปลี่ยนเป็นรหัสลับ (#…) อ่านย้อนไม่ได้
 *                  ลืมรหัส = หัวหน้าพิมพ์เลขใหม่ทับช่องเดิม · สิทธิ์ หัวหน้า (หัวหน้าและรองหัวหน้า Inventory) หรือ ลงรายการ
 *                  ใช้งาน ใส่ ไม่ = ปิดสิทธิ์คนนั้น
 *   เลขที่เอกสาร    หนึ่งแถวต่อหนึ่งชุดที่บันทึก เลขรันเอง T + ปีเดือน + เลข 4 หลัก (T2611-0001) เริ่มใหม่ทุกเดือน
 *                  เก็บแถวที่คัดลอกไปวางไว้ด้วย เครื่องอื่นกดคัดลอกซ้ำได้ หน้าเว็บใช้หักยอดชุดที่ตัดหลังดึงสต๊อก
 *
 * ไฟล์ที่สคริปต์สร้างเอง: "WMS สมุดสต๊อก · ออเดอร์ที่ตัด ปี Qn" ไตรมาสละไฟล์ เดือนละแท็บ (2026-11)
 *   หนึ่งแถวต่อหนึ่งบรรทัดออเดอร์ (ระบบ + ออเดอร์ + SKU) ใช้กันตัดซ้ำ และไว้หาว่าออเดอร์นั้นตัดจากกองไหน (คืนของ ขั้น 2)
 *   แยกไฟล์เพราะออเดอร์วันละราว 3,000 บรรทัด ทั้งปีเกิน 10 ล้านช่องที่ไฟล์ Google Sheet ไฟล์เดียวรับได้
 *   รหัสไฟล์เก็บใน Script Properties (log|2026Q4) สคริปต์เปิดได้แค่ไฟล์ที่ตัวเองสร้าง
 *
 * ?api=bk-names            รายชื่อคนที่ใช้งานอยู่ (ไม่มีรหัส) ให้หน้าเว็บขึ้นช่องเลือกชื่อ
 * POST {op:'bk-login'}     เช็คชื่อกับรหัส ตอบสิทธิ์
 * POST {op:'bk-seen'}      บรรทัดออเดอร์ไหนตัดไปแล้ว เลขที่เอกสารอะไร
 * POST {op:'bk-cut'}       บันทึกชุดตัดขาย ได้เลขที่เอกสาร ส่งซ้ำด้วยรหัสชุดเดิมได้เลขเดิม บรรทัดที่ตัดไปแล้ว = ไม่รับทั้งชุด
 * POST {op:'bk-recent'}    ชุดที่บันทึกในไม่กี่วันล่าสุด พร้อมแถวที่คัดลอก
 * POST {op:'bk-void'}      ยกเลิกชุด (หัวหน้า) บรรทัดออเดอร์ของชุดนั้นตัดใหม่ได้ ต้องไปลบแถวเลขนั้นในชีตเดิมเอง
 * ไม่ใส่ api               บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าเว็บเช็คว่าใส่ URL ถูกตัว
 *
 * ทุกคำตอบมี v = รุ่นของสคริปต์ หน้าเว็บเทียบกับรุ่นที่ต้องใช้ ลืม Deploy เวอร์ชันใหม่จะขึ้นแถบแดงบอก
 */

/* เพิ่มทีละ 1 ทุกครั้งที่หน้าเว็บต้องใช้ของใหม่จากสคริปต์ (ต้องตรงกับ API_V ใน public/wms-book.js) */
var VERSION = 1;

var T_USER = 'ผู้ใช้';
var T_DOC = 'เลขที่เอกสาร';

var TABS = {};
TABS[T_USER] = {
  head: ['ชื่อ', 'รหัส', 'สิทธิ์', 'ใช้งาน', 'หมายเหตุ'],
  text: [1, 2, 3, 4, 5],
};
TABS[T_DOC] = {
  head: ['เลขที่', 'ประเภท', 'วันที่', 'ผู้ลง', 'บันทึกเมื่อ', 'แถว', 'ชิ้น', 'ออเดอร์', 'สถานะ', 'ยกเลิกโดย', 'ยกเลิกเมื่อ',
    'เหตุผล', 'รหัสชุด', 'ไฟล์', 'แถวที่คัดลอก'],
  text: [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15],
};
/* แท็บเดือนในไฟล์ออเดอร์ที่ตัด — สองคอลัมน์แรกคือที่ต้องอ่านทุกครั้งที่เช็คตัดซ้ำ จึงอยู่ติดกันทางซ้าย */
var LOG = {
  head: ['เลขที่', 'สถานะ', 'ระบบ', 'ออเดอร์', 'SKU', 'ชิ้น', 'วันที่ตัด', 'เลขอ้างอิง', 'กองที่ตัด (โล|LOT|PO|ชิ้น)', 'ผู้ลง', 'บันทึกเมื่อ'],
  text: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11],
};

var ROLE_HEAD = 'หัวหน้า';
var ROLE_USER = 'ลงรายการ';
var VOID = 'ยกเลิก';
var TYPE_SALE = 'ตัดขาย';
var SYSTEMS = ['JST', 'CRM'];
var LINES_MAX = 8000;      // บรรทัดออเดอร์ต่อชุด ไฟล์ JST ทั้งวันราว 2,400 บรรทัด
var ROWS_MAX = 3000;       // แถวที่คัดลอกต่อชุด (ต่อ SKU ต่อกอง) ทั้งวันราว 350
var PILES_MAX = 20;        // กองต่อหนึ่งบรรทัดออเดอร์
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
  var head = TABS[name].head;
  sheet.getRange(1, 1, 1, head.length).setValues([head]);
  sheet.setFrozenRows(1);
  TABS[name].text.forEach(function (c) { sheet.getRange(2, c, sheet.getMaxRows() - 1, 1).setNumberFormat('@'); });
  return sheet;
}

/** รันครั้งเดียวจากหน้าแก้สคริปต์ก็ได้ ให้เห็นแท็บผู้ใช้ก่อนมีคนล็อกอิน (ใช้งานจริงสคริปต์สร้างเองอยู่แล้ว) */
function setup() { [T_USER, T_DOC].forEach(tab_); }

function rows_(sheet, cols) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, cols).getValues();
}

/** เขียนต่อท้าย ตั้งคอลัมน์ข้อความก่อนเขียน แถวไม่พอให้เพิ่มก่อน (Apps Script ไม่ขยายแท็บให้เอง) */
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

/**
 * แท็บเดือนของไฟล์ออเดอร์ที่ตัด make = สร้างไฟล์ / แท็บที่ยังไม่มี ไม่ make แล้วไม่มี = null
 * เปิดด้วยรหัสไฟล์ที่ตัวเองเก็บไว้เท่านั้น
 */
function logTab_(ym, make) {
  var p = period_(ym + '-01');
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
  var sheet = file.getSheetByName(ym);
  if (!sheet) {
    if (!make) return null;
    sheet = file.insertSheet(ym, file.getSheets().length);
    sheet.getRange(1, 1, 1, LOG.head.length).setValues([LOG.head]);
    sheet.setFrozenRows(1);
    /* แท็บเปล่าที่ Google ใส่มาตอนสร้างไฟล์ ลบทิ้งเมื่อมีแท็บเดือนแล้ว */
    file.getSheets().forEach(function (t) {
      if (t.getName() !== ym && /^(Sheet|ชีต)\s*1$/i.test(t.getName()) && t.getLastRow() === 0 && file.deleteSheet) file.deleteSheet(t);
    });
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) throw new Error('วันที่ตัดต้องเป็น yyyy-mm-dd');
  var gap = dayNo_(today_()) - dayNo_(day);
  if (gap < -1) throw new Error('วันที่ตัด ' + day + ' ยังไม่ถึง');
  if (gap > BACK_DAYS) throw new Error('วันที่ตัด ' + day + ' ย้อนหลังเกิน ' + BACK_DAYS + ' วัน');
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

/* ── เลขที่เอกสาร ─────────────────────────────────────────────────────────── */

function docs_() {
  var sheet = tab_(T_DOC);
  return rows_(sheet, TABS[T_DOC].head.length).map(function (r, i) {
    var copy = [];
    try { copy = JSON.parse(text_(r[14]) || '[]') || []; } catch (e) { copy = []; }
    return {
      row: i + 2, doc: text_(r[0]), type: text_(r[1]), date: text_(r[2]), who: text_(r[3]), at: text_(r[4]),
      rows: +r[5] || 0, qty: +r[6] || 0, orders: +r[7] || 0, status: text_(r[8]),
      voidBy: text_(r[9]), voidAt: text_(r[10]), why: text_(r[11]), batch: text_(r[12]), file: text_(r[13]), copy: copy,
    };
  }).filter(function (d) { return d.doc; });
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

function lite_(d, withCopy) {
  var o = { doc: d.doc, type: d.type, date: d.date, who: d.who, at: d.at, rows: d.rows, qty: d.qty, orders: d.orders,
    status: d.status, voidBy: d.voidBy, voidAt: d.voidAt, why: d.why, batch: d.batch };
  if (withCopy) o.copy = d.copy;
  return o;
}

/* ── ตัดขาย ──────────────────────────────────────────────────────────────── */

/**
 * req = {batch, date, lines:[{sys, order, ref, sku, qty, piles:[[loc, lot, po, ชิ้น]]}],
 *        copy:[[SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ประเภท, Note, Status]]}
 * ทั้งชุดหรือไม่รับเลย: แถวที่คนจะวางในชีตเดิมต้องตรงกับบรรทัดที่บันทึกไว้ทุกบรรทัด
 * ส่งซ้ำด้วย batch เดิม (เน็ตหลุดตอนรอคำตอบ) ได้เลขเดิม ไม่บันทึกซ้ำ
 */
function cut_(req, user) {
  var batch = plain_(req.batch, 60);
  if (!batch) return { error: 'ไม่มีรหัสชุด' };
  var day = checkDay_(text_(req.date));
  var lines = Array.isArray(req.lines) ? req.lines : [];
  var copy = Array.isArray(req.copy) ? req.copy : [];
  if (!lines.length) return { error: 'ไม่มีบรรทัดออเดอร์ให้บันทึก' };
  if (lines.length > LINES_MAX) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LINES_MAX + ' บรรทัดออเดอร์' };
  if (!copy.length || copy.length > ROWS_MAX) return { error: 'แถวที่คัดลอกต้องมี 1–' + ROWS_MAX + ' แถว' };

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
    clean.push({ sys: sys, order: order, ref: plain_(l.ref, 60), sku: sku, qty: qty, piles: ps.join('; '), key: k });
  });
  if (bad.length) return { error: 'มีบรรทัดออเดอร์ไม่ถูก ' + bad.length + ' บรรทัด', bad: bad.slice(0, 50) };

  var rowsOut = [], sumCopy = 0, badCopy = 0;
  copy.forEach(function (c) {
    c = c || [];
    var qty = num_(c[6]);
    if (qty === null || qty <= 0 || !code_(c[0], 60)) { badCopy++; return; }
    sumCopy += qty;
    rowsOut.push([code_(c[0], 60), code_(c[1], 60), code_(c[2], 20), code_(c[3], 40), code_(c[4], 40), code_(c[5], 40),
      qty, plain_(c[7], 20), plain_(c[8], 60), plain_(c[9], 20)]);
  });
  if (badCopy) return { error: 'แถวที่คัดลอกไม่ครบ ' + badCopy + ' แถว' };
  if (Math.abs(sumCopy - sumLines) > 1e-9) return { error: 'ชิ้นในแถวที่คัดลอก (' + sumCopy + ') ไม่เท่ากับชิ้นในออเดอร์ (' + sumLines + ')' };

  return withLock_(function () {
    var list = docs_();
    var again = list.filter(function (d) { return d.batch === batch; })[0];
    if (again) return { app: 'book', doc: again.doc, again: true, at: again.at, status: again.status };

    var have = cutKeys_(day), dup = [];
    clean.forEach(function (l) { if (have[l.key]) dup.push({ key: l.key, doc: have[l.key] }); });
    if (dup.length) return { error: 'มีบรรทัดออเดอร์ที่ตัดไปแล้ว ' + dup.length + ' บรรทัด', dup: dup };

    var doc = nextDoc_(list), at = stamp_(), ym = period_(day).ym;
    var orders = {};
    clean.forEach(function (l) { orders[l.sys + '|' + l.order] = 1; });
    var log = logTab_(ym, true);
    append_(log, LOG, clean.map(function (l) {
      return [doc, '', l.sys, l.order, l.sku, l.qty, day, l.ref, l.piles, user.name, at];
    }));
    append_(tab_(T_DOC), TABS[T_DOC], [[doc, TYPE_SALE, day, user.name, at, rowsOut.length, sumLines, Object.keys(orders).length,
      '', '', '', '', batch, ym, JSON.stringify(rowsOut)]]);
    return { app: 'book', doc: doc, at: at, lines: clean.length, rows: rowsOut.length, qty: sumLines };
  });
}

/** req = {days} ชุดที่บันทึกในไม่กี่วันล่าสุด ใหม่สุดก่อน พร้อมแถวที่คัดลอก */
function recent_(req) {
  var days = Math.max(1, Math.min(RECENT_MAX, +req.days || 2));
  var from = dayNo_(today_()) - days + 1;
  var list = docs_().filter(function (d) { return d.at && dayNo_(d.at.slice(0, 10)) >= from; });
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
    return { app: 'book', doc: doc, status: VOID, at: at, lines: marked };
  });
}
