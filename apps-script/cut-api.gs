/**
 * cut-api.gs — เทียบรายการตัดสต๊อกกับ Report ออเดอร์ของเดือน
 *
 * ใช้กับหน้าเช็ครายการตัดสต๊อก (public/cut-check) — ใส่ URL ในหน้าตั้งค่า
 * ช่อง "Apps Script URL — เช็ครายการตัดสต๊อก" วิธีติดตั้งอยู่ใน README หัวข้อ "Stock Cut Check"
 *
 * ผูกกับไฟล์ Google Sheet ที่มี 4 แท็บด้านล่าง และอ่านแท็บพวกนั้นอย่างเดียว ไม่แก้ข้อมูลตัดสต๊อกเลย
 * ที่เขียนมีแห่งเดียวคือแท็บ "บันทึกการแก้" ซึ่งสคริปต์สร้างเอง เว็บเติมได้แค่แถวต่อท้าย แก้หรือลบแถวเดิมไม่ได้
 * แท็บรายงานโอนย้ายไม่บังคับ ถ้ามี งานโอนย้ายจะเทียบกับรายงานด้วยเลขใบโอนย้าย + SKU แบบเดียวกับออเดอร์
 * ข้อมูลรวมกันหลายแสนแถว ส่งให้เบราว์เซอร์ทั้งหมดไม่ไหว จึงคิดที่นี่แล้วส่งกลับเฉพาะสรุปกับรายการที่ไม่ตรง
 *
 * หน่วยที่เทียบคือ เลขออเดอร์ + SKU เลขคำสั่งซื้อออนไลน์ใช้ไม่ได้ เพราะบางแถวถูกชีตปัดเป็นเลขยกกำลัง
 * ยอดของ TRcloud คือ เบิกออก − รับเข้า เพราะการแก้ตัดผิดลงเป็นแถวรับเข้าของออเดอร์เดิม
 * ส่งยอดรายวันต่อ SKU ไปด้วย หน้าเว็บเอาไปเทียบกับแถวขายในสมุด Transaction (public/wms-cut.js)
 * พร้อมยอดที่ควรออกตาม Report ของแต่ละวัน ถ้าไม่มีรายงานโอนย้าย ส่วนของงานโอนย้ายใช้ยอดที่ตัดจริง
 * ช่องรายวันที่สามแหล่งนี้ไม่เท่ากันส่งรายออเดอร์ไปด้วย ให้ชี้ได้ว่าต่างเพราะออเดอร์ไหน
 *
 * ?api=cut-check   ผลการเทียบ (trc คือ TRcloud เทียบ Report ทีละ ออเดอร์ + SKU + วัน ให้แท็บ TRcloud เทียบ Report)
 *                  took คือเวลาที่ใช้กับแต่ละแท็บ ไฟล์ใหญ่จนตรวจไม่จบใน 5 นาที หยุดเองพร้อมบอกว่าช้าที่ไหน (ส่วน "จับเวลา")
 * ?api=cut-orders&from=...&to=...  แถวตัดของแท็บ Transaction ทีละออเดอร์ ให้หน้า LOT / PO ที่ขายออกปันล็อตให้แต่ละออเดอร์
 *                                  พร้อมเลขคำสั่งซื้อออนไลน์กับบริษัทขนส่งของแต่ละออเดอร์ ให้ไฟล์ส่งออกรายออเดอร์
 * ?api=cut-fixlog  บันทึกการแก้ทั้งหมด (รายการที่กดแก้แล้ว ยกเลิก หรือตรวจแล้วหาย)
 * ?api=shared-at   เวลาของผลตรวจชุดกลางล่าสุด (ดูส่วน "ข้อมูลกลาง" ท้ายไฟล์)
 * POST {op:'fix-log'}  เพิ่มแถวในบันทึกการแก้
 * POST {op:'shared-fresh'}  ตรวจใหม่แล้วเก็บเป็นผลกลางให้ทุกเครื่องเห็นชุดเดียวกัน (ปุ่มตรวจใหม่บนหน้าเว็บ)
 * POST {op:'report-rows', refs:[...]}  แถวใน Report ทุกคอลัมน์ของออเดอร์ที่ติ๊กไว้ ให้ปุ่ม Export บนหน้าเว็บ (อ่านอย่างเดียว)
 * ไม่ใส่ api        บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าตั้งค่าเช็คว่าใส่ URL ถูกตัว
 *
 * ผลตรวจชุดกลางเก็บเป็นไฟล์ JSON ในโฟลเดอร์ "WMS ข้อมูลกลาง" ใน Drive ของเจ้าของสคริปต์ ไม่ได้เขียนลงไฟล์ชีต
 */

var TAB_TX = 'ตัดสต๊อกระบบ Transaction';
var TAB_TR = 'ตัดสต๊อกระบบ TRcloud';
var TAB_JST = 'Report order ระบบJST';
var TAB_CRM = 'Report order ระบบ CRM';
/* ไม่บังคับ ถ้ามีแท็บนี้ งานโอนย้ายจะเทียบกับรายงานนี้แบบเดียวกับออเดอร์ ไฟล์ที่ยังไม่มีใช้ได้เหมือนเดิม */
var TAB_TF = 'Report order ระบบโอนย้าย';

var CANCELLED = 'ยกเลิกแล้ว';
var SHIPPED = 'จัดส่งแล้ว';   // สถานะออเดอร์ JST ค่านี้คู่กับขนส่งยกเลิก = ของออกจากคลังไปแล้ว ลูกค้ายกเลิกทีหลัง
var TRANSFER = 'โอนย้าย';   // ค่าในคอลัมน์ที่มาของแท็บ Transaction งานย้ายคลัง ไม่ใช่ออเดอร์ จึงไม่มีใน Report JST หรือ CRM
var SYS_KEY = { JST: 'jst', CRM: 'crm' };
SYS_KEY[TRANSFER] = 'tf';
var ADJUST_DEPT = 'IV';     // แผนกนี้ปรับยอดคลังเอง ไม่เกี่ยวกับออเดอร์

/* รหัสที่ไม่ใช่ของในคลัง ถ้าไม่ได้ถูกตัดเลยจะไม่นับเป็นข้อผิดพลาด แต่ถ้าถูกตัดจริงจะขึ้นรายการตามปกติ */
var GOOD_SKU = /^[A-Z]{3}\d{10}$/;
var NON_STOCK = /^STR/;

var READ_ROWS = 20000;      // อ่านทีละก้อน ไม่ให้สี่แท็บกินหน่วยความจำพร้อมกัน
var CHUNK_ROWS = 20000;     // สูตรแท็บ Transaction ต่อข้อมูลทีละก้อนเท่านี้ แถวสุดท้ายลงตัวพอดีแปลว่าอาจโดนตัดทิ้ง
var GAP_MIN_ORDERS = 5;     // ทั้งวันไม่ถูกตัดเลยอย่างน้อยกี่ออเดอร์ ถึงรวมเป็นก้อน "ขาดทั้งวัน"
var ORDER_MERGE = 5;        // ออเดอร์ที่ขาดทั้งใบและมี SKU ตั้งแต่เท่านี้ รวมเป็นแถวเดียว
var ROWS_MAX = 1000;        // รายการต่อประเภท ถ้าเกินบอกจำนวนจริงแล้วส่งแค่ที่หนักสุด
var LIST_MAX = 300;         // เลขออเดอร์ที่แนบไปต่อหนึ่งก้อน
var CELL_MAX = 40;          // ออเดอร์ต่อหนึ่งช่องรายวัน วันที่ทั้งวันลงคนละวันมีได้เป็นร้อยต่อ SKU

/* ประเภทที่ต้องตามแก้ ลำดับนี้คือลำดับที่หน้าเว็บแสดง */
var KINDS = ['over', 'wrong', 'ghost', 'cancel', 'under', 'blankCut', 'transferDiff'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api === 'cut-check') return out_(p.shared ? sharedRead_('cut-check', null, check_) : check_());
    if (p.api === 'cut-orders') return out_(orders_(String(p.from || ''), String(p.to || '')));
    if (p.api === 'cut-fixlog') return out_(fixLog_());
    if (p.api === 'shared-at') return out_(sharedAt_());
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
  return out_({ app: 'cut' });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ── อ่านชีต ───────────────────────────────────────────────────────────── */

