/**
 * @file wms-mfg.js — เช็คความเสี่ยง MFG: นับของบีบสูญญากาศที่ LOT เก่า แล้วทำรายงานให้เจ้านายตัดสินใจแกะกาง
 *
 * ผู้ใช้ขอ 2026-11-16: ที่นอน ท็อปเปอร์ หมอน บีบสูญญากาศ ต้องเช็คทุกเดือน เป็นเมนูที่นับเองแบบนับสต๊อกใหญ่
 *   - นับเฉพาะ SKU บีบสูญญากาศ ไม่นับทุก SKU
 *   - นับเฉพาะ LOT ตั้งแต่เดือนนี้ลบ 3 ลงไป (พ.ย. นับ LOT 8 ลงไป) LOT ใหม่กว่านั้นไม่นับ ทุกประเภทใช้เกณฑ์เดียวกัน
 *   - รอบ พ.ย.: LOT 6 เฝ้าระวัง, LOT 4–5 เสี่ยง → อายุ 5 เดือน = เฝ้าระวัง, 6 เดือนขึ้นไป = เสี่ยง, 3–4 เดือน = ปกติ
 *   - LOT 0 (ไม่รู้ LOT) ไปนับด้วย ดู LOT จากป้ายจริง ไม่มีป้ายกรอก 0 → กลุ่ม NO LOT ต้องตรวจสอบ
 *   - รายงานหน้าตาเดียวกับที่ทีมทำอยู่: SKU · Product Name · Type · NO LOT · Lot … · Total MFG (แถวหัวเป็นปี)
 *
 * ใช้เครื่องนับของนับสต๊อกใหญ่ทั้งชุด (apps-script/stocktake-api.gs กับหน้า stocktake/count.html) รอบ MFG คือรอบนับธรรมดา
 * ที่ยอดตั้งต้น รายการโล และรายชื่อ SKU ถูกตัดเหลือเฉพาะของที่ต้องนับ ค่าตั้งของรอบมี kind: 'mfg' ไว้แยกจากรอบนับใหญ่
 * สคริปต์ไม่ต้องแก้ ยอดในสมุดไม่ไปถึงเครื่องคนนับเหมือนเดิม
 *
 * LOT คือเดือนของสินค้า กติกาเดียวกับหน้า FIFO สต๊อก (WmsFifo.lotMonth) LOT 0.11 / 0.12 = ปีก่อน
 * อายุเป็นวันนับจากวันที่ 1 ของเดือนที่เป็น LOT (LOT บอกแค่เดือน นับจากต้นเดือนให้อายุออกมามากไว้ก่อน)
 *
 * ไฟล์นี้ไม่ยิงเน็ตและไม่แตะ localStorage มีแต่การคิด
 * โหลดเป็น classic script ต่อจาก wms-fifo.js กับ wms-stocktake.js เปิดเป็น window.WmsMfg
 */
