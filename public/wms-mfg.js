/**
 * @file wms-mfg.js — เช็คความเสี่ยง MFG: นับของบีบสูญญากาศที่ LOT เก่า แล้วทำรายงานให้เจ้านายตัดสินใจแกะกาง
 *
 * ผู้ใช้ขอ 2026-11-16: ที่นอน ท็อปเปอร์ หมอน บีบสูญญากาศ ต้องเช็คทุกเดือน เป็นเมนูที่นับเองแบบนับสต๊อกใหญ่
 *   - นับเฉพาะ SKU บีบสูญญากาศ ไม่นับทุก SKU
 *   - นับเฉพาะ LOT ตั้งแต่เดือนนี้ลบ 3 ลงไป (พ.ย. นับ LOT 8 ลงไป) LOT ใหม่กว่านั้นไม่นับ ทุกประเภทใช้เกณฑ์เดียวกัน
 *   - รอบ พ.ย.: LOT 6 เฝ้าระวัง, LOT 4–5 เสี่ยงมาก → อายุ 5 เดือน = เฝ้าระวัง, 6 เดือนขึ้นไป = เสี่ยงมาก, 3–4 เดือน = ปกติ
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
  var RISK = 6;    // อายุ 6 เดือนขึ้นไป = เสี่ยงมาก (พ.ย. → LOT 5 ลงไป)

  /* ลำดับความเสี่ยง เรียงแถวและชิปตามนี้ */
  var STATUS = {
    risk: { label: 'เสี่ยงมาก', rank: 0 },
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
   *   risk  = เดือนที่เสี่ยงมาก (เดือนนี้ลบ 6 ลงไป)
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

  /* ── Excel และข้อความวาง LINE ───────────────────────────────────────── */

  /**
   * ชีตรายงานแบบเดียวกับที่ทีมทำ (สีตามสถานะ) หน้าเว็บเอาไปใส่สีด้วย xlsx-js-style
   *   แถว 1 ชื่อรายงาน · แถว 2 หัวตาราง + ปี · แถว 3 Lot + ยอดรวมทั้งหมด · แถว 4 อายุ (วัน) · ต่อด้วยราย SKU · แถวท้ายรวม
   * @returns {{aoa, merges, styles: Array<[row, col, key]>, cols}}
   *   key = head | year | total | st-risk | st-watch | st-ok | st-nolot (หัว) · c-risk | c-watch | c-ok | c-nolot (ช่อง) | sum | age | title
   */
  function sheet(rep, meta) {
    var m = meta || {};
    var mode = rep.mode;
    var cols = rep.cols;
    var n = 3 + cols.length;               // คอลัมน์ Total MFG
    var title = 'เช็คความเสี่ยง MFG ' + ymText(m.ym || rep.rule.ym) + ' · ' + rep.rule.text +
      ' · ' + (mode === 'count' ? 'นับจริง' + (rep.total ? ' ' + rep.done + '/' + rep.total + ' โล' : '') : 'ยอดในสมุด') +
      (m.at ? ' · ' + m.at : '');
    var width = n + 3;
    var blank = function () { var a = []; for (var i = 0; i < width; i++) a.push(''); return a; };
    var r0 = blank(), r1 = blank(), r2 = blank(), r3 = blank();
    r0[0] = title;
    r1[0] = 'SKU'; r1[1] = 'Product Name'; r1[2] = 'Type';
    var styles = [[0, 0, 'title']], merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } }];
    [0, 1, 2].forEach(function (c) { merges.push({ s: { r: 1, c: c }, e: { r: 3, c: c } }); styles.push([1, c, 'head']); });
    var grand = round3(rep.totals[mode]);
    r1[n] = 'Total MFG'; r2[n] = grand; styles.push([1, n, 'total'], [2, n, 'total'], [3, n, 'total']);
    merges.push({ s: { r: 2, c: n }, e: { r: 3, c: n } });
    r1[n + 1] = 'สถานะ'; r1[n + 2] = 'Remark';
    [n + 1, n + 2].forEach(function (c) { merges.push({ s: { r: 1, c: c }, e: { r: 3, c: c } }); styles.push([1, c, 'head']); });
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
      row.push('');
      aoa.push(row);
    });
    var foot = ['รวม', '', ''];
    var fi = aoa.length;
    cols.forEach(function (col) { var q = round3(rep.totals.cols[col.key][mode]); foot.push(q ? q : ''); });
    foot.push(grand, '', '');
    for (var c = 0; c < width; c++) styles.push([fi, c, 'foot']);
    aoa.push(foot);
    var widths = [17, 46, 15];
    cols.forEach(function () { widths.push(9); });
    widths.push(11, 12, 24);
    return { aoa: aoa, merges: merges, styles: styles, cols: widths };
  }

  /** สรุปสั้นวางใน LINE ให้เจ้านาย */
  function lineText(rep, meta) {
    var m = meta || {};
    var r = rep.rule;
    var by = rep.by;
    var f = function (n) { return Number(n || 0).toLocaleString('en-US'); };
    var lines = ['📦 เช็คความเสี่ยง MFG ' + ymText(m.ym || r.ym) + ' (' + r.text + ')'];
    if (rep.mode === 'count') lines.push('นับจริง ' + rep.done + '/' + rep.total + ' โล' + (rep.done < rep.total ? ' (ยังนับไม่ครบ)' : ''));
    else lines.push('ตัวเลขจากสมุด (ยังไม่ได้นับ)');
    lines.push('🔴 เสี่ยงมาก (' + r.riskText + '): ' + f(by.risk.qty) + ' ชิ้น ' + by.risk.skus + ' SKU');
    lines.push('🟡 เฝ้าระวัง (' + r.watchText + '): ' + f(by.watch.qty) + ' ชิ้น ' + by.watch.skus + ' SKU');
    lines.push('🟢 ปกติ (' + r.okText + '): ' + f(by.ok.qty) + ' ชิ้น ' + by.ok.skus + ' SKU');
    if (by.nolot.qty) lines.push('⚪ NO LOT ต้องตรวจสอบ: ' + f(by.nolot.qty) + ' ชิ้น ' + by.nolot.skus + ' SKU');
    lines.push('รวม ' + f(rep.totals[rep.mode]) + ' ชิ้น');
    var top = rep.rows.filter(function (x) { return x.st === 'risk'; }).slice(0, 5);
    if (top.length) {
      lines.push('', 'เสี่ยงมากสุด:');
      top.forEach(function (x) {
        var parts = rep.cols.filter(function (col) { return col.st === 'risk' && x.cells[col.key] && x.cells[col.key][rep.mode] > 0; })
          .map(function (col) { return col.label + ' ' + f(x.cells[col.key][rep.mode]); });
        lines.push('• ' + (x.short || x.sku) + ' ' + x.name + ' — ' + parts.join(', '));
      });
    }
    return lines.join('\n');
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
    scope: scope, teams: teams, report: report, filter: filter, sheet: sheet, lineText: lineText,
  };
})(window);
