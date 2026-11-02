/**
 * cut-api.gs — เทียบรายการตัดสต๊อกกับ Report ออเดอร์ของเดือน
 *
 * ใช้กับหน้าเช็ครายการตัดสต๊อก (public/cut-check) — ใส่ URL ในหน้าตั้งค่า
 * ช่อง "Apps Script URL — เช็ครายการตัดสต๊อก" วิธีติดตั้งอยู่ใน README หัวข้อ "Stock Cut Check"
 *
 * ผูกกับไฟล์ Google Sheet ที่มี 4 แท็บด้านล่าง และอ่านอย่างเดียว ไม่เขียนอะไรลงชีตเลย
 * ข้อมูลรวมกันหลายแสนแถว ส่งให้เบราว์เซอร์ทั้งหมดไม่ไหว จึงคิดที่นี่แล้วส่งกลับเฉพาะสรุปกับรายการที่ไม่ตรง
 *
 * หน่วยที่เทียบคือ เลขออเดอร์ + SKU เลขคำสั่งซื้อออนไลน์ใช้ไม่ได้ เพราะบางแถวถูกชีตปัดเป็นเลขยกกำลัง
 * ยอดของ TRcloud คือ เบิกออก − รับเข้า เพราะการแก้ตัดผิดลงเป็นแถวรับเข้าของออเดอร์เดิม
 * ส่งยอดรายวันต่อ SKU ไปด้วย หน้าเว็บเอาไปเทียบกับแถวขายในสมุด Transaction (public/wms-cut.js)
 *
 * ?api=cut-check   ผลการเทียบ
 * ไม่ใส่ api        บอกแค่ว่าเป็นสคริปต์นี้ ให้หน้าตั้งค่าเช็คว่าใส่ URL ถูกตัว
 */

var TAB_TX = 'ตัดสต๊อกระบบ Transaction';
var TAB_TR = 'ตัดสต๊อกระบบ TRcloud';
var TAB_JST = 'Report order ระบบJST';
var TAB_CRM = 'Report order ระบบ CRM';

var CANCELLED = 'ยกเลิกแล้ว';
var TRANSFER = 'โอนย้าย';   // ค่าในคอลัมน์ที่มาของแท็บ Transaction งานย้ายคลัง ไม่ใช่ออเดอร์ จึงไม่มีใน Report
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

/* ประเภทที่ต้องตามแก้ ลำดับนี้คือลำดับที่หน้าเว็บแสดง */
var KINDS = ['over', 'wrong', 'ghost', 'cancel', 'under', 'blankCut', 'transferDiff'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.api === 'cut-check') return out_(check_());
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

/** แท็บที่ดึงมาด้วยสูตรมีทั้งวันที่จริงและข้อความปนกัน ขึ้นกับไฟล์ต้นทาง จึงต้องอ่านได้ทั้งคู่ */
function plainDate_(v, tz) {
  if (v && typeof v.getTime === 'function') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
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
  return y + '-' + ('0' + +m).slice(-2) + '-' + ('0' + +d).slice(-2);
}

/** หาคอลัมน์จากหัวตาราง ถ้าหาไม่เจอให้ล้มดัง ๆ เพราะอ่านผิดคอลัมน์แล้วตัวเลขจะผิดโดยไม่มีอะไรเตือน */
function tab_(ss, name, spec) {
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
    if (at[key] < 0) {
      throw new Error('แท็บ "' + name + '" หาคอลัมน์ ' + key + ' ไม่เจอ ถ้าแท็บนี้ดึงด้วยสูตร ให้เปิดชีตดูว่ายังขึ้นข้อมูลอยู่ไหม');
    }
  }
  return { sh: sh, name: name, at: at, lastRow: sh.getLastRow(), lastCol: lastCol };
}

function eachRow_(tab, fn) {
  var width = 0;
  for (var key in tab.at) width = Math.max(width, tab.at[key] + 1);
  width = Math.min(width, tab.lastCol);
  for (var from = 2; from <= tab.lastRow; from += READ_ROWS) {
    var rows = tab.sh.getRange(from, 1, Math.min(READ_ROWS, tab.lastRow - from + 1), width).getValues();
    for (var i = 0; i < rows.length; i++) fn(rows[i], tab.at);
  }
}

