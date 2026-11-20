/**
 * @file wms-fire-core.js — ระบบใหม่บน Firebase ขั้น 1: ตรรกะล้วนของสมุดสต๊อก (ไม่แตะ Firebase ไม่แตะหน้าจอ)
 *
 * กฎทุกข้อย้ายมาจาก apps-script/book-api.gs (ข้อความ error เดิมทุกคำ) เปลี่ยนเฉพาะที่เก็บ:
 *   meta/head   {v, seq, month 'yyMM', next, last รหัสชุด, rows แถวรวม, open ยอดยกมาล่าสุด, mv เวอร์ชัน master, at}
 *   docs/{รหัสชุด}  กดบันทึก 1 ครั้ง = 1 เอกสาร สร้างได้อย่างเดียว ใหญ่เกิน PART_BYTES แยกเป็น {รหัสชุด}~2, ~3 (ไม่เกิน PARTS_MAX ส่วน)
 *               {v, no, seq, row แถวแรก, n, type, date, by, name, at, stamp, ref, link, why, qty, tr, trState, rows, names, orders, part}
 *               rows   = TSV [SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ประเภท, Note, Status, เลข TRcloud]
 *               orders = TSV [ระบบ, ออเดอร์, SKU, ชิ้น, เลขอ้างอิง, เลขพัสดุ, กอง (โล|LOT|PO|ชิ้น; …), เลขที่ตัด]
 *               names  = TSV [SKU เต็ม หรือ SKU, ชื่อสินค้า]
 *
 * บันทึกหนึ่งชุด = transaction เดียว: อ่าน meta/head กับ docs/{รหัสชุด} แล้วเขียนเอกสาร (+ ส่วนที่แยก) กับ meta/head
 * ทุกชุดเขียน meta/head จึงเรียงกันทีละชุดเสมอ และ seq ใน meta ต้องเท่ากับสำเนาในเครื่อง (ไม่เท่า = ดึงของใหม่แล้วลองใหม่)
 * สำเนาในเครื่องจึงตรงกับฐานทุกครั้งที่เช็ค กองไม่พอ ตัดซ้ำ คืนเกิน ยอดเปลี่ยนระหว่างนับ เช็คจากสำเนาได้ทั้งหมด
 * ไม่เก็บยอดคงเหลือแยกในฐาน: Rules อ่านเอกสารประกอบได้ไม่เกิน 20 ครั้งต่อคำขอ (นับรวมทุกเอกสารที่เขียน)
 * ยอดต่อกองคิดในเครื่องจากเอกสาร (applyDoc) แบบเดียวกับแท็บยอดคงเหลือของ book-api ทุกช่อง
 * ยกเลิก = เอกสารใหม่ประเภท กลับรายการ (link = เลขเดิม) สถานะยกเลิกของชุดเดิมคิดจากเอกสารนี้ ไม่แก้เอกสารเดิม
 *
 * fifo(local) สร้างคำตอบรูปเดียวกับ tx-fifo ของ tx-api.gs (เลขแถว วันที่รอบข้าง ธง cgr cq ทุกอย่าง) จากสำเนาในเครื่อง
 * WmsBook.stock() reflect() และหน้ารายงานจึงใช้ได้โดยไม่แก้
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsFireCore
 */