function text_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function num_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(text_(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/** เลขออเดอร์เป็นได้ทั้งตัวเลขและข้อความ บางแถวมีวันที่ต่อท้ายหลังเครื่องหมาย · เวลาลงซ้ำ */
function ref_(v) { return text_(v).split(' · ')[0].trim().toUpperCase(); }

function code_(v) { return text_(v).toUpperCase(); }

/*
 * Utilities.formatDate ข้ามไปถามบริการของ Google ทุกครั้งที่เรียก ช้ากว่าโค้ดธรรมดาหลายร้อยเท่า
 * สี่แท็บรวมหลายแสนแถว เรียกทุกแถวจึงกินเวลาเป็นนาที และโตตามจำนวนแถว
 * ทั้งไฟล์มีวันที่ไม่กี่สิบวัน จึงจำคำตอบไว้ทีละช่วง 15 นาที เขตเวลาทุกเขตห่างจาก UTC เป็นจำนวนเท่าของ 15 นาที
 * เวลาในช่วง 15 นาทีเดียวกันจึงตกวันเดียวกันเสมอ ไม่ว่าไฟล์จะตั้งเขตเวลาไหน
 */
var DAY_SLOT_MS = 900000;
var DAY_SEEN = {};

function dayOf_(v, tz) {
  var t = v.getTime();
  if (isNaN(t)) return '';
  var id = tz + '|' + Math.floor(t / DAY_SLOT_MS);
  return DAY_SEEN[id] || (DAY_SEEN[id] = Utilities.formatDate(v, tz, 'yyyy-MM-dd'));
}

/** แท็บที่ดึงมาด้วยสูตรมีทั้งวันที่จริงและข้อความปนกัน ขึ้นกับไฟล์ต้นทาง จึงต้องอ่านได้ทั้งคู่ */
function plainDate_(v, tz) {
  if (v && typeof v.getTime === 'function') return dayOf_(v, tz);
  var s = text_(v).replace(/[\sT]+\d{1,2}:\d{2}.*$/, '');
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
  return y + '-' + ('0' + +m).slice(-2) + '-' + ('0' + +d).slice(-2);
}

/**
 * หาคอลัมน์จากหัวตาราง ถ้าหาไม่เจอให้ล้มดัง ๆ เพราะอ่านผิดคอลัมน์แล้วตัวเลขจะผิดโดยไม่มีอะไรเตือน
 * ยกเว้นคอลัมน์ใน opt ซึ่งไม่มีก็ได้ หาไม่เจอได้ -1 และอ่านเป็นค่าว่าง
 */
function tab_(ss, name, spec, opt) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแท็บ "' + name + '" ในไฟล์นี้');
  var lastCol = sh.getLastColumn();
  var head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var at = {};
  for (var key in spec) {
    at[key] = -1;
    for (var i = 0; i < head.length && at[key] < 0; i++) {
      if (spec[key].test(text_(head[i]))) at[key] = i;
    }
    if (at[key] < 0 && !(opt && opt[key])) {
      throw new Error('แท็บ "' + name + '" หาคอลัมน์ ' + key + ' ไม่เจอ ถ้าแท็บนี้ดึงด้วยสูตร ให้เปิดชีตดูว่ายังขึ้นข้อมูลอยู่ไหม');
    }
  }
  return { sh: sh, name: name, at: at, lastRow: sh.getLastRow(), lastCol: lastCol };
}

function eachRow_(tab, fn) {
  var width = 0;
  for (var key in tab.at) width = Math.max(width, tab.at[key] + 1);
  width = Math.min(width, tab.lastCol);
  var lap = lap_(tab);
  for (var from = 2; from <= tab.lastRow; from += READ_ROWS) {
    if (lap) inBudget_(lap, from - 2);
    var a = Date.now();
    var rows = tab.sh.getRange(from, 1, Math.min(READ_ROWS, tab.lastRow - from + 1), width).getValues();
    var b = Date.now();
    for (var i = 0; i < rows.length; i++) fn(rows[i], tab.at);
    if (lap) { lap.read += b - a; lap.work += Date.now() - b; }
  }
  if (CLOCK) CLOCK.last = Date.now();
}

/* ── จับเวลา ───────────────────────────────────────────────────────────── */

/*
 * Apps Script ตัดจบที่ 6 นาทีแบบเงียบ ๆ ไม่มีข้อความ ไม่มีผล และไม่รู้ว่าช้าที่แท็บไหน
 * การตรวจจึงจับเวลาเองทีละแท็บ: open = เปิดแท็บกับอ่านหัวตาราง (แท็บที่ดึงด้วยสูตรรอสูตรตรงนี้), read = อ่านค่า, work = คิด
 * เกิน BUDGET_MS หยุดเองพร้อมข้อความว่าเวลาหมดไปกับอะไร เวลาที่เหลือต้องพอให้จัดประเภทกับเก็บผลกลางหลังอ่านครบ
 */
var BUDGET_MS = 290000;
var CLOCK = null;   // มีค่าเฉพาะระหว่าง check_ ทางอื่นที่อ่านแท็บ (cut-orders, report-rows) ไม่จับเวลา
var TAB_SHORT = {};
TAB_SHORT[TAB_JST] = 'JST';
TAB_SHORT[TAB_CRM] = 'CRM';
TAB_SHORT[TAB_TF] = 'โอนย้าย';
TAB_SHORT[TAB_TX] = 'Transaction';
TAB_SHORT[TAB_TR] = 'TRcloud';

function lap_(tab) {
  if (!CLOCK) return null;
  var lap = { tab: TAB_SHORT[tab.name] || tab.name, rows: Math.max(0, tab.lastRow - 1), open: Date.now() - CLOCK.last, read: 0, work: 0 };
  CLOCK.tabs.push(lap);
  return lap;
}

function sec_(ms) { return Math.round(ms / 1000); }

/** "JST อ่าน 40 คิด 12 วิ, CRM อ่าน 6 คิด 2 วิ" เวลาเปิดแท็บรวมอยู่ในอ่าน */
function tookText_(tabs) {
  return tabs.map(function (t) {
    return t.tab + ' อ่าน ' + sec_(t.open + t.read) + ' คิด ' + sec_(t.work) + ' วิ';
  }).join(', ');
}

function inBudget_(lap, done) {
  if (Date.now() - CLOCK.at < BUDGET_MS) return;
  throw new Error('ข้อมูลเยอะเกิน ตรวจไม่จบใน ' + Math.round(BUDGET_MS / 60000) + ' นาที หยุดที่แท็บ ' + lap.tab
    + ' แถว ' + done.toLocaleString('en-US') + ' จาก ' + lap.rows.toLocaleString('en-US')
    + ' (' + tookText_(CLOCK.tabs) + ') ให้ย้ายข้อมูลของเดือนที่ปิดแล้วออกจากไฟล์นี้ แล้วตรวจใหม่');
}

/* ── รวมยอดราย ออเดอร์ + SKU ───────────────────────────────────────────── */

function newWork_() {
  return {
    keys: {}, orders: {}, transfer: {}, carriers: {}, names: {}, crmNames: {},
    period: { from: '', to: '' },
    hasTf: false,
    tabs: { tx: span_(), tr: span_(), jst: span_(), crm: span_(), tf: span_() },
    totals: { report: 0, jst: 0, crm: 0, tf: 0, tx: 0, txJst: 0, txCrm: 0, txTransfer: 0, tr: 0, trOut: 0, trIn: 0 },
    outsideTx: { rows: 0, qty: 0, from: '', to: '', refs: {} },
    outsideTr: { rows: 0, qty: 0, from: '', to: '' },
    adjust: { rows: 0, inq: 0, outq: 0 },
    daily: { x: newSide_(), t: newSide_(), r: newSide_() },
    trUse: { dept: {}, wh: {} },
  };
}

function newSide_() { return { days: {}, skipped: { rows: 0, qty: 0 } }; }

function span_() { return { rows: 0, from: '', to: '', lastRow: 0 }; }

function stretch_(s, d) {
  if (!d) return;
  if (!s.from || d < s.from) s.from = d;
  if (!s.to || d > s.to) s.to = d;
}

/**
 * xd, td คือ วันที่ → ยอดที่ตัดวันนั้น ใช้ทั้งบอกวันที่ตัดและแตกยอดรายวันลงถึงออเดอร์
 * rd คือ วันที่ → ยอดใน Report วันนั้น ออเดอร์เดียวกันส่งได้หลายรอบ แต่ละรอบลงวันของตัวเองใน Report
 */
function key_(w, ref, sku) {
  var id = ref + '|' + sku;
  return w.keys[id] || (w.keys[id] = {
    ref: ref, sku: sku, r: 0, x: 0, out: 0, inq: 0, t: 0, ship: '', back: false, xd: {}, td: {}, rd: {}, note: '', sup: '', src: '',
    lot: '', dept: '', wh: '',
  });
}

/**
 * Report คือยอดที่ควรถูกตัด ต้องอ่านก่อน เพราะแถวตัดต้องรู้ว่าออเดอร์นี้อยู่ใน Report หรือเปล่า
 * รายงานโอนย้ายใช้เลขใบโอนย้ายเป็นเลขออเดอร์ ตรงกับเลขภายในของแถวโอนย้ายในแท็บตัด และช่อง sup คือคลังปลายทาง
 * JST ที่สถานะจัดส่งแล้วแต่ขนส่งยกเลิก (back) คือของออกจากคลังไปแล้ว ลูกค้ายกเลิก ของตีกลับเข้าคลัง
 * ต้องตัดตามวันที่ออกเหมือนออเดอร์ปกติ ของที่กลับเข้ามาเป็นอีกเรื่องหนึ่ง ไม่ได้หักจากยอดนี้
 */
function addReport_(w, sys, row, at, tz) {
  var ref = ref_(row[at.ref]), sku = code_(row[at.sku]), q = num_(row[at.qty]);
  if (!ref && !sku && !q) return;
  var d = plainDate_(row[at.date], tz), sup = text_(row[at.sup]), ship = sys === 'JST' ? text_(row[at.ship]) : '';
  var back = ship === CANCELLED && at.status >= 0 && text_(row[at.status]) === SHIPPED;
  var span = w.tabs[SYS_KEY[sys]];
  span.rows++;
  stretch_(span, d);
  stretch_(w.period, d);
  w.totals.report += q;
  w.totals[SYS_KEY[sys]] += q;
  if (sup) w.carriers[sup] = 1;
  if (sys !== 'CRM' && !w.names[sku] && text_(row[at.name])) w.names[sku] = text_(row[at.name]);
  if (sys === 'CRM' && !w.crmNames[sku]) w.crmNames[sku] = (text_(row[at.brand]) + ' ' + text_(row[at.size])).trim();

  var o = w.orders[ref] || (w.orders[ref] = { sys: sys, date: '', sup: '', ship: '' });
  if (d > o.date) o.date = d;
  if (!o.sup) o.sup = sup;
  if (!o.ship) o.ship = ship;
  var k = key_(w, ref, sku);
  k.r += q;
  if (d) k.rd[d] = (k.rd[d] || 0) + q;
  if (!k.ship) k.ship = ship;
  if (back) k.back = true;
}

function addCut_(w, row, at, tz) {
  var ref = ref_(row[at.ref]), sku = code_(row[at.sku]), q = num_(row[at.qty]);
  if (!ref && !sku && !q) return;
  var d = plainDate_(row[at.date], tz), src = text_(row[at.src]), sup = text_(row[at.sup]);
  w.tabs.tx.rows++;
  stretch_(w.tabs.tx, d);
  w.totals.tx += q;
  if (src === 'JST') w.totals.txJst += q;
  else if (src === 'CRM') w.totals.txCrm += q;
  else if (src === TRANSFER) w.totals.txTransfer += q;
  if (sup) w.carriers[sup] = 1;
  if (!w.names[sku]) w.names[sku] = (text_(row[at.brand]) + ' ' + text_(row[at.size])).trim();
  if (src === TRANSFER) w.transfer[ref] = 1;
  tally_(w.daily.x, d, sku, q);
  /* ไม่มีรายงานโอนย้าย ยอดควรออกของงานนี้จึงใช้ยอดที่ตัดจริง */
  if (src === TRANSFER && !w.hasTf) tally_(w.daily.r, d, sku, q);

  if (outside_(w, ref, d)) {
    var o = w.outsideTx;
    o.rows++;
    o.qty += q;
    o.refs[ref] = 1;
    stretch_(o, d);
    return;
  }
  var k = key_(w, ref, sku);
  k.x += q;
  if (d) k.xd[d] = (k.xd[d] || 0) + q;
  if (!k.sup) k.sup = sup;
  if (!k.src) k.src = src;
}

function addTrcloud_(w, row, at, tz) {
  var ref = ref_(row[at.ref]), sku = code_(row[at.sku]), inq = num_(row[at.inq]), outq = num_(row[at.outq]);
  if (!ref && !sku && !inq && !outq) return;
  var d = plainDate_(row[at.date], tz);
  w.tabs.tr.rows++;
  stretch_(w.tabs.tr, d);
  w.totals.trOut += outq;
  w.totals.trIn += inq;
  w.totals.tr += outq - inq;
  if (text_(row[at.dept]) === ADJUST_DEPT) {
    w.adjust.rows++;
    w.adjust.inq += inq;
    w.adjust.outq += outq;
    return;
  }
  tally_(w.daily.t, d, sku, outq - inq);
  /* แผนกกับคลังที่ใช้บ่อยสุดตอนตัดออก ใช้เติมแถวแก้ของออเดอร์ที่ TRcloud ยังไม่มีสักแถว */
  var dept = text_(row[at.dept]), wh = text_(row[at.wh]);
  if (outq > 0) {
    if (dept) w.trUse.dept[dept] = (w.trUse.dept[dept] || 0) + 1;
    if (wh) w.trUse.wh[wh] = (w.trUse.wh[wh] || 0) + 1;
  }
  if (outside_(w, ref, d)) {
    var o = w.outsideTr;
    o.rows++;
    o.qty += outq - inq;
    stretch_(o, d);
    return;
  }
  var k = key_(w, ref, sku);
  k.out += outq;
  k.inq += inq;
  if (d) k.td[d] = (k.td[d] || 0) + outq - inq;
  /* ช่องนี้เก็บชื่อขนส่ง หรือเหตุผลที่พิมพ์เองตอนแก้ยอด อันที่ไม่ใช่ชื่อขนส่งคือเหตุผล */
  var lot = text_(row[at.lot]);
  if (lot && !k.note && !w.carriers[lot]) k.note = lot;
  if (lot && !k.lot && w.carriers[lot]) k.lot = lot;
  if (dept && !k.dept) k.dept = dept;
  if (wh && !k.wh) k.wh = wh;
}

/** แถวนอกช่วงของ Report ที่ออเดอร์ไม่อยู่ใน Report เช่นวันที่ 1 ของเดือนถัดไป ยังเทียบไม่ได้ ไม่ใช่ตัดผิด */
function outside_(w, ref, d) {
  return !w.orders[ref] && !!d && (d < w.period.from || d > w.period.to);
}

function nonStock_(sku) { return !GOOD_SKU.test(sku) || NON_STOCK.test(sku); }

/* ── ยอดรายวัน ─────────────────────────────────────────────────────────── */

/**
 * ยอดรายวันต่อ SKU ไว้เทียบกับแถวขายในสมุด Transaction นับก่อนตัดสินว่าเป็นออเดอร์ของ Report ไหม
 * เพราะแถวขายในสมุดรวมงานโอนย้ายกับออเดอร์ที่ยังไม่อยู่ใน Report ด้วย
 */
function tally_(side, d, sku, q) {
  if (!q) return;
  if (!d || !sku) {
    side.skipped.rows++;
    side.skipped.qty += q;
    return;
  }
  var day = side.days[d] || (side.days[d] = {});
  day[sku] = (day[sku] || 0) + q;
}

/**
 * ยอดที่ควรออกของรายการนี้ตาม Report ลงวันที่ออกจากคลังของแต่ละแถว นับได้หลังจัดถังแล้วเท่านั้น
 * ออเดอร์ที่ส่งสองรอบจึงควรออกทั้งสองวัน ไม่ใช่รวมไปวันสุดท้าย
 * รายการที่ไม่ได้ตัดเพราะขนส่งยกเลิกก่อนของออก สถานะว่าง หรือไม่ใช่ของในคลัง ไม่ควรออก
 */
function addShould_(w, k) {
  if (!w.orders[k.ref]) return;
  var left = should_(k);
  if (!left) return;
  Object.keys(k.rd).forEach(function (d) {
    tally_(w.daily.r, d, k.sku, k.rd[d]);
    left -= k.rd[d];
  });
  /* แถวใน Report ที่ไม่มีวันที่ ลงวันไหนไม่ได้ นับเป็นยอดที่ข้าม */
  tally_(w.daily.r, '', k.sku, left);
}

/** ได้แค่ศูนย์ หรือยอดเต็มใน Report (k.r) เพราะ target_ ไม่มีกรณีครึ่งๆ ยอดรายวันจึงใช้ k.rd ได้ตรงๆ */
function should_(k) {
  return k.bucket === 'nonstock' || k.bucket === 'cancelOk' || k.bucket === 'blankOk' ? 0 : target_(k, k.bucket);
}

/** ยอดที่ควรออกของรายการนี้ในวันเดียว */
function shouldOn_(k, d) {
  return should_(k) ? k.rd[d] || 0 : 0;
}

/** วันอื่นนอกจากวันนี้ที่รายการนี้ถูกตัด ยอดตัดกับคืนที่หักกันจนเป็นศูนย์ไม่นับ */
function otherDays_(byDay, d) {
  return Object.keys(byDay).filter(function (x) { return x !== d && byDay[x]; }).sort();
}

/**
 * ออเดอร์ในช่อง วัน + SKU ที่ Upload, TRcloud และยอดควรออกไม่เท่ากัน หน้าเว็บกดดูได้ว่าต่างเพราะออเดอร์ไหน
 * ช่องที่ทุกแหล่งเท่ากันไม่ส่ง ในช่องที่ส่ง ออเดอร์ที่ยอดวันนั้นเท่ากันส่งแค่จำนวน
 * ออเดอร์ที่ยอดทั้งเดือนตรงแล้วแต่ลงคนละวัน รวมเป็นกลุ่มตามวันที่ เพราะวันที่ลงคนละวันทั้งวันมีเป็นร้อยต่อ SKU
 * ที่เหลือคือเรื่องที่ต้องแก้ ส่งทีละออเดอร์
 *   [ลำดับวัน, ลำดับ SKU, ออเดอร์ที่ตรง, ชิ้นที่ตรง, ออเดอร์ที่ไม่ได้ส่งเพราะเกินเพดาน,
 *    [[เลขออเดอร์, ระบบ, x, t, r, ถัง, วันอื่นที่ลงใน Report, วันอื่นที่ Upload ตัด, วันอื่นที่ TRcloud ตัด], ...],
 *    [[วันอื่นที่ลงใน Report, วันอื่นที่ Upload ตัด, วันอื่นที่ TRcloud ตัด, จำนวนออเดอร์, x, t, r, ตัวอย่างเลขออเดอร์], ...]]
 */
function detailOf_(w, list, dayNo, skuNo) {
  var at = {};
  list.forEach(function (k) {
    var days = {};
    Object.keys(k.xd).forEach(function (d) { days[d] = 1; });
    Object.keys(k.td).forEach(function (d) { days[d] = 1; });
    if (w.orders[k.ref]) Object.keys(k.rd).forEach(function (d) { days[d] = 1; });
    Object.keys(days).forEach(function (d) {
      var id = d + '|' + k.sku;
      (at[id] || (at[id] = { d: d, sku: k.sku, keys: [] })).keys.push(k);
    });
  });
  function val(side, d, sku) { return (side.days[d] && side.days[d][sku]) || 0; }
  function size(e) { return Math.max(Math.abs(e[2] - e[4]), Math.abs(e[3] - e[4]), Math.abs(e[2] - e[3])); }

  var out = [];
  Object.keys(at).sort().forEach(function (id) {
    var c = at[id], d = c.d;
    var x = val(w.daily.x, d, c.sku), t = val(w.daily.t, d, c.sku), r = val(w.daily.r, d, c.sku);
    if (x === t && t === r) return;
    var ok = 0, okQty = 0, bad = [], moved = {};
    c.keys.forEach(function (k) {
      var o = w.orders[k.ref];
      var kx = k.xd[d] || 0, kt = k.td[d] || 0;
      /* ไม่มีรายงานโอนย้าย ยอดควรออกของงานโอนย้ายคือยอดที่ตัด เหมือนตอนรวมยอดรายวัน */
      var kr = o ? shouldOn_(k, d) : (w.transfer[k.ref] && !w.hasTf ? kx : 0);
      if (kx === kt && kt === kr) {
        if (kx) { ok++; okQty += kx; }
        return;
      }
      var od = o ? otherDays_(k.rd, d) : [], xo = otherDays_(k.xd, d), to = otherDays_(k.td, d);
      if (KINDS.indexOf(k.bucket) < 0 && k.bucket !== 'gap') {
        var id = od.join(',') + '|' + xo.join(',') + '|' + to.join(',');
        var g = moved[id] || (moved[id] = [od, xo, to, 0, 0, 0, 0, []]);
        g[3]++; g[4] += kx; g[5] += kt; g[6] += kr;
        if (g[7].length < 3) g[7].push(k.ref);
        return;
      }
      bad.push([k.ref, o ? o.sys : k.src, kx, kt, kr, k.bucket, od, xo, to]);
    });
    bad.sort(function (a, b) { return size(b) - size(a) || (a[0] < b[0] ? -1 : 1); });
    var groups = Object.keys(moved).sort().map(function (id) { return moved[id]; });
    out.push([dayNo[d], skuNo(c.sku), ok, okQty, Math.max(0, bad.length - CELL_MAX), bad.slice(0, CELL_MAX), groups]);
  });
  return out;
}

/** ส่งแบบย่อ วันที่กับ SKU อยู่ในตารางเดียวแล้วอ้างด้วยเลขลำดับ ทั้งเดือนมีหลายพันช่อง */
function dailyOf_(w, list) {
  var seen = {}, skus = [], dayIdx = {};
  [w.daily.x, w.daily.t, w.daily.r].forEach(function (side) {
    Object.keys(side.days).forEach(function (d) { dayIdx[d] = 1; });
  });
  var days = Object.keys(dayIdx).sort();
  days.forEach(function (d, i) { dayIdx[d] = i; });
  function skuNo(sku) {
    if (seen[sku] === undefined) {
      seen[sku] = skus.length;
      skus.push([sku, w.names[sku] || w.crmNames[sku] || '']);
    }
    return seen[sku];
  }
  function cells(side) {
    var out = [];
    Object.keys(side.days).forEach(function (d) {
      Object.keys(side.days[d]).forEach(function (sku) {
        if (side.days[d][sku]) out.push([dayIdx[d], skuNo(sku), side.days[d][sku]]);
      });
    });
    return out;
  }
  var x = cells(w.daily.x), t = cells(w.daily.t), r = cells(w.daily.r);
  return {
    days: days, skus: skus, x: x, t: t, r: r,
    detail: detailOf_(w, list, dayIdx, skuNo),
    skippedX: w.daily.x.skipped, skippedT: w.daily.t.skipped, skippedR: w.daily.r.skipped,
  };
}

/* ── จัดประเภท ─────────────────────────────────────────────────────────── */

/** ทุกแถวลงได้ถังเดียว ยอดกระทบท้ายรายงานจึงรวมกันแล้วต้องเท่ายอดจริงพอดี ถ้าไม่เท่าคือโค้ดผิด */
function bucket_(k, w) {
  var o = w.orders[k.ref];
  if (!o) {
    /* มีรายงานโอนย้ายแล้ว ใบโอนย้ายที่ไม่อยู่ในรายงานคือตัดแต่ไม่มีใน Report เหมือนออเดอร์ */
    if (w.transfer[k.ref] && !w.hasTf) return k.x === k.t ? 'transfer' : 'transferDiff';
    return k.x || k.t ? 'ghost' : 'reversed';
  }
  if (!k.r) return k.x || k.t ? 'wrong' : 'reversed';
  var cancelled = k.ship === CANCELLED && !k.back;
  var blank = o.sys === 'JST' && !k.ship;
  if (!k.x && !k.t) {
    if (nonStock_(k.sku)) return 'nonstock';
    if (cancelled) return 'cancelOk';
    return blank ? 'blankOk' : 'under';
  }
  if (cancelled) return 'cancel';
  if (k.x > k.r || k.t > k.r) return 'over';
  if (k.x < k.r || k.t < k.r) return 'under';
  return blank ? 'blankCut' : 'ok';
}

/** ยอดที่ถูกต้องของรายการนี้ — ถ้าสินค้าไม่ควรออกจากคลัง ยอดที่ถูกคือศูนย์ ไม่ว่า Report จะเขียนไว้เท่าไร */
function target_(k, kind) {
  return kind === 'cancel' || kind === 'blankCut' || kind === 'wrong' || kind === 'ghost' ? 0 : k.r;
}

function side_(target, x, t) {
  var xBad = x !== target, tBad = t !== target;
  return xBad && tBad ? 'both' : xBad ? 'tx' : tBad ? 'tr' : '';
}

/**
 * วันที่ทั้งวันไม่ถูกตัดเลยในฝั่งหนึ่ง คือลืมลงทั้งรอบ ไม่ใช่ตัดพลาดทีละรายการ
 * รวมเป็นก้อนเดียวให้แก้ทีเดียว ไม่งั้นรายการจริงจะจมอยู่ใต้แถวหลายร้อยแถวของวันนั้น
 */
function markGaps_(w, list) {
  var days = {};
  list.forEach(function (k) {
    var o = w.orders[k.ref];
    if (!o || k.bucket === 'nonstock' || k.bucket === 'cancelOk' || k.bucket === 'blankOk' || k.bucket === 'reversed') return;
    var id = o.date + '|' + o.sys;
    var d = days[id] || (days[id] = { refs: {}, x: 0, t: 0 });
    d.refs[k.ref] = 1;
    d.x += Math.abs(k.x);
    d.t += Math.abs(k.t);
  });

  var gaps = {};
  list.forEach(function (k) {
    if (k.bucket !== 'under') return;
    var o = w.orders[k.ref], day = days[o.date + '|' + o.sys];
    if (Object.keys(day.refs).length < GAP_MIN_ORDERS) return;
    var side = !day.x && !day.t ? 'both' : !day.x ? 'tx' : !day.t ? 'tr' : '';
    if (!side || side_(k.r, k.x, k.t) !== side) return;
    k.bucket = 'gap';
    var id = o.date + '|' + o.sys + '|' + side;
    var g = gaps[id] || (gaps[id] = { date: o.date, sys: o.sys, side: side, refs: {}, lines: 0, qty: 0, carriers: {} });
    g.refs[k.ref] = 1;
    g.lines++;
    g.qty += k.r;
    g.carriers[o.sup || '-'] = (g.carriers[o.sup || '-'] || 0) + k.r;
  });

  return Object.keys(gaps).sort().map(function (id) {
    var g = gaps[id], refs = Object.keys(g.refs).sort();
    return {
      date: g.date, sys: g.sys, side: g.side, orders: refs.length, lines: g.lines, qty: g.qty,
      carriers: g.carriers, refs: refs.slice(0, LIST_MAX),
    };
  });
}

function rowOf_(k, kind, w) {
  var o = w.orders[k.ref];
  var xd = Object.keys(k.xd).sort(), td = Object.keys(k.td).sort();
  var goal = target_(k, kind);
  return {
    k: kind, ref: k.ref, sku: k.sku, sys: o ? o.sys : k.src,
    date: (o && o.date) || xd[0] || td[0] || '',
    sup: (o && o.sup) || k.sup,
    ship: k.ship || (o && o.ship) || '', back: k.back,
    r: k.r, x: k.x, t: k.t, goal: goal, side: side_(goal, k.x, k.t),
    xd: xd, td: td, inq: k.inq, note: k.note,
  };
}

/** ออเดอร์ที่ขาดทั้งใบในฝั่งเดียวและมีหลาย SKU เหลือแถวเดียว เพราะการแก้คือลงใหม่ทั้งใบอยู่แล้ว */
function mergeOrders_(rows, w) {
  var lines = {};
  Object.keys(w.keys).forEach(function (id) {
    var k = w.keys[id];
    if (k.r && !nonStock_(k.sku)) lines[k.ref] = (lines[k.ref] || 0) + 1;
  });
  var byRef = {}, out = [];
  rows.forEach(function (r) { (byRef[r.ref] = byRef[r.ref] || []).push(r); });
  Object.keys(byRef).forEach(function (ref) {
    var list = byRef[ref], first = list[0];
    var whole = list.length >= ORDER_MERGE && list.length === lines[ref] && list.every(function (r) {
      return r.side === first.side && first.side !== 'both' && (first.side === 'tx' ? !r.x : !r.t);
    });
    if (!whole) { out.push.apply(out, list); return; }
    var sum = { k: first.k, ref: ref, sku: '', sys: first.sys, date: first.date, sup: first.sup, ship: first.ship, back: first.back,
      r: 0, x: 0, t: 0, goal: 0, side: first.side, xd: [], td: [], inq: 0, note: first.note, lines: list.length };
    var xd = {}, td = {};
    list.forEach(function (r) {
      sum.r += r.r; sum.x += r.x; sum.t += r.t; sum.goal += r.goal; sum.inq += r.inq;
      r.xd.forEach(function (d) { xd[d] = 1; });
      r.td.forEach(function (d) { td[d] = 1; });
    });
    sum.xd = Object.keys(xd).sort();
    sum.td = Object.keys(td).sort();
    out.push(sum);
  });
  return out;
}

/** จำนวนชิ้นที่ผิดของแถวนี้ ใช้เรียงให้เรื่องใหญ่ขึ้นก่อน */
function gapOf_(row) { return Math.max(Math.abs(row.x - row.goal), Math.abs(row.t - row.goal)); }

function compare_(w) {
  var list = Object.keys(w.keys).map(function (id) { return w.keys[id]; });
  list.forEach(function (k) {
    k.t = k.out - k.inq;
    k.bucket = bucket_(k, w);
  });
  var gaps = markGaps_(w, list);
  list.forEach(function (k) { addShould_(w, k); });

  var buckets = {};
  var byKind = {};
  list.forEach(function (k) {
    var b = buckets[k.bucket] || (buckets[k.bucket] = { lines: 0, qty: 0, dx: 0, dt: 0, refs: {} });
    b.lines++;
    b.qty += k.r || k.x || k.t;
    b.dx += k.x - k.r;
    b.dt += k.t - k.r;
    b.refs[k.ref] = 1;
    if (KINDS.indexOf(k.bucket) >= 0) (byKind[k.bucket] = byKind[k.bucket] || []).push(rowOf_(k, k.bucket, w));
  });

  var kinds = {}, rows = [], names = {};
  KINDS.forEach(function (kind) {
    var sum = buckets[kind] || { lines: 0, dx: 0, dt: 0, refs: {} };
    var got = byKind[kind] || [];
    if (kind === 'under') got = mergeOrders_(got, w);
    got.sort(function (a, b) {
      var size = gapOf_(b) - gapOf_(a);
      return size || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.sku < b.sku ? -1 : 1);
    });
    var shown = got.slice(0, ROWS_MAX);
    kinds[kind] = {
      lines: sum.lines, orders: Object.keys(sum.refs).length, dx: sum.dx, dt: sum.dt,
      qty: got.reduce(function (s, r) { return s + gapOf_(r); }, 0),
      shown: shown.length, total: got.length,
    };
    shown.forEach(function (r) {
      rows.push(r);
      if (r.sku) names[r.sku] = w.names[r.sku] || w.crmNames[r.sku] || '';
    });
  });

  return {
    app: 'cut',
    at: new Date().toISOString(),
    period: w.period,
    tabs: w.tabs,
    totals: w.totals,
    kinds: kinds,
    rows: rows,
    gaps: gaps,
    names: names,
    recon: recon_(w, buckets),
    info: info_(w, list, buckets),
    warnings: warnings_(w),
    daily: dailyOf_(w, list),
    trc: trFix_(w, list),
  };
}

