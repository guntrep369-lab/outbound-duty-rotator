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
 */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'คำขอไม่ใช่ JSON' }); }
  if (req.op === 'view') return out_(view_(req));
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
var VIEW_FIELDS = ['date', 'shift', 'sup', 'order', 'consign', 'product', 'size', 'qty', 'sku',
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
  return { app: 'roster', view: true, at: m.at, items: items };
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
