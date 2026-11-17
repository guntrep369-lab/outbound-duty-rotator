/**
 * roster-api.gs — ตารางกะส่วนกลาง ทุกเครื่องที่ใส่ URL นี้เห็นข้อมูลชุดเดียวกัน
 *
 * ใช้กับหน้าตารางกะ (public/roster) — ใส่ URL ในหน้าตั้งค่า ช่อง "Apps Script URL — ตารางกะ"
 * ต้องอยู่ใน Google Sheet ของตัวเอง ไม่ใช่ชีตเดียวกับออเดอร์ สต๊อก หรือไฟล์รถบริษัท
 * เพราะ Apps Script หนึ่งโปรเจกต์มี doGet / doPost ได้ชุดเดียว
 *
 * วิธีติดตั้งอยู่ใน README หัวข้อ "Sharing the schedule across devices"
 */

// รหัสที่ทุกเครื่องต้องใส่ให้ตรงกันในหน้าตั้งค่า — ตั้งเอง ยาว ๆ เดายาก ห้ามเว้นว่าง
// ในตารางกะมีชื่อพนักงาน คนที่รู้แค่ URL จึงต้องอ่านหรือแก้ไม่ได้
var ROSTER_TOKEN = '';

// รหัสของหน้าดูสำหรับทีม Logis (public/shiftlog/logis.html) — ต้องไม่ซ้ำกับ ROSTER_TOKEN
// รหัสนี้เห็นได้แค่ออเดอร์ที่ติดปัญหาในสมุดกะ ไม่เห็นรายชื่อหรือตารางกะ และแก้อะไรไม่ได้
// ว่างไว้ = ปิดหน้าดูของ Logis
var VIEW_TOKEN = '';

// รหัสของหน้าดูสำหรับ HR (public/roster/hr.html) — ต้องไม่ซ้ำกับสองรหัสข้างบน
// รหัสนี้เห็นตารางกะทุกคาบ วันลา ขาด มาสาย OT และแผน OS เสริม แต่ไม่เห็น KPI กับสมุดกะ และแก้อะไรไม่ได้
// ว่างไว้ = ปิดหน้า HR · เปลี่ยนรหัส = ลิงก์ที่เคยส่งให้ HR ใช้ไม่ได้ทันที
var HR_TOKEN = '';

var DATA_SHEET = 'roster';  // ข้อมูลล่าสุด แบ่งเป็นท่อน ท่อนละแถว
var LOG_SHEET = 'log';      // ใครบันทึกเมื่อไหร่ ไว้ไล่ดูตอนข้อมูลแปลก
var CHUNK = 40000;          // ช่องหนึ่งเก็บได้ 50,000 ตัวอักษร เผื่อไว้

/** บอกแค่ว่าเป็นสคริปต์ตารางกะ ให้หน้าตั้งค่าเช็คว่าใส่ URL ถูกตัว — ข้อมูลจริงต้องมีรหัส */
function doGet() {
  return out_({ app: 'roster' });
}

/**
 * คำขอทั้งหมดเป็น POST เพื่อให้รหัสอยู่ในเนื้อคำขอ ไม่ใช่ใน URL ที่ไปค้างตามประวัติและ log
 *   rev  — ฉบับล่าสุดเป็นฉบับที่เท่าไหร่ (เบา ใช้เช็คทุกนาที)
 *   load — ข้อมูลทั้งชุด
 *   save — บันทึก ถ้าเครื่องนั้นแก้จากฉบับล่าสุด
 *   view — ออเดอร์ติดปัญหาในสมุดกะ สำหรับหน้าดูของ Logis (ใช้ VIEW_TOKEN)
 *   hr   — ตารางกะกับวันลา สำหรับหน้าดูของ HR (ใช้ HR_TOKEN)
 */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'คำขอไม่ใช่ JSON' }); }
  if (req.op === 'view') return out_(view_(req));
  if (req.op === 'hr') return out_(hr_(req));
  if (!ROSTER_TOKEN) return out_({ error: 'ยังไม่ได้ตั้ง ROSTER_TOKEN ใน Apps Script' });
  if (req.token !== ROSTER_TOKEN) return out_({ error: 'รหัสไม่ตรงกับ ROSTER_TOKEN ใน Apps Script' });
  if (req.op === 'rev') return out_(pub_(meta_()));
  if (req.op === 'load') { var m = meta_(); var r = pub_(m); r.data = read_(m); return out_(r); }
  if (req.op === 'save') return out_(save_(req));
  return out_({ error: 'ไม่รู้จักคำสั่ง ' + req.op });
}

/**
 * บันทึกเฉพาะเมื่อ baseRev ตรงกับฉบับล่าสุด ไม่งั้นตอบ conflict พร้อมข้อมูลล่าสุด
 * ให้เครื่องนั้นรวมกับของตัวเองก่อนแล้วส่งใหม่ — สองเครื่องแก้พร้อมกันจะไม่มีใครทับใครเงียบ ๆ
 *
 * เขียนสลับคอลัมน์ A / B ทุกฉบับ แล้วค่อยชี้ไปคอลัมน์ใหม่ทีหลังสุด ถ้าสคริปต์ล้มกลางทาง
 * ฉบับเดิมยังอยู่ครบ ไม่ใช่ครึ่งเก่าครึ่งใหม่ที่อ่านไม่ออกทั้งสองฉบับ
 */