/* ── TRcloud เทียบ Report รายวัน ───────────────────────────────────────── */

var TRC_MAX = 5000;          // แถวต่อเดือน เกินนี้ส่งแค่วันแรกๆ แล้วบอกจำนวนจริง
var TRC_KEEP = ['wrong', 'ghost', 'cancel', 'blankCut'];

/** ค่าที่พบบ่อยสุด */
function most_(count) {
  var best = '';
  Object.keys(count).forEach(function (v) { if (!best || count[v] > count[best]) best = v; });
  return best;
}

/**
 * ทุกวันที่ยอดตัดของ TRcloud ไม่เท่ากับยอดที่ควรออกตาม Report ทีละ ออเดอร์ + SKU + วัน
 * หน้าเว็บเอาไปทำไฟล์แก้ยอดลง TRcloud ได้เลย จึงต้องลงถึงวันและออเดอร์ ไม่ใช่ยอดรวมทั้งเดือน
 * ยอดควรออกใช้กติกาเดียวกับยอดรายวัน (addShould_) ไม่มีรายงานโอนย้าย งานโอนย้ายเทียบกับยอดที่ตัดใน Upload
 * ถังของ TRcloud คิดจากยอด TRcloud อย่างเดียว ถังรวมของรายการดู Upload ด้วย จึงอาจคนละอัน
 *   moved  ยอดทั้งเดือนของ TRcloud ตรงแล้ว แต่ลงคนละวันกับ Report
 *   under / gap  TRcloud ตัดขาด (gap คือทั้งวันยังไม่ลง)   over  ตัดเกิน
 *   wrong, ghost, cancel, blankCut, transferDiff  ตามถังของรายการ
 *   lines: [[วันที่, ออเดอร์, SKU, ระบบ, ขนส่ง, Report, TRcloud, ถัง, วันอื่นที่ TRcloud ตัด, วันอื่นใน Report, แผนก, คลัง], ...]
 *   แผนกกับคลังว่างคือ TRcloud ยังไม่มีแถวของรายการนี้ ให้ใช้ dept / wh ที่ส่งไปด้วย
 */