/* ── รวมยอดราย ออเดอร์ + SKU ───────────────────────────────────────────── */

function newWork_() {
  return {
    keys: {}, orders: {}, transfer: {}, carriers: {}, names: {}, crmNames: {},
    period: { from: '', to: '' },
    tabs: { tx: span_(), tr: span_(), jst: span_(), crm: span_() },
    totals: { report: 0, jst: 0, crm: 0, tx: 0, txJst: 0, txCrm: 0, txTransfer: 0, tr: 0, trOut: 0, trIn: 0 },
    outsideTx: { rows: 0, qty: 0, from: '', to: '', refs: {} },
    outsideTr: { rows: 0, qty: 0, from: '', to: '' },
    adjust: { rows: 0, inq: 0, outq: 0 },
    daily: { x: newSide_(), t: newSide_() },
  };
}

function newSide_() { return { days: {}, skipped: { rows: 0, qty: 0 } }; }

function span_() { return { rows: 0, from: '', to: '', lastRow: 0 }; }

function stretch_(s, d) {
  if (!d) return;
  if (!s.from || d < s.from) s.from = d;
  if (!s.to || d > s.to) s.to = d;
}

function key_(w, ref, sku) {
  var id = ref + '|' + sku;
  return w.keys[id] || (w.keys[id] = {
    ref: ref, sku: sku, r: 0, x: 0, out: 0, inq: 0, t: 0, ship: '', xd: {}, td: {}, note: '', sup: '', src: '',
  });
}