function save_(req) {
  if (!req.data || !Array.isArray(req.data.employees)) return { error: 'ข้อมูลที่ส่งมาไม่ใช่ตารางกะ' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { error: 'มีเครื่องอื่นกำลังบันทึกอยู่ ลองใหม่อีกครั้ง' };
  try {
    var m = meta_();
    if (Number(req.baseRev) !== m.rev) {
      var c = pub_(m);
      c.conflict = true;
      c.data = read_(m);
      return c;
    }
    var text = JSON.stringify(req.data), parts = [];
    // ขึ้นต้นทุกท่อนด้วย j — ชีตจะได้ไม่แปลงท่อนที่บังเอิญขึ้นต้นด้วย = หรือหน้าตาเป็นตัวเลขไปเป็นอย่างอื่น
    for (var i = 0; i < text.length; i += CHUNK) parts.push(['j' + text.slice(i, i + CHUNK)]);
    var col = m.col === 1 ? 2 : 1;
    var sh = sheet_(DATA_SHEET);
    if (sh.getMaxRows() < parts.length) sh.insertRowsAfter(sh.getMaxRows(), parts.length - sh.getMaxRows());
    sh.getRange(1, col, sh.getMaxRows(), 1).clearContent();
    var rg = sh.getRange(1, col, parts.length, 1);
    rg.setNumberFormat('@');
    rg.setValues(parts);
    SpreadsheetApp.flush();

    var at = Date.now(), by = String(req.by || '').slice(0, 60), rev = m.rev + 1;
    PropertiesService.getScriptProperties().setProperties({
      rev: String(rev), at: String(at), by: by, col: String(col), chunks: String(parts.length),
    });
    var log = sheet_(LOG_SHEET);
    if (!log.getLastRow()) log.appendRow(['เวลา', 'โดย', 'ฉบับที่', 'ขนาด (ตัวอักษร)']);
    log.appendRow([new Date(at), by, rev, text.length]);
    return { ok: true, app: 'roster', rev: rev, at: at, by: by };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ออเดอร์ที่ยังค้าง กับที่เพิ่งปิดไปไม่เกิน 3 วัน — ตัดในสคริปต์ก่อนส่ง รหัสดูจึงไม่เคยได้
 * รายชื่อพนักงาน วันลา หรือเรื่องอื่นในสมุดกะที่เป็นเรื่องภายในทีม
 */
// product size qty sku — รายการรุ่นแรกที่มีสินค้าตัวเดียว · items — สินค้าที่ติ๊กไว้ (ได้หลายตัว)
var VIEW_FIELDS = ['date', 'shift', 'sup', 'order', 'consign', 'items', 'product', 'size', 'qty', 'sku',
  'reason', 'logis', 'text', 'updates', 'open', 'result', 'by', 'at', 'closedBy', 'closedAt'];
var VIEW_DAYS = 3;

function view_(req) {
  if (!VIEW_TOKEN) return { error: 'ยังไม่ได้เปิดหน้าดูของ Logis — ตั้ง VIEW_TOKEN ใน Apps Script' };
  if (req.token !== VIEW_TOKEN) return { error: 'รหัสดูไม่ถูกต้อง' };
  var m = meta_(), d = read_(m) || {}, log = d.shiftLog || {}, items = [];
  var cut = Date.now() - VIEW_DAYS * 86400000;
  for (var id in log) {
    var e = log[id];
    if (!e || e.kind !== 'order') continue;
    if (!e.open && !(Number(e.closedAt) > cut)) continue;
    var o = { id: id };
    VIEW_FIELDS.forEach(function (k) { if (e[k] !== undefined) o[k] = e[k]; });
    items.push(o);
  }
  return { app: 'roster', view: true, at: m.at, items: items, shiftDefs: shiftDefs_(d.shiftDefs) };
}

/**
 * ชื่อกับเวลากะที่ทีมตั้งไว้ในหน้าตารางกะ — หน้าดูของ Logis ใช้บอกว่าออเดอร์ค้างมาจากกะไหน
 * ส่งเฉพาะชื่อกับเวลา ไม่ใช่เรื่องภายในทีม · หน้าตารางกะรุ่นก่อนไม่มีช่องนี้ = รายการว่าง (ใช้ชื่อตั้งต้น)
 */
function shiftDefs_(defs) {
  var out = [];
  (Array.isArray(defs) ? defs : []).forEach(function (x) {
    if (!x || typeof x.from !== 'string' || !x.shifts) return;
    var o = { from: x.from, shifts: {} };
    ['morning', 'evening'].forEach(function (id) {
      var s = x.shifts[id] || {};
      o.shifts[id] = { name: String(s.name || ''), start: String(s.start || ''), end: String(s.end || '') };
      if (typeof s.ack === 'boolean') o.shifts[id].ack = s.ack;
      if (s.last && typeof s.last === 'object') {
        o.shifts[id].last = { start: String(s.last.start || ''), end: String(s.last.end || '') };
        if (typeof s.last.skipOff === 'number') o.shifts[id].last.skipOff = s.last.skipOff;
      }
    });
    out.push(o);
  });
  return out;
}

/**
 * ตารางกะสำหรับ HR — คัดในสคริปต์ก่อนส่ง รหัส HR จึงไม่เคยได้ KPI สมุดกะ หรือจำนวนคนขั้นต่ำ
 * คนแต่ละคนส่งแค่ชื่อ ชื่อเล่น กลุ่ม วันหยุด และวันที่ย้ายกลุ่ม · วันลา/สาย/OT ส่งเฉพาะของคนที่ยังอยู่ในรายชื่อ
 * แผน OS เสริม (ขอกี่คน / มาจริงกี่คน ต่อวันต่อกะ) ส่งไปด้วย — HR ใช้ตัวเลขที่ขอไปเรียกคนเสริมเข้ามา
 */
var HR_PERSON = ['name', 'nick', 'group', 'dayOff', 'shift'];

function hr_(req) {
  if (!HR_TOKEN) return { error: 'ยังไม่ได้เปิดหน้า HR — ตั้ง HR_TOKEN ใน Apps Script' };
  if (HR_TOKEN === ROSTER_TOKEN || HR_TOKEN === VIEW_TOKEN) return { error: 'HR_TOKEN ต้องไม่ซ้ำกับรหัสอื่นใน Apps Script' };
  if (req.token !== HR_TOKEN) return { error: 'รหัส HR ไม่ถูกต้อง' };
  var m = meta_(), d = read_(m) || {}, names = {};
  function people(list) {
    return (Array.isArray(list) ? list : []).filter(function (p) { return p && typeof p.name === 'string'; }).map(function (p) {
      var o = {};
      HR_PERSON.forEach(function (k) { if (p[k] !== undefined) o[k] = p[k]; });
      if (Array.isArray(p.changes)) {
        o.changes = p.changes.filter(function (c) { return c && typeof c.from === 'string'; }).map(function (c) {
          var x = { from: c.from };
          if (c.group !== undefined) x.group = c.group;
          if (c.dayOff !== undefined) x.dayOff = c.dayOff;
          return x;
        });
      }
      names[p.name] = true;
      return o;
    });
  }
  function pick(list, keys) {
    return (Array.isArray(list) ? list : []).filter(function (x) { return x && typeof x === 'object'; }).map(function (x) {
      var o = {};
      keys.forEach(function (k) { if (x[k] !== undefined) o[k] = x[k]; });
      return o;
    });
  }
  // ช่องที่ key = "วันที่|ชื่อ" — เก็บเฉพาะของคนที่ยังอยู่ในรายชื่อ
  function byName(map) {
    var o = {};
    for (var k in (map && typeof map === 'object' ? map : {})) {
      var b = k.indexOf('|');
      if (b > 0 && names[k.slice(b + 1)]) o[k] = map[k];
    }
    return o;
  }
  var employees = people(d.employees), outsource = people(d.outsource);
  return {
    app: 'roster', hr: true, at: m.at,
    data: {
      employees: employees, outsource: outsource,
      periods: pick(d.periods, ['id', 'start', 'end', 'groupA']),
      holidays: pick(d.holidays, ['date', 'name']),
      extraPro: pick(d.extraPro, ['date', 'name']),
      overrides: byName(d.overrides), late: byName(d.late), ot: byName(d.ot),
      osExtra: osExtra_(d.osExtra),
      shiftDefs: shiftDefs_(d.shiftDefs),
    },
  };
}

/** แผน OS เสริม — key "วันที่|กะ" ค่า {req: ขอกี่คน, got: มาจริงกี่คน} เอาเฉพาะตัวเลข */
function osExtra_(map) {
  var o = {};
  for (var k in (map && typeof map === 'object' ? map : {})) {
    if (!/^\d{4}-\d\d-\d\d\|(morning|evening)$/.test(k)) continue;
    var e = map[k] || {}, x = {};
    if (typeof e.req === 'number') x.req = e.req;
    if (typeof e.got === 'number') x.got = e.got;
    if (x.req !== undefined || x.got !== undefined) o[k] = x;
  }
  return o;
}

function meta_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    rev: Number(p.rev || 0), at: Number(p.at || 0), by: p.by || '',
    col: Number(p.col || 0), chunks: Number(p.chunks || 0),
  };
}

/** ส่วนที่บอกเครื่องอื่นได้ — คอลัมน์กับจำนวนท่อนเป็นเรื่องภายในของชีต */
function pub_(m) {
  return { app: 'roster', rev: m.rev, at: m.at, by: m.by };
}

function read_(m) {
  if (!m.rev || !m.col || !m.chunks) return null;
  var vals = sheet_(DATA_SHEET).getRange(1, m.col, m.chunks, 1).getValues();
  return JSON.parse(vals.map(function (r) { return String(r[0]).slice(1); }).join(''));
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