function trFix_(w, list) {
  var lines = [];
  list.forEach(function (k) {
    var o = w.orders[k.ref];
    var noTf = !o && w.transfer[k.ref] && !w.hasTf;
    var goal = o ? should_(k) : noTf ? k.x : 0;
    var days = {};
    Object.keys(k.td).forEach(function (d) { days[d] = 1; });
    if (o && goal) Object.keys(k.rd).forEach(function (d) { days[d] = 1; });
    if (noTf) Object.keys(k.xd).forEach(function (d) { days[d] = 1; });
    var kind = k.bucket === 'transferDiff' ? 'transferDiff'
      : k.t === goal ? 'moved'
      : k.t < goal ? (k.bucket === 'gap' ? 'gap' : 'under')
      : TRC_KEEP.indexOf(k.bucket) >= 0 ? k.bucket : 'over';
    Object.keys(days).sort().forEach(function (d) {
      var t = k.td[d] || 0;
      var r = o ? shouldOn_(k, d) : noTf ? k.xd[d] || 0 : 0;
      if (t === r) return;
      lines.push([d, k.ref, k.sku, o ? o.sys : k.src, k.lot || (o && o.sup) || k.sup, r, t, kind,
        otherDays_(k.td, d), o && goal ? otherDays_(k.rd, d) : [], k.dept, k.wh]);
    });
  });
  lines.sort(function (a, b) {
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : 1;
  });
  return { lines: lines.slice(0, TRC_MAX), total: lines.length, dept: most_(w.trUse.dept), wh: most_(w.trUse.wh) };
}