/** Report คือยอดที่ควรถูกตัด ต้องอ่านก่อน เพราะแถวตัดต้องรู้ว่าออเดอร์นี้อยู่ใน Report หรือเปล่า */
function addReport_(w, sys, row, at, tz) {
  var ref = ref_(row[at.ref]), sku = code_(row[at.sku]), q = num_(row[at.qty]);
  if (!ref && !sku && !q) return;
  var d = plainDate_(row[at.date], tz), sup = text_(row[at.sup]), ship = sys === 'JST' ? text_(row[at.ship]) : '';
  var span = sys === 'JST' ? w.tabs.jst : w.tabs.crm;
  span.rows++;
  stretch_(span, d);
  stretch_(w.period, d);
  w.totals.report += q;
  w.totals[sys === 'JST' ? 'jst' : 'crm'] += q;
  if (sup) w.carriers[sup] = 1;
  if (sys === 'JST' && !w.names[sku] && text_(row[at.name])) w.names[sku] = text_(row[at.name]);
  if (sys === 'CRM' && !w.crmNames[sku]) w.crmNames[sku] = (text_(row[at.brand]) + ' ' + text_(row[at.size])).trim();

  var o = w.orders[ref] || (w.orders[ref] = { sys: sys, date: '', sup: '', ship: '' });
  if (d > o.date) o.date = d;
  if (!o.sup) o.sup = sup;
  if (!o.ship) o.ship = ship;
  var k = key_(w, ref, sku);
  k.r += q;
  if (!k.ship) k.ship = ship;
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
  if (d) k.xd[d] = 1;
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
  if (d) k.td[d] = 1;
  /* ช่องนี้เก็บชื่อขนส่ง หรือเหตุผลที่พิมพ์เองตอนแก้ยอด อันที่ไม่ใช่ชื่อขนส่งคือเหตุผล */
  var lot = text_(row[at.lot]);
  if (lot && !k.note && !w.carriers[lot]) k.note = lot;
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

/** ส่งแบบย่อ วันที่กับ SKU อยู่ในตารางเดียวแล้วอ้างด้วยเลขลำดับ ทั้งเดือนมีหลายพันช่อง */
function dailyOf_(w) {
  var seen = {}, skus = [], dayIdx = {};
  [w.daily.x, w.daily.t].forEach(function (side) {
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
  var x = cells(w.daily.x), t = cells(w.daily.t);
  return { days: days, skus: skus, x: x, t: t, skippedX: w.daily.x.skipped, skippedT: w.daily.t.skipped };
}

/* ── จัดประเภท ─────────────────────────────────────────────────────────── */

/** ทุกแถวลงได้ถังเดียว ยอดกระทบท้ายรายงานจึงรวมกันแล้วต้องเท่ายอดจริงพอดี ถ้าไม่เท่าคือโค้ดผิด */
function bucket_(k, w) {
  var o = w.orders[k.ref];
  if (!o) {
    if (w.transfer[k.ref]) return k.x === k.t ? 'transfer' : 'transferDiff';
    return k.x || k.t ? 'ghost' : 'reversed';
  }
  if (!k.r) return k.x || k.t ? 'wrong' : 'reversed';
  var cancelled = k.ship === CANCELLED;
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
    ship: k.ship || (o && o.ship) || '',
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
    var sum = { k: first.k, ref: ref, sku: '', sys: first.sys, date: first.date, sup: first.sup, ship: first.ship,
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
    daily: dailyOf_(w),
  };
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
  var str = { lines: 0, qty: 0 }, bad = { lines: 0, qty: 0 }, rev = {};
  list.forEach(function (k) {
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
  var out = [], tx = w.tabs.tx, tr = w.tabs.tr, jst = w.tabs.jst, crm = w.tabs.crm;
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
  return out;
}

function check_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var w = newWork_();

  var jst = tab_(ss, TAB_JST, {
    ref: /^หมายเลขออเดอร์ภายใน/, sup: /^บริษัทขนส่ง/, ship: /^สถานะขนส่ง/, date: /^วันที่ออกจากคลัง/,
    sku: /^รหัสสินค้า/, name: /^ชื่อสินค้า/, qty: /^จำนวนสินค้า/,
  });
  w.tabs.jst.lastRow = jst.lastRow;
  eachRow_(jst, function (row, at) { addReport_(w, 'JST', row, at, tz); });

  var crm = tab_(ss, TAB_CRM, {
    date: /^วันที่/, sup: /^ขนส่ง/, ref: /^Order ID/i, sku: /^SKU/i, brand: /^แบรนด์/, size: /^ขนาด/, qty: /^จำนวน/,
  });
  w.tabs.crm.lastRow = crm.lastRow;
  eachRow_(crm, function (row, at) { addReport_(w, 'CRM', row, at, tz); });

  if (!w.period.to) throw new Error('แท็บ Report ยังไม่มีข้อมูล ให้ดึง Report ของเดือนมาลงก่อน');

  var tx = tab_(ss, TAB_TX, {
    date: /^Date$/i, sup: /^Sup$/i, ref: /^เลขภายใน/, sku: /^SKU$/i, brand: /^แบรนด์/, size: /^ขนาด/, qty: /^SUM of/i,
  });
  tx.at.src = tx.at.qty + 1;   // คอลัมน์ถัดจากจำนวนไม่มีหัวตาราง แต่บอกว่าแถวนี้มาจากระบบไหน
  w.tabs.tx.lastRow = tx.lastRow;
  eachRow_(tx, function (row, at) { addCut_(w, row, at, tz); });

  var tr = tab_(ss, TAB_TR, {
    date: /^วันที่/, sku: /^รหัสสินค้า/, ref: /^อธิบายรายการ/, lot: /^Serial/i, dept: /^แผนก/, inq: /^รับเข้า/, outq: /^เบิกออก/,
  });
  w.tabs.tr.lastRow = tr.lastRow;
  eachRow_(tr, function (row, at) { addTrcloud_(w, row, at, tz); });

  if (!w.tabs.tx.rows) throw new Error('แท็บ Transaction ยังไม่มีข้อมูล');
  if (!w.tabs.tr.rows) throw new Error('แท็บ TRcloud ยังไม่มีข้อมูล');

  return compare_(w);
}