(function () {
  'use strict';

  var V = 1;                 // รุ่นของโครงข้อมูล สำเนาในเครื่องรุ่นไม่ตรง = ล้างแล้วโหลดใหม่
  var API_V = 4;             // คำตอบรูปเดียวกับ book-api.gs รุ่นนี้ (หน้า book เช็คด้วย checkV)
  var PART_BYTES = 700000;   // เอกสารเดียวไม่เกินนี้ (Firestore รับได้ 1 MiB)
  var PARTS_MAX = 7;         // ส่วนต่อชุด: Rules อ่านประกอบ 2 (เอกสารหลัก) + 2 (meta) + 2 ต่อส่วนแยก ต้องไม่เกิน 20 (ดู firebase/firestore.rules)
  var TZ_MS = 7 * 3600000;   // เวลาไทย ไม่มีเวลาออมแสง
  var TIME = '__server_time__';   // ตัวแทนเวลาเซิร์ฟเวอร์ store แปลงเป็น serverTimestamp()

  var ROLE_HEAD = 'หัวหน้า';
  var ROLE_USER = 'ลงรายการ';
  var ROLE_VIEW = 'ดูอย่างเดียว';
  var VOID = 'ยกเลิก';
  var TYPE_SALE = 'ตัดขาย';
  var TYPE_MOVE = 'ย้าย';
  var TYPE_RET = 'คืน';
  var TYPE_ROWS = 'ตารางเดิม';
  var TYPE_OPEN = 'ยอดยกมา';
  var TYPE_GR = 'รับของ';
  var TYPE_CONV = 'แปลง';
  var TYPE_ADJ = 'ปรับยอด';
  var TYPE_REV = 'กลับรายการ';
  var HEAD_TYPES = [TYPE_ROWS, TYPE_OPEN, TYPE_ADJ, TYPE_REV];
  var STAFF_TYPES = [TYPE_SALE, TYPE_MOVE, TYPE_RET, TYPE_GR, TYPE_CONV];
  var CONV_NOTE = 'แปลงสินค้า';
  var ADJ_NOTE = 'ปรับยอด';
  var TX_TYPES = ['รับ', 'เบิก', 'ขาย'];
  var SYSTEMS = ['JST', 'CRM'];
  var MOVE_NOTES = ['โอนย้าย', 'โอนย้าย QA'];
  var LINES_MAX = 8000;
  var ROWS_MAX = 3000;
  var PILES_MAX = 20;
  var KEYS_MAX = 2000;
  var HITS_MAX = 50;
  var FIND_MONTHS = 3;
  var BACK_DAYS = 45;
  /* เดือนของเลขเอกสารตามเวลาเซิร์ฟเวอร์ เผื่อ ±10 นาทีรอบเที่ยงคืนสิ้นเดือน (กดก่อนเที่ยงคืนถึงฐานหลังเที่ยงคืน · นาฬิกาเครื่องคลาดเล็กน้อย) ตรงกับ monthOk ใน firestore.rules */
  var MONTH_TOL = 600000;
  var RECENT_MAX = 7;
  var OPEN_MAX = 40000;
  var NAMES_MAX = 5000;

  /* ขั้น 3: สถานะลง TRcloud ของเอกสาร (ช่อง trState) · คลังใน TRcloud ตามโล (แบบหน้านับสต๊อกใหญ่) */
  var TR_WAIT = 'wait';   // ต้องลง TRcloud ยังไม่มีเลข
  var TR_DONE = 'done';   // ลงแล้ว มีเลข TRcloud
  var TR_NONE = 'none';   // ไม่ต้องลง (ตัดขาย ยอดยกมา ย้ายในคลังเดียวกัน หรือคนกดไม่ต้องลง)
  var TR_STATES = [TR_WAIT, TR_DONE, TR_NONE];
  var WH_MAIN = 'WH-02';
  var WH_QA = 'WH-QA';

  /** op ของหน้าเว็บ → ประเภทเอกสาร และใครลงได้ */
  var OPS = {
    'bk-cut': { type: TYPE_SALE, head: false },
    'bk-move': { type: TYPE_MOVE, head: false },
    'bk-return': { type: TYPE_RET, head: false },
    'bk-gr': { type: TYPE_GR, head: false },
    'bk-conv': { type: TYPE_CONV, head: false },
    'bk-rows': { type: TYPE_ROWS, head: true },
    'bk-adj': { type: TYPE_ADJ, head: true },
    'bk-open': { type: TYPE_OPEN, head: true },
    'bk-void': { type: TYPE_REV, head: true },
  };

  /* ── ค่าพื้นฐาน (แบบ book-api.gs) ────────────────────────────────────── */

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function up(v) { return text(v).toUpperCase(); }
  /** ข้อความจากเว็บต้องไม่กลายเป็นสูตรตอนส่งออกเป็นชีต */
  function plain(v, max) { return String(v === null || v === undefined ? '' : v).replace(/^[=+\-@'\s]+/, '').slice(0, max).trim(); }
  /** รหัส SKU / ออเดอร์ / Location / PO ตัวพิมพ์ใหญ่ ห้ามขึ้นต้นด้วยเครื่องหมายสูตร */
  function code(v, max) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    return (/^[=+@']/.test(s) ? s.replace(/^[=+@'\s]+/, '') : s).slice(0, max).toUpperCase();
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function pad2(n) { return (+n < 10 ? '0' : '') + (+n); }
  function pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

  function thai(now) { return new Date(now + TZ_MS); }
  function today(now) { var d = thai(now); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function stamp(now) {
    var d = thai(now);
    return today(now) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }
  /** เดือนของเลขเอกสาร '2611' ตามวันที่ไทย */
  function yymm(now) { var t = today(now); return t.slice(2, 4) + t.slice(5, 7); }
  /** เดือนที่ยอมให้เป็นเลขเอกสารเมื่อเวลาเซิร์ฟเวอร์ = now (เดือนนี้ หรือเดือนติดกันถ้าอยู่ห่างเที่ยงคืนสิ้นเดือนไม่เกิน MONTH_TOL) */
  function monthsOk(now) {
    var out = [];
    [now - MONTH_TOL, now, now + MONTH_TOL].forEach(function (t) { var m = yymm(t); if (out.indexOf(m) < 0) out.push(m); });
    return out;
  }
  function dayNo(d) { var p = String(d).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function period(day) { var y = +day.slice(0, 4), m = +day.slice(5, 7); return { ym: day.slice(0, 7), y: y, m: m }; }
  function prevYm(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + pad2(m);
  }
  function monthsBack(ym, n) { var out = [ym]; while (out.length < n) out.push(prevYm(out[out.length - 1])); return out; }
  function quarterTag(now) { var p = period(today(now)); return 'Q' + Math.ceil(p.m / 3) + '/' + String(p.y).slice(2); }

  /** วันที่ของชุด '' = ผ่าน ไม่งั้นคืนเหตุผล (book-api โยน Error ข้อความเดียวกัน) */
  function dayError(day, now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return 'วันที่ต้องเป็น yyyy-mm-dd';
    var gap = dayNo(today(now)) - dayNo(day);
    if (gap < -1) return 'วันที่ ' + day + ' ยังไม่ถึง';
    if (gap > BACK_DAYS) return 'วันที่ ' + day + ' ย้อนหลังเกิน ' + BACK_DAYS + ' วัน';
    return '';
  }

  /* ── ไบต์ TSV ────────────────────────────────────────────────────────── */

  /** ไบต์ UTF-8 ของข้อความ (ขนาดแบบที่ Firestore นับ) */
  function byteLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function cell(v) { return String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' '); }
  function enc(rows) { return rows.map(function (r) { return r.map(cell).join('\t'); }).join('\n'); }
  function dec(s) { return s ? String(s).split('\n').map(function (l) { return l.split('\t'); }) : []; }
  function encMap(m) { return enc(Object.keys(m).map(function (k) { return [k, m[k]]; })); }
  function decMap(s, numeric) {
    var m = {};
    dec(s).forEach(function (r) { if (r[0]) m[r[0]] = numeric ? +r[1] || 0 : r[1] || ''; });
    return m;
  }

  /** แถว 11 ช่อง ⇄ TSV (ชิ้นเป็นตัวเลข) */
  function rowsIn(s) {
    return dec(s).map(function (a) {
      return [a[0] || '', a[1] || '', a[2] || '', a[3] || '', a[4] || '', a[5] || '', +a[6] || 0, a[7] || '', a[8] || '', a[9] || '', a[10] || ''];
    });
  }
  /** บรรทัดออเดอร์ [ระบบ, ออเดอร์, SKU, ชิ้น, เลขอ้างอิง, เลขพัสดุ, กอง, เลขที่ตัด] */
  function linesIn(s) {
    return dec(s).map(function (a) {
      return { sys: a[0] || '', order: a[1] || '', sku: a[2] || '', qty: +a[3] || 0, ref: a[4] || '', track: a[5] || '', piles: a[6] || '', cut: a[7] || '' };
    });
  }
  function linesOut(list) { return enc(list.map(function (l) { return [l.sys, l.order, l.sku, l.qty, l.ref, l.track, l.piles, l.cut || '']; })); }

  /* ── ยอดคงเหลือต่อกอง (แบบ applyRows_ ของ book-api.gs) ─────────────── */

  function pileKey(loc, sku, lot, po) { return [loc, sku, lot, po].map(up).join('|'); }

  /** วันรับใน Note: "GR 02-10-26" หรือ "ยอดยกมา T2612-0001 · GR 02-10-26" → '2026-10-02' */
  function grDay(note) {
    var m = /\bGR\s*(\d{1,2})-(\d{1,2})-(\d{2})\b/i.exec(text(note));
    return m ? '20' + m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]) : '';
  }
  function grText(d) { return d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(2, 4); }

  /**
   * แถวเข้ายอดคงเหลือ กติกาเดียวกับ tx-api.gs: เข้า = มีโลรับ · ออก = มีโลเบิกและประเภทเป็น เบิก หรือ ขาย
   * Status ของกองยึดแถวเข้าล่าสุด · at = เลขแถวของแถวแรก · strict = คืนรายการกองไม่พอ · แก้ map ในที่
   */
  function applyRows(map, rows, at, strict) {
    var short = [];
    function pile(loc, r) {
      var k = pileKey(loc, r[1] || r[0], r[2], r[3]);
      return map[k] || (map[k] = { loc: up(loc), sku: up(r[0]), long: up(r[1]), lot: up(r[2]), po: up(r[3]), qty: 0, status: '', first: '', last: 0 });
    }
    rows.forEach(function (r, i) {
      if (!r[0] && !r[1]) return;
      var qty = +r[6] || 0;
      if (r[5]) {
        var p = pile(r[5], r);
        p.qty = round3(p.qty + qty);
        p.status = r[9] === 'เปิด' ? 'เปิด' : '';
        p.last = at + i;
        var d = grDay(r[8]);
        if (d && (!p.first || d < p.first)) p.first = d;
      }
      if (r[4] && (r[7] === 'เบิก' || r[7] === 'ขาย')) {
        var q = pile(r[4], r);
        if (strict && q.qty + 1e-9 < qty) short.push({ n: i + 1, loc: q.loc, sku: r[0], lot: r[2], po: r[3], have: Math.max(0, q.qty), need: qty });
        q.qty = round3(q.qty - qty);
        q.last = at + i;
      }
    });
    return short;
  }

  /* ── คลังใน TRcloud (ขั้น 3) ─────────────────────────────────────────── */

  /** คลังของโล: QA, IQA (QA-01, IQA2 ก็ได้) = WH-QA นอกนั้น (รวม RIB) = WH-02 แบบ WmsStocktake.whOf */
  function whOf(loc) { return /^I?QA(?![A-Z])/.test(up(loc)) ? WH_QA : WH_MAIN; }

  /**
   * ยอดที่เปลี่ยนในแต่ละคลังของ TRcloud จากแถวของเอกสาร [[SKU เต็ม หรือ SKU, คลัง, +/− ชิ้น]] รวมต่อ SKU + คลัง ตัด 0 ทิ้ง
   * ขาย = TRcloud ตัดจากออเดอร์เอง ไม่นับ · ย้ายในคลังเดียวกัน = ไม่เปลี่ยน · ย้ายข้ามคลัง = ลดต้นทาง เพิ่มปลายทาง
   * เบิกออก (มีแต่โลเบิก) = ลด · รับ = เพิ่มที่คลังของโลรับ
   */
  function whLines(rows) {
    var by = {}, order = [];
    function add(sku, wh, q) {
      var k = sku + '|' + wh;
      if (!(k in by)) { by[k] = 0; order.push([sku, wh, k]); }
      by[k] = round3(by[k] + q);
    }
    (rows || []).forEach(function (r) {
      var sku = up(r[1] || r[0]), q = +r[6] || 0;
      if (!sku || !q || r[7] === 'ขาย') return;
      if (r[7] === 'เบิก' && r[4]) {
        if (r[5]) {
          if (whOf(r[4]) !== whOf(r[5])) { add(sku, whOf(r[4]), -q); add(sku, whOf(r[5]), q); }
        } else add(sku, whOf(r[4]), -q);
      } else if (r[5]) add(sku, whOf(r[5]), q);
    });
    return order.filter(function (o) { return Math.abs(by[o[2]]) > 1e-9; }).map(function (o) { return [o[0], o[1], by[o[2]]]; });
  }

  /** เอกสารประเภทนี้ต้องลง TRcloud ไหม: รับของ แปลง คืน ปรับยอด ต้องเสมอ · ย้ายกับตารางเดิม เฉพาะที่ยอดในคลังเปลี่ยน */
  function trNeed(type, rows) {
    if (type === TYPE_GR || type === TYPE_CONV || type === TYPE_RET || type === TYPE_ADJ) return true;
    if (type === TYPE_MOVE || type === TYPE_ROWS) return whLines(rows).length > 0;
    return false;
  }

  function strictCheck(map, rows, at) {
    var short = applyRows(map, rows, at, true);
    return short.length ? { error: 'ยอดในสมุดไม่พอ ' + short.length + ' แถว ต้องลงรับของ หรือให้หัวหน้าปรับยอดก่อน', short: short.slice(0, 50) } : null;
  }

  function skuOfRow(r) { return r[1] || r[0]; }

  /** กองของ SKU ที่เกี่ยว (คัดลอกออกมา แก้ได้ไม่กระทบของในเครื่อง) */
  function pilesFor(all, skus) {
    var want = {}, out = {};
    skus.forEach(function (s) { if (s) want[up(s)] = 1; });
    Object.keys(all || {}).forEach(function (k) {
      var p = all[k];
      if (want[up(p.long || p.sku)]) out[k] = { loc: p.loc, sku: p.sku, long: p.long, lot: p.lot, po: p.po, qty: p.qty, status: p.status, first: p.first, last: p.last };
    });
    return out;
  }

  /**
   * เอกสารหนึ่งชุดเข้า map กองในเครื่อง (ยอดยกมา = เริ่มใหม่ทั้งหมด) กองที่เหลือ 0 ไม่เก็บ แบบแท็บยอดคงเหลือของ book-api
   * คืน map (ยอดยกมาได้ตัวใหม่)
   */
  function applyDoc(piles, d) {
    if (d.type === TYPE_OPEN) piles = {};
    var keys = {};
    d.rows.forEach(function (r) {
      if (!r[0] && !r[1]) return;
      if (r[5]) keys[pileKey(r[5], skuOfRow(r), r[2], r[3])] = 1;
      if (r[4]) keys[pileKey(r[4], skuOfRow(r), r[2], r[3])] = 1;
    });
    applyRows(piles, d.rows, d.row, false);
    Object.keys(keys).forEach(function (k) { if (piles[k] && Math.abs(piles[k].qty) <= 1e-9) delete piles[k]; });
    return piles;
  }

  /* ── ตรวจรูปแบบก่อนบันทึก (แบบ book-api.gs ทีละ op) ──────────────────── */

  function key(sys, order, sku) { return sys + '|' + order + '|' + sku; }

  function trOf(rows) {
    var seen = {}, out = [];
    (rows || []).forEach(function (r) { var t = text(r[10]); if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out.join(', ').slice(0, 300);
  }

  function namesIn(v) {
    var out = {}, n = 0;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    Object.keys(v).forEach(function (k) {
      if (n >= NAMES_MAX) return;
      var kk = code(k, 60);
      if (!kk) return;
      out[kk] = plain(v[k], 120);
      n++;
    });
    return out;
  }

  /** ชื่อสินค้าเฉพาะ SKU ที่อยู่ในแถว (ตาม names[SKU เต็ม] || names[SKU] แบบ txWrite_) */
  function namesFor(rows, names) {
    var out = {};
    rows.forEach(function (r) {
      var n = names[r[1]] || names[r[0]];
      if (n) out[r[1] || r[0]] = n;
    });
    return out;
  }

  /** แถวที่คัดลอก → { rows (11 ช่อง), qty } หรือ { error, bad } */
  function copyRows(copy, check) {
    if (!Array.isArray(copy) || !copy.length || copy.length > ROWS_MAX) return { error: 'แถวที่คัดลอกต้องมี 1–' + ROWS_MAX + ' แถว' };
    var rows = [], qty = 0, bad = [];
    copy.forEach(function (c, i) {
      c = c || [];
      var r = [code(c[0], 60), code(c[1], 60), code(c[2], 20), code(c[3], 40), code(c[4], 40), code(c[5], 40),
        num(c[6]), plain(c[7], 20), plain(c[8], 60), plain(c[9], 20), code(c[10], 30)];
      var why = !r[0] ? 'ไม่มี SKU' : r[6] === null || r[6] <= 0 ? 'ชิ้นต้องมากกว่า 0' : r[2] === '' || r[3] === '' ? 'ไม่มี LOT หรือ PO'
        : r[9] && r[9] !== 'เปิด' ? 'Status ต้องเป็น เปิด หรือว่าง' : check(r);
      if (why) { bad.push({ n: i + 1, sku: r[0], why: why }); return; }
      qty += r[6];
      rows.push(r);
    });
    if (bad.length) return { error: 'แถวที่คัดลอกไม่ถูก ' + bad.length + ' แถว', bad: bad.slice(0, 50) };
    return { rows: rows, qty: round3(qty) };
  }

  function batchOf(req) {
    var b = plain(req.batch, 60);
    if (!b) return { error: 'ไม่มีรหัสชุด' };
    if (/[\/]|^\.\.?$|^__.*__$/.test(b)) return { error: 'รหัสชุดใช้ไม่ได้' };
    return { batch: b };
  }

  /** กองในบรรทัดออเดอร์ [[โล, lot, po, ชิ้น]] → 'โล|LOT|PO|ชิ้น; …' หรือ null */
  function pilesText(piles, needLotPo) {
    var got = 0, ps = [];
    for (var j = 0; j < piles.length; j++) {
      var p = piles[j] || [];
      var pq = num(p[3]);
      if (!code(p[0], 40) || pq === null || pq <= 0) return null;
      if (needLotPo && (code(p[1], 20) === '' || code(p[2], 40) === '')) return null;
      got += pq;
      ps.push([code(p[0], 40), code(p[1], 20), code(p[2], 40), pq].join('|'));
    }
    return { got: got, text: ps.join('; ') };
  }

  function prepCut(req) {
    var lines = Array.isArray(req.lines) ? req.lines : [];
    if (!lines.length) return { error: 'ไม่มีบรรทัดออเดอร์ให้บันทึก' };
    if (lines.length > LINES_MAX) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LINES_MAX + ' บรรทัดออเดอร์' };
    var clean = [], seenKey = {}, bad = [], sumLines = 0;
    lines.forEach(function (l, i) {
      l = l || {};
      var sys = code(l.sys, 10), order = code(l.order, 60), sku = code(l.sku, 60), qty = num(l.qty);
      var piles = Array.isArray(l.piles) ? l.piles : [];
      function no(why) { bad.push({ n: i + 1, order: order, sku: sku, why: why }); }
      if (SYSTEMS.indexOf(sys) < 0) return no('ระบบต้องเป็น ' + SYSTEMS.join(' หรือ '));
      if (!order || !sku) return no('ไม่มีเลขออเดอร์หรือ SKU');
      if (qty === null || qty <= 0) return no('จำนวนต้องมากกว่า 0');
      if (!piles.length || piles.length > PILES_MAX) return no('ไม่มีกองที่ตัด');
      var k = key(sys, order, sku);
      if (seenKey[k]) return no('บรรทัดซ้ำในชุดเดียวกัน');
      seenKey[k] = 1;
      var ps = pilesText(piles, false);
      if (!ps) return no('กองที่ตัดไม่ครบ');
      if (Math.abs(ps.got - qty) > 1e-9) return no('ชิ้นในกองไม่เท่ากับชิ้นในออเดอร์');
      sumLines += qty;
      clean.push({ sys: sys, order: order, ref: code(l.ref, 60), track: code(l.track, 60), sku: sku, qty: qty, piles: ps.text, cut: '', key: k });
    });
    if (bad.length) return { error: 'มีบรรทัดออเดอร์ไม่ถูก ' + bad.length + ' บรรทัด', bad: bad.slice(0, 50) };
    sumLines = round3(sumLines);
    var cp = copyRows(req.copy, function (r) {
      if (r[7] !== 'ขาย') return 'ประเภทต้องเป็น ขาย';
      if (!r[4] || r[5]) return 'แถวขายมีแค่โลเบิก';
      return '';
    });
    if (cp.error) return cp;
    if (Math.abs(cp.qty - sumLines) > 1e-9) return { error: 'ชิ้นในแถวที่คัดลอก (' + cp.qty + ') ไม่เท่ากับชิ้นในออเดอร์ (' + sumLines + ')' };
    return { rows: cp.rows, qty: sumLines, lines: clean };
  }

  function prepReturn(req) {
    var lines = Array.isArray(req.lines) ? req.lines : [];
    if (!lines.length) return { error: 'ไม่มีบรรทัดคืนให้บันทึก' };
    if (lines.length > LINES_MAX) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LINES_MAX + ' บรรทัด' };
    var clean = [], seenKey = {}, bad = [], sumLines = 0;
    lines.forEach(function (l, i) {
      l = l || {};
      var sys = code(l.sys, 10), order = code(l.order, 60), sku = code(l.sku, 60), qty = num(l.qty);
      var cut = code(l.cut, 20), cutQty = num(l.cutQty);
      var piles = Array.isArray(l.piles) ? l.piles : [];
      function no(why) { bad.push({ n: i + 1, order: order, sku: sku, why: why }); }
      if (sys && SYSTEMS.indexOf(sys) < 0) return no('ระบบต้องเป็น ' + SYSTEMS.join(' หรือ ') + ' หรือว่าง');
      if (!sku) return no('ไม่มี SKU');
      if (qty === null || qty <= 0) return no('จำนวนต้องมากกว่า 0');
      if (!piles.length || piles.length > PILES_MAX) return no('ไม่มีกองที่คืนเข้า');
      var k = key(sys, order, sku);
      if (cut) {
        if (!sys || !order) return no('คืนตามเลขที่ตัดต้องมีระบบกับเลขออเดอร์');
        if (cutQty === null || cutQty <= 0) return no('ไม่รู้ชิ้นที่ตัด');
        if (seenKey[k]) return no('บรรทัดซ้ำในชุดเดียวกัน');
        seenKey[k] = 1;
      }
      var ps = pilesText(piles, true);
      if (!ps) return no('กองที่คืนเข้าไม่ครบ');
      if (Math.abs(ps.got - qty) > 1e-9) return no('ชิ้นในกองไม่เท่ากับชิ้นที่คืน');
      sumLines += qty;
      clean.push({ sys: sys, order: order, ref: code(l.ref, 60), track: code(l.track, 60), sku: sku, qty: qty, piles: ps.text,
        cut: cut, cutQty: cutQty, key: k });
    });
    if (bad.length) return { error: 'มีบรรทัดคืนไม่ถูก ' + bad.length + ' บรรทัด', bad: bad.slice(0, 50) };
    var cp = copyRows(req.copy, function (r) {
      if (r[7] !== 'รับ') return 'ประเภทต้องเป็น รับ';
      if (r[4] || !r[5]) return 'แถวคืนมีแค่โลรับ';
      if (r[8] !== 'RETURN' && !/^M\/E/i.test(r[8])) return 'Note ต้องเป็น RETURN หรือ M/E-…';
      return '';
    });
    if (cp.error) return cp;
    sumLines = round3(sumLines);
    if (Math.abs(cp.qty - sumLines) > 1e-9) return { error: 'ชิ้นในแถวที่คัดลอก (' + cp.qty + ') ไม่เท่ากับชิ้นที่คืน (' + sumLines + ')' };
    return { rows: cp.rows, qty: sumLines, lines: clean };
  }

  function prepMove(req) {
    var cp = copyRows(req.copy, function (r) {
      if (r[7] !== 'เบิก') return 'ประเภทต้องเป็น เบิก';
      if (!r[4] || !r[5]) return 'ต้องมีทั้งโลเบิกและโลรับ';
      if (r[4] === r[5]) return 'โลเบิกกับโลรับเป็นที่เดียวกัน';
      if (MOVE_NOTES.indexOf(r[8]) < 0) return 'Note ต้องเป็น ' + MOVE_NOTES.join(' หรือ ');
      return '';
    });
    return cp.error ? cp : { rows: cp.rows, qty: cp.qty };
  }

  function prepRows(req) {
    var cp = copyRows(req.copy, function (r) {
      if (TX_TYPES.indexOf(r[7]) < 0) return 'ประเภทต้องเป็น ' + TX_TYPES.join(' ');
      if (r[7] === 'รับ' && (!r[5] || r[4])) return 'แถวรับมีแค่โลรับ';
      if (r[7] === 'เบิก' && !r[4]) return 'แถวเบิกต้องมีโลเบิก';
      if (r[7] === 'ขาย' && (!r[4] || r[5])) return 'แถวขายมีแค่โลเบิก';
      if (r[4] && r[4] === r[5]) return 'โลเบิกกับโลรับเป็นที่เดียวกัน';
      if (!r[8]) return 'ต้องมี Note บอกว่าเป็นงานอะไร';
      if (r[7] === 'ขาย' && !/^\d{4}-\d{2}-\d{2}$/.test(r[8])) return 'แถวขาย Note ต้องเป็นวันที่ขาย (yyyy-mm-dd)';
      return '';
    });
    return cp.error ? cp : { rows: cp.rows, qty: cp.qty };
  }

  function prepGr(req) {
    var cp = copyRows(req.copy, function (r) {
      if (r[7] !== 'รับ') return 'ประเภทต้องเป็น รับ';
      if (r[4] || !r[5]) return 'แถวรับของมีแค่โลรับ';
      if (!/^GR \d{2}-\d{2}-\d{2}$/.test(r[8])) return 'Note ต้องเป็น GR วว-ดด-ปป';
      return '';
    });
    return cp.error ? cp : { rows: cp.rows, qty: cp.qty };
  }

  function prepConv(req) {
    var cp = copyRows(req.copy, function (r) {
      if (r[8] !== CONV_NOTE) return 'Note ต้องเป็น ' + CONV_NOTE;
      if (r[7] === 'เบิก') return r[4] && !r[5] ? '' : 'แถวเบิกของแปลงมีแค่โลเบิก';
      if (r[7] === 'รับ') return r[5] && !r[4] ? '' : 'แถวรับของแปลงมีแค่โลรับ';
      return 'ประเภทต้องเป็น เบิก หรือ รับ';
    });
    if (cp.error) return cp;
    var rows = cp.rows;
    if (rows.length % 2) return { error: 'แถวแปลงต้องมาเป็นคู่ เบิก SKU ตอนซื้อ แล้วรับ SKU ใหม่' };
    var bad = [];
    for (var i = 0; i < rows.length; i += 2) {
      var a = rows[i], b = rows[i + 1], n = i / 2 + 1;
      var why = a[7] !== 'เบิก' || b[7] !== 'รับ' ? 'คู่ต้องเป็นแถวเบิกแล้วแถวรับ'
        : (a[1] || a[0]) === (b[1] || b[0]) ? 'แปลงเป็น SKU เดิม'
        : a[2] !== b[2] || a[3] !== b[3] ? 'LOT / PO ของคู่ไม่ตรงกัน'
        : Math.abs(a[6] - b[6]) > 1e-9 ? 'ชิ้นของคู่ไม่ตรงกัน' : '';
      if (why) bad.push({ n: n, sku: b[0], why: why });
    }
    if (bad.length) return { error: 'คู่แปลงไม่ถูก ' + bad.length + ' คู่', bad: bad.slice(0, 50) };
    return { rows: rows, qty: round3(cp.qty / 2) };
  }

  function prepAdj(req) {
    var adj = (Array.isArray(req.lines) ? req.lines : []).slice(0, ROWS_MAX).map(function (l) {
      l = l || {};
      return { loc: code(l.loc, 40), sku: code(l.sku, 60), lot: code(l.lot, 20), po: code(l.po, 40), have: num(l.have), count: num(l.count) };
    });
    var cp = copyRows(req.copy, function (r) {
      if (r[8].indexOf(ADJ_NOTE + ' ') !== 0 || r[8].length <= ADJ_NOTE.length + 1) return 'Note ต้องเป็น ' + ADJ_NOTE + ' ตามด้วยเหตุผล';
      if (r[7] === 'เบิก') return r[4] && !r[5] ? '' : 'แถวปรับลดมีแค่โลเบิก';
      if (r[7] === 'รับ') return r[5] && !r[4] ? '' : 'แถวปรับเพิ่มมีแค่โลรับ';
      return 'ประเภทต้องเป็น เบิก หรือ รับ';
    });
    return cp.error ? cp : { rows: cp.rows, qty: cp.qty, adj: adj };
  }

  function prepOpen(req, now) {
    var src = Array.isArray(req.rows) ? req.rows : [];
    if (!src.length || src.length > OPEN_MAX) return { error: 'ยอดยกมาต้องมี 1–' + OPEN_MAX + ' กอง' };
    var list = [], names = {}, bad = [], qty = 0, seen = {};
    src.forEach(function (c, i) {
      c = c || [];
      var r = [code(c[0], 60), code(c[1], 60), code(c[3], 20), code(c[4], 40), '', code(c[5], 40), num(c[6]), 'รับ', '',
        text(c[7]) === 'เปิด' ? 'เปิด' : '', ''];
      var why = !r[0] ? 'ไม่มี SKU' : !r[5] ? 'ไม่มีโล' : r[6] === null || r[6] <= 0 ? 'ชิ้นต้องมากกว่า 0'
        : r[2] === '' || r[3] === '' ? 'ไม่มี LOT หรือ PO' : '';
      var k = pileKey(r[5], r[1] || r[0], r[2], r[3]);
      if (!why && seen[k]) why = 'กองซ้ำ';
      if (why) { bad.push({ n: i + 1, sku: r[0], loc: r[5], why: why }); return; }
      seen[k] = 1;
      var gr = /^\d{4}-\d{2}-\d{2}$/.test(text(c[8])) ? text(c[8]) : '';
      var q = /^Q[1-4]\/\d{2}$/.test(text(c[9])) ? text(c[9]) : '';
      list.push({ r: r, gr: gr, q: q });
      var nm = plain(c[2], 120);
      if (nm) names[r[1] || r[0]] = nm;
      qty += r[6];
    });
    if (bad.length) return { error: 'ยอดยกมาไม่ถูก ' + bad.length + ' กอง', bad: bad.slice(0, 50) };
    var asOf = num(req.asOf);
    return { open: list, names: names, qty: round3(qty), qt: quarterTag(now), replace: !!req.replace, ref: asOf ? 'สมุดเดิมถึงแถว ' + asOf : '' };
  }

  /**
   * ตรวจรูปแบบของคำขอก่อนแตะฐาน (ไม่ต้องอ่านอะไร) → แผน P หรือ { error }
   * P = { op, type, batch, day, rows, qty, names, ref, lines?, adj?, open?, voidNo?, why? }
   */
  function prep(op, req, now) {
    req = req || {};
    var spec = OPS[op];
    if (!spec) return { error: 'ไม่รู้จักคำสั่งนี้' };
    if (op === 'bk-void') {
      var no = code(req.doc, 20), why = plain(req.why, 200);
      if (!no) return { error: 'ไม่ได้บอกเลขที่เอกสาร' };
      if (!why) return { error: 'ต้องใส่เหตุผลที่ยกเลิก' };
      return { op: op, type: TYPE_REV, voidNo: no, why: why, batch: 'rev|' + no, day: today(now) };
    }
    var b = batchOf(req);
    if (b.error) return b;
    var P;
    if (op === 'bk-open') {
      P = prepOpen(req, now);
      if (P.error) return P;
      P.day = today(now);
    } else {
      var de = dayError(text(req.date), now);
      if (de) return { error: de };
      P = op === 'bk-cut' ? prepCut(req) : op === 'bk-return' ? prepReturn(req) : op === 'bk-move' ? prepMove(req)
        : op === 'bk-gr' ? prepGr(req) : op === 'bk-conv' ? prepConv(req) : op === 'bk-adj' ? prepAdj(req) : prepRows(req);
      if (P.error) return P;
      P.day = text(req.date);
      P.names = namesIn(req.names);
      if (op !== 'bk-cut' && op !== 'bk-return') P.ref = plain(req.ref, 60);
    }
    P.op = op;
    P.type = spec.type;
    P.batch = b.batch;
    return P;
  }

  /** เดือนที่นับชิ้นที่คืนแล้วกันคืนเกิน: เดือนนี้ย้อนถึงเดือนเก่าสุดที่หาออเดอร์ได้ (แบบ returned_) */
  function retMonths(day, now) {
    var oldest = monthsBack(period(day).ym, FIND_MONTHS).pop();
    var m = period(today(now)).ym, out = [], guard = 0;
    while (m >= oldest && guard++ < 12) { out.push(m); m = prevYm(m); }
    return out;
  }

  /* ── สำเนาในเครื่อง: เอกสาร สถานะ ค้นหา ─────────────────────────────── */

  function lineCount(s) { return s ? String(s).split('\n').length : 0; }
  /** จุดตัดส่วนของเอกสารใหญ่ [[บรรทัด rows, บรรทัด orders] ต่อส่วน] ไว้ทำไฟล์สำรองให้แยกส่วนตรงกับในฐาน */
  function cutOf(main, rest) {
    return [[lineCount(main.rows), lineCount(main.orders)]].concat(rest.map(function (p) { return [lineCount(p.rows), lineCount(p.orders)]; }));
  }

  /** เอกสารจากฐาน (+ ส่วนที่แยก) → รูปที่ใช้ในเครื่อง */
  function docIn(id, d, parts) {
    var rows = d.rows || '', orders = d.orders || '';
    var sorted = (parts || []).slice().sort(function (a, b) { return a.i - b.i; });
    sorted.forEach(function (p) {
      if (p.rows) rows = rows ? rows + '\n' + p.rows : p.rows;
      if (p.orders) orders = orders ? orders + '\n' + p.orders : p.orders;
    });
    var out = {
      id: id, no: d.no || '', seq: +d.seq || 0, row: +d.row || 0, n: +d.n || 0, type: d.type || '', date: d.date || '',
      by: d.by || '', name: d.name || '', at: typeof d.at === 'number' ? d.at : 0, stamp: d.stamp || '',
      ref: d.ref || '', link: d.link || '', why: d.why || '', qty: +d.qty || 0, tr: d.tr || '', trState: d.trState || '',
      trBy: d.trBy || '', trAt: typeof d.trAt === 'number' ? d.trAt : 0,
      rows: rowsIn(rows), names: decMap(d.names), lines: linesIn(orders), part: +d.part || 1,
    };
    if (sorted.length) out.cut = cutOf(d, sorted);
    var w = widthOf(rows);
    if (w) out.w = w;
    return out;
  }

  /** จำนวนช่องของแถวที่เก็บ: 10 ทุกแถว = 0 (ไม่เก็บ) · เท่ากันทุกแถว = ตัวเลข · ปนกัน = รายแถว (docOut เขียนกลับได้ตรงทุกตัวอักษร) */
  function widthOf(s) {
    var ws = s ? String(s).split('\n').map(function (l) { return l.split('\t').length; }) : [];
    if (!ws.length || ws.every(function (x) { return x === 10; })) return 0;
    return ws.every(function (x) { return x === ws[0]; }) ? ws[0] : ws;
  }

  /** รูปในเครื่อง → ข้อมูลที่เก็บในฐาน (ก่อนแยกส่วน) ตรงกับที่ plan() เขียน ใช้ทำไฟล์สำรองจากสำเนาในเครื่อง */
  function docOut(d) {
    var o = {
      v: V, no: d.no, seq: d.seq, row: d.row, n: d.n, type: d.type, date: d.date, by: d.by, name: d.name,
      at: d.at, stamp: d.stamp, ref: d.ref, link: d.link, why: d.why, qty: d.qty, tr: d.tr, trState: d.trState,
      rows: enc(d.rows.map(function (r, i) {
        var w = Array.isArray(d.w) ? d.w[i] : d.w || 10;
        return r.slice(0, Math.max(w, r[10] ? 11 : 10));
      })), names: encMap(d.names || {}),
      orders: d.lines && d.lines.length ? linesOut(d.lines) : '', part: 1,
    };
    if (d.trBy) { o.trBy = d.trBy; o.trAt = d.trAt; }
    return o;
  }

  /** สถานะยกเลิกของทุกเอกสาร { เลขที่: {status, voidBy, voidAt, why, link} } จากเอกสารกลับรายการ และยอดยกมาที่ถูกลงใหม่ */
  function voids(local) {
    var out = {}, open = local.meta && local.meta.open;
    (local.docs || []).forEach(function (d) {
      if (d.type === TYPE_REV && d.link) out[d.link] = { status: VOID, voidBy: d.name, voidAt: d.stamp, why: d.why, link: d.no };
      if (d.type === TYPE_OPEN && open && d.seq < open.seq && !out[d.no]) {
        out[d.no] = { status: VOID, voidBy: '', voidAt: '', why: 'ลงยอดยกมาใหม่', link: '' };
      }
    });
    return out;
  }

  /** เอกสารที่ยังนับ (หลังยอดยกมาล่าสุด) */
  function liveDocs(local) {
    var open = local.meta && local.meta.open;
    return (local.docs || []).filter(function (d) { return !open || d.seq >= open.seq; });
  }

  /** บรรทัดที่ตัดแล้วของเดือนนั้นกับเดือนก่อน { คีย์: เลขที่ } ไม่นับชุดที่ยกเลิก (แบบ cutKeys_) */
  function cutKeys(local, day) {
    var ym = period(day).ym, want = {}, have = {}, vd = voids(local);
    want[ym] = 1; want[prevYm(ym)] = 1;
    (local.docs || []).forEach(function (d) {
      if (d.type !== TYPE_SALE || vd[d.no] || !want[d.date.slice(0, 7)]) return;
      d.lines.forEach(function (l) { have[key(l.sys, l.order, l.sku)] = d.no; });
    });
    return have;
  }

  /** ชิ้นที่คืนแล้วต่อบรรทัดออเดอร์ของเดือนในรายการ ไม่นับชุดที่ยกเลิก (แบบ returned_) */
  function returnedLocal(local, months) {
    var want = {}, back = {}, vd = voids(local);
    months.forEach(function (m) { want[m] = 1; });
    (local.docs || []).forEach(function (d) {
      if (d.type !== TYPE_RET || vd[d.no] || !want[d.date.slice(0, 7)]) return;
      d.lines.forEach(function (l) {
        if (!l.order) return;
        var k = key(l.sys, l.order, l.sku);
        back[k] = round3((back[k] || 0) + l.qty);
      });
    });
    return back;
  }

  /** bk-seen */
  function seen(local, req, now) {
    var day = text(req.date), de = dayError(day, now);
    if (de) return { error: de };
    var have = cutKeys(local, day), out = {};
    (Array.isArray(req.keys) ? req.keys : []).slice(0, LINES_MAX).forEach(function (k) {
      k = text(k).toUpperCase();
      if (have[k]) out[k] = have[k];
    });
    return { app: 'book', v: API_V, seen: out };
  }

  function pilesOf(s) {
    return text(s).split(/;\s*/).filter(Boolean).map(function (x) {
      var p = x.split('|');
      return [p[0] || '', p[1] || '', p[2] || '', +p[3] || 0];
    });
  }

  /** bk-find หาจากเลขออเดอร์ เลขอ้างอิง หรือเลขพัสดุ ย้อน FIND_MONTHS เดือน */
  function find(local, req, now) {
    var day = text(req.date), de = dayError(day, now);
    if (de) return { error: de };
    var want = {}, left = 0;
    (Array.isArray(req.keys) ? req.keys : []).slice(0, KEYS_MAX).forEach(function (k) {
      k = code(k, 60);
      if (k && !want[k]) { want[k] = 1; left++; }
    });
    var months = monthsBack(period(day).ym, FIND_MONTHS), found = {}, vd = voids(local);
    months.forEach(function (m) {
      if (!left) return;
      (local.docs || []).forEach(function (d) {
        if (d.type !== TYPE_SALE || vd[d.no] || d.date.slice(0, 7) !== m) return;
        d.lines.forEach(function (l) {
          var hit = {};
          [l.order, l.ref, l.track].forEach(function (v) { var k = text(v).toUpperCase(); if (k && want[k]) hit[k] = 1; });
          Object.keys(hit).forEach(function (k) {
            if (!found[k]) { found[k] = []; left--; }
            if (found[k].length >= HITS_MAX) return;
            found[k].push({ sys: l.sys, order: l.order, ref: l.ref, track: l.track, sku: l.sku, qty: l.qty, date: d.date, doc: d.no,
              piles: pilesOf(l.piles), back: 0 });
          });
        });
      });
    });
    var back = returnedLocal(local, retMonths(day, now));
    Object.keys(found).forEach(function (k) {
      found[k].forEach(function (l) { l.back = back[key(l.sys, l.order, l.sku)] || 0; });
    });
    return { app: 'book', v: API_V, found: found, miss: Object.keys(want).filter(function (k) { return !found[k]; }), months: months };
  }

  /** แถวของเอกสารแบบแถวที่คัดลอกของ book-api (10 ช่อง + เลข TRcloud เฉพาะแถวที่มี) */
  function copyOf(d) {
    return d.rows.map(function (r) { var o = r.slice(0, 10); return r[10] ? o.concat([r[10]]) : o; });
  }

  function lite(d, vd, withCopy) {
    var v = vd[d.no] || {};
    var o = { doc: d.no, type: d.type, date: d.date, who: d.name, at: d.stamp, rows: d.n, qty: d.qty, orders: countOrders(d),
      status: v.status || '', voidBy: v.voidBy || '', voidAt: v.voidAt || '', why: v.why || '',
      batch: d.id, base: d.row ? d.row - 1 : 0, book: 1, tr: d.tr || '', link: v.link || d.link || '' };
    if (withCopy) o.copy = copyOf(d);
    return o;
  }
  function countOrders(d) {
    var o = {};
    d.lines.forEach(function (l) { if (l.order) o[l.sys + '|' + l.order] = 1; });
    return Object.keys(o).length;
  }

  /** bk-recent ชุดที่บันทึกในไม่กี่วันล่าสุด ใหม่สุดก่อน พร้อมแถว */
  function recent(local, req, now) {
    var days = Math.max(1, Math.min(RECENT_MAX, +req.days || 2));
    var from = dayNo(today(now)) - days + 1, vd = voids(local);
    var list = (local.docs || []).filter(function (d) { return d.stamp && dayNo(d.stamp.slice(0, 10)) >= from; });
    list.sort(function (a, b) { return b.seq - a.seq; });
    return { app: 'book', v: API_V, today: today(now), docs: list.map(function (d) { return lite(d, vd, true); }) };
  }

  /** ทุกกองในเครื่อง { คีย์กอง: กอง } */
  function allPiles(local) { return local.piles || {}; }

  /** bk-stock [[โล, SKU, SKU เต็ม, LOT, PO, ยอด, Status]] */
  function stock(local) {
    var map = allPiles(local);
    return {
      app: 'book', v: API_V, mode: 'book', rows: (local.meta && local.meta.rows) || 0,
      piles: Object.keys(map).map(function (k) { var p = map[k]; return [p.loc, p.sku, p.long, p.lot, p.po, p.qty, p.status]; }),
    };
  }

  /** bk-state */
  function state(local, now) {
    var meta = local.meta || {}, vd = voids(local), open = meta.open || null;
    var od = open ? (local.docs || []).filter(function (d) { return d.id === open.id; })[0] : null;
    var after = od ? liveDocs(local).filter(function (d) { return d.seq > od.seq && !vd[d.no] && d.type !== TYPE_OPEN; }) : [];
    var first = od && od.rows[0];
    return {
      app: 'book', v: API_V, mode: 'book', modeAt: '', modeBy: '', fire: 1,
      rows: meta.rows || 0, piles: Object.keys(allPiles(local)).length,
      open: od ? { doc: od.no, at: od.stamp, who: od.name, rows: od.n, qty: od.qty, asOf: 0 } : null,
      after: after.length, afterDocs: after.slice(-10).map(function (d) { return d.no; }),
      first: first ? { sku: first[0], long: first[1], lot: first[2], po: first[3], to: first[5], qty: first[6] } : null,
      backup: { at: '', row: 0 }, today: today(now),
    };
  }

  /** ยอดต่อกองคิดใหม่จากเอกสารทุกชุดในสำเนา (ตามลำดับ seq) · rows = แถวที่ใช้คิด */
  function pilesFromDocs(local) {
    var map = {}, n = 0;
    liveDocs(local).slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (d) {
      map = applyDoc(map, d);
      n += d.rows.length;
    });
    return { map: map, rows: n };
  }

  /** ตรวจยอด (แทน bk-rebuild): คิดยอดใหม่จากเอกสารทั้งหมดหลังยอดยกมา เทียบกับยอดในเครื่อง ไม่เขียนอะไร */
  function rebuild(local) {
    var po = pilesFromDocs(local), map = po.map, n = po.rows;
    var have = allPiles(local), diff = [], keys = {};
    Object.keys(map).forEach(function (k) { keys[k] = 1; });
    Object.keys(have).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) {
      var a = map[k] ? map[k].qty : 0, b = have[k] ? have[k].qty : 0;
      if (Math.abs(a - b) > 1e-9) {
        var p = map[k] || have[k];
        diff.push([p.loc, p.sku, p.lot, p.po, a, b]);
      }
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    var neg = list.filter(function (p) { return p.qty < 0; });
    return {
      app: 'book', v: API_V, rows: n, piles: list.length, neg: neg.length, same: !diff.length, diff: diff.slice(0, 200), diffCount: diff.length,
      negList: neg.slice(0, 50).map(function (p) { return [p.loc, p.sku, p.lot, p.po, p.qty]; }),
    };
  }

  /* ── วางแผนเขียน (เรียกใน transaction หลังอ่าน meta แล้ว) ───────────── */

  /**
   * ctx = { meta (null = ฐานว่าง), local (สำเนาในเครื่องที่ seq เท่ากับ meta), user {email, name}, now, partBytes? }
   * → { error, … } หรือ { writes: [[path, data]], doc (รูปในเครื่อง), meta, reply }
   */
  function plan(P, ctx) {
    var now = ctx.now, meta = ctx.meta || { v: V, seq: 0, month: '', next: 1, last: '', rows: 0, open: null, mv: 0 };
    var local = ctx.local || { docs: [], meta: meta, piles: {} };
    var vd = voids(local);
    /* เดือนไม่ย้อน: เครื่องอื่นเริ่มเดือนใหม่แล้ว (นาฬิกาเครื่องนี้ยังเป็นเดือนก่อน) = ใช้เดือนของ meta เลขรันต่อ ไม่เริ่ม 1 ซ้ำ */
    var month = yymm(now);
    if (meta.month && meta.month > month) month = meta.month;
    var nextNo = meta.month === month ? +meta.next || 1 : 1;
    var no = 'T' + month + '-' + pad4(nextNo);
    var st = stamp(now);
    var at = (+meta.rows || 0) + 2;   // เลขแถวแรกแบบแท็บ Transaction (แถว 1 = หัวตาราง)
    var rows, qty, names = {}, ref = P.ref || '', link = '', why = '', lines = [], reply, open = meta.open || null, rowAt = at, map, chk;

    if (P.op === 'bk-void') {
      var d = (local.docs || []).filter(function (x) { return x.no === P.voidNo; })[0];
      if (!d) return { error: 'ไม่พบเลขที่ ' + P.voidNo };
      if (vd[d.no]) return { error: d.no + ' ถูกยกเลิกไปแล้ว' };
      if (d.type === TYPE_OPEN) return { error: 'ยอดยกมายกเลิกไม่ได้ ใช้ ลงยอดยกมาใหม่ ในหน้าตั้งค่าสมุด' };
      if (d.type === TYPE_REV) return { error: d.no + ' เป็นชุดลงแถวกลับของ ' + (d.link || 'ชุดอื่น') + ' ยกเลิกซ้ำไม่ได้ ถ้าต้องการของคืนให้ลงชุดใหม่' };
      if (open && d.seq < open.seq) return { error: d.no + ' อยู่ก่อนยอดยกมาล่าสุด ยกเลิกไม่ได้' };
      map = pilesFor(allPiles(local), d.rows.map(skuOfRow));
      rows = d.rows.slice().reverse().map(function (r) { return revRow(r, d.no, map); });
      chk = strictCheck(map, rows, at);
      if (chk) return { error: 'ยกเลิก ' + d.no + ' ไม่ได้ ของที่ชุดนี้รับหรือย้ายเข้าถูกใช้ไปแล้ว ' + chk.short.length + ' แถว ให้หัวหน้าปรับยอดแทน', short: chk.short };
      qty = round3(rows.reduce(function (a, r) { return a + Math.abs(r[6]); }, 0));
      names = d.names;
      ref = 'ยกเลิก ' + d.no + ' · ' + P.why;
      link = d.no;
      why = P.why;
      reply = { doc: d.no, type: d.type, status: VOID, at: st, lines: d.lines.length, reversed: no, rows: rows.length, txAt: at };
    } else if (P.op === 'bk-open') {
      var prev = (local.docs || []).filter(function (x) { return x.type === TYPE_OPEN && !vd[x.no]; });
      var others = liveDocs(local).filter(function (x) { return x.type !== TYPE_OPEN; });
      if (others.length) {
        return { error: 'มีเอกสารอื่นหลังยอดยกมาแล้ว ' + others.length + ' ชุด (' + others.slice(-5).map(function (x) { return x.no; }).join(', ') + ') ลงยอดยกมาใหม่ไม่ได้ ให้ปรับยอดแทน' };
      }
      if ((meta.rows || prev.length) && !P.replace) {
        return { error: 'มียอดยกมาแล้ว' + (prev.length ? ' (' + prev[prev.length - 1].no + ')' : '') + ' จะลงใหม่ต้องกด ลงใหม่', had: meta.rows || 0 };
      }
      rows = P.open.map(function (x) {
        var r = x.r.slice();
        r[8] = TYPE_OPEN + ' ' + no + ' · ' + (x.gr ? 'GR ' + grText(x.gr) : x.q || P.qt);
        return r;
      });
      qty = P.qty;
      names = P.names;
      rowAt = 2;
      open = { id: P.batch, no: no, seq: (+meta.seq || 0) + 1 };
      reply = { doc: no, at: st, rows: rows.length, qty: qty, replaced: prev.map(function (x) { return x.no; }) };
    } else {
      rows = P.rows;
      qty = P.qty;
      names = namesFor(rows, P.names || {});
      var skus = rows.map(skuOfRow);
      if (P.adj) P.adj.forEach(function (l) { skus.push(l.sku); });
      map = pilesFor(allPiles(local), skus);
      if (P.op === 'bk-cut') {
        var have = cutKeys(local, P.day), dup = [];
        P.lines.forEach(function (l) { if (have[l.key]) dup.push({ key: l.key, doc: have[l.key] }); });
        if (dup.length) return { error: 'มีบรรทัดออเดอร์ที่ตัดไปแล้ว ' + dup.length + ' บรรทัด', dup: dup };
      }
      if (P.op === 'bk-return') {
        var back = returnedLocal(local, retMonths(P.day, now)), over = [];
        P.lines.forEach(function (l) {
          if (!l.cut) return;
          var had = back[l.key] || 0;
          if (had + l.qty > l.cutQty + 1e-9) over.push({ key: l.key, cut: l.cutQty, back: had, qty: l.qty });
        });
        if (over.length) return { error: 'คืนเกินชิ้นที่ตัด ' + over.length + ' บรรทัด', over: over };
      }
      if (P.op === 'bk-adj') {
        if (!P.adj.length) return { error: 'ไม่มียอดที่นับ' };
        var moved = [];
        P.adj.forEach(function (l) {
          var p = map[pileKey(l.loc, l.sku, l.lot, l.po)], nowQ = p ? p.qty : 0;
          if (l.have === null || Math.abs(nowQ - l.have) > 1e-9) moved.push({ loc: l.loc, sku: l.sku, lot: l.lot, po: l.po, have: l.have, now: nowQ });
        });
        if (moved.length) return { error: 'ยอดในสมุดเปลี่ยนไปแล้ว ' + moved.length + ' กอง (มีคนลงรายการระหว่างนั้น) ดึงสต๊อกใหม่แล้วดูยอดอีกครั้ง', moved: moved.slice(0, 50) };
      }
      chk = strictCheck(map, rows, at);
      if (chk) return chk;
      if (P.lines) lines = P.lines;
      reply = P.op === 'bk-cut' || P.op === 'bk-return'
        ? { doc: no, at: st, lines: lines.length, rows: rows.length, qty: qty, book: 1, txAt: at }
        : { doc: no, at: st, rows: rows.length, qty: qty, book: 1, txAt: at };
    }

    var seq = (+meta.seq || 0) + 1;
    var newMeta = { v: V, seq: seq, month: month, next: nextNo + 1, last: P.batch, rows: rowAt - 2 + rows.length, open: open, mv: +meta.mv || 0, tv: +meta.tv || 0, at: TIME };
    if (meta.trc) newMeta.trc = meta.trc;   // ยอด TRcloud ล่าสุดที่หัวหน้านำเข้า (Rules บังคับให้คงไว้)
    /* สถานะลง TRcloud: ใส่เลขมาตอนบันทึก = ลงแล้ว · กลับรายการคิดจากชุดเดิมในเครื่อง (trStates) จึงเก็บว่าง */
    var tr = trOf(rows);
    var trState = P.op === 'bk-void' ? '' : trNeed(P.type, rows) ? (tr ? TR_DONE : TR_WAIT) : TR_NONE;
    var docData = {
      v: V, no: no, seq: seq, row: rowAt, n: rows.length, type: P.type, date: P.day, by: ctx.user.email, name: ctx.user.name,
      at: TIME, stamp: st, ref: ref, link: link, why: why, qty: qty, tr: tr, trState: trState,
      rows: enc(rows), names: encMap(names), orders: lines.length ? linesOut(lines) : '', part: 1,
    };
    var parts = splitDoc(P.batch, docData, ctx.partBytes || PART_BYTES);
    if (parts.rest.length + 1 > PARTS_MAX) {
      return { error: 'ชุดนี้ใหญ่เกินที่บันทึกได้ในครั้งเดียว (' + (parts.rest.length + 1) + ' ส่วน เกิน ' + PARTS_MAX + ') แบ่งเป็นหลายชุด' };
    }
    var writes = [['docs/' + P.batch, parts.main]];
    parts.rest.forEach(function (x) { writes.push(['docs/' + x.id, x.data]); });
    writes.push(['meta/head', newMeta]);

    var doc = docIn(P.batch, docData, []);
    if (parts.rest.length) doc.cut = cutOf(parts.main, parts.rest.map(function (x) { return x.data; }));
    doc.rows = rows.map(function (r) { return [r[0], r[1], r[2], r[3], r[4], r[5], +r[6] || 0, r[7], r[8], r[9], r[10] || '']; });
    doc.names = names;
    doc.lines = lines.map(function (l) { return { sys: l.sys, order: l.order, sku: l.sku, qty: l.qty, ref: l.ref, track: l.track, piles: l.piles, cut: l.cut || '' }; });
    reply.app = 'book';
    reply.v = API_V;
    return { writes: writes, doc: doc, meta: newMeta, reply: reply };
  }

  /**
   * แถวกลับของแถวหนึ่ง (แบบ revRow_): ขาย = ขายชิ้นติดลบ Note วันที่ขายเดิม · เบิกที่มีโลรับ (ย้าย) = ย้ายกลับ
   * เบิกโลเดียว = รับกลับเข้าโลเดิม · รับ = เบิกออกจากโลที่รับ · แถวรับกลับใช้ Status ของกองนั้นตอนนี้
   */
  function revRow(r, no, bal) {
    var note = 'ยกเลิก ' + no + (r[8] ? ' · ' + r[8] : '');
    function st(loc) { var p = bal[pileKey(loc, r[1] || r[0], r[2], r[3])]; return p && p.status === 'เปิด' ? 'เปิด' : ''; }
    if (r[7] === 'ขาย') return [r[0], r[1], r[2], r[3], r[4], '', -r[6], 'ขาย', r[8], r[9], ''];
    if (r[7] === 'เบิก' && r[5]) return [r[0], r[1], r[2], r[3], r[5], r[4], r[6], 'เบิก', note, st(r[4]), ''];
    if (r[7] === 'เบิก') return [r[0], r[1], r[2], r[3], '', r[4], r[6], 'รับ', note, st(r[4]), ''];
    return [r[0], r[1], r[2], r[3], r[5], '', r[6], 'เบิก', note, '', ''];
  }

  /**
   * แยกส่วนตามจุดตัดเดิม (doc.cut) ได้ส่วนหลักกับ ~2 ~3 ตรงกับที่เก็บในฐาน
   * ใส่เลข TRcloud ทีหลังทำให้ส่วนหลักยาวขึ้น แยกใหม่ด้วย splitDoc อาจตัดคนละบรรทัด · จำนวนบรรทัดไม่ตรง → null
   */
  function splitByCut(id, data, cut) {
    var rows = data.rows ? data.rows.split('\n') : [], orders = data.orders ? data.orders.split('\n') : [];
    var nr = 0, no = 0;
    cut.forEach(function (c) { nr += c[0]; no += c[1]; });
    if (nr !== rows.length || no !== orders.length) return null;
    var ri = 0, oi = 0;
    var chunks = cut.map(function (c) {
      var x = { rows: rows.slice(ri, ri + c[0]).join('\n'), orders: orders.slice(oi, oi + c[1]).join('\n') };
      ri += c[0]; oi += c[1];
      return x;
    });
    var main = {};
    Object.keys(data).forEach(function (k) { main[k] = data[k]; });
    main.rows = chunks[0].rows;
    main.orders = chunks[0].orders;
    main.part = chunks.length;
    var rest = chunks.slice(1).map(function (c, i) {
      return { id: id + '~' + (i + 2), data: { v: V, of: id, seq: data.seq, i: i + 2, rows: c.rows, orders: c.orders } };
    });
    return { main: main, rest: rest };
  }

  /** เอกสารใหญ่เกิน → ส่วนหลัก + {รหัสชุด}~2, ~3 (rows กับ orders ตัดตามบรรทัด) */
  function splitDoc(id, data, limit) {
    var fixed = byteLen(JSON.stringify(data)) - byteLen(data.rows) - byteLen(data.orders);
    if (fixed + byteLen(data.rows) + byteLen(data.orders) <= limit) return { main: data, rest: [] };
    var budget0 = Math.max(1000, limit - fixed), budget = Math.max(1000, limit - 200);
    var chunks = [{ rows: [], orders: [], size: 0, cap: budget0 }];
    function put(field, line) {
      var size = byteLen(line) + 1, c = chunks[chunks.length - 1];
      if (c.size + size > c.cap && (c.rows.length || c.orders.length)) { c = { rows: [], orders: [], size: 0, cap: budget }; chunks.push(c); }
      c[field].push(line);
      c.size += size;
    }
    (data.rows ? data.rows.split('\n') : []).forEach(function (l) { put('rows', l); });
    (data.orders ? data.orders.split('\n') : []).forEach(function (l) { put('orders', l); });
    var main = {};
    Object.keys(data).forEach(function (k) { main[k] = data[k]; });
    main.rows = chunks[0].rows.join('\n');
    main.orders = chunks[0].orders.join('\n');
    main.part = chunks.length;
    var rest = chunks.slice(1).map(function (c, i) {
      return { id: id + '~' + (i + 2), data: { v: V, of: id, seq: data.seq, i: i + 2, rows: c.rows.join('\n'), orders: c.orders.join('\n') } };
    });
    return { main: main, rest: rest };
  }

  /* ── คำตอบแบบ tx-fifo (แบบ readRows_ + fifo_ ของ tx-api.gs) ─────────── */

  function ymdTx(y, m, d) {
    y = +y;
    if (y < 100) y += y >= 60 ? 1957 : 2000;
    else if (y >= 2400) y -= 543;
    if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return '';
    return y + '-' + pad2(+m) + '-' + pad2(+d);
  }
  function plainDate(v) {
    var s = text(v).replace(/\s+\d{1,2}:\d{2}.*$/, '');
    var m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
    if (m) return ymdTx(m[1], m[2], m[3]);
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(s);
    if (!m) return '';
    return +m[2] > 12 ? ymdTx(m[3], m[1], m[2]) : ymdTx(m[3], m[2], m[1]);
  }
  function ownDate(note) {
    var p = plainDate(note);
    if (p) return p;
    var m = /^GR\s*(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(text(note));
    return m ? ymdTx(m[3], m[2], m[1]) : '';
  }
  /** ค่าตัวเลขล้วนเป็นตัวเลขแบบที่ book-api เขียนลงชีต (LOT 8, PO 0) */
  function sheetNum(v) { var s = text(v); return /^(0|[1-9]\d{0,14})(\.\d+)?$/.test(s) ? Number(s) : s; }

  function masterRows(m) { return m && m.rows ? dec(m.rows) : []; }

  /**
   * สำเนาในเครื่อง → คำตอบรูป tx-fifo
   * local = { meta, docs (รูป docIn เรียงตาม seq), master: { conv, sup, cap } } · now = เวลาตอนนี้ (ms)
   */
  function fifo(local, now) {
    var t = today(now);
    var out = {
      app: 'transaction', at: now, today: t, last: '', conv: 1, lot0: 1, ob: 1, fire: 1, sheet: null,
      skus: [], pos: [], locs: [], days: [], rows: [], cgr: [], cq: [],
      before: null, convert: null, cap: null, sup: null,
    };
    var idx = { sku: {}, po: {}, loc: {}, day: {} };
    function no(kind, list, k, v) {
      if (idx[kind][k] === undefined) { idx[kind][k] = list.length; list.push(v); }
      return idx[kind][k];
    }
    var near = '', last = '', names = {};
    liveDocs(local).slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (d) {
      d.rows.forEach(function (c, i) {
        var rowNo = d.row + i;
        var own = ownDate(c[8]);
        if (own) near = own;
        var long = text(c[1]);
        var name = d.names[c[1]] || d.names[c[0]] || '';
        if (long && name && !names[up(long)]) names[up(long)] = name;
        var type = text(c[7]);
        if (type === 'ขาย' && own && own <= t && own > last) last = own;
        if (!long) return;
        var lotV = sheetNum(c[2]), lot = lotV === '' ? '' : lotV;
        var po = text(sheetNum(c[3]));
        var note = plainDate(c[8]) ? '' : text(c[8]);
        var s = no('sku', out.skus, up(long), [text(c[0]), long, name]);
        if (!out.skus[s][2] && name) out.skus[s][2] = name;
        var tt = type === 'ขาย' ? 2 : type === 'เบิก' ? 1 : 0;
        var flag = (text(c[9]) === 'เปิด' ? 1 : 0) + (own && /^GR/i.test(note) ? 2 : 0) + (/stock\s*count|ยอดยกมา/i.test(note) ? 4 : 0) + (own ? 8 : 0)
          + (/แปลง/.test(note) ? 16 : 0) + (/return|คืน/i.test(note) ? 32 : 0) + (/M\/E/i.test(note) ? 64 : 0);
        var from = text(c[4]), to = text(c[5]);
        out.rows.push([
          rowNo, s, lot, no('po', out.pos, up(po), po),
          tt && from ? no('loc', out.locs, up(from), from) : -1,
          to ? no('loc', out.locs, up(to), to) : -1,
          typeof c[6] === 'number' ? c[6] : 0, tt, near ? no('day', out.days, near, near) : -1, flag,
        ]);
        var cg = flag & 4 ? /\bGR\s*(\d{1,2})-(\d{1,2})-(\d{2})\b/i.exec(note) : null;
        var cd = cg ? ymdTx(cg[3], cg[2], cg[1]) : '';
        if (cd) out.cgr.push([rowNo, cd]);
        var cq = flag & 4 && !cd ? /\bQ\s*([1-4])\s*[\/\-]\s*(\d{4}|\d{2})\b/i.exec(note) : null;
        var qd = cq ? ymdTx(cq[2], +cq[1] * 3, 1) : '';
        if (qd) {
          var run = out.cq[out.cq.length - 1];
          if (run && run[0] === qd) run[2] = rowNo;
          else out.cq.push([qd, rowNo, rowNo]);
        }
      });
    });
    out.last = last;
    var master = local.master || {};
    if (master.conv) {
      var conv = { tab: master.conv.tab || 'MASTER แปลงสินค้า', cols: master.conv.cols || ['', ''], pairs: [], blank: +master.conv.blank || 0 };
      var seenPair = {};
      masterRows(master.conv).forEach(function (r) {
        var a = up(r[0]), b = up(r[1]);
        if (!a || !b || a === b || seenPair[a + '|' + b]) return;
        seenPair[a + '|' + b] = 1;
        conv.pairs.push([a, b, names[b] || '']);
      });
      out.convert = conv;
    }
    if (master.sup) out.sup = { tab: master.sup.tab || 'PO. Truck', rows: masterRows(master.sup).map(function (r) { return [up(r[0]), text(r[1])]; }), dup: master.sup.dup || [], missing: '' };
    if (master.cap) out.cap = { tab: master.cap.tab || 'ความจุต่อพาเลท', rows: masterRows(master.cap).map(function (r) { return [up(r[0]), up(r[1]), +r[2] || 0]; }), blank: +master.cap.blank || 0, missing: '' };
    return out;
  }

  /* ── ยอดยกมาจากไฟล์นับสต๊อกใหญ่ (ชีต ยอดตั้งต้น ของ WmsStocktake.openingBook) ── */

  var OPEN_SHEET = ['SKU', 'SKU', 'Product Name', 'LOT', 'PO', 'Location เบิก', 'Location รับ', 'QTY', 'รับ/เบิก', 'Note', 'Status', 'NAME'];
  var EST_NOTE = 'ประมาณ LOT/PO จาก GR';

  /** ค่าในช่องของชีต → ข้อความ (ตัวเลข LOT 0.11 PO 9900000001 กลับเป็นข้อความเดิม) */
  function sheetText(v) {
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    return text(v);
  }
  function sheetQty(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = text(v).replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
  }

  /**
   * ชีต ยอดตั้งต้น (A–L ตาม OPEN_SHEET มีหัวตารางหรือไม่มีก็ได้) → แถว bk-open
   *   [SKU, SKU เต็ม, ชื่อ, LOT, PO, โล, ชิ้น, Status, วันรับ yyyy-mm-dd, ไตรมาส Qn/yy]
   * วันรับจาก "GR dd-mm-yy" ใน Note · ไตรมาสจาก "Qn/yy" ใน Note · LOT / PO ว่าง = 0 (ไม่รู้) · กองเดียวกันหลายแถวรวมเป็นแถวเดียว
   * ชิ้น 0 ข้าม · ไม่มี SKU ไม่มีโล ชิ้นติดลบ ไม่ใช่แถวรับ = แถวผิด (ลงไม่ได้จนกว่าจะแก้ไฟล์)
   * @returns {{rows, bad: [{n, sku, loc, why}], tot}} หรือ {error}
   */
  function openingFromSheet(grid) {
    grid = Array.isArray(grid) ? grid : [];
    var at = -1;
    for (var i = 0; i < Math.min(grid.length, 30); i++) {
      var h = (grid[i] || []).map(text);
      if (h.indexOf('Location รับ') >= 0 && h.indexOf('QTY') >= 0) { at = i; break; }
    }
    var col = { sku: 0, long: 1, name: 2, lot: 3, po: 4, from: 5, to: 6, qty: 7, kind: 8, note: 9, st: 10 };
    if (at >= 0) {
      var hd = grid[at].map(text), s1 = hd.indexOf('SKU'), s2 = s1 >= 0 ? hd.indexOf('SKU', s1 + 1) : -1;
      col = { sku: s1, long: s2, name: hd.indexOf('Product Name'), lot: hd.indexOf('LOT'), po: hd.indexOf('PO'), from: hd.indexOf('Location เบิก'),
        to: hd.indexOf('Location รับ'), qty: hd.indexOf('QTY'), kind: hd.indexOf('รับ/เบิก'), note: hd.indexOf('Note'), st: hd.indexOf('Status') };
      if (col.sku < 0 || col.lot < 0 || col.po < 0) return { error: 'หัวตารางไม่ครบ ต้องมี SKU LOT PO Location รับ QTY แบบชีต ยอดตั้งต้น' };
    } else {
      var first = grid.filter(function (r) { return r && r.some(function (v) { return text(v) !== ''; }); })[0] || [];
      if (first.length < 8 || sheetQty(first[7]) === null || !text(first[6])) {
        return { error: 'ไม่ใช่ชีต ยอดตั้งต้น (ต้องมีคอลัมน์ A–L แบบไฟล์ตั้งต้นสมุดจากหน้านับสต๊อกใหญ่)' };
      }
    }
    function get(r, k) { return col[k] >= 0 ? r[col[k]] : ''; }
    var rows = [], bad = [], by = {}, skus = {}, locs = {}, openLocs = {};
    var tot = { piles: 0, qty: 0, skus: 0, locs: 0, open: 0, noGr: 0, est: 0, zero: 0, merged: 0, skipped: 0 };
    for (var j = at + 1; j < grid.length; j++) {
      var r = grid[j] || [];
      if (!r.some(function (v) { return text(v) !== ''; })) continue;
      var n = j + 1;
      var sku = code(get(r, 'sku'), 60), long = code(get(r, 'long'), 60), loc = code(get(r, 'to'), 40), qty = sheetQty(get(r, 'qty'));
      var kind = text(get(r, 'kind')), from = text(get(r, 'from'));
      var why = !sku && !long ? 'ไม่มี SKU' : !loc ? 'ไม่มี Location รับ' : qty === null ? 'QTY ไม่ใช่ตัวเลข' : qty < 0 ? 'QTY ติดลบ'
        : (kind && kind !== 'รับ') || from ? 'ไม่ใช่แถวรับ (ยอดตั้งต้นต้องเป็นแถวรับเข้าโลเท่านั้น)' : '';
      if (why) { bad.push({ n: n, sku: sku || long, loc: loc, why: why }); continue; }
      if (!qty) { tot.skipped++; continue; }
      var lot = code(sheetText(get(r, 'lot')), 20), po = code(sheetText(get(r, 'po')), 40);
      if (lot === '' || po === '') { tot.zero++; if (lot === '') lot = '0'; if (po === '') po = '0'; }
      var note = text(get(r, 'note')), gr = grDay(note), qm = /\bQ([1-4])\/(\d{2})\b/.exec(note);
      var st = text(get(r, 'st')) === 'เปิด' ? 'เปิด' : '';
      if (note.indexOf(EST_NOTE) >= 0) tot.est++;
      var k = pileKey(loc, long || sku, lot, po);
      if (by[k]) {
        var p = by[k];
        p[6] = round3(p[6] + qty);
        if (st) p[7] = 'เปิด';
        if (gr && (!p[8] || gr < p[8])) p[8] = gr;
        tot.merged++;
      } else {
        by[k] = [sku || long, long, plain(get(r, 'name'), 120), lot, po, loc, qty, st, gr, qm ? 'Q' + qm[1] + '/' + qm[2] : ''];
        rows.push(by[k]);
      }
      skus[long || sku] = 1;
      locs[loc] = 1;
      if (st) openLocs[loc] = 1;
    }
    rows.forEach(function (x) { tot.qty = round3(tot.qty + x[6]); if (!x[8]) tot.noGr++; });
    tot.piles = rows.length;
    tot.skus = Object.keys(skus).length;
    tot.locs = Object.keys(locs).length;
    tot.open = Object.keys(openLocs).length;
    if (!rows.length && !bad.length) return { error: 'ไม่มีแถวยอดในชีตนี้' };
    if (rows.length > OPEN_MAX) return { error: 'ยอดยกมาต้องมี 1–' + OPEN_MAX + ' กอง (ไฟล์นี้ ' + rows.length + ' กอง)' };
    return { rows: rows, bad: bad, tot: tot };
  }

  /* ── วันของโควตาฟรี: Firebase รีเซ็ตเที่ยงคืนเวลาแปซิฟิก (ไทยประมาณ 14:00–15:00) ── */

  var PT_FMT = null;
  /** 'yyyy-mm-dd' ตามเวลาแปซิฟิก (มีเวลาออมแสง) */
  function pacificDay(now) {
    try {
      PT_FMT = PT_FMT || new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
      var o = {};
      PT_FMT.formatToParts(new Date(now)).forEach(function (p) { o[p.type] = p.value; });
      return o.year + '-' + o.month + '-' + o.day;
    } catch (e) {
      var d = new Date(now - 8 * 3600000);
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }
  }
  /** เวลา (ms) ที่โควตารีเซ็ตรอบถัดไป ละเอียดระดับนาที */
  function pacificReset(now) {
    var day = pacificDay(now), t = now;
    for (var h = 0; h < 26 && pacificDay(t + 3600000) === day; h++) t += 3600000;
    for (var m = 0; m < 61 && pacificDay(t) === day; m++) t += 60000;
    return t - (t % 60000);
  }

  window.WmsFireCore = {
    splitByCut: splitByCut, cutOf: cutOf,
    V: V, API_V: API_V, PART_BYTES: PART_BYTES, PARTS_MAX: PARTS_MAX, TIME: TIME, OPS: OPS,
    ROLE_HEAD: ROLE_HEAD, ROLE_USER: ROLE_USER, ROLE_VIEW: ROLE_VIEW, VOID: VOID,
    HEAD_TYPES: HEAD_TYPES, STAFF_TYPES: STAFF_TYPES, TYPE_OPEN: TYPE_OPEN, TYPE_REV: TYPE_REV, TYPE_SALE: TYPE_SALE, TYPE_RET: TYPE_RET,
    TYPE_MOVE: TYPE_MOVE, TYPE_GR: TYPE_GR, TYPE_CONV: TYPE_CONV, TYPE_ADJ: TYPE_ADJ, TYPE_ROWS: TYPE_ROWS,
    TR_WAIT: TR_WAIT, TR_DONE: TR_DONE, TR_NONE: TR_NONE, TR_STATES: TR_STATES, WH_MAIN: WH_MAIN, WH_QA: WH_QA,
    whOf: whOf, whLines: whLines, trNeed: trNeed, docOut: docOut, round3: round3, code: code, dayNo: dayNo, grDay: grDay,
    text: text, up: up, today: today, stamp: stamp, yymm: yymm, monthsOk: monthsOk, MONTH_TOL: MONTH_TOL, period: period, prevYm: prevYm, monthsBack: monthsBack,
    byteLen: byteLen, enc: enc, dec: dec, encMap: encMap, decMap: decMap, rowsIn: rowsIn, linesOut: linesOut,
    pileKey: pileKey, applyRows: applyRows, applyDoc: applyDoc, pilesFor: pilesFor,
    prep: prep, retMonths: retMonths, plan: plan, splitDoc: splitDoc, revRow: revRow,
    docIn: docIn, voids: voids, liveDocs: liveDocs, cutKeys: cutKeys, returnedLocal: returnedLocal,
    seen: seen, find: find, recent: recent, stock: stock, state: state, rebuild: rebuild, pilesFromDocs: pilesFromDocs, fifo: fifo, allPiles: allPiles,
    ownDate: ownDate, plainDate: plainDate, sheetNum: sheetNum,
    OPEN_SHEET: OPEN_SHEET, OPEN_MAX: OPEN_MAX, openingFromSheet: openingFromSheet, pacificDay: pacificDay, pacificReset: pacificReset, plain: plain,
  };
})();