/** ยอดที่ต่างจาก Report แตกตามถัง ทั้งหมดบวกกับยอด Report แล้วต้องได้ยอดรวมที่นับตอนอ่านแถว */
function recon_(w, buckets) {
  var parts = [];
  Object.keys(buckets).forEach(function (id) {
    var b = buckets[id];
    if (b.dx || b.dt) parts.push({ id: id, lines: b.lines, dx: b.dx, dt: b.dt });
  });
  if (w.outsideTx.qty || w.outsideTr.qty) {
    parts.push({ id: 'outside', lines: w.outsideTx.rows + w.outsideTr.rows, dx: w.outsideTx.qty, dt: w.outsideTr.qty });
  }
  var adj = w.adjust.outq - w.adjust.inq;
  if (adj) parts.push({ id: 'adjust', lines: w.adjust.rows, dx: 0, dt: adj });
  var dx = parts.reduce(function (s, p) { return s + p.dx; }, 0);
  var dt = parts.reduce(function (s, p) { return s + p.dt; }, 0);
  return {
    parts: parts, report: w.totals.report, tx: w.totals.tx, tr: w.totals.tr, dx: dx, dt: dt,
    okTx: w.totals.report + dx === w.totals.tx,
    okTr: w.totals.report + dt === w.totals.tr,
  };
}

function info_(w, list, buckets) {
  var str = { lines: 0, qty: 0 }, bad = { lines: 0, qty: 0 }, back = { lines: 0, qty: 0 }, rev = {};
  list.forEach(function (k) {
    if (k.back) { back.lines++; back.qty += k.r; }
    if (k.bucket === 'nonstock') {
      var part = GOOD_SKU.test(k.sku) ? str : bad;
      part.lines++;
      part.qty += k.r;
    }
    if (k.bucket === 'reversed') rev[k.ref] = 1;
  });
  var count = function (id) {
    var b = buckets[id];
    return b ? { lines: b.lines, qty: b.qty } : { lines: 0, qty: 0 };
  };
  var revRefs = Object.keys(rev).sort();
  var transfer = buckets.transfer || buckets.transferDiff;
  return {
    matched: count('ok'),
    nonStock: str,
    badSku: bad,
    blankOk: count('blankOk'),
    cancelOk: count('cancelOk'),
    shippedBack: back,
    transfer: { refs: Object.keys(w.transfer).length, lines: transfer ? transfer.lines : 0, qty: w.totals.txTransfer },
    outsideTx: { rows: w.outsideTx.rows, qty: w.outsideTx.qty, from: w.outsideTx.from, to: w.outsideTx.to, orders: Object.keys(w.outsideTx.refs).length },
    outsideTr: { rows: w.outsideTr.rows, qty: w.outsideTr.qty, from: w.outsideTr.from, to: w.outsideTr.to },
    adjust: w.adjust,
    reversedRefs: revRefs.slice(0, LIST_MAX),
    reversedCount: revRefs.length,
    trIn: w.totals.trIn,
  };
}