(function (window) {
  'use strict';

  var CUT = 3;     // นับ LOT ที่อายุตั้งแต่ 3 เดือน (พ.ย. → LOT 8 ลงไป)
  var WATCH = 5;   // อายุ 5 เดือน = เฝ้าระวัง (พ.ย. → LOT 6)
  var RISK = 6;    // อายุ 6 เดือนขึ้นไป = เสี่ยง (พ.ย. → LOT 5 ลงไป)

  /* ลำดับความเสี่ยง เรียงแถวและชิปตามนี้ */
  var STATUS = {
    risk: { label: 'เสี่ยง', rank: 0 },
    watch: { label: 'เฝ้าระวัง', rank: 1 },
    nolot: { label: 'ต้องตรวจสอบ', rank: 2 },
    ok: { label: 'ปกติ', rank: 3 },
    none: { label: 'ไม่พบของ', rank: 4 },
    wait: { label: 'ยังไม่นับ', rank: 5 },
  };
  var ORDER = ['risk', 'watch', 'nolot', 'ok', 'none', 'wait'];

  /* ประเภทชื่อเดียวกับรายงานของทีม เก็บในค่าตั้งของรอบเป็นตัวอักษรเดียว (ค่าตั้งยาวได้ไม่เกิน 30,000 ตัว) */
  var TYPES = ['Mattress', 'Topper', 'Pillow & Bolster', 'Pet Bed'];
  var CODE = { M: 'Mattress', T: 'Topper', P: 'Pillow & Bolster', B: 'Pet Bed' };
  var NOLOT = 'N';   // คีย์คอลัมน์ NO LOT

  function F() { return window.WmsFifo; }
  function S() { return window.WmsStocktake; }
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function up(v) { return text(v).toUpperCase(); }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function pad(n) { return ('0' + n).slice(-2); }

  /* ── ประเภทสินค้า ──────────────────────────────────────────────────── */

  /**
   * ประเภทจากชื่อสินค้า '' = ไม่ใช่ของบีบสูญญากาศ
   * ชื่อที่ขึ้นต้นด้วย ผ้า ชุด ปลอก คือของที่ใช้กับที่นอน/หมอน ไม่ใช่ตัวมันเอง (กติกาเดียวกับหน้าจัดที่เก็บ)
   * ของแถม (ชื่อขึ้นต้น แถม หรือ SKU FRE) ไม่เดาให้ ถ้าบีบสูญญากาศด้วย วางรายชื่อเพิ่มเอง
   */
  function typeOf(name, sku) {
    var n = text(name), u = n.toUpperCase();
    if (/^แถม/.test(n) || /^FRE/.test(up(sku))) return '';
    if (/^(ผ้า|ชุด|ปลอก)/.test(n)) return '';
    if (/ท็อปเปอร์|ท๊อปเปอร์|ทอปเปอร์|TOPPER/.test(u)) return 'Topper';
    if (/สัตว์เลี้ยง|PET\s*BED/.test(u)) return 'Pet Bed';
    if (/ที่นอน|MATTRESS/.test(u)) return 'Mattress';
    if (/หมอน|PILLOW|BOLSTER/.test(u)) return 'Pillow & Bolster';
    return '';
  }

  /** ชื่อประเภทที่คนพิมพ์ / วางมา → ชื่อมาตรฐาน คำที่ไม่รู้จักคืนตามเดิม (ไม่เกิน 30 ตัว) */
  function canonType(t) {
    var s = text(t), u = s.toUpperCase();
    if (!s) return '';
    if (/TOPPER|ท็อปเปอร์|ท๊อปเปอร์/.test(u)) return 'Topper';
    if (/PET|สัตว์/.test(u)) return 'Pet Bed';
    if (/MATTRESS|ที่นอน/.test(u)) return 'Mattress';
    if (/PILLOW|BOLSTER|หมอน/.test(u)) return 'Pillow & Bolster';
    return s.slice(0, 30);
  }

  function typeCode(t) {
    for (var k in CODE) if (CODE[k] === t) return k;
    return t;
  }
  function typeName(c) { return CODE[c] || text(c); }

  /* ── รายชื่อ SKU บีบสูญญากาศ ─────────────────────────────────────────── */

  /** เดาจากชื่อสินค้าในสมุด skus = [[SKU, SKU เต็ม, ชื่อ]] → [[SKU เต็ม, ประเภท]] */
  function guessList(skus) {
    var out = [], seen = {};
    (skus || []).forEach(function (s) {
      if (!s) return;
      var long = up(s[1] || s[0]);
      var t = typeOf(s[2], s[0]);
      if (!long || !t || seen[long]) return;
      seen[long] = 1;
      out.push([long, t]);
    });
    return out;
  }

  /**
   * รายชื่อที่วางมาจากชีตของทีม (คัดลอกจาก Google Sheet ได้ทั้งตาราง)
   * มีหัวตาราง: หาคอลัมน์ SKU, Type (หรือ ประเภท) และชื่อสินค้า ไม่มีหัว: ช่องแรกที่เป็นรหัสคือ SKU ช่องที่เป็นชื่อประเภทคือ Type
   * ไม่มี Type เดาจากชื่อสินค้า เดาไม่ได้ใส่ว่าง (หน้าเว็บให้เลือกเอง) แถว Total / หัวซ้ำ / SKU ว่าง ข้าม
   * @returns {{rows: Array<[string,string]>, skip: number, head: boolean}}
   */
  function parseList(raw) {
    var lines = String(raw || '').replace(/\r/g, '').split('\n').map(function (l) { return l.split('\t'); })
      .filter(function (c) { return c.some(function (x) { return text(x); }); });
    var col = { sku: -1, type: -1, name: -1 }, head = false, start = 0;
    for (var i = 0; i < Math.min(lines.length, 5) && !head; i++) {
      var c = lines[i].map(function (x) { return text(x); });
      var sku = -1, type = -1, name = -1;
      c.forEach(function (x, j) {
        if (sku < 0 && /^(sku|รหัส(สินค้า)?|product\s*id|item\s*code)$/i.test(x)) sku = j;
        else if (type < 0 && /^(type|ประเภท|หมวด)/i.test(x)) type = j;
        else if (name < 0 && /name|ชื่อ/i.test(x)) name = j;
      });
      if (sku >= 0) { col = { sku: sku, type: type, name: name }; head = true; start = i + 1; }
    }
    var CODE_RE = /^[A-Z]{2,}[A-Z0-9-]*\d{3,}$/;
    var rows = [], skip = 0, seen = {};
    lines.slice(start).forEach(function (c) {
      var cells = c.map(function (x) { return text(x); });
      var sku = '', t = '', nm = '';
      if (head) {
        sku = up(cells[col.sku]);
        t = col.type >= 0 ? canonType(cells[col.type]) : '';
        nm = col.name >= 0 ? cells[col.name] : '';
      } else {
        for (var j = 0; j < cells.length && !sku; j++) if (CODE_RE.test(up(cells[j]))) sku = up(cells[j]);
        cells.forEach(function (x) {
          var k = canonType(x);
          if (!t && TYPES.indexOf(k) !== -1 && x.length <= 30) t = k;
          if (!nm && x.length > 12 && !CODE_RE.test(up(x))) nm = x;
        });
      }
      if (!sku || !CODE_RE.test(sku) || seen[sku]) { skip++; return; }
      seen[sku] = 1;
      rows.push([sku, t || typeOf(nm, sku)]);
    });
    return { rows: rows, skip: skip, head: head };
  }

  /** เก็บในค่าตั้งของรอบ [[SKU เต็ม, รหัสประเภท]] กับกลับเป็นชื่อประเภท */
  function packList(list) { return (list || []).map(function (r) { return [up(r[0]), typeCode(r[1] || '')]; }); }
  function unpackList(v) {
    return (Array.isArray(v) ? v : []).filter(function (r) { return Array.isArray(r) && text(r[0]); })
      .map(function (r) { return [up(r[0]), typeName(r[1])]; });
  }

  /* ── เดือน LOT ตัด และสถานะ ─────────────────────────────────────────── */

  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function refKey(ym) { return +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1; }
  function ofKey(k) { return { key: k, y: Math.floor(k / 12), m: k % 12 + 1 }; }
  /** ป้ายเดือนสั้น ปี พ.ศ. สองหลัก เช่น ส.ค. 69 */
  function monthText(lm) { return lm ? MONTHS[lm.m - 1] + ' ' + String(lm.y + 543).slice(-2) : ''; }
  /** เดือนของรอบ (yyyy-mm) เป็นข้อความ เช่น พ.ย. 69 */
  function ymText(ym) { return monthText(ofKey(refKey(ym))); }

  /**
   * เกณฑ์ของรอบเดือน ym
   *   cut   = เดือน LOT ที่ใหม่ที่สุดที่ยังต้องนับ (เดือนนี้ลบ 3)
   *   watch = เดือนที่เฝ้าระวัง (เดือนนี้ลบ 5)
   *   risk  = เดือนที่เสี่ยง (เดือนนี้ลบ 6 ลงไป)
   */
  function rule(ym) {
    var r = refKey(ym);
    var cut = ofKey(r - CUT), watch = ofKey(r - WATCH), risk = ofKey(r - RISK);
    return {
      ym: ym, cut: cut, watch: watch, risk: risk,
      text: 'นับ LOT ' + cut.m + ' ลงไป',
      okText: 'LOT ' + ofKey(r - WATCH + 1).m + (WATCH - 1 > CUT ? '–' + cut.m : ''),
      watchText: 'LOT ' + watch.m,
      riskText: 'LOT ' + risk.m + ' ลงไป',
    };
  }

  /** ชื่อรอบที่คนนับเห็นบนหน้ากรอก ต้องบอกว่านับ LOT ไหนลงไป หน้ากรอกไม่มีที่อื่นบอก */
  function roundName(ym) { return 'MFG ' + ymText(ym) + ' · ' + rule(ym).text; }

  /** LOT ว่าง หรือ 0 = ไม่รู้ LOT (นิยามเดียวกับรายงาน LOT / PO) */
  function noLot(v) { var s = text(v); return s === '' || /^0*(\.0*)?$/.test(s); }

  /**
   * สถานะของ LOT ในรอบเดือน ym
   *   risk / watch / ok = ต้องนับ   new = ใหม่กว่า LOT ตัด ไม่นับ   nolot = ไม่รู้ LOT หรือเลข LOT อ่านไม่ออก
   */
  function statusOf(lot, ym) {
    if (noLot(lot)) return { st: 'nolot', lm: null, bad: false };
    var lm = F().lotMonth(up(lot), ym);
    if (!lm) return { st: 'nolot', lm: null, bad: true };
    var age = refKey(ym) - lm.key;
    var st = age >= RISK ? 'risk' : age >= WATCH ? 'watch' : age >= CUT ? 'ok' : 'new';
    return { st: st, lm: lm, bad: false, months: age };
  }

  /** อายุเป็นวันนับจากวันที่ 1 ของเดือน LOT ถึง today (yyyy-mm-dd) */
  function ageDays(lm, today) {
    if (!lm || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return null;
    var a = Date.UTC(lm.y, lm.m - 1, 1);
    var b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  /* ── ของที่ต้องนับ ──────────────────────────────────────────────────── */

  /** SKU เต็ม → แถว [SKU, SKU เต็ม, ชื่อ] ค้นได้ทั้งรหัสสั้นและรหัสเต็ม */
  function skuIndex(skus) {
    var by = {};
    (skus || []).forEach(function (s) {
      if (!s) return;
      var long = up(s[1] || s[0]);
      if (!long) return;
      by[long] = s;
      if (text(s[0]) && !by[up(s[0])]) by[up(s[0])] = s;
    });
    return by;
  }

  /* ── สมุดที่ใช้ตั้งรอบ ─────────────────────────────────────────────── */

  /**
   * คำตอบ tx-fifo ใช้ตั้งรอบได้ไหม ใช้ได้คืน '' ไม่ได้คืนข้อความที่หัวหน้าอ่านรู้เรื่อง
   * สมุด 0 แถว = สคริปต์เปิดแท็บสมุดเจอแค่หัวตาราง (เช่นสูตรดึงข้อมูลในไฟล์สำเนา error)
   * ต้องหยุดตรงนี้ ไม่งั้นหน้าจะขึ้น 0 SKU เฉย ๆ และยอดตั้งต้นจะเป็นศูนย์ทั้งรอบ
   */
  function ledgerProblem(data) {
    if (!data) return 'ไม่ได้คำตอบจากสคริปต์ Transaction';
    if (data.error) return 'สมุด Transaction: ' + data.error;
    if (data.app !== 'transaction' || !data.rows) return 'URL Transaction ไม่ได้ตอบสมุดมา ตรวจในหน้าตั้งค่า';
    if (!data.rows.length) return 'สคริปต์อ่านแท็บสมุดได้ 0 แถว — แท็บ Transaction ในไฟล์ที่สคริปต์อ่านว่าง หรือสูตรดึงข้อมูลในไฟล์นั้น error อยู่';
    return '';
  }

  /** เวลาของสมุดชุดนี้ ชุดกลางใช้เวลาที่เก็บไว้ อ่านสดใช้เวลาที่สคริปต์คิด */
  function ledgerTime(data) {
    return (data && ((data.shared && data.shared.at) || data.at)) || 0;
  }

  /** ลิงก์ไปแท็บสมุดที่สคริปต์อ่าน ไม่รู้คืน '' */
  function ledgerLink(data) {
    var s = data && data.sheet;
    if (!s || !/^https:\/\//.test(String(s.url || ''))) return '';
    return s.url + (s.gid != null ? '#gid=' + s.gid : '');
  }

  /** รายชื่อ → { SKU เต็ม: ประเภท } ใช้ SKU เต็มของสมุดเมื่อคนวางรหัสสั้นมา */
  function listMap(list, skus) {
    var idx = skuIndex(skus), m = {};
    (list || []).forEach(function (r) {
      var k = up(r[0]);
      if (!k) return;
      var s = idx[k];
      m[s ? up(s[1] || s[0]) : k] = r[1] || '';
    });
    return m;
  }

  /**
   * ตัดยอดตั้งต้นทั้งคลัง (WmsStocktake.baseline) ให้เหลือของที่รอบ MFG ต้องนับ
   *   กอง = SKU อยู่ในรายชื่อ ยอดมากกว่า 0 และ LOT ไม่ใหม่กว่า LOT ตัด (รวม LOT 0 ไปดูป้ายจริง)
   *   โล  = เฉพาะโลที่มีกองพวกนี้ คนนับไม่ต้องเดินทั้งคลัง
   *   SKU = รายชื่อบีบสูญญากาศเท่านั้น ช่องพิมพ์บนหน้ากรอกจะเสนอแค่ของที่ต้องนับ
   *   PO  = เฉพาะ PO ที่เคยรับ SKU ในรายชื่อ (หน้ากรอกใช้เตือน PO / LOT ไม่เข้ากัน)
   * @returns {{piles, skus, pos, locs, missing, totals}}
   */
  function scope(base, list, ym) {
    var b = base || {};
    var want = listMap(list, b.skus);
    var piles = (b.piles || []).filter(function (p) {
      if (!(+p[6] > 0)) return false;
      if (want[up(p[2])] === undefined) return false;
      return statusOf(p[4], ym).st !== 'new';
    });
    var skus = (b.skus || []).filter(function (s) { return want[up(s[1] || s[0])] !== undefined; });
    var have = {};
    skus.forEach(function (s) { have[up(s[1] || s[0])] = 1; });
    var pos = (b.pos || []).filter(function (p) { return (p[2] || []).some(function (k) { return have[up(k)]; }); });
    var count = {};
    piles.forEach(function (p) { count[up(p[0])] = (count[up(p[0])] || 0) + 1; });
    var st = S();
    var locs = Object.keys(count).map(function (l) {
      var x = st.parseLoc(l);
      return { loc: l, zone: x.zone, group: x.group, piles: count[l], src: 'สมุด' };
    }).sort(function (a, c) { return st.locCmp(a.loc, c.loc); });
    var totals = { piles: piles.length, locs: locs.length, qty: 0, skus: 0, by: {} };
    var seen = {};
    piles.forEach(function (p) {
      var s = statusOf(p[4], ym).st;
      var t = totals.by[s] || (totals.by[s] = { qty: 0, piles: 0 });
      t.qty = round3(t.qty + p[6]);
      t.piles++;
      totals.qty = round3(totals.qty + p[6]);
      if (!seen[up(p[2])]) { seen[up(p[2])] = 1; totals.skus++; }
    });
    var missing = Object.keys(want).filter(function (k) { return !have[k]; });
    return { piles: piles, skus: skus, pos: pos, locs: locs, missing: missing, totals: totals };
  }

  /**
   * ทีมนับของรอบ MFG: แบ่งแถวให้ n ทีมแบบติดกันตามทางเดิน (กติกาเดียวกับนับสต๊อกใหญ่)
   * @returns {Array<{id, kind, name, members, zones, locs}>}
   */
  function teams(locs, n) {
    var st = S();
    var k = Math.max(1, Math.min(9, +n || 1));
    var ids = [];
    for (var i = 1; i <= k; i++) ids.push('MFG' + i);
    var gl = st.groups(locs || []);
    var split = st.autoSplit(gl, ids);
    return ids.map(function (id, i) {
      var zones = gl.filter(function (g) { return split[g.group] === id; });
      return {
        id: id, kind: 'Inventory', name: k === 1 ? 'ทีม MFG' : 'ทีม MFG ' + (i + 1), members: [],
        zones: zones.map(function (g) { return g.group; }),
        locs: zones.reduce(function (a, g) { return a + g.n; }, 0),
      };
    }).filter(function (t) { return t.zones.length || k === 1; });
  }

  /* ── รายงาน ─────────────────────────────────────────────────────────── */

  /**
   * ตารางรายงานราย SKU × LOT แบบที่ทีมทำส่งเจ้านาย
   *   input = { ym, today, list, skus, book, entries, mode, locs }
   *     book    = ยอดตั้งต้นของรอบ [[Location, SKU, SKU เต็ม, ชื่อ, LOT, PO, ยอด, เปิดขาย]] (ตัดแล้ว)
   *     entries = แถวบันทึกนับ (WmsStocktake.fromRow) ทั้งหมด ยังไม่ตัดแถวที่ถูกแทน
   *     mode    = 'count' ตัวเลขจากที่นับได้ | 'book' ตัวเลขจากสมุด
   *     locs    = โลของรอบ ใช้บอกว่านับครบหรือยัง
   *   ช่องของ SKU × LOT เก็บทั้งยอดสมุดและยอดนับ ราย Location ⓘ ของหน้าเว็บเอาไปโชว์
   * @returns {{cols, rows, totals, by, ignored, done, total, mode}}
   */
  function report(input) {
    var o = input || {};
    var ym = o.ym, mode = o.mode === 'book' ? 'book' : 'count';
    var want = listMap(o.list, o.skus);
    var idx = skuIndex(o.skus);
    var st = S();
    var eff = st.effective(o.entries || []);
    var done = {};
    eff.forEach(function (e) { done[up(e.loc)] = 1; });

    var cells = {}, cols = {}, names = {};
    function cell(long, key, lm, loc) {
      var r = cells[long] || (cells[long] = {});
      var c = r[key] || (r[key] = { book: 0, count: 0, locs: {}, raw: {} });
      if (!cols[key]) cols[key] = lm || null;
      var l = c.locs[loc] || (c.locs[loc] = { book: 0, count: 0 });
      return { c: c, l: l };
    }
    (o.book || []).forEach(function (p) {
      var long = up(p[2]);
      if (want[long] === undefined) return;
      var s = statusOf(p[4], ym);
      if (s.st === 'new') return;
      if (p[3] && !names[long]) names[long] = text(p[3]);
      var x = cell(long, s.lm ? String(s.lm.key) : NOLOT, s.lm, up(p[0]));
      x.c.book = round3(x.c.book + (+p[6] || 0));
      x.l.book = round3(x.l.book + (+p[6] || 0));
    });
    var ignored = { newer: [], other: [] };
    eff.forEach(function (e) {
      if (e.type !== 'นับ' || !(+e.qty)) return;
      var s0 = idx[up(e.long)] || idx[up(e.sku)];
      var long = s0 ? up(s0[1] || s0[0]) : up(e.long || e.sku);
      var item = { loc: up(e.loc), sku: text(e.sku || e.long), lot: text(e.lot), qty: +e.qty, who: text(e.who) };
      if (want[long] === undefined) { ignored.other.push(item); return; }
      var s = statusOf(e.lot, ym);
      if (s.st === 'new') { ignored.newer.push(item); return; }
      var x = cell(long, s.lm ? String(s.lm.key) : NOLOT, s.lm, up(e.loc));
      x.c.count = round3(x.c.count + (+e.qty));
      x.l.count = round3(x.l.count + (+e.qty));
      if (s.bad) x.c.raw[text(e.lot)] = 1;
    });

    /* คอลัมน์: NO LOT ก่อน แล้วเดือน LOT เก่าไปใหม่ ใช้ชุดเดียวกันทั้งโหมดสมุดและโหมดนับ สลับโหมดแล้วตารางไม่ขยับ */
    var colList = Object.keys(cols).sort(function (a, b) {
      if (a === NOLOT) return -1;
      if (b === NOLOT) return 1;
      return +a - +b;
    }).map(function (k) {
      if (k === NOLOT) return { key: k, label: 'NO LOT', st: 'nolot', y: null, m: null, age: null };
      var lm = cols[k];
      return { key: k, label: 'Lot ' + lm.m, st: statusByKey(lm, ym), y: lm.y, m: lm.m, age: ageDays(lm, o.today), month: monthText(lm) };
    });

    var locSet = {};
    (o.locs || []).forEach(function (l) { locSet[up(Array.isArray(l) ? l[0] : l.loc)] = 1; });

    var rows = Object.keys(cells).map(function (long) {
      var s = idx[long] || [];
      var c = cells[long];
      var tot = { book: 0, count: 0 };
      var where = {};
      Object.keys(c).forEach(function (k) {
        tot.book = round3(tot.book + c[k].book);
        tot.count = round3(tot.count + c[k].count);
        Object.keys(c[k].locs).forEach(function (l) { where[l] = 1; });
      });
      var locs = Object.keys(where);
      var left = locs.filter(function (l) { return !done[l]; });
      var row = {
        sku: s[1] ? text(s[1]) : long, short: text(s[0]), name: text(s[2]) || names[long] || '', type: want[long] || '',
        cells: c, total: tot, locs: locs.sort(st.locCmp), left: left.sort(st.locCmp),
      };
      row.st = rowStatus(row, colList, mode);
      return row;
    });
    rows.sort(function (a, b) {
      return STATUS[a.st].rank - STATUS[b.st].rank || worstKey(a, colList, mode) - worstKey(b, colList, mode) ||
        qtyOf(b, mode) - qtyOf(a, mode) || S().natCmp(a.sku, b.sku);
    });

    var totals = { book: 0, count: 0, cols: {} };
    colList.forEach(function (col) { totals.cols[col.key] = { book: 0, count: 0 }; });
    rows.forEach(function (r) {
      totals.book = round3(totals.book + r.total.book);
      totals.count = round3(totals.count + r.total.count);
      colList.forEach(function (col) {
        var x = r.cells[col.key];
        if (!x) return;
        totals.cols[col.key].book = round3(totals.cols[col.key].book + x.book);
        totals.cols[col.key].count = round3(totals.cols[col.key].count + x.count);
      });
    });

    /* ชิปสรุป: ชิ้นของแต่ละสถานะ (ตามโหมด) กับจำนวน SKU ที่มีของสถานะนั้น */
    var by = {};
    ORDER.forEach(function (k) { by[k] = { qty: 0, skus: 0 }; });
    rows.forEach(function (r) {
      var hit = {};
      colList.forEach(function (col) {
        var x = r.cells[col.key];
        var q = x ? x[mode] : 0;
        if (q > 0) { by[col.st].qty = round3(by[col.st].qty + q); hit[col.st] = 1; }
      });
      Object.keys(hit).forEach(function (k) { by[k].skus++; });
      if (r.st === 'none' || r.st === 'wait') by[r.st].skus++;
    });

    var total = Object.keys(locSet).length;
    var doneN = Object.keys(locSet).filter(function (l) { return done[l]; }).length;
    return { mode: mode, cols: colList, rows: rows, totals: totals, by: by, ignored: ignored, done: doneN, total: total, rule: rule(ym) };
  }

  function statusByKey(lm, ym) {
    var age = refKey(ym) - lm.key;
    return age >= RISK ? 'risk' : age >= WATCH ? 'watch' : age >= CUT ? 'ok' : 'new';
  }

  function qtyOf(r, mode) { return r.total[mode] || 0; }

  /** สถานะของแถว = สถานะที่แย่ที่สุดที่ยังมีของ · โหมดนับ: ไม่เจอของเลย = ไม่พบของ (โลนับครบแล้ว) หรือยังไม่นับ */
  function rowStatus(r, cols, mode) {
    var best = '';
    cols.forEach(function (col) {
      var x = r.cells[col.key];
      if (!x || !(x[mode] > 0)) return;
      if (!best || STATUS[col.st].rank < STATUS[best].rank) best = col.st;
    });
    if (best) return best;
    if (mode === 'count') return r.left.length ? 'wait' : 'none';
    return 'ok';
  }

  /** คีย์เดือนของ LOT ที่เก่าที่สุดที่ยังมีของ (NO LOT ไม่นับ) ใช้เรียงในสถานะเดียวกัน */
  function worstKey(r, cols, mode) {
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i], x = r.cells[col.key];
      if (col.key !== NOLOT && x && x[mode] > 0) return +col.key;
    }
    return 1e9;
  }

  /** ตัวกรองบนหน้า st = สถานะ (แถวที่มีของสถานะนั้น) type = ประเภท q = ค้น SKU / ชื่อ / Location */
  function filter(rep, f) {
    var o = f || {};
    var q = up(o.q || '');
    return rep.rows.filter(function (r) {
      if (o.type && r.type !== o.type) return false;
      if (o.st) {
        if (o.st === 'none' || o.st === 'wait') { if (r.st !== o.st) return false; }
        else if (!rep.cols.some(function (col) { var x = r.cells[col.key]; return col.st === o.st && x && x[rep.mode] > 0; })) return false;
      }
      if (!q) return true;
      return up(r.sku).indexOf(q) >= 0 || up(r.short).indexOf(q) >= 0 || up(r.name).indexOf(q) >= 0 ||
        r.locs.some(function (l) { return l.indexOf(q) >= 0; });
    });
  }

  /* ── เทียบกับรอบเดือนก่อน ───────────────────────────────────────────── */

  /**
   * รอบที่ใช้เทียบ: รอบ MFG เดือนเก่ากว่ารอบนี้ที่ใกล้ที่สุด เดือนเดียวกันมีหลายรอบเอารอบที่สร้างทีหลัง
   * rounds = รายการรอบจาก st-rounds (มี settings.ym) → รอบ หรือ null
   */
  function prevRound(rounds, cur) {
    var ym = cur && cur.settings && cur.settings.ym;
    if (!ym) return null;
    var best = null;
    var later = function (a, b) { return String(a.at || a.date || a.id) > String(b.at || b.date || b.id); };
    (rounds || []).forEach(function (r) {
      var y = r && r.settings && r.settings.ym;
      if (!y || r.id === cur.id || y >= ym) return;
      if (!best || y > best.settings.ym || (y === best.settings.ym && later(r, best))) best = r;
    });
    return best;
  }

  /** ชิ้นราย LOT ของแต่ละ SKU ในรายงาน { SKU: { row, risk, lots: {คีย์ LOT: ชิ้น}, riskLots: {คีย์: ชิ้น} } } */
  function riskMap(rep) {
    var m = {};
    rep.rows.forEach(function (r) {
      var o = { row: r, risk: 0, lots: {}, riskLots: {} };
      rep.cols.forEach(function (c) {
        var x = r.cells[c.key];
        var v = x ? x[rep.mode] : 0;
        if (!(v > 0)) return;
        o.lots[c.key] = v;
        if (c.st === 'risk') { o.risk = round3(o.risk + v); o.riskLots[c.key] = v; }
      });
      m[up(r.sku)] = o;
    });
    return m;
  }

  /**
   * เทียบรายงานรอบนี้กับรอบก่อน ราย SKU สถานะของแต่ละรอบคิดตามเดือนของรอบนั้นเอง
   *   new   เพิ่งเข้าเสี่ยง: เดือนนี้มีของเสี่ยง เดือนก่อนไม่มี (ส่วนใหญ่คือของเฝ้าระวังที่อายุครบ)
   *   still ค้างเสี่ยง: มีทั้งสองเดือน
   *   gone  หลุดเสี่ยงแล้ว: เดือนก่อนมี เดือนนี้ไม่มี (ขาย แกะ หรือย้ายออกไป)
   * out = LOT ที่เดือนก่อนเสี่ยง ลดลงไปกี่ชิ้น (นับเฉพาะที่ลด ที่นับเจอเพิ่มไม่หักกัน)
   * keep = SKU ในรายชื่อรอบนี้ (จาก listMap) SKU ที่เอาออกจากรายชื่อแล้วไม่ขึ้นว่าหลุด
   */
  function compare(cur, prev, keep, prevDec) {
    var a = riskMap(cur), b = riskMap(prev);
    var bySku = {}, gone = [];
    var totals = { new: { skus: 0, qty: 0 }, still: { skus: 0, qty: 0 }, gone: { skus: 0, qty: 0 }, out: 0, todo: { skus: 0, qty: 0 } };
    var keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { if (!keep || keep[k] !== undefined) keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var now = a[k], was = b[k];
      var rn = now ? now.risk : 0, rp = was ? was.risk : 0;
      var out = 0, held = 0;
      if (was) Object.keys(was.riskLots).forEach(function (l) {
        var left = now && now.lots[l] ? now.lots[l] : 0;
        if (was.riskLots[l] > left) out = round3(out + was.riskLots[l] - left);
        held = round3(held + Math.min(was.riskLots[l], left));
      });
      var tag = rn > 0 ? (rp > 0 ? 'still' : 'new') : rp > 0 ? 'gone' : '';
      /* เดือนก่อนเจ้านายสั่งแกะหรือขายด่วน แต่ LOT เสี่ยงชุดนั้นยังเหลืออยู่ = ยังไม่ได้ทำตามที่สั่ง */
      var dPrev = (prevDec && prevDec[k]) || null;
      var todo = !!(dPrev && ACT[dPrev.code] && held > 0);
      var o = { tag: tag, riskNow: rn, riskPrev: rp, out: out, held: held, prevSt: was ? was.row.st : '', dPrev: dPrev, todo: todo };
      bySku[k] = o;
      totals.out = round3(totals.out + out);
      if (todo) { totals.todo.skus++; totals.todo.qty = round3(totals.todo.qty + held); }
      if (!tag) return;
      totals[tag].skus++;
      totals[tag].qty = round3(totals[tag].qty + (tag === 'gone' ? rp : rn));
      if (tag === 'gone') {
        var r = (now || was).row;
        gone.push({ sku: r.sku, short: r.short, name: r.name, type: r.type, riskPrev: rp, left: now ? qtyOf(now.row, cur.mode) : 0, out: out, dPrev: dPrev });
      }
    });
    gone.sort(function (x, y) { return y.riskPrev - x.riskPrev || S().natCmp(x.sku, y.sku); });
    return { mode: cur.mode, prevMode: prev.mode, ym: cur.rule.ym, prevYm: prev.rule.ym, bySku: bySku, gone: gone, totals: totals };
  }

  var CMP = {
    new: { label: 'เพิ่งเข้าเสี่ยง', short: 'ใหม่' },
    still: { label: 'ค้างเสี่ยง', short: 'ค้าง' },
    gone: { label: 'หลุดเสี่ยงแล้ว', short: 'หลุดแล้ว' },
  };

  /** ข้อความสั้นของแถวในช่องเทียบ (Excel) */
  function cmpText(o) {
    if (!o || !o.tag) return '';
    return CMP[o.tag].short + (o.out > 0 ? ' · ลด ' + Number(o.out).toLocaleString('en-US') : '');
  }

  /** เดือนก่อนสั่งอะไร (ช่องเทียบ Excel / ชีตเทียบ) สั่งแกะหรือขายแล้วยังค้างบอกจำนวนด้วย */
  function prevDecText(o) {
    if (!o || !o.dPrev) return '';
    return decideText(o.dPrev) + (o.todo ? ' · ยังค้าง ' + Number(o.held).toLocaleString('en-US') : '');
  }

  /* ── คำตัดสินของเจ้านาย ─────────────────────────────────────────────── */

  /**
   * หัวหน้าเลือกตามที่เจ้านายตอบ ราย SKU เก็บในค่าตั้งของรอบ settings.decide = { SKU เต็ม: [code, หมายเหตุ, ใคร, เมื่อไหร่] }
   * ใช้ st-round-save เดิม ไม่ต้องแก้สคริปต์ · ใส่แต่หมายเหตุไม่เลือก = อื่นๆ
   */
  var DECIDE = {
    open: { label: 'แกะ', icon: '✂️' },
    sell: { label: 'ขายด่วน', icon: '🏷️' },
    wait: { label: 'รอเดือนหน้า', icon: '⏸' },
    other: { label: 'อื่นๆ', icon: '📝' },
  };
  var DECIDE_ORDER = ['open', 'sell', 'wait', 'other'];
  var ACT = { open: 1, sell: 1 };   // คำสั่งที่ต้องมีของออกจาก LOT นั้น เดือนถัดไปเช็คว่าทำแล้วหรือยัง
  var NOTE_MAX = 60;
  var SETTINGS_MAX = 30000;         // เท่ากับ SETTINGS_MAX ใน stocktake-api.gs (ค่าตั้งทั้งก้อนของรอบ)

  function cleanNote(v) { return text(v).replace(/\s+/g, ' ').slice(0, NOTE_MAX); }

  /** settings.decide ดิบ → { SKU: {code, note, by, at} } ตัดค่าที่อ่านไม่ออกทิ้ง */
  function decideOf(raw) {
    var m = {};
    if (!raw || typeof raw !== 'object') return m;
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      if (!Array.isArray(v)) return;
      var note = cleanNote(v[1]);
      var code = DECIDE[v[0]] ? v[0] : note ? 'other' : '';
      if (!code) return;
      m[up(k)] = { code: code, note: note, by: text(v[2]), at: text(v[3]) };
    });
    return m;
  }

  /** ใส่ที่แก้ทับของเดิม changes = { SKU: [code, หมายเหตุ, ใคร, เมื่อไหร่] | null (ลบ) } → settings.decide ชุดใหม่ */
  function applyDecide(raw, changes) {
    var out = {};
    var cur = decideOf(raw);
    Object.keys(cur).forEach(function (k) { var d = cur[k]; out[k] = [d.code, d.note, d.by, d.at]; });
    Object.keys(changes || {}).forEach(function (k) {
      var v = changes[k], key = up(k);
      if (!key) return;
      var note = v ? cleanNote(v[1]) : '';
      var code = v && DECIDE[v[0]] ? v[0] : note ? 'other' : '';
      if (!code) { delete out[key]; return; }
      out[key] = [code, note, text(v[2]).slice(0, 40), text(v[3])];
    });
    return out;
  }

  /**
   * Remark ของทีม Inventory ให้เจ้านายอ่าน settings.remark = { SKU เต็ม: [ข้อความ, ใคร, เมื่อไหร่] }
   * แก้ผ่าน st-decide (remarks) ด้วยรหัสหัวหน้าเท่านั้น หน้าเจ้านายอ่านอย่างเดียว
   */
  var REMARK_MAX = 80;              // เท่ากับ REMARK_MAX ใน stocktake-api.gs

  function cleanRemark(v) { return text(v).replace(/\s+/g, ' ').slice(0, REMARK_MAX); }

  /** settings.remark ดิบ → { SKU: {text, by, at} } ข้อความว่างตัดทิ้ง */
  function remarkOf(raw) {
    var m = {};
    if (!raw || typeof raw !== 'object') return m;
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      var t = cleanRemark(Array.isArray(v) ? v[0] : '');
      if (t) m[up(k)] = { text: t, by: text(v[1]), at: text(v[2]) };
    });
    return m;
  }

  /** ข้อความช่อง Action by Tony: เจ้านายพิมพ์เองอย่างเดียว (เก็บเป็น other) · ข้อมูลรุ่นปุ่มเลือกเดิมยังอ่านเป็น "แกะ · หมายเหตุ" */
  function decideText(d) {
    if (!d || !d.code) return '';
    var label = DECIDE[d.code] ? DECIDE[d.code].label : '';
    if (d.code === 'other' && d.note) return d.note;
    return label + (d.note ? ' · ' + d.note : '');
  }

  /**
   * สรุปคำตัดสินของรายงาน ราย code: SKU กี่ตัว ชิ้น (Total MFG) กี่ชิ้น รายชื่อ
   * none = SKU เสี่ยงที่ยังไม่ได้ตัดสิน · any = มีคำตัดสินอย่างน้อยหนึ่งตัว
   */
  function decideSum(rep, map) {
    var s = { none: { skus: 0, qty: 0, list: [] }, done: { skus: 0, qty: 0, list: [] }, any: false };
    DECIDE_ORDER.forEach(function (k) { s[k] = { skus: 0, qty: 0, list: [] }; });
    rep.rows.forEach(function (r) {
      var d = map && map[up(r.sku)];
      var g = d ? s[d.code] : r.st === 'risk' ? s.none : null;
      if (!g) return;
      if (d) s.any = true;
      g.skus++;
      g.qty = round3(g.qty + qtyOf(r, rep.mode));
      g.list.push({ sku: r.sku, short: r.short, note: d ? d.note : '' });
      if (d) {
        s.done.skus++;
        s.done.qty = round3(s.done.qty + qtyOf(r, rep.mode));
        s.done.list.push({ sku: r.sku, short: r.short, text: decideText(d) });
      }
    });
    return s;
  }

  /** แถวตามชิป key = 'done' (ตอบแล้ว) | 'none' (เสี่ยงที่ยังไม่ตอบ) | code (ข้อมูลรุ่นปุ่มเลือก) */
  function byDecide(rows, map, key) {
    if (!key) return rows;
    return rows.filter(function (r) {
      var d = map && map[up(r.sku)];
      return key === 'none' ? !d && r.st === 'risk' : key === 'done' ? !!d : !!d && d.code === key;
    });
  }

  /**
   * ชีตเทียบเดือนก่อน แยกกลุ่ม: เพิ่งเข้าเสี่ยง / ค้างเสี่ยง / หลุดเสี่ยงแล้ว
   * rows ของรายงานรอบนี้ใช้หาชื่อกับประเภท SKU ที่หลุดแล้วใช้ข้อมูลจาก cmp.gone
   */
  function compareSheet(cmp, rep) {
    var head = ['กลุ่ม', 'SKU', 'Product Name', 'Type', 'เสี่ยง ' + ymText(cmp.prevYm), 'เสี่ยง ' + ymText(cmp.ym), 'LOT เดิมลดไป', 'เดือนก่อนสั่ง'];
    var aoa = [['เทียบ ' + ymText(cmp.ym) + ' กับ ' + ymText(cmp.prevYm) + ' · เดือนนี้ใช้' + (cmp.mode === 'count' ? 'ยอดนับจริง' : 'ยอดสมุด') +
      ' · เดือนก่อนใช้' + (cmp.prevMode === 'count' ? 'ยอดนับจริง' : 'ยอดสมุด')], head];
    var styles = [[0, 0, 'title']];
    head.forEach(function (h, c) { styles.push([1, c, 'head']); });
    ['new', 'still'].forEach(function (tag) {
      rep.rows.forEach(function (r) {
        var o = cmp.bySku[up(r.sku)];
        if (!o || o.tag !== tag) return;
        styles.push([aoa.length, 0, tag === 'new' ? 'c-risk' : 'c-watch']);
        if (o.todo) styles.push([aoa.length, 7, 'c-todo']);
        aoa.push([CMP[tag].label, r.sku, r.name, r.type, o.riskPrev || '', o.riskNow || '', o.out || '', prevDecText(o)]);
      });
    });
    cmp.gone.forEach(function (g) {
      styles.push([aoa.length, 0, 'c-ok']);
      aoa.push([CMP.gone.label, g.sku, g.name, g.type, g.riskPrev || '', '', g.out || '', decideText(g.dPrev)]);
    });
    var foot = aoa.length;
    aoa.push(['รวม', '', '', '', '', '', cmp.totals.out || '', cmp.totals.todo.skus ? 'สั่งแล้วยังค้าง ' + cmp.totals.todo.skus + ' SKU' : '']);
    for (var c = 0; c < head.length; c++) styles.push([foot, c, 'foot']);
    return { aoa: aoa, merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: head.length - 1 } }], styles: styles, cols: [18, 17, 46, 15, 14, 14, 13, 26] };
  }

  /* ── Excel และข้อความวาง LINE ───────────────────────────────────────── */

  /**
   * ชีตรายงานแบบเดียวกับที่ทีมทำ (สีตามสถานะ) หน้าเว็บเอาไปใส่สีด้วย xlsx-js-style
   *   แถว 1 ชื่อรายงาน · แถว 2 หัวตาราง + ปี · แถว 3 Lot + ยอดรวมทั้งหมด · แถว 4 อายุ (วัน) · ต่อด้วยราย SKU · แถวท้ายรวม
   * @returns {{aoa, merges, styles: Array<[row, col, key]>, cols}}
   *   key = head | year | total | st-risk | st-watch | st-ok | st-nolot (หัว) · c-risk | c-watch | c-ok | c-nolot (ช่อง) | c-todo (สั่งแล้วยังค้าง) | sum | age | title
   * meta.cmp = ผลเทียบเดือนก่อน (compare) มีแล้วเพิ่มคอลัมน์ "เทียบ <เดือนก่อน>" หน้า Remark
   * meta.remark = Remark ทีม (remarkOf) ลงช่อง Remark · meta.decide = คำตัดสินของเจ้านาย (decideOf) ลงช่อง Action by Tony (ท้ายสุด)
   */
  function sheet(rep, meta) {
    var m = meta || {};
    var cmp = m.cmp || null;
    var dec = m.decide || {};
    var rem = m.remark || {};
    var extra = cmp ? 1 : 0;
    var mode = rep.mode;
    var cols = rep.cols;
    var n = 3 + cols.length;               // คอลัมน์ Total MFG
    var title = 'เช็คความเสี่ยง MFG ' + ymText(m.ym || rep.rule.ym) + ' · ' + rep.rule.text +
      ' · ' + (mode === 'count' ? 'นับจริง' + (rep.total ? ' ' + rep.done + '/' + rep.total + ' โล' : '') : 'ยอดในสมุด') +
      (m.at ? ' · ' + m.at : '');
    var width = n + 4 + extra;
    var blank = function () { var a = []; for (var i = 0; i < width; i++) a.push(''); return a; };
    var r0 = blank(), r1 = blank(), r2 = blank(), r3 = blank();
    r0[0] = title;
    r1[0] = 'SKU'; r1[1] = 'Product Name'; r1[2] = 'Type';
    var styles = [[0, 0, 'title']], merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } }];
    [0, 1, 2].forEach(function (c) { merges.push({ s: { r: 1, c: c }, e: { r: 3, c: c } }); styles.push([1, c, 'head']); });
    var grand = round3(rep.totals[mode]);
    r1[n] = 'Total MFG'; r2[n] = grand; styles.push([1, n, 'total'], [2, n, 'total'], [3, n, 'total']);
    merges.push({ s: { r: 2, c: n }, e: { r: 3, c: n } });
    r1[n + 1] = 'สถานะ'; r1[n + 2 + extra] = 'Remark'; r1[n + 3 + extra] = 'Action by Tony';
    if (cmp) r1[n + 2] = 'เทียบ ' + ymText(cmp.prevYm);
    (cmp ? [n + 1, n + 2, n + 3, n + 4] : [n + 1, n + 2, n + 3]).forEach(function (c) { merges.push({ s: { r: 1, c: c }, e: { r: 3, c: c } }); styles.push([1, c, 'head']); });
    /* แถวปี: คอลัมน์ LOT ปีเดียวกันรวมช่องเดียว NO LOT ไม่มีปี ใช้หัวสามแถวเต็ม */
    var c0 = -1, y0 = null;
    function closeYear(end) {
      if (c0 < 0) return;
      if (end > c0) merges.push({ s: { r: 1, c: c0 }, e: { r: 1, c: end } });
      styles.push([1, c0, 'year']);
    }
    cols.forEach(function (col, i) {
      var c = 3 + i;
      if (col.key === NOLOT) {
        r1[c] = 'NO LOT';
        merges.push({ s: { r: 1, c: c }, e: { r: 3, c: c } });
        styles.push([1, c, 'st-nolot']);
        return;
      }
      if (col.y !== y0) { closeYear(c - 1); c0 = c; y0 = col.y; r1[c] = String(col.y); }
      r2[c] = col.label;
      r3[c] = col.age === null ? '' : col.age + ' วัน';
      styles.push([2, c, 'st-' + col.st], [3, c, 'age']);
    });
    closeYear(3 + cols.length - 1);
    var aoa = [r0, r1, r2, r3];
    rep.rows.forEach(function (r) {
      var row = [r.sku, r.name, r.type];
      var ri = aoa.length;
      cols.forEach(function (col, i) {
        var x = r.cells[col.key];
        var q = x ? round3(x[mode]) : 0;
        row.push(q ? q : '');
        styles.push([ri, 3 + i, 'c-' + col.st]);
      });
      row.push(round3(r.total[mode]));
      styles.push([ri, n, 'sum']);
      row.push(STATUS[r.st].label);
      if (cmp) {
        var o = cmp.bySku[up(r.sku)];
        row.push([cmpText(o), o && o.dPrev ? 'เดือนก่อน: ' + prevDecText(o) : ''].filter(Boolean).join(' · '));
        if (o && o.todo) styles.push([ri, n + 2, 'c-todo']);
      }
      row.push(rem[up(r.sku)] ? rem[up(r.sku)].text : '');
      row.push(decideText(dec[up(r.sku)]));
      aoa.push(row);
    });
    var foot = ['รวม', '', ''];
    var fi = aoa.length;
    cols.forEach(function (col) { var q = round3(rep.totals.cols[col.key][mode]); foot.push(q ? q : ''); });
    foot.push(grand, '', '', '');
    if (cmp) foot.push('');
    for (var c = 0; c < width; c++) styles.push([fi, c, 'foot']);
    aoa.push(foot);
    var widths = [17, 46, 15];
    cols.forEach(function () { widths.push(9); });
    widths.push(11, 12);
    if (cmp) widths.push(22);
    widths.push(34, 30);
    return { aoa: aoa, merges: merges, styles: styles, cols: widths };
  }

  /** รายชื่อสั้นใน LINE ไม่เกิน 8 ตัว ที่เหลือบอกจำนวน */
  function names(list, fmt) {
    var max = 8;
    return list.slice(0, max).map(fmt).join(', ') + (list.length > max ? ' …อีก ' + (list.length - max) : '');
  }

  /** สรุปสั้นวางใน LINE ให้เจ้านาย meta.decide มีคำตัดสินแล้วต่อท้ายด้วยรายชื่อตามคำสั่ง */
  function lineText(rep, meta) {
    var m = meta || {};
    var r = rep.rule;
    var by = rep.by;
    var f = function (n) { return Number(n || 0).toLocaleString('en-US'); };
    var lines = ['📦 เช็คความเสี่ยง MFG ' + ymText(m.ym || r.ym) + ' (' + r.text + ')'];
    if (rep.mode === 'count') lines.push('นับจริง ' + rep.done + '/' + rep.total + ' โล' + (rep.done < rep.total ? ' (ยังนับไม่ครบ)' : ''));
    else lines.push('ตัวเลขจากสมุด (ยังไม่ได้นับ)');
    lines.push('🔴 เสี่ยง (' + r.riskText + '): ' + f(by.risk.qty) + ' ชิ้น ' + by.risk.skus + ' SKU');
    lines.push('🟡 เฝ้าระวัง (' + r.watchText + '): ' + f(by.watch.qty) + ' ชิ้น ' + by.watch.skus + ' SKU');
    lines.push('🟢 ปกติ (' + r.okText + '): ' + f(by.ok.qty) + ' ชิ้น ' + by.ok.skus + ' SKU');
    if (by.nolot.qty) lines.push('⚪ NO LOT ต้องตรวจสอบ: ' + f(by.nolot.qty) + ' ชิ้น ' + by.nolot.skus + ' SKU');
    lines.push('รวม ' + f(rep.totals[rep.mode]) + ' ชิ้น');
    var cmp = m.cmp;
    if (cmp) {
      var t = cmp.totals;
      lines.push('', 'เทียบ ' + ymText(cmp.prevYm) + ':');
      lines.push('🆕 เพิ่งเข้าเสี่ยง ' + t.new.skus + ' SKU (' + f(t.new.qty) + ' ชิ้น)');
      lines.push('⏳ ค้างเสี่ยงจากเดือนก่อน ' + t.still.skus + ' SKU (' + f(t.still.qty) + ' ชิ้น)');
      lines.push('✅ หลุดเสี่ยงแล้ว ' + t.gone.skus + ' SKU');
      if (t.out) lines.push('LOT ที่เสี่ยงเดือนก่อน ลดไป ' + f(t.out) + ' ชิ้น (ขาย/แกะ)');
      if (t.todo && t.todo.skus) {
        var late = Object.keys(cmp.bySku).filter(function (k) { return cmp.bySku[k].todo; });
        var shortOf = {};
        rep.rows.forEach(function (x) { shortOf[up(x.sku)] = x.short || x.sku; });
        lines.push('⚠️ เดือนก่อนสั่งแกะ/ขายด่วน แต่ยังค้าง ' + t.todo.skus + ' SKU (' + f(t.todo.qty) + ' ชิ้น): ' +
          names(late.map(function (k) { return { short: shortOf[k] || k, held: cmp.bySku[k].held }; }), function (x) { return x.short + ' ' + f(x.held); }));
      }
    }
    var dsum = m.decide ? decideSum(rep, m.decide) : null;
    if (dsum && dsum.any) {
      lines.push('', '✍️ Action by Tony (' + dsum.done.skus + ' SKU):');
      dsum.done.list.slice(0, 8).forEach(function (x) { lines.push('• ' + (x.short || x.sku) + ' — ' + x.text); });
      if (dsum.done.list.length > 8) lines.push('…อีก ' + (dsum.done.list.length - 8) + ' SKU');
      if (dsum.none.skus) lines.push('❓ เสี่ยงที่ยังไม่ตอบ ' + dsum.none.skus + ' SKU');
    }
    var rmap = m.remark || {};
    var rk = rep.rows.filter(function (x) { return rmap[up(x.sku)]; });
    if (rk.length) {
      lines.push('', '💬 Remark ทีม:');
      rk.slice(0, 8).forEach(function (x) { lines.push('• ' + (x.short || x.sku) + ' — ' + rmap[up(x.sku)].text); });
      if (rk.length > 8) lines.push('…อีก ' + (rk.length - 8) + ' SKU');
    }
    var top = rep.rows.filter(function (x) { return x.st === 'risk'; }).slice(0, 5);
    if (top.length) {
      lines.push('', 'เสี่ยง · LOT เก่าสุดก่อน:');
      top.forEach(function (x) {
        var parts = rep.cols.filter(function (col) { return col.st === 'risk' && x.cells[col.key] && x.cells[col.key][rep.mode] > 0; })
          .map(function (col) { return col.label + ' ' + f(x.cells[col.key][rep.mode]); });
        lines.push('• ' + (x.short || x.sku) + ' ' + x.name + ' — ' + parts.join(', '));
      });
    }
    return lines.join('\n');
  }

  /* ── การ์ดรูปสรุปให้เจ้านาย (หน้าเว็บวาดลงภาพ ส่งใน LINE) ─────────────── */

  /** คำตัดสินแบบสั้นลงช่องแคบ ๆ ของการ์ด: อื่นๆ ที่มีหมายเหตุใช้หมายเหตุแทน */
  function decideShort(d) {
    if (!d || !d.code) return '';
    if (d.code === 'other') return d.note || DECIDE.other.label;
    return DECIDE[d.code].label;
  }

  /**
   * ตัวเลขทั้งหมดของการ์ดรูป คิดจากรายงานทั้งรอบ (ไม่สนตัวกรองบนจอ) หน้าเว็บแค่เอาไปวาด
   * meta = { ym, at, cmp (compare), decide (decideOf), top = จำนวนแถวเสี่ยงที่โชว์ }
   *   tiles  สามกล่องบน: เสี่ยง (เทียบเดือนก่อนถ้ามี) · เฝ้าระวัง · ไม่มี LOT (ไม่มีของ NO LOT ใช้ ปกติ แทน)
   *   types  ชิ้นแยกประเภท × สถานะ · top แถวเสี่ยงเรียง LOT เก่าสุดก่อน (ลำดับเดียวกับรายงาน)
   *   decide = { done, qty, none } ตอบแล้วกี่ SKU / ชิ้น · เสี่ยงที่ยังไม่ตอบ (มีเมื่อตอบอย่างน้อยหนึ่งตัว) · cmp สรุปเทียบเดือนก่อน
   */
  function card(rep, meta) {
    var m = meta || {};
    var mode = rep.mode, r = rep.rule, by = rep.by;
    var cmp = m.cmp || null;
    var dec = m.decide || {};
    var topN = m.top || 8;

    var prevRisk = null;
    if (cmp) {
      prevRisk = 0;
      Object.keys(cmp.bySku).forEach(function (k) { prevRisk = round3(prevRisk + (cmp.bySku[k].riskPrev || 0)); });
    }
    var tile = function (k, label, hint) { return { k: k, label: label, hint: hint, skus: by[k].skus, qty: by[k].qty }; };
    var risk = tile('risk', STATUS.risk.label, r.riskText);
    if (cmp) {
      risk.prev = prevRisk;
      risk.pct = prevRisk > 0 ? Math.round((by.risk.qty - prevRisk) / prevRisk * 100) : null;
    }
    var tiles = [risk, tile('watch', STATUS.watch.label, r.watchText),
      by.nolot.qty ? tile('nolot', 'ไม่มี LOT', 'ต้องตรวจสอบ') : tile('ok', STATUS.ok.label, r.okText)];

    /* ชิ้นแยกประเภท: ประเภทของทีมตามลำดับเดิม ประเภทอื่น (ถ้ามี) ต่อท้าย */
    var tmap = {};
    rep.rows.forEach(function (row) {
      var t = row.type || 'ไม่ระบุ';
      var o = tmap[t] || (tmap[t] = { type: t, risk: 0, watch: 0, ok: 0, nolot: 0, total: 0 });
      rep.cols.forEach(function (col) {
        var x = row.cells[col.key];
        var q = x ? x[mode] : 0;
        if (!(q > 0) || o[col.st] === undefined) return;
        o[col.st] = round3(o[col.st] + q);
        o.total = round3(o.total + q);
      });
    });
    var torder = TYPES.concat(Object.keys(tmap).filter(function (t) { return TYPES.indexOf(t) < 0; }).sort());
    var types = torder.filter(function (t) { return tmap[t] && tmap[t].total > 0; }).map(function (t) { return tmap[t]; });

    var riskRows = rep.rows.filter(function (row) { return row.st === 'risk'; });
    var top = riskRows.slice(0, topN).map(function (row) {
      var q = 0, oldest = null;
      rep.cols.forEach(function (col) {
        var x = row.cells[col.key];
        if (col.st !== 'risk' || !x || !(x[mode] > 0)) return;
        q = round3(q + x[mode]);
        if (!oldest) oldest = col;
      });
      var o = cmp ? cmp.bySku[up(row.sku)] : null;
      return {
        sku: row.short || row.sku, long: row.sku, name: row.name, type: row.type,
        lot: oldest ? oldest.label : '', age: oldest ? oldest.age : null, month: oldest ? oldest.month : '',
        qty: q, total: round3(row.total[mode]),
        dec: decideShort(dec[up(row.sku)]), code: (dec[up(row.sku)] || {}).code || '',
        tag: o ? o.tag : '', todo: !!(o && o.todo),
      };
    });

    var decide = null;
    var ds = decideSum(rep, dec);
    if (ds.any) {
      decide = { done: ds.done.skus, qty: ds.done.qty, none: ds.none.skus };
    }

    var cmpSum = null;
    if (cmp) {
      var t = cmp.totals;
      var shortOf = {};
      rep.rows.forEach(function (row) { shortOf[up(row.sku)] = row.short || row.sku; });
      var late = Object.keys(cmp.bySku).filter(function (k) { return cmp.bySku[k].todo; })
        .sort(function (a, b) { return cmp.bySku[b].held - cmp.bySku[a].held; });
      cmpSum = {
        prev: ymText(cmp.prevYm), new: t.new.skus, still: t.still.skus, gone: t.gone.skus, out: t.out,
        todo: { skus: t.todo.skus, qty: t.todo.qty, list: late.map(function (k) { return shortOf[k] || k; }) },
      };
    }

    var counted = mode === 'count';
    return {
      title: 'ความเสี่ยง MFG ' + ymText(m.ym || r.ym),
      rule: r.text,
      status: counted ? 'นับจริง ' + rep.done + '/' + rep.total + ' โล' : 'ยอดในสมุด (ยังไม่ได้นับ)',
      partial: counted ? rep.done < rep.total : true,
      at: text(m.at),
      total: round3(rep.totals[mode]),
      tiles: tiles, types: types, top: top, more: Math.max(0, riskRows.length - topN), riskSkus: riskRows.length,
      decide: decide, cmp: cmpSum,
    };
  }

  /* ── หน้ากรอกมือถือ (stocktake/count.html): เตือน LOT ตอนนับรอบ MFG ────── */

  /**
   * เดือนของรอบจากชื่อรอบ "MFG พ.ย. 69 · นับ LOT 8 ลงไป" (ชื่อจาก roundName)
   * หน้ากรอกได้แค่ชื่อรอบ ไม่ได้ค่าตั้ง จึงอ่านจากชื่อ ไม่ต้องแก้สคริปต์ · ไม่ใช่รอบ MFG คืน ''
   */
  function ymFromName(name) {
    var m = /^MFG\s+(\S+)\s+(\d{2})(?!\d)/.exec(text(name));
    if (!m) return '';
    var i = MONTHS.indexOf(m[1]);
    if (i < 0) return '';
    return (2500 + +m[2] - 543) + '-' + pad(i + 1);   // พ.ศ. สองหลัก → ค.ศ.
  }

  /**
   * LOT ที่คนนับพิมพ์ ในรอบ MFG เดือน ym
   *   level: ok = ต้องนับ (บอกเดือนให้เทียบกับป้าย) · new = ใหม่กว่าที่ต้องนับ · bad = อ่านไม่ออก · none = LOT 0 · blank = ยังไม่พิมพ์
   *   hint = ข้อความใต้ช่อง LOT · ask = ถามยืนยันตอนกดเพิ่มกอง ('' = ไม่ต้องถาม · ช่องว่างหน้ากรอกเตือนเองอยู่แล้ว)
   */
  function lotCheck(lot, ym) {
    var s = text(lot);
    if (s === '') return { level: 'blank', hint: '', ask: '' };
    var st = statusOf(s, ym);
    if (st.st === 'nolot' && !st.bad) return { level: 'none', hint: 'LOT 0 = ป้ายไม่มี LOT · ไปอยู่กลุ่ม NO LOT ต้องตรวจสอบ', ask: '' };
    if (st.bad) {
      var b = 'อ่าน LOT "' + s + '" ไม่ออก · LOT คือเลขเดือน 1–12 (ป้ายไม่มี LOT ใส่ 0)';
      return { level: 'bad', hint: '⚠ ' + b, ask: b + '\n\nป้ายเขียนแบบนี้จริง? (ถ้าใช่ กดตกลง จะไปอยู่กลุ่ม NO LOT)' };
    }
    var lab = 'LOT ' + s + ' (' + monthText(st.lm) + ')';
    var r = rule(ym);
    if (st.st === 'new') {
      return {
        level: 'new', hint: '⚠ ' + lab + ' ใหม่กว่าที่ต้องนับ · รอบนี้' + r.text + ' ไม่ต้องนับกองนี้',
        ask: lab + ' ใหม่กว่าที่ต้องนับ\nรอบนี้' + r.text + ' กองนี้ไม่ต้องนับ รายงานไม่เอาไปคิด\n\nดูป้ายอีกครั้ง ถ้า LOT ถูกและยังจะบันทึก กดตกลง',
      };
    }
    return { level: 'ok', hint: '✓ ' + lab + ' ต้องนับ', ask: '' };
  }

  /* ── ลิงก์เจ้านาย (mfg/boss.html) ─────────────────────────────────────── */

  /**
   * ลิงก์ให้เจ้านายเปิดดูรายงานและเลือกคำตัดสินเอง ไม่ต้องเข้าแอป
   * ข้อมูลอยู่หลัง # เบราว์เซอร์ไม่ส่งไปกับการเปิดหน้า (เหมือนลิงก์คนนับ)
   */
  function bossLink(page, url, key, round) {
    return page + '#u=' + encodeURIComponent(url) + '&b=' + encodeURIComponent(key) + '&r=' + encodeURIComponent(round);
  }

  /** ส่วนหลัง # ของลิงก์เจ้านาย → {url, key, round} หรือ null ถ้าไม่ครบ */
  function parseBossLink(hash) {
    var q = {};
    String(hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} }
    });
    if (!q.u || !q.b || !q.r || !/^https?:\/\//.test(q.u)) return null;
    return { url: q.u, key: q.b, round: q.r };
  }

  /** ข้อมูลรอบหนึ่งจาก st-boss → รายงาน (นับแล้วใช้ยอดนับ ยังไม่นับใช้ยอดสมุด เหมือนหน้า MFG) */
  function bossRep(d, today) {
    var st = S();
    var entries = st.merge([], (d.rows || []).map(st.fromRow));
    var set = d.round.settings || {};
    var list = unpackList(set.list);
    return {
      list: list,
      rep: report({ ym: set.ym, today: today || d.round.date, list: list, skus: d.skus, book: d.piles, entries: entries,
        mode: st.effective(entries).length ? 'count' : 'book', locs: d.locs || [] }),
    };
  }

  /**
   * คำตอบ st-boss ทั้งก้อน → ที่หน้าเจ้านายต้องใช้
   *   rep รายงานรอบนี้ · cmp เทียบรอบเดือนก่อน (มีรอบก่อน) · decide คำตัดสินที่บันทึกแล้ว (decideOf)
   */
  function bossModel(data, today) {
    var cur = bossRep(data, today);
    var cmp = null;
    if (data.prev) {
      var prev = bossRep(data.prev, data.prev.round.date);
      cmp = compare(cur.rep, prev.rep, listMap(cur.list, data.skus), decideOf(data.prev.round.settings && data.prev.round.settings.decide));
    }
    return { round: data.round, ym: data.round.settings.ym, rep: cur.rep, cmp: cmp, decide: decideOf(data.round.settings.decide),
      remark: remarkOf(data.round.settings.remark) };
  }

  /** เดือนที่เลือกเปิดรอบได้ (เดือนก่อน เดือนนี้ เดือนหน้า) today = yyyy-mm-dd */
  function months(today) {
    var k = refKey(today.slice(0, 7));
    return [k - 1, k, k + 1].map(function (x) { var o = ofKey(x); return o.y + '-' + pad(o.m); });
  }

  window.WmsMfg = {
    CUT: CUT, WATCH: WATCH, RISK: RISK, STATUS: STATUS, ORDER: ORDER, TYPES: TYPES, NOLOT: NOLOT,
    typeOf: typeOf, canonType: canonType, typeCode: typeCode, typeName: typeName,
    guessList: guessList, parseList: parseList, packList: packList, unpackList: unpackList, listMap: listMap,
    rule: rule, roundName: roundName, ymText: ymText, monthText: monthText, months: months,
    noLot: noLot, statusOf: statusOf, ageDays: ageDays,
    ledgerProblem: ledgerProblem, ledgerTime: ledgerTime, ledgerLink: ledgerLink,
    scope: scope, teams: teams, report: report, filter: filter, sheet: sheet, lineText: lineText,
    CMP: CMP, prevRound: prevRound, compare: compare, cmpText: cmpText, compareSheet: compareSheet,
    DECIDE: DECIDE, DECIDE_ORDER: DECIDE_ORDER, NOTE_MAX: NOTE_MAX, SETTINGS_MAX: SETTINGS_MAX,
    decideOf: decideOf, applyDecide: applyDecide, decideText: decideText, decideSum: decideSum, byDecide: byDecide, prevDecText: prevDecText,
    decideShort: decideShort, card: card, ymFromName: ymFromName, lotCheck: lotCheck,
    REMARK_MAX: REMARK_MAX, remarkOf: remarkOf,
    bossLink: bossLink, parseBossLink: parseBossLink, bossModel: bossModel,
  };
})(window);