function warnings_(w) {
  var out = [], tx = w.tabs.tx, tr = w.tabs.tr, jst = w.tabs.jst, crm = w.tabs.crm, tf = w.tabs.tf;
  if (tx.lastRow >= CHUNK_ROWS && tx.lastRow % CHUNK_ROWS === 0) {
    out.push('แท็บ Transaction เต็มพอดีที่แถว ' + tx.lastRow.toLocaleString('en-US') + ' สูตรดึงข้อมูลน่าจะตัดแถวหลังจากนี้ทิ้ง ให้ขยายช่วงในสูตรของแท็บนี้ก่อนตรวจรอบถัดไป');
  }
  if (tx.to && tx.to < w.period.to) {
    out.push('แท็บ Transaction มีข้อมูลถึงวันที่ ' + tx.to + ' แต่ Report ถึง ' + w.period.to + ' ออเดอร์หลังจากนั้นจะขึ้นเป็นยังไม่ตัด');
  }
  if (tr.to && tr.to < w.period.to) {
    out.push('แท็บ TRcloud มีข้อมูลถึงวันที่ ' + tr.to + ' แต่ Report ถึง ' + w.period.to + ' ออเดอร์หลังจากนั้นจะขึ้นเป็นยังไม่ตัด');
  }
  if (jst.from && crm.from && (jst.from.slice(0, 7) !== crm.from.slice(0, 7) || jst.to.slice(0, 7) !== crm.to.slice(0, 7))) {
    out.push('Report ของ JST (' + jst.from + ' ถึง ' + jst.to + ') กับ CRM (' + crm.from + ' ถึง ' + crm.to + ') เป็นคนละเดือน');
  }
  if (jst.from && tf.from && (jst.from.slice(0, 7) !== tf.from.slice(0, 7) || jst.to.slice(0, 7) !== tf.to.slice(0, 7))) {
    out.push('Report โอนย้าย (' + tf.from + ' ถึง ' + tf.to + ') กับ JST (' + jst.from + ' ถึง ' + jst.to + ') เป็นคนละเดือน');
  }
  return out;
}

/* ── รายออเดอร์ของแต่ละวัน ─────────────────────────────────────────────── */

function txTab_(ss) {
  var tx = tab_(ss, TAB_TX, {
    date: /^Date$/i, sup: /^Sup$/i, ref: /^เลขภายใน/, sku: /^SKU$/i, brand: /^แบรนด์/, size: /^ขนาด/, qty: /^SUM of/i,
    online: /^(หมายเลข|เลข)คำสั่งซื้อออนไลน์/,
  }, { online: 1 });
  tx.at.src = tx.at.qty + 1;   // คอลัมน์ถัดจากจำนวนไม่มีหัวตาราง แต่บอกว่าแถวนี้มาจากระบบไหน
  return tx;
}

/**
 * สมุด Transaction ลงขายรวมต่อ SKU ต่อวัน ไม่มีเลขออเดอร์ หน้าเว็บจึงต้องรู้ว่าวันนั้นออเดอร์ไหนตัด SKU อะไรเท่าไร
 * อ่านแค่แท็บ Transaction ไม่ต้องรอเทียบทั้งสี่แท็บ ส่งแบบย่อ วัน SKU และที่มาเป็นเลขลำดับ เดือนหนึ่งมีเป็นแสนแถว
 *   line = [ลำดับวัน, เลขออเดอร์, ลำดับ SKU, จำนวน, ลำดับที่มา]  เรียงตามแถวแรกที่เจอในแท็บ
 * แถวของ วัน + ออเดอร์ + SKU เดียวกันรวมกันก่อนส่ง span คือช่วงวันที่ของทั้งแท็บ หน้าเว็บจะได้บอกว่าไฟล์นี้มีถึงวันไหน
 * ไฟล์ส่งออกรายออเดอร์ต้องมีเลขคำสั่งซื้อออนไลน์กับบริษัทขนส่ง (ผู้ใช้ขอ 2026-11-06) เอาจากแท็บเดียวกัน คอลัมน์ Sup คือขนส่ง
 *   refs = { เลขออเดอร์: [เลขคำสั่งซื้อออนไลน์, ลำดับขนส่งใน sups (-1 = ว่าง)] } เลขภายในหนึ่งเลขมีเลขออนไลน์เลขเดียว
 *   online = แท็บมีคอลัมน์เลขคำสั่งซื้อออนไลน์ไหม, rounded = ออเดอร์ที่เลขออนไลน์ถูกชีตปัดเป็นเลขยกกำลัง (ดู online_)
 */
function orders_(from, to) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var tx = txTab_(ss);
  var out = {
    app: 'cut', at: Date.now(), from: from, to: to, span: { from: '', to: '' },
    skipped: { rows: 0, qty: 0 }, days: [], skus: [], srcs: [], lines: [],
    online: tx.at.online >= 0, refs: {}, sups: [], rounded: 0,
  };
  var dayIdx = {}, skuIdx = {}, srcIdx = {}, supIdx = {}, at = {};
  function no(idx, list, v, item) {
    if (idx[v] === undefined) { idx[v] = list.length; list.push(item === undefined ? v : item); }
    return idx[v];
  }
  eachRow_(tx, function (row, c) {
    var ref = ref_(row[c.ref]), sku = code_(row[c.sku]), q = num_(row[c.qty]);
    if (!ref && !sku && !q) return;
    var d = plainDate_(row[c.date], tz);
    stretch_(out.span, d);
    if (!d || !ref || !sku) {
      out.skipped.rows++;
      out.skipped.qty += q;
      return;
    }
    if ((from && d < from) || (to && d > to) || !q) return;
    var info = out.refs[ref] || (out.refs[ref] = ['', -1]);
    if (!info[0] && c.online >= 0) {
      info[0] = online_(row[c.online]);
      if (/E\+/i.test(info[0])) out.rounded++;
    }
    if (info[1] < 0 && text_(row[c.sup])) info[1] = no(supIdx, out.sups, text_(row[c.sup]));
    var k = d + '|' + ref + '|' + sku;
    var l = at[k];
    if (!l) {
      var name = (text_(row[c.brand]) + ' ' + text_(row[c.size])).trim();
      l = at[k] = [no(dayIdx, out.days, d), ref, no(skuIdx, out.skus, sku, [sku, name]), 0, no(srcIdx, out.srcs, text_(row[c.src]))];
      out.lines.push(l);
    }
    l[3] += q;
  });
  out.lines = out.lines.filter(function (l) { return l[3] !== 0; });
  return out;
}

/**
 * เลขคำสั่งซื้อออนไลน์ยาว 16–18 หลัก ช่องที่ชีตเก็บเป็นตัวเลข (ไม่ใช่ข้อความ) เกิน 15 หลักถูกปัดไปแล้ว หลักท้ายกู้คืนไม่ได้
 * ส่งแบบที่ชีตแสดง (9.90123E+17) ให้เห็นว่าเลขเสีย ไม่ส่งเลขเต็มที่ดูเหมือนถูกแต่หลักท้ายผิด เลขสั้นที่เป็นตัวเลขส่งตามปกติ
 */
function online_(v) {
  if (typeof v === 'number') {
    return Math.abs(v) >= 1e15 ? v.toExponential(5).toUpperCase().replace(/\.?0+E/, 'E') : String(v);
  }
  return text_(v);
}

/** ผลการเทียบ พร้อม took: เวลาที่ใช้ทั้งหมด เวลาจัดประเภท และเวลาของแต่ละแท็บ (ดูส่วน "จับเวลา") */
function check_() {
  CLOCK = { at: Date.now(), last: Date.now(), tabs: [] };
  try {
    var w = readAll_();
    var from = Date.now();
    var out = compare_(w);
    out.took = { ms: Date.now() - CLOCK.at, compare: Date.now() - from, tabs: CLOCK.tabs };
    return out;
  } finally {
    CLOCK = null;
  }
}

function readAll_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var w = newWork_();

  var jst = tab_(ss, TAB_JST, {
    ref: /^หมายเลขออเดอร์ภายใน/, sup: /^บริษัทขนส่ง/, ship: /^สถานะขนส่ง/, status: /^สถานะ$/, date: /^วันที่ออกจากคลัง/,
    sku: /^รหัสสินค้า/, name: /^ชื่อสินค้า/, qty: /^จำนวนสินค้า/,
  }, { status: 1 });
  w.tabs.jst.lastRow = jst.lastRow;
  eachRow_(jst, function (row, at) { addReport_(w, 'JST', row, at, tz); });

  var crm = tab_(ss, TAB_CRM, {
    date: /^วันที่/, sup: /^ขนส่ง/, ref: /^Order ID/i, sku: /^SKU/i, brand: /^แบรนด์/, size: /^ขนาด/, qty: /^จำนวน/,
  });
  w.tabs.crm.lastRow = crm.lastRow;
  eachRow_(crm, function (row, at) { addReport_(w, 'CRM', row, at, tz); });

  var tfSheet = ss.getSheetByName(TAB_TF);
  if (tfSheet && tfSheet.getLastRow() > 1) {
    var tf = tab_(ss, TAB_TF, {
      ref: /^หมายเลขใบโอนย้าย/, sup: /^โอนเข้าคลัง/, date: /^วันที่จัดส่ง/, sku: /^รหัสสินค้า/, name: /^ชื่อสินค้า/, qty: /^จำนวนการโอนย้าย/,
    });
    w.tabs.tf.lastRow = tf.lastRow;
    eachRow_(tf, function (row, at) { addReport_(w, TRANSFER, row, at, tz); });
    /* แท็บที่สร้างไว้แต่ยังไม่ได้วางข้อมูล ถ้านับว่ามี งานโอนย้ายทุกใบจะขึ้นเป็นตัดแต่ไม่มีใน Report */
    w.hasTf = w.tabs.tf.rows > 0;
  }

  if (!w.period.to) throw new Error('แท็บ Report ยังไม่มีข้อมูล ให้ดึง Report ของเดือนมาลงก่อน');

  var tx = txTab_(ss);
  w.tabs.tx.lastRow = tx.lastRow;
  eachRow_(tx, function (row, at) { addCut_(w, row, at, tz); });

  var tr = tab_(ss, TAB_TR, {
    date: /^วันที่/, sku: /^รหัสสินค้า/, ref: /^อธิบายรายการ/, lot: /^Serial/i, dept: /^แผนก/, inq: /^รับเข้า/, outq: /^เบิกออก/,
    wh: /^คลังสินค้า/,
  }, { wh: 1 });
  w.tabs.tr.lastRow = tr.lastRow;
  eachRow_(tr, function (row, at) { addTrcloud_(w, row, at, tz); });

  if (!w.tabs.tx.rows) throw new Error('แท็บ Transaction ยังไม่มีข้อมูล');
  if (!w.tabs.tr.rows) throw new Error('แท็บ TRcloud ยังไม่มีข้อมูล');

  return w;
}

/* ── แถว Report ของออเดอร์ที่เลือก ──────────────────────────────────────── */

/*
 * หน้าเว็บติ๊กออเดอร์ที่มีปัญหาแล้วกด Export ต้องการแถวใน Report ของออเดอร์นั้นครบทุกคอลัมน์
 * ผลตรวจส่งมาแค่ช่องที่ใช้เทียบ จึงต้องอ่านแท็บ Report ใหม่ เฉพาะเลขที่ส่งมา อ่านอย่างเดียวเหมือนส่วนบน
 */
var REPORT_REFS_MAX = 500;    // ออเดอร์ต่อการกดหนึ่งครั้ง
var REPORT_ROWS_MAX = 10000;  // แถวรวมทุกแท็บ กันผลใหญ่เกินที่ Apps Script ส่งกลับได้
var REPORT_TABS = [
  { name: TAB_JST, sys: 'JST', ref: /^หมายเลขออเดอร์ภายใน/ },
  { name: TAB_CRM, sys: 'CRM', ref: /^Order ID/i },
  { name: TAB_TF, sys: TRANSFER, ref: /^หมายเลขใบโอนย้าย/ },
];

function reportRows_(req) {
  var want = {};
  var n = 0;
  var refs = Array.isArray(req.refs) ? req.refs : [];
  for (var i = 0; i < refs.length && n < REPORT_REFS_MAX; i++) {
    var r = ref_(refs[i]);
    if (r && !want[r]) { want[r] = 1; n++; }
  }
  if (!n) throw new Error('ยังไม่ได้เลือกออเดอร์');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var out = { app: 'cut', refs: n, cut: false, tabs: [] };
  var total = 0;
  REPORT_TABS.forEach(function (spec) {
    var sh = ss.getSheetByName(spec.name);
    if (!sh || sh.getLastRow() < 2 || !sh.getLastColumn()) return;
    var t = tab_(ss, spec.name, { ref: spec.ref });
    var head = sh.getRange(1, 1, 1, t.lastCol).getValues()[0].map(text_);
    var width = head.length;
    while (width > t.at.ref + 1 && !head[width - 1]) width--;   // คอลัมน์ว่างท้ายตารางไม่ต้องส่ง
    var rows = [];
    for (var from = 2; from <= t.lastRow && !out.cut; from += READ_ROWS) {
      var part = sh.getRange(from, 1, Math.min(READ_ROWS, t.lastRow - from + 1), width).getValues();
      for (var j = 0; j < part.length; j++) {
        if (!want[ref_(part[j][t.at.ref])]) continue;
        if (total >= REPORT_ROWS_MAX) { out.cut = true; break; }
        rows.push(part[j].map(function (v) { return cell_(v, tz); }));
        total++;
      }
    }
    out.tabs.push({ name: spec.name, sys: spec.sys, head: head.slice(0, width), ref: t.at.ref, rows: rows });
  });
  return out;
}

/** วันที่ในชีตเป็นวัตถุ Date ส่งเป็นข้อความที่อ่านออก ถ้าไม่มีเวลาก็ไม่ต่อเวลาท้าย */
function cell_(v, tz) {
  if (v && typeof v.getTime === 'function') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss').replace(/ 00:00:00$/, '');
  }
  return v === null || v === undefined ? '' : v;
}

/* ── บันทึกการแก้ ───────────────────────────────────────────────────────── */

/* แท็บเดียวที่สคริปต์นี้เขียน สร้างเองตอนกดแก้แล้วครั้งแรก เว็บเติมได้แค่แถวต่อท้าย แก้หรือลบแถวเดิมไม่ได้ */
var TAB_LOG = 'บันทึกการแก้';
var LOG_HEAD = ['เวลา', 'คนกด', 'ทำ', 'ระบบที่แก้', 'วันที่', 'ออเดอร์', 'SKU', 'ระบบขาย', 'เรื่อง', 'ยอดที่ต้องแก้', 'คีย์'];
var LOG_FIXED = 'แก้แล้ว';
var LOG_UNDO = 'ยกเลิก';
var LOG_GONE = 'ตรวจแล้วหาย';
var LOG_SYS = { s: 'ชีตทีม', x: 'Uploadยิงออก', t: 'TRcloud' };
var LOG_MAX = 500;          // รายการต่อการกดหนึ่งครั้ง ทั้งเดือนของตุลามีราวสามร้อย

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.op === 'fix-log') return out_(fixAdd_(req));
    if (req.op === 'shared-fresh') return out_(sharedPress_(req));
    if (req.op === 'report-rows') return out_(reportRows_(req));
    return out_({ error: 'ไม่รู้จักคำสั่งนี้' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}

/** ตัดตัวที่ทำให้ชีตอ่านเป็นสูตรออก คนที่มี URL จะได้เขียนสูตรลงไฟล์ไม่ได้ */
function plain_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/^[=+\-@'\s]+/, '').slice(0, max);
}

/**
 * แถวทั้งหมดในแท็บบันทึกการแก้ เรียงตามที่บันทึก แถวหลังสุดของคีย์เดียวกันคือสถานะตอนนี้
 * ไม่มีแท็บคือยังไม่เคยกดแก้แล้ว ส่ง log ว่าง
 */
function fixLog_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_LOG);
  return {
    app: 'cut',
    at: Date.now(),
    log: sheet ? readLog_(sheet) : [],
    rows: sheet ? sheet.getLastRow() : 0,   // เทียบกับ logRows ของ shared-at ให้หน้าเว็บรู้ว่ามีคนกดเพิ่ม
    sheet: sheet ? { url: ss.getUrl(), gid: sheet.getSheetId() } : null,
  };
}

function readLog_(sheet) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  var back = {};
  Object.keys(LOG_SYS).forEach(function (k) { back[LOG_SYS[k]] = k; });
  var acts = [LOG_FIXED, LOG_UNDO, LOG_GONE];
  return sheet.getRange(2, 1, n, LOG_HEAD.length).getValues().map(function (c) {
    return {
      at: c[0] instanceof Date ? c[0].getTime() : 0, by: String(c[1]), act: String(c[2]), k: back[String(c[3])] || '',
      date: String(c[4]), ref: String(c[5]), sku: String(c[6]), sys: String(c[7]), what: String(c[8]),
      need: typeof c[9] === 'number' ? c[9] : 0, key: String(c[10]),
    };
  }).filter(function (r) { return r.key && r.at && r.k && acts.indexOf(r.act) >= 0; });
}

function logSheet_(ss) {
  var sheet = ss.getSheetByName(TAB_LOG);
  if (sheet) return sheet;
  sheet = ss.insertSheet(TAB_LOG, ss.getSheets().length);
  sheet.getRange(1, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]);
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * act: แก้แล้ว = คนกดว่าไปแก้ในระบบนั้นแล้ว, ยกเลิก = กดผิด, ตรวจแล้วหาย = หน้าเว็บตรวจรอบหลังกดแก้แล้วไม่พบรายการนี้
 * ยกเลิกกับตรวจแล้วหายใช้ได้เฉพาะรายการที่สถานะตอนนี้เป็นแก้แล้ว สองเครื่องตรวจพร้อมกันจะได้ไม่ลงซ้ำ
 * กดแก้แล้วซ้ำได้ เพราะตรวจแล้วยังไม่หายแล้วไปแก้อีกรอบ คือการแก้อีกครั้งจริงๆ
 * เวลาใช้เวลาของสคริปต์ หน้าเว็บเทียบกับเวลาที่ตรวจ (at ของ cut-check) ซึ่งเป็นนาฬิกาเดียวกัน
 */
function fixAdd_(req) {
  var act = [LOG_FIXED, LOG_UNDO, LOG_GONE].indexOf(req.act) >= 0 ? req.act : '';
  if (!act) return { error: 'ไม่รู้จักคำสั่งนี้' };
  var items = Array.isArray(req.items) ? req.items.slice(0, LOG_MAX) : [];
  if (!items.length) return { error: 'ไม่มีรายการที่จะบันทึก' };
  var by = plain_(req.by, 60);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = logSheet_(ss);
    var last = {};
    readLog_(sheet).forEach(function (r) { last[r.key] = r.act; });
    var now = new Date();
    var rows = [];
    items.forEach(function (i) {
      if (!i || !LOG_SYS[i.k]) return;
      var key = plain_(i.key, 300);
      var date = String(i.date || '');
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if (act !== LOG_FIXED && last[key] !== LOG_FIXED) return;
      last[key] = act;
      var need = Number(i.need);
      rows.push([now, by, act, LOG_SYS[i.k], date, plain_(i.ref, 100), plain_(i.sku, 100), plain_(i.sys, 30),
        plain_(i.what, 200), isFinite(need) ? need : 0, key]);
    });
    appendLog_(sheet, rows);
    var out = fixLog_();
    out.added = rows.length;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** ข้อความตั้งเป็นข้อความก่อนเขียน ไม่งั้นชีตจะแปลงวันที่กับเลขออเดอร์เองตามการตั้งค่าของไฟล์ */
function appendLog_(sheet, rows) {
  if (!rows.length) return;
  var at = sheet.getLastRow() + 1;
  var short = at + rows.length - 1 - sheet.getMaxRows();
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
  sheet.getRange(at, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(at, 2, rows.length, 8).setNumberFormat('@');
  sheet.getRange(at, 11, rows.length, 1).setNumberFormat('@');
  sheet.getRange(at, 1, rows.length, LOG_HEAD.length).setValues(rows);
}

/* ── ข้อมูลกลาง ─────────────────────────────────────────────────────────── */

/*
 * เดิมแต่ละเครื่องกดตรวจเอง ได้ผลคนละเวลา คนหนึ่งเห็นรายการที่ต้องแก้ตอนเช้า อีกคนเห็นตอนบ่าย แล้วคุยกันไม่ตรง
 * ตอนนี้ผลตรวจเก็บไว้ชุดเดียว ทุกเครื่องอ่านชุดนั้น หน้าเว็บถาม shared-at ทุกนาที มีชุดใหม่ค่อยโหลด
 * บันทึกการแก้อยู่ในแท็บของมันอยู่แล้ว shared-at บอกจำนวนแถวไปด้วย มีคนกดแก้แล้วเครื่องอื่นจะเห็นในนาทีถัดไป
 *
 * เก็บเป็นไฟล์ JSON ในโฟลเดอร์ SHARED_FOLDER ใน Drive ของเจ้าของสคริปต์ ไม่เขียนลงไฟล์ชีต
 * เวลา คนกด และเลขไฟล์อยู่ใน Script Properties คีย์ shared:<ชื่อ> ถามได้เร็วโดยไม่ต้องเปิดไฟล์
 *
 * ?api=cut-check&shared=1           ผลตรวจที่เก็บไว้ ยังไม่มีก็ตรวจใหม่แล้วเก็บ
 * POST {op:'shared-fresh', api, by} ตรวจใหม่แล้วเก็บแทนชุดเดิม ถ้ามีคนกำลังตรวจอยู่ตอบ busy แทนการตรวจซ้อน
 * ไม่ใส่ shared                     ตรวจใหม่ทุกครั้งและไม่เก็บ เหมือนรุ่นก่อน
 *
 * ตั้งเวลา: รัน installShared ครั้งเดียวจากหน้าแก้สคริปต์ เลิกด้วย stopShared
 */
var SHARED_APP = 'cut';
var SHARED_NAMES = ['cut-check'];
var SHARED_FOLDER = 'WMS ข้อมูลกลาง';
var SHARED_MAX_MIN = 0;           // ไม่มีอายุ ตรวจทีหนึ่งหลายนาที เปิดหน้าแล้วไม่ควรต้องรอ ชุดใหม่มาจากคนกดหรือรอบตั้งเวลา
var SHARED_EVERY_HOURS = 2;       // ตั้งเวลาตรวจเองทุกกี่ชั่วโมง ตรวจทีละหลายนาที ถี่กว่านี้กินโควตาเวลาของ Apps Script
var SHARED_FROM_HOUR = 8;         // ตั้งเวลาทำงานเฉพาะ 8:00 ถึงก่อน 18:00 ตามเวลาของไฟล์ชีต นอกเวลางานไม่มีใครดู
var SHARED_TO_HOUR = 18;
var SHARED_BUSY_MS = 7 * 60000;   // Apps Script ตัดจบที่ 6 นาที ป้ายกำลังคิดที่ค้างนานกว่านี้คือตัวที่ตายไปแล้ว
var SHARED_DEAD = 'รอบตรวจนี้ไม่จบ Apps Script ตัดจบเองที่ 6 นาที ข้อมูลในไฟล์น่าจะเยอะเกิน ให้ย้ายข้อมูลของเดือนที่ปิดแล้วออกจากไฟล์นี้ แล้วตรวจใหม่';

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
 * รอบที่ล้มเก็บข้อความไว้ใน shared-err งานตั้งเวลาไม่มีใครเห็นหน้าจอตอนนั้น และคนกดอาจรอจนหน้าเว็บหมดเวลาไปก่อน
 * จึงต้องบอกผ่านหน้าเว็บทีหลัง ทุกเครื่องเห็นว่ารอบล่าสุดไม่สำเร็จเพราะอะไร จนกว่าจะมีรอบที่สำเร็จ
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
    props.setProperty('shared-err:' + name, JSON.stringify({
      at: Date.now(), by: who.by, auto: !!who.auto, msg: String(err && err.message || err).slice(0, 500),
    }));
    throw err;
  } finally {
    props.deleteProperty('shared-run:' + name);
  }
}

/** ส่งผลที่เก็บไว้ ถ้ามีคนกำลังตรวจชุดใหม่อยู่ ส่งชุดเก่าไปก่อน ชุดใหม่หน้าเว็บจะโหลดเองตอนถามรอบถัดไป */
function sharedRead_(name, params, compute) {
  var kept = sharedLoad_(name, params, SHARED_MAX_MIN);
  if (kept) return kept;
  if (running_(name)) {
    var old = sharedLoad_(name, params, 0);
    if (old) return old;
  }
  return sharedFresh_(name, params, { by: '', auto: true }, compute);
}

/** ปุ่มตรวจใหม่ ชื่อคนกดมาจากเว็บ ตัดตัวที่ทำให้กลายเป็นสูตรออกเหมือนข้อความอื่นจากเว็บ */
function sharedPress_(req) {
  if (req.api !== 'cut-check') return { error: 'ไม่รู้จักข้อมูลชุดนี้' };
  return sharedFresh_('cut-check', null, { by: plain_(req.by, 60), auto: false }, check_);
}

/**
 * คำตอบสั้น ๆ ให้หน้าเว็บถามทุกนาที: ชุดล่าสุดเป็นของเวลาไหน ใครกด ใครกำลังตรวจอยู่ งานตั้งเวลาล้มไหม
 * logRows คือจำนวนแถวในแท็บบันทึกการแก้ (รวมหัวตาราง) เปลี่ยนเมื่อไรหน้าเว็บค่อยอ่านบันทึกใหม่
 */
function sharedAt_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = { app: SHARED_APP, at: Date.now(), shared: {}, run: {}, err: {} };
  SHARED_NAMES.forEach(function (n) {
    var i = sharedJson_(all, 'shared:' + n);
    if (i) out.shared[n] = { at: i.at, by: i.by, auto: i.auto, ms: i.ms, params: i.params };
    var r = sharedJson_(all, 'shared-run:' + n);
    var e = sharedJson_(all, 'shared-err:' + n);
    if (r && Date.now() - r.at < SHARED_BUSY_MS) out.run[n] = { at: r.at, by: r.by, auto: r.auto };
    /* ป้ายกำลังคิดถูกลบทุกครั้งที่รอบนั้นจบ ไม่ว่าสำเร็จหรือล้ม ป้ายที่ค้างเกินเวลาคือรอบที่ Apps Script ตัดจบกลางทาง */
    else if (r && !(i && i.at > r.at) && !(e && e.at > r.at)) e = { at: r.at, by: r.by, auto: !!r.auto, dead: true, msg: SHARED_DEAD };
    if (e) out.err[n] = e;
  });
  var log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_LOG);
  out.logRows = log ? log.getLastRow() : 0;
  return out;
}

function workHour_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = Number(Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'H'));
  return h >= SHARED_FROM_HOUR && h < SHARED_TO_HOUR;
}

/** ตรวจใหม่แล้วเก็บ คืนรายการที่ทำสำเร็จ ข้อความที่ล้มเก็บไว้ใน shared-err แล้ว */
function sharedAuto_() {
  try {
    return sharedFresh_('cut-check', null, { by: '', auto: true }, check_).busy ? [] : ['ผลตรวจ'];
  } catch (err) {
    return [];
  }
}

/** ตัวตั้งเวลาเรียกฟังก์ชันนี้ นอกเวลางานไม่ทำอะไร */
function sharedTick() {
  if (!workHour_()) return;
  sharedAuto_();
}

/** กดรันครั้งเดียวจากหน้าแก้สคริปต์: ตั้งเวลาตรวจเอง แล้วเก็บชุดแรกให้ทันที เพื่อให้เห็นว่าใช้ได้ (ตรวจรอบแรกใช้เวลาหลายนาที) */
function installShared() {
  stopShared();
  ScriptApp.newTrigger('sharedTick').timeBased().everyHours(SHARED_EVERY_HOURS).create();
  var done = sharedAuto_();
  return 'ตั้งเวลาแล้ว ทุก ' + SHARED_EVERY_HOURS + ' ชั่วโมง ช่วง ' + SHARED_FROM_HOUR + ':00 ถึง ' + SHARED_TO_HOUR + ':00'
    + ' / เก็บชุดแรกแล้ว: ' + (done.join(', ') || 'ไม่สำเร็จ ดูข้อความใน shared-err');
}

/** เลิกตั้งเวลา ผลที่เก็บไว้ยังอยู่ ปุ่มตรวจใหม่บนหน้าเว็บยังเก็บชุดกลางได้เหมือนเดิม */
function stopShared() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sharedTick') ScriptApp.deleteTrigger(t);
  });
}
